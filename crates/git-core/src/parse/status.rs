//! `git status --porcelain=v2 -z --branch` parser.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::ParseError;
use crate::runner::{GitError, GitRunner, RunOpts};

/// State of one side (index or worktree) of a status entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileState {
    /// No change (`.`).
    Unmodified,
    /// Content modified.
    Modified,
    /// Type changed (file, symlink, ...).
    TypeChanged,
    /// Added.
    Added,
    /// Deleted.
    Deleted,
    /// Renamed.
    Renamed,
    /// Copied.
    Copied,
    /// Untracked (`?`).
    Untracked,
    /// Ignored (`!`).
    Ignored,
    /// Unmerged (conflict).
    Unmerged,
}

impl FileState {
    fn from_byte(b: u8) -> Result<Self, ParseError> {
        Ok(match b {
            b'.' => Self::Unmodified,
            b'M' => Self::Modified,
            b'T' => Self::TypeChanged,
            b'A' => Self::Added,
            b'D' => Self::Deleted,
            b'R' => Self::Renamed,
            b'C' => Self::Copied,
            b'U' => Self::Unmerged,
            other => return Err(ParseError(format!("unknown status letter {:?}", other as char))),
        })
    }
}

/// One changed path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    /// Current path (for renames: the new path).
    pub path: String,
    /// Renames/copies: the old path.
    pub orig_path: Option<String>,
    /// Index vs HEAD (X column).
    pub staged: FileState,
    /// Worktree vs index (Y column).
    pub unstaged: FileState,
    /// Unmerged entry.
    pub conflicted: bool,
    /// Entry is a submodule.
    pub submodule: bool,
}

impl StatusEntry {
    fn is_untracked_or_ignored(&self) -> bool {
        matches!(self.staged, FileState::Untracked | FileState::Ignored)
    }
}

/// Branch header information.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusBranch {
    /// HEAD commit; `None` on an unborn branch.
    pub oid: Option<String>,
    /// Branch name; `None` when detached.
    pub head: Option<String>,
    /// Upstream ref, if configured.
    pub upstream: Option<String>,
    /// Commits ahead of upstream.
    pub ahead: u32,
    /// Commits behind upstream.
    pub behind: u32,
}

/// Parsed `git status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Branch header (present with `--branch`).
    pub branch: Option<StatusBranch>,
    /// Changed paths.
    pub entries: Vec<StatusEntry>,
}

impl Status {
    /// True when there are no entries.
    #[must_use]
    pub fn is_clean(&self) -> bool {
        self.entries.is_empty()
    }

    /// Entries with changes in the index.
    pub fn staged(&self) -> impl Iterator<Item = &StatusEntry> {
        self.entries.iter().filter(|e| {
            !e.conflicted && !e.is_untracked_or_ignored() && e.staged != FileState::Unmodified
        })
    }

    /// Tracked entries with worktree changes.
    pub fn unstaged(&self) -> impl Iterator<Item = &StatusEntry> {
        self.entries.iter().filter(|e| {
            !e.conflicted && !e.is_untracked_or_ignored() && e.unstaged != FileState::Unmodified
        })
    }

    /// Untracked entries.
    pub fn untracked(&self) -> impl Iterator<Item = &StatusEntry> {
        self.entries.iter().filter(|e| e.staged == FileState::Untracked)
    }

    /// Conflicted entries.
    pub fn conflicted(&self) -> impl Iterator<Item = &StatusEntry> {
        self.entries.iter().filter(|e| e.conflicted)
    }
}

