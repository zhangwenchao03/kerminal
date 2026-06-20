//! SSH 远程终端 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::terminal::{SshTerminalCreateRequest, TerminalOutputEvent, TerminalSessionSummary},
    state::AppState,
};
use tauri::{ipc::Channel, State};

/// 创建 SSH 远程终端会话。
#[tauri::command]
pub fn ssh_create_session(
    state: State<'_, AppState>,
    output: Channel<TerminalOutputEvent>,
    request: SshTerminalCreateRequest,
) -> Result<TerminalSessionSummary, String> {
    state
        .ssh_terminals()
        .create_session(
            state.storage(),
            state.credentials(),
            state.paths(),
            state.terminals(),
            request,
            move |event| output.send(event).is_ok(),
        )
        .map_err(|error| error.to_string())
}
