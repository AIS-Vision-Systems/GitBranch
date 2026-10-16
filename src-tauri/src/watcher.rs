//! Debounced repository watcher: turns filesystem noise into coalesced `repo-changed` events.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use git_core::GitRunner;
use git_core::repo::RepoInfo;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::AppError;

/// Event name sent to the UI.
pub const EVENT: &str = "repo-changed";
/// Quiet period before a batch is emitted.
pub const DEBOUNCE: Duration = Duration::from_millis(150);
/// Most working-tree paths sent to one `check-ignore` call; beyond it events are emitted as is.
const MAX_IGNORE_PATHS: usize = 500;
/// Upper bound between the first event of a batch and its emission.
const MAX_DELAY: Duration = Duration::from_secs(1);

/// Category of repository change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Change {
    /// HEAD moved or an operation (merge, rebase, ...) started or ended.
    Head,
    /// Refs, packed-refs or reflogs changed.
    Refs,
    /// The index changed.
    Index,
    /// A working tree file changed.
    WorkingTree,
}

/// Payload of the `repo-changed` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoChanged {
    /// Repository id as used by the commands.
    pub repo_id: String,
    /// Sorted, deduplicated categories.
    pub what: Vec<Change>,
}

/// Splits a path into normalized components (separators, `\\?\` prefix, kept verbatim).
fn components(path: &Path) -> Vec<String> {
    let s = path.to_string_lossy();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    s.split(['/', '\\']).filter(|c| !c.is_empty() && *c != ".").map(str::to_string).collect()
}

fn same(a: &str, b: &str) -> bool {
    if cfg!(windows) { a.eq_ignore_ascii_case(b) } else { a == b }
}

/// Strips `base` from `p` (case-insensitive on Windows).
fn strip<'a>(p: &'a [String], base: &[String]) -> Option<&'a [String]> {
    (p.len() >= base.len() && p.iter().zip(base).all(|(a, b)| same(a, b))).then(|| &p[base.len()..])
}

/// Case-insensitive extension test (`foo.LOCK` counts as `.lock`).
fn has_ext(name: &str, ext: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, e)| e.eq_ignore_ascii_case(ext))
}

/// Classifies a path relative to a git dir. `own` is true for the checkout's own git dir.
fn classify_in_git_dir(rel: &[String], own: bool) -> Option<Change> {
    let first = rel.first()?.as_str();
    let last = rel.last()?.as_str();
    if has_ext(last, "lock") {
        return None;
    }
    match first {
        "HEAD" if own && rel.len() == 1 => Some(Change::Head),
        "index" if own && rel.len() == 1 => Some(Change::Index),
        "refs" | "packed-refs" => Some(Change::Refs),
        "logs" => {
            if own && rel.len() == 2 && rel[1] == "HEAD" {
                Some(Change::Head)
            } else {
                Some(Change::Refs)
            }
        }
        "ORIG_HEAD" | "FETCH_HEAD" | "MERGE_HEAD" | "CHERRY_PICK_HEAD" | "REBASE_HEAD"
        | "MERGE_MSG" | "REVERT_HEAD" | "AUTO_MERGE" | "BISECT_LOG" | "rebase-merge"
        | "rebase-apply" | "sequencer"
            if own =>
        {
            Some(Change::Head)
        }
        _ => None,
    }
}

/// Maps a changed path to a category given the repo layout, or `None` to ignore it.
pub fn classify(path: &Path, info: &RepoInfo) -> Option<Change> {
    let p = components(path);
    let git_dir = components(&info.git_dir);
    let common = components(&info.common_dir);
    if let Some(r) = strip(&p, &git_dir) {
        return classify_in_git_dir(r, true);
    }
    if let Some(r) = strip(&p, &common) {
        return classify_in_git_dir(r, false);
    }
    let work = components(&info.work_tree);
    let r = strip(&p, &work)?;
    if r.is_empty() || r.iter().any(|c| c == ".git") {
        return None;
    }
    let name = r.last()?;
    let noisy =
        name.ends_with('~') || has_ext(name, "swp") || has_ext(name, "tmp") || name == "4913";
    (!noisy).then_some(Change::WorkingTree)
}

