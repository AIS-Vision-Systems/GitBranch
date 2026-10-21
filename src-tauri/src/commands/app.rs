use serde::Serialize;
use tauri::State;

use crate::AppError;
use crate::commands::invalid_arg;
use crate::state::{AppState, Session};

/// Static information about the running application.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// GitBranch version (Cargo package version).
    pub version: String,
    /// `git-core` crate version.
    pub git_core_version: String,
    /// `github-api` crate version.
    pub github_api_version: String,
    /// Repository path given on the command line (`gitbranch <path>`), if any.
    pub startup_repo: Option<String>,
}

/// Returns version information; the first IPC call the UI makes, used to verify the bridge.
#[tauri::command]
pub async fn app_info() -> Result<AppInfo, AppError> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        git_core_version: git_core::VERSION.to_string(),
        github_api_version: github_api::VERSION.to_string(),
        startup_repo: std::env::args_os()
            .nth(1)
            .filter(|a| !a.to_string_lossy().starts_with('-'))
            .filter(|a| std::path::Path::new(a).is_dir())
            .map(|a| a.to_string_lossy().into_owned()),
    })
}

/// Maximum number of repositories remembered in the session.
const MAX_SESSION_OPEN: usize = 32;
/// Longest accepted repository path in a session entry.
const MAX_SESSION_PATH: usize = 4096;

/// Returns the repositories that were open when the app last ran.
#[tauri::command]
pub async fn load_session(state: State<'_, AppState>) -> Result<Session, AppError> {
    Ok(state.load_session())
}

/// Remembers the open repositories (tab order) and the active one for the next start.
#[tauri::command]
pub async fn save_session(
    state: State<'_, AppState>,
    mut session: Session,
) -> Result<(), AppError> {
    let too_long = |p: &String| p.len() > MAX_SESSION_PATH;
    if session.open.iter().any(too_long) || session.current.as_ref().is_some_and(too_long) {
        return Err(invalid_arg("session path"));
    }
    session.open.truncate(MAX_SESSION_OPEN);
    state
        .save_session(&session)
        .map_err(|e| AppError::new("io.session", format!("Could not save session: {e}")))
}
