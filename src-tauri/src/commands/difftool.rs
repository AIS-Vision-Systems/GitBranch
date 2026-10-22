//! Open a file diff in the external diff tool from the settings.

use git_core::ops::difftool::{self, DifftoolError};
use tauri::State;

use super::{invalid_arg, not_open, valid_rel_path};
use crate::AppError;
use crate::state::AppState;

impl From<DifftoolError> for AppError {
    fn from(err: DifftoolError) -> Self {
        match err {
            DifftoolError::Git(g) => g.into(),
            DifftoolError::NoTool => no_tool(),
            e @ DifftoolError::InvalidRevision(_) => AppError::new("arg.invalid", e.to_string()),
        }
    }
}

fn no_tool() -> AppError {
    AppError::new("difftool.not_configured", "No external diff tool is configured in Settings")
}

/// Opens `path` in the configured diff tool: index vs `HEAD` when `staged`, else against `rev`
/// when given, else work tree vs index.
#[tauri::command]
pub async fn open_difftool(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
    staged: bool,
    rev: Option<String>,
) -> Result<(), AppError> {
    if !valid_rel_path(&path) {
        return Err(invalid_arg("path"));
    }
    let tool = state.settings().difftool.ok_or_else(no_tool)?;
    let repo = state.get(&repo_id).ok_or_else(not_open)?;
    difftool::open_difftool(
        &state.runner,
        &repo.info.work_tree,
        &path,
        staged,
        rev.as_deref(),
        &tool,
    )
    .await?;
    Ok(())
}