enum Msg {
    Fs(notify::Result<notify::Event>),
    Stop,
}

struct WatchHandle {
    tx: Sender<Msg>,
    watcher: Option<RecommendedWatcher>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        // Drop the OS watcher first so no new events arrive, then stop the thread.
        self.watcher.take();
        let _ = self.tx.send(Msg::Stop);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Registry of active watchers, keyed by repo id.
#[derive(Default)]
pub struct Watchers {
    map: Mutex<HashMap<String, WatchHandle>>,
}

/// Returns the paths that are ignored, or `None` when the check failed.
type IgnoreCheck<'a> = &'a (dyn Fn(&[PathBuf]) -> Option<Vec<PathBuf>> + Send);

/// Removes `WorkingTree` from `what` when every collected path of the window is ignored.
/// Never drops anything on failure, when nothing was collected, or past [`MAX_IGNORE_PATHS`].
fn drop_ignored(what: &mut BTreeSet<Change>, paths: &BTreeSet<PathBuf>, check: IgnoreCheck<'_>) {
    if !what.contains(&Change::WorkingTree) || paths.is_empty() || paths.len() > MAX_IGNORE_PATHS {
        return;
    }
    let list: Vec<PathBuf> = paths.iter().cloned().collect();
    if check(&list).is_some_and(|ign| ign.len() == list.len()) {
        what.remove(&Change::WorkingTree);
    }
}

fn run_loop(
    repo_id: &str,
    info: &RepoInfo,
    rx: &Receiver<Msg>,
    emit: &(dyn Fn(RepoChanged) + Send),
    check: IgnoreCheck<'_>,
) {
    let mut pending: BTreeSet<Change> = BTreeSet::new();
    // Working-tree paths of the current window; `wt_overflow` once past the cap.
    let mut wt_paths: BTreeSet<PathBuf> = BTreeSet::new();
    let mut wt_overflow = false;
    let mut first = Instant::now();
    let mut last = first;
    loop {
        let msg = if pending.is_empty() {
            match rx.recv() {
                Ok(m) => Some(m),
                Err(_) => return,
            }
        } else {
            let deadline = (last + DEBOUNCE).min(first + MAX_DELAY);
            match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(m) => Some(m),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        };
        match msg {
            Some(Msg::Stop) => return,
            Some(Msg::Fs(Ok(ev))) => {
                if matches!(ev.kind, EventKind::Access(_)) {
                    continue;
                }
                let was_empty = pending.is_empty();
                for p in &ev.paths {
                    let Some(c) = classify(p, info) else { continue };
                    if c == Change::WorkingTree {
                        if wt_paths.len() < MAX_IGNORE_PATHS {
                            wt_paths.insert(p.clone());
                        } else {
                            wt_overflow = true;
                        }
                    }
                    pending.insert(c);
                }
                if !pending.is_empty() {
                    let now = Instant::now();
                    if was_empty {
                        first = now;
                    }
                    last = now;
                }
            }
            Some(Msg::Fs(Err(e))) => tracing::warn!(repo_id, error = %e, "watcher error"),
            None => {
                let mut set = std::mem::take(&mut pending);
                let paths = std::mem::take(&mut wt_paths);
                if !std::mem::take(&mut wt_overflow) {
                    drop_ignored(&mut set, &paths, check);
                }
                if !set.is_empty() {
                    emit(RepoChanged {
                        repo_id: repo_id.to_owned(),
                        what: set.into_iter().collect(),
                    });
                }
            }
        }
    }
}

impl Watchers {
    /// Starts watching `info` for `repo_id`; `emit` is called at most once per debounce window.
    /// Replaces an existing watcher for the same id.
    pub fn start(
        &self,
        repo_id: String,
        info: RepoInfo,
        runner: GitRunner,
        emit: Box<dyn Fn(RepoChanged) + Send + 'static>,
    ) -> Result<(), AppError> {
        let (tx, rx) = mpsc::channel();
        let cb_tx = tx.clone();
        let mut watcher = notify::recommended_watcher(move |res| {
            let _ = cb_tx.send(Msg::Fs(res));
        })
        .map_err(|e| {
            AppError::new("watcher.init", "cannot start file watcher").with_detail(e.to_string())
        })?;

        let werr = |e: notify::Error| {
            AppError::new("watcher.watch", "cannot watch repository").with_detail(e.to_string())
        };
        let mut dirs: Vec<PathBuf> = vec![info.git_dir.clone()];
        if info.common_dir != info.git_dir {
            dirs.push(info.common_dir.clone());
        }
        for d in &dirs {
            watcher.watch(d, RecursiveMode::NonRecursive).map_err(werr)?;
            for sub in ["refs", "logs", "worktrees"] {
                let p = d.join(sub);
                if p.is_dir() {
                    watcher.watch(&p, RecursiveMode::Recursive).map_err(werr)?;
                }
            }
        }
        if !info.is_bare {
            watcher.watch(&info.work_tree, RecursiveMode::Recursive).map_err(werr)?;
        }

        let id = repo_id.clone();
        let thread = std::thread::Builder::new()
            .name("repo-watcher".into())
            .spawn(move || {
                // Build output (`target/`, `node_modules/`) must not trigger refreshes.
                let check = |paths: &[PathBuf]| {
                    tauri::async_runtime::block_on(git_core::ops::ignore::ignored(
                        &runner,
                        &info.work_tree,
                        paths,
                    ))
                    .map_err(|e| tracing::debug!(error = %e, "check-ignore failed"))
                    .ok()
                };
                run_loop(&id, &info, &rx, emit.as_ref(), &check);
            })
            .map_err(|e| {
                AppError::new("watcher.thread", "cannot spawn watcher thread")
                    .with_detail(e.to_string())
            })?;
        let handle = WatchHandle { tx, watcher: Some(watcher), thread: Some(thread) };
        // Drop any previous watcher outside the lock (joins its thread).
        let old = self
            .map
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(repo_id, handle);
        drop(old);
        Ok(())
    }

