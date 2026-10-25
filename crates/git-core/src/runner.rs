//! Spawning `git` with a fixed environment, an optional timeout and typed errors.
//!
//! Every git invocation in GitBranch goes through [`GitRunner::run`]. The runner never uses a
//! shell, forces machine-readable, prompt-free behaviour through the environment, and classifies
//! failures into [`GitErrorKind`] so the UI can react (for example open the login dialog on
//! [`GitErrorKind::AuthRequired`]).

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio_util::sync::CancellationToken;

/// Minimum supported git version (worktree + `GIT_OPTIONAL_LOCKS`).
pub const MIN_GIT_VERSION: GitVersion = GitVersion { major: 2, minor: 31, patch: 0 };

/// Environment variables that must never leak from the process GitBranch was started in (a hook,
/// a worktree shell, `git rebase -x`) into the git processes it spawns.
pub(crate) const SCRUB_ENV: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_PREFIX",
    "GIT_CEILING_DIRECTORIES",
    "GIT_ASKPASS",
    "GITBRANCH_ASKPASS",
];

/// Why a git invocation failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitErrorKind {
    /// git ran and exited with a non-zero status that matched no known pattern.
    ExitCode(i32),
    /// git did not finish within the timeout and was killed.
    Timeout,
    /// The directory is not inside a git repository.
    NotARepo,
    /// A merge/rebase/cherry-pick/stash operation stopped on conflicts.
    Conflict,
    /// The remote asked for credentials and none were available.
    AuthRequired,
    /// A revision, ref, path or remote object does not exist.
    NotFound,
    /// The remote rejected a ref update (non-fast-forward, stale lease, hook).
    Rejected,
    /// The git executable could not be started at all (or is too old).
    Spawn,
    /// The caller cancelled the operation; the process tree was killed.
    Cancelled,
}

/// A failed git invocation. `stderr` and `args` are already lossily decoded and have any
/// `scheme://user:password@host` credentials redacted.
#[derive(Debug, Clone, thiserror::Error)]
#[error("{}", self.message())]
pub struct GitError {
    /// Classification used by the UI.
    pub kind: GitErrorKind,
    /// Captured stderr, trimmed, credentials redacted.
    pub stderr: String,
    /// The argv that failed (without the executable), credentials redacted.
    pub args: Vec<String>,
}

impl GitError {
    /// Stable machine-readable code for the IPC `AppError.code`.
    pub fn code(&self) -> &'static str {
        match self.kind {
            GitErrorKind::ExitCode(_) => "git.exit",
            GitErrorKind::Timeout => "git.timeout",
            GitErrorKind::NotARepo => "git.not_a_repo",
            GitErrorKind::Conflict => "git.conflict",
            GitErrorKind::AuthRequired => "git.auth_required",
            GitErrorKind::NotFound => "git.not_found",
            GitErrorKind::Rejected => "git.rejected",
            GitErrorKind::Spawn => "git.spawn",
            GitErrorKind::Cancelled => "git.cancelled",
        }
    }

    fn message(&self) -> String {
        let cmd = self.args.first().map_or("git", String::as_str);
        match &self.kind {
            GitErrorKind::ExitCode(code) => format!("git {cmd} failed with exit code {code}"),
            GitErrorKind::Timeout => format!("git {cmd} timed out"),
            GitErrorKind::NotARepo => "not a git repository".to_string(),
            GitErrorKind::Conflict => format!("git {cmd} stopped with conflicts"),
            GitErrorKind::AuthRequired => "authentication required".to_string(),
            GitErrorKind::NotFound => format!("git {cmd}: not found"),
            GitErrorKind::Rejected => format!("git {cmd}: the remote rejected the update"),
            GitErrorKind::Spawn => "could not start git".to_string(),
            GitErrorKind::Cancelled => "Cancelled".to_string(),
        }
    }

    /// Maps a non-zero exit to a [`GitErrorKind`] from well-known phrases.
    ///
    /// Conflicts are reported by `git merge`/`rebase` on *stdout*; everything else is matched
    /// only on stderr lines that git itself emits (`fatal:` / `error:` / `remote:`), so hook
    /// output such as "command not found" cannot be misclassified.
    fn classify(status: i32, stdout: &str, stderr: &str) -> GitErrorKind {
        const CONFLICT: &[&str] =
            &["CONFLICT (", "Automatic merge failed", "could not apply", "needs merge"];
        const NOT_A_REPO: &[&str] = &["not a git repository"];
        const AUTH: &[&str] = &[
            "Authentication failed",
            "could not read Username",
            "could not read Password",
            "terminal prompts disabled",
            "Permission denied (publickey",
            "Invalid username or password",
            "authentication required",
        ];
        const NOT_FOUND: &[&str] = &[
            "unknown revision",
            "did not match any",
            "does not exist",
            "ot a valid object name",
            "bad revision",
            "no such ref",
            "Repository not found",
            "o such remote",
            "pathspec",
            "Needed a single revision",
        ];
        let rejected = stderr.lines().any(|l| {
            let l = l.trim_start_matches("remote:").trim_start();
            l.starts_with("! [rejected]") || l.starts_with("! [remote rejected]")
        }) || stdout.lines().any(|l| l.starts_with("!\t"));
        let git_lines = || {
            stderr.lines().map(str::trim_start).filter(|l| {
                l.starts_with("fatal:") || l.starts_with("error:") || l.starts_with("remote:")
            })
        };
        let has = |needles: &[&str]| git_lines().any(|l| needles.iter().any(|n| l.contains(n)));
        let conflict =
            stdout.lines().chain(stderr.lines()).any(|l| CONFLICT.iter().any(|n| l.contains(n)));
        if has(NOT_A_REPO) {
            GitErrorKind::NotARepo
        } else if conflict {
            GitErrorKind::Conflict
        } else if has(AUTH) {
            GitErrorKind::AuthRequired
        } else if rejected {
            GitErrorKind::Rejected
        } else if has(NOT_FOUND) {
            GitErrorKind::NotFound
        } else {
            GitErrorKind::ExitCode(status)
        }
    }
}

