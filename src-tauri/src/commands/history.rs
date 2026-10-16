//! `history` commands: reset, revert, cherry-pick.

use git_core::ops::history::{self, ResetMode};
use tauri::State;

use super::{emit_changed, invalid_arg, not_open, valid_oid};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

const ALL: [Change; 4] = [Change::Head, Change::Refs, Change::Index, Change::WorkingTree];

fn valid_oids(oids: &[String]) -> bool {
    !oids.is_empty() && oids.iter().all(|o| valid_oid(o))
}

/// Resets the current branch to `target`.
#[tauri::command]
pub async fn reset(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    target: String,
    mode: ResetMode,
) -> Result<(), AppError> {
    if target.is_empty() || target.starts_with('-') || target.chars().any(char::is_control) {
        return Err(invalid_arg("reset target"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let res = history::reset(&state.runner, &repo.info.work_tree, &target, mode).await;
    emit_changed(&app, &repo_id, &ALL);
    Ok(res?)
}

/// Reverts commits; conflicts leave the sequencer state for the conflict UI.
#[tauri::command]
pub async fn revert(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    oids: Vec<String>,
    no_commit: bool,
) -> Result<(), AppError> {
    if !valid_oids(&oids) {
        return Err(invalid_arg("commit id"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let res = history::revert(&state.runner, &repo.info.work_tree, &oids, no_commit).await;
    emit_changed(&app, &repo_id, &ALL);
    Ok(res?)
}

/// Cherry-picks commits; conflicts leave the sequencer state for the conflict UI.
#[tauri::command]
pub async fn cherry_pick(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    oids: Vec<String>,
    no_commit: bool,
) -> Result<(), AppError> {
    if !valid_oids(&oids) {
        return Err(invalid_arg("commit id"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let res = history::cherry_pick(&state.runner, &repo.info.work_tree, &oids, no_commit).await;
    emit_changed(&app, &repo_id, &ALL);
    Ok(res?)
}
