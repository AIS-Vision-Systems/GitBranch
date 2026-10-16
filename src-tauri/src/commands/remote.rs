//! `remote` commands: configure remotes, fetch, pull, push.

use git_core::ops::remote::{
    self, FetchArgs, PullArgs, PullMode, PullResult, PushArgs, PushResult, Remote, valid_branch_arg,
};
use git_core::refname::is_valid_remote_name;
use git_core::runner::redact_credentials;
use tauri::State;

use super::{emit_changed, invalid_arg, not_open};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

const PULL_CHANGES: [Change; 4] = [Change::Refs, Change::Head, Change::Index, Change::WorkingTree];

fn valid_url(url: &str) -> bool {
    !url.is_empty() && !url.starts_with('-') && !url.chars().any(char::is_control)
}

/// Whether `url` embeds a password (`scheme://user:pw@host`).
fn has_embedded_password(url: &str) -> bool {
    redact_credentials(url) != url
        && url.split_once("://").is_some_and(|(_, rest)| {
            let auth = rest.split('/').next().unwrap_or("");
            auth.rsplit_once('@').is_some_and(|(ui, _)| ui.contains(':'))
        })
}

fn check_remote(name: &str) -> Result<(), AppError> {
    if is_valid_remote_name(name) { Ok(()) } else { Err(invalid_arg("remote name")) }
}

fn check_branch(branch: Option<&str>) -> Result<(), AppError> {
    if branch.is_some_and(|b| !valid_branch_arg(b)) {
        return Err(invalid_arg("branch name"));
    }
    Ok(())
}

/// Lists the configured remotes.
#[tauri::command]
pub async fn list_remotes(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Vec<Remote>, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let mut list = remote::list_remotes(&state.runner, &repo.info.work_tree).await?;
    for r in &mut list {
        r.fetch_url = redact_credentials(&r.fetch_url);
        r.push_url = r.push_url.as_deref().map(redact_credentials);
    }
    Ok(list)
}

/// Adds a remote.
#[tauri::command]
pub async fn add_remote(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    url: String,
) -> Result<(), AppError> {
    check_remote(&name)?;
    if !valid_url(&url) {
        return Err(invalid_arg("remote url"));
    }
    if has_embedded_password(&url) {
        return Err(invalid_arg(
            "remote url (embedded credentials are not allowed; the token lives in the keyring)",
        ));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    remote::add_remote(&state.runner, &repo.info.work_tree, &name, &url).await?;
    emit_changed(&app, &repo_id, &[Change::Refs]);
    Ok(())
}

/// Removes a remote and its remote-tracking branches.
#[tauri::command]
pub async fn remove_remote(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> Result<(), AppError> {
    check_remote(&name)?;
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    remote::remove_remote(&state.runner, &repo.info.work_tree, &name).await?;
    emit_changed(&app, &repo_id, &[Change::Refs]);
    Ok(())
}

/// Renames a remote.
#[tauri::command]
pub async fn rename_remote(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    old: String,
    new: String,
) -> Result<(), AppError> {
    check_remote(&old)?;
    check_remote(&new)?;
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    remote::rename_remote(&state.runner, &repo.info.work_tree, &old, &new).await?;
    emit_changed(&app, &repo_id, &[Change::Refs]);
    Ok(())
}

/// Fetches one remote or all of them.
#[tauri::command]
pub async fn fetch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    args: FetchArgs,
) -> Result<(), AppError> {
    if let Some(r) = &args.remote {
        check_remote(r)?;
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let res = remote::fetch(&state.runner, &repo.info.work_tree, &args).await;
    // A failed fetch may still have updated some refs.
    emit_changed(&app, &repo_id, &[Change::Refs]);
    Ok(res?)
}

/// Pulls (fetch + integrate) into the current branch.
#[tauri::command]
pub async fn pull(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    args: PullArgs,
) -> Result<PullResult, AppError> {
    if let Some(r) = &args.remote {
        check_remote(r)?;
    }
    check_branch(args.branch.as_deref())?;
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let res = remote::pull(&state.runner, &repo.info.work_tree, &args).await;
    // The fetch half may have run even when the integration failed.
    emit_changed(&app, &repo_id, &PULL_CHANGES);
    Ok(res?)
}

/// Pushes to a remote; a refused update fails with `git.rejected`.
#[tauri::command]
pub async fn push(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    args: PushArgs,
) -> Result<PushResult, AppError> {
    check_remote(&args.remote)?;
    check_branch(args.branch.as_deref())?;
    check_branch(args.remote_branch.as_deref())?;
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let res = remote::push(&state.runner, &repo.info.work_tree, &args).await;
    // A partly rejected push still moved the accepted refs.
    emit_changed(&app, &repo_id, &[Change::Refs]);
    Ok(res?)
}

/// The pull mode implied by the repository's `pull.rebase` / `pull.ff` configuration.
#[tauri::command]
pub async fn default_pull_mode(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<PullMode, AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    Ok(remote::default_pull_mode(&state.runner, &repo.info.work_tree).await?)
}
