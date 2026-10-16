//! Parser for `git stash list` output.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::ParseError;
use crate::runner::{GitError, GitRunner, RunOpts};

/// One stash entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    /// Position in the stash stack (`stash@{index}`).
    pub index: usize,
    /// Stash commit oid (first parent is the base commit).
    pub oid: String,
    /// Branch the stash was made on; `None` when detached or unknown.
    pub branch: Option<String>,
    /// Reflog subject, e.g. `WIP on main: abc1234 Subject` or `On main: my message`.
    pub message: String,
    /// Committer time, unix seconds.
    pub time: i64,
}

/// Error from [`stash_list`].
#[derive(Debug, thiserror::Error)]
pub enum StashError {
    /// git failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// Output did not parse.
    #[error(transparent)]
    Parse(#[from] ParseError),
}

fn branch_of(subject: &str) -> Option<String> {
    let rest = subject.strip_prefix("WIP on ").or_else(|| subject.strip_prefix("On "))?;
    let (branch, _) = rest.split_once(':')?;
    let branch = branch.trim();
    if branch.is_empty() || branch.starts_with('(') { None } else { Some(branch.to_string()) }
}

/// Parses `git stash list -z --format=%gd%x1f%H%x1f%gs%x1f%ct`.
///
/// # Errors
/// [`ParseError`] on a malformed record.
pub fn parse_stash_list(stdout: &[u8]) -> Result<Vec<StashEntry>, ParseError> {
    let mut entries = Vec::new();
    for rec in stdout.split(|b| *b == 0) {
        let rec = String::from_utf8_lossy(rec);
        let rec = rec.trim_matches('\n');
        if rec.is_empty() {
            continue;
        }
        let f: Vec<&str> = rec.split('\x1f').collect();
        if f.len() != 4 {
            return Err(ParseError(format!("stash record has {} fields", f.len())));
        }
        let index = f[0]
            .strip_prefix("stash@{")
            .and_then(|s| s.strip_suffix('}'))
            .and_then(|s| s.parse::<usize>().ok())
            .ok_or_else(|| ParseError(format!("bad stash selector {:?}", f[0])))?;
        let time = f[3].trim().parse::<i64>().map_err(|e| ParseError(format!("bad time: {e}")))?;
        entries.push(StashEntry {
            index,
            oid: f[1].to_string(),
            branch: branch_of(f[2]),
            message: f[2].trim().to_string(),
            time,
        });
    }
    Ok(entries)
}

/// Lists stash entries, newest first.
///
/// # Errors
/// [`StashError::Git`] if git fails, [`StashError::Parse`] on unexpected output.
pub async fn stash_list(runner: &GitRunner, repo: &Path) -> Result<Vec<StashEntry>, StashError> {
    let args = ["stash", "list", "-z", "--format=%gd%x1f%H%x1f%gs%x1f%ct"];
    let out = runner.run(repo, &args, RunOpts::default()).await?;
    Ok(parse_stash_list(&out.stdout)?)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)] // tests: unwrap is fine
    use super::*;

    #[test]
    fn parses_wip_custom_and_detached() {
        let s = "stash@{0}\x1faaaa111\x1fOn main: my message\x1f1767225700\0\
                 stash@{1}\x1fbbbb222\x1fWIP on feat/x: abc1234 Subject\x1f1767225600\0\
                 stash@{2}\x1fcccc333\x1fOn (no branch): x\x1f1767225500\0";
        let v = parse_stash_list(s.as_bytes()).unwrap();
        assert_eq!(v.len(), 3);
        assert_eq!(v[0].index, 0);
        assert_eq!(v[0].branch.as_deref(), Some("main"));
        assert_eq!(v[0].message, "On main: my message");
        assert_eq!(v[1].index, 1);
        assert_eq!(v[1].branch.as_deref(), Some("feat/x"));
        assert_eq!(v[1].message, "WIP on feat/x: abc1234 Subject");
        assert_eq!(v[2].branch, None);
        assert_eq!(v[2].time, 1_767_225_500);
    }

    #[test]
    fn empty_and_malformed() {
        assert!(parse_stash_list(b"").unwrap().is_empty());
        assert!(parse_stash_list(b"stash@{0}\x1fonly").is_err());
    }
}
