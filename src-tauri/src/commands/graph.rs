//! Commands feeding the commit graph, branch list and status panels.

use std::collections::HashMap;
use std::sync::Mutex;

use git_core::graph::{LayoutState, Row};
use git_core::parse::log::{Commit, LogOrder, LogPage, LogQuery, log_page};
use git_core::parse::refs::Refs;
use git_core::parse::status::Status;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppError;
use crate::state::{AppState, OpenRepo};

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

/// Incremental layout of one repository.
#[derive(Debug)]
pub struct Entry {
    layout: LayoutState,
    next_skip: usize,
    order: LogOrder,
    all: bool,
}

/// Per-repository incremental layout state, managed by Tauri.
#[derive(Default)]
pub struct GraphCache {
    entries: Mutex<HashMap<String, Entry>>,
}

impl GraphCache {
    /// Drops the cached layout of a repository.
    pub fn forget(&self, repo_id: &str) {
        if let Ok(mut m) = self.entries.lock() {
            m.remove(repo_id);
        }
    }
}

/// Applies a fetched page to the cache entry, producing lane rows.
fn apply_page(
    entry: &mut Option<Entry>,
    query: &GraphQuery,
    page: LogPage,
) -> Result<GraphPage, AppError> {
    let matches = entry.as_ref().is_some_and(|e| e.order == query.order && e.all == query.all);
    if query.skip == 0 || !matches {
        if query.skip != 0 {
            return Err(out_of_order());
        }
        *entry = Some(Entry {
            layout: LayoutState::new(),
            next_skip: 0,
            order: query.order,
            all: query.all,
        });
    }
    let e = entry.as_mut().ok_or_else(out_of_order)?;
    if query.skip != e.next_skip && query.skip != 0 {
        return Err(out_of_order());
    }
    let rows = e.layout.push_all(&page.commits);
    e.next_skip = query.skip + page.commits.len();
    Ok(GraphPage { commits: page.commits, rows, has_more: page.has_more, next_skip: e.next_skip })
}

fn out_of_order() -> AppError {
    AppError::new("graph.out_of_order", "Graph pages must be loaded in order")
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
    let repo = open(&state, &repo_id)?;
    let q = LogQuery { order: query.order, skip: query.skip, limit: query.limit, all: query.all };
    let page = log_page(&state.runner, &repo.info.work_tree, &q).await?;
    let mut map = cache
        .entries
        .lock()
        .map_err(|_| AppError::new("graph.cache_poisoned", "Graph cache is unavailable"))?;
    let mut entry = map.remove(&repo_id);
    let result = apply_page(&mut entry, &query, page);
    if let Some(e) = entry {
        map.insert(repo_id, e);
    }
    result
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
#[allow(clippy::unwrap_used)] // unwrap is fine in tests
mod tests {
    use super::*;
    use git_core::graph::layout::layout;

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

    fn q(order: LogOrder, skip: usize) -> GraphQuery {
        GraphQuery { order, skip, limit: 10, all: true }
    }

    fn page(c: &[Commit], has_more: bool) -> LogPage {
        LogPage { commits: c.to_vec(), has_more }
    }

    #[test]
    fn fresh_at_skip_zero() {
        let all = commits();
        let mut e = None;
        let p = apply_page(&mut e, &q(LogOrder::Date, 0), page(&all[..2], true)).unwrap();
        assert_eq!(p.next_skip, 2);
        assert_eq!(p.rows.len(), 2);
        assert!(p.has_more);
    }

    #[test]
    fn continues_and_matches_full_layout() {
        let all = commits();
        let mut e = None;
        let a = apply_page(&mut e, &q(LogOrder::Date, 0), page(&all[..2], true)).unwrap();
        let b = apply_page(&mut e, &q(LogOrder::Date, 2), page(&all[2..], false)).unwrap();
        assert_eq!(b.next_skip, 5);
        let rows: Vec<Row> = a.rows.into_iter().chain(b.rows).collect();
        assert_eq!(rows, layout(&all));
    }

    #[test]
    fn out_of_order_errors() {
        let all = commits();
        let mut e = None;
        let err = apply_page(&mut e, &q(LogOrder::Date, 3), page(&all[3..], false)).unwrap_err();
        assert_eq!(err.code, "graph.out_of_order");
        apply_page(&mut e, &q(LogOrder::Date, 0), page(&all[..2], true)).unwrap();
        let err = apply_page(&mut e, &q(LogOrder::Date, 3), page(&all[3..], false)).unwrap_err();
        assert_eq!(err.code, "graph.out_of_order");
    }

    #[test]
    fn order_change_resets() {
        let all = commits();
        let mut e = None;
        apply_page(&mut e, &q(LogOrder::Date, 0), page(&all[..2], true)).unwrap();
        let p = apply_page(&mut e, &q(LogOrder::Topo, 0), page(&all, false)).unwrap();
        assert_eq!(p.rows, layout(&all));
        let err = apply_page(&mut e, &q(LogOrder::Date, 5), page(&[], false)).unwrap_err();
        assert_eq!(err.code, "graph.out_of_order");
    }
}
