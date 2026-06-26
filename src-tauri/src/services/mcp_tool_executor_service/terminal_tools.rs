use super::*;

const DEFAULT_TERMINAL_SNAPSHOT_BYTES: usize = 24 * 1024;

pub(super) fn execute_terminal_list(terminals: &TerminalManager) -> ToolExecutionResult {
    match terminals.list_sessions() {
        Ok(sessions) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_terminal_sessions_for_agent(&sessions)),
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

pub(super) fn summarize_terminal_sessions_for_agent(sessions: &[TerminalSessionSummary]) -> String {
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
            status: McpToolExecutionStatus::Succeeded,
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
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_terminal_log_state_for_agent(&session_id, &state)),
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
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_terminal_log_state_for_agent(&session_id, &state)),
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
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_terminal_log_state_for_agent(&session_id, &state)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_terminal_log_state_for_agent(
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
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(format!("终端尺寸已调整为 {cols}x{rows}。")),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_write(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    command_history: &CommandHistoryService,
    storage: &CommandSqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let Some(data) = arguments.get("data").and_then(Value::as_str) else {
        return failure("data 必须是字符串。");
    };
    if data.is_empty() {
        return failure("data 不能为空。");
    }
    let session_id = match resolve_terminal_write_session_id(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };

    match terminals.write(&session_id, data) {
        Ok(()) => {
            record_terminal_write_history(command_history, storage, &session_id, data);
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(format!("已向终端写入 {} 字节。", data.len())),
                error: None,
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_snapshot(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let session_id = match resolve_terminal_snapshot_session_id(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        Ok(session_id) => session_id,
        Err(error) => return failure(error.to_string()),
    };
    let max_bytes = optional_usize_arg(arguments, "maxBytes")
        .ok()
        .flatten()
        .unwrap_or(DEFAULT_TERMINAL_SNAPSHOT_BYTES);
    match terminals.output_snapshot(&session_id, max_bytes) {
        Ok((summary, snapshot)) => {
            let (data, redacted) = redact_terminal_text(&snapshot.data);
            if let Ok(agent_session_id) = required_agent_session_id(arguments) {
                let _ = persist_agent_terminal_snapshot(
                    agent_sessions,
                    &agent_session_id,
                    &session_id,
                    &snapshot,
                    &data,
                    redacted,
                );
            }
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(format!(
                    "已读取终端 {} 最近 {} 字节输出{}。",
                    truncate_string(&session_id),
                    snapshot.captured_bytes,
                    if snapshot.truncated {
                        "（已截断）"
                    } else {
                        ""
                    }
                )),
                error: None,
                structured_result: Some(json!({
                    "session": summary,
                    "snapshot": {
                        "data": data,
                        "capturedBytes": snapshot.captured_bytes,
                        "maxBytes": snapshot.max_bytes,
                        "truncated": snapshot.truncated,
                        "redacted": redacted
                    }
                })),
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_terminal_resolve_agent_target(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    match resolve_agent_target_snapshot(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        Ok(binding) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(format!(
                "Agent session {} 当前目标终端为 {}，状态：{:?}。",
                truncate_string(&binding.agent_session_id),
                truncate_string(&binding.target_terminal_session_id),
                binding.status
            )),
            error: None,
            structured_result: Some(json!({ "targetBinding": binding })),
            entities: vec![json!({
                "type": "agentTargetBinding",
                "agentSessionId": binding.agent_session_id,
                "terminalSessionId": binding.target_terminal_session_id,
                "status": binding.status,
            })],
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_agent_current_session(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let agent_session_id = match required_agent_session_id(arguments) {
        Ok(agent_session_id) => agent_session_id,
        Err(error) => return failure(error.to_string()),
    };
    let live_ids = match live_terminal_session_ids(terminals) {
        Ok(live_ids) => live_ids,
        Err(error) => return failure(error.to_string()),
    };
    match hydrate_agent_target_binding(
        agent_sessions,
        terminal_session_bindings,
        &agent_session_id,
        live_ids.iter().map(String::as_str),
    ) {
        Ok(record) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(format!(
                "已读取 Agent session {}。",
                truncate_string(agent_session_id.as_str())
            )),
            error: None,
            structured_result: Some(json!({ "agentSession": record })),
            entities: vec![json!({
                "type": "agentSession",
                "id": agent_session_id.as_str(),
            })],
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_agent_target_context(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let agent_session_id = match required_agent_session_id(arguments) {
        Ok(agent_session_id) => agent_session_id,
        Err(error) => return failure(error.to_string()),
    };
    let (record, binding) = match resolve_agent_target_record_and_snapshot(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    ) {
        Ok(resolved) => resolved,
        Err(error) => {
            let record = agent_sessions.get_session(&agent_session_id).ok();
            return ToolExecutionResult {
                status: McpToolExecutionStatus::Failed,
                result_summary: None,
                error: Some(error.to_string()),
                structured_result: Some(json!({
                    "agentSession": record,
                    "targetBinding": null,
                    "live": false,
                    "stale": true,
                })),
                error_kind: Some("agentTargetUnavailable".to_owned()),
                recoverable: true,
                next_hints: vec![
                    "Open or rebind a target terminal in Kerminal before writing.".to_owned(),
                ],
                entities: Vec::new(),
            };
        }
    };
    let max_bytes = optional_usize_arg(arguments, "maxBytes")
        .ok()
        .flatten()
        .unwrap_or(DEFAULT_TERMINAL_SNAPSHOT_BYTES);
    let snapshot = if binding.live {
        match terminals.output_snapshot(&binding.target_terminal_session_id, max_bytes) {
            Ok((summary, snapshot)) => {
                let (data, redacted) = redact_terminal_text(&snapshot.data);
                let _ = persist_agent_terminal_snapshot(
                    agent_sessions,
                    &agent_session_id,
                    &binding.target_terminal_session_id,
                    &snapshot,
                    &data,
                    redacted,
                );
                Some(json!({
                    "session": summary,
                    "snapshot": {
                        "data": data,
                        "capturedBytes": snapshot.captured_bytes,
                        "maxBytes": snapshot.max_bytes,
                        "truncated": snapshot.truncated,
                        "redacted": redacted
                    }
                }))
            }
            Err(error) => return failure(error.to_string()),
        }
    } else {
        None
    };
    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Agent session {} 的目标终端状态：{:?}。",
            truncate_string(agent_session_id.as_str()),
            binding.status
        )),
        error: None,
        structured_result: Some(json!({
            "agentSession": record,
            "targetBinding": binding,
            "terminal": snapshot,
        })),
        ..ToolExecutionResult::default()
    }
}

fn persist_agent_terminal_snapshot(
    agent_sessions: &AgentSessionService,
    agent_session_id: &AgentSessionId,
    target_terminal_session_id: &str,
    snapshot: &TerminalOutputSnapshot,
    output: &str,
    redacted: bool,
) -> AppResult<()> {
    agent_sessions.write_terminal_snapshot_context(&AgentTerminalSnapshotContext {
        schema_version: AGENT_SESSION_SCHEMA_VERSION,
        agent_session_id: agent_session_id.clone(),
        target_terminal_session_id: Some(target_terminal_session_id.to_owned()),
        captured_bytes: output.len(),
        max_bytes: snapshot.max_bytes,
        truncated: snapshot.truncated,
        redacted,
        output: output.to_owned(),
        generated_at: current_unix_timestamp(),
    })
}

fn resolve_terminal_write_session_id(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<String> {
    let agent_session_id = optional_non_empty_string_arg(arguments, "agentSessionId")?;
    if let Some(session_id) = optional_non_empty_string_arg(arguments, "sessionId")? {
        if agent_session_id.is_some() {
            return Err(AppError::InvalidInput(
                "通过 agentSessionId 写入终端时不能同时提供 sessionId；请使用 bindingGeneration 解析当前 Agent 绑定目标。"
                    .to_owned(),
            ));
        }
        return Ok(session_id);
    }
    let agent_session_id = agent_session_id.ok_or_else(|| {
        AppError::InvalidInput("sessionId 或 agentSessionId 必须提供。".to_owned())
    })?;
    let expected_generation =
        optional_u64_arg(arguments, "bindingGeneration")?.ok_or_else(|| {
            AppError::InvalidInput(
                "通过 agentSessionId 写入终端时必须提供 bindingGeneration。".to_owned(),
            )
        })?;
    let agent_session_id = AgentSessionId::new(agent_session_id.clone())?;
    let live_ids = live_terminal_session_ids(terminals)?;
    hydrate_agent_target_binding(
        agent_sessions,
        terminal_session_bindings,
        &agent_session_id,
        live_ids.iter().map(String::as_str),
    )?;
    Ok(terminal_session_bindings
        .resolve_agent_target_for_write(
            agent_session_id.as_str(),
            expected_generation,
            live_ids.iter().map(String::as_str),
        )?
        .target_terminal_session_id)
}

fn resolve_terminal_snapshot_session_id(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<String> {
    if let Some(session_id) = optional_non_empty_string_arg(arguments, "sessionId")? {
        return Ok(session_id);
    }
    let binding = resolve_agent_target_snapshot(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    )?;
    if !binding.live {
        return Err(AppError::InvalidInput(format!(
            "agent target binding stale for {}: target terminal {} is not live",
            binding.agent_session_id, binding.target_terminal_session_id
        )));
    }
    Ok(binding.target_terminal_session_id)
}

fn resolve_agent_target_snapshot(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<AgentTargetBindingSnapshot> {
    resolve_agent_target_record_and_snapshot(
        agent_sessions,
        terminals,
        terminal_session_bindings,
        arguments,
    )
    .map(|(_, binding)| binding)
}

fn resolve_agent_target_record_and_snapshot(
    agent_sessions: &AgentSessionService,
    terminals: &TerminalManager,
    terminal_session_bindings: &TerminalSessionBindingService,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<(AgentSessionRecord, AgentTargetBindingSnapshot)> {
    let agent_session_id = required_agent_session_id(arguments)?;
    let live_ids = live_terminal_session_ids(terminals)?;
    resolve_hydrated_agent_target_binding(
        agent_sessions,
        terminal_session_bindings,
        &agent_session_id,
        live_ids.iter().map(String::as_str),
    )
}

fn live_terminal_session_ids(terminals: &TerminalManager) -> AppResult<Vec<String>> {
    Ok(terminals
        .list_sessions()?
        .into_iter()
        .map(|session| session.id)
        .collect())
}

fn required_agent_session_id(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<AgentSessionId> {
    AgentSessionId::new(required_string_arg(arguments, "agentSessionId")?)
}

fn optional_non_empty_string_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<String>> {
    Ok(optional_string_arg(arguments, key)?
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty()))
}

pub(super) fn record_terminal_write_history(
    command_history: &CommandHistoryService,
    storage: &CommandSqliteStore,
    session_id: &str,
    data: &str,
) {
    for command in commands_from_terminal_write_data(data) {
        let _ = command_history.record_command(
            storage,
            CommandHistoryRecordRequest {
                command,
                source: CommandHistorySource::Tool,
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
