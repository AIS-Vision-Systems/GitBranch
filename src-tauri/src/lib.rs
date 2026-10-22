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

/// True when this process was started by git as its `GIT_ASKPASS` program rather than by the user.
///
/// git runs `$GIT_ASKPASS "<prompt>"` with the prompt as the only argument, so there is no flag
/// to look for. The runner sets `GITBRANCH_ASKPASS=1` on every git spawn (D-024 amendment); with
/// a single `Username for '...'` / `Password for '...'` argument that identifies the call (the
/// strict host check happens later, in `askpass::answer`; other hosts just get exit 1).
/// Anything else is the normal `gitbranch [<path>]` start.
pub fn is_askpass_invocation(env_flag: Option<&str>, args: &[String]) -> bool {
    env_flag == Some("1")
        && args.len() == 1
        && (args[0].starts_with("Username for '") || args[0].starts_with("Password for '"))
}

/// Askpass mode: prints the answer for git's prompt and returns exit code 0, or returns 1 with no
/// output when there is no answer. Nothing is logged or initialised.
pub fn askpass_main(args: &[String]) -> i32 {
    use std::io::Write;
    let prompt = args.join(" ");
    match github_api::askpass::answer(&prompt, &github_api::token::KeyringStore) {
        Some(answer) => {
            let mut out = std::io::stdout().lock();
            i32::from(writeln!(out, "{answer}").and_then(|()| out.flush()).is_err())
        }
        None => 1,
    }
}

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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(commands::graph::GraphCache::default())
        .manage(commands::github::GithubState::default())
        .manage(watcher::Watchers::default())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            let exe = std::env::current_exe()
                .inspect_err(|e| tracing::warn!("cannot resolve own exe, askpass disabled: {e}"))
                .ok();
            let runner = GitRunner::from_env().with_askpass(exe);
            app.manage(AppState::new(runner, dir.join("recent.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::load_session,
            commands::app::save_session,
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
            commands::remote::cancel_op,
            commands::clone::clone,
            commands::submodule::list_submodules,
            commands::worktree::list_worktrees,
            commands::worktree::add_worktree,
            commands::worktree::remove_worktree,
            commands::worktree::prune_worktrees,
            commands::worktree::lock_worktree,
            commands::worktree::unlock_worktree,
            commands::worktree::default_worktree_path,
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
            commands::blame::blame,
            commands::reflog::undo_preview,
            commands::reflog::undo_last,
            commands::github::github_account,
            commands::github::github_repos,
            commands::github::github_repo_slug,
            commands::github::github_pulls,
            commands::github::github_checks,
            commands::github::github_pull,
            commands::github::github_repo_info,
            commands::github::github_create_pull,
            commands::history::commits_between,
            commands::github::github_checkout_pull,
            commands::github::github_login_start,
            commands::github::github_login_wait,
            commands::github::github_login_cancel,
            commands::github::github_logout,
            commands::github::github_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::is_askpass_invocation;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn detects_askpass_mode() {
        let p = args(&["Username for 'https://github.com': "]);
        assert!(is_askpass_invocation(Some("1"), &p));
        assert!(!is_askpass_invocation(None, &p));
        assert!(!is_askpass_invocation(Some("1"), &args(&[r"C:\repo"])));
        let prompt_only = args(&["Password for 'https://github.com': "]);
        assert!(!is_askpass_invocation(None, &prompt_only));
        assert!(!is_askpass_invocation(Some("0"), &prompt_only));
        assert!(!is_askpass_invocation(Some("1"), &args(&[])));
        assert!(!is_askpass_invocation(Some("1"), &args(&["Password for 'https://a.b': ", "x"])));
    }
}
