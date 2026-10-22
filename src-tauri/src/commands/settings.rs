//! Application settings commands.

use tauri::State;

use crate::AppError;
use crate::settings::Settings;
use crate::state::AppState;

/// The current settings.
#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings, AppError> {
    Ok(state.settings())
}

/// Validates, persists and applies new settings; returns the normalised copy. A changed git path
/// takes effect after a restart.
#[tauri::command]
pub async fn set_settings(
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, AppError> {
    state.update_settings(settings)
}
