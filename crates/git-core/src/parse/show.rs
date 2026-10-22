//! Commit details: metadata from `git show -s` plus the changed-file list from `git diff-tree`.
//!
//! For merge commits the file list is the diff against the FIRST parent. Plain `diff-tree` prints
//! nothing for merges, so the metadata call reveals the parents and the file call diffs
//! `<first-parent> <oid>` explicitly. Root commits use `--root`, so their files are listed as added.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::ParseError;
use crate::runner::{GitError, GitRunner, RunOpts};

/// Kind of change of one file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    /// `A`.
    Added,
    /// `M`.
    Modified,
    /// `D`.
    Deleted,
    /// `R`.
    Renamed,
    /// `C`.
    Copied,
    /// `T`.
    TypeChanged,
    /// `U`.
    Unmerged,
    /// Anything else.
    Unknown,
}

/// One file changed by a commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    /// Path after the change.
    pub path: String,
    /// Previous path for renames and copies.
    pub orig_path: Option<String>,
    /// Kind of change.
    pub kind: ChangeKind,
    /// Similarity percentage for renames and copies (`R087` is 87).
    pub similarity: Option<u8>,
}

/// One `Co-authored-by:` trailer entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoAuthor {
    /// Display name.
    pub name: String,
    /// Email address (empty when the trailer had none).
    pub email: String,
}

/// Metadata and changed files of one commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    /// Full object id.
    pub oid: String,
    /// Parent object ids.
    pub parents: Vec<String>,
    /// Author name.
    pub author_name: String,
    /// Author email.
    pub author_email: String,
    /// Author time, unix seconds.
    pub author_time: i64,
    /// Committer name.
    pub committer_name: String,
    /// Committer email.
    pub committer_email: String,
    /// Committer time, unix seconds.
    pub committer_time: i64,
    /// Subject line.
    pub subject: String,
    /// Message body without the subject, trailing newlines trimmed.
    pub body: String,
    /// `Co-authored-by:` trailers, in order; the lines are removed from `body`.
    pub co_authors: Vec<CoAuthor>,
    /// Files changed (against the first parent for merges).
    pub files: Vec<ChangedFile>,
}

