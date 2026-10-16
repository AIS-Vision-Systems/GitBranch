//! Stage, unstage, discard and hunk-level apply commands.

use git_core::ops::patch::{HunkSelection, PatchError, PatchOp};
use git_core::ops::stage as ops;
use git_core::parse::diff::DiffTarget;
use tauri::State;

use super::{emit_changed, invalid_arg, not_open, valid_rel_path};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

impl From<PatchError> for AppError {
    fn from(err: PatchError) -> Self {
        match err {
            PatchError::Git(g) => g.into(),
            PatchError::Diff(d) => d.into(),
            PatchError::Stale => AppError::new("stage.stale", err.to_string()),
            PatchError::Invalid(_) => AppError::new("arg.invalid", err.to_string()),
        }
    }
}

fn check_paths(paths: &[String]) -> Result<(), AppError> {
    if paths.iter().all(|p| valid_rel_path(p)) { Ok(()) } else { Err(invalid_arg("path")) }
}

/// Stages whole files.
#[tauri::command]
pub async fn stage_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    check_paths(&paths)?;
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    ops::stage(&state.runner, &repo.info.work_tree, &paths).await?;
    emit_changed(&app, &repo_id, &[Change::Index]);
    Ok(())
}

/// Unstages whole files.
#[tauri::command]
pub async fn unstage_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    check_paths(&paths)?;
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    ops::unstage(&state.runner, &repo.info.work_tree, &paths).await?;
    emit_changed(&app, &repo_id, &[Change::Index]);
    Ok(())
}

/// Discards work-tree changes (tracked files are restored, untracked ones deleted).
#[tauri::command]
pub async fn discard_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    tracked: Vec<String>,
    untracked: Vec<String>,
) -> Result<(), AppError> {
    check_paths(&tracked)?;
    check_paths(&untracked)?;
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    ops::discard(&state.runner, &repo.info.work_tree, &tracked, &untracked).await?;
    emit_changed(&app, &repo_id, &[Change::Index, Change::WorkingTree]);
    Ok(())
}

/// Stages everything.
#[tauri::command]
pub async fn stage_all(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    ops::stage_all(&state.runner, &repo.info.work_tree).await?;
    emit_changed(&app, &repo_id, &[Change::Index]);
    Ok(())
}

/// Unstages everything.
#[tauri::command]
pub async fn unstage_all(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    ops::unstage_all(&state.runner, &repo.info.work_tree).await?;
    emit_changed(&app, &repo_id, &[Change::Index]);
    Ok(())
}

/// Stages, unstages or discards one hunk (or some of its lines).
#[tauri::command]
pub async fn apply_hunk(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    selection: HunkSelection,
    op: PatchOp,
) -> Result<(), AppError> {
    let (DiffTarget::Commit { path, .. }
    | DiffTarget::Staged { path }
    | DiffTarget::Unstaged { path }
    | DiffTarget::Untracked { path }) = &selection.target;
    if !valid_rel_path(path) {
        return Err(invalid_arg("path"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    git_core::ops::patch::apply_selection(&state.runner, &repo.info.work_tree, &selection, op)
        .await?;
    let what: &[Change] = if op == PatchOp::Discard {
        &[Change::Index, Change::WorkingTree]
    } else {
        &[Change::Index]
    };
    emit_changed(&app, &repo_id, what);
    Ok(())
}
