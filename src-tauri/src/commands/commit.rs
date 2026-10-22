use git_core::parse::diff::{DiffTarget, FileDiff};
use git_core::parse::show::CommitDetails;
use tauri::State;

use crate::AppError;
use crate::state::AppState;

fn valid_oid(oid: &str) -> bool {
    (4..=64).contains(&oid.len()) && oid.bytes().all(|b| b.is_ascii_hexdigit())
}

fn not_open() -> AppError {
    AppError::new("repo.not_open", "Repository is not open")
}

fn bad_oid() -> AppError {
    AppError::new("arg.invalid", "Invalid commit id")
}

/// Metadata and changed files of one commit (first-parent diff for merges).
#[tauri::command]
pub async fn commit_details(
    state: State<'_, AppState>,
    repo_id: String,
    oid: String,
) -> Result<CommitDetails, AppError> {
    if !valid_oid(&oid) {
        return Err(bad_oid());
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(git_core::parse::show::commit_details(&state.runner, &repo.info.work_tree, &oid).await?)
}

/// Hunks of one file for a commit, the index, the work tree, or an untracked file.
#[tauri::command]
pub async fn file_diff(
    state: State<'_, AppState>,
    repo_id: String,
    target: DiffTarget,
) -> Result<FileDiff, AppError> {
    if let DiffTarget::Commit { oid, .. } = &target {
        if !valid_oid(oid) {
            return Err(bad_oid());
        }
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let opts = state.settings().diff_options();
    Ok(git_core::parse::diff::file_diff_with(&state.runner, &repo.info.work_tree, &target, &opts)
        .await?)
}
