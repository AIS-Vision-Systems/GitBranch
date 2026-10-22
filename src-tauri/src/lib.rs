//! Tauri shell for GitBranch. Commands are thin: parse args, call `git-core`, map errors.

#![deny(unsafe_code)]

mod commands;
mod error;
mod launch;
mod settings;
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

/// Non-blocking log writer guard; taken and dropped on `RunEvent::Exit` so the last lines flush.
type LogGuard = tracing_appender::non_blocking::WorkerGuard;
struct LogGuardState(std::sync::Mutex<Option<LogGuard>>);

/// Daily-rolling `gitbranch.log` appender (7 files kept) in `dir`, or the reason it failed.
fn file_appender(
    dir: &std::path::Path,
) -> Result<tracing_appender::rolling::RollingFileAppender, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("gitbranch")
        .filename_suffix("log")
        .max_log_files(7)
        .build(dir)
        .map_err(|e| e.to_string())
}

/// Non-blocking file writer for the log, or `None` (plus the reason) when the dir is unusable.
fn file_writer(
    log_dir: Option<&std::path::Path>,
) -> (Option<(tracing_appender::non_blocking::NonBlocking, LogGuard)>, Option<String>) {
    match log_dir.ok_or_else(|| "no log directory available".to_string()).and_then(file_appender) {
        Ok(appender) => (Some(tracing_appender::non_blocking(appender)), None),
        Err(e) => (None, Some(e)),
    }
}

/// Installs the stderr layer plus the file layer. Called from `setup` (not before the builder)
/// because the app log dir is only resolvable once the app exists.
/// `GITBRANCH_LOG` (e.g. `debug`, `git=debug,gitbranch=info`) controls verbosity; default info.
/// A log file that cannot be created only warns on stderr. Local only, never uploaded (D-007).
fn init_logging(log_dir: Option<&std::path::Path>) -> Option<LogGuard> {
    use tracing_subscriber::prelude::*;
    let filter = tracing_subscriber::EnvFilter::try_from_env("GITBRANCH_LOG")
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let (writer, warning) = file_writer(log_dir);
    let (file_layer, guard) = match writer {
        Some((w, g)) => {
            (Some(tracing_subscriber::fmt::layer().with_ansi(false).with_writer(w)), Some(g))
        }
        None => (None, None),
    };
    let init = tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_target(true).with_writer(std::io::stderr))
        .with(file_layer)
        .try_init();
    if init.is_ok()
        && let Some(w) = warning
    {
        tracing::warn!("file logging disabled: {w}");
    }
    guard
}

/// Builds and runs the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Single instance must be the first plugin registered.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        launch::on_second_instance(app, &args, &cwd);
    }));
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .manage(commands::graph::GraphCache::default())
        .manage(commands::github::GithubState::default())
        .manage(watcher::Watchers::default())
        .manage(launch::initial_launch_path())
        .setup(|app| {
            let guard = init_logging(app.path().app_log_dir().ok().as_deref());
            app.manage(LogGuardState(std::sync::Mutex::new(guard)));
            let dir = app.path().app_config_dir()?;
            let exe = std::env::current_exe()
                .inspect_err(|e| tracing::warn!("cannot resolve own exe, askpass disabled: {e}"))
                .ok();
            // A configured git path applies from the next start; an invalid one falls back.
            let git = settings::load(&dir.join("settings.json")).usable_git_path();
            let runner = git.map_or_else(GitRunner::from_env, GitRunner::new).with_askpass(exe);
            app.manage(AppState::new(runner, dir.join("recent.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::can_self_update,
            commands::app::open_log_dir,
            launch::take_launch_path,
            commands::app::load_session,
            commands::app::save_session,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::difftool::open_difftool,
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
            commands::clone::list_remote_heads,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|handle, event| {
            if let tauri::RunEvent::Exit = event
                && let Some(state) = handle.try_state::<LogGuardState>()
                && let Ok(mut guard) = state.0.lock()
            {
                drop(guard.take()); // flushes buffered log lines
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{file_writer, is_askpass_invocation};

    #[test]
    fn unwritable_log_dir_gives_none_without_panic() {
        let t = tempfile::tempdir().expect("tempdir");
        let file = t.path().join("plain-file");
        std::fs::write(&file, "x").expect("write");
        // A directory path nested under a regular file can never be created.
        let (writer, warning) = file_writer(Some(&file.join("logs")));
        assert!(writer.is_none());
        assert!(warning.is_some());
        let (writer, warning) = file_writer(None);
        assert!(writer.is_none() && warning.is_some());
        let (writer, warning) = file_writer(Some(&t.path().join("ok")));
        assert!(writer.is_some() && warning.is_none());
    }

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
