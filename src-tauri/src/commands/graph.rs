//! Commands feeding the commit graph, branch list and status panels.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use git_core::graph::{LayoutState, Row};
use git_core::parse::log::{Commit, LogFilter, LogOrder, LogPage, LogQuery, log_page};
use git_core::parse::refs::Refs;
use git_core::parse::status::Status;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppError;
use crate::state::{AppState, OpenRepo};

/// Upper bound passed as `limit` when fetching the rest of the log in one call (fits git's `int`).
const REMAINDER_LIMIT: usize = 1_000_000_000;

/// Request for one chunk of the graph.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphQuery {
    /// Commit ordering.
    pub order: LogOrder,
    /// Number of commits already loaded.
    pub skip: usize,
    /// Maximum commits in this chunk.
    pub limit: usize,
    /// All refs (`--all`) instead of HEAD only.
    pub all: bool,
    /// Author filter (case-insensitive literal).
    #[serde(default)]
    pub author: Option<String>,
    /// Commit message filter (case-insensitive literal).
    #[serde(default)]
    pub message: Option<String>,
    /// Path filter (pathspec).
    #[serde(default)]
    pub path: Option<String>,
}

/// One chunk of commits with their lane rows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPage {
    /// Commits of this chunk.
    pub commits: Vec<Commit>,
    /// Lane rows, parallel to `commits`.
    pub rows: Vec<Row>,
    /// Whether more commits exist.
    pub has_more: bool,
    /// The `skip` to request the next chunk with.
    pub next_skip: usize,
}

/// Incremental layout and commit buffer of one repository.
#[derive(Debug)]
pub struct Entry {
    order: LogOrder,
    all: bool,
    /// False until the first page of the current `(order, all)` has been applied.
    init: bool,
    layout: LayoutState,
    /// Commits fetched so far (empty once the whole log was served and the buffers dropped).
    commits: Vec<Commit>,
    /// Lane rows parallel to `commits`.
    rows: Vec<Row>,
    /// High-water mark of rows handed to the UI.
    served: usize,
    /// True when git reported nothing after the fetched commits.
    complete: bool,
}

impl Entry {
    fn new(order: LogOrder, all: bool) -> Self {
        Self {
            order,
            all,
            init: false,
            layout: LayoutState::new(),
            commits: Vec::new(),
            rows: Vec::new(),
            served: 0,
            complete: false,
        }
    }

    /// True when the buffers were released after the whole log was served.
    fn dropped(&self) -> bool {
        self.served > 0 && self.rows.is_empty()
    }
}

/// Per-repository incremental layout state, managed by Tauri.
///
/// Each repository has its own async mutex held for the whole `load_graph` call, so requests of
/// one repository never interleave (a `loadMore` cannot apply a stale page after a refresh).
/// The first page is fetched with the requested limit; the first request after it fetches the
/// whole remainder in ONE `git log` call (paging with `--skip` makes git re-walk history every
/// time) and later chunks are served from memory. Once the entire log was served the buffers are
/// dropped; a later request for an already served range then fails with `graph.out_of_order`
/// and the UI reloads from 0. Before that, re-requesting a served range is idempotent.
#[derive(Default)]
pub struct GraphCache {
    entries: Mutex<HashMap<String, Arc<tauri::async_runtime::Mutex<Entry>>>>,
}

impl GraphCache {
    /// Drops the cached layout of a repository.
    pub fn forget(&self, repo_id: &str) {
        if let Ok(mut m) = self.entries.lock() {
            m.remove(repo_id);
        }
    }

    fn entry(&self, repo_id: &str) -> Result<Arc<tauri::async_runtime::Mutex<Entry>>, AppError> {
        let mut m = self
            .entries
            .lock()
            .map_err(|_| AppError::new("graph.cache_poisoned", "Graph cache is unavailable"))?;
        Ok(m.entry(repo_id.to_owned())
            .or_insert_with(|| {
                Arc::new(tauri::async_runtime::Mutex::new(Entry::new(LogOrder::Date, true)))
            })
            .clone())
    }
}

