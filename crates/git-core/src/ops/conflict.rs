//! Conflict resolution helpers: take a side, mark resolved, list conflicted files.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{GitError, GitRunner, RunOpts};

/// Which version of a conflicted file to keep.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    /// The current branch (HEAD; during a rebase this is the branch being rebased onto).
    Ours,
    /// The branch being merged (during a rebase, the commit being replayed).
    Theirs,
}

fn literal() -> RunOpts {
    RunOpts { env: vec![("GIT_LITERAL_PATHSPECS".into(), "1".into())], ..RunOpts::default() }
}

fn with_paths<'a>(head: &[&'a str], paths: &'a [String]) -> Vec<&'a str> {
    let mut argv = head.to_vec();
    argv.push("--");
    argv.extend(paths.iter().map(String::as_str));
    argv
}

/// Paths (among `paths`) with an unmerged index entry, split by whether they have `stage`.
fn split_by_stage(ls_files_u: &[u8], paths: &[String], stage: u8) -> (Vec<String>, Vec<String>) {
    let mut unmerged: Vec<(String, bool)> = Vec::new();
    for rec in ls_files_u.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let rec = String::from_utf8_lossy(rec);
        let Some((meta, path)) = rec.split_once('\t') else { continue };
        let has = meta.rsplit(' ').next().and_then(|s| s.parse::<u8>().ok()) == Some(stage);
        match unmerged.iter_mut().find(|(p, _)| p == path) {
            Some(e) => e.1 |= has,
            None => unmerged.push((path.to_string(), has)),
        }
    }
    let (mut with, mut without) = (Vec::new(), Vec::new());
    for p in paths {
        match unmerged.iter().find(|(u, _)| u == p) {
            Some((_, true)) => with.push(p.clone()),
            Some((_, false)) => without.push(p.clone()),
            None => {}
        }
    }
    (with, without)
}

/// Keeps `side` of every conflicted path and stages the result. When the chosen side deleted the
/// file (modify/delete or delete/delete conflicts) the file is removed instead. Paths without
/// unmerged entries are left alone.
///
/// # Errors
/// [`GitError`] if git fails.
pub async fn take_side(
    runner: &GitRunner,
    repo: &Path,
    paths: &[String],
    side: Side,
) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let (flag, stage) = match side {
        Side::Ours => ("--ours", 2),
        Side::Theirs => ("--theirs", 3),
    };
    let listed = runner.run(repo, &with_paths(&["ls-files", "-u", "-z"], paths), literal()).await?;
    let (with, without) = split_by_stage(&listed.stdout, paths, stage);
    if !with.is_empty() {
        runner.run(repo, &with_paths(&["checkout", flag], &with), literal()).await?;
        runner.run(repo, &with_paths(&["add"], &with), literal()).await?;
    }
    if !without.is_empty() {
        runner.run(repo, &with_paths(&["rm", "-q", "-f"], &without), literal()).await?;
    }
    Ok(())
}

/// Stages the paths (marks the conflicts as resolved).
///
/// # Errors
/// [`GitError`] if git fails.
pub async fn mark_resolved(
    runner: &GitRunner,
    repo: &Path,
    paths: &[String],
) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    runner.run(repo, &with_paths(&["add"], paths), literal()).await.map(|_| ())
}

/// Paths that still have unmerged index entries.
///
/// # Errors
/// [`GitError`] if git fails.
pub async fn conflicted_files(runner: &GitRunner, repo: &Path) -> Result<Vec<String>, GitError> {
    let out = runner
        .run(repo, &["diff", "--name-only", "--diff-filter=U", "-z"], RunOpts::default())
        .await?;
    Ok(out
        .stdout
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_by_stage() {
        let out =
            b"100644 aaa 1\tf.txt\x00100644 bbb 2\tf.txt\x00100644 ccc 1\tg.txt\x00100644 ddd 3\tg.txt\x00";
        let paths = ["f.txt".to_string(), "g.txt".to_string(), "h.txt".to_string()];
        let (w, wo) = split_by_stage(out, &paths, 2);
        assert_eq!((w, wo), (vec!["f.txt".to_string()], vec!["g.txt".to_string()]));
        let (w, wo) = split_by_stage(out, &paths, 3);
        assert_eq!((w, wo), (vec!["g.txt".to_string()], vec!["f.txt".to_string()]));
    }
}
