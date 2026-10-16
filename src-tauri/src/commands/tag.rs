//! `tag` commands: create, delete.

use git_core::ops::tag::{self, TagArgs};
use git_core::refname::{is_safe_revision, is_valid_branch_name};
use tauri::State;

use super::{emit_changed, invalid_arg, not_open};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

/// Creates a lightweight (no message) or annotated tag.
#[tauri::command]
pub async fn create_tag(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    args: TagArgs,
) -> Result<(), AppError> {
    if !is_valid_branch_name(&args.name) {
        return Err(invalid_arg("tag name"));
    }
    if !is_safe_revision(&args.target) {
        return Err(invalid_arg("tag target"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    tag::create_tag(&state.runner, &repo.info.work_tree, &args).await?;
    emit_changed(&app, &repo_id, &[Change::Refs]);
    Ok(())
}

/// Deletes a local tag.
#[tauri::command]
pub async fn delete_tag(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> Result<(), AppError> {
    if !is_valid_branch_name(&name) {
        return Err(invalid_arg("tag name"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    tag::delete_tag(&state.runner, &repo.info.work_tree, &name).await?;
    emit_changed(&app, &repo_id, &[Change::Refs]);
    Ok(())
}
