//! Diagnose and fix SSH authentication for the "Fix SSH" dialog.
//!
//! GitBranch runs ssh windowless (`SSH_ASKPASS_REQUIRE=never`), so a passphrase-protected key that is
//! not loaded in an agent fails with `Permission denied (publickey)`. This module reports the
//! state (keys, agent, Windows OpenSSH service) and fixes it: starting the Windows agent, pointing
//! git at Windows OpenSSH, and loading a key with `ssh-add` whose passphrase is handed over through
//! the app's own exe acting as `SSH_ASKPASS`. The passphrase only travels in an environment
//! variable of the `ssh-add` child; it is never put in argv, logged, or stored.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::runner::{GitError, GitErrorKind, GitRunner, RunOpts};

/// State of the Windows `ssh-agent` service.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ServiceState {
    /// Started.
    Running,
    /// Installed, enabled, but not started.
    Stopped,
    /// Start type is Disabled (the Windows default).
    Disabled,
    /// The service does not exist (error 1060).
    Missing,
}

/// What the `ssh-add` matching the target agent sees.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AgentState {
    /// An agent answered and holds `keys` identities.
    Ready {
        /// Number of loaded identities.
        keys: u32,
    },
    /// No agent could be reached.
    Unreachable,
}

/// A private key in `~/.ssh` that has a matching `.pub`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    /// Path of the private key file.
    pub path: String,
    /// Key type as printed by ssh-keygen (`ED25519`, `RSA`, ...).
    pub kind: String,
    /// SHA256 fingerprint (`SHA256:...`).
    pub fingerprint: String,
    /// Comment of the public key.
    pub comment: String,
    /// The key needs a passphrase.
    pub encrypted: bool,
    /// The fingerprint is held by the agent.
    pub loaded: bool,
    /// The key file's permissions are too open for ssh to use it (then `encrypted` is false).
    pub bad_permissions: bool,
}

/// Where the effective `core.sshCommand` comes from.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SshCommandScope {
    /// Global git config.
    Global,
    /// Repository (or worktree) git config.
    Local,
    /// System git config.
    System,
    /// `GIT_SSH_COMMAND` / `GIT_SSH` in GitBranch's environment.
    Env,
}

/// Everything the dialog shows.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshReport {
    /// Running on Windows.
    pub windows: bool,
    /// Effective ssh command (`GIT_SSH_COMMAND`, else `core.sshCommand`, else `GIT_SSH`).
    pub ssh_command: Option<String>,
    /// Where `ssh_command` comes from.
    pub ssh_command_scope: Option<SshCommandScope>,
    /// Windows: the ssh command points at the Windows OpenSSH `ssh.exe`.
    pub uses_windows_openssh: bool,
    /// Windows only: the exact value "use Windows OpenSSH" would write to `core.sshCommand`.
    pub windows_ssh_command: Option<String>,
    /// Why the OpenSSH tools could not be run (for example the Windows OpenSSH client is missing).
    pub tools_error: Option<String>,
    /// Windows only: the `ssh-agent` service state.
    pub windows_agent: Option<ServiceState>,
    /// Agent as seen by the target `ssh-add`.
    pub agent: AgentState,
    /// Usable private keys.
    pub keys: Vec<SshKey>,
}

/// Why an SSH fix step failed.
#[derive(Debug, Clone, thiserror::Error)]
pub enum SshError {
    /// A git call failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// The passphrase was wrong (or missing).
    #[error("the passphrase is wrong")]
    BadPassphrase,
    /// No agent to load the key into.
    #[error("no ssh-agent is running")]
    NoAgent,
    /// The key file's permissions are too open for ssh.
    #[error("the key file permissions are too open: {0}")]
    BadPermissions(String),
    /// The user declined the elevation prompt.
    #[error("the administrator prompt was declined")]
    Cancelled,
    /// Anything else, with the tool's stderr.
    #[error("{0}")]
    Failed(String),
}

impl SshError {
    /// Stable code for the IPC `AppError.code`.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Git(g) => g.code(),
            Self::BadPassphrase => "ssh.bad_passphrase",
            Self::NoAgent => "ssh.no_agent",
            Self::BadPermissions(_) => "ssh.bad_permissions",
            Self::Cancelled => "ssh.cancelled",
            Self::Failed(_) => "ssh.failed",
        }
    }
}

