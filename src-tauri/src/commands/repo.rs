use std::path::Path;

use serde::Serialize;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::AppError;
use crate::state::{AppState, RecentRepo};

/// Result of opening a repository.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRepo {
    /// Stable repository id used by every other command.
    pub repo_id: String,
    /// Last component of the work-tree path.
    pub name: String,
    /// Work-tree path.
    pub path: String,
    /// Git dir of this checkout.
    pub git_dir: String,
    /// True for a linked worktree.
    pub is_worktree: bool,
    /// Main checkout when `is_worktree`.
    pub main_work_tree: Option<String>,
    /// True for a bare repository.
    pub is_bare: bool,
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Shows the native folder picker; `None` when cancelled.
#[tauri::command]
pub async fn pick_repo_dir(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    let picked =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|e| AppError::new("app.dialog", e.to_string()))?;
    Ok(picked.and_then(|p| p.into_path().ok()).map(|p| s(&p)))
}

/// Discovers and registers a repository; a linked worktree stays a worktree (see `main_work_tree`).
#[tauri::command]
pub async fn open_repo(state: State<'_, AppState>, path: String) -> Result<OpenedRepo, AppError> {
    let info = git_core::repo::discover(&state.runner, Path::new(&path)).await?;
    let repo = state.open(info);
    let work_tree = s(&repo.info.work_tree);
    let name = repo
        .info
        .work_tree
        .file_name()
        .map_or_else(|| work_tree.clone(), |n| n.to_string_lossy().into_owned());
    state.touch_recent(&work_tree, &name);
    Ok(OpenedRepo {
        repo_id: repo.id,
        name,
        path: work_tree,
        git_dir: s(&repo.info.git_dir),
        is_worktree: repo.info.is_worktree,
        main_work_tree: repo.info.main_work_tree.as_deref().map(s),
        is_bare: repo.info.is_bare,
    })
}

/// Recent repositories, most recent first.
#[tauri::command]
pub async fn list_recent(state: State<'_, AppState>) -> Result<Vec<RecentRepo>, AppError> {
    Ok(state.recent())
}

/// Removes an entry from the recent list.
#[tauri::command]
pub async fn remove_recent(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    state.remove_recent(&path);
    Ok(())
}

/// Forgets an open repository.
#[tauri::command]
pub async fn close_repo(state: State<'_, AppState>, repo_id: String) -> Result<(), AppError> {
    state.close(&repo_id);
    Ok(())
}
