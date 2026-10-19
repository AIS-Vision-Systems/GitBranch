//! `#[tauri::command]` functions, one module per area. No git logic lives here.

pub mod app;
pub mod branch;
pub mod clone;
pub mod commit;
pub mod commit_ops;
pub mod conflict;
pub mod graph;
pub mod history;
pub mod merge;
pub mod reflog;
pub mod remote;
pub mod repo;
pub mod stage;
pub mod stash;
pub mod submodule;
pub mod tag;
pub mod worktree;

use tauri::Emitter;

use crate::watcher::{self, Change, RepoChanged};

/// Emits `repo-changed` after a successful mutating command (D-018).
pub fn emit_changed(app: &tauri::AppHandle, repo_id: &str, what: &[Change]) {
    let payload = RepoChanged { repo_id: repo_id.to_string(), what: what.to_vec() };
    if let Err(e) = app.emit(watcher::EVENT, payload) {
        tracing::warn!(error = %e, "failed to emit repo-changed");
    }
}

/// Validates a user-supplied object id (4..=64 hex chars).
pub fn valid_oid(oid: &str) -> bool {
    (4..=64).contains(&oid.len()) && oid.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Error for a repository id that is not open.
pub fn not_open() -> crate::AppError {
    crate::AppError::new("repo.not_open", "Repository is not open")
}

/// Validates a repository-relative path coming from the UI (no empty, absolute or `..` components).
pub fn valid_rel_path(p: &str) -> bool {
    use std::path::Component;
    let path = std::path::Path::new(p);
    !p.is_empty()
        && !path.is_absolute()
        && !p.starts_with('/')
        && !p.starts_with('\\')
        && path.components().all(|c| matches!(c, Component::Normal(_)))
}

/// Error for an invalid user-supplied argument.
pub fn invalid_arg(what: &str) -> crate::AppError {
    crate::AppError::new("arg.invalid", format!("Invalid {what}"))
}
