//! Conflict resolution commands (Phase 2).

use git_core::ops::config::editor_command;
use git_core::ops::conflict::{self, Side};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use super::{emit_changed, invalid_arg, not_open, valid_rel_path};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

fn check_paths(paths: &[String]) -> Result<(), AppError> {
    if paths.iter().all(|p| valid_rel_path(p)) { Ok(()) } else { Err(invalid_arg("path")) }
}

/// Keeps our or their version of the conflicted files and stages them.
#[tauri::command]
pub async fn take_side(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
    side: Side,
) -> Result<(), AppError> {
    check_paths(&paths)?;
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let res = conflict::take_side(&state.runner, &repo.info.work_tree, &paths, side).await;
    // A failure midway may still have changed the index or work tree.
    emit_changed(&app, &repo_id, &[Change::Index, Change::WorkingTree]);
    Ok(res?)
}

/// Stages the files, marking their conflicts as resolved.
#[tauri::command]
pub async fn mark_resolved(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    check_paths(&paths)?;
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    conflict::mark_resolved(&state.runner, &repo.info.work_tree, &paths).await?;
    emit_changed(&app, &repo_id, &[Change::Index, Change::WorkingTree]);
    Ok(())
}

/// Files that still have unresolved conflicts.
#[tauri::command]
pub async fn conflicted_files(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Vec<String>, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(conflict::conflicted_files(&state.runner, &repo.info.work_tree).await?)
}

/// Opens a work-tree file in the editor (the editor setting, else `core.editor`, `$VISUAL`, `$EDITOR`); without
/// one, reveals the file in the file manager. Never opens a file with its default handler, so a
/// tracked executable or script cannot be run from here.
#[tauri::command]
pub async fn open_in_editor(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> Result<(), AppError> {
    if !valid_rel_path(&path) {
        return Err(invalid_arg("path"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let work = &repo.info.work_tree;
    let full = work.join(&path);
    let failed = |m: String| AppError::new("editor.open_failed", m);
    let (Ok(canon_work), Ok(canon_full)) =
        (std::fs::canonicalize(work), std::fs::canonicalize(&full))
    else {
        return Err(failed(format!("{path} does not exist")));
    };
    if !canon_full.starts_with(&canon_work) {
        return Err(invalid_arg("path"));
    }
    if !canon_full.is_file() {
        return Err(failed(format!("{path} is not a file")));
    }
    let override_cmd = state.settings().editor;
    match editor_command(&state.runner, work, override_cmd.as_deref()).await? {
        Some(argv) => {
            let child = std::process::Command::new(&argv[0])
                .args(&argv[1..])
                .arg(&full)
                .current_dir(work)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|e| failed(e.to_string()))?;
            drop(child);
            Ok(())
        }
        None => app.opener().reveal_item_in_dir(&full).map_err(|e| failed(e.to_string())),
    }
}