/// Error from [`commit_details`].
#[derive(Debug, thiserror::Error)]
pub enum ShowError {
    /// The git process failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// The output could not be parsed.
    #[error(transparent)]
    Parse(#[from] ParseError),
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn num(bytes: &[u8], what: &str) -> Result<i64, ParseError> {
    std::str::from_utf8(bytes)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .ok_or_else(|| ParseError(format!("invalid {what} in show record")))
}

/// Parse `git diff-tree -z --name-status` output (`M\0path\0`, `R087\0old\0new\0`).
///
/// # Errors
/// Returns [`ParseError`] when a status has no path(s).
pub fn parse_name_status(stdout: &[u8]) -> Result<Vec<ChangedFile>, ParseError> {
    let mut toks = stdout.split(|b| *b == 0).filter(|t| !t.is_empty());
    let mut out = Vec::new();
    while let Some(status) = toks.next() {
        let kind = match status[0] {
            b'A' => ChangeKind::Added,
            b'M' => ChangeKind::Modified,
            b'D' => ChangeKind::Deleted,
            b'R' => ChangeKind::Renamed,
            b'C' => ChangeKind::Copied,
            b'T' => ChangeKind::TypeChanged,
            b'U' => ChangeKind::Unmerged,
            _ => ChangeKind::Unknown,
        };
        let missing = || ParseError("name-status entry missing path".into());
        if matches!(kind, ChangeKind::Renamed | ChangeKind::Copied) {
            let similarity =
                std::str::from_utf8(&status[1..]).ok().and_then(|s| s.parse::<u8>().ok());
            let old = text(toks.next().ok_or_else(missing)?);
            let new = text(toks.next().ok_or_else(missing)?);
            out.push(ChangedFile { path: new, orig_path: Some(old), kind, similarity });
        } else {
            let path = text(toks.next().ok_or_else(missing)?);
            out.push(ChangedFile { path, orig_path: None, kind, similarity: None });
        }
    }
    Ok(out)
}

/// Parse the value of a `Co-authored-by:` trailer (`Name <email>`).
fn parse_co_author(s: &str) -> CoAuthor {
    let s = s.trim();
    match s.split_once('<') {
        Some((name, rest)) => {
            let rest = rest.trim();
            let email = rest.strip_suffix('>').or_else(|| rest.split_once('>').map(|x| x.0));
            CoAuthor {
                name: name.trim().to_string(),
                email: email.unwrap_or(rest).trim().to_string(),
            }
        }
        None => CoAuthor { name: s.to_string(), email: String::new() },
    }
}

/// Does `line` look like a `Co-authored-by:` trailer line (git's rule: no leading whitespace,
/// ASCII-case-insensitive token, optional whitespace before the colon)?
fn is_co_author_line(line: &str) -> bool {
    const KEY: &str = "co-authored-by";
    line.len() > KEY.len()
        && line.is_char_boundary(KEY.len())
        && line[..KEY.len()].eq_ignore_ascii_case(KEY)
        && line[KEY.len()..].trim_start_matches([' ', '\t']).starts_with(':')
}

/// Remove up to `max` `Co-authored-by:` lines (plus their folded continuation lines) from the
/// last paragraph (the trailer block) of `body`. Original line endings are preserved.
fn strip_co_author_lines(body: &str, max: usize) -> String {
    if max == 0 {
        return body.to_string();
    }
    let lines: Vec<&str> = body.split('\n').collect();
    let start = lines.iter().rposition(|l| l.trim().is_empty()).map_or(0, |i| i + 1);
    let mut kept: Vec<&str> = lines[..start].to_vec();
    let (mut removed, mut skipping, mut para_kept) = (0, false, false);
    for l in &lines[start..] {
        if removed < max && is_co_author_line(l) {
            removed += 1;
            skipping = true;
        } else if skipping && l.starts_with([' ', '\t']) {
            // folded continuation of a stripped trailer
        } else {
            skipping = false;
            para_kept = true;
            kept.push(l);
        }
    }
    if !para_kept {
        kept.truncate(start);
        while kept.last().is_some_and(|l| l.trim().is_empty()) {
            kept.pop();
        }
    }
    kept.join("\n").trim_end_matches(['\n', '\r']).to_string()
}
fn parse_meta(stdout: &[u8]) -> Result<CommitDetails, ParseError> {
    let rec = stdout.strip_suffix(&[0]).unwrap_or(stdout);
    let f: Vec<&[u8]> = rec.splitn(11, |b| *b == 0x1f).collect();
    if f.len() < 11 {
        return Err(ParseError("show record has fewer than eleven fields".into()));
    }
    let co_authors: Vec<CoAuthor> = f[9]
        .split(|b| *b == 0x1e)
        .map(text)
        .filter(|e| !e.trim().is_empty())
        .map(|e| parse_co_author(&e))
        .collect();
    Ok(CommitDetails {
        oid: text(f[0]),
        parents: f[1].split(|b| *b == b' ').filter(|p| !p.is_empty()).map(text).collect(),
        author_name: text(f[2]),
        author_email: text(f[3]),
        author_time: num(f[4], "author time")?,
        committer_name: text(f[5]),
        committer_email: text(f[6]),
        committer_time: num(f[7], "committer time")?,
        subject: text(f[8]),
        body: strip_co_author_lines(text(f[10]).trim_end_matches(['\n', '\r']), co_authors.len()),
        co_authors,
        files: Vec::new(),
    })
}

/// Load metadata and the changed-file list of commit `oid`.
///
/// `%(trailers:...)` needs git >= 2.22, already covered by `MIN_GIT_VERSION` (2.31) in
/// `runner.rs`, so there is no per-op version probe.
///
/// # Errors
/// [`ShowError::Git`] if git fails (e.g. unknown object), [`ShowError::Parse`] on malformed output.
pub async fn commit_details(
    runner: &GitRunner,
    repo: &Path,
    oid: &str,
) -> Result<CommitDetails, ShowError> {
    let meta = runner
        .run(
            repo,
            &[
                "show",
                "-s",
                "--no-show-signature",
                "-z",
                "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%s%x1f%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x1e)%x1f%b",
                oid,
                "--",
            ],
            RunOpts::default(),
        )
        .await?;
    let mut details = parse_meta(&meta.stdout)?;
    let mut args: Vec<String> =
        ["diff-tree", "-r", "-M", "-z", "--name-status", "--no-commit-id"].map(String::from).into();
    match details.parents.first() {
        Some(p) => args.push(p.clone()),
        None => args.push("--root".into()),
    }
    args.push(details.oid.clone());
    args.push("--".into());
    let files = runner.run(repo, &args, RunOpts::default()).await?;
    details.files = parse_name_status(&files.stdout)?;
    Ok(details)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn co_author_parsing() {
        let a = parse_co_author("  Ann   Lee  <ann@example.com> ");
        assert_eq!((a.name.as_str(), a.email.as_str()), ("Ann   Lee", "ann@example.com"));
        let b = parse_co_author("Bob");
        assert_eq!((b.name.as_str(), b.email.as_str()), ("Bob", ""));
        let c = parse_co_author("<c@d>");
        assert_eq!((c.name.as_str(), c.email.as_str()), ("", "c@d"));
    }

    #[test]
    fn strips_only_co_author_lines() {
        let body =
            "Text\n\nSigned-off-by: X <x@y>\nCo-authored-by: A <a@b>\nco-AUTHORED-by: C <c@d>";
        assert_eq!(strip_co_author_lines(body, 2), "Text\n\nSigned-off-by: X <x@y>");
        assert_eq!(strip_co_author_lines("Just text\nmore", 1), "Just text\nmore");
        assert_eq!(strip_co_author_lines("Body text\n\nCo-authored-by: A <a@b>", 1), "Body text");
    }

    #[test]
    fn strip_respects_count_and_prose() {
        let prose = "Subject line\nCo-authored-by: mentioned in prose";
        assert_eq!(strip_co_author_lines(prose, 0), prose);
        let body = "T\n\nCo-authored-by: A <a@b>\nCo-authored-by: B <b@c>";
        assert_eq!(strip_co_author_lines(body, 1), "T\n\nCo-authored-by: B <b@c>");
    }

    #[test]
    fn strip_handles_crlf_and_blank_whitespace() {
        let body = "T\r\n\r\nSigned-off-by: X <x@y>\r\nCo-authored-by: A <a@b>";
        assert_eq!(strip_co_author_lines(body, 1), "T\r\n\r\nSigned-off-by: X <x@y>");
        let ws = "T\n  \nCo-authored-by: A <a@b>";
        assert_eq!(strip_co_author_lines(ws, 1), "T");
    }

    #[test]
    fn strip_matches_like_git() {
        assert!(is_co_author_line("Co-authored-by : A <a@b>"));
        assert!(is_co_author_line("CO-AUTHORED-BY: A"));
        assert!(!is_co_author_line(" Co-authored-by: A"));
        assert!(!is_co_author_line("Co-authored-by A"));
        let body = "T\n\nCo-authored-by: A <a@b>\n  folded\n\tmore\nSigned-off-by: X";
        assert_eq!(strip_co_author_lines(body, 1), "T\n\nSigned-off-by: X");
    }
}
