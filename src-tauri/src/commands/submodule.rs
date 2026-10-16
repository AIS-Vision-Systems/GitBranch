//! `list_submodules` command.

use git_core::ops::submodule::{self, Submodule};
use tauri::State;

use super::not_open;
use crate::AppError;
use crate::state::AppState;

/// Lists the repository's submodules with their state (read only).
#[tauri::command]
pub async fn list_submodules(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Vec<Submodule>, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(submodule::list_submodules(&state.runner, &repo.info.work_tree).await?)
}
