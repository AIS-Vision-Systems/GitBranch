//! Pull requests: list, detail with review and check summaries (D-028).

use serde::{Deserialize, Serialize};

use crate::client::{GitHub, next_link};
use crate::error::Error;
use crate::http::Transport;
use crate::repos::RepoSlug;

const LIST_MAX_PAGES: usize = 4;
const REVIEW_MAX_PAGES: usize = 2;
const CHECK_MAX_PAGES: usize = 3;

/// Which pull requests to list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PullState {
    /// Open.
    Open,
    /// Closed or merged.
    Closed,
    /// Both.
    All,
}

impl PullState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
            Self::All => "all",
        }
    }
}

#[derive(Deserialize)]
struct RawUser {
    login: String,
}

#[derive(Deserialize)]
struct RawRepoName {
    full_name: String,
}

#[derive(Deserialize)]
struct RawRef {
    #[serde(rename = "ref")]
    name: String,
    sha: String,
    repo: Option<RawRepoName>,
}

#[derive(Deserialize)]
struct RawLabel {
    name: String,
}

#[derive(Deserialize)]
struct RawPull {
    number: u64,
    title: String,
    state: String,
    #[serde(default)]
    draft: bool,
    merged_at: Option<String>,
    user: Option<RawUser>,
    head: RawRef,
    base: RawRef,
    html_url: String,
    created_at: String,
    updated_at: String,
    #[serde(default)]
    labels: Vec<RawLabel>,
}

/// One row of the pull request list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "RawPull")]
pub struct PullSummary {
    /// PR number.
    pub number: u64,
    /// Title.
    pub title: String,
    /// `open` or `closed`.
    pub state: String,
    /// Draft PR.
    pub draft: bool,
    /// Merged (closed with `merged_at`).
    pub merged: bool,
    /// Author login (`ghost` when the account was deleted).
    pub author: String,
    /// Head branch name.
    pub head_ref: String,
    /// Head commit.
    pub head_sha: String,
    /// `owner/name` of the head repository; `None` when the fork was deleted.
    pub head_repo: Option<String>,
    /// Base branch name.
    pub base_ref: String,
    /// `owner/name` of the base repository.
    pub base_repo: String,
    /// Web page.
    pub html_url: String,
    /// Creation time, ISO 8601.
    pub created_at: String,
    /// Last update, ISO 8601.
    pub updated_at: String,
    /// Label names.
    pub labels: Vec<String>,
}

impl From<RawPull> for PullSummary {
    fn from(r: RawPull) -> Self {
        Self {
            number: r.number,
            title: r.title,
            state: r.state,
            draft: r.draft,
            merged: r.merged_at.is_some(),
            author: r.user.map_or_else(|| "ghost".to_string(), |u| u.login),
            head_ref: r.head.name,
            head_sha: r.head.sha,
            head_repo: r.head.repo.map(|x| x.full_name),
            base_ref: r.base.name,
            base_repo: r.base.repo.map(|x| x.full_name).unwrap_or_default(),
            html_url: r.html_url,
            created_at: r.created_at,
            updated_at: r.updated_at,
            labels: r.labels.into_iter().map(|l| l.name).collect(),
        }
    }
}

/// Lists pull requests of `slug`, most recently updated first, up to 200.
///
/// # Errors
/// [`Error`] on transport, status or decoding failures.
pub async fn list_pulls<T: Transport>(
    gh: &GitHub<T>,
    token: &str,
    slug: &RepoSlug,
    state: PullState,
) -> Result<Vec<PullSummary>, Error> {
    let path = format!(
        "/repos/{}/{}/pulls?state={}&sort=updated&direction=desc&per_page=50",
        slug.owner,
        slug.name,
        state.as_str()
    );
    gh.get_all(Some(token), &path, LIST_MAX_PAGES).await
}

/// A review as GitHub returns it.
#[derive(Debug, Clone, Deserialize)]
pub struct RawReview {
    /// Reviewer (null for deleted accounts).
    pub user: Option<RawReviewUser>,
    /// `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED` or `PENDING`.
    pub state: String,
}

/// Reviewer of a [`RawReview`].
#[derive(Debug, Clone, Deserialize)]
pub struct RawReviewUser {
    /// Login.
    pub login: String,
}

/// Final review state of one user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reviewer {
    /// Login.
    pub login: String,
    /// `approved`, `changes_requested`, `commented`, `dismissed` or `pending`.
    pub state: String,
}

/// Reviews condensed to one state per user.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSummary {
    /// Users whose final state is approved.
    pub approved: u32,
    /// Users whose final state is changes requested.
    pub changes_requested: u32,
    /// Users whose final state is commented.
    pub commented: u32,
    /// Per-user final state in first-review order.
    pub reviewers: Vec<Reviewer>,
}

