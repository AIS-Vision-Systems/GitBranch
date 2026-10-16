//! Repository maintenance helpers.

use crate::repo::RepoInfo;
use crate::{GitError, GitRunner, RunOpts};

/// True when the repository already has a commit-graph file (single file or split chain).
#[must_use]
pub fn commit_graph_exists(info: &RepoInfo) -> bool {
    let dir = info.common_dir.join("objects").join("info");
    dir.join("commit-graph").is_file()
        || dir.join("commit-graphs").join("commit-graph-chain").is_file()
}

/// Writes the commit-graph file for all reachable commits (what `git gc` does).
///
/// # Errors
/// [`GitError`] if git fails.
pub async fn write_commit_graph(runner: &GitRunner, repo: &RepoInfo) -> Result<(), GitError> {
    let cwd = if repo.is_bare { &repo.git_dir } else { &repo.work_tree };
    runner.run(cwd, &["commit-graph", "write", "--reachable"], RunOpts::default()).await.map(|_| ())
}
