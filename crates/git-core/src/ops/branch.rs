//! Branch operations: create, checkout, rename, delete, upstream.
//!
//! Callers (the Tauri commands) must reject names starting with `-`; where git accepts `--` the
//! name is placed after it as a second line of defence.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// A branch that was deleted, with the commit it pointed to (for undo).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedBranch {
    /// Short branch name.
    pub name: String,
    /// Full oid of the tip before deletion.
    pub tip: String,
}

async fn ref_exists(runner: &GitRunner, repo: &Path, full: &str) -> Result<bool, GitError> {
    let args = ["rev-parse", "--verify", "--quiet", full];
    match runner.run(repo, &args, RunOpts::default()).await {
        Ok(_) => Ok(true),
        Err(e) if e.kind == GitErrorKind::ExitCode(1) => Ok(false),
        Err(e) => Err(e),
    }
}

/// Creates branch `name` at `start_point`; with `checkout` also switches to it.
///
/// # Errors
/// [`GitError`] if the name is invalid/taken or the start point does not exist.
pub async fn create_branch(
    runner: &GitRunner,
    repo: &Path,
    name: &str,
    start_point: &str,
    checkout: bool,
) -> Result<(), GitError> {
    if checkout {
        runner.run(repo, &["switch", "-c", name, start_point], RunOpts::default()).await?;
    } else {
        runner.run(repo, &["branch", "--", name, start_point], RunOpts::default()).await?;
    }
    Ok(())
}

/// Switches to `target`, or detaches HEAD at it when `detach`.
///
/// A remote-tracking name such as `origin/feat` creates a tracking local branch `feat` when none
/// exists, otherwise switches to the existing local branch.
///
/// # Errors
/// [`GitError`] if the target does not exist or the switch would overwrite local changes.
pub async fn checkout(
    runner: &GitRunner,
    repo: &Path,
    target: &str,
    detach: bool,
) -> Result<(), GitError> {
    if detach {
        runner.run(repo, &["switch", "--detach", target], RunOpts::default()).await?;
        return Ok(());
    }
    if !ref_exists(runner, repo, &format!("refs/heads/{target}")).await?
        && ref_exists(runner, repo, &format!("refs/remotes/{target}")).await?
    {
        if let Some((_, local)) = target.split_once('/') {
            if ref_exists(runner, repo, &format!("refs/heads/{local}")).await? {
                runner.run(repo, &["switch", local], RunOpts::default()).await?;
            } else {
                let args = ["switch", "--track", "-c", local, target];
                runner.run(repo, &args, RunOpts::default()).await?;
            }
            return Ok(());
        }
    }
    runner.run(repo, &["switch", target], RunOpts::default()).await?;
    Ok(())
}

/// Renames local branch `old` to `new`.
///
/// # Errors
/// [`GitError`] if `old` is missing or `new` is invalid/taken.
pub async fn rename_branch(
    runner: &GitRunner,
    repo: &Path,
    old: &str,
    new: &str,
) -> Result<(), GitError> {
    runner.run(repo, &["branch", "-m", "--", old, new], RunOpts::default()).await?;
    Ok(())
}

/// Deletes local branch `name` (`-D` when `force`) and returns its former tip.
///
/// A safe delete of an unmerged branch fails with `ExitCode(1)` and "not fully merged" in stderr.
///
/// # Errors
/// [`GitError`] if the branch is missing, checked out, or (without `force`) not fully merged.
pub async fn delete_branch(
    runner: &GitRunner,
    repo: &Path,
    name: &str,
    force: bool,
) -> Result<DeletedBranch, GitError> {
    let full = format!("refs/heads/{name}");
    let out = runner.run(repo, &["rev-parse", "--verify", &full], RunOpts::default()).await?;
    let tip = out.stdout_str().trim().to_string();
    let flag = if force { "-D" } else { "-d" };
    runner.run(repo, &["branch", flag, "--", name], RunOpts::default()).await?;
    Ok(DeletedBranch { name: name.to_string(), tip })
}

/// Sets (`Some`) or removes (`None`) the upstream of `branch`.
///
/// # Errors
/// [`GitError`] if the branch or upstream does not exist.
pub async fn set_upstream(
    runner: &GitRunner,
    repo: &Path,
    branch: &str,
    upstream: Option<&str>,
) -> Result<(), GitError> {
    if let Some(up) = upstream {
        let flag = format!("--set-upstream-to={up}");
        runner.run(repo, &["branch", &flag, "--", branch], RunOpts::default()).await?;
    } else {
        let args = ["branch", "--unset-upstream", "--", branch];
        runner.run(repo, &args, RunOpts::default()).await?;
    }
    Ok(())
}
