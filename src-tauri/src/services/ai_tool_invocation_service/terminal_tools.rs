use super::*;

pub(super) fn execute_terminal_list(terminals: &TerminalManager) -> ToolExecutionResult {
    match terminals.list_sessions() {
        Ok(sessions) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_terminal_sessions_for_ai(&sessions)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_terminal_sessions_for_ai(sessions: &[TerminalSessionSummary]) -> String {
    if sessions.is_empty() {
        return "当前没有运行中的本地终端会话。".to_owned();
    }

    let samples = sessions
        .iter()
        .take(5)
        .map(|session| {
            format!(
                "{}（{}，{}x{}，pid={}）",
                truncate_string(&session.id),
                truncate_string(&session.shell),
                session.cols,
                session.rows,
                session
                    .pid
                    .map(|pid| pid.to_string())
                    .unwrap_or_else(|| "-".to_owned())
            )
        })
        .collect::<Vec<_>>()
        .join("；");
    format!(
        "当前共有 {} 个本地终端会话。示例：{}。",
        sessions.len(),
        samples
    )
}

pub(super) fn execute_terminal_close(
    terminals: &TerminalManager,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let session_id = match required_string_arg(arguments, "sessionId") {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };

    match terminals.close(&session_id) {
        Ok(()) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "终端会话已关闭：{}。",
                truncate_string(&session_id)
            )),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_log_start(
    terminals: &TerminalManager,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let session_id = match required_string_arg(arguments, "sessionId") {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };

    match terminals.start_log(&session_id, &paths.logs) {
        Ok(state) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_terminal_log_state_for_ai(&session_id, &state)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_log_stop(
    terminals: &TerminalManager,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let session_id = match required_string_arg(arguments, "sessionId") {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };

    match terminals.stop_log(&session_id) {
        Ok(state) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_terminal_log_state_for_ai(&session_id, &state)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_log_state(
    terminals: &TerminalManager,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let session_id = match required_string_arg(arguments, "sessionId") {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };

    match terminals.log_state(&session_id) {
        Ok(state) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_terminal_log_state_for_ai(&session_id, &state)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_terminal_log_state_for_ai(
    session_id: &str,
    state: &TerminalSessionLogState,
) -> String {
    let path = state.path.as_deref().unwrap_or("-");
    let status = if state.active {
        "记录中"
    } else {
        "未记录"
    };
    format!(
        "终端日志状态：{}，session={}，已写入 {}，路径：{}。",
        status,
        truncate_string(session_id),
        byte_size_summary(state.bytes_written),
        path
    )
}

pub(super) fn execute_terminal_resize(
    terminals: &TerminalManager,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let Some(session_id) = arguments.get("sessionId").and_then(Value::as_str) else {
        return failure("sessionId 必须是字符串。");
    };
    let Some(cols) = number_to_u16(arguments.get("cols")) else {
        return failure("cols 必须是 1 到 65535 的数字。");
    };
    let Some(rows) = number_to_u16(arguments.get("rows")) else {
        return failure("rows 必须是 1 到 65535 的数字。");
    };

    match terminals.resize(session_id, TerminalResizeRequest { cols, rows }) {
        Ok(()) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!("终端尺寸已调整为 {cols}x{rows}。")),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_write(
    terminals: &TerminalManager,
    command_history: &CommandHistoryService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let Some(session_id) = arguments.get("sessionId").and_then(Value::as_str) else {
        return failure("sessionId 必须是字符串。");
    };
    let Some(data) = arguments.get("data").and_then(Value::as_str) else {
        return failure("data 必须是字符串。");
    };
    if data.is_empty() {
        return failure("data 不能为空。");
    }

    match terminals.write(session_id, data) {
        Ok(()) => {
            record_terminal_write_history(command_history, storage, session_id, data);
            ToolExecutionResult {
                status: AiToolInvocationStatus::Succeeded,
                result_summary: Some(format!("已向终端写入 {} 字节。", data.len())),
                error: None,
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn record_terminal_write_history(
    command_history: &CommandHistoryService,
    storage: &SqliteStore,
    session_id: &str,
    data: &str,
) {
    for command in commands_from_terminal_write_data(data) {
        let _ = command_history.record_command(
            storage,
            CommandHistoryRecordRequest {
                command,
                source: CommandHistorySource::Ai,
                target: CommandHistoryTarget::Local,
                record: None,
                session_id: Some(session_id.to_owned()),
                pane_id: None,
                tab_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: None,
            },
        );
    }
}

pub(super) fn commands_from_terminal_write_data(data: &str) -> Vec<String> {
    data.replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}
