//! "Fix SSH" dialog: diagnose and repair SSH authentication. Thin wrappers over `git_core::ops::ssh`.

use git_core::ops::ssh::{self, SshError, SshReport};
use tauri::State;
use zeroize::Zeroizing;

use super::{invalid_arg, not_open};
use crate::AppError;
use crate::state::AppState;

impl From<SshError> for AppError {
    fn from(err: SshError) -> Self {
        match err {
            SshError::Git(g) => g.into(),
            e => AppError::new(e.code(), e.to_string()),
        }
    }
}

/// Diagnoses keys, agent and (on Windows) the OpenSSH service; `repo_id` selects repo-level config.
#[tauri::command]
pub async fn ssh_report(
    state: State<'_, AppState>,
    repo_id: Option<String>,
) -> Result<SshReport, AppError> {
    let repo = match repo_id {
        Some(id) => Some(state.get(&id).ok_or_else(not_open)?),
        None => None,
    };
    let path = repo.as_ref().map(|r| r.info.work_tree.as_path());
    Ok(ssh::ssh_report(&state.runner, path).await?)
}

/// Windows: enables and starts the `ssh-agent` service (UAC prompt).
#[tauri::command]
pub async fn ssh_enable_windows_agent() -> Result<(), AppError> {
    Ok(ssh::enable_windows_agent().await?)
}

/// Sets the global `core.sshCommand` to the Windows OpenSSH client.
#[tauri::command]
pub async fn ssh_use_windows_openssh(state: State<'_, AppState>) -> Result<(), AppError> {
    Ok(ssh::use_windows_openssh(&state.runner).await?)
}

/// Loads a key into the agent. The passphrase reaches `ssh-add` only through the app exe acting
/// as `SSH_ASKPASS`; it is never logged, and the copy held here is wiped afterwards (best effort: the OS and the child
/// process environment hold their own copies for the life of the `ssh-add` call).
#[tauri::command]
pub async fn ssh_add_key(path: String, passphrase: Option<String>) -> Result<(), AppError> {
    let passphrase = passphrase.map(Zeroizing::new);
    if path.is_empty() || path.starts_with('-') {
        return Err(invalid_arg("key path"));
    }
    let exe = std::env::current_exe()
        .map_err(|e| AppError::new("ssh.failed", format!("cannot resolve own exe: {e}")))?;
    ssh::add_key(std::path::Path::new(&path), passphrase.as_ref().map(|p| p.as_str()), &exe)
        .await?;
    Ok(())
}

/// `git ls-remote <remote> HEAD` in the repository, through the same ssh git really uses.
#[tauri::command]
pub async fn ssh_test_remote(
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
) -> Result<(), AppError> {
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    ssh::test_remote(&state.runner, &repo.info.work_tree, &remote).await?;
    Ok(())
}
