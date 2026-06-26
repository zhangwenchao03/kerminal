//! 终端 Profile Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::profile::{
        ProfileCreateRequest, ProfileUpdateRequest, ShellCandidate, TerminalProfile,
    },
    state::AppState,
};
use tauri::State;

/// 列出本地终端 Profile。
#[tauri::command]
pub fn profile_list(state: State<'_, AppState>) -> Result<Vec<TerminalProfile>, String> {
    state
        .profiles()
        .list_profiles()
        .map_err(|error| error.to_string())
}

/// 探测当前主机可用 shell。
#[tauri::command]
pub fn profile_detect_shells(state: State<'_, AppState>) -> Result<Vec<ShellCandidate>, String> {
    Ok(state.profiles().detect_shells())
}

/// 创建本地终端 Profile。
#[tauri::command]
pub fn profile_create(
    state: State<'_, AppState>,
    request: ProfileCreateRequest,
) -> Result<TerminalProfile, String> {
    state
        .profiles()
        .create_profile(request)
        .map_err(|error| error.to_string())
}

/// 更新本地终端 Profile。
#[tauri::command]
pub fn profile_update(
    state: State<'_, AppState>,
    request: ProfileUpdateRequest,
) -> Result<TerminalProfile, String> {
    state
        .profiles()
        .update_profile(request)
        .map_err(|error| error.to_string())
}

/// 删除本地终端 Profile。
#[tauri::command]
pub fn profile_delete(state: State<'_, AppState>, profile_id: String) -> Result<bool, String> {
    state
        .profiles()
        .delete_profile(&profile_id)
        .map_err(|error| error.to_string())
}