/// Replaces the user-info part of every `scheme://user:secret@host` in `text` with `***`.
///
/// Remote URLs may carry tokens (also in the user position, e.g. `https://ghp_x@host`); they must
/// never reach logs or the UI. The bare user `git` (SSH convention, `ssh://git@host/...`) is kept:
/// it is never a secret, and the UI shows and copies these URLs.
pub fn redact_credentials(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("://") {
        let (head, tail) = rest.split_at(i + 3);
        out.push_str(head);
        // user-info ends at the first '@' that comes before any '/', whitespace or quote.
        let end = tail.find(|c: char| c == '/' || c.is_whitespace() || c == '"' || c == '\'');
        let authority = &tail[..end.unwrap_or(tail.len())];
        match authority.rfind('@') {
            Some(at) if &authority[..at] == "git" => {
                out.push_str("git");
                rest = &tail[at..];
            }
            Some(at) => {
                out.push_str("***");
                rest = &tail[at..];
            }
            None => rest = tail,
        }
    }
    out.push_str(rest);
    out
}

/// Captured result of a successful (zero exit status) git invocation.
#[derive(Debug, Clone, Default)]
pub struct GitOutput {
    /// Raw stdout bytes; parsers work on bytes because paths are not guaranteed UTF-8.
    pub stdout: Vec<u8>,
    /// Raw stderr bytes (warnings, progress).
    pub stderr: Vec<u8>,
}

impl GitOutput {
    /// stdout as a lossily decoded, right-trimmed string.
    pub fn stdout_str(&self) -> String {
        String::from_utf8_lossy(&self.stdout).trim_end().to_string()
    }

    /// stderr as a lossily decoded, trimmed string.
    pub fn stderr_str(&self) -> String {
        String::from_utf8_lossy(&self.stderr).trim().to_string()
    }
}

/// Per-invocation options.
#[derive(Debug, Clone, Default)]
pub struct RunOpts {
    /// Wall-clock limit for [`GitRunner::run`]; in [`GitRunner::run_streaming`] it is an
    /// *inactivity* limit that restarts whenever git writes to stdout or stderr, so a long
    /// transfer that keeps reporting progress is not killed. `None` (the default) means no limit: killing a *local write* midway can
    /// leave `.git/index.lock` behind, so timeouts are for network and read-only calls, and the
    /// UI cancels anything else by dropping the future (which kills the child).
    pub timeout: Option<Duration>,
    /// Bytes written to git's stdin (then closed). `None` connects stdin to the null device.
    pub stdin: Option<Vec<u8>>,
    /// Extra environment variables for this call only (e.g. `GIT_SEQUENCE_EDITOR`). Applied
    /// after the fixed environment, so they can override it.
    pub env: Vec<(String, String)>,
    /// Expose the askpass bridge (`GIT_ASKPASS`) to this call. Only network calls set it, so hooks
    /// run by commit/merge/rebase cannot query it (D-024).
    pub askpass: bool,
}