/// What a request needs before it can be served.
#[derive(Debug, PartialEq, Eq)]
enum Need {
    /// Everything is buffered.
    Serve,
    /// Run `git log` with this skip and limit and pass the page to [`finish`].
    Fetch { skip: usize, limit: usize },
}

fn out_of_order() -> AppError {
    AppError::new("graph.out_of_order", "Graph pages must be loaded in order")
}

/// Validates the request and decides whether git must be asked for more commits.
fn plan(e: &mut Entry, q: &GraphQuery) -> Result<Need, AppError> {
    if q.skip == 0 {
        *e = Entry::new(q.order, q.all);
        return Ok(Need::Fetch { skip: 0, limit: q.limit });
    }
    if !e.init || e.order != q.order || e.all != q.all || q.skip > e.served {
        return Err(out_of_order());
    }
    if e.dropped() && q.skip < e.served {
        return Err(out_of_order());
    }
    if q.skip == e.rows.len() && !e.complete {
        return Ok(Need::Fetch { skip: e.rows.len(), limit: REMAINDER_LIMIT });
    }
    Ok(Need::Serve)
}

/// Applies the fetched page (if any) and serves the requested slice from the buffers.
fn finish(e: &mut Entry, q: &GraphQuery, page: Option<LogPage>) -> GraphPage {
    if let Some(p) = page {
        let rows = e.layout.push_all(&p.commits);
        e.rows.extend(rows);
        e.commits.extend(p.commits);
        e.complete = !p.has_more;
        e.init = true;
    }
    if e.dropped() {
        // Whole log already served and released: nothing left after `skip == served`.
        return GraphPage {
            commits: Vec::new(),
            rows: Vec::new(),
            has_more: false,
            next_skip: e.served,
        };
    }
    let len = e.rows.len();
    // The first page is served whole; later chunks are `limit` rows from the buffer.
    let end = if q.skip == 0 { len } else { q.skip.saturating_add(q.limit).min(len) };
    let out = GraphPage {
        commits: e.commits[q.skip..end].to_vec(),
        rows: e.rows[q.skip..end].to_vec(),
        has_more: end < len || !e.complete,
        next_skip: end,
    };
    e.served = e.served.max(end);
    if e.complete && e.served == len && len > 0 {
        e.commits = Vec::new();
        e.rows = Vec::new();
    }
    out
}

/// Plan, fetch (via `fetch(skip, limit)`) and serve in one synchronous step.
#[cfg(test)]
fn serve(
    e: &mut Entry,
    q: &GraphQuery,
    mut fetch: impl FnMut(usize, usize) -> LogPage,
) -> Result<GraphPage, AppError> {
    let page = match plan(e, q)? {
        Need::Serve => None,
        Need::Fetch { skip, limit } => Some(fetch(skip, limit)),
    };
    Ok(finish(e, q, page))
}

/// Drops parent ids that are not themselves in `commits` (filtered logs keep the true parents).
fn prune_parents(commits: &mut [Commit]) {
    let known: std::collections::HashSet<String> = commits.iter().map(|c| c.oid.clone()).collect();
    for c in commits {
        c.parents.retain(|p| known.contains(p));
    }
}

fn open(state: &AppState, repo_id: &str) -> Result<OpenRepo, AppError> {
    state.get(repo_id).ok_or_else(|| AppError::new("repo.not_open", "Repository is not open"))
}

