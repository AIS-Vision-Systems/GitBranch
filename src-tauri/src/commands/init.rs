//! `init_repo` command: creates a repository in a new or empty directory.

use git_core::ops::init::{self, InitArgs, InitResult};
use tauri::State;

use crate::AppError;
use crate::state::AppState;

/// Creates a repository at `args.dest`; the UI opens the returned path with `open_repo`.
/// `commitError` is set when the repository exists but the README commit failed.
#[tauri::command]
pub async fn init_repo(state: State<'_, AppState>, args: InitArgs) -> Result<InitResult, AppError> {
    Ok(init::init(&state.runner, &args).await?)
}
