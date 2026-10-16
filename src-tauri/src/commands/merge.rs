//! `merge`, `rebase` and in-progress operation commands (Phase 2).

use git_core::GitErrorKind;
use git_core::ops::merge::{self, MergeArgs, MergeOutcome, OpKind};
use git_core::ops::rebase::{self, RebaseError, TodoEntry, TodoItem};
use git_core::ops::state::{self, InProgress};
use git_core::refname::{is_safe_revision, is_valid_branch_name};
use tauri::State;

use super::{emit_changed, invalid_arg, not_open, valid_oid};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

const ALL: [Change; 4] = [Change::Head, Change::Refs, Change::Index, Change::WorkingTree];

impl From<RebaseError> for AppError {
    fn from(err: RebaseError) -> Self {
        match err {
            RebaseError::Git(g) => g.into(),
            RebaseError::Parse(p) => AppError::new("parse.invalid", p.to_string()),
            RebaseError::Invalid(m) => AppError::new("arg.invalid", format!("Invalid todo: {m}")),
            RebaseError::Io(e) => AppError::new("io.error", e.to_string()),
        }
    }
}

/// True when the failed call still changed the repository (it stopped on conflicts).
fn changed_anyway(kind: &GitErrorKind) -> bool {
    *kind == GitErrorKind::Conflict
}

/// Merges a branch, tag or commit into HEAD.
#[tauri::command]
pub async fn merge(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    args: MergeArgs,
) -> Result<MergeOutcome, AppError> {
    if !is_safe_revision(&args.source) {
        return Err(invalid_arg("merge source"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let result = merge::merge(&state.runner, &repo.info.work_tree, &args).await;
    match result {
        Ok(out) => {
            emit_changed(&app, &repo_id, &ALL);
            Ok(out)
        }
        Err(e) => {
            if changed_anyway(&e.kind) {
                emit_changed(&app, &repo_id, &ALL);
            }
            Err(e.into())
        }
    }
}

/// Rebases the current (or the given) branch onto `onto`.
#[tauri::command]
pub async fn rebase(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    onto: String,
    branch: Option<String>,
) -> Result<(), AppError> {
    if !is_safe_revision(&onto) || branch.as_deref().is_some_and(|b| !is_valid_branch_name(b)) {
        return Err(invalid_arg("branch name"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let result =
        rebase::rebase(&state.runner, &repo.info.work_tree, &onto, branch.as_deref()).await;
    match result {
        Ok(()) => {
            emit_changed(&app, &repo_id, &ALL);
            Ok(())
        }
        Err(e) => {
            if changed_anyway(&e.kind) {
                emit_changed(&app, &repo_id, &ALL);
            }
            Err(e.into())
        }
    }
}

/// The commits an interactive rebase onto `onto` would replay, oldest first.
#[tauri::command]
pub async fn rebase_todo(
    state: State<'_, AppState>,
    repo_id: String,
    onto: String,
) -> Result<Vec<TodoEntry>, AppError> {
    if !is_safe_revision(&onto) {
        return Err(invalid_arg("branch name"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(rebase::rebase_todo(&state.runner, &repo.info.work_tree, &onto).await?)
}

/// Runs an interactive-lite rebase with the given todo (reorder, squash, fixup, drop).
#[tauri::command]
pub async fn rebase_interactive(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    onto: String,
    items: Vec<TodoItem>,
) -> Result<(), AppError> {
    if !is_safe_revision(&onto) {
        return Err(invalid_arg("branch name"));
    }
    if items.iter().any(|i| !valid_oid(&i.oid)) {
        return Err(invalid_arg("commit id"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let result =
        rebase::rebase_interactive(&state.runner, &repo.info.work_tree, &onto, &items).await;
    match result {
        Ok(()) => {
            emit_changed(&app, &repo_id, &ALL);
            Ok(())
        }
        Err(e) => {
            if matches!(&e, RebaseError::Git(g) if changed_anyway(&g.kind)) {
                emit_changed(&app, &repo_id, &ALL);
            }
            Err(e.into())
        }
    }
}

/// Aborts the operation in progress.
#[tauri::command]
pub async fn op_abort(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    kind: OpKind,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    merge::abort(&state.runner, &repo.info.work_tree, kind).await?;
    emit_changed(&app, &repo_id, &ALL);
    Ok(())
}

/// Continues the operation in progress after the conflicts were resolved.
#[tauri::command]
pub async fn op_continue(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    kind: OpKind,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let result = merge::continue_op(&state.runner, &repo.info.work_tree, kind).await;
    match result {
        Ok(()) => {
            emit_changed(&app, &repo_id, &ALL);
            Ok(())
        }
        Err(e) => {
            if changed_anyway(&e.kind) {
                emit_changed(&app, &repo_id, &ALL);
            }
            Err(e.into())
        }
    }
}

/// Skips the current step of a rebase, cherry-pick or revert.
#[tauri::command]
pub async fn op_skip(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    kind: OpKind,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let result = merge::skip(&state.runner, &repo.info.work_tree, kind).await;
    match result {
        Ok(()) => {
            emit_changed(&app, &repo_id, &ALL);
            Ok(())
        }
        Err(e) => {
            if changed_anyway(&e.kind) {
                emit_changed(&app, &repo_id, &ALL);
            }
            Err(e.into())
        }
    }
}

/// The merge/rebase/cherry-pick/revert in progress, if any.
#[tauri::command]
#[allow(clippy::unused_async)] // borrowed `State` requires an async command
pub async fn op_state(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Option<InProgress>, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(state::in_progress(&repo.info))
}