/// The OpenSSH tools to drive, plus extra environment for every spawn (tests point it at a
/// private agent).
#[derive(Debug, Clone)]
pub struct Tools {
    /// `ssh-add` executable.
    pub ssh_add: PathBuf,
    /// `ssh-keygen` executable.
    pub ssh_keygen: PathBuf,
    /// Extra environment for every spawn.
    pub env: Vec<(String, String)>,
}

impl Tools {
    /// Windows: the System32 OpenSSH (the agent service's client); elsewhere the tools on `PATH`.
    pub fn system() -> Self {
        if cfg!(windows) {
            let dir = system_root().join("System32").join("OpenSSH");
            Self {
                ssh_add: dir.join("ssh-add.exe"),
                ssh_keygen: dir.join("ssh-keygen.exe"),
                env: Vec::new(),
            }
        } else {
            Self { ssh_add: "ssh-add".into(), ssh_keygen: "ssh-keygen".into(), env: Vec::new() }
        }
    }
}

/// `%SystemRoot%` (fallback `C:\Windows`); only meaningful on Windows.
fn system_root() -> PathBuf {
    std::env::var_os("SystemRoot")
        .filter(|v| !v.is_empty())
        .map_or_else(|| PathBuf::from(r"C:\Windows"), PathBuf::from)
}

/// The Windows OpenSSH client path as written to `core.sshCommand` (forward slashes).
fn windows_openssh_command() -> String {
    let root = system_root().to_string_lossy().replace('\\', "/");
    format!("{}/System32/OpenSSH/ssh.exe", root.trim_end_matches('/'))
}

/// The user's home directory (`USERPROFILE` on Windows, `HOME` elsewhere).
pub fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from)
}

// ---------------------------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------------------------

/// A line of `ssh-keygen -l` / `ssh-add -l`: `256 SHA256:abc comment (ED25519)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyLine {
    /// Key type in the trailing parentheses.
    pub kind: String,
    /// `SHA256:...` fingerprint.
    pub fingerprint: String,
    /// Comment (may be empty or contain spaces).
    pub comment: String,
}

/// Parses one fingerprint line; `None` when it does not look like one.
pub fn parse_key_line(line: &str) -> Option<KeyLine> {
    let line = line.trim();
    let mut it = line.splitn(3, char::is_whitespace);
    let bits = it.next()?;
    let fingerprint = it.next()?;
    let rest = it.next().unwrap_or("").trim();
    if bits.parse::<u32>().is_err() || !fingerprint.contains(':') {
        return None;
    }
    let (comment, kind) = match rest.rfind('(') {
        Some(i) if rest.ends_with(')') => (rest[..i].trim(), &rest[i + 1..rest.len() - 1]),
        _ => (rest, ""),
    };
    Some(KeyLine {
        kind: kind.to_string(),
        fingerprint: fingerprint.to_string(),
        comment: comment.to_string(),
    })
}

/// Fingerprints listed by `ssh-add -l -E sha256`.
pub fn parse_agent_list(out: &str) -> Vec<KeyLine> {
    out.lines().filter_map(parse_key_line).collect()
}

/// Service state from `sc.exe query ssh-agent` and `sc.exe qc ssh-agent` output.
///
/// The labels are localized (`STATE` is `ESTADO` on a Spanish Windows) but the values are not,
/// so only the `: <n>  RUNNING` / `: <n>  DISABLED` values are matched.
pub fn parse_service(query: &str, qc: &str) -> ServiceState {
    if query.contains(" 1060:") || qc.contains(" 1060:") {
        return ServiceState::Missing;
    }
    let has_value = |text: &str, value: &str| {
        text.lines().filter_map(|l| l.split_once(':')).any(|(_, v)| {
            let mut words = v.split_whitespace();
            words.next().is_some_and(|n| n.bytes().all(|b| b.is_ascii_digit()))
                && words.next() == Some(value)
        })
    };
    if has_value(query, "RUNNING") {
        return ServiceState::Running;
    }
    if has_value(qc, "DISABLED") {
        return ServiceState::Disabled;
    }
    ServiceState::Stopped
}

