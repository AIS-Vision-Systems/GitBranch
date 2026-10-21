//! Process-wide application state: the git runner, open repositories and the recent list.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::AppError;
use crate::commands::invalid_arg;
use git_core::GitRunner;
use git_core::repo::RepoInfo;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

/// Maximum number of remembered recent repositories.
pub const MAX_RECENT: usize = 20;

/// A repository opened in this session.
#[derive(Debug, Clone)]
pub struct OpenRepo {
    /// Stable id derived from the work-tree path.
    pub id: String,
    /// Layout as discovered by git-core.
    pub info: RepoInfo,
}

/// An entry of the persisted recent list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepo {
    /// Work-tree path.
    pub path: String,
    /// Display name (last path component).
    pub name: String,
    /// Unix milliseconds of the last open.
    pub last_opened: u64,
}

/// The repositories open when the app last ran, restored on the next start.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Repository paths as passed to `open_repo`, in tab order.
    pub open: Vec<String>,
    /// The path of the active tab, if any.
    pub current: Option<String>,
}

/// Shared state managed by Tauri.
pub struct AppState {
    /// The git runner used by every command.
    pub runner: GitRunner,
    repos: Mutex<HashMap<String, OpenRepo>>,
    recent: Mutex<Vec<RecentRepo>>,
    recent_file: PathBuf,
    session_file: PathBuf,
    /// Running cancellable operations by UI-chosen op id.
    ops: Arc<OpMap>,
    op_serial: AtomicU64,
}

type OpMap = Mutex<HashMap<String, (u64, CancellationToken)>>;

/// Keeps an operation registered; removes it on drop (only if still its own entry).
pub struct OpGuard {
    ops: Arc<OpMap>,
    id: String,
    serial: u64,
    token: CancellationToken,
}

impl OpGuard {
    /// The token cancelled by `cancel_op`.
    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

impl Drop for OpGuard {
    fn drop(&mut self) {
        if let Ok(mut m) = self.ops.lock()
            && m.get(&self.id).is_some_and(|(s, _)| *s == self.serial)
        {
            m.remove(&self.id);
        }
    }
}

/// Short stable id: first 12 hex digits of 64-bit FNV-1a over the path bytes.
pub fn repo_id(path: &Path) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in path.to_string_lossy().replace('\\', "/").bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")[..12].to_string()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

impl AppState {
    /// Creates the state, loading the recent list from `recent_file` if present.
    pub fn new(runner: GitRunner, recent_file: PathBuf) -> Self {
        let recent = std::fs::read(&recent_file)
            .ok()
            .and_then(|b| serde_json::from_slice::<Vec<RecentRepo>>(&b).ok())
            .unwrap_or_default();
        Self {
            runner,
            repos: Mutex::new(HashMap::new()),
            recent: Mutex::new(recent),
            session_file: recent_file.with_file_name("session.json"),
            recent_file,
            ops: Arc::new(Mutex::new(HashMap::new())),
            op_serial: AtomicU64::new(0),
        }
    }

    /// Loads the saved session; a missing or corrupt file gives the empty session.
    pub fn load_session(&self) -> Session {
        match std::fs::read(&self.session_file) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|e| {
                tracing::warn!("ignoring corrupt session file: {e}");
                Session::default()
            }),
            Err(_) => Session::default(),
        }
    }

    /// Persists the session atomically.
    pub fn save_session(&self, s: &Session) -> std::io::Result<()> {
        save_atomic(&self.session_file, s)
    }

    /// Registers a cancellable operation; the entry lives until the guard drops.
    pub fn register_op(&self, id: &str) -> Result<OpGuard, AppError> {
        let mut m = self.ops.lock().map_err(|_| invalid_arg("op registry"))?;
        if m.contains_key(id) {
            return Err(invalid_arg("op id (already running)"));
        }
        let serial = self.op_serial.fetch_add(1, Ordering::Relaxed);
        let token = CancellationToken::new();
        m.insert(id.to_string(), (serial, token.clone()));
        Ok(OpGuard { ops: Arc::clone(&self.ops), id: id.to_string(), serial, token })
    }

    /// Cancels a running operation; `false` when the id is unknown (already finished).
    pub fn cancel_op(&self, id: &str) -> bool {
        let token = self.ops.lock().ok().and_then(|m| m.get(id).map(|(_, t)| t.clone()));
        token.is_some_and(|t| {
            t.cancel();
            true
        })
    }

    /// Registers an opened repository and returns it.
    pub fn open(&self, info: RepoInfo) -> OpenRepo {
        let repo = OpenRepo { id: repo_id(&info.work_tree), info };
        if let Ok(mut m) = self.repos.lock() {
            m.insert(repo.id.clone(), repo.clone());
        }
        repo
    }

    /// Looks up an open repository.
    pub fn get(&self, id: &str) -> Option<OpenRepo> {
        self.repos.lock().ok()?.get(id).cloned()
    }

    /// Snapshot of all open repositories.
    pub fn open_repos(&self) -> Vec<OpenRepo> {
        self.repos.lock().map(|m| m.values().cloned().collect()).unwrap_or_default()
    }

    /// Forgets an open repository.
    pub fn close(&self, id: &str) {
        if let Ok(mut m) = self.repos.lock() {
            m.remove(id);
        }
    }

    /// The recent list, most recent first.
    pub fn recent(&self) -> Vec<RecentRepo> {
        self.recent.lock().map(|r| r.clone()).unwrap_or_default()
    }

    /// Moves (or inserts) `path` at the front of the recent list and persists it.
    pub fn touch_recent(&self, path: &str, name: &str) {
        self.update_recent(|r| {
            r.retain(|e| e.path != path);
            r.insert(
                0,
                RecentRepo {
                    path: path.to_string(),
                    name: name.to_string(),
                    last_opened: now_ms(),
                },
            );
            r.truncate(MAX_RECENT);
        });
    }

    /// Removes `path` from the recent list and persists it.
    pub fn remove_recent(&self, path: &str) {
        self.update_recent(|r| r.retain(|e| e.path != path));
    }

    fn update_recent(&self, f: impl FnOnce(&mut Vec<RecentRepo>)) {
        let Ok(mut r) = self.recent.lock() else { return };
        f(&mut r);
        if let Err(e) = save_atomic(&self.recent_file, &*r) {
            tracing::warn!("could not persist recent repositories: {e}");
        }
    }
}