    /// Stops and forgets the watcher for `repo_id` (no-op when absent).
    pub fn stop(&self, repo_id: &str) {
        let old =
            self.map.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(repo_id);
        drop(old);
    }
}

/// An `emit` that forwards to the Tauri event bus.
pub fn tauri_emitter(app: tauri::AppHandle) -> Box<dyn Fn(RepoChanged) + Send + 'static> {
    Box::new(move |changed| {
        if let Err(e) = app.emit(EVENT, changed) {
            tracing::warn!(error = %e, "failed to emit repo-changed");
        }
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn info(work: &str, git: &str, common: &str) -> RepoInfo {
        RepoInfo {
            work_tree: work.into(),
            git_dir: git.into(),
            common_dir: common.into(),
            is_worktree: git != common,
            main_work_tree: None,
            is_bare: false,
        }
    }

    #[test]
    fn classify_table() {
        let n = info("/r", "/r/.git", "/r/.git");
        let cases: &[(&str, Option<Change>)] = &[
            ("/r/.git/HEAD", Some(Change::Head)),
            ("/r/.git/index", Some(Change::Index)),
            ("/r/.git/index.lock", None),
            ("/r/.git/refs/heads/main", Some(Change::Refs)),
            ("/r/.git/refs/heads/main.lock", None),
            ("/r/.git/packed-refs", Some(Change::Refs)),
            ("/r/.git/logs/HEAD", Some(Change::Head)),
            ("/r/.git/REVERT_HEAD", Some(Change::Head)),
            ("/r/.git/AUTO_MERGE", Some(Change::Head)),
            ("/r/.git/BISECT_LOG", Some(Change::Head)),
            ("/r/.git/sequencer/todo", Some(Change::Head)),
            ("/r/.git/logs/refs/heads/main", Some(Change::Refs)),
            ("/r/.git/ORIG_HEAD", Some(Change::Head)),
            ("/r/.git/rebase-merge/done", Some(Change::Head)),
            ("/r/.git/objects/ab/cdef", None),
            ("/r/.git/config", None),
            ("/r/src/main.rs", Some(Change::WorkingTree)),
            ("/r/src/main.rs~", None),
            ("/r/.a.swp", None),
            ("/r/4913", None),
            ("/r/sub/.git", None),
            ("/elsewhere/file", None),
        ];
        for (p, want) in cases {
            assert_eq!(classify(Path::new(p), &n), *want, "{p}");
        }

        let w = info("/wt", "/r/.git/worktrees/wt", "/r/.git");
        let cases: &[(&str, Option<Change>)] = &[
            ("/r/.git/worktrees/wt/HEAD", Some(Change::Head)),
            ("/r/.git/worktrees/wt/index", Some(Change::Index)),
            ("/r/.git/worktrees/other/index", None),
            ("/r/.git/HEAD", None),
            ("/r/.git/logs/HEAD", Some(Change::Refs)),
            ("/r/.git/refs/heads/x", Some(Change::Refs)),
            ("/r/.git/packed-refs", Some(Change::Refs)),
            ("/wt/.git", None),
            ("/wt/a.txt", Some(Change::WorkingTree)),
        ];
        for (p, want) in cases {
            assert_eq!(classify(Path::new(p), &w), *want, "{p}");
        }
    }

    #[test]
    fn drop_ignored_rules() {
        let paths: BTreeSet<PathBuf> =
            ["/r/target/a", "/r/src/b"].iter().map(PathBuf::from).collect();
        let base: BTreeSet<Change> = [Change::WorkingTree, Change::Refs].into();
        // Only some ignored: keep.
        let mut w = base.clone();
        drop_ignored(&mut w, &paths, &|_| Some(vec![PathBuf::from("/r/target/a")]));
        assert!(w.contains(&Change::WorkingTree));
        // All ignored: drop WorkingTree only.
        let mut w = base.clone();
        drop_ignored(&mut w, &paths, &|p| Some(p.to_vec()));
        assert_eq!(w, [Change::Refs].into());
        // Failure: keep.
        let mut w = base.clone();
        drop_ignored(&mut w, &paths, &|_| None);
        assert_eq!(w, base);
    }

    type Sink = Arc<Mutex<Vec<RepoChanged>>>;

    fn wait_for(got: &Sink, pred: impl Fn(&[RepoChanged]) -> bool) -> bool {
        let end = Instant::now() + Duration::from_secs(3);
        while Instant::now() < end {
            if pred(&got.lock().unwrap()) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn watcher_emits_and_stops() {
        let fx = git_core::fixtures::FixtureRepo::linear(1);
        let runner = fx.runner();
        let info = tauri::async_runtime::block_on(git_core::repo::discover(&runner, fx.path()))
            .expect("discover");
        let got: Sink = Arc::default();
        let sink = got.clone();
        let w = Watchers::default();
        w.start("r".into(), info, runner.clone(), Box::new(move |c| sink.lock().unwrap().push(c)))
            .expect("start");

        std::fs::write(fx.path().join("new.txt"), "hi").unwrap();
        assert!(
            wait_for(&got, |v| v.iter().any(|e| e.what.contains(&Change::WorkingTree))),
            "no WorkingTree event"
        );

        got.lock().unwrap().clear();
        fx.git(&["add", "new.txt"]);
        fx.git(&["commit", "-m", "x"]);
        assert!(
            wait_for(&got, |v| v.iter().any(|e| e
                .what
                .iter()
                .any(|c| matches!(c, Change::Index | Change::Refs | Change::Head)))),
            "no git-dir event"
        );

        w.stop("r");
        std::thread::sleep(Duration::from_millis(300));
        got.lock().unwrap().clear();
        std::fs::write(fx.path().join("after.txt"), "x").unwrap();
        std::thread::sleep(Duration::from_millis(500));
        assert!(got.lock().unwrap().is_empty());
    }
}