impl RunOpts {
    /// Options for a network call: the given timeout and the askpass bridge enabled.
    pub fn network(timeout: Duration) -> Self {
        Self { timeout: Some(timeout), askpass: true, ..Self::default() }
    }

    /// Options with the given timeout.
    pub fn with_timeout(timeout: Duration) -> Self {
        Self { timeout: Some(timeout), ..Self::default() }
    }

    /// Options with the given stdin payload.
    pub fn with_stdin(stdin: impl Into<Vec<u8>>) -> Self {
        Self { stdin: Some(stdin.into()), ..Self::default() }
    }
}

/// A parsed `git --version`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct GitVersion {
    /// Major version.
    pub major: u32,
    /// Minor version.
    pub minor: u32,
    /// Patch version (0 when absent).
    pub patch: u32,
}

impl GitVersion {
    /// Parses the output of `git --version` (e.g. `git version 2.39.1.windows.1`).
    pub fn parse(text: &str) -> Option<Self> {
        let rest = text.trim().strip_prefix("git version ")?;
        let mut nums = rest.split('.').map(|p| p.parse::<u32>().ok());
        let major = nums.next()??;
        let minor = nums.next()??;
        let patch = nums.next().flatten().unwrap_or(0);
        Some(Self { major, minor, patch })
    }
}

impl std::fmt::Display for GitVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// Spawns `git` with a fixed environment. Cheap to clone; one per application is enough.
#[derive(Debug, Clone)]
pub struct GitRunner {
    git_path: PathBuf,
    askpass: Option<PathBuf>,
    env: Vec<(String, String)>,
}

impl GitRunner {
    /// A runner for the given executable (an absolute path, or just `git` resolved via `PATH`).
    pub fn new(git_path: impl Into<PathBuf>) -> Self {
        Self { git_path: git_path.into(), askpass: None, env: Vec::new() }
    }

    /// A runner for the `git` on `PATH`, or `GITBRANCH_GIT` when that variable is set.
    pub fn from_env() -> Self {
        Self::new(git_path_from_env())
    }

    /// Sets the program git should ask for credentials (`GIT_ASKPASS`). `None` leaves git's own
    /// credential helpers in charge.
    #[must_use]
    pub fn with_askpass(mut self, askpass: Option<PathBuf>) -> Self {
        self.askpass = askpass;
        self
    }

    /// Extra environment applied to every spawn (after the fixed env, before `RunOpts::env`).
    /// Used by tests to isolate git from the user's global/system config.
    #[must_use]
    pub fn with_env(mut self, env: Vec<(String, String)>) -> Self {
        self.env = env;
        self
    }

    /// Path of the git executable this runner spawns.
    pub fn git_path(&self) -> &Path {
        &self.git_path
    }

    /// Runs `git --version` and parses it.
    pub async fn version(&self) -> Result<GitVersion, GitError> {
        let opts = RunOpts::with_timeout(Duration::from_secs(10));
        let out = self.run(Path::new("."), &["--version"], opts).await?;
        let text = out.stdout_str();
        GitVersion::parse(&text).ok_or_else(|| GitError {
            kind: GitErrorKind::Spawn,
            stderr: format!("unparseable git version: {text}"),
            args: vec!["--version".into()],
        })
    }

    /// Fails with [`GitErrorKind::Spawn`] when git is missing or older than [`MIN_GIT_VERSION`].
    pub async fn check_version(&self) -> Result<GitVersion, GitError> {
        let v = self.version().await?;
        if v < MIN_GIT_VERSION {
            return Err(GitError {
                kind: GitErrorKind::Spawn,
                stderr: format!("git {v} is too old, need >= {MIN_GIT_VERSION}"),
                args: vec!["--version".into()],
            });
        }
        Ok(v)
    }

