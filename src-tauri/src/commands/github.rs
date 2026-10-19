//! GitHub sign-in (OAuth Device Flow) and account commands. No token ever leaves this module;
//! the policy lives in `github-api` (`auth::complete_login`, `user::resolve_account`).

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use git_core::ops::pull_request::{CheckoutPr, checkout_pr};
use git_core::ops::remote::list_remotes;
use git_core::refname::is_valid_branch_name;
use github_api::auth::{DeviceCode, complete_login, request_device_code, scopes};
use github_api::checks::ChecksCache;
use github_api::pulls::{
    ChecksSummary, NewPull, PullDetail, PullState, PullSummary, create_pull, get_pull, list_pulls,
};
use github_api::repos::{Repo, RepoSlug, get_repo, list_repos, parse_github_remote};
use github_api::token::{GITHUB_HOST, KeyringStore, TokenStore};
use github_api::user::{Account, resolve_account};
use github_api::{Error, GitHub, ReqwestTransport};
use serde::Serialize;
use tauri::State;
use tauri::async_runtime::{JoinHandle, spawn, spawn_blocking};
use tokio_util::sync::CancellationToken;

use super::remote::{check_op_id, check_remote, op_ctx};
use super::{emit_changed, invalid_arg, not_open, valid_oid};
use crate::AppError;
use crate::state::AppState;
use crate::watcher::Change;

/// The sign-in in flight. The token stays here until it is cancelled or replaced, even after
/// `github_login_wait` took the task handle.
#[derive(Default)]
struct Pending {
    cancel: Option<CancellationToken>,
    task: Option<JoinHandle<Result<Account, Error>>>,
}

/// Shared GitHub client, credential store and the in-flight login.
pub struct GithubState {
    /// REST client.
    pub client: GitHub<ReqwestTransport>,
    /// OS keyring.
    pub store: KeyringStore,
    /// Cached check summaries per commit.
    pub checks: ChecksCache,
    pending: Mutex<Pending>,
}

impl Default for GithubState {
    fn default() -> Self {
        Self {
            client: GitHub::new(ReqwestTransport::default()),
            store: KeyringStore,
            checks: ChecksCache::new(Duration::from_secs(120), Duration::from_secs(20)),
            pending: Mutex::new(Pending::default()),
        }
    }
}

impl GithubState {
    fn pending(&self) -> MutexGuard<'_, Pending> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Cancels the live login, if any, and forgets it.
    fn cancel_live(&self) {
        let mut p = self.pending();
        if let Some(c) = p.cancel.take() {
            c.cancel();
        }
        p.task = None;
    }
}

/// The signed-in account, `None` when signed out. Works offline from the stored login.
#[tauri::command]
pub async fn github_account(state: State<'_, GithubState>) -> Result<Option<Account>, AppError> {
    // Keyring access blocks, so the whole resolution runs on the blocking pool.
    let gh = GitHub::new(ReqwestTransport::default());
    let store = state.store;
    spawn_blocking(move || {
        tauri::async_runtime::block_on(async move { resolve_account(&gh, &store).await })
    })
    .await
    .map_err(|e| AppError::new("github.network", format!("background task failed: {e}")))?
    .map_err(AppError::from)
}

/// Starts a device-flow login: returns the code to show, polls in the background.
#[tauri::command]
pub async fn github_login_start(
    state: State<'_, GithubState>,
    workflow: bool,
) -> Result<DeviceCode, AppError> {
    state.cancel_live();
    let code = request_device_code(&state.client, &scopes(workflow)).await?;
    let cancel = CancellationToken::new();
    let store = state.store;
    let (task_code, task_cancel) = (code.clone(), cancel.clone());
    let task = spawn(async move {
        let gh = GitHub::new(ReqwestTransport::default());
        complete_login(&gh, &store, &task_code, &task_cancel).await
    });
    let mut p = state.pending();
    // A concurrent start may have registered meanwhile: always cancel what was live.
    if let Some(old) = p.cancel.replace(cancel) {
        old.cancel();
    }
    p.task = Some(task);
    Ok(code)
}

