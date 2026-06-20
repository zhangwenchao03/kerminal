//! 服务器信息 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::server_info::{ServerInfoRequest, ServerInfoSnapshot},
    state::AppState,
};
use tauri::State;

/// 获取当前 SSH 主机或容器目标的系统信息快照。
#[tauri::command]
pub async fn server_info_snapshot(
    state: State<'_, AppState>,
    request: ServerInfoRequest,
) -> Result<ServerInfoSnapshot, String> {
    state
        .server_info()
        .snapshot_with_credentials(
            state.storage(),
            state.credentials(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
        .await
        .map_err(|error| error.to_string())
}