/// True when `ssh_command` is the Windows OpenSSH client (`System32\OpenSSH\ssh.exe`).
pub fn is_windows_openssh(ssh_command: &str) -> bool {
    let norm = ssh_command.trim().trim_matches('"').replace('\\', "/").to_ascii_lowercase();
    norm.ends_with("/system32/openssh/ssh.exe") || norm.ends_with("/system32/openssh/ssh")
}

/// Maps `ssh-add` failure output to an error.
fn classify_add(code: Option<i32>, stderr: &str) -> SshError {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("unprotected private key file") || lower.contains("bad permissions") {
        SshError::BadPermissions(stderr.to_string())
    } else if lower.contains("authentication agent")
        || lower.contains("error connecting to agent")
        || code == Some(2)
    {
        SshError::NoAgent
    } else if lower.contains("bad passphrase")
        || lower.contains("incorrect passphrase")
        || (code == Some(1) && stderr.trim().is_empty())
    {
        SshError::BadPassphrase
    } else {
        SshError::Failed(stderr.to_string())
    }
}

// ---------------------------------------------------------------------------------------------
// Process helper
// ---------------------------------------------------------------------------------------------

struct Exec {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl Exec {
    fn ok(&self) -> bool {
        self.code == Some(0)
    }
}

async fn exec<S: AsRef<OsStr>>(
    program: &Path,
    args: &[S],
    env: &[(String, String)],
    secret_env: Option<(&str, &str)>,
    timeout: Duration,
) -> Result<Exec, SshError> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env("SSH_ASKPASS_REQUIRE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for (k, v) in env {
        cmd.env(k, v);
    }
    if let Some((k, v)) = secret_env {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd
        .spawn()
        .map_err(|e| SshError::Failed(format!("cannot run {}: {e}", program.display())))?;
    let out = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| SshError::Failed(format!("{} timed out", program.display())))?
        .map_err(|e| SshError::Failed(format!("{}: {e}", program.display())))?;
    Ok(Exec {
        code: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).trim().to_string(),
    })
}

const SHORT: Duration = Duration::from_secs(15);

// ---------------------------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------------------------

async fn windows_agent_state() -> Option<ServiceState> {
    let sc = system_root().join("System32").join("sc.exe");
    let query = exec(&sc, &["query", "ssh-agent"], &[], None, SHORT).await.ok()?;
    if query.code == Some(1060) {
        return Some(ServiceState::Missing);
    }
    let qc = exec(&sc, &["qc", "ssh-agent"], &[], None, SHORT).await.ok()?;
    Some(parse_service(&query.stdout, &qc.stdout))
}

/// Parses `git config --show-scope --get core.sshCommand` output (`global<TAB>ssh -i key`).
pub fn parse_scoped_command(out: &str) -> Option<(Option<SshCommandScope>, String)> {
    let line = out.lines().next()?;
    let (scope, value) = line.split_once('\t')?;
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let scope = match scope.trim() {
        "global" => Some(SshCommandScope::Global),
        "local" | "worktree" => Some(SshCommandScope::Local),
        "system" => Some(SshCommandScope::System),
        _ => None,
    };
    Some((scope, value.to_string()))
}

/// The ssh command git would use and where it comes from. `GIT_SSH_COMMAND` beats
/// `core.sshCommand`, which beats `GIT_SSH`.
async fn effective_ssh_command(
    runner: &GitRunner,
    repo: Option<&Path>,
) -> (Option<String>, Option<SshCommandScope>) {
    let env = |name: &str| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
    if let Some(v) = env("GIT_SSH_COMMAND") {
        return (Some(v), Some(SshCommandScope::Env));
    }
    let mut args = vec!["config", "--show-scope"];
    if repo.is_none() {
        args.push("--global");
    }
    args.extend(["--get", "core.sshCommand"]);
    let cwd = repo.unwrap_or_else(|| Path::new("."));
    if let Ok(out) = runner.run(cwd, &args, RunOpts::with_timeout(SHORT)).await
        && let Some((scope, value)) = parse_scoped_command(&out.stdout_str())
    {
        return (Some(value), scope);
    }
    match env("GIT_SSH") {
        Some(v) => (Some(v), Some(SshCommandScope::Env)),
        None => (None, None),
    }
}

