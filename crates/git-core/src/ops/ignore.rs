//! Ignore-rule queries.

use std::path::{Path, PathBuf};

use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Returns the subset of `paths` (relative to `repo` or absolute) that git ignores.
///
/// Uses one `git check-ignore -z --stdin` call (tracked files are never reported); exit status 1
/// means "none ignored".
///
/// # Errors
/// [`GitError`] if git fails for any other reason.
pub async fn ignored(
    runner: &GitRunner,
    repo: &Path,
    paths: &[PathBuf],
) -> Result<Vec<PathBuf>, GitError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let mut input = Vec::new();
    for p in paths {
        input.extend_from_slice(p.to_string_lossy().as_bytes());
        input.push(0);
    }
    let args = ["check-ignore", "-z", "--stdin"];
    match runner.run(repo, &args, RunOpts::with_stdin(input)).await {
        Ok(o) => Ok(split(&o.stdout)),
        Err(e) if e.kind == GitErrorKind::ExitCode(1) => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

fn split(out: &[u8]) -> Vec<PathBuf> {
    out.split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| PathBuf::from(String::from_utf8_lossy(s).into_owned()))
        .collect()
}
