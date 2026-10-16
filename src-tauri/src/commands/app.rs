use serde::Serialize;

use crate::AppError;

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
