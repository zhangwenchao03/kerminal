//! Serial 串口终端 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::terminal::{
        host_terminal_target_ref, SerialTerminalCreateRequest, TerminalOutputEvent,
        TerminalSessionSummary,
    },
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
    let target_ref = host_terminal_target_ref("serial", &request.host_id);
    state
        .serial_terminals()
        .create_session(
            state.remote_hosts(),
            state.terminals(),
            request,
            move |event| output.send(event).is_ok(),
        )
        .and_then(|summary| state.terminals().set_target_ref(&summary.id, target_ref))
        .map_err(|error| error.to_string())
}