    /// Spawns git for `args`; returns the child and the credential-redacted argv.
    ///
    /// `group` puts the child in its own process group (Unix) so [`kill_tree`] can signal the
    /// whole tree; on Windows `taskkill /T` walks the tree instead.
    fn spawn<S: AsRef<OsStr>>(
        &self,
        cwd: &Path,
        args: &[S],
        opts: &RunOpts,
        group: bool,
    ) -> Result<(Child, Vec<String>), GitError> {
        let argv: Vec<String> =
            args.iter().map(|a| redact_credentials(&a.as_ref().to_string_lossy())).collect();
        let mut cmd = self.command(cwd, opts.askpass);
        cmd.args(args);
        for (k, v) in &opts.env {
            cmd.env(k, v);
        }
        cmd.stdin(if opts.stdin.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        if group {
            cmd.process_group(0);
        }
        #[cfg(not(unix))]
        let _ = group;

        tracing::debug!(target: "git", cwd = %cwd.display(), args = ?argv, "spawn");

        match cmd.spawn() {
            Ok(child) => Ok((child, argv)),
            Err(e) => Err(GitError {
                kind: GitErrorKind::Spawn,
                stderr: format!("{}: {e}", self.git_path.display()),
                args: argv,
            }),
        }
    }

    /// Turns a finished child into the result: output on success, a classified error otherwise.
    fn finish(
        status: std::process::ExitStatus,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
        argv: Vec<String>,
    ) -> Result<GitOutput, GitError> {
        if status.success() {
            return Ok(GitOutput { stdout, stderr });
        }
        let status = status.code().unwrap_or(-1);
        let out_text = String::from_utf8_lossy(&stdout);
        let err_text = redact_credentials(String::from_utf8_lossy(&stderr).trim());
        tracing::debug!(target: "git", status, args = ?argv, "failed");
        let kind = GitError::classify(status, &out_text, &err_text);
        // `git push --porcelain` reports rejected refs on stdout; keep them for the caller.
        let err_text = if kind == GitErrorKind::Rejected {
            let refs: Vec<&str> = out_text.lines().filter(|l| l.starts_with("!\t")).collect();
            redact_credentials(&format!("{}\n{err_text}", refs.join("\n"))).trim().to_string()
        } else {
            err_text
        };
        Err(GitError { kind, stderr: err_text, args: argv })
    }

    /// Runs `git <args>` with `cwd` as the working directory.
    ///
    /// Returns [`GitOutput`] on exit status 0; otherwise a [`GitError`] classified from the
    /// output. The child is killed when the timeout expires or when the returned future is
    /// dropped (cancellation).
    pub async fn run<S: AsRef<OsStr>>(
        &self,
        cwd: &Path,
        args: &[S],
        opts: RunOpts,
    ) -> Result<GitOutput, GitError> {
        let (mut child, argv) = self.spawn(cwd, args, &opts, false)?;

        // Feed stdin concurrently with draining stdout/stderr: writing first would deadlock when
        // both the input and the output exceed the pipe buffers (`cat-file --batch`, `apply`).
        let stdin = child.stdin.take();
        let feed = async move {
            if let (Some(bytes), Some(mut stdin)) = (opts.stdin, stdin) {
                // A child that exits early closes the pipe; that is not an error for us.
                let _ = stdin.write_all(&bytes).await;
                let _ = stdin.shutdown().await;
            }
        };
        let wait = async move {
            let ((), output) = tokio::join!(feed, child.wait_with_output());
            output
        };
        let output = match opts.timeout {
            None => wait.await,
            Some(limit) => match tokio::time::timeout(limit, wait).await {
                Ok(result) => result,
                Err(_elapsed) => {
                    // The child was owned by the awaited future; dropping it killed the process.
                    return Err(GitError {
                        kind: GitErrorKind::Timeout,
                        stderr: format!("no response after {limit:?}"),
                        args: argv,
                    });
                }
            },
        };
        let output = output.map_err(|e| GitError {
            kind: GitErrorKind::Spawn,
            stderr: e.to_string(),
            args: argv.clone(),
        })?;
        Self::finish(output.status, output.stdout, output.stderr, argv)
    }

    /// Like [`run`](Self::run) but reports stderr incrementally and can be cancelled.
    ///
    /// stderr is split on `\r` and `\n` (git redraws progress lines with `\r`); `sink` gets every
    /// non-empty trimmed line as it arrives. When `cancel` fires the whole process tree is killed
    /// and [`GitErrorKind::Cancelled`] is returned. `opts.stdin` must be `None`. The child is in
    /// its own process group on Unix.
    pub async fn run_streaming<S: AsRef<OsStr>>(
        &self,
        cwd: &Path,
        args: &[S],
        opts: RunOpts,
        sink: &mut (dyn FnMut(&str) + Send),
        cancel: &CancellationToken,
    ) -> Result<GitOutput, GitError> {
        if opts.stdin.is_some() {
            return Err(GitError {
                kind: GitErrorKind::Spawn,
                stderr: "stdin is not supported in streaming mode".into(),
                args: args
                    .iter()
                    .map(|a| redact_credentials(&a.as_ref().to_string_lossy()))
                    .collect(),
            });
        }
        // Inactivity clock shared by the readers and the timeout branch. Atomic (not `Cell`) so
        // the future stays `Send` for the Tauri command runtime.
        let started = Instant::now();
        let last_activity_ms = AtomicU64::new(0);
        let touch = || {
            let ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
            last_activity_ms.store(ms, Ordering::Relaxed);
        };
        let last_activity =
            || started + Duration::from_millis(last_activity_ms.load(Ordering::Relaxed));
        let (mut child, argv) = self.spawn(cwd, args, &opts, true)?;
        let (Some(mut out_pipe), Some(mut err_pipe)) = (child.stdout.take(), child.stderr.take())
        else {
            return Err(GitError {
                kind: GitErrorKind::Spawn,
                stderr: "missing child pipes".into(),
                args: argv,
            });
        };

        let read_out = async {
            let mut buf = Vec::new();
            let mut chunk = vec![0u8; 8192];
            loop {
                match out_pipe.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        touch();
                        buf.extend_from_slice(&chunk[..n]);
                    }
                }
            }
            buf
        };
        let read_err = async {
            let mut all = Vec::new();
            let mut line = Vec::new();
            let mut chunk = vec![0u8; 4096];
            loop {
                let n = match err_pipe.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                touch();
                all.extend_from_slice(&chunk[..n]);
                for &b in &chunk[..n] {
                    if b == b'\r' || b == b'\n' {
                        emit_line(&mut line, sink);
                    } else {
                        line.push(b);
                    }
                }
            }
            emit_line(&mut line, sink);
            all
        };
        let limit = opts.timeout;
        let timeout = async {
            let Some(d) = limit else { return std::future::pending().await };
            loop {
                let deadline = last_activity() + d;
                tokio::time::sleep_until(deadline.into()).await;
                if last_activity() + d <= Instant::now() {
                    break;
                }
            }
        };

