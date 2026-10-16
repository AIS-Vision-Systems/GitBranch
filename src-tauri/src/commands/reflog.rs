//! Reflog-based undo commands (Phase 2).

use git_core::ops::reflog::{self, UndoInfo};
use git_core::parse::reflog::ReflogError;
use tauri::State;

use super::{emit_changed, not_open};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

impl From<ReflogError> for AppError {
    fn from(err: ReflogError) -> Self {
        match err {
            ReflogError::Git(g) => g.into(),
            ReflogError::Parse(p) => AppError::new("parse.invalid", p.to_string()),
        }
    }
}

/// What "undo" would do right now, or `None` when there is nothing to undo.
#[tauri::command]
pub async fn undo_preview(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Option<UndoInfo>, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(reflog::undo_preview(&state.runner, &repo.info.work_tree).await?)
}

/// Undoes the last HEAD movement.
#[tauri::command]
pub async fn undo_last(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<UndoInfo, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let info = reflog::undo_last(&state.runner, &repo.info.work_tree).await?;
    emit_changed(&app, &repo_id, &[Change::Head, Change::Refs, Change::Index, Change::WorkingTree]);
    Ok(info)
}
