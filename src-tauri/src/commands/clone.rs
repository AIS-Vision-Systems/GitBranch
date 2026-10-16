//! `clone` command: clones a repository into a new directory with progress and cancellation.

use std::path::Path;

use git_core::ops::clone::{self, CloneArgs, dest_is_free};
use git_core::ops::remote::valid_branch_arg;
use git_core::refname::has_embedded_password;
use serde::Serialize;
use tauri::State;

use super::invalid_arg;
use super::remote::{check_op_id, op_ctx};
use crate::AppError;
use crate::state::AppState;

/// Result of a successful clone; the UI opens `path` with `open_repo`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneResult {
    /// Work-tree path of the new clone.
    pub path: String,
}

/// Clones `args.url` into `args.dest`; a failed or cancelled clone removes what it created.
#[tauri::command]
pub async fn clone(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    args: CloneArgs,
    op_id: String,
) -> Result<CloneResult, AppError> {
    check_op_id(&op_id)?;
    if args.url.is_empty() || args.url.starts_with('-') || args.url.chars().any(char::is_control) {
        return Err(invalid_arg("clone url"));
    }
    if has_embedded_password(&args.url) {
        return Err(invalid_arg(
            "clone url (embedded credentials are not allowed; the token lives in the keyring)",
        ));
    }
    if args.branch.as_deref().is_some_and(|b| !valid_branch_arg(b)) {
        return Err(invalid_arg("branch name"));
    }
    let dest = Path::new(&args.dest);
    if !dest.is_absolute() {
        return Err(invalid_arg("destination"));
    }
    if !dest.parent().is_some_and(Path::is_dir) {
        return Err(AppError::new(
            "app.dest_parent_missing",
            "Destination parent folder does not exist",
        ));
    }
    if !dest_is_free(dest) {
        return Err(AppError::new(
            "app.dest_exists",
            "Destination already exists and is not empty",
        ));
    }
    let (ctx, _guard) = op_ctx(&app, &state, &op_id, "")?;
    let res = clone::clone(&state.runner, &args, &ctx).await;
    let path = res?;
    Ok(CloneResult { path: path.to_string_lossy().into_owned() })
}