        let outcome = {
            let work = async {
                let (status, out, err) = tokio::join!(child.wait(), read_out, read_err);
                Outcome::Done(status, out, err)
            };
            // Biased, work first: a cancel racing a command that already finished must not turn
            // a completed push into `Cancelled`.
            tokio::select! {
                biased;
                o = work => o,
                () = cancel.cancelled() => Outcome::Cancelled,
                () = timeout => Outcome::TimedOut,
            }
        };
        match outcome {
            Outcome::Done(status, stdout, stderr) => {
                let status = status.map_err(|e| GitError {
                    kind: GitErrorKind::Spawn,
                    stderr: e.to_string(),
                    args: argv.clone(),
                })?;
                Self::finish(status, stdout, stderr, argv)
            }
            Outcome::Cancelled => {
                kill_tree(&mut child).await;
                Err(GitError { kind: GitErrorKind::Cancelled, stderr: String::new(), args: argv })
            }
            Outcome::TimedOut => {
                kill_tree(&mut child).await;
                Err(GitError {
                    kind: GitErrorKind::Timeout,
                    stderr: format!("no output for {:?}", limit.unwrap_or_default()),
                    args: argv,
                })
            }
        }
    }
    /// Builds the base command: executable, cwd, fixed environment, `-c core.quotepath=false`.
    ///
    /// `GIT_ASKPASS`/`GITBRANCH_ASKPASS` are set only when an askpass program is configured and
    /// `askpass` is true.
    pub(crate) fn command(&self, cwd: &Path, askpass: bool) -> Command {
        let mut cmd = Command::new(&self.git_path);
        cmd.current_dir(cwd).arg("-c").arg("core.quotepath=false");
        for key in SCRUB_ENV {
            cmd.env_remove(key);
        }
        cmd.env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_PAGER", "cat")
            // `:` is git's "no editor": commit/rebase/revert never open the user's editor.
            // Callers that need an editor script set these through `RunOpts::env`.
            .env("GIT_EDITOR", ":")
            .env("GIT_SEQUENCE_EDITOR", ":")
            // ssh must not pop a passphrase/host-key prompt from a windowless process.
            .env("SSH_ASKPASS_REQUIRE", "never");
        for (k, v) in &self.env {
            cmd.env(k, v);
        }
        if let (Some(p), true) = (&self.askpass, askpass) {
            // The app binary answers git's prompts itself and recognises that mode by this flag
            // plus a prompt-shaped argument (D-024 amendment).
            cmd.env("GIT_ASKPASS", p).env("GITBRANCH_ASKPASS", "1");
        }
        #[cfg(windows)]
        {
            // tokio's Command exposes creation_flags directly (no CommandExt trait needed).
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd
    }
}

