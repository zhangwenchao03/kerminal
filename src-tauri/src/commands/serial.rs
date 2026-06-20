//! Serial 串口终端 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::terminal::{SerialTerminalCreateRequest, TerminalOutputEvent, TerminalSessionSummary},
    state::AppState,
};
use tauri::{ipc::Channel, State};

/// 创建 Serial 串口终端会话。
#[tauri::command]
pub fn serial_create_session(
    state: State<'_, AppState>,
    output: Channel<TerminalOutputEvent>,
    request: SerialTerminalCreateRequest,
) -> Result<TerminalSessionSummary, String> {
    state
        .serial_terminals()
        .create_session(state.storage(), state.terminals(), request, move |event| {
            output.send(event).is_ok()
        })
        .map_err(|error| error.to_string())
}
