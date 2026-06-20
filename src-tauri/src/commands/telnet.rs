//! Telnet 远程终端 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::terminal::{TelnetTerminalCreateRequest, TerminalOutputEvent, TerminalSessionSummary},
    state::AppState,
};
use tauri::{ipc::Channel, State};

/// 创建 Telnet 远程终端会话。
#[tauri::command]
pub fn telnet_create_session(
    state: State<'_, AppState>,
    output: Channel<TerminalOutputEvent>,
    request: TelnetTerminalCreateRequest,
) -> Result<TerminalSessionSummary, String> {
    state
        .telnet_terminals()
        .create_session(state.storage(), state.terminals(), request, move |event| {
            output.send(event).is_ok()
        })
        .map_err(|error| error.to_string())
}
