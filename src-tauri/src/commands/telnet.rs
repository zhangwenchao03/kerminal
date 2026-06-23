//! Telnet 远程终端 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::terminal::{
        host_terminal_target_ref, TelnetTerminalCreateRequest, TerminalOutputEvent,
        TerminalSessionSummary,
    },
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
    let target_ref = host_terminal_target_ref("telnet", &request.host_id);
    state
        .telnet_terminals()
        .create_session(state.storage(), state.terminals(), request, move |event| {
            output.send(event).is_ok()
        })
        .and_then(|summary| state.terminals().set_target_ref(&summary.id, target_ref))
        .map_err(|error| error.to_string())
}
