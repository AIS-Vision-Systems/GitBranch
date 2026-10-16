//! Tauri shell for GitBranch. Commands are thin: parse args, call `git-core`, map errors.

#![deny(unsafe_code)]

mod commands;
mod error;
mod state;

pub use error::AppError;

use git_core::GitRunner;
use state::AppState;
use tauri::Manager;

/// Builds and runs the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            app.manage(AppState::new(GitRunner::from_env(), dir.join("recent.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::repo::pick_repo_dir,
            commands::repo::open_repo,
            commands::repo::list_recent,
            commands::repo::remove_recent,
            commands::repo::close_repo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
