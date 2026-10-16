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

fn parse_meta(stdout: &[u8]) -> Result<CommitDetails, ParseError> {
    let rec = stdout.strip_suffix(&[0]).unwrap_or(stdout);
    let f: Vec<&[u8]> = rec.splitn(10, |b| *b == 0x1f).collect();
    if f.len() < 10 {
        return Err(ParseError("show record has fewer than ten fields".into()));
    }
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
        body: text(f[9]).trim_end_matches(['\n', '\r']).to_string(),
        files: Vec::new(),
    })
}

/// Load metadata and the changed-file list of commit `oid`.
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
                "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%s%x1f%b",
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
