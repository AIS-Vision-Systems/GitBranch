//! Stash operations.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Options for `git stash push`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashPushArgs {
    /// Stash message.
    pub message: Option<String>,
    /// Also stash untracked files (`-u`).
    pub include_untracked: bool,
    /// Keep staged changes in the index (`-k`).
    pub keep_index: bool,
    /// Limit the stash to these repo-relative paths (empty = everything).
    pub paths: Vec<String>,
}

/// Pushes the current changes onto the stash.
///
/// # Errors
/// [`GitError`] if git fails (for example no initial commit).
pub async fn stash_push(
    runner: &GitRunner,
    repo: &Path,
    args: &StashPushArgs,
) -> Result<(), GitError> {
    let mut argv: Vec<&str> = vec!["stash", "push", "-q"];
    if args.include_untracked {
        argv.push("-u");
    }
    if args.keep_index {
        argv.push("-k");
    }
    if let Some(m) = &args.message {
        argv.push("-m");
        argv.push(m);
    }
    if !args.paths.is_empty() {
        argv.push("--");
        argv.extend(args.paths.iter().map(String::as_str));
    }
    // Literal pathspecs only with paths: git's own `-u` bookkeeping misbehaves with the variable set.
    let mut opts = RunOpts::default();
    if !args.paths.is_empty() {
        opts.env.push(("GIT_LITERAL_PATHSPECS".into(), "1".into()));
    }
    runner.run(repo, &argv, opts).await?;
    Ok(())
}

/// Fails with `NotFound` ("stash list changed") unless `stash@{index}` is still `oid`.
async fn check_entry(
    runner: &GitRunner,
    repo: &Path,
    index: usize,
    oid: &str,
) -> Result<(), GitError> {
    let sel = format!("stash@{{{index}}}");
    let argv = ["rev-parse", "--verify", "--quiet", &sel];
    let current = runner.run(repo, &argv, RunOpts::default()).await.ok().map(|o| o.stdout_str());
    if current.as_deref() == Some(oid) {
        return Ok(());
    }
    Err(GitError {
        kind: GitErrorKind::NotFound,
        stderr: "stash list changed".into(),
        args: argv.iter().map(|a| (*a).to_string()).collect(),
    })
}

/// Applies `stash@{index}` and keeps it. Conflicts surface as `GitErrorKind::Conflict`.
///
/// # Errors
/// [`GitError`] (`NotFound`, "stash list changed") when `stash@{index}` is no longer `oid`;
/// otherwise if changes would be overwritten, or on conflicts.
pub async fn stash_apply(
    runner: &GitRunner,
    repo: &Path,
    index: usize,
    oid: &str,
    restore_index: bool,
) -> Result<(), GitError> {
    run_apply(runner, repo, "apply", index, oid, restore_index).await
}

/// Applies `stash@{index}` and drops it on success.
///
/// # Errors
/// Same as [`stash_apply`]; on conflicts the entry is kept.
pub async fn stash_pop(
    runner: &GitRunner,
    repo: &Path,
    index: usize,
    oid: &str,
    restore_index: bool,
) -> Result<(), GitError> {
    run_apply(runner, repo, "pop", index, oid, restore_index).await
}

async fn run_apply(
    runner: &GitRunner,
    repo: &Path,
    sub: &str,
    index: usize,
    oid: &str,
    restore_index: bool,
) -> Result<(), GitError> {
    check_entry(runner, repo, index, oid).await?;
    let sel = format!("stash@{{{index}}}");
    // No `-q`: before git 2.39 quiet mode also hid the "CONFLICT (...)" lines the error
    // classifier needs to report `GitErrorKind::Conflict`.
    let mut argv = vec!["stash", sub];
    if restore_index {
        argv.push("--index");
    }
    argv.push(&sel);
    runner.run(repo, &argv, RunOpts::default()).await?;
    Ok(())
}

/// Drops `stash@{index}`.
///
/// # Errors
/// [`GitError`] (`NotFound`, "stash list changed") when `stash@{index}` is no longer `oid`.
pub async fn stash_drop(
    runner: &GitRunner,
    repo: &Path,
    index: usize,
    oid: &str,
) -> Result<(), GitError> {
    check_entry(runner, repo, index, oid).await?;
    let sel = format!("stash@{{{index}}}");
    runner.run(repo, &["stash", "drop", "-q", &sel], RunOpts::default()).await?;
    Ok(())
}
