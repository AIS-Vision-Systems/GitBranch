//! GitHub sign-in (OAuth Device Flow) and account commands. No token ever leaves this module;
//! the policy lives in `github-api` (`auth::complete_login`, `user::resolve_account`).

use std::sync::{Mutex, MutexGuard, PoisonError};

use github_api::auth::{DeviceCode, complete_login, request_device_code, scopes};
use github_api::token::{GITHUB_HOST, KeyringStore, TokenStore};
use github_api::user::{Account, resolve_account};
use github_api::{Error, GitHub, ReqwestTransport};
use tauri::State;
use tauri::async_runtime::{JoinHandle, spawn, spawn_blocking};
use tokio_util::sync::CancellationToken;

use crate::AppError;

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
    pending: Mutex<Pending>,
}

impl Default for GithubState {
    fn default() -> Self {
        Self {
            client: GitHub::new(ReqwestTransport::default()),
            store: KeyringStore,
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
    let store = state.store;
    spawn_blocking(move || store.delete(GITHUB_HOST))
        .await
        .map_err(|e| AppError::new("github.keyring", format!("background task failed: {e}")))?
        .map_err(|e| AppError::from(Error::from(e)))
}
