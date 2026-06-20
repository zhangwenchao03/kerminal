use super::*;

pub(super) fn execute_port_forward_list(port_forwards: &PortForwardService) -> ToolExecutionResult {
    match port_forwards.list() {
        Ok(forwards) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_port_forward_list_for_ai(&forwards)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_port_forward_close(
    port_forwards: &PortForwardService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let forward_id = match required_string_arg(arguments, "forwardId") {
        Ok(forward_id) => forward_id,
        Err(error) => return failure(error.to_string()),
    };

    match port_forwards.close(&forward_id) {
        Ok(true) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!("端口转发已关闭：{forward_id}。")),
            error: None,
        },
        Ok(false) => failure(format!("端口转发不存在或已关闭：{forward_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_port_forward_create(
    port_forwards: &PortForwardService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match port_forward_create_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match port_forwards.create(storage, request) {
        Ok(summary) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_port_forward_for_ai(&summary)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn port_forward_create_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<PortForwardCreateRequest> {
    Ok(PortForwardCreateRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        name: optional_string_arg(arguments, "name")?,
        kind: required_port_forward_kind_arg(arguments)?,
        bind_host: optional_string_arg(arguments, "bindHost")?,
        source_port: required_port_arg(arguments, "sourcePort")?,
        target_host: optional_string_arg(arguments, "targetHost")?,
        target_port: optional_port_arg(arguments, "targetPort")?,
    })
}

pub(super) fn required_port_forward_kind_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<PortForwardKind> {
    match arguments.get("kind") {
        Some(Value::String(value)) => match value.as_str() {
            "local" => Ok(PortForwardKind::Local),
            "remote" => Ok(PortForwardKind::Remote),
            "dynamic" => Ok(PortForwardKind::Dynamic),
            _ => Err(AppError::InvalidInput(
                "kind 只支持 local、remote 或 dynamic。".to_owned(),
            )),
        },
        Some(Value::Null) | None => Err(AppError::InvalidInput("kind 不能为空。".to_owned())),
        _ => Err(AppError::InvalidInput("kind 必须是字符串。".to_owned())),
    }
}

pub(super) fn required_port_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<u16> {
    match arguments.get(key) {
        Some(Value::Number(value)) => value
            .as_u64()
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| AppError::InvalidInput(format!("{key} 必须是 1 到 65535 的数字。"))),
        Some(Value::Null) | None => Err(AppError::InvalidInput(format!("{key} 不能为空。"))),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是数字。"))),
    }
}

pub(super) fn optional_port_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<u16>> {
    match arguments.get(key) {
        Some(Value::Number(value)) => value
            .as_u64()
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value > 0)
            .map(Some)
            .ok_or_else(|| AppError::InvalidInput(format!("{key} 必须是 1 到 65535 的数字。"))),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是数字。"))),
    }
}

pub(super) fn summarize_port_forward_for_ai(summary: &PortForwardSummary) -> String {
    let endpoint = format!("{}:{}", summary.bind_host, summary.source_port);
    let kind = port_forward_kind_label(summary.kind);
    let route = match summary.kind {
        PortForwardKind::Dynamic => endpoint,
        PortForwardKind::Local | PortForwardKind::Remote => {
            let target_host = summary.target_host.as_deref().unwrap_or("-");
            let target_port = summary
                .target_port
                .map(|port| port.to_string())
                .unwrap_or_else(|| "-".to_owned());
            format!("{endpoint} -> {target_host}:{target_port}")
        }
    };

    format!(
        "端口转发已创建：“{}”，{} {}，主机：{}。",
        summary.name, kind, route, summary.host_name
    )
}

pub(super) fn summarize_port_forward_list_for_ai(forwards: &[PortForwardSummary]) -> String {
    if forwards.is_empty() {
        return "当前没有端口转发会话。".to_owned();
    }

    let running_count = forwards
        .iter()
        .filter(|summary| summary.status == PortForwardStatus::Running)
        .count();
    let exited_count = forwards.len().saturating_sub(running_count);
    let samples = forwards
        .iter()
        .take(5)
        .map(port_forward_sample_for_ai)
        .collect::<Vec<_>>()
        .join("；");

    format!(
        "当前共有 {} 个端口转发会话，运行中 {}，已退出 {}。示例：{}。",
        forwards.len(),
        running_count,
        exited_count,
        samples
    )
}

pub(super) fn port_forward_sample_for_ai(summary: &PortForwardSummary) -> String {
    let status = match summary.status {
        PortForwardStatus::Running => "运行中",
        PortForwardStatus::Exited => "已退出",
    };
    let endpoint = format!("{}:{}", summary.bind_host, summary.source_port);
    let route = match summary.kind {
        PortForwardKind::Dynamic => endpoint,
        PortForwardKind::Local | PortForwardKind::Remote => {
            let target_host = summary.target_host.as_deref().unwrap_or("-");
            let target_port = summary
                .target_port
                .map(|port| port.to_string())
                .unwrap_or_else(|| "-".to_owned());
            format!("{endpoint} -> {target_host}:{target_port}")
        }
    };
    format!(
        "{}（{}，{}，{}，id={}）",
        summary.name,
        port_forward_kind_label(summary.kind),
        route,
        status,
        summary.id
    )
}

pub(super) fn port_forward_kind_label(kind: PortForwardKind) -> &'static str {
    match kind {
        PortForwardKind::Local => "local",
        PortForwardKind::Remote => "remote",
        PortForwardKind::Dynamic => "dynamic",
    }
}
