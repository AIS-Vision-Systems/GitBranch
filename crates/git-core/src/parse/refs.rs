//! Branches, remote branches and tags via `git for-each-ref`, plus HEAD detection.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::ParseError;
use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// `for-each-ref --format` string. Fields are separated by NUL (`%00`) and every record ends with
/// the ASCII record separator (`%1e`); git adds a newline after each record, which the parser trims.
/// Field order: refname, objectname, peeled objectname, objecttype, upstream short name,
/// upstream track, HEAD marker, symref target.
pub const FOR_EACH_REF_FORMAT: &str = "%(refname)%00%(objectname)%00%(*objectname)%00%(objecttype)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(symref)%1e";

const FIELDS: usize = 8;

/// What a ref points at, by namespace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    /// `refs/heads/*`.
    LocalBranch,
    /// `refs/remotes/<remote>/*`.
    #[serde(rename_all = "camelCase")]
    RemoteBranch {
        /// Remote name (first path segment after `refs/remotes/`).
        remote: String,
    },
    /// `refs/tags/*`.
    #[serde(rename_all = "camelCase")]
    Tag {
        /// True for annotated tags (a tag object, not a bare commit pointer).
        annotated: bool,
    },
}

/// Upstream tracking info of a local branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    /// Short upstream name, e.g. `origin/main`.
    pub name: String,
    /// Commits the local branch has that the upstream lacks.
    pub ahead: u32,
    /// Commits the upstream has that the local branch lacks.
    pub behind: u32,
    /// The upstream ref no longer exists.
    pub gone: bool,
}

/// A branch or tag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ref {
    /// Short name: `main`, `origin/main`, `v1.0`.
    pub name: String,
    /// Full name: `refs/heads/main`, `refs/remotes/origin/main`, `refs/tags/v1.0`.
    pub full_name: String,
    /// Namespace of the ref.
    pub kind: RefKind,
    /// Commit oid; for annotated tags the peeled commit oid.
    pub target: String,
    /// Upstream info (local branches only).
    pub upstream: Option<Upstream>,
    /// True for the checked-out local branch.
    pub is_head: bool,
}

/// State of `HEAD`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Head {
    /// Commit oid; `None` when the branch is unborn.
    pub oid: Option<String>,
    /// Short branch name; `None` when detached.
    pub branch: Option<String>,
    /// `HEAD` points directly at a commit.
    pub detached: bool,
}

/// All refs plus `HEAD`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Refs {
    /// HEAD state.
    pub head: Head,
    /// Local branches, remote branches and tags, in git's sorted order.
    pub refs: Vec<Ref>,
}

/// Failure of [`list_refs`]: git failed or its output was malformed.
#[derive(Debug, Clone, thiserror::Error)]
pub enum RefsError {
    /// A git invocation failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// The output of `for-each-ref` could not be parsed.
    #[error(transparent)]
    Parse(#[from] ParseError),
}

fn parse_track(track: &str) -> (u32, u32, bool) {
    let inner = track.trim().trim_start_matches('[').trim_end_matches(']');
    if inner == "gone" {
        return (0, 0, true);
    }
    let (mut ahead, mut behind) = (0, 0);
    for part in inner.split(',') {
        let part = part.trim();
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    (ahead, behind, false)
}

/// Parses `for-each-ref` output produced with [`FOR_EACH_REF_FORMAT`].
///
/// Symbolic refs (such as `refs/remotes/origin/HEAD`) are skipped.
pub fn parse_for_each_ref(stdout: &[u8]) -> Result<Vec<Ref>, ParseError> {
    let text = String::from_utf8_lossy(stdout);
    let mut out = Vec::new();
    for record in text.split('\u{1e}') {
        let record = record.trim_matches(['\n', '\r']);
        if record.is_empty() {
            continue;
        }
        let f: Vec<&str> = record.split('\0').collect();
        if f.len() != FIELDS {
            return Err(ParseError(format!(
                "for-each-ref record has {} fields: {record:?}",
                f.len()
            )));
        }
        let [full, oid, peeled, otype, up_name, up_track, head, symref] =
            [f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7]];
        if !symref.is_empty() {
            continue;
        }
        let (name, kind) = if let Some(n) = full.strip_prefix("refs/heads/") {
            (n, RefKind::LocalBranch)
        } else if let Some(n) = full.strip_prefix("refs/remotes/") {
            let remote = n.split('/').next().unwrap_or(n).to_string();
            (n, RefKind::RemoteBranch { remote })
        } else if let Some(n) = full.strip_prefix("refs/tags/") {
            (n, RefKind::Tag { annotated: otype == "tag" })
        } else {
            return Err(ParseError(format!("unexpected ref namespace: {full}")));
        };
        let target = if peeled.is_empty() { oid } else { peeled };
        let is_local = kind == RefKind::LocalBranch;
        let upstream = (is_local && !up_name.is_empty()).then(|| {
            let (ahead, behind, gone) = parse_track(up_track);
            Upstream { name: up_name.to_string(), ahead, behind, gone }
        });
        out.push(Ref {
            name: name.to_string(),
            full_name: full.to_string(),
            kind,
            target: target.to_string(),
            upstream,
            is_head: is_local && head == "*",
        });
    }
    Ok(out)
}

/// Lists branches and tags and detects `HEAD` (detached / unborn are states, not errors).
pub async fn list_refs(runner: &GitRunner, repo: &Path) -> Result<Refs, RefsError> {
    let format = format!("--format={FOR_EACH_REF_FORMAT}");
    let out = runner
        .run(
            repo,
            &["for-each-ref", &format, "refs/heads", "refs/remotes", "refs/tags"],
            RunOpts::default(),
        )
        .await?;
    let refs = parse_for_each_ref(&out.stdout)?;

    let branch = match runner
        .run(repo, &["symbolic-ref", "-q", "--short", "HEAD"], RunOpts::default())
        .await
    {
        Ok(o) => Some(o.stdout_str()),
        Err(e) if matches!(e.kind, GitErrorKind::ExitCode(_)) => None,
        Err(e) => return Err(e.into()),
    };
    let oid = match runner
        .run(repo, &["rev-parse", "-q", "--verify", "HEAD"], RunOpts::default())
        .await
    {
        Ok(o) => Some(o.stdout_str()),
        Err(e) if matches!(e.kind, GitErrorKind::ExitCode(_)) => None,
        Err(e) => return Err(e.into()),
    };
    let detached = branch.is_none();
    Ok(Refs { head: Head { oid, branch, detached }, refs })
}
