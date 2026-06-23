//! SSH 非交互命令 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::ssh_command::{SshCommandOutput, SshCommandRequest},
    state::AppState,
};
use tauri::State;

/// 在已保存 SSH 主机上执行受控非交互命令。
#[tauri::command]
pub async fn ssh_command_execute(
    state: State<'_, AppState>,
    request: SshCommandRequest,
) -> Result<SshCommandOutput, String> {
    state
        .ssh_commands()
        .execute_native(state.storage(), state.paths(), request)
        .await
        .map_err(|error| error.to_string())
}