fn save_atomic<T: Serialize + ?Sized>(file: &Path, list: &T) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("json.tmp");
    {
        let mut f = std::fs::File::create(&tmp)?;
        std::io::Write::write_all(&mut f, &serde_json::to_vec_pretty(list)?)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, file)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // unwrap is fine in tests
mod tests {
    use super::*;

    fn state(dir: &Path) -> AppState {
        AppState::new(GitRunner::from_env(), dir.join("cfg").join("recent.json"))
    }

    #[test]
    fn touch_moves_to_front_and_dedups() {
        let d = tempfile::tempdir().unwrap();
        let s = state(d.path());
        s.touch_recent("/a", "a");
        s.touch_recent("/b", "b");
        s.touch_recent("/a", "a");
        let paths: Vec<_> = s.recent().into_iter().map(|r| r.path).collect();
        assert_eq!(paths, ["/a", "/b"]);
    }

    #[test]
    fn capped_at_twenty() {
        let d = tempfile::tempdir().unwrap();
        let s = state(d.path());
        for i in 0..25 {
            s.touch_recent(&format!("/r{i}"), "r");
        }
        let r = s.recent();
        assert_eq!(r.len(), MAX_RECENT);
        assert_eq!(r[0].path, "/r24");
    }

    #[test]
    fn remove_and_persist_round_trip() {
        let d = tempfile::tempdir().unwrap();
        let s = state(d.path());
        s.touch_recent("/a", "a");
        s.touch_recent("/b", "b");
        s.remove_recent("/a");
        let reloaded = state(d.path());
        assert_eq!(reloaded.recent(), s.recent());
        assert_eq!(reloaded.recent().len(), 1);
    }

    #[test]
    fn session_round_trip_and_corrupt_fallback() {
        let d = tempfile::tempdir().unwrap();
        let s = state(d.path());
        assert_eq!(s.load_session(), Session::default());
        let sess = Session { open: vec!["/a".into(), "/b".into()], current: Some("/b".into()) };
        s.save_session(&sess).unwrap();
        assert_eq!(state(d.path()).load_session(), sess);
        std::fs::write(d.path().join("cfg").join("session.json"), b"{not json").unwrap();
        assert_eq!(s.load_session(), Session::default());
    }

    #[test]
    fn op_registry_register_cancel_drop() {
        let d = tempfile::tempdir().unwrap();
        let s = state(d.path());
        let g = s.register_op("a1").unwrap();
        let t = g.token();
        assert!(!t.is_cancelled());
        assert!(s.register_op("a1").is_err());
        assert!(s.cancel_op("a1"));
        assert!(t.is_cancelled());
        drop(g);
        assert!(!s.cancel_op("a1"));
        let g2 = s.register_op("a1").unwrap();
        assert!(!g2.token().is_cancelled());
        drop(g2);
        assert!(!s.cancel_op("unknown"));
    }

    #[test]
    fn repo_id_is_stable_and_short() {
        let a = repo_id(Path::new("/x/y"));
        assert_eq!(a, repo_id(Path::new("/x/y")));
        assert_eq!(a.len(), 12);
        assert_ne!(a, repo_id(Path::new("/x/z")));
    }
}
