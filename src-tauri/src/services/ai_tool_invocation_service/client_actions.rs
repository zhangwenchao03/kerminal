use super::*;

pub(super) fn client_action_for_invocation(
    tool: &ToolDefinition,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<AiToolClientAction>> {
    match tool.id.as_str() {
        "terminal.create" => Ok(Some(terminal_create_client_action(arguments)?)),
        "ssh.connect" => Ok(Some(ssh_connect_client_action(arguments)?)),
        "ssh.ensure_connected" => ssh_ensure_connected_client_action(arguments),
        "workspace.split_pane" => {
            let direction = workspace_split_direction(arguments)?;
            Ok(Some(AiToolClientAction {
                kind: AiToolClientActionKind::WorkspaceSplitPane,
                direction: Some(direction.to_owned()),
                title: None,
                shell: None,
                args: None,
                cwd: None,
                env: None,
                host_id: None,
                tab_id: None,
                tool_id: None,
                cols: None,
                rows: None,
            }))
        }
        "workspace.focus_tab" => Ok(Some(AiToolClientAction {
            kind: AiToolClientActionKind::WorkspaceFocusTab,
            direction: None,
            title: None,
            shell: None,
            args: None,
            cwd: None,
            env: None,
            host_id: None,
            tab_id: Some(workspace_focus_tab_id(arguments)?),
            tool_id: None,
            cols: None,
            rows: None,
        })),
        "workspace.open_tool" => Ok(Some(AiToolClientAction {
            kind: AiToolClientActionKind::WorkspaceOpenTool,
            direction: None,
            title: None,
            shell: None,
            args: None,
            cwd: None,
            env: None,
            host_id: None,
            tab_id: None,
            tool_id: Some(workspace_tool_id(arguments)?),
            cols: None,
            rows: None,
        })),
        _ => Ok(None),
    }
}

pub(super) fn execute_terminal_create(
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let action = match terminal_create_client_action(arguments) {
        Ok(action) => action,
        Err(error) => return failure(error.to_string()),
    };

    let detail = action
        .shell
        .as_deref()
        .or(action.title.as_deref())
        .map(|value| format!("，配置: {value}"))
        .unwrap_or_default();
    ToolExecutionResult {
        status: AiToolInvocationStatus::Succeeded,
        result_summary: Some(format!("本地终端已批准创建，客户端将打开新 tab{detail}。")),
        error: None,
        ..ToolExecutionResult::default()
    }
}

pub(super) fn terminal_create_client_action(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<AiToolClientAction> {
    let Some(cols) = number_to_u16(arguments.get("cols")) else {
        return Err(AppError::InvalidInput(
            "cols 必须是 1 到 65535 的数字。".to_owned(),
        ));
    };
    let Some(rows) = number_to_u16(arguments.get("rows")) else {
        return Err(AppError::InvalidInput(
            "rows 必须是 1 到 65535 的数字。".to_owned(),
        ));
    };

    Ok(AiToolClientAction {
        kind: AiToolClientActionKind::TerminalCreate,
        direction: None,
        title: optional_string_arg(arguments, "title")?,
        shell: optional_string_arg(arguments, "shell")?,
        args: optional_string_array_action_arg(arguments, "args")?,
        cwd: optional_string_arg(arguments, "cwd")?,
        env: optional_string_map_action_arg(arguments, "env")?,
        host_id: None,
        tab_id: None,
        tool_id: None,
        cols: Some(cols),
        rows: Some(rows),
    })
}

pub(super) fn ssh_connect_client_action(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<AiToolClientAction> {
    let Some(cols) = number_to_u16(arguments.get("cols")) else {
        return Err(AppError::InvalidInput(
            "cols 必须是 1 到 65535 的数字。".to_owned(),
        ));
    };
    let Some(rows) = number_to_u16(arguments.get("rows")) else {
        return Err(AppError::InvalidInput(
            "rows 必须是 1 到 65535 的数字。".to_owned(),
        ));
    };

    Ok(AiToolClientAction {
        kind: AiToolClientActionKind::SshConnect,
        direction: None,
        title: None,
        shell: None,
        args: None,
        cwd: None,
        env: None,
        host_id: Some(required_string_arg(arguments, "hostId")?),
        tab_id: None,
        tool_id: None,
        cols: Some(cols),
        rows: Some(rows),
    })
}

fn ssh_ensure_connected_client_action(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<AiToolClientAction>> {
    let Some(host_id) = optional_string_arg(arguments, "hostId")?
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let Some(cols) = number_to_u16(arguments.get("cols")) else {
        return Err(AppError::InvalidInput(
            "cols 必须是 1 到 65535 的数字。".to_owned(),
        ));
    };
    let Some(rows) = number_to_u16(arguments.get("rows")) else {
        return Err(AppError::InvalidInput(
            "rows 必须是 1 到 65535 的数字。".to_owned(),
        ));
    };

    Ok(Some(AiToolClientAction {
        kind: AiToolClientActionKind::SshConnect,
        direction: None,
        title: None,
        shell: None,
        args: None,
        cwd: None,
        env: None,
        host_id: Some(host_id),
        tab_id: None,
        tool_id: None,
        cols: Some(cols),
        rows: Some(rows),
    }))
}

pub(super) fn execute_workspace_split_pane(
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let direction = match workspace_split_direction(arguments) {
        Ok(direction) => direction,
        Err(error) => return failure(error.to_string()),
    };
    let label = match direction {
        "horizontal" => "左右分屏",
        "vertical" => "上下分屏",
        _ => "分屏",
    };

    ToolExecutionResult {
        status: AiToolInvocationStatus::Succeeded,
        result_summary: Some(format!("工作区{label}已批准，客户端将立即执行。")),
        error: None,
        ..ToolExecutionResult::default()
    }
}

pub(super) fn workspace_split_direction(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<&'static str> {
    let Some(direction) = arguments.get("direction").and_then(Value::as_str) else {
        return Err(AppError::InvalidInput(
            "direction 必须是字符串。".to_owned(),
        ));
    };

    match direction {
        "horizontal" => Ok("horizontal"),
        "vertical" => Ok("vertical"),
        _ => Err(AppError::InvalidInput(
            "direction 只支持 horizontal 或 vertical。".to_owned(),
        )),
    }
}

pub(super) fn execute_workspace_focus_tab(
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let tab_id = match workspace_focus_tab_id(arguments) {
        Ok(tab_id) => tab_id,
        Err(error) => return failure(error.to_string()),
    };

    ToolExecutionResult {
        status: AiToolInvocationStatus::Succeeded,
        result_summary: Some(format!(
            "终端 tab 切换已批准，客户端将聚焦 {}。",
            truncate_string(&tab_id)
        )),
        error: None,
        ..ToolExecutionResult::default()
    }
}

pub(super) fn workspace_focus_tab_id(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<String> {
    let tab_id = required_string_arg(arguments, "tabId")?;
    let tab_id = tab_id.trim();
    if tab_id.is_empty() {
        return Err(AppError::InvalidInput("tabId 不能为空。".to_owned()));
    }
    if tab_id.len() > 120 {
        return Err(AppError::InvalidInput("tabId 过长。".to_owned()));
    }
    Ok(tab_id.to_owned())
}

pub(super) fn execute_workspace_open_tool(
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let tool_id = match workspace_tool_id(arguments) {
        Ok(tool_id) => tool_id,
        Err(error) => return failure(error.to_string()),
    };

    ToolExecutionResult {
        status: AiToolInvocationStatus::Succeeded,
        result_summary: Some(format!(
            "工具面板切换已批准，客户端将打开{}。",
            workspace_tool_label(&tool_id).unwrap_or("指定工具面板")
        )),
        error: None,
        ..ToolExecutionResult::default()
    }
}

pub(super) fn workspace_tool_id(arguments: &serde_json::Map<String, Value>) -> AppResult<String> {
    let tool_id = required_string_arg(arguments, "toolId")?;
    let tool_id = tool_id.trim();
    if workspace_tool_label(tool_id).is_none() {
        return Err(AppError::InvalidInput(
            "toolId 只支持 ai、system、sftp、ports、snippets、logs 或 settings。".to_owned(),
        ));
    }
    Ok(tool_id.to_owned())
}

pub(super) fn workspace_tool_label(tool_id: &str) -> Option<&'static str> {
    match tool_id {
        "ai" => Some("Kerminal Agent"),
        "system" => Some("系统工具"),
        "sftp" => Some("SFTP"),
        "ports" => Some("端口工具"),
        "snippets" => Some("片段工具"),
        "logs" => Some("日志工具"),
        "settings" => Some("设置"),
        _ => None,
    }
}