/// Latest review per user in submission order. Approvals and change requests override earlier
/// states; a later comment does not downgrade them; a dismissal resets to `dismissed`.
pub fn summarize_reviews(reviews: &[RawReview]) -> ReviewSummary {
    let mut reviewers: Vec<Reviewer> = Vec::new();
    for r in reviews {
        let Some(user) = &r.user else { continue };
        let new = r.state.to_ascii_lowercase();
        let Some(i) = reviewers.iter().position(|x| x.login == user.login) else {
            reviewers.push(Reviewer { login: user.login.clone(), state: new });
            continue;
        };
        let cur = &mut reviewers[i].state;
        let strong = matches!(cur.as_str(), "approved" | "changes_requested");
        match new.as_str() {
            "approved" | "changes_requested" | "dismissed" => *cur = new,
            "commented" if !strong => *cur = new,
            _ => {}
        }
    }
    let count = |s: &str| {
        u32::try_from(reviewers.iter().filter(|r| r.state == s).count()).unwrap_or(u32::MAX)
    };
    ReviewSummary {
        approved: count("approved"),
        changes_requested: count("changes_requested"),
        commented: count("commented"),
        reviewers,
    }
}

/// One CI check (check run or legacy commit status).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRun {
    /// Check name or status context.
    pub name: String,
    /// `queued`, `in_progress` or `completed`.
    pub status: String,
    /// Outcome once completed.
    pub conclusion: Option<String>,
    /// Details page.
    pub html_url: Option<String>,
}

/// Checks condensed to counts and an overall verdict.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksSummary {
    /// Number of checks.
    pub total: u32,
    /// Succeeded.
    pub success: u32,
    /// Failed, cancelled, timed out or needing action.
    pub failure: u32,
    /// Not completed.
    pub pending: u32,
    /// Neutral, skipped or stale.
    pub skipped: u32,
    /// `none`, `failure`, `pending` or `success`.
    pub overall: String,
    /// The checks.
    pub runs: Vec<CheckRun>,
}

impl Default for ChecksSummary {
    fn default() -> Self {
        Self {
            total: 0,
            success: 0,
            failure: 0,
            pending: 0,
            skipped: 0,
            overall: "none".into(),
            runs: Vec::new(),
        }
    }
}

/// Counts `runs` and derives the overall verdict.
pub fn summarize_checks(runs: Vec<CheckRun>) -> ChecksSummary {
    let mut s = ChecksSummary::default();
    for r in &runs {
        s.total += 1;
        if r.status != "completed" {
            s.pending += 1;
            continue;
        }
        match r.conclusion.as_deref() {
            Some("success") => s.success += 1,
            Some("failure" | "cancelled" | "timed_out" | "action_required") => s.failure += 1,
            _ => s.skipped += 1,
        }
    }
    s.overall = if s.total == 0 {
        "none"
    } else if s.failure > 0 {
        "failure"
    } else if s.pending > 0 {
        "pending"
    } else {
        "success"
    }
    .to_string();
    s.runs = runs;
    s
}

#[derive(Deserialize, Default)]
struct RawCheckRuns {
    #[serde(default)]
    check_runs: Vec<RawCheckRun>,
}

#[derive(Deserialize)]
struct RawCheckRun {
    name: String,
    status: String,
    conclusion: Option<String>,
    html_url: Option<String>,
}

#[derive(Deserialize, Default)]
struct RawCombinedStatus {
    #[serde(default)]
    statuses: Vec<RawStatus>,
}

#[derive(Deserialize)]
struct RawStatus {
    context: String,
    state: String,
    target_url: Option<String>,
}

/// GETs `path` as `R`; NotFound and a plain 403 (no access to checks) give `R::default()`.
async fn get_or_default<T: Transport, R: Default + serde::de::DeserializeOwned>(
    gh: &GitHub<T>,
    token: &str,
    path: &str,
) -> Result<R, Error> {
    match gh.get(Some(token), path).await {
        Ok(res) => res.json(),
        Err(Error::NotFound | Error::Status { status: 403, .. }) => Ok(R::default()),
        Err(e) => Err(e),
    }
}

/// Check runs of a commit, following `Link: rel="next"` up to [`CHECK_MAX_PAGES`] pages.
/// NotFound and a plain 403 (no access to checks) give an empty list.
async fn check_runs<T: Transport>(
    gh: &GitHub<T>,
    token: &str,
    path: &str,
) -> Result<Vec<RawCheckRun>, Error> {
    let mut out = Vec::new();
    let mut res = match gh.get(Some(token), path).await {
        Ok(r) => r,
        Err(Error::NotFound | Error::Status { status: 403, .. }) => return Ok(out),
        Err(e) => return Err(e),
    };
    for page in 1.. {
        out.extend(res.json::<RawCheckRuns>()?.check_runs);
        match res.header("link").and_then(next_link) {
            Some(url) if page < CHECK_MAX_PAGES => res = gh.get_url(Some(token), &url).await?,
            _ => break,
        }
    }
    Ok(out)
}

