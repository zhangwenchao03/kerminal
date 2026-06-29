use super::*;

pub(super) async fn execute_tmux_probe(
    tmux: &TmuxService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match tmux_probe_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match tmux.probe(paths, ssh_commands, request).await {
        Ok(status) => success_with_data(
            summarize_tmux_probe_for_agent(&status),
            json!({ "status": &status }),
        ),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_tmux_list_sessions(
    tmux: &TmuxService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match tmux_list_sessions_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match tmux.list_sessions(paths, ssh_commands, request).await {
        Ok(sessions) => success_with_data(
            summarize_tmux_sessions_for_agent(&sessions),
            json!({ "sessions": &sessions }),
        ),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_tmux_create_session(
    tmux: &TmuxService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match tmux_create_session_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match tmux.create_session(paths, ssh_commands, request).await {
        Ok(session) => success_with_data(
            format!(
                "tmux session 已创建：{} ({})，windows={}。",
                session.name, session.id, session.windows
            ),
            json!({ "session": &session }),
        ),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_tmux_rename_session(
    tmux: &TmuxService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match tmux_rename_session_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match tmux.rename_session(paths, ssh_commands, request).await {
        Ok(session) => success_with_data(
            format!("tmux session 已重命名：{} ({})。", session.name, session.id),
            json!({ "session": &session }),
        ),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_tmux_kill_session(
    tmux: &TmuxService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match tmux_kill_session_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let session_id = request.session_id.clone();

    match tmux.kill_session(paths, ssh_commands, request).await {
        Ok(killed) => success_with_data(
            if killed {
                format!("tmux session 已结束：{session_id}。")
            } else {
                format!("tmux session 不存在或已结束：{session_id}。")
            },
            json!({ "sessionId": session_id, "killed": killed }),
        ),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_tmux_list_windows(
    tmux: &TmuxService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match tmux_list_windows_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match tmux.list_windows(paths, ssh_commands, request).await {
        Ok(windows) => success_with_data(
            summarize_tmux_windows_for_agent(&windows),
            json!({ "windows": &windows }),
        ),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_tmux_list_panes(
    tmux: &TmuxService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match tmux_list_panes_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match tmux.list_panes(paths, ssh_commands, request).await {
        Ok(panes) => success_with_data(
            summarize_tmux_panes_for_agent(&panes),
            json!({ "panes": &panes }),
        ),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_tmux_capture_pane(
    tmux: &TmuxService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match tmux_capture_pane_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match tmux.capture_pane(paths, ssh_commands, request).await {
        Ok(capture) => success_with_data(
            summarize_tmux_capture_for_agent(&capture),
            json!({ "capture": &capture }),
        ),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_tmux_attach_plan(
    tmux: &TmuxService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match tmux_attach_session_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match tmux.attach_launch(request) {
        Ok(launch) => success_with_data(
            summarize_tmux_attach_plan_for_agent(&launch),
            json!({ "launch": &launch }),
        ),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn tmux_probe_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TmuxProbeRequest> {
    Ok(TmuxProbeRequest {
        target: tmux_target_from_arguments(arguments)?,
    })
}

fn tmux_list_sessions_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TmuxListSessionsRequest> {
    Ok(TmuxListSessionsRequest {
        target: tmux_target_from_arguments(arguments)?,
    })
}

fn tmux_create_session_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TmuxCreateSessionRequest> {
    Ok(TmuxCreateSessionRequest {
        target: tmux_target_from_arguments(arguments)?,
        name: required_trimmed_string_arg(arguments, "name")?,
        cwd: optional_trimmed_string_arg(arguments, "cwd")?,
    })
}

fn tmux_rename_session_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TmuxRenameSessionRequest> {
    Ok(TmuxRenameSessionRequest {
        target: tmux_target_from_arguments(arguments)?,
        session_id: required_trimmed_string_arg(arguments, "sessionId")?,
        name: required_trimmed_string_arg(arguments, "name")?,
    })
}

fn tmux_kill_session_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TmuxKillSessionRequest> {
    Ok(TmuxKillSessionRequest {
        target: tmux_target_from_arguments(arguments)?,
        session_id: required_trimmed_string_arg(arguments, "sessionId")?,
    })
}

fn tmux_list_windows_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TmuxListWindowsRequest> {
    Ok(TmuxListWindowsRequest {
        target: tmux_target_from_arguments(arguments)?,
        session_id: required_trimmed_string_arg(arguments, "sessionId")?,
    })
}

fn tmux_list_panes_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TmuxListPanesRequest> {
    Ok(TmuxListPanesRequest {
        target: tmux_target_from_arguments(arguments)?,
        target_id: required_trimmed_string_arg(arguments, "targetId")?,
    })
}

fn tmux_capture_pane_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TmuxCapturePaneRequest> {
    Ok(TmuxCapturePaneRequest {
        target: tmux_target_from_arguments(arguments)?,
        pane_id: required_trimmed_string_arg(arguments, "paneId")?,
        lines: optional_u16_arg(arguments, "lines")?,
    })
}

fn tmux_attach_session_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TmuxAttachSessionRequest> {
    Ok(TmuxAttachSessionRequest {
        target: tmux_target_from_arguments(arguments)?,
        session_id: required_trimmed_string_arg(arguments, "sessionId")?,
        session_name: optional_trimmed_string_arg(arguments, "sessionName")?,
        cwd: optional_trimmed_string_arg(arguments, "cwd")?,
    })
}

fn tmux_target_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TmuxTargetRef> {
    let target_kind = required_trimmed_string_arg(arguments, "targetKind")?;
    let target = match target_kind.as_str() {
        "local" => RemoteTargetRef::Local {
            profile_id: optional_trimmed_string_arg(arguments, "profileId")?,
        },
        "ssh" => RemoteTargetRef::Ssh {
            host_id: required_trimmed_string_arg(arguments, "hostId")?,
        },
        other => {
            return Err(AppError::InvalidInput(format!(
                "targetKind 只支持 local 或 ssh，当前为 {other}"
            )))
        }
    };

    Ok(TmuxTargetRef {
        target,
        socket_name: optional_trimmed_string_arg(arguments, "socketName")?,
        socket_path: optional_trimmed_string_arg(arguments, "socketPath")?,
        tmux_path: optional_trimmed_string_arg(arguments, "tmuxPath")?,
    })
}

fn required_trimmed_string_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<String> {
    let value = required_string_arg(arguments, key)?;
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{key} 不能为空。")));
    }
    Ok(value.to_owned())
}

fn optional_trimmed_string_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<String>> {
    Ok(optional_string_arg(arguments, key)?
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty()))
}

fn optional_u16_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<u16>> {
    match arguments.get(key) {
        Some(Value::Number(value)) => {
            let Some(value) = value.as_u64() else {
                return Err(AppError::InvalidInput(format!("{key} 必须是正整数。")));
            };
            u16::try_from(value)
                .map(Some)
                .map_err(|_| AppError::InvalidInput(format!("{key} 超出支持范围。")))
        }
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是数字。"))),
    }
}

fn success_with_data(summary: impl Into<String>, data: Value) -> ToolExecutionResult {
    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(summary.into()),
        error: None,
        structured_result: Some(data),
        ..ToolExecutionResult::default()
    }
}

fn summarize_tmux_probe_for_agent(status: &TmuxCapabilityStatus) -> String {
    if status.available {
        format!(
            "tmux 可用：{}，目标 {}。",
            status.version.as_deref().unwrap_or("版本未知"),
            status.target_ref
        )
    } else {
        format!(
            "tmux 不可用：目标 {}，原因：{}。",
            status.target_ref,
            status.reason.as_deref().unwrap_or("未知")
        )
    }
}

fn summarize_tmux_sessions_for_agent(sessions: &[TmuxSessionSummary]) -> String {
    if sessions.is_empty() {
        return "tmux sessions 已读取：0 个。".to_owned();
    }
    let sample = sessions
        .iter()
        .take(6)
        .map(|session| {
            format!(
                "{} ({}, windows={}, clients={})",
                session.name, session.id, session.windows, session.clients
            )
        })
        .collect::<Vec<_>>();
    let suffix = if sessions.len() > sample.len() {
        format!("，另有 {} 个未显示", sessions.len() - sample.len())
    } else {
        String::new()
    };
    format!(
        "tmux sessions 已读取：{} 个，{}{}。",
        sessions.len(),
        sample.join("；"),
        suffix
    )
}

fn summarize_tmux_windows_for_agent(windows: &[TmuxWindowSummary]) -> String {
    if windows.is_empty() {
        return "tmux windows 已读取：0 个。".to_owned();
    }
    let sample = windows
        .iter()
        .take(8)
        .map(|window| {
            let active = if window.active { "active" } else { "inactive" };
            format!(
                "{}:{} ({}, panes={})",
                window.index, window.name, active, window.panes
            )
        })
        .collect::<Vec<_>>();
    let suffix = if windows.len() > sample.len() {
        format!("，另有 {} 个未显示", windows.len() - sample.len())
    } else {
        String::new()
    };
    format!(
        "tmux windows 已读取：{} 个，{}{}。",
        windows.len(),
        sample.join("；"),
        suffix
    )
}

fn summarize_tmux_panes_for_agent(panes: &[TmuxPaneSummary]) -> String {
    if panes.is_empty() {
        return "tmux panes 已读取：0 个。".to_owned();
    }
    let sample = panes
        .iter()
        .take(8)
        .map(|pane| {
            let active = if pane.active { "active" } else { "inactive" };
            format!(
                "{} ({}, {}x{}, command={})",
                pane.id,
                active,
                pane.width,
                pane.height,
                pane.current_command.as_deref().unwrap_or("unknown")
            )
        })
        .collect::<Vec<_>>();
    let suffix = if panes.len() > sample.len() {
        format!("，另有 {} 个未显示", panes.len() - sample.len())
    } else {
        String::new()
    };
    format!(
        "tmux panes 已读取：{} 个，{}{}。",
        panes.len(),
        sample.join("；"),
        suffix
    )
}

fn summarize_tmux_capture_for_agent(capture: &TmuxPaneCapture) -> String {
    let sample = capture.text.lines().take(4).collect::<Vec<_>>().join(" ");
    let sample = truncate_string(&collapse_whitespace(&sample));
    let truncation_label = if capture.truncated {
        "，内容已按行数截断"
    } else {
        ""
    };
    if sample.is_empty() {
        format!(
            "tmux pane 已捕获：{}，最多 {} 行{}。",
            capture.pane_id, capture.lines, truncation_label
        )
    } else {
        format!(
            "tmux pane 已捕获：{}，最多 {} 行{}，片段：{}。",
            capture.pane_id, capture.lines, truncation_label, sample
        )
    }
}

fn summarize_tmux_attach_plan_for_agent(launch: &TmuxAttachLaunch) -> String {
    match launch {
        TmuxAttachLaunch::Local { title, binding, .. } => format!(
            "tmux attach 启动规格已生成：{}，session={}，目标={}，模式=local。",
            title, binding.session_id, binding.target_ref
        ),
        TmuxAttachLaunch::Ssh {
            title,
            binding,
            host_id,
            remote_command,
            ..
        } => format!(
            "tmux attach 启动规格已生成：{}，host={}，session={}，目标={}，远程命令={}。",
            title, host_id, binding.session_id, binding.target_ref, remote_command
        ),
    }
}