/// Loads one chunk of the commit graph, continuing the cached layout when `skip` is in order.
#[tauri::command]
pub async fn load_graph(
    state: State<'_, AppState>,
    cache: State<'_, GraphCache>,
    repo_id: String,
    query: GraphQuery,
) -> Result<GraphPage, AppError> {
    let started = std::time::Instant::now();
    let repo = open(&state, &repo_id)?;
    let filter = LogFilter {
        author: query.author.clone(),
        message: query.message.clone(),
        path: query.path.clone(),
    };
    if filter.is_active() {
        // Stateless: never touches the unfiltered cache. Re-fetches from 0 and lays out the
        // whole prefix so lanes stay consistent. Git keeps the true parents, so those outside
        // the filtered set are pruned first, otherwise every match would open a dangling lane.
        let q = LogQuery {
            order: query.order,
            skip: 0,
            limit: query.skip.saturating_add(query.limit),
            all: query.all,
            filter,
        };
        let p = log_page(&state.runner, &repo.info.work_tree, &q).await?;
        let mut p = p;
        prune_parents(&mut p.commits);
        let rows = LayoutState::new().push_all(&p.commits);
        let start = query.skip.min(p.commits.len());
        return Ok(GraphPage {
            commits: p.commits[start..].to_vec(),
            rows: rows[start..].to_vec(),
            has_more: p.has_more,
            next_skip: p.commits.len(),
        });
    }
    let entry = cache.entry(&repo_id)?;
    let mut e = entry.lock().await;
    let page = match plan(&mut e, &query)? {
        Need::Serve => None,
        Need::Fetch { skip, limit } => {
            let q = LogQuery {
                order: query.order,
                skip,
                limit,
                all: query.all,
                filter: LogFilter::default(),
            };
            Some(log_page(&state.runner, &repo.info.work_tree, &q).await?)
        }
    };
    let out = finish(&mut e, &query, page);
    tracing::info!(
        target: "graph",
        repo = %repo_id,
        skip = query.skip,
        rows = out.rows.len(),
        has_more = out.has_more,
        ms = started.elapsed().as_millis(),
        "load_graph"
    );
    Ok(out)
}

/// Lists branches, remotes and tags.
#[tauri::command]
pub async fn list_refs(state: State<'_, AppState>, repo_id: String) -> Result<Refs, AppError> {
    let repo = open(&state, &repo_id)?;
    Ok(git_core::parse::refs::list_refs(&state.runner, &repo.info.work_tree).await?)
}

/// Working-tree status.
#[tauri::command]
pub async fn repo_status(state: State<'_, AppState>, repo_id: String) -> Result<Status, AppError> {
    let repo = open(&state, &repo_id)?;
    Ok(git_core::parse::status::status(&state.runner, &repo.info.work_tree).await?)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::many_single_char_names)] // tests: unwrap and terse locals
mod tests {
    use super::*;
    use git_core::graph::layout::layout;
    use std::cell::RefCell;

    fn commits() -> Vec<Commit> {
        // c0 <- c1 <- c2 <- c3, plus c1b branching from c0 merged into c3.
        let mk = |oid: &str, parents: &[&str]| Commit {
            oid: oid.into(),
            parents: parents.iter().map(|p| (*p).into()).collect(),
            author_name: "a".into(),
            author_email: "a@x".into(),
            author_time: 0,
            committer_time: 0,
            subject: oid.into(),
        };
        vec![
            mk("c3", &["c2", "c1b"]),
            mk("c2", &["c1"]),
            mk("c1b", &["c0"]),
            mk("c1", &["c0"]),
            mk("c0", &[]),
        ]
    }

    #[test]
    fn pruned_filtered_linear_history_uses_one_lane() {
        let mk = |oid: &str, parent: &str| Commit {
            oid: oid.into(),
            parents: vec![parent.into()],
            author_name: "a".into(),
            author_email: "a@x".into(),
            author_time: 0,
            committer_time: 0,
            subject: oid.into(),
        };
        // Matches m3, m2, m1 of a longer linear history; true parents skip unmatched commits.
        let mut v = vec![mk("m3", "x2"), mk("m2", "x1"), mk("m1", "x0")];
        prune_parents(&mut v);
        assert!(v.iter().all(|c| c.parents.is_empty()));
        let rows = layout(&v);
        assert!(rows.iter().all(|r| r.lane == 0));
    }

    fn q(order: LogOrder, skip: usize, limit: usize) -> GraphQuery {
        GraphQuery { order, skip, limit, all: true, author: None, message: None, path: None }
    }

