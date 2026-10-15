//! Tauri shell for GitBranch. Commands are thin: parse args, call `git-core`, map errors.

#![deny(unsafe_code)]

mod commands;
mod error;

pub use error::AppError;

/// Builds and runs the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::app::app_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
