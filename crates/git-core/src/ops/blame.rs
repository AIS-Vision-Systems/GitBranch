//! `git blame --porcelain` for one file.

use std::path::Path;

use crate::parse::blame::{Blame, BlameError, parse_blame};
use crate::{GitRunner, RunOpts};

/// Blames `path` (relative to the work tree) at `rev`, or at the working tree when `rev` is `None`
/// (uncommitted lines get the author "Not Committed Yet").
///
/// # Errors
/// [`BlameError::Git`] when the path does not exist in `rev` (missing or untracked file) or git fails.
pub async fn blame(
    runner: &GitRunner,
    repo: &Path,
    path: &str,
    rev: Option<&str>,
) -> Result<Blame, BlameError> {
    // Rejected up front: a leading `-` would be parsed by git as an option (`--contents=...`).
    if let Some(rev) = rev.filter(|r| !crate::refname::is_safe_revision(r)) {
        return Err(BlameError::InvalidRevision(rev.to_string()));
    }
    let mut args = vec!["blame", "--porcelain"];
    if let Some(rev) = rev {
        args.push(rev);
    }
    args.push("--");
    args.push(path);
    let out = runner.run(repo, &args, RunOpts::default()).await?;
    Ok(parse_blame(&out.stdout)?)
}
