//! Paginated `git log` parser producing [`Commit`] records.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::ParseError;
use crate::runner::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Size of the first page requested by the graph.
pub const FIRST_PAGE: usize = 2_000;
/// Size of each subsequent chunk requested by the graph.
pub const CHUNK: usize = 10_000;

/// One commit as listed by `git log`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    /// Full object id.
    pub oid: String,
    /// Parent object ids (empty for roots).
    pub parents: Vec<String>,
    /// Author name.
    pub author_name: String,
    /// Author email.
    pub author_email: String,
    /// Author time, unix seconds.
    pub author_time: i64,
    /// Committer time, unix seconds.
    pub committer_time: i64,
    /// Subject line.
    pub subject: String,
    /// Synthetic stash row (`parents[0]` is the base commit), see `graph::stash`.
    #[serde(default)]
    pub stash: bool,
}

/// Commit ordering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogOrder {
    /// `--date-order`.
    Date,
    /// `--topo-order`.
    Topo,
}

/// Parameters of a log page request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQuery {
    /// Ordering.
    pub order: LogOrder,
    /// Number of commits to skip.
    pub skip: usize,
    /// Maximum commits in the page.
    pub limit: usize,
    /// `--all` when true, otherwise `HEAD` only.
    pub all: bool,
    /// Optional author / message / path filters.
    #[serde(default)]
    pub filter: LogFilter,
}

/// Optional filters narrowing the log. Blank strings are ignored.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFilter {
    /// Case-insensitive author name/email substring (`--author`).
    pub author: Option<String>,
    /// Case-insensitive literal substring of the commit message (`--grep`).
    pub message: Option<String>,
    /// Pathspec limiting history to commits touching it.
    pub path: Option<String>,
}

impl LogFilter {
    /// True when at least one filter is non-blank.
    #[must_use]
    pub fn is_active(&self) -> bool {
        [&self.author, &self.message, &self.path]
            .iter()
            .any(|o| o.as_deref().is_some_and(|s| !s.trim().is_empty()))
    }
}

fn non_blank(o: Option<&String>) -> Option<&str> {
    o.map(|s| s.trim()).filter(|s| !s.is_empty())
}

impl Default for LogQuery {
    fn default() -> Self {
        Self {
            order: LogOrder::Date,
            skip: 0,
            limit: FIRST_PAGE,
            all: true,
            filter: LogFilter::default(),
        }
    }
}

/// A page of commits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    /// Commits in this page.
    pub commits: Vec<Commit>,
    /// Whether more commits exist after this page.
    pub has_more: bool,
}

/// Error from [`log_page`].
#[derive(Debug, thiserror::Error)]
pub enum LogError {
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
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| ParseError(format!("invalid {what} in log record")))
}

/// Parse `git log -z --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s` output.
///
/// # Errors
/// Returns [`ParseError`] when a record has fewer than seven fields or a bad timestamp.
pub fn parse_log(stdout: &[u8]) -> Result<Vec<Commit>, ParseError> {
    let mut out = Vec::new();
    for rec in stdout.split(|b| *b == 0) {
        if rec.is_empty() {
            continue;
        }
        let mut f = rec.splitn(7, |b| *b == 0x1f);
        let mut next = |name: &str| {
            f.next().ok_or_else(|| ParseError(format!("log record missing field {name}")))
        };
        let oid = text(next("oid")?);
        let parents =
            next("parents")?.split(|b| *b == b' ').filter(|p| !p.is_empty()).map(text).collect();
        let author_name = text(next("author name")?);
        let author_email = text(next("author email")?);
        let author_time = num(next("author time")?, "author time")?;
        let committer_time = num(next("committer time")?, "committer time")?;
        let subject = text(next("subject")?);
        out.push(Commit {
            oid,
            parents,
            author_name,
            author_email,
            author_time,
            committer_time,
            subject,
            stash: false,
        });
    }
    Ok(out)
}

/// Fetch one page of the commit log.
///
/// # Errors
/// [`LogError::Git`] if git fails (an unborn repository yields an empty page instead),
/// [`LogError::Parse`] on malformed output.
pub async fn log_page(
    runner: &GitRunner,
    repo: &Path,
    query: &LogQuery,
) -> Result<LogPage, LogError> {
    let order = match query.order {
        LogOrder::Date => "--date-order",
        LogOrder::Topo => "--topo-order",
    };
    let mut args: Vec<String> =
        vec!["log".into(), "-z".into(), "--no-show-signature".into(), order.into()];
    if query.all {
        // Stash entries are listed by the stash panel, not drawn as anonymous commits.
        args.push("--exclude=refs/stash".into());
        args.push("--all".into());
    } else {
        args.push("HEAD".into());
    }
    args.push(format!("--skip={}", query.skip));
    args.push(format!("--max-count={}", query.limit.saturating_add(1)));
    args.push("--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s".into());
    let f = &query.filter;
    let (author, message) = (non_blank(f.author.as_ref()), non_blank(f.message.as_ref()));
    let path = non_blank(f.path.as_ref());
    if author.is_some() || message.is_some() {
        // Both apply to --author and --grep: case-insensitive literal matching.
        args.push("--regexp-ignore-case".into());
        args.push("--fixed-strings".into());
    }
    if let Some(a) = author {
        args.push(format!("--author={a}"));
    }
    if let Some(m) = message {
        args.push(format!("--grep={m}"));
    }
    args.push("--".into());
    if let Some(p) = path {
        // Global option: must precede the subcommand.
        args.insert(0, "--literal-pathspecs".into());
        args.push(p.to_owned());
    }
    match runner.run(repo, &args, RunOpts::default()).await {
        Ok(o) => {
            let mut commits = parse_log(&o.stdout)?;
            let has_more = commits.len() > query.limit;
            commits.truncate(query.limit);
            Ok(LogPage { commits, has_more })
        }
        Err(e)
            if matches!(e.kind, GitErrorKind::ExitCode(128) | GitErrorKind::NotFound)
                && (e.stderr.contains("does not have any commits")
                    || e.stderr.contains("bad default revision")
                    || e.stderr.contains("unknown revision")
                    || e.stderr.contains("bad revision 'HEAD'")) =>
        {
            Ok(LogPage { commits: Vec::new(), has_more: false })
        }
        Err(e) => Err(e.into()),
    }
}