/// How a streaming run ended.
enum Outcome {
    Done(std::io::Result<std::process::ExitStatus>, Vec<u8>, Vec<u8>),
    Cancelled,
    TimedOut,
}

fn emit_line(line: &mut Vec<u8>, sink: &mut (dyn FnMut(&str) + Send)) {
    if !line.is_empty() {
        let text = String::from_utf8_lossy(line);
        let text = text.trim();
        if !text.is_empty() {
            // Servers can echo URLs with embedded credentials.
            sink(&redact_credentials(text));
        }
        line.clear();
    }
}

/// `%SystemRoot%\System32\<name>`, or the bare name when `SystemRoot` is unset.
#[cfg(windows)]
fn system_tool(name: &str) -> PathBuf {
    std::env::var_os("SystemRoot")
        .map_or_else(|| PathBuf::from(name), |r| Path::new(&r).join("System32").join(name))
}

/// Kills `child` and everything it spawned (`git-remote-https`, `ssh`, hooks).
///
/// Windows: runs `taskkill /T /F /PID <pid>`, an external tool that ships with every Windows;
/// there is no safe-Rust way to walk the tree (Job Objects need `unsafe`). Unix: the child was
/// spawned as a process-group leader, so `kill -TERM -- -<pid>` signals the whole group (also via
/// an external tool, for the same no-`unsafe` reason). Both are followed by `child.kill()`.
pub(crate) async fn kill_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let mut cmd = Command::new(system_tool("taskkill.exe"));
            cmd.args(["/T", "/F", "/PID", &pid.to_string()]).creation_flags(CREATE_NO_WINDOW);
            let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status().await;
        }
        #[cfg(unix)]
        {
            let mut cmd =
                Command::new(if Path::new("/bin/kill").exists() { "/bin/kill" } else { "kill" });
            cmd.args(["-TERM", "--", &format!("-{pid}")]);
            let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status().await;
        }
    }
    let _ = child.kill().await;
}
/// `GITBRANCH_GIT` when set and non-empty, else `git` from `PATH`.
pub(crate) fn git_path_from_env() -> PathBuf {
    std::env::var_os("GITBRANCH_GIT")
        .filter(|p| !p.is_empty())
        .map_or_else(|| PathBuf::from("git"), PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emit_line_redacts_credentials() {
        let mut got = Vec::new();
        let mut sink = |l: &str| got.push(l.to_string());
        let mut line = b"  redirect to https://u:tok@host/x.git ".to_vec();
        emit_line(&mut line, &mut sink);
        assert_eq!(got, ["redirect to https://***@host/x.git"]);
        assert_eq!(line.len(), 0);
    }

    #[test]
    fn parses_versions() {
        assert_eq!(
            GitVersion::parse("git version 2.39.1.windows.1"),
            Some(GitVersion { major: 2, minor: 39, patch: 1 })
        );
        assert_eq!(
            GitVersion::parse("git version 2.50\n"),
            Some(GitVersion { major: 2, minor: 50, patch: 0 })
        );
        assert_eq!(GitVersion::parse("nope"), None);
        assert!(GitVersion { major: 2, minor: 31, patch: 0 } >= MIN_GIT_VERSION);
        assert!(GitVersion { major: 2, minor: 30, patch: 9 } < MIN_GIT_VERSION);
    }

    #[test]
    fn classifies_output() {
        let k = |s: &str| GitError::classify(128, "", s);
        assert_eq!(
            k("fatal: not a git repository (or any of the parent directories): .git"),
            GitErrorKind::NotARepo
        );
        assert_eq!(
            k("fatal: could not read Username for 'https://github.com': terminal prompts disabled"),
            GitErrorKind::AuthRequired
        );
        assert_eq!(
            k(
                "fatal: ambiguous argument 'nope': unknown revision or path not in the working tree."
            ),
            GitErrorKind::NotFound
        );
        assert_eq!(k("error: something else"), GitErrorKind::ExitCode(128));
        // Hook chatter is not git's own diagnostics.
        assert_eq!(k("sh: eslint: command not found\n"), GitErrorKind::ExitCode(128));
        assert_eq!(k("warning: templates not found\nerror: boom"), GitErrorKind::ExitCode(128));
        assert_eq!(k(" ! [rejected]        main -> main (fetch first)"), GitErrorKind::Rejected);
        assert_eq!(
            GitError::classify(1, "!\trefs/heads/a:refs/heads/a\t[rejected] (stale info)\n", ""),
            GitErrorKind::Rejected
        );
        // Conflicts are printed on stdout.
        assert_eq!(
            GitError::classify(1, "CONFLICT (content): Merge conflict in f1.txt\n", ""),
            GitErrorKind::Conflict
        );
    }

    #[test]
    fn redacts_url_credentials() {
        assert_eq!(
            redact_credentials("fatal: unable to access 'https://user:ghp_abc@github.com/a/b/': x"),
            "fatal: unable to access 'https://***@github.com/a/b/': x"
        );
        assert_eq!(
            redact_credentials("https://x-access-token:tok@github.com/o/r.git"),
            "https://***@github.com/o/r.git"
        );
        assert_eq!(redact_credentials("https://github.com/o/r.git"), "https://github.com/o/r.git");
        assert_eq!(redact_credentials("git@github.com:o/r.git"), "git@github.com:o/r.git");
        assert_eq!(redact_credentials("a://b@c d://e"), "a://***@c d://e");
        // The SSH convention user is not a secret; a token in the user position still is.
        assert_eq!(
            redact_credentials("ssh://git@github.com/o/r.git"),
            "ssh://git@github.com/o/r.git"
        );
        assert_eq!(redact_credentials("ssh://git:pw@github.com/o/r"), "ssh://***@github.com/o/r");
        assert_eq!(
            redact_credentials("https://ghp_abc@github.com/o/r"),
            "https://***@github.com/o/r"
        );
    }

    #[test]
    fn scrubs_inherited_repo_env() {
        let cmd = GitRunner::new("git").command(Path::new("."), false);
        let envs: Vec<_> = cmd.as_std().get_envs().collect();
        for key in SCRUB_ENV {
            assert!(
                envs.iter().any(|(k, v)| k.to_str() == Some(key) && v.is_none()),
                "{key} is not removed"
            );
        }
        let value = |name: &str| {
            envs.iter().find(|(k, _)| *k == name).and_then(|(_, v)| v.and_then(|v| v.to_str()))
        };
        assert_eq!(value("GIT_EDITOR"), Some(":"));
        assert_eq!(value("GIT_SEQUENCE_EDITOR"), Some(":"));
        assert_eq!(value("GIT_TERMINAL_PROMPT"), Some("0"));
        assert_eq!(value("GIT_OPTIONAL_LOCKS"), Some("0"));
    }

    #[test]
    fn askpass_is_set_only_when_configured() {
        let env_of = |cmd: &Command, name: &str| {
            cmd.as_std()
                .get_envs()
                .find(|(k, _)| k.to_str() == Some(name))
                .map(|(_, v)| v.map(|v| v.to_string_lossy().into_owned()))
        };
        let with = GitRunner::new("git").with_askpass(Some(PathBuf::from("askpass.exe")));
        let cmd = with.command(Path::new("."), true);
        assert_eq!(env_of(&cmd, "GIT_ASKPASS"), Some(Some("askpass.exe".to_string())));
        assert_eq!(env_of(&cmd, "GITBRANCH_ASKPASS"), Some(Some("1".to_string())));
        // Configured but not a network call: removed, so hooks cannot reach it.
        let local = with.command(Path::new("."), false);
        assert_eq!(env_of(&local, "GIT_ASKPASS"), Some(None));
        assert_eq!(env_of(&local, "GITBRANCH_ASKPASS"), Some(None));
        let without = GitRunner::new("git").command(Path::new("."), true);
        // `Some(None)` means "removed from the inherited environment".
        assert_eq!(env_of(&without, "GIT_ASKPASS"), Some(None));
        assert_eq!(env_of(&without, "GITBRANCH_ASKPASS"), Some(None));
    }
}
