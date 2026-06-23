use super::*;

pub(super) fn execute_terminal_list(terminals: &TerminalManager) -> ToolExecutionResult {
    match terminals.list_sessions() {
        Ok(sessions) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_terminal_sessions_for_ai(&sessions)),
            error: None,
            structured_result: Some(json!({
                "sessionCount": sessions.len(),
                "sessions": sessions,
            })),
            entities: sessions
                .iter()
                .map(|session| {
                    json!({
                        "type": "terminalSession",
                        "id": session.id,
                        "shell": session.shell,
                        "cols": session.cols,
                        "rows": session.rows,
                        "pid": session.pid,
                    })
                })
                .collect(),
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_resolve_current(
    terminals: &TerminalManager,
    bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let pane_id = match optional_string_arg(arguments, "paneId") {
        Ok(value) => normalize_optional_tool_arg(value),
        Err(error) => return failure(error.to_string()),
    };
    let session_id = match optional_string_arg(arguments, "sessionId") {
        Ok(value) => normalize_optional_tool_arg(value),
        Err(error) => return failure(error.to_string()),
    };
    let tab_id = match optional_string_arg(arguments, "tabId") {
        Ok(value) => normalize_optional_tool_arg(value),
        Err(error) => return failure(error.to_string()),
    };
    let target_ref = match optional_string_arg(arguments, "targetRef") {
        Ok(value) => normalize_optional_tool_arg(value),
        Err(error) => return failure(error.to_string()),
    };
    let target_kind = match optional_string_arg(arguments, "targetKind") {
        Ok(value) => normalize_optional_tool_arg(value),
        Err(error) => return failure(error.to_string()),
    };
    let remote_host_id = match optional_string_arg(arguments, "remoteHostId") {
        Ok(value) => normalize_optional_tool_arg(value),
        Err(error) => return failure(error.to_string()),
    };

    let Some(pane_id) = pane_id else {
        return terminal_resolve_missing_target_result();
    };

    let binding = match bindings.active_binding_for_pane(&pane_id) {
        Ok(Some(binding)) => binding,
        Ok(None) => return terminal_resolve_not_found_result("未找到指定 pane 的活动终端绑定。"),
        Err(error) => return failure(error.to_string()),
    };

    if let Some(session_id) = session_id.as_deref() {
        if binding.session_id != session_id {
            return terminal_resolve_mismatch_result(
                "paneId 与 sessionId 不匹配。",
                json!({
                    "paneId": pane_id,
                    "requestedSessionId": session_id,
                    "actualSessionId": binding.session_id,
                }),
            );
        }
    }
    if let Some(error) = terminal_binding_metadata_mismatch(
        &binding,
        tab_id.as_deref(),
        target_ref.as_deref(),
        target_kind.as_deref(),
        remote_host_id.as_deref(),
    ) {
        return error;
    }

    let session = match terminals.session_summary(&binding.session_id) {
        Ok(session) => session,
        Err(error) => {
            return ToolExecutionResult {
                status: AiToolInvocationStatus::Failed,
                error: Some(error.to_string()),
                structured_result: Some(json!({
                    "paneId": pane_id,
                    "sessionId": binding.session_id,
                    "binding": binding,
                })),
                error_kind: Some("staleSession".to_owned()),
                recoverable: true,
                next_hints: vec![
                    "当前 pane 的绑定已过期；刷新终端 pane 后重试，或调用 terminal.list 查看仍在运行的 session。"
                        .to_owned(),
                ],
                ..ToolExecutionResult::default()
            };
        }
    };
    if session.status != TerminalSessionStatus::Running {
        return ToolExecutionResult {
            status: AiToolInvocationStatus::Failed,
            error: Some("终端 session 已退出，不能作为当前可写目标。".to_owned()),
            structured_result: Some(json!({
                "sessionId": session.id,
                "status": session.status,
            })),
            error_kind: Some("targetNotReady".to_owned()),
            recoverable: true,
            next_hints: vec![
                "调用 terminal.list 选择运行中的 session，或创建新的 terminal.create。".to_owned(),
            ],
            ..ToolExecutionResult::default()
        };
    }

    terminal_resolve_current_result(&binding, &session)
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

fn normalize_optional_tool_arg(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn terminal_resolve_current_result(
    binding: &crate::services::terminal_session_binding_service::TerminalSessionBindingSnapshot,
    session: &TerminalSessionSummary,
) -> ToolExecutionResult {
    let metadata = binding.metadata.as_ref();
    ToolExecutionResult {
        status: AiToolInvocationStatus::Succeeded,
        result_summary: Some(
            format!(
                "当前终端已解析：pane={}，session={}，shell={}，{}x{}。",
                truncate_string(&binding.pane_id),
                truncate_string(&session.id),
                truncate_string(&session.shell),
                session.cols,
                session.rows
            )
        ),
        error: None,
        structured_result: Some(json!({
            "source": "terminalSessionBinding",
            "resolved": true,
            "paneId": binding.pane_id,
            "sessionId": session.id,
            "generation": binding.generation,
            "bindingStatus": binding.status,
            "lastSnapshotStatus": binding.last_snapshot_status,
            "tabId": metadata.and_then(|metadata| metadata.tab_id.as_deref()),
            "targetRef": metadata.and_then(|metadata| metadata.target_ref.as_deref()),
            "targetKind": metadata.and_then(|metadata| metadata.target_kind.as_deref()),
            "remoteHostId": metadata.and_then(|metadata| metadata.remote_host_id.as_deref()),
            "profileId": metadata.and_then(|metadata| metadata.profile_id.as_deref()),
            "cwd": metadata
                .and_then(|metadata| metadata.cwd.as_deref())
                .or(session.cwd.as_deref()),
            "shell": metadata
                .and_then(|metadata| metadata.shell.as_deref())
                .unwrap_or(session.shell.as_str()),
            "session": session,
            "binding": binding,
        })),
        entities: terminal_resolve_entities(binding, session),
        next_hints: vec![
            "后续可直接把 sessionId 传给 terminal.write、terminal.resize、terminal.log.start 或 terminal.log.state。"
                .to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

fn terminal_resolve_missing_target_result() -> ToolExecutionResult {
    ToolExecutionResult {
        status: AiToolInvocationStatus::Failed,
        error: Some("terminal.resolve_current 需要 paneId；后端不能凭空知道当前聚焦 pane。".to_owned()),
        error_kind: Some("missingTarget".to_owned()),
        recoverable: true,
        next_hints: vec![
            "使用当前会话/slot 的 focused paneId 调用 terminal.resolve_current；terminal.list 只能用于诊断，不能代表当前焦点。"
                .to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

fn terminal_binding_metadata_mismatch(
    binding: &crate::services::terminal_session_binding_service::TerminalSessionBindingSnapshot,
    tab_id: Option<&str>,
    target_ref: Option<&str>,
    target_kind: Option<&str>,
    remote_host_id: Option<&str>,
) -> Option<ToolExecutionResult> {
    let metadata = binding.metadata.as_ref();
    let checks = [
        (
            "tabId",
            tab_id,
            metadata.and_then(|metadata| metadata.tab_id.as_deref()),
        ),
        (
            "targetRef",
            target_ref,
            metadata.and_then(|metadata| metadata.target_ref.as_deref()),
        ),
        (
            "targetKind",
            target_kind,
            metadata.and_then(|metadata| metadata.target_kind.as_deref()),
        ),
        (
            "remoteHostId",
            remote_host_id,
            metadata.and_then(|metadata| metadata.remote_host_id.as_deref()),
        ),
    ];

    checks
        .into_iter()
        .find_map(|(field, requested, actual)| match (requested, actual) {
            (Some(requested), Some(actual)) if requested != actual => {
                Some(terminal_resolve_mismatch_result(
                    &format!("{field} 与当前 pane 绑定不匹配。"),
                    json!({
                        "paneId": binding.pane_id,
                        "sessionId": binding.session_id,
                        "field": field,
                        "requested": requested,
                        "actual": actual,
                    }),
                ))
            }
            (Some(requested), None) => Some(terminal_resolve_mismatch_result(
                &format!("{field} 未记录在当前 pane 绑定中，不能确认目标一致。"),
                json!({
                    "paneId": binding.pane_id,
                    "sessionId": binding.session_id,
                    "field": field,
                    "requested": requested,
                    "actual": Value::Null,
                }),
            )),
            _ => None,
        })
}

fn terminal_resolve_mismatch_result(message: &str, data: Value) -> ToolExecutionResult {
    ToolExecutionResult {
        status: AiToolInvocationStatus::Failed,
        error: Some(message.to_owned()),
        structured_result: Some(data),
        error_kind: Some("paneSessionMismatch".to_owned()),
        recoverable: true,
        next_hints: vec![
            "刷新当前 pane/session 绑定后重试，或改用当前 focused paneId。".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

fn terminal_resolve_entities(
    binding: &crate::services::terminal_session_binding_service::TerminalSessionBindingSnapshot,
    session: &TerminalSessionSummary,
) -> Vec<Value> {
    let metadata = binding.metadata.as_ref();
    let mut entities = vec![
        json!({
            "type": "terminalPane",
            "id": binding.pane_id,
            "sessionId": session.id,
            "tabId": metadata.and_then(|metadata| metadata.tab_id.as_deref()),
            "targetKind": metadata.and_then(|metadata| metadata.target_kind.as_deref()),
            "targetRef": metadata.and_then(|metadata| metadata.target_ref.as_deref()),
            "generation": binding.generation,
        }),
        json!({
            "type": "terminalSession",
            "id": session.id,
            "paneId": binding.pane_id,
            "tabId": metadata.and_then(|metadata| metadata.tab_id.as_deref()),
            "targetKind": metadata.and_then(|metadata| metadata.target_kind.as_deref()),
            "targetRef": metadata.and_then(|metadata| metadata.target_ref.as_deref()),
            "remoteHostId": metadata.and_then(|metadata| metadata.remote_host_id.as_deref()),
            "shell": session.shell,
            "cwd": metadata
                .and_then(|metadata| metadata.cwd.as_deref())
                .or(session.cwd.as_deref()),
            "cols": session.cols,
            "rows": session.rows,
            "pid": session.pid,
            "status": session.status,
        }),
    ];
    if let Some(remote_host_id) = metadata.and_then(|metadata| metadata.remote_host_id.as_deref()) {
        entities.push(json!({
            "type": "remoteHost",
            "id": remote_host_id,
            "source": "terminalBinding",
        }));
    }
    entities
}

fn terminal_resolve_not_found_result(message: &str) -> ToolExecutionResult {
    ToolExecutionResult {
        status: AiToolInvocationStatus::Failed,
        error: Some(message.to_owned()),
        error_kind: Some("targetNotFound".to_owned()),
        recoverable: true,
        next_hints: vec![
            "确认当前 pane 已完成终端绑定，或调用 terminal.list 查看仍在运行的 session。"
                .to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
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
            ..ToolExecutionResult::default()
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
            ..ToolExecutionResult::default()
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
            ..ToolExecutionResult::default()
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
            ..ToolExecutionResult::default()
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
            ..ToolExecutionResult::default()
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
                ..ToolExecutionResult::default()
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
