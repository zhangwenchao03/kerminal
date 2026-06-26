//! 应用设置 Tauri Commands。
//!
//! @author kongweiguang

use crate::{models::settings::AppSettings, state::AppState};
use tauri::State;

/// 读取当前应用设置。
#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state
        .settings()
        .load_settings()
        .map_err(|error| error.to_string())
}

/// 更新当前应用设置。
#[tauri::command]
pub fn settings_update(
    state: State<'_, AppState>,
    request: AppSettings,
) -> Result<AppSettings, String> {
    state
        .settings()
        .update_settings(request)
        .map_err(|error| error.to_string())
}
