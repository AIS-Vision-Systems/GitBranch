//! Per-file unified diffs parsed into hunks with line numbers.
//!
//! Commit targets diff `<oid>^1` against `<oid>` explicitly (or use `diff-tree --root` for root
//! commits), i.e. against the first parent only, matching the file list of [`super::show`]. Renamed files are
//! requested by their new path only (`-- <path>`), so the diff shows them as additions; pass both
//! paths later if rename-aware diffs are needed.

use std::path::{Component, Path};

use serde::{Deserialize, Serialize};

use super::ParseError;
use crate::runner::{GitError, GitRunner, RunOpts};

/// What to diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffTarget {
    /// A file in a commit, against its first parent (or the empty tree for roots).
    Commit {
        /// Commit id.
        oid: String,
        /// Path (new path for renames).
        path: String,
    },
    /// Index against HEAD.
    Staged {
        /// Path.
        path: String,
    },
    /// Work tree against the index.
    Unstaged {
        /// Path.
        path: String,
    },
    /// An untracked file, shown as all additions.
    Untracked {
        /// Path.
        path: String,
    },
}

/// Kind of a diff line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    /// Unchanged line.
    Context,
    /// Added line.
    Add,
    /// Deleted line.
    Del,
}

/// One line of a hunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    /// Line kind.
    pub kind: LineKind,
    /// Text without the leading marker and without the newline.
    pub text: String,
    /// Line number in the old file (not for additions).
    pub old_no: Option<u32>,
    /// Line number in the new file (not for deletions).
    pub new_no: Option<u32>,
    /// True when followed by `\ No newline at end of file`.
    pub no_newline: bool,
}

/// One hunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    /// First old line.
    pub old_start: u32,
    /// Old line count.
    pub old_lines: u32,
    /// First new line.
    pub new_start: u32,
    /// New line count.
    pub new_lines: u32,
    /// Text after the closing `@@`.
    pub header: String,
    /// Lines of the hunk.
    pub lines: Vec<DiffLine>,
}

/// The diff of one file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// Old path (`None` for added files).
    pub old_path: Option<String>,
    /// New path (`None` for deleted files).
    pub new_path: Option<String>,
    /// Binary file: no hunks.
    pub binary: bool,
    /// Hunks.
    pub hunks: Vec<Hunk>,
    /// Combined diff of a conflicted file (`diff --cc`): hunks are not parsed.
    #[serde(default)]
    pub combined: bool,
    /// Untracked file above the size cap: content is not read.
    #[serde(default)]
    pub too_large: bool,
    /// Old file mode.
    pub old_mode: Option<String>,
    /// New file mode.
    pub new_mode: Option<String>,
}

