use super::*;

pub(super) fn execute_port_forward_list(
    port_forwards: &PortForwardService,
    storage: &RuntimeFileStore,
) -> ToolExecutionResult {
    match port_forwards.list(storage) {
        Ok(forwards) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_port_forward_list_for_agent(&forwards)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_port_forward_close(
    port_forwards: &PortForwardService,
    storage: &RuntimeFileStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let forward_id = match required_string_arg(arguments, "forwardId") {
        Ok(forward_id) => forward_id,
        Err(error) => return failure(error.to_string()),
    };

    match port_forwards.stop(storage, &forward_id) {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(format!("端口转发已停止并保留配置：{forward_id}。")),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure(format!("端口转发不存在或已关闭：{forward_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_port_forward_create(
    port_forwards: &PortForwardService,
    storage: &RuntimeFileStore,
    remote_hosts: &RemoteHostService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match port_forward_create_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    match port_forwards.create_with_context(storage, remote_hosts, paths, request) {
        Ok(summary) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_port_forward_for_agent(&summary)),
            error: None,
            ..ToolExecutionResult::default()
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
        origin: PortForwardOrigin::McpTool,
        bind_host: optional_string_arg(arguments, "bindHost")?,
        local_bind_host: optional_string_arg(arguments, "localBindHost")?,
        remote_bind_host: optional_string_arg(arguments, "remoteBindHost")?,
        source_port: required_port_arg(arguments, "sourcePort")?,
        target_host: optional_string_arg(arguments, "targetHost")?,
        target_port: optional_port_arg(arguments, "targetPort")?,
        local_endpoint: None,
        remote_endpoint: None,
        proxy_protocol: optional_port_forward_proxy_protocol_arg(arguments)?,
        remote_access_scope: optional_remote_access_scope_arg(arguments)?,
        proxy_apply_scope: optional_proxy_apply_scope_arg(arguments)?,
    })
}

pub(super) fn required_port_forward_kind_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<PortForwardKind> {
    match arguments.get("kind") {
        Some(Value::String(value)) => match value.as_str() {
            "local" => Ok(PortForwardKind::Local),
            "remote" => Ok(PortForwardKind::Remote),
            "remoteDynamic" => Ok(PortForwardKind::RemoteDynamic),
            "dynamic" => Ok(PortForwardKind::Dynamic),
            _ => Err(AppError::InvalidInput(
                "kind 只支持 local、remote、remoteDynamic 或 dynamic。".to_owned(),
            )),
        },
        Some(Value::Null) | None => Err(AppError::InvalidInput("kind 不能为空。".to_owned())),
        _ => Err(AppError::InvalidInput("kind 必须是字符串。".to_owned())),
    }
}

fn optional_port_forward_proxy_protocol_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<PortForwardProxyProtocol>> {
    match arguments.get("proxyProtocol") {
        Some(Value::String(value)) => match value.as_str() {
            "socks5" => Ok(Some(PortForwardProxyProtocol::Socks5)),
            _ => Err(AppError::InvalidInput(
                "proxyProtocol 只支持 socks5。".to_owned(),
            )),
        },
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(
            "proxyProtocol 必须是字符串。".to_owned(),
        )),
    }
}

fn optional_remote_access_scope_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<PortForwardRemoteAccessScope>> {
    match arguments.get("remoteAccessScope") {
        Some(Value::String(value)) => match value.as_str() {
            "loopback" => Ok(Some(PortForwardRemoteAccessScope::Loopback)),
            "privateNetwork" => Ok(Some(PortForwardRemoteAccessScope::PrivateNetwork)),
            "allInterfaces" => Ok(Some(PortForwardRemoteAccessScope::AllInterfaces)),
            "custom" => Ok(Some(PortForwardRemoteAccessScope::Custom)),
            _ => Err(AppError::InvalidInput(
                "remoteAccessScope 只支持 loopback、privateNetwork、allInterfaces 或 custom。"
                    .to_owned(),
            )),
        },
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(
            "remoteAccessScope 必须是字符串。".to_owned(),
        )),
    }
}

fn optional_proxy_apply_scope_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<PortForwardProxyApplyScope> {
    match arguments.get("proxyApplyScope") {
        Some(Value::String(value)) => match value.as_str() {
            "none" => Ok(PortForwardProxyApplyScope::None),
            "currentTerminal" => Ok(PortForwardProxyApplyScope::CurrentTerminal),
            "futureTerminals" => Ok(PortForwardProxyApplyScope::FutureTerminals),
            "userProfile" => Ok(PortForwardProxyApplyScope::UserProfile),
            "toolOnly" => Ok(PortForwardProxyApplyScope::ToolOnly),
            _ => Err(AppError::InvalidInput(
                "proxyApplyScope 只支持 none、currentTerminal、futureTerminals、userProfile 或 toolOnly。"
                    .to_owned(),
            )),
        },
        Some(Value::Null) | None => Ok(PortForwardProxyApplyScope::None),
        _ => Err(AppError::InvalidInput(
            "proxyApplyScope 必须是字符串。".to_owned(),
        )),
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

pub(super) fn summarize_port_forward_for_agent(summary: &PortForwardSummary) -> String {
    if summary.kind == PortForwardKind::RemoteDynamic {
        let proxy_url = summary.proxy_url.as_deref().unwrap_or("-");
        return format!(
            "远端 SOCKS 转发已创建：“{}”，代理地址 {}，主机：{}，应用范围：{}。",
            summary.name,
            proxy_url,
            summary.host_name,
            proxy_apply_scope_label(summary.proxy_apply_scope)
        );
    }

    let endpoint = format!("{}:{}", summary.bind_host, summary.source_port);
    let kind = port_forward_kind_label(summary.kind);
    let route = match summary.kind {
        PortForwardKind::Dynamic | PortForwardKind::RemoteDynamic => endpoint,
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

pub(super) fn summarize_port_forward_list_for_agent(forwards: &[PortForwardSummary]) -> String {
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
        .map(port_forward_sample_for_agent)
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

pub(super) fn port_forward_sample_for_agent(summary: &PortForwardSummary) -> String {
    let status = match summary.status {
        PortForwardStatus::Running => "运行中",
        PortForwardStatus::Exited => "已退出",
    };
    if summary.kind == PortForwardKind::RemoteDynamic {
        return format!(
            "{}（远端 SOCKS，代理={}，{}，应用范围={}，id={}）",
            summary.name,
            summary.proxy_url.as_deref().unwrap_or("-"),
            status,
            proxy_apply_scope_label(summary.proxy_apply_scope),
            summary.id
        );
    }

    let endpoint = format!("{}:{}", summary.bind_host, summary.source_port);
    let route = match summary.kind {
        PortForwardKind::Dynamic | PortForwardKind::RemoteDynamic => endpoint,
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

fn proxy_apply_scope_label(scope: PortForwardProxyApplyScope) -> &'static str {
    match scope {
        PortForwardProxyApplyScope::None => "仅创建隧道",
        PortForwardProxyApplyScope::CurrentTerminal => "当前终端",
        PortForwardProxyApplyScope::FutureTerminals => "后续终端",
        PortForwardProxyApplyScope::UserProfile => "用户级配置",
        PortForwardProxyApplyScope::ToolOnly => "外部 Agent/工具命令",
    }
}

pub(super) fn port_forward_kind_label(kind: PortForwardKind) -> &'static str {
    match kind {
        PortForwardKind::Local => "local",
        PortForwardKind::Remote => "remote",
        PortForwardKind::RemoteDynamic => "remoteDynamic",
        PortForwardKind::Dynamic => "dynamic",
    }
}