/// Check runs plus legacy commit statuses of `sha`, summarized.
///
/// # Errors
/// [`Error`]; a missing endpoint or a 403 yields an empty list for that source.
pub async fn checks_for<T: Transport>(
    gh: &GitHub<T>,
    token: &str,
    slug: &RepoSlug,
    sha: &str,
) -> Result<ChecksSummary, Error> {
    let base = format!("/repos/{}/{}/commits/{sha}", slug.owner, slug.name);
    let runs = check_runs(gh, token, &format!("{base}/check-runs?per_page=100")).await?;
    let statuses: RawCombinedStatus = get_or_default(gh, token, &format!("{base}/status")).await?;
    let mut all: Vec<CheckRun> = runs
        .into_iter()
        .map(|r| CheckRun {
            name: r.name,
            status: r.status,
            conclusion: r.conclusion,
            html_url: r.html_url,
        })
        .collect();
    all.extend(statuses.statuses.into_iter().map(|s| {
        let (status, conclusion) = match s.state.as_str() {
            "success" => ("completed", Some("success")),
            "failure" | "error" => ("completed", Some("failure")),
            _ => ("in_progress", None),
        };
        CheckRun {
            name: s.context,
            status: status.into(),
            conclusion: conclusion.map(Into::into),
            html_url: s.target_url,
        }
    }));
    Ok(summarize_checks(all))
}

#[derive(Deserialize)]
struct RawPullDetail {
    #[serde(flatten)]
    pull: RawPull,
    body: Option<String>,
    mergeable: Option<bool>,
    mergeable_state: Option<String>,
    #[serde(default)]
    additions: u64,
    #[serde(default)]
    deletions: u64,
    #[serde(default)]
    changed_files: u64,
    #[serde(default)]
    commits: u64,
    #[serde(default)]
    comments: u64,
    #[serde(default)]
    review_comments: u64,
    merged_by: Option<RawUser>,
}

/// A pull request with its review and check summaries.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullDetail {
    /// The list-row fields.
    #[serde(flatten)]
    pub summary: PullSummary,
    /// Markdown body (shown as plain text in Phase 5).
    pub body: Option<String>,
    /// Mergeable; `None` while GitHub computes it.
    pub mergeable: Option<bool>,
    /// `clean`, `dirty`, `blocked`, ...
    pub mergeable_state: Option<String>,
    /// Added lines.
    pub additions: u64,
    /// Removed lines.
    pub deletions: u64,
    /// Files touched.
    pub changed_files: u64,
    /// Commit count.
    pub commits: u64,
    /// Issue comments.
    pub comments: u64,
    /// Review comments.
    pub review_comments: u64,
    /// Who merged it.
    pub merged_by: Option<String>,
    /// Reviews.
    pub reviews: ReviewSummary,
    /// Checks of the head commit.
    pub checks: ChecksSummary,
}

/// Fetches the PR, then its reviews, then the checks of its head commit. Failures of the last two
/// other than [`Error::Unauthorized`] degrade to empty summaries.
///
/// # Errors
/// [`Error`] if the PR itself cannot be fetched or decoded.
pub async fn get_pull<T: Transport>(
    gh: &GitHub<T>,
    token: &str,
    slug: &RepoSlug,
    number: u64,
) -> Result<PullDetail, Error> {
    let base = format!("/repos/{}/{}/pulls/{number}", slug.owner, slug.name);
    let raw: RawPullDetail = gh.get(Some(token), &base).await?.json()?;
    let head_sha = raw.pull.head.sha.clone();

    let reviews = gh
        .get_all::<RawReview>(
            Some(token),
            &format!("{base}/reviews?per_page=100"),
            REVIEW_MAX_PAGES,
        )
        .await;
    let reviews = match reviews {
        Ok(r) => summarize_reviews(&r),
        Err(Error::Unauthorized) => return Err(Error::Unauthorized),
        Err(e) => {
            tracing::debug!(error = %e, number, "reviews unavailable");
            ReviewSummary::default()
        }
    };
    let checks = match checks_for(gh, token, slug, &head_sha).await {
        Ok(c) => c,
        Err(Error::Unauthorized) => return Err(Error::Unauthorized),
        Err(e) => {
            tracing::debug!(error = %e, number, "checks unavailable");
            ChecksSummary::default()
        }
    };
    Ok(PullDetail {
        summary: raw.pull.into(),
        body: raw.body,
        mergeable: raw.mergeable,
        mergeable_state: raw.mergeable_state,
        additions: raw.additions,
        deletions: raw.deletions,
        changed_files: raw.changed_files,
        commits: raw.commits,
        comments: raw.comments,
        review_comments: raw.review_comments,
        merged_by: raw.merged_by.map(|u| u.login),
        reviews,
        checks,
    })
}