/// Error from [`status`].
#[derive(Debug, thiserror::Error)]
pub enum StatusError {
    /// git failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// Output did not parse.
    #[error(transparent)]
    Parse(#[from] ParseError),
}

fn text(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

fn bad(what: &str, rec: &[u8]) -> ParseError {
    ParseError(format!("status: bad {what} record: {}", String::from_utf8_lossy(rec)))
}

fn xy(field: &[u8], rec: &[u8]) -> Result<(FileState, FileState), ParseError> {
    if field.len() != 2 {
        return Err(bad("XY", rec));
    }
    Ok((FileState::from_byte(field[0])?, FileState::from_byte(field[1])?))
}

fn parse_header(line: &[u8], branch: &mut StatusBranch, seen: &mut bool) -> Result<(), ParseError> {
    let s = String::from_utf8_lossy(line);
    let Some(rest) = s.strip_prefix("# ") else { return Ok(()) };
    let (key, value) = rest.split_once(' ').unwrap_or((rest, ""));
    match key {
        "branch.oid" => {
            *seen = true;
            branch.oid = (value != "(initial)").then(|| value.to_string());
        }
        "branch.head" => {
            *seen = true;
            branch.head = (value != "(detached)").then(|| value.to_string());
        }
        "branch.upstream" => {
            *seen = true;
            branch.upstream = Some(value.to_string());
        }
        "branch.ab" => {
            *seen = true;
            let mut it = value.split(' ');
            let a = it.next().and_then(|v| v.strip_prefix('+')).and_then(|v| v.parse().ok());
            let b = it.next().and_then(|v| v.strip_prefix('-')).and_then(|v| v.parse().ok());
            let (Some(a), Some(b)) = (a, b) else { return Err(bad("branch.ab", line)) };
            branch.ahead = a;
            branch.behind = b;
        }
        _ => {}
    }
    Ok(())
}

/// Parse the output of `git status --porcelain=v2 -z [--branch]`.
///
/// # Errors
/// Returns [`ParseError`] on malformed records.
pub fn parse_status(stdout: &[u8]) -> Result<Status, ParseError> {
    let mut branch = StatusBranch { oid: None, head: None, upstream: None, ahead: 0, behind: 0 };
    let mut seen = false;
    let mut entries = Vec::new();
    let mut tokens = stdout.split(|&b| b == 0).filter(|t| !t.is_empty());
    while let Some(rec) = tokens.next() {
        let kind = rec[0];
        // Number of space-separated fields, the last one being the path.
        let nfields = match kind {
            b'#' => {
                parse_header(rec, &mut branch, &mut seen)?;
                continue;
            }
            b'1' => 9,
            b'2' => 10,
            b'u' => 11,
            b'?' | b'!' => 2,
            _ => return Err(bad("unknown", rec)),
        };
        let parts: Vec<&[u8]> = rec.splitn(nfields, |&b| b == b' ').collect();
        if parts.len() != nfields {
            return Err(bad("entry", rec));
        }
        let path = text(parts[nfields - 1]);
        let entry = match kind {
            b'?' | b'!' => {
                let st = if kind == b'?' { FileState::Untracked } else { FileState::Ignored };
                StatusEntry {
                    path,
                    orig_path: None,
                    staged: st,
                    unstaged: st,
                    conflicted: false,
                    submodule: false,
                }
            }
            b'u' => StatusEntry {
                path,
                orig_path: None,
                staged: FileState::Unmerged,
                unstaged: FileState::Unmerged,
                conflicted: true,
                submodule: !parts[2].starts_with(b"N"),
            },
            _ => {
                let (staged, unstaged) = xy(parts[1], rec)?;
                let orig_path = if kind == b'2' {
                    Some(text(tokens.next().ok_or_else(|| bad("rename (missing origin)", rec))?))
                } else {
                    None
                };
                StatusEntry {
                    path,
                    orig_path,
                    staged,
                    unstaged,
                    conflicted: false,
                    submodule: !parts[2].starts_with(b"N"),
                }
            }
        };
        entries.push(entry);
    }
    Ok(Status { branch: seen.then_some(branch), entries })
}

/// Run `git status` in `repo` and parse it.
///
/// # Errors
/// [`StatusError::Git`] if git fails, [`StatusError::Parse`] on unexpected output.
pub async fn status(runner: &GitRunner, repo: &Path) -> Result<Status, StatusError> {
    let out = runner
        .run(
            repo,
            &["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all", "--renames"],
            RunOpts::default(),
        )
        .await?;
    Ok(parse_status(&out.stdout)?)
}
