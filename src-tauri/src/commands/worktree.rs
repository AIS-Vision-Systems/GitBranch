//! `worktree` commands: list, add, remove, prune, lock, unlock.

use std::path::{Path, PathBuf};

use git_core::ops::worktree::{self as wt, Worktree, WorktreeCheckout};
use git_core::refname::{is_safe_revision, is_valid_branch_name};
use tauri::State;

use super::graph::GraphCache;
use super::{emit_changed, invalid_arg, not_open};
use crate::AppError;
use crate::state::{AppState, OpenRepo};
use crate::watcher::{Change, Watchers};

/// Directory every worktree operation runs from: the main checkout (never a linked one that may
/// be deleted or removed). For a bare main, `work_tree` is the git dir, which works too.
fn base(repo: &OpenRepo) -> PathBuf {
    repo.info.main_work_tree.clone().unwrap_or_else(|| repo.info.work_tree.clone())
}

impl From<wt::WorktreeError> for AppError {
    fn from(err: wt::WorktreeError) -> Self {
        match err {
            wt::WorktreeError::Git(g) => g.into(),
            wt::WorktreeError::Parse(p) => AppError::new("parse.invalid", p.to_string()),
        }
    }
}

/// Resolves `path` to a linked (non-main) worktree of the repository.
async fn linked_path(state: &AppState, base: &Path, path: &str) -> Result<PathBuf, AppError> {
    let list = wt::list_worktrees(&state.runner, base).await?;
    wt::find_linked(&list, Path::new(path))
        .map(|w| PathBuf::from(&w.path))
        .ok_or_else(|| invalid_arg("worktree path"))
}

/// Lists the worktrees of the repository (main checkout first).
#[tauri::command]
pub async fn list_worktrees(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Vec<Worktree>, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    wt::list_worktrees(&state.runner, &repo.info.work_tree).await.map_err(|e| match e {
        wt::WorktreeError::Git(g) => AppError::from(g),
        wt::WorktreeError::Parse(p) => AppError::new("git.parse", p.to_string()),
    })
}

/// Adds a worktree at an absolute `path`.
#[tauri::command]
pub async fn add_worktree(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    checkout: WorktreeCheckout,
    force: bool,
) -> Result<(), AppError> {
    if !Path::new(&path).is_absolute() {
        return Err(invalid_arg("worktree path"));
    }
    match &checkout {
        WorktreeCheckout::Existing { branch } if !is_valid_branch_name(branch) => {
            return Err(invalid_arg("branch name"));
        }
        WorktreeCheckout::New { branch, start_point } => {
            if !is_valid_branch_name(branch) {
                return Err(invalid_arg("branch name"));
            }
            if !is_safe_revision(start_point) {
                return Err(invalid_arg("start point"));
            }
        }
        WorktreeCheckout::Detached { revision } if !is_safe_revision(revision) => {
            return Err(invalid_arg("revision"));
        }
        _ => {}
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    wt::add_worktree(&state.runner, &base(&repo), Path::new(&path), &checkout, force).await?;
    emit_changed(&app, &repo_id, &[Change::Refs, Change::Worktrees]);
    Ok(())
}

/// Removes a linked worktree; `force` also removes dirty ones (never a locked one: unlock first).
///
/// Every open repository whose work tree is the target is closed first (watcher stopped, state
/// dropped) so nothing holds the directory; their ids are returned so the UI can drop those tabs.
/// The ids are not returned when git then refuses (the error is), so the UI should refresh.
#[tauri::command]
pub async fn remove_worktree(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    watchers: State<'_, Watchers>,
    cache: State<'_, GraphCache>,
    repo_id: String,
    path: String,
    force: bool,
) -> Result<Vec<String>, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let base = base(&repo);
    let target = linked_path(&state, &base, &path).await?;
    let mut closed = Vec::new();
    for r in state.open_repos() {
        if wt::same_path(&r.info.work_tree, &target) {
            watchers.stop(&r.id);
            cache.forget(&r.id);
            state.close(&r.id);
            closed.push(r.id);
        }
    }
    wt::remove_worktree(&state.runner, &base, &target, force).await?;
    emit_changed(&app, &repo_id, &[Change::Worktrees]);
    Ok(closed)
}

/// Prunes worktrees whose directory no longer exists.
#[tauri::command]
pub async fn prune_worktrees(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    wt::prune_worktrees(&state.runner, &base(&repo)).await?;
    emit_changed(&app, &repo_id, &[Change::Worktrees]);
    Ok(())
}

/// Locks a linked worktree.
#[tauri::command]
pub async fn lock_worktree(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    reason: Option<String>,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let target = linked_path(&state, &base(&repo), &path).await?;
    wt::lock_worktree(&state.runner, &base(&repo), &target, reason.as_deref()).await?;
    emit_changed(&app, &repo_id, &[Change::Worktrees]);
    Ok(())
}

/// Unlocks a linked worktree.
#[tauri::command]
pub async fn unlock_worktree(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let target = linked_path(&state, &base(&repo), &path).await?;
    wt::unlock_worktree(&state.runner, &base(&repo), &target).await?;
    emit_changed(&app, &repo_id, &[Change::Worktrees]);
    Ok(())
}

/// Suggested path for a new worktree of `branch`.
#[tauri::command]
pub async fn default_worktree_path(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
) -> Result<String, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let main = repo.info.main_work_tree.as_ref().unwrap_or(&repo.info.work_tree);
    Ok(wt::default_worktree_path(main, &branch).to_string_lossy().into_owned())
}