/// Waits for the login started by [`github_login_start`] to finish.
#[tauri::command]
pub async fn github_login_wait(state: State<'_, GithubState>) -> Result<Account, AppError> {
    let task = state.pending().task.take();
    let Some(task) = task else {
        return Err(AppError::new("github.no_login", "No sign-in in progress"));
    };
    match task.await {
        Ok(r) => r.map_err(AppError::from),
        Err(e) => Err(AppError::new("github.cancelled", format!("sign-in aborted: {e}"))),
    }
}

/// Cancels the login in progress, if any.
#[tauri::command]
pub async fn github_login_cancel(state: State<'_, GithubState>) -> Result<(), AppError> {
    state.cancel_live();
    Ok(())
}

/// Removes the stored token.
#[tauri::command]
pub async fn github_logout(state: State<'_, GithubState>) -> Result<(), AppError> {
    state.checks.clear();
    let store = state.store;
    spawn_blocking(move || store.delete(GITHUB_HOST))
        .await
        .map_err(|e| AppError::new("github.keyring", format!("background task failed: {e}")))?
        .map_err(|e| AppError::from(Error::from(e)))
}

/// Check summaries for up to 50 commits, cached (120 s, 20 s while pending); `force` bypasses it.
#[tauri::command]
pub async fn github_checks(
    state: State<'_, AppState>,
    gh: State<'_, GithubState>,
    repo_id: String,
    shas: Vec<String>,
    force: bool,
) -> Result<HashMap<String, ChecksSummary>, AppError> {
    if shas.len() > 50 || !shas.iter().all(|s| s.len() >= 7 && valid_oid(s)) {
        return Err(invalid_arg("shas (at most 50 hex ids of 7 to 64 characters)"));
    }
    let slug = require_slug(&state, &repo_id).await?;
    let token = stored_token(&gh).await?;
    gh.checks.get_many(&gh.client, &token, &slug, &shas, force).await.map_err(AppError::from)
}

/// The stored token, read on the blocking pool; `Unauthorized` when signed out.
async fn stored_token(state: &GithubState) -> Result<String, AppError> {
    let store = state.store;
    let secret = spawn_blocking(move || store.get(GITHUB_HOST))
        .await
        .map_err(|e| AppError::new("github.keyring", format!("background task failed: {e}")))?
        .map_err(|e| AppError::from(Error::from(e)))?;
    secret.map(|s| s.token).ok_or_else(|| Error::Unauthorized.into())
}

/// The signed-in user's repositories (own, collaborator, organization member).
#[tauri::command]
pub async fn github_repos(state: State<'_, GithubState>) -> Result<Vec<Repo>, AppError> {
    let token = stored_token(&state).await?;
    list_repos(&state.client, &token).await.map_err(AppError::from)
}

/// The GitHub repository a local repository maps to, with the remote it came from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSlugInfo {
    /// Remote name (`origin` when it points at github.com).
    pub remote: String,
    /// Owner login.
    pub owner: String,
    /// Repository name.
    pub name: String,
}

/// `origin` if it is a github.com remote, else the first github.com remote (D-028).
async fn resolve_slug(
    state: &AppState,
    repo_id: &str,
) -> Result<Option<(String, RepoSlug)>, AppError> {
    let repo = state.get(repo_id).ok_or_else(not_open)?;
    let remotes = list_remotes(&state.runner, &repo.info.work_tree).await?;
    let parsed = |r: &git_core::ops::remote::Remote| {
        parse_github_remote(&r.fetch_url).map(|s| (r.name.clone(), s))
    };
    let origin = remotes.iter().find(|r| r.name == "origin").and_then(parsed);
    Ok(origin.or_else(|| remotes.iter().find_map(parsed)))
}

