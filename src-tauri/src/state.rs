//! Process-wide application state: the git runner, open repositories and the recent list.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use git_core::GitRunner;
use git_core::repo::RepoInfo;
use serde::{Deserialize, Serialize};

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

/// Shared state managed by Tauri.
pub struct AppState {
    /// The git runner used by every command.
    pub runner: GitRunner,
    repos: Mutex<HashMap<String, OpenRepo>>,
    recent: Mutex<Vec<RecentRepo>>,
    recent_file: PathBuf,
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
        Self { runner, repos: Mutex::new(HashMap::new()), recent: Mutex::new(recent), recent_file }
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
        if let Err(e) = save_atomic(&self.recent_file, &r) {
            tracing::warn!("could not persist recent repositories: {e}");
        }
    }
}

fn save_atomic(file: &Path, list: &[RecentRepo]) -> std::io::Result<()> {
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
    fn repo_id_is_stable_and_short() {
        let a = repo_id(Path::new("/x/y"));
        assert_eq!(a, repo_id(Path::new("/x/y")));
        assert_eq!(a.len(), 12);
        assert_ne!(a, repo_id(Path::new("/x/z")));
    }
}
