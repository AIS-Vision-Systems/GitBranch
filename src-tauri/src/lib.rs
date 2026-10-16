//! Tauri shell for GitBranch. Commands are thin: parse args, call `git-core`, map errors.

#![deny(unsafe_code)]

mod commands;
mod error;
mod state;
mod watcher;

pub use error::AppError;

use git_core::GitRunner;
use state::AppState;
use tauri::Manager;

/// Builds and runs the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `GITBRANCH_LOG` (e.g. `debug`, `git=debug,gitbranch=info`) controls verbosity; default info.
    let filter = tracing_subscriber::EnvFilter::try_from_env("GITBRANCH_LOG")
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).with_target(true).init();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::graph::GraphCache::default())
        .manage(watcher::Watchers::default())
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
            commands::graph::load_graph,
            commands::graph::list_refs,
            commands::graph::repo_status,
            commands::commit::commit_details,
            commands::commit::file_diff,
            commands::stage::stage_files,
            commands::stage::unstage_files,
            commands::stage::discard_files,
            commands::stage::stage_all,
            commands::stage::unstage_all,
            commands::stage::apply_hunk,
            commands::commit_ops::commit,
            commands::commit_ops::commit_template,
            commands::commit_ops::head_message,
            commands::branch::create_branch,
            commands::branch::checkout,
            commands::branch::rename_branch,
            commands::branch::delete_branch,
            commands::branch::set_upstream,
            commands::stash::stash_list,
            commands::stash::stash_push,
            commands::stash::stash_apply,
            commands::stash::stash_pop,
            commands::stash::stash_drop,
            commands::history::reset,
            commands::history::revert,
            commands::history::cherry_pick,
            commands::tag::create_tag,
            commands::tag::delete_tag,
            commands::remote::list_remotes,
            commands::remote::add_remote,
            commands::remote::remove_remote,
            commands::remote::rename_remote,
            commands::remote::fetch,
            commands::remote::pull,
            commands::remote::push,
            commands::remote::default_pull_mode,
            commands::merge::merge,
            commands::merge::rebase,
            commands::merge::rebase_todo,
            commands::merge::rebase_interactive,
            commands::merge::op_abort,
            commands::merge::op_continue,
            commands::merge::op_skip,
            commands::merge::op_state,
            commands::conflict::take_side,
            commands::conflict::mark_resolved,
            commands::conflict::conflicted_files,
            commands::conflict::open_in_editor,
            commands::reflog::undo_preview,
            commands::reflog::undo_last,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