/// Diagnoses the SSH setup with the system tools and the user's home directory.
pub async fn ssh_report(runner: &GitRunner, repo: Option<&Path>) -> Result<SshReport, SshError> {
    let home =
        home_dir().ok_or_else(|| SshError::Failed("cannot find the home directory".into()))?;
    ssh_report_with(&Tools::system(), &home, runner, repo).await
}

/// `(encrypted, bad_permissions)` from the failure message of `ssh-keygen -y -P ""`.
fn classify_probe(stderr: &str) -> (bool, bool) {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("unprotected private key file") || lower.contains("bad permissions") {
        (false, true)
    } else {
        // "incorrect passphrase supplied", "passphrase is too short", or anything unexpected.
        (true, false)
    }
}

/// Files in `~/.ssh` that are never private keys.
fn is_key_candidate(name: &str) -> bool {
    !(name.to_ascii_lowercase().ends_with(".pub")
        || name.starts_with("known_hosts")
        || name.starts_with("authorized_keys")
        || name == "config")
}

/// [`ssh_report`] with explicit tools and home (tests).
pub async fn ssh_report_with(
    tools: &Tools,
    home: &Path,
    runner: &GitRunner,
    repo: Option<&Path>,
) -> Result<SshReport, SshError> {
    let windows = cfg!(windows);
    let (ssh_command, ssh_command_scope) = effective_ssh_command(runner, repo).await;
    let uses_windows_openssh = windows && ssh_command.as_deref().is_some_and(is_windows_openssh);
    let windows_ssh_command = windows.then(windows_openssh_command);
    let windows_agent = if windows { windows_agent_state().await } else { None };
    let mut tools_error: Option<String> = None;

    let listed = exec(&tools.ssh_add, &["-l", "-E", "sha256"], &tools.env, None, SHORT).await;
    let (agent, loaded) = match listed {
        Ok(e) if e.ok() => {
            let lines = parse_agent_list(&e.stdout);
            let n = u32::try_from(lines.len()).unwrap_or(u32::MAX);
            (AgentState::Ready { keys: n }, lines)
        }
        Ok(e) if e.code == Some(1) => (AgentState::Ready { keys: 0 }, Vec::new()),
        Ok(_) => (AgentState::Unreachable, Vec::new()),
        Err(e) => {
            tools_error = Some(e.to_string());
            (AgentState::Unreachable, Vec::new())
        }
    };
    let loaded: HashSet<String> = loaded.into_iter().map(|l| l.fingerprint).collect();

    let mut keys = Vec::new();
    if let Ok(rd) = std::fs::read_dir(home.join(".ssh")) {
        let mut paths: Vec<PathBuf> = rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name().is_some_and(|n| is_key_candidate(&n.to_string_lossy()))
                    && p.is_file()
                    && pub_path(p).is_file()
            })
            .collect();
        paths.sort();
        for key in paths {
            let pubfile = pub_path(&key);
            let argv: [&OsStr; 5] =
                ["-l".as_ref(), "-E".as_ref(), "sha256".as_ref(), "-f".as_ref(), pubfile.as_ref()];
            let info = match exec(&tools.ssh_keygen, &argv, &tools.env, None, SHORT).await {
                Ok(i) => i,
                Err(e) => {
                    tools_error = Some(e.to_string());
                    break;
                }
            };
            let line = if info.ok() { info.stdout.lines().find_map(parse_key_line) } else { None };
            let Some(line) = line else { continue };
            let probe: [&OsStr; 5] =
                ["-y".as_ref(), "-P".as_ref(), "".as_ref(), "-f".as_ref(), key.as_os_str()];
            let (encrypted, bad_permissions) =
                match exec(&tools.ssh_keygen, &probe, &tools.env, None, SHORT).await {
                    Ok(e) if e.ok() => (false, false),
                    Ok(e) => classify_probe(&e.stderr),
                    Err(e) => {
                        tools_error = Some(e.to_string());
                        break;
                    }
                };
            keys.push(SshKey {
                path: key.to_string_lossy().into_owned(),
                kind: line.kind,
                loaded: loaded.contains(&line.fingerprint),
                fingerprint: line.fingerprint,
                comment: line.comment,
                encrypted,
                bad_permissions,
            });
        }
    }
    Ok(SshReport {
        windows,
        ssh_command,
        ssh_command_scope,
        uses_windows_openssh,
        windows_ssh_command,
        tools_error,
        windows_agent,
        agent,
        keys,
    })
}