/// Error from [`file_diff`].
#[derive(Debug, thiserror::Error)]
pub enum DiffError {
    /// The git process failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// The output could not be parsed (or an untracked file could not be read).
    #[error(transparent)]
    Parse(#[from] ParseError),
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// Unquote a git C-style quoted path (`\a \b \f \n \r \t \v \\ \"` and octal `\NNN`).
fn unquote(s: &str) -> String {
    let Some(inner) = s.strip_prefix('"').and_then(|r| r.strip_suffix('"')) else {
        return s.to_string();
    };
    let b = inner.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            i += 1;
            match b[i] {
                b'a' => out.push(0x07),
                b'b' => out.push(0x08),
                b'f' => out.push(0x0c),
                b'n' => out.push(b'\n'),
                b'r' => out.push(b'\r'),
                b't' => out.push(b'\t'),
                b'v' => out.push(0x0b),
                c @ b'0'..=b'3'
                    if i + 2 < b.len()
                        && (b'0'..=b'7').contains(&b[i + 1])
                        && (b'0'..=b'7').contains(&b[i + 2]) =>
                {
                    out.push((c - b'0') * 64 + (b[i + 1] - b'0') * 8 + (b[i + 2] - b'0'));
                    i += 2;
                }
                c => out.push(c),
            }
        } else {
            out.push(b[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn strip_ab(p: String) -> String {
    match p.strip_prefix("a/").or_else(|| p.strip_prefix("b/")) {
        Some(s) => s.to_string(),
        None => p,
    }
}

/// Path from a `---`/`+++` line value: `None` for `/dev/null`, otherwise without `a/`/`b/`.
fn marker_path(v: &str) -> Option<String> {
    let v = v.trim_end_matches('\t');
    if v == "/dev/null" {
        return None;
    }
    Some(strip_ab(unquote(v)))
}

/// Paths from `diff --git a/x b/y` (ambiguous with spaces; prefers equal halves).
fn git_header_paths(rest: &str) -> Option<(String, String)> {
    if rest.starts_with('"') {
        let b = rest.as_bytes();
        let mut i = 1;
        while i < b.len() && b[i] != b'"' {
            i += if b[i] == b'\\' { 2 } else { 1 };
        }
        let (l, r) = rest.split_at((i + 1).min(rest.len()));
        return Some((strip_ab(unquote(l)), strip_ab(unquote(r.trim_start()))));
    }
    let mut first = None;
    for (i, _) in rest.match_indices(" b/").chain(rest.match_indices(" \"b/")) {
        let l = rest[..i].strip_prefix("a/")?.to_string();
        let r = strip_ab(unquote(rest[i + 1..].trim_start()));
        if l == r {
            return Some((l, r));
        }
        first.get_or_insert((l, r));
    }
    first
}

fn parse_hunk_header(line: &str) -> Result<Hunk, ParseError> {
    let bad = || ParseError(format!("invalid hunk header: {line}"));
    let rest = line.strip_prefix("@@ -").ok_or_else(bad)?;
    let (ranges, header) = rest.split_once(" @@").ok_or_else(bad)?;
    let (old, new) = ranges.split_once(" +").ok_or_else(bad)?;
    let range = |r: &str| -> Result<(u32, u32), ParseError> {
        match r.split_once(',') {
            Some((a, b)) => Ok((a.parse().map_err(|_| bad())?, b.parse().map_err(|_| bad())?)),
            None => Ok((r.parse().map_err(|_| bad())?, 1)),
        }
    };
    let (old_start, old_lines) = range(old)?;
    let (new_start, new_lines) = range(new)?;
    Ok(Hunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        header: header.strip_prefix(' ').unwrap_or(header).to_string(),
        lines: Vec::new(),
    })
}

fn hunk_done(h: &Hunk) -> bool {
    let (mut o, mut n) = (h.old_lines, h.new_lines);
    for l in &h.lines {
        match l.kind {
            LineKind::Context => {
                o = o.saturating_sub(1);
                n = n.saturating_sub(1);
            }
            LineKind::Add => n = n.saturating_sub(1),
            LineKind::Del => o = o.saturating_sub(1),
        }
    }
    o == 0 && n == 0
}

/// Parse one file's `diff --git` section. Empty input yields an empty [`FileDiff`].
///
/// # Errors
/// Returns [`ParseError`] on a malformed hunk header.
pub fn parse_unified(stdout: &[u8]) -> Result<FileDiff, ParseError> {
    let mut d = FileDiff::default();
    let (mut old_no, mut new_no) = (0u32, 0u32);
    let mut cur: Option<Hunk> = None;
    let (mut explicit_old, mut explicit_new, mut is_new, mut is_deleted) =
        (false, false, false, false);
    let mut raw: Vec<&[u8]> = stdout.split(|b| *b == b'\n').collect();
    if raw.last().is_some_and(|l| l.is_empty()) {
        raw.pop();
    }
    for rl in raw {
        let line = text(rl);
        if cur.is_none() && (line.starts_with("diff --cc ") || line.starts_with("diff --combined "))
        {
            d.combined = true;
            d.hunks.clear();
            return Ok(d);
        }
        if let Some(h) = cur.as_mut() {
            if !(line.starts_with("@@") || line.starts_with("diff --git ") && hunk_done(h)) {
                let mk = |kind, t: &str, o: Option<u32>, n: Option<u32>| DiffLine {
                    kind,
                    text: t.to_string(),
                    old_no: o,
                    new_no: n,
                    no_newline: false,
                };
                if let Some(t) = line.strip_prefix('+') {
                    h.lines.push(mk(LineKind::Add, t, None, Some(new_no)));
                    new_no += 1;
                } else if let Some(t) = line.strip_prefix('-') {
                    h.lines.push(mk(LineKind::Del, t, Some(old_no), None));
                    old_no += 1;
                } else if line.starts_with('\\') {
                    if let Some(l) = h.lines.last_mut() {
                        l.no_newline = true;
                    }
                } else {
                    let t = line.strip_prefix(' ').unwrap_or(&line);
                    h.lines.push(mk(LineKind::Context, t, Some(old_no), Some(new_no)));
                    old_no += 1;
                    new_no += 1;
                }
                continue;
            }
        }
        if line.starts_with("@@") {
            if let Some(h) = cur.take() {
                d.hunks.push(h);
            }
            let h = parse_hunk_header(&line)?;
            old_no = h.old_start;
            new_no = h.new_start;
            cur = Some(h);
            continue;
        }
        if cur.is_some() {
            break; // next file section
        }
        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some((a, b)) = git_header_paths(rest) {
                d.old_path = Some(a);
                d.new_path = Some(b);
            }
        } else if let Some(v) = line.strip_prefix("--- ") {
            d.old_path = marker_path(v);
            explicit_old = true;
        } else if let Some(v) = line.strip_prefix("+++ ") {
            d.new_path = marker_path(v);
            explicit_new = true;
        } else if let Some(v) =
            line.strip_prefix("rename from ").or(line.strip_prefix("copy from "))
        {
            d.old_path = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("rename to ").or(line.strip_prefix("copy to ")) {
            d.new_path = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("old mode ") {
            d.old_mode = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("new mode ") {
            d.new_mode = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("new file mode ") {
            d.new_mode = Some(v.to_string());
            is_new = true;
        } else if let Some(v) = line.strip_prefix("deleted file mode ") {
            d.old_mode = Some(v.to_string());
            is_deleted = true;
        } else if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            d.binary = true;
        }
    }
    if let Some(h) = cur {
        d.hunks.push(h);
    }
    if is_new && !explicit_old {
        d.old_path = None;
    }
    if is_deleted && !explicit_new {
        d.new_path = None;
    }
    Ok(d)
}

/// Largest untracked file whose content is read for a synthetic diff.
const MAX_UNTRACKED_BYTES: u64 = 8 * 1024 * 1024;

fn untracked_diff(repo: &Path, path: &str) -> Result<FileDiff, ParseError> {
    let rel = Path::new(path);
    if rel.as_os_str().is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(ParseError(format!("path escapes the repository: {path}")));
    }
    let full = repo.join(rel);
    let meta = std::fs::symlink_metadata(&full)
        .map_err(|e| ParseError(format!("cannot read {path}: {e}")))?;
    if !meta.is_file() {
        return Err(ParseError(format!("not a regular file: {path}")));
    }
    let mut d = FileDiff { new_path: Some(path.to_string()), ..FileDiff::default() };
    if meta.len() > MAX_UNTRACKED_BYTES {
        d.too_large = true;
        return Ok(d);
    }
    let bytes = std::fs::read(&full).map_err(|e| ParseError(format!("cannot read {path}: {e}")))?;
    if bytes[..bytes.len().min(8192)].contains(&0) {
        d.binary = true;
        return Ok(d);
    }
    if bytes.is_empty() {
        return Ok(d);
    }
    let ends_nl = bytes.ends_with(b"\n");
    let body = bytes.strip_suffix(b"\n").unwrap_or(&bytes);
    let mut lines: Vec<DiffLine> = body
        .split(|b| *b == b'\n')
        .zip(1u32..)
        .map(|(l, n)| DiffLine {
            kind: LineKind::Add,
            text: text(l),
            old_no: None,
            new_no: Some(n),
            no_newline: false,
        })
        .collect();
    if !ends_nl {
        if let Some(l) = lines.last_mut() {
            l.no_newline = true;
        }
    }
    let n = u32::try_from(lines.len()).unwrap_or(u32::MAX);
    d.hunks.push(Hunk {
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: n,
        header: String::new(),
        lines,
    });
    Ok(d)
}

/// Diff one file for the given target.
///
/// # Errors
/// [`DiffError::Git`] if git fails, [`DiffError::Parse`] on malformed output or an unreadable
/// untracked file.
pub async fn file_diff(
    runner: &GitRunner,
    repo: &Path,
    target: &DiffTarget,
) -> Result<FileDiff, DiffError> {
    let common = [
        "-p",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ];
    let mut args: Vec<&str> = Vec::new();
    let parent;
    match target {
        DiffTarget::Commit { oid, path } => {
            parent = format!("{oid}^1");
            let has_parent = runner
                .run(repo, &["rev-parse", "--verify", "--quiet", &parent], opts())
                .await
                .is_ok();
            if has_parent {
                args.push("diff-tree");
                args.extend(common);
                args.extend(["-M", "-U3", &parent, oid, "--", path]);
            } else {
                args.extend(["diff-tree", "--root"]);
                args.extend(common);
                args.extend(["-M", "-U3", "--no-commit-id", oid, "--", path]);
            }
        }
        DiffTarget::Staged { path } => {
            args.extend(["diff", "--cached"]);
            args.extend(common);
            args.extend(["-M", "--", path]);
        }
        DiffTarget::Unstaged { path } => {
            args.push("diff");
            args.extend(common);
            args.extend(["--", path]);
        }
        DiffTarget::Untracked { path } => return Ok(untracked_diff(repo, path)?),
    }
    let out = runner.run(repo, &args, opts()).await?;
    Ok(parse_unified(&out.stdout)?)
}

/// Literal pathspecs: user paths such as `a[1].txt` must not be globs.
fn opts() -> RunOpts {
    RunOpts { env: vec![("GIT_LITERAL_PATHSPECS".into(), "1".into())], ..RunOpts::default() }
}
