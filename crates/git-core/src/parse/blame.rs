//! Parser for `git blame --porcelain` output.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::ParseError;
use super::worktree::unquote_c;
use crate::GitError;

/// A run of consecutive final lines last changed by the same commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameHunk {
    /// Commit that last touched these lines (all zeros for uncommitted changes).
    pub oid: String,
    /// Author name.
    pub author: String,
    /// Author time, unix seconds.
    pub author_time: i64,
    /// Commit subject.
    pub summary: String,
    /// First line of the hunk in the blamed revision, 1-based.
    pub start_line: u32,
    /// Number of lines in the hunk.
    pub line_count: u32,
    /// Whether the commit is a boundary (blame stopped there).
    pub boundary: bool,
    /// Path of the file in that commit (differs from the blamed path after renames).
    pub path: String,
}

/// Blame of one file: hunks in line order plus the file's lines.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    /// Hunks covering every line, in order.
    pub hunks: Vec<BlameHunk>,
    /// File content, one entry per line (without the line terminator).
    pub lines: Vec<String>,
}

/// Failure of blame: git failed or its output was malformed.
#[derive(Debug, Clone, thiserror::Error)]
pub enum BlameError {
    /// A git invocation failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// The output could not be parsed.
    #[error(transparent)]
    Parse(#[from] ParseError),
    /// The revision is empty, starts with `-` or contains whitespace/control characters.
    #[error("invalid revision {0:?}")]
    InvalidRevision(String),
}

#[derive(Default, Clone)]
struct Meta {
    author: String,
    author_time: i64,
    summary: String,
    boundary: bool,
    path: String,
}

fn is_oid(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Parses `git blame --porcelain` output, merging consecutive lines of one commit into hunks.
pub fn parse_blame(stdout: &[u8]) -> Result<Blame, ParseError> {
    let text = String::from_utf8_lossy(stdout);
    let mut metas: HashMap<String, Meta> = HashMap::new();
    let mut hunks: Vec<BlameHunk> = Vec::new();
    let mut lines: Vec<String> = Vec::new();
    // (oid, final line) of the header awaiting its content line.
    let mut pending: Option<(String, u32)> = None;

    for raw in text.split('\n') {
        if let Some(content) = raw.strip_prefix('\t') {
            let (oid, final_line) = pending
                .take()
                .ok_or_else(|| ParseError("blame content line without header".into()))?;
            lines.push(content.strip_suffix('\r').unwrap_or(content).to_string());
            let m = metas.get(&oid).cloned().unwrap_or_default();
            match hunks.last_mut() {
                Some(h)
                    if h.oid == oid
                        && h.path == m.path
                        && h.start_line + h.line_count == final_line =>
                {
                    h.line_count += 1;
                }
                _ => {
                    hunks.push(BlameHunk {
                        oid,
                        author: m.author,
                        author_time: m.author_time,
                        summary: m.summary,
                        start_line: final_line,
                        line_count: 1,
                        boundary: m.boundary,
                        path: m.path,
                    });
                }
            }
            continue;
        }
        if raw.is_empty() {
            continue;
        }
        let (key, value) = raw.split_once(' ').unwrap_or((raw, ""));
        if is_oid(key) {
            let nums: Vec<&str> = value.split(' ').collect();
            let final_line = nums
                .get(1)
                .and_then(|s| s.parse::<u32>().ok())
                .ok_or_else(|| ParseError(format!("bad blame header {raw:?}")))?;
            metas.entry(key.to_string()).or_default();
            pending = Some((key.to_string(), final_line));
            continue;
        }
        // Metadata of the commit named by the most recent header.
        let Some((oid, _)) = &pending else { continue };
        let Some(meta) = metas.get_mut(oid) else { continue };
        match key {
            "author" => meta.author = value.to_string(),
            "author-time" => {
                meta.author_time = value
                    .parse()
                    .map_err(|_| ParseError(format!("bad blame author-time {value:?}")))?;
            }
            "summary" => meta.summary = value.to_string(),
            "boundary" => meta.boundary = true,
            "filename" => meta.path = unquote_c(value),
            _ => {}
        }
    }
    if pending.is_some() {
        return Err(ParseError("blame output ended after a header".into()));
    }
    Ok(Blame { hunks, lines })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests: unwrap is fine
mod tests {
    use super::*;

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn merges_and_caches_metadata() {
        let s = format!(
            "{A} 1 1 2\nauthor Ann\nauthor-time 100\nsummary first\nboundary\nfilename f.txt\n\tone\n\
             {A} 2 2\n\ttwo\n\
             {B} 3 3 1\nauthor Bob\nauthor-time 200\nsummary second\nfilename f.txt\n\tthree\n\
             {A} 4 4 1\n\tfour\n"
        );
        let b = parse_blame(s.as_bytes()).unwrap();
        assert_eq!(b.lines, ["one", "two", "three", "four"]);
        assert_eq!(b.hunks.len(), 3);
        assert_eq!((b.hunks[0].start_line, b.hunks[0].line_count), (1, 2));
        assert!(b.hunks[0].boundary && !b.hunks[1].boundary);
        assert_eq!(b.hunks[1].author, "Bob");
        assert_eq!(b.hunks[2].author, "Ann");
        assert_eq!(b.hunks[2].summary, "first");
        assert_eq!(b.hunks[2].path, "f.txt");
    }

    #[test]
    fn strips_cr_unquotes_path_and_splits_on_path_change() {
        let s = format!(
            "{A} 1 1 1\nauthor Ann\nauthor-time 1\nsummary s\nfilename \"caf\\303\\251.txt\"\n\tone\r\n\
             {A} 2 2 1\nfilename other.txt\n\ttwo\n"
        );
        let b = parse_blame(s.as_bytes()).unwrap();
        assert_eq!(b.lines, ["one", "two"]);
        assert_eq!(b.hunks.len(), 2);
        assert_eq!(b.hunks[0].path, "caf\u{e9}.txt");
        assert_eq!(b.hunks[1].path, "other.txt");
    }

    #[test]
    fn rejects_orphan_content() {
        assert!(parse_blame(b"\tx\n").is_err());
    }
}