fn pub_path(key: &Path) -> PathBuf {
    let mut s = key.as_os_str().to_owned();
    s.push(".pub");
    PathBuf::from(s)
}

/// Exit code of [`ENABLE_AGENT_SCRIPT`] when the user declines UAC (Win32 `ERROR_CANCELLED`). The
/// error text is localized, so the script maps the `Win32Exception` code instead.
const UAC_CANCELLED: i32 = 1223;

/// Fixed elevation script (no user input). The elevated child is started by absolute path.
const ENABLE_AGENT_SCRIPT: &str = "$ErrorActionPreference='Stop'; \
    try { \
    $ps = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'; \
    $p = Start-Process -FilePath $ps -Verb RunAs -Wait -PassThru -WindowStyle Hidden \
    -ArgumentList '-NoProfile','-Command','Set-Service ssh-agent -StartupType Automatic; \
    Start-Service ssh-agent'; exit $p.ExitCode \
    } catch { \
    $w = $_.Exception; \
    while ($w -and -not ($w -is [ComponentModel.Win32Exception])) { $w = $w.InnerException }; \
    if ($w -and $w.NativeErrorCode -eq 1223) { exit 1223 }; \
    [Console]::Error.WriteLine($_.Exception.Message); exit 1 \
    }";

/// Windows only: sets the `ssh-agent` service to Automatic and starts it, behind a UAC prompt.
///
/// The PowerShell command is a fixed string with no user input. Declining UAC gives
/// [`SshError::Cancelled`]. Not available elsewhere.
pub async fn enable_windows_agent() -> Result<(), SshError> {
    if !cfg!(windows) {
        return Err(SshError::Failed(
            "the Windows ssh-agent service only exists on Windows".into(),
        ));
    }
    let ps = system_root()
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    let args = ["-NoProfile", "-NonInteractive", "-Command", ENABLE_AGENT_SCRIPT];
    let e = exec(&ps, &args, &[], None, Duration::from_secs(120)).await?;
    if e.ok() {
        return Ok(());
    }
    let lower = e.stderr.to_ascii_lowercase();
    if e.code == Some(UAC_CANCELLED)
        || lower.contains("canceled by the user")
        || lower.contains("cancelled by the user")
    {
        Err(SshError::Cancelled)
    } else if e.stderr.is_empty() {
        let code = e.code.map_or_else(|| "unknown".to_string(), |c| c.to_string());
        Err(SshError::Failed(format!("the elevated command exited with code {code}")))
    } else {
        Err(SshError::Failed(e.stderr))
    }
}

/// Windows only: `git config --global core.sshCommand <System32>/OpenSSH/ssh.exe`.
pub async fn use_windows_openssh(runner: &GitRunner) -> Result<(), SshError> {
    if !cfg!(windows) {
        return Err(SshError::Failed("Windows OpenSSH only exists on Windows".into()));
    }
    let value = windows_openssh_command();
    let args = ["config", "--global", "core.sshCommand", value.as_str()];
    runner.run(Path::new("."), &args, RunOpts::with_timeout(SHORT)).await?;
    Ok(())
}

/// Loads `key_path` into the agent with `ssh-add`, answering its passphrase prompt through
/// `askpass_exe` (the GitBranch exe in `GITBRANCH_ASKPASS=ssh-add` mode, or a test script).
pub async fn add_key(
    key_path: &Path,
    passphrase: Option<&str>,
    askpass_exe: &Path,
) -> Result<(), SshError> {
    add_key_with(&Tools::system(), key_path, passphrase, askpass_exe).await
}

