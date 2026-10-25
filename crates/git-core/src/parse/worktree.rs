//! Parser for `git worktree list --porcelain`.

use serde::{Deserialize, Serialize};

use super::ParseError;

/// One worktree of a repository (the main checkout is the first).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    /// Path as printed by git (absolute, forward slashes).
    pub path: String,
    /// Checked-out commit; `None` for a bare repository.
    pub head_oid: Option<String>,
    /// Short branch name; `None` when detached or bare.
    pub branch: Option<String>,
    /// First record of the list.
    pub is_main: bool,
    /// The bare repository entry.
    pub is_bare: bool,
    /// HEAD is detached.
    pub is_detached: bool,
    /// Locked against pruning and removal.
    pub locked: bool,
    /// Reason given to `git worktree lock`.
    pub lock_reason: Option<String>,
    /// Can be pruned (its directory is gone).
    pub prunable: bool,
    /// Why git considers it prunable.
    pub prune_reason: Option<String>,
}

/// Undoes git's C-style quoting (`"..."` with `\n`, `\t`, `\\`, `\"`, `\ooo`); unquoted text is
/// returned as is. Non-UTF-8 bytes become U+FFFD.
pub fn unquote_c(s: &str) -> String {
    let Some(inner) = s.strip_prefix('"').and_then(|r| r.strip_suffix('"')) else {
        return s.to_string();
    };
    let b = inner.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'\\' || i + 1 >= b.len() {
            out.push(b[i]);
            i += 1;
            continue;
        }
        i += 1;
        let is_oct = |d: &u8| (b'0'..=b'7').contains(d);
        match b[i] {
            b'n' => out.push(b'\n'),
            b't' => out.push(b'\t'),
            b'r' => out.push(b'\r'),
            b'a' => out.push(7),
            b'b' => out.push(8),
            b'f' => out.push(12),
            b'v' => out.push(11),
            b'0'..=b'3' if i + 2 < b.len() && b[i + 1..=i + 2].iter().all(is_oct) => {
                out.push((b[i] - b'0') * 64 + (b[i + 1] - b'0') * 8 + (b[i + 2] - b'0'));
                i += 2;
            }
            other => out.push(other),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn blank(path: String) -> Worktree {
    Worktree {
        path,
        head_oid: None,
        branch: None,
        is_main: false,
        is_bare: false,
        is_detached: false,
        locked: false,
        lock_reason: None,
        prunable: false,
        prune_reason: None,
    }
}

/// Parses the output of `git worktree list --porcelain` (no `-z`: that needs git 2.36).
///
/// # Errors
/// [`ParseError`] if a record has attributes but no `worktree` line.
pub fn parse_worktree_list(bytes: &[u8]) -> Result<Vec<Worktree>, ParseError> {
    let text = String::from_utf8_lossy(bytes);
    let mut out: Vec<Worktree> = Vec::new();
    let mut cur: Option<Worktree> = None;
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            out.extend(cur.take());
            continue;
        }
        let (key, val) = line.split_once(' ').map_or((line, None), |(k, v)| (k, Some(v)));
        if key == "worktree" {
            out.extend(cur.take());
            cur = Some(blank(val.unwrap_or_default().to_string()));
            continue;
        }
        let w = cur
            .as_mut()
            .ok_or_else(|| ParseError(format!("worktree record without path: {line}")))?;
        match key {
            "HEAD" => {
                // All zeros: unborn/orphan branch.
                w.head_oid = val.filter(|v| !v.bytes().all(|b| b == b'0')).map(str::to_string);
            }
            "branch" => {
                w.branch = val.map(|v| v.strip_prefix("refs/heads/").unwrap_or(v).to_string());
            }
            "bare" => w.is_bare = true,
            "detached" => w.is_detached = true,
            "locked" => {
                w.locked = true;
                w.lock_reason = val.map(unquote_c);
            }
            "prunable" => {
                w.prunable = true;
                w.prune_reason = val.map(unquote_c);
            }
            _ => {} // attributes added by newer git
        }
    }
    out.extend(cur.take());
    if let Some(first) = out.first_mut() {
        first.is_main = true;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)] // tests: unwrap is fine

    use super::*;

    const OID: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn main_and_two_linked() {
        let s = format!(
            "worktree /r\nHEAD {OID}\nbranch refs/heads/main\n\n\
             worktree /w/a\nHEAD {OID}\nbranch refs/heads/feat/a\nlocked in use\n\n\
             worktree /w/b\nHEAD {OID}\ndetached\n\n"
        );
        let l = parse_worktree_list(s.as_bytes()).unwrap();
        assert_eq!(l.len(), 3);
        assert!(l[0].is_main && !l[1].is_main);
        assert_eq!(l[0].branch.as_deref(), Some("main"));
        assert_eq!(l[0].head_oid.as_deref(), Some(OID));
        assert_eq!(l[1].branch.as_deref(), Some("feat/a"));
        assert!(l[1].locked);
        assert_eq!(l[1].lock_reason.as_deref(), Some("in use"));
        assert!(l[2].is_detached && l[2].branch.is_none() && !l[2].locked);
    }

    #[test]
    fn bare_main_and_no_trailing_blank() {
        let l = parse_worktree_list(b"worktree /r.git\nbare").unwrap();
        assert_eq!(l.len(), 1);
        assert!(l[0].is_bare && l[0].is_main && l[0].head_oid.is_none());
    }

    #[test]
    fn prunable_quoted_reason_and_unknown_attribute() {
        let s = format!(
            "worktree /r\nHEAD {OID}\nbranch refs/heads/main\n\n\
             worktree /gone\nHEAD {OID}\ndetached\nlocked\n\
             prunable \"gitdir\\nfile \\\"x\\\" \\303\\251\"\nfuture thing\n"
        );
        let l = parse_worktree_list(s.as_bytes()).unwrap();
        assert!(l[1].locked && l[1].lock_reason.is_none());
        assert!(l[1].prunable);
        assert_eq!(l[1].prune_reason.as_deref(), Some("gitdir\nfile \"x\" \u{e9}"));
    }

    #[test]
    fn unborn_head_is_none() {
        let z = "0".repeat(40);
        let s = format!(
            "worktree /r
HEAD {z}
branch refs/heads/x
"
        );
        let l = parse_worktree_list(s.as_bytes()).unwrap();
        assert!(l[0].head_oid.is_none());
        assert_eq!(l[0].branch.as_deref(), Some("x"));
    }

    #[test]
    fn errors_and_empty() {
        assert_eq!(parse_worktree_list(b"").unwrap().len(), 0);
        assert!(parse_worktree_list(b"HEAD abc\n").is_err());
    }

    #[test]
    fn unquote_cases() {
        assert_eq!(unquote_c("plain text"), "plain text");
        assert_eq!(unquote_c(r#""a\tb\\c\"d""#), "a\tb\\c\"d");
        assert_eq!(unquote_c(r#""\303\251""#), "\u{e9}");
        assert_eq!(unquote_c(r#""\377""#), "\u{fffd}");
    }
}