    /// Fake `git log`: serves `all[skip..]` honouring `limit`, recording each call.
    fn fake<'a>(
        all: &'a [Commit],
        calls: &'a RefCell<Vec<(usize, usize)>>,
    ) -> impl FnMut(usize, usize) -> LogPage + 'a {
        move |skip, limit| {
            calls.borrow_mut().push((skip, limit));
            let rest = &all[skip.min(all.len())..];
            let n = rest.len().min(limit);
            LogPage { commits: rest[..n].to_vec(), has_more: rest.len() > n }
        }
    }

    #[test]
    fn remainder_fetched_once_then_served_from_memory() {
        let all = commits();
        let calls = RefCell::new(Vec::new());
        let mut f = fake(&all, &calls);
        let mut e = Entry::new(LogOrder::Date, true);
        let a = serve(&mut e, &q(LogOrder::Date, 0, 2), &mut f).unwrap();
        assert_eq!((a.next_skip, a.rows.len(), a.has_more), (2, 2, true));
        let b = serve(&mut e, &q(LogOrder::Date, 2, 1), &mut f).unwrap();
        assert_eq!((b.next_skip, b.has_more), (3, true));
        let c = serve(&mut e, &q(LogOrder::Date, 3, 1), &mut f).unwrap();
        assert_eq!((c.next_skip, c.has_more), (4, true));
        let d = serve(&mut e, &q(LogOrder::Date, 4, 1), &mut f).unwrap();
        assert_eq!((d.next_skip, d.has_more), (5, false));
        assert_eq!(*calls.borrow(), vec![(0, 2), (2, REMAINDER_LIMIT)]);
        let rows: Vec<Row> = [a.rows, b.rows, c.rows, d.rows].concat();
        assert_eq!(rows, layout(&all));
    }

    #[test]
    fn out_of_order_errors() {
        let all = commits();
        let calls = RefCell::new(Vec::new());
        let mut f = fake(&all, &calls);
        let mut e = Entry::new(LogOrder::Date, true);
        let err = serve(&mut e, &q(LogOrder::Date, 3, 10), &mut f).unwrap_err();
        assert_eq!(err.code, "graph.out_of_order");
        serve(&mut e, &q(LogOrder::Date, 0, 2), &mut f).unwrap();
        let err = serve(&mut e, &q(LogOrder::Date, 3, 10), &mut f).unwrap_err();
        assert_eq!(err.code, "graph.out_of_order");
    }

    #[test]
    fn order_change_resets() {
        let all = commits();
        let calls = RefCell::new(Vec::new());
        let mut f = fake(&all, &calls);
        let mut e = Entry::new(LogOrder::Date, true);
        serve(&mut e, &q(LogOrder::Date, 0, 2), &mut f).unwrap();
        let p = serve(&mut e, &q(LogOrder::Topo, 0, 10), &mut f).unwrap();
        assert_eq!(p.rows, layout(&all));
        let err = serve(&mut e, &q(LogOrder::Date, 5, 10), &mut f).unwrap_err();
        assert_eq!(err.code, "graph.out_of_order");
    }

    #[test]
    fn reserving_works_until_buffers_dropped() {
        let all = commits();
        let calls = RefCell::new(Vec::new());
        let mut f = fake(&all, &calls);
        let mut e = Entry::new(LogOrder::Date, true);
        let a = serve(&mut e, &q(LogOrder::Date, 0, 2), &mut f).unwrap();
        let b = serve(&mut e, &q(LogOrder::Date, 2, 2), &mut f).unwrap();
        // Idempotent re-request of a served range.
        let b2 = serve(&mut e, &q(LogOrder::Date, 2, 2), &mut f).unwrap();
        assert_eq!(b2.rows, b.rows);
        assert_eq!(b2.commits, b.commits);
        assert_eq!(a.rows.len(), 2);
        // Finishing the log releases the buffers.
        let c = serve(&mut e, &q(LogOrder::Date, 4, 2), &mut f).unwrap();
        assert!(!c.has_more);
        assert!(e.rows.is_empty() && e.commits.is_empty());
        let err = serve(&mut e, &q(LogOrder::Date, 2, 2), &mut f).unwrap_err();
        assert_eq!(err.code, "graph.out_of_order");
    }
}
