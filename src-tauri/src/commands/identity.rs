//! Commit identity (`user.name` / `user.email`) commands.

use git_core::ops::config::{self, ConfigError, ConfigScope, Identity};
use tauri::State;

use super::not_open;
use crate::AppError;
use crate::state::AppState;

impl From<ConfigError> for AppError {
    fn from(err: ConfigError) -> Self {
        match err {
            ConfigError::Git(g) => g.into(),
            ConfigError::Parse(p) => AppError::new("parse.invalid", p.to_string()),
            e @ ConfigError::Invalid(_) => AppError::new("arg.invalid", e.to_string()),
        }
    }
}

/// The effective identity for the repository, with the scope each value comes from.
#[tauri::command]
pub async fn git_identity(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Identity, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(config::identity(&state.runner, &repo.info.work_tree).await?)
}

/// Writes the identity at `scope`.
#[tauri::command]
pub async fn set_git_identity(
    state: State<'_, AppState>,
    repo_id: String,
    scope: ConfigScope,
    name: String,
    email: String,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(config::set_identity(&state.runner, &repo.info.work_tree, scope, &name, &email).await?)
}