/// [`add_key`] with explicit tools (tests).
pub async fn add_key_with(
    tools: &Tools,
    key_path: &Path,
    passphrase: Option<&str>,
    askpass_exe: &Path,
) -> Result<(), SshError> {
    let mut env = tools.env.clone();
    env.push(("SSH_ASKPASS".into(), askpass_exe.to_string_lossy().into_owned()));
    env.push(("SSH_ASKPASS_REQUIRE".into(), "force".into()));
    env.push(("GITBRANCH_ASKPASS".into(), "ssh-add".into()));
    // Old ssh only uses SSH_ASKPASS when it thinks a display exists (not a Windows concern).
    if !cfg!(windows) && std::env::var_os("DISPLAY").is_none() {
        env.push(("DISPLAY".into(), ":0".into()));
    }
    let secret = passphrase.map(|p| ("GITBRANCH_SSH_PASSPHRASE", p));
    let args: [&OsStr; 2] = ["--".as_ref(), key_path.as_os_str()];
    let e = exec(&tools.ssh_add, &args, &env, secret, Duration::from_secs(30)).await?;
    tracing::debug!(target: "ssh", code = ?e.code, "ssh-add finished");
    if e.ok() { Ok(()) } else { Err(classify_add(e.code, &e.stderr)) }
}

