//! Reset, revert and cherry-pick.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{GitError, GitRunner, RunOpts};

/// How `git reset` treats the index and work tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResetMode {
    /// Move HEAD only.
    Soft,
    /// Move HEAD and reset the index.
    Mixed,
    /// Move HEAD, reset index and work tree.
    Hard,
}

/// Resets the current branch to `target`.
///
/// # Errors
/// [`GitError`] if `target` does not resolve.
pub async fn reset(
    runner: &GitRunner,
    repo: &Path,
    target: &str,
    mode: ResetMode,
) -> Result<(), GitError> {
    let flag = match mode {
        ResetMode::Soft => "--soft",
        ResetMode::Mixed => "--mixed",
        ResetMode::Hard => "--hard",
    };
    runner.run(repo, &["reset", "-q", flag, target, "--"], RunOpts::default()).await?;
    Ok(())
}

async fn any_merge(runner: &GitRunner, repo: &Path, oids: &[String]) -> Result<bool, GitError> {
    for oid in oids {
        let out = runner
            .run(repo, &["rev-list", "--parents", "-n1", oid.as_str()], RunOpts::default())
            .await?;
        if out.stdout_str().split_whitespace().count() > 2 {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Reverts `oids` (mainline parent 1 for merge commits). Conflicts surface as
/// `GitErrorKind::Conflict` and leave the sequencer state for the conflict UI.
///
/// # Errors
/// [`GitError`] on failure or conflicts.
pub async fn revert(
    runner: &GitRunner,
    repo: &Path,
    oids: &[String],
    no_commit: bool,
) -> Result<(), GitError> {
    let mut argv: Vec<&str> = vec!["revert", "--no-edit"];
    if no_commit {
        argv.push("--no-commit");
    }
    if any_merge(runner, repo, oids).await? {
        argv.extend(["-m", "1"]);
    }
    argv.extend(oids.iter().map(String::as_str));
    runner.run(repo, &argv, RunOpts::default()).await?;
    Ok(())
}

/// Cherry-picks `oids` onto HEAD (mainline parent 1 for merge commits). Conflicts surface as
/// `GitErrorKind::Conflict` and leave the sequencer state for the conflict UI.
///
/// # Errors
/// [`GitError`] on failure or conflicts.
pub async fn cherry_pick(
    runner: &GitRunner,
    repo: &Path,
    oids: &[String],
    no_commit: bool,
) -> Result<(), GitError> {
    let mut argv: Vec<&str> = vec!["cherry-pick"];
    if no_commit {
        argv.push("--no-commit");
    }
    if any_merge(runner, repo, oids).await? {
        argv.extend(["-m", "1"]);
    }
    argv.extend(oids.iter().map(String::as_str));
    runner.run(repo, &argv, RunOpts::default()).await?;
    Ok(())
}
