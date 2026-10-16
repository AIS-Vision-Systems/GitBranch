//! Stage, unstage and discard whole files (Phase 2). Hunk and line level lives in [`super::patch`].

use std::path::Path;

use crate::{GitError, GitRunner, RunOpts};

fn opts() -> RunOpts {
    RunOpts { env: vec![("GIT_LITERAL_PATHSPECS".into(), "1".into())], ..RunOpts::default() }
}

/// Runs `git <head...> -- <paths>` with literal pathspecs.
async fn run_paths(
    runner: &GitRunner,
    repo: &Path,
    head: &[&str],
    paths: &[String],
) -> Result<(), GitError> {
    let mut args: Vec<&str> = head.to_vec();
    args.push("--");
    args.extend(paths.iter().map(String::as_str));
    runner.run(repo, &args, opts()).await.map(|_| ())
}

/// True when HEAD does not resolve to a commit (no commits yet).
async fn head_unborn(runner: &GitRunner, repo: &Path) -> bool {
    runner.run(repo, &["rev-parse", "--verify", "-q", "HEAD"], opts()).await.is_err()
}

/// Stages `paths` (new, modified and deleted files).
///
/// # Errors
/// [`GitError`] if git fails.
pub async fn stage(runner: &GitRunner, repo: &Path, paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    run_paths(runner, repo, &["add", "-A"], paths).await
}

/// Removes `paths` from the index, keeping the work tree.
///
/// # Errors
/// [`GitError`] if git fails.
pub async fn unstage(runner: &GitRunner, repo: &Path, paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    if head_unborn(runner, repo).await {
        run_paths(runner, repo, &["rm", "--cached", "-r", "-q"], paths).await
    } else {
        run_paths(runner, repo, &["restore", "--staged"], paths).await
    }
}

/// Discards work-tree changes: restores `tracked` from the index and deletes `untracked`.
///
/// # Errors
/// [`GitError`] if git fails.
pub async fn discard(
    runner: &GitRunner,
    repo: &Path,
    tracked: &[String],
    untracked: &[String],
) -> Result<(), GitError> {
    if !tracked.is_empty() {
        run_paths(runner, repo, &["restore", "--worktree"], tracked).await?;
    }
    if !untracked.is_empty() {
        run_paths(runner, repo, &["clean", "-f", "-d", "-q"], untracked).await?;
    }
    Ok(())
}

/// Stages everything (`git add -A`).
///
/// # Errors
/// [`GitError`] if git fails.
pub async fn stage_all(runner: &GitRunner, repo: &Path) -> Result<(), GitError> {
    runner.run(repo, &["add", "-A"], opts()).await.map(|_| ())
}

/// Unstages everything.
///
/// # Errors
/// [`GitError`] if git fails.
pub async fn unstage_all(runner: &GitRunner, repo: &Path) -> Result<(), GitError> {
    if head_unborn(runner, repo).await {
        runner.run(repo, &["rm", "--cached", "-r", "-q", "--", "."], opts()).await.map(|_| ())
    } else {
        runner.run(repo, &["reset", "-q"], opts()).await.map(|_| ())
    }
}
