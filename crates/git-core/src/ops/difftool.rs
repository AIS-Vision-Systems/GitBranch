//! Opens a file diff in the user's external diff tool.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// The well-known empty tree, the "parent" of a root commit.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// How long we wait for the tool before assuming it is a long-running GUI and detaching.
const EARLY_EXIT_WAIT: Duration = Duration::from_millis(1500);

/// Error from [`open_difftool`].
#[derive(Debug, Clone, thiserror::Error)]
pub enum DifftoolError {
    /// The revision is empty or could be parsed as an option.
    #[error("invalid revision: {0}")]
    InvalidRevision(String),
    /// The tool command is blank.
    #[error("no diff tool configured")]
    NoTool,
    /// git (or the tool) failed.
    #[error(transparent)]
    Git(#[from] GitError),
}

/// Runs `git difftool` for one file with `tool_cmd` as the tool (a shell snippet using `$LOCAL` and
/// `$REMOTE`, as in `difftool.<name>.cmd`).
///
/// With `staged` the index is compared with `HEAD`; else with `rev` when given (the commit against
/// its first parent); else the work tree with the index. Returns once the tool has been started: if it exits within a short time its
/// result is reported (so a missing tool is an error), otherwise it is left running detached.
///
/// # Errors
/// [`DifftoolError::InvalidRevision`], [`DifftoolError::NoTool`], or [`DifftoolError::Git`] when
/// git cannot start or the tool exits non-zero quickly.
pub async fn open_difftool(
    runner: &GitRunner,
    repo: &Path,
    path: &str,
    staged: bool,
    rev: Option<&str>,
    tool_cmd: &str,
) -> Result<(), DifftoolError> {
    if tool_cmd.trim().is_empty() {
        return Err(DifftoolError::NoTool);
    }
    if let Some(rev) = rev.filter(|r| !crate::refname::is_safe_revision(r)) {
        return Err(DifftoolError::InvalidRevision(rev.to_string()));
    }
    let cfg = format!("difftool.gbtool.cmd={tool_cmd}");
    let mut args: Vec<&str> =
        vec!["-c", &cfg, "difftool", "--no-prompt", "--tool=gbtool", "--no-symlinks"];
    // A commit is compared with its first parent (the empty tree for a root commit).
    let parent = rev.map(|r| format!("{r}^"));
    let base: &str = match (&parent, rev) {
        (Some(p), Some(_))
            if runner
                .run(repo, &["rev-parse", "--verify", "--quiet", p], RunOpts::default())
                .await
                .is_ok() =>
        {
            p
        }
        _ => EMPTY_TREE,
    };
    if staged {
        args.push("--cached");
    } else if let Some(rev) = rev {
        args.extend([base, rev]);
    }
    args.extend(["--", path]);

    let mut cmd = runner.command(repo, false);
    cmd.args(&args)
        .env("GIT_LITERAL_PATHSPECS", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let err = |kind: GitErrorKind, stderr: String| GitError {
        kind,
        stderr,
        args: args.iter().map(ToString::to_string).collect(),
    };
    let mut child = cmd.spawn().map_err(|e| err(GitErrorKind::Spawn, e.to_string()))?;
    let mut stderr = child.stderr.take();
    match tokio::time::timeout(EARLY_EXIT_WAIT, child.wait()).await {
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(Ok(status)) => {
            let mut buf = Vec::new();
            if let Some(s) = stderr.as_mut() {
                let _ = tokio::io::AsyncReadExt::read_to_end(s, &mut buf).await;
            }
            let text = String::from_utf8_lossy(&buf).trim().to_string();
            Err(err(GitErrorKind::ExitCode(status.code().unwrap_or(-1)), text).into())
        }
        Ok(Err(e)) => Err(err(GitErrorKind::Spawn, e.to_string()).into()),
        Err(_) => {
            // Still running: a GUI tool. Reap it in the background and drain stderr so it
            // never blocks on a full pipe.
            tokio::spawn(async move {
                if let Some(mut s) = stderr {
                    let _ = tokio::io::copy(&mut s, &mut tokio::io::sink()).await;
                }
                let _ = child.wait().await;
            });
            Ok(())
        }
    }
}