/// `git ls-remote <remote> HEAD` through the normal runner: the same ssh path git really uses.
pub async fn test_remote(runner: &GitRunner, repo: &Path, remote: &str) -> Result<(), GitError> {
    if remote.is_empty() {
        return Err(GitError {
            kind: GitErrorKind::NotFound,
            stderr: "empty remote".into(),
            args: Vec::new(),
        });
    }
    let args = ["ls-remote", "--", remote, "HEAD"];
    runner.run(repo, &args, RunOpts::network(Duration::from_secs(30))).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_key_lines() {
        let l = parse_key_line("256 SHA256:AbC+/x me@host with space (ED25519)").expect("line");
        assert_eq!(l.kind, "ED25519");
        assert_eq!(l.fingerprint, "SHA256:AbC+/x");
        assert_eq!(l.comment, "me@host with space");
        let l = parse_key_line("3072 SHA256:zzz  (RSA)\r").expect("line");
        assert_eq!((l.kind.as_str(), l.comment.as_str()), ("RSA", ""));
        assert!(parse_key_line("The agent has no identities.").is_none());
        assert!(parse_key_line("").is_none());
    }

    #[test]
    fn parses_agent_list_lines() {
        let out = "256 SHA256:aaa a@b (ED25519)\n3072 SHA256:bbb c@d (RSA)\n";
        let v = parse_agent_list(out);
        assert_eq!(v.len(), 2);
        assert_eq!(v[1].fingerprint, "SHA256:bbb");
        assert_eq!(
            parse_agent_list(
                "The agent has no identities.
"
            )
            .len(),
            0
        );
    }

    #[test]
    fn parses_service_states() {
        let run = "SERVICE_NAME: ssh-agent\n        TYPE               : 10  WIN32_OWN_PROCESS\n        STATE              : 4  RUNNING\n";
        let stop = "        STATE              : 1  STOPPED\n";
        let disabled = "        START_TYPE         : 4   DISABLED\n";
        let demand = "        START_TYPE         : 3   DEMAND_START\n";
        assert_eq!(parse_service(run, demand), ServiceState::Running);
        assert_eq!(parse_service(stop, demand), ServiceState::Stopped);
        assert_eq!(parse_service(stop, disabled), ServiceState::Disabled);
        let missing = "[SC] EnumQueryServicesStatus:OpenService FAILED 1060:\n\nThe specified service does not exist as an installed service.\n";
        assert_eq!(parse_service(missing, missing), ServiceState::Missing);
        // Spanish Windows: localized labels, English values.
        let es_query = "NOMBRE_DE_SERVICIO: ssh-agent\n        TIPO                         : 10  WIN32_OWN_PROCESS\n        ESTADO                       : 1  STOPPED\n        CODIGO_DE_SALIDA_DE_WIN32    : 1077  (0x435)\n";
        let es_qc = "NOMBRE_SERVICIO: ssh-agent\n        TIPO               : 10  WIN32_OWN_PROCESS\n        TIPO_INICIO        : 4   DISABLED\n";
        assert_eq!(parse_service(es_query, es_qc), ServiceState::Disabled);
        let es_run = "        ESTADO                       : 4  RUNNING\n";
        assert_eq!(parse_service(es_run, es_qc), ServiceState::Running);
        let es_missing = "[SC] OpenService ERROR 1060:\n\nEl servicio especificado no existe.\n";
        assert_eq!(parse_service(es_missing, es_missing), ServiceState::Missing);
    }

    #[test]
    fn detects_windows_openssh_command() {
        assert!(is_windows_openssh("C:/Windows/System32/OpenSSH/ssh.exe"));
        assert!(is_windows_openssh("\"c:\\WINDOWS\\system32\\openssh\\SSH.EXE\""));
        assert!(!is_windows_openssh("ssh"));
        assert!(!is_windows_openssh("C:/Program Files/Git/usr/bin/ssh.exe"));
    }

    #[test]
    fn classifies_add_failures() {
        assert!(matches!(classify_add(Some(1), ""), SshError::BadPassphrase));
        assert!(matches!(
            classify_add(Some(1), "Bad passphrase, try again"),
            SshError::BadPassphrase
        ));
        assert!(matches!(
            classify_add(Some(2), "Could not open a connection to your authentication agent."),
            SshError::NoAgent
        ));
        assert!(matches!(classify_add(Some(1), "Error connecting to agent: x"), SshError::NoAgent));
        assert!(matches!(
            classify_add(Some(1), "@@@ UNPROTECTED PRIVATE KEY FILE! @@@"),
            SshError::BadPermissions(_)
        ));
        assert!(matches!(classify_add(Some(1), "boom"), SshError::Failed(_)));
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(SshError::BadPassphrase.code(), "ssh.bad_passphrase");
        assert_eq!(SshError::NoAgent.code(), "ssh.no_agent");
        assert_eq!(SshError::BadPermissions(String::new()).code(), "ssh.bad_permissions");
        assert_eq!(SshError::Cancelled.code(), "ssh.cancelled");
        assert_eq!(SshError::Failed(String::new()).code(), "ssh.failed");
    }

    #[test]
    fn parses_scoped_ssh_command() {
        let (scope, v) = parse_scoped_command(
            "global	ssh -i ~/.ssh/k
",
        )
        .expect("parsed");
        assert_eq!(scope, Some(SshCommandScope::Global));
        assert_eq!(v, "ssh -i ~/.ssh/k");
        assert_eq!(parse_scoped_command("worktree	x").expect("p").0, Some(SshCommandScope::Local));
        assert_eq!(parse_scoped_command("system	x").expect("p").0, Some(SshCommandScope::System));
        assert_eq!(parse_scoped_command("command	x").expect("p").0, None);
        assert!(parse_scoped_command("").is_none());
        assert!(
            parse_scoped_command(
                "global	 
"
            )
            .is_none()
        );
    }

    #[test]
    fn classifies_probe_failures() {
        assert_eq!(classify_probe("Load key \"k\": incorrect passphrase supplied"), (true, false));
        assert_eq!(classify_probe("@@@ UNPROTECTED PRIVATE KEY FILE! @@@"), (false, true));
        assert_eq!(
            classify_probe(
                "Permissions 0644 for 'k' are too open.
Bad permissions."
            ),
            (false, true)
        );
        assert_eq!(classify_probe("something odd"), (true, false));
    }

    #[test]
    fn key_candidates_skip_known_non_keys() {
        for n in ["id_ed25519", "work_key", "github"] {
            assert!(is_key_candidate(n), "{n}");
        }
        for n in [
            "id.pub",
            "known_hosts",
            "known_hosts.old",
            "config",
            "authorized_keys",
            "authorized_keys2",
        ] {
            assert!(!is_key_candidate(n), "{n}");
        }
    }

    #[test]
    fn windows_openssh_command_uses_forward_slashes() {
        let c = windows_openssh_command();
        assert!(!c.contains('\\') && c.ends_with("/System32/OpenSSH/ssh.exe"), "{c}");
    }
}
