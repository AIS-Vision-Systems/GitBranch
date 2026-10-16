//! `branch` commands: create, checkout, rename, delete, upstream.

use git_core::ops::branch::{self, DeletedBranch};
use git_core::refname::{is_safe_revision, is_valid_branch_name};
use tauri::State;

use super::{emit_changed, invalid_arg, not_open};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

/// Creates a branch at `start_point`, optionally switching to it.
#[tauri::command]
pub async fn create_branch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    start_point: String,
    checkout: bool,
) -> Result<(), AppError> {
    if !is_valid_branch_name(&name) {
        return Err(invalid_arg("branch name"));
    }
    if !is_safe_revision(&start_point) {
        return Err(invalid_arg("start point"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    branch::create_branch(&state.runner, &repo.info.work_tree, &name, &start_point, checkout)
        .await?;
    if checkout {
        emit_changed(
            &app,
            &repo_id,
            &[Change::Refs, Change::Head, Change::Index, Change::WorkingTree],
        );
    } else {
        emit_changed(&app, &repo_id, &[Change::Refs]);
    }
    Ok(())
}

/// Switches to a branch (creating a tracking branch for `origin/x`) or detaches at `target`.
#[tauri::command]
pub async fn checkout(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    target: String,
    detach: bool,
) -> Result<(), AppError> {
    if !is_safe_revision(&target) {
        return Err(invalid_arg("checkout target"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let res = branch::checkout(&state.runner, &repo.info.work_tree, &target, detach).await;
    if res.is_ok() {
        emit_changed(
            &app,
            &repo_id,
            &[Change::Head, Change::Index, Change::WorkingTree, Change::Refs],
        );
    }
    Ok(res?)
}

/// Renames a local branch.
#[tauri::command]
pub async fn rename_branch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    old: String,
    new: String,
) -> Result<(), AppError> {
    if !is_valid_branch_name(&old) || !is_valid_branch_name(&new) {
        return Err(invalid_arg("branch name"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    branch::rename_branch(&state.runner, &repo.info.work_tree, &old, &new).await?;
    emit_changed(&app, &repo_id, &[Change::Refs]);
    Ok(())
}

/// Deletes a local branch; a safe delete of an unmerged branch fails with `branch.not_merged`.
#[tauri::command]
pub async fn delete_branch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    force: bool,
) -> Result<DeletedBranch, AppError> {
    if !is_valid_branch_name(&name) {
        return Err(invalid_arg("branch name"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    match branch::delete_branch(&state.runner, &repo.info.work_tree, &name, force).await {
        Ok(d) => {
            emit_changed(&app, &repo_id, &[Change::Refs]);
            Ok(d)
        }
        Err(e) if !force && e.stderr.contains("not fully merged") => {
            Err(AppError::new("branch.not_merged", "Branch is not fully merged")
                .with_detail(e.stderr))
        }
        Err(e) => Err(e.into()),
    }
}

/// Sets or clears the upstream of a local branch.
#[tauri::command]
pub async fn set_upstream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    upstream: Option<String>,
) -> Result<(), AppError> {
    if !is_valid_branch_name(&branch) {
        return Err(invalid_arg("branch name"));
    }
    if let Some(u) = &upstream {
        if !is_valid_branch_name(u) {
            return Err(invalid_arg("upstream"));
        }
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    git_core::ops::branch::set_upstream(
        &state.runner,
        &repo.info.work_tree,
        &branch,
        upstream.as_deref(),
    )
    .await?;
    emit_changed(&app, &repo_id, &[Change::Refs]);
    Ok(())
}
