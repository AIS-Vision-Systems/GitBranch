//! `stash` commands: list, push, apply, pop, drop.

use git_core::ops::stash::{self, StashPushArgs};
use git_core::parse::stash::{StashEntry, StashError};
use tauri::State;

use super::{emit_changed, invalid_arg, not_open, valid_rel_path};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

impl From<StashError> for AppError {
    fn from(err: StashError) -> Self {
        match err {
            StashError::Git(g) => g.into(),
            StashError::Parse(p) => AppError::new("parse.invalid", p.to_string()),
        }
    }
}

const WORK: [Change; 3] = [Change::Refs, Change::Index, Change::WorkingTree];

/// Lists stash entries, newest first.
#[tauri::command]
pub async fn stash_list(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Vec<StashEntry>, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(git_core::parse::stash::stash_list(&state.runner, &repo.info.work_tree).await?)
}

/// Stashes the current changes.
#[tauri::command]
pub async fn stash_push(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    args: StashPushArgs,
) -> Result<(), AppError> {
    if !args.paths.iter().all(|p| valid_rel_path(p)) {
        return Err(invalid_arg("path"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    stash::stash_push(&state.runner, &repo.info.work_tree, &args).await?;
    emit_changed(&app, &repo_id, &WORK);
    Ok(())
}

/// Applies a stash entry and keeps it.
#[tauri::command]
pub async fn stash_apply(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    index: usize,
    oid: String,
    restore_index: bool,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let res =
        stash::stash_apply(&state.runner, &repo.info.work_tree, index, &oid, restore_index).await;
    // Conflicts leave changes in the work tree, so refresh either way.
    emit_changed(&app, &repo_id, &WORK);
    Ok(res?)
}

/// Applies a stash entry and drops it on success.
#[tauri::command]
pub async fn stash_pop(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    index: usize,
    oid: String,
    restore_index: bool,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let res =
        stash::stash_pop(&state.runner, &repo.info.work_tree, index, &oid, restore_index).await;
    emit_changed(&app, &repo_id, &WORK);
    Ok(res?)
}

/// Drops a stash entry.
#[tauri::command]
pub async fn stash_drop(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    index: usize,
    oid: String,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    stash::stash_drop(&state.runner, &repo.info.work_tree, index, &oid).await?;
    emit_changed(&app, &repo_id, &[Change::Refs]);
    Ok(())
}
