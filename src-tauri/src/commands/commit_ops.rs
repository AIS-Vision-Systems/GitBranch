//! Commit, amend and message-template commands.

use git_core::ops::commit::{self as ops, CommitArgs, CommitTemplate};
use tauri::State;

use super::{emit_changed, invalid_arg, not_open};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

/// Creates or amends a commit; returns the new HEAD oid.
#[tauri::command]
pub async fn commit(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    args: CommitArgs,
) -> Result<String, AppError> {
    if args.message.trim().is_empty() {
        return Err(invalid_arg("commit message"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let oid = ops::commit(&state.runner, &repo.info.work_tree, &args).await?;
    emit_changed(&app, &repo_id, &[Change::Head, Change::Refs, Change::Index]);
    Ok(oid)
}

/// Prefilled message from `MERGE_MSG`, `SQUASH_MSG` or `commit.template`.
#[tauri::command]
pub async fn commit_template(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Option<CommitTemplate>, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(ops::commit_template(&state.runner, &repo.info).await?)
}

/// Full message of HEAD, for amending.
#[tauri::command]
pub async fn head_message(state: State<'_, AppState>, repo_id: String) -> Result<String, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(ops::head_message(&state.runner, &repo.info.work_tree).await?)
}
