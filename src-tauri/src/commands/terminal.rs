//! Opens an external terminal in a work tree.

use tauri::State;

use super::not_open;
use crate::AppError;
use crate::state::AppState;
use crate::terminal::terminal_candidates;

/// Opens the terminal (the terminal setting, else a platform default) with the work tree as cwd.
#[tauri::command]
pub async fn open_terminal(state: State<'_, AppState>, repo_id: String) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let work = &repo.info.work_tree;
    let override_cmd = state.settings().terminal;
    let env = |k: &str| std::env::var(k).ok();
    let candidates = terminal_candidates(override_cmd.as_deref(), work, &env);
    let mut tried = Vec::new();
    for argv in &candidates {
        tried.push(argv[0].clone());
        let Some(program) = git_core::ops::config::resolve_program(&argv[0]) else {
            continue;
        };
        let mut cmd = std::process::Command::new(program);
        cmd.args(&argv[1..]).current_dir(work);
        // A console program (cmd.exe, pwsh) must inherit the new console's stdio: null handles make it
        // read EOF and exit at once. On Linux the emulator makes its own pty, so detach stdio.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
            cmd.creation_flags(CREATE_NEW_CONSOLE);
        }
        #[cfg(not(windows))]
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        match cmd.spawn() {
            Ok(mut child) => {
                // Reap the launcher (gnome-terminal and friends exit at once) instead of leaving a zombie.
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok(());
            }
            Err(e) => tracing::warn!("could not start terminal {}: {e}", argv[0]),
        }
    }
    Err(AppError::new(
        "terminal.open_failed",
        format!("No terminal could be started (tried {})", tried.join(", ")),
    ))
}
