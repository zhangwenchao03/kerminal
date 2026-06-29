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
    local_network_proxy: &LocalNetworkProxyService,
    storage: &RuntimeFileStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let forward_id = match required_string_arg(arguments, "forwardId") {
        Ok(forward_id) => forward_id,
        Err(error) => return failure(error.to_string()),
    };

    let summary = match port_forwards.get(storage, &forward_id) {
        Ok(summary) => summary,
        Err(error) => return failure(error.to_string()),
    };
    match port_forwards.stop(storage, &forward_id) {
        Ok(true) => {
            if let Some(entry_id) = summary.and_then(|summary| summary.local_proxy_entry_id) {
                let _ = local_network_proxy.release_entry(&entry_id);
            }
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(format!("端口转发已停止并保留配置：{forward_id}。")),
                error: None,
                ..ToolExecutionResult::default()
            }
        }
        Ok(false) => failure(format!("端口转发不存在或已关闭：{forward_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_port_forward_create(
    port_forwards: &PortForwardService,
    local_network_proxy: &LocalNetworkProxyService,
    storage: &RuntimeFileStore,
    remote_hosts: &RemoteHostService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match port_forward_create_request_from_arguments(arguments)
        .and_then(|request| prepare_agent_port_forward_request(local_network_proxy, request))
    {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let local_proxy_entry_id = request.local_proxy_entry_id.clone();

    match port_forwards.create_with_context(storage, remote_hosts, paths, request) {
        Ok(summary) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_port_forward_for_agent(&summary)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => {
            if let Some(entry_id) = local_proxy_entry_id.as_deref() {
                let _ = local_network_proxy.release_entry(entry_id);
            }
            failure(error.to_string())
        }
    }
}

pub(super) fn port_forward_create_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<PortForwardCreateRequest> {
    Ok(PortForwardCreateRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        name: optional_string_arg(arguments, "name")?,
        kind: required_port_forward_kind_arg(arguments)?,
        purpose: optional_port_forward_purpose_arg(arguments)?,
        origin: PortForwardOrigin::McpTool,
        bind_host: optional_string_arg(arguments, "bindHost")?,
        local_bind_host: optional_string_arg(arguments, "localBindHost")?,
        remote_bind_host: optional_string_arg(arguments, "remoteBindHost")?,
        source_port: required_port_arg(arguments, "sourcePort")?,
        target_host: optional_string_arg(arguments, "targetHost")?,
        target_port: optional_port_arg(arguments, "targetPort")?,
        local_endpoint: local_endpoint_arg(arguments)?,
        remote_endpoint: remote_endpoint_arg(arguments)?,
        proxy_protocol: optional_port_forward_proxy_protocol_arg(arguments)?,
        remote_access_scope: optional_remote_access_scope_arg(arguments)?,
        proxy_apply_scope: optional_proxy_apply_scope_arg(arguments)?,
        ..Default::default()
    })
}

fn prepare_agent_port_forward_request(
    local_network_proxy: &LocalNetworkProxyService,
    mut request: PortForwardCreateRequest,
) -> AppResult<PortForwardCreateRequest> {
    let protocol = request
        .proxy_protocol
        .unwrap_or(PortForwardProxyProtocol::Http);
    if request.purpose != PortForwardPurpose::HostNetworkAssist
        || protocol != PortForwardProxyProtocol::Http
    {
        return Ok(request);
    }
    if request.local_proxy_entry_id.is_some() && request.local_endpoint.is_some() {
        return Ok(request);
    }

    let local_bind_host = request.local_bind_host.clone().or_else(|| {
        request
            .local_endpoint
            .as_ref()
            .map(|endpoint| endpoint.host.clone())
    });
    let local_port = request
        .local_endpoint
        .as_ref()
        .and_then(|endpoint| endpoint.port);
    let entry = local_network_proxy.acquire_entry(LocalProxyEntryRequest {
        bind_host: local_bind_host,
        host_id: request.host_id.clone(),
        port: local_port,
        session_id: format!("network-assist-agent-{}", Uuid::new_v4()),
        tag: Some("network-assist/http/agent".to_owned()),
    })?;

    request.local_bind_host = Some(entry.bind_host.clone());
    request.local_endpoint = Some(PortForwardEndpoint {
        host: entry.bind_host,
        label: Some("本机 HTTP CONNECT 代理".to_owned()),
        port: Some(entry.port),
    });
    request.shared_proxy_service_id = Some(entry.service_id);
    request.local_proxy_entry_id = Some(entry.entry_id);
    request.proxy_protocol = Some(PortForwardProxyProtocol::Http);
    Ok(request)
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

fn optional_port_forward_purpose_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<PortForwardPurpose> {
    match arguments.get("purpose") {
        Some(Value::String(value)) => match value.as_str() {
            "generic" => Ok(PortForwardPurpose::Generic),
            "hostNetworkAssist" => Ok(PortForwardPurpose::HostNetworkAssist),
            _ => Err(AppError::InvalidInput(
                "purpose 只支持 generic 或 hostNetworkAssist。".to_owned(),
            )),
        },
        Some(Value::Null) | None => Ok(PortForwardPurpose::Generic),
        _ => Err(AppError::InvalidInput("purpose 必须是字符串。".to_owned())),
    }
}

fn optional_port_forward_proxy_protocol_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<PortForwardProxyProtocol>> {
    match arguments.get("proxyProtocol") {
        Some(Value::String(value)) => match value.as_str() {
            "http" => Ok(Some(PortForwardProxyProtocol::Http)),
            "socks5" => Ok(Some(PortForwardProxyProtocol::Socks5)),
            _ => Err(AppError::InvalidInput(
                "proxyProtocol 只支持 http 或 socks5。".to_owned(),
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

fn local_endpoint_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<PortForwardEndpoint>> {
    endpoint_arg(
        optional_string_arg(arguments, "localProxyHost")?,
        optional_zero_or_port_arg(arguments, "localProxyPort")?,
        "本机 HTTP CONNECT 代理",
    )
}

fn remote_endpoint_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<PortForwardEndpoint>> {
    endpoint_arg(
        optional_string_arg(arguments, "remoteProxyHost")?,
        optional_port_arg(arguments, "remoteProxyPort")?,
        "主机代理监听",
    )
}

fn optional_zero_or_port_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<u16>> {
    match arguments.get(key) {
        Some(Value::Number(value)) => value
            .as_u64()
            .and_then(|value| u16::try_from(value).ok())
            .map(Some)
            .ok_or_else(|| AppError::InvalidInput(format!("{key} 必须是 0 到 65535 的数字。"))),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是数字。"))),
    }
}

fn endpoint_arg(
    host: Option<String>,
    port: Option<u16>,
    label: &str,
) -> AppResult<Option<PortForwardEndpoint>> {
    match (host, port) {
        (None, None) => Ok(None),
        (Some(host), Some(port)) => Ok(Some(PortForwardEndpoint {
            host,
            label: Some(label.to_owned()),
            port: Some(port),
        })),
        (Some(_), None) => Err(AppError::InvalidInput(format!("{label}端口不能为空。"))),
        (None, Some(_)) => Err(AppError::InvalidInput(format!("{label}地址不能为空。"))),
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
    if summary.purpose == PortForwardPurpose::HostNetworkAssist {
        let proxy_url = summary.proxy_url.as_deref().unwrap_or("-");
        return format!(
            "主机网络助手已创建：“{}”，代理地址 {}，主机：{}，应用范围：{}。",
            summary.name,
            proxy_url,
            summary.host_name,
            proxy_apply_scope_label(summary.proxy_apply_scope)
        );
    }

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
    if summary.purpose == PortForwardPurpose::HostNetworkAssist {
        return format!(
            "{}（主机网络助手，代理={}，{}，应用范围={}，id={}）",
            summary.name,
            summary.proxy_url.as_deref().unwrap_or("-"),
            status,
            proxy_apply_scope_label(summary.proxy_apply_scope),
            summary.id
        );
    }

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
        PortForwardKind::Dynamic => "dynamic",
    }
}
