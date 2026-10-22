//! Blame command (Phase 6).

use git_core::ops::blame as ops;
use git_core::parse::blame::{Blame, BlameError};
use tauri::State;

use super::not_open;
use crate::AppError;
use crate::state::AppState;

impl From<BlameError> for AppError {
    fn from(err: BlameError) -> Self {
        match err {
            BlameError::Git(g) => g.into(),
            BlameError::Parse(p) => AppError::new("parse.invalid", p.to_string()),
            e @ BlameError::InvalidRevision(_) => {
                AppError::new("git.invalid_revision", e.to_string())
            }
        }
    }
}

/// Blame of `path` at `rev` (the working tree when `None`).
#[tauri::command]
pub async fn blame(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    rev: Option<String>,
) -> Result<Blame, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(ops::blame(&state.runner, &repo.info.work_tree, &path, rev.as_deref()).await?)
}
