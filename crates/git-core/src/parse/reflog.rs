//! Parser for `git reflog show` output.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::ParseError;
use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// One reflog line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    /// Commit HEAD pointed to after this entry.
    pub oid: String,
    /// Selector such as `HEAD@{0}`.
    pub selector: String,
    /// Reflog message (`commit: ...`, `checkout: moving from a to b`).
    pub subject: String,
    /// Committer time, unix seconds.
    pub time: i64,
}

/// Failure of [`head_reflog`]: git failed or its output was malformed.
#[derive(Debug, Clone, thiserror::Error)]
pub enum ReflogError {
    /// A git invocation failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// The output could not be parsed.
    #[error(transparent)]
    Parse(#[from] ParseError),
}

/// Parses `--format=%H%x1f%gd%x1f%gs%x1f%ct` output with `-z`.
pub fn parse_reflog(stdout: &[u8]) -> Result<Vec<ReflogEntry>, ParseError> {
    let mut out = Vec::new();
    for rec in stdout.split(|b| *b == 0) {
        let rec = String::from_utf8_lossy(rec);
        let rec = rec.trim_matches('\n');
        if rec.is_empty() {
            continue;
        }
        let f: Vec<&str> = rec.split('\x1f').collect();
        let [oid, selector, subject, time] = f[..] else {
            return Err(ParseError(format!("reflog record has {} fields: {rec:?}", f.len())));
        };
        let time = time.parse().map_err(|_| ParseError(format!("bad reflog time {time:?}")))?;
        out.push(ReflogEntry {
            oid: oid.to_string(),
            selector: selector.to_string(),
            subject: subject.to_string(),
            time,
        });
    }
    Ok(out)
}

/// The newest `limit` reflog entries of HEAD, newest first. An unborn HEAD yields no entries.
pub async fn head_reflog(
    runner: &GitRunner,
    repo: &Path,
    limit: usize,
) -> Result<Vec<ReflogEntry>, ReflogError> {
    ref_reflog(runner, repo, "HEAD", limit).await
}

/// The newest `limit` reflog entries of `refname` (for example `refs/heads/main`), newest first.
/// A ref without a reflog yields no entries.
pub async fn ref_reflog(
    runner: &GitRunner,
    repo: &Path,
    refname: &str,
    limit: usize,
) -> Result<Vec<ReflogEntry>, ReflogError> {
    let n = limit.to_string();
    let args = ["reflog", "show", "-z", "--format=%H%x1f%gd%x1f%gs%x1f%ct", "-n", &n, refname];
    match runner.run(repo, &args, RunOpts::default()).await {
        Ok(o) => Ok(parse_reflog(&o.stdout)?),
        Err(e)
            if e.kind == GitErrorKind::NotFound
                || e.stderr.contains("does not have any commits") =>
        {
            Ok(Vec::new())
        }
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests: unwrap is fine
mod tests {
    use super::*;

    #[test]
    fn parses_three_entries() {
        let s = "aaa\x1fHEAD@{0}\x1fcommit: c3\x1f300\0bbb\x1fHEAD@{1}\x1fcheckout: moving from main to feat\x1f200\0ccc\x1fHEAD@{2}\x1fcommit (initial): c1\x1f100\0";
        let v = parse_reflog(s.as_bytes()).unwrap();
        assert_eq!(v.len(), 3);
        assert_eq!(v[0].oid, "aaa");
        assert_eq!(v[1].subject, "checkout: moving from main to feat");
        assert_eq!(v[2].selector, "HEAD@{2}");
        assert_eq!(v[2].time, 100);
        assert!(parse_reflog(b"x\x1fy\0").is_err());
        assert!(parse_reflog(b"").unwrap().is_empty());
    }
}