async fn require_slug(state: &AppState, repo_id: &str) -> Result<RepoSlug, AppError> {
    resolve_slug(state, repo_id)
        .await?
        .map(|(_, s)| s)
        .ok_or_else(|| AppError::new("github.not_github_repo", "No github.com remote"))
}

/// The github.com slug of the repository, `None` when no remote points at github.com.
#[tauri::command]
pub async fn github_repo_slug(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Option<RepoSlugInfo>, AppError> {
    Ok(resolve_slug(&state, &repo_id).await?.map(|(remote, s)| RepoSlugInfo {
        remote,
        owner: s.owner,
        name: s.name,
    }))
}

/// Pull requests of the repository's GitHub project.
#[tauri::command]
pub async fn github_pulls(
    state: State<'_, AppState>,
    gh: State<'_, GithubState>,
    repo_id: String,
    pull_state: PullState,
) -> Result<Vec<PullSummary>, AppError> {
    let slug = require_slug(&state, &repo_id).await?;
    let token = stored_token(&gh).await?;
    list_pulls(&gh.client, &token, &slug, pull_state).await.map_err(AppError::from)
}

/// One pull request with its reviews and checks.
#[tauri::command]
pub async fn github_pull(
    state: State<'_, AppState>,
    gh: State<'_, GithubState>,
    repo_id: String,
    number: u64,
) -> Result<PullDetail, AppError> {
    let slug = require_slug(&state, &repo_id).await?;
    let token = stored_token(&gh).await?;
    get_pull(&gh.client, &token, &slug, number).await.map_err(AppError::from)
}

/// Fetches a pull request and checks it out as a local branch; returns the branch name.
#[tauri::command]
pub async fn github_checkout_pull(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    args: CheckoutPr,
    op_id: String,
) -> Result<String, AppError> {
    check_op_id(&op_id)?;
    check_remote(&args.remote)?;
    if !is_valid_branch_name(&args.head_ref) {
        return Err(invalid_arg("branch name"));
    }
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    let (ctx, _guard) = op_ctx(&app, &state, &op_id, &repo_id)?;
    let res = checkout_pr(&state.runner, &repo.info.work_tree, &args, &ctx).await;
    if res.is_ok() {
        emit_changed(
            &app,
            &repo_id,
            &[Change::Refs, Change::Head, Change::Index, Change::WorkingTree],
        );
    } else {
        // The fetch half may have updated refs.
        emit_changed(&app, &repo_id, &[Change::Refs]);
    }
    Ok(res?)
}

/// The GitHub repository itself (default branch, fork flag).
#[tauri::command]
pub async fn github_repo_info(
    state: State<'_, AppState>,
    gh: State<'_, GithubState>,
    repo_id: String,
) -> Result<Repo, AppError> {
    let slug = require_slug(&state, &repo_id).await?;
    let token = stored_token(&gh).await?;
    get_repo(&gh.client, &token, &slug).await.map_err(AppError::from)
}

/// Opens a pull request from `args.head` into `args.base`.
#[tauri::command]
pub async fn github_create_pull(
    state: State<'_, AppState>,
    gh: State<'_, GithubState>,
    repo_id: String,
    args: NewPull,
) -> Result<PullSummary, AppError> {
    let ok = |s: &str| {
        !s.trim().is_empty()
            && !s.starts_with('-')
            && s.len() <= 255
            && !s.chars().any(char::is_control)
    };
    if !ok(&args.head) {
        return Err(invalid_arg("head branch"));
    }
    if !ok(&args.base) {
        return Err(invalid_arg("base branch"));
    }
    if args.title.trim().is_empty() {
        return Err(invalid_arg("title"));
    }
    let slug = require_slug(&state, &repo_id).await?;
    let token = stored_token(&gh).await?;
    create_pull(&gh.client, &token, &slug, &args).await.map_err(AppError::from)
}
