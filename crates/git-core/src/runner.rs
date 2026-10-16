//! Spawning `git` with a fixed environment, an optional timeout and typed errors.
//!
//! Every git invocation in GitBranch goes through [`GitRunner::run`]. The runner never uses a
//! shell, forces machine-readable, prompt-free behaviour through the environment, and classifies
//! failures into [`GitErrorKind`] so the UI can react (for example open the login dialog on
//! [`GitErrorKind::AuthRequired`]).

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

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
    /// The git executable could not be started at all (or is too old).
    Spawn,
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
            GitErrorKind::Spawn => "git.spawn",
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
            GitErrorKind::Spawn => "could not start git".to_string(),
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
        } else if has(NOT_FOUND) {
            GitErrorKind::NotFound
        } else {
            GitErrorKind::ExitCode(status)
        }
    }
}

/// Replaces the user-info part of every `scheme://user:secret@host` in `text` with `***`.
///
/// Remote URLs may carry tokens; they must never reach logs or the UI.
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
    /// Wall-clock limit. `None` (the default) means no limit: killing a *local write* midway can
    /// leave `.git/index.lock` behind, so timeouts are for network and read-only calls, and the
    /// UI cancels anything else by dropping the future (which kills the child).
    pub timeout: Option<Duration>,
    /// Bytes written to git's stdin (then closed). `None` connects stdin to the null device.
    pub stdin: Option<Vec<u8>>,
    /// Extra environment variables for this call only (e.g. `GIT_SEQUENCE_EDITOR`). Applied
    /// after the fixed environment, so they can override it.
    pub env: Vec<(String, String)>,
}

impl RunOpts {
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
        let argv: Vec<String> =
            args.iter().map(|a| redact_credentials(&a.as_ref().to_string_lossy())).collect();
        let mut cmd = self.command(cwd);
        cmd.args(args);
        for (k, v) in &opts.env {
            cmd.env(k, v);
        }
        cmd.stdin(if opts.stdin.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        tracing::debug!(target: "git", cwd = %cwd.display(), args = ?argv, "spawn");

        let mut child = cmd.spawn().map_err(|e| GitError {
            kind: GitErrorKind::Spawn,
            stderr: format!("{}: {e}", self.git_path.display()),
            args: argv.clone(),
        })?;

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

        if output.status.success() {
            return Ok(GitOutput { stdout: output.stdout, stderr: output.stderr });
        }
        let status = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = redact_credentials(String::from_utf8_lossy(&output.stderr).trim());
        tracing::debug!(target: "git", status, args = ?argv, "failed");
        let kind = GitError::classify(status, &stdout, &stderr);
        Err(GitError { kind, stderr, args: argv })
    }

    /// Builds the base command: executable, cwd, fixed environment, `-c core.quotepath=false`.
    pub(crate) fn command(&self, cwd: &Path) -> Command {
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
        if let Some(p) = &self.askpass {
            cmd.env("GIT_ASKPASS", p);
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
    }

    #[test]
    fn scrubs_inherited_repo_env() {
        let cmd = GitRunner::new("git").command(Path::new("."));
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
        let with = GitRunner::new("git").with_askpass(Some(PathBuf::from("askpass.exe")));
        let cmd = with.command(Path::new("."));
        assert!(
            cmd.as_std().get_envs().any(|(k, v)| k.to_str() == Some("GIT_ASKPASS") && v.is_some())
        );
        let without = GitRunner::new("git").command(Path::new("."));
        assert!(
            without
                .as_std()
                .get_envs()
                .any(|(k, v)| k.to_str() == Some("GIT_ASKPASS") && v.is_none())
        );
    }
}
