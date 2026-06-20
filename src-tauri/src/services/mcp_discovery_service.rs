//! 外部 MCP Server discovery 服务。
//!
//! @author kongweiguang

use std::{collections::HashMap, env, time::Duration};

use http::{HeaderName, HeaderValue};
use rmcp::{
    model::{CallToolRequestParams, CallToolResult},
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, ConfigureCommandExt,
        StreamableHttpClientTransport, TokioChildProcess,
    },
    ServiceExt,
};
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    models::{
        settings::{
            AiMcpSettings, CustomMcpNameValue, CustomMcpServerSetting, CustomMcpServerToolSetting,
            CustomMcpTransportKind,
        },
        tool_registry::{ToolAuditPolicy, ToolConfirmationPolicy, ToolRiskLevel},
    },
};

const MCP_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// 对单个 MCP Server 执行 tools/list discovery。
pub async fn discover_mcp_server_tools(
    server: CustomMcpServerSetting,
) -> AppResult<Vec<CustomMcpServerToolSetting>> {
    let server = normalize_single_server(server)?;

    let tools = tokio::time::timeout(MCP_DISCOVERY_TIMEOUT, discover_inner(server))
        .await
        .map_err(|_| AppError::AiAgent("MCP Server discovery 超时".to_owned()))??;
    Ok(tools)
}

/// 调用单个外部 MCP Server 的一个已发现 tool。
pub async fn call_mcp_server_tool(
    server: CustomMcpServerSetting,
    tool_name: String,
    arguments: serde_json::Map<String, Value>,
) -> AppResult<CallToolResult> {
    let server = normalize_single_server(server)?;
    let tool_name = tool_name.trim().to_owned();
    if tool_name.is_empty() {
        return Err(AppError::InvalidInput("MCP tool name 不能为空".to_owned()));
    }

    tokio::time::timeout(
        MCP_TOOL_CALL_TIMEOUT,
        call_inner(server, tool_name, arguments),
    )
    .await
    .map_err(|_| AppError::AiAgent("MCP Server tools/call 超时".to_owned()))?
}

fn normalize_single_server(server: CustomMcpServerSetting) -> AppResult<CustomMcpServerSetting> {
    let mut settings = AiMcpSettings {
        servers: vec![server],
        skill_directories: Vec::new(),
    }
    .validated()?;
    settings
        .servers
        .pop()
        .ok_or_else(|| AppError::InvalidInput("MCP Server 配置不能为空".to_owned()))
}

async fn discover_inner(
    server: CustomMcpServerSetting,
) -> AppResult<Vec<CustomMcpServerToolSetting>> {
    match server.transport {
        CustomMcpTransportKind::Stdio => discover_stdio_tools(server).await,
        CustomMcpTransportKind::Http
        | CustomMcpTransportKind::Sse
        | CustomMcpTransportKind::WebSocket => discover_http_tools(server).await,
    }
}

async fn call_inner(
    server: CustomMcpServerSetting,
    tool_name: String,
    arguments: serde_json::Map<String, Value>,
) -> AppResult<CallToolResult> {
    match server.transport {
        CustomMcpTransportKind::Stdio => call_stdio_tool(server, tool_name, arguments).await,
        CustomMcpTransportKind::Http
        | CustomMcpTransportKind::Sse
        | CustomMcpTransportKind::WebSocket => call_http_tool(server, tool_name, arguments).await,
    }
}

async fn discover_stdio_tools(
    server: CustomMcpServerSetting,
) -> AppResult<Vec<CustomMcpServerToolSetting>> {
    let command = tokio::process::Command::new(server.command.clone());
    let env_values = resolve_name_values(&server.env)?;
    let transport = TokioChildProcess::new(command.configure(|cmd| {
        cmd.args(server.args.clone());
        for (name, value) in env_values {
            cmd.env(name, value);
        }
    }))
    .map_err(|error| {
        AppError::AiAgent(format!(
            "无法启动 MCP Server `{}` discovery 进程: {error}",
            server.id
        ))
    })?;

    let client = ().serve(transport).await.map_err(|error| {
        AppError::AiAgent(format!("MCP Server `{}` 初始化失败: {error}", server.id))
    })?;
    let tools = client.list_all_tools().await.map_err(|error| {
        AppError::AiAgent(format!(
            "MCP Server `{}` tools/list 失败: {error}",
            server.id
        ))
    })?;
    let _ = client.cancel().await;
    Ok(tools.into_iter().map(discovered_tool_from_rmcp).collect())
}

async fn call_stdio_tool(
    server: CustomMcpServerSetting,
    tool_name: String,
    arguments: serde_json::Map<String, Value>,
) -> AppResult<CallToolResult> {
    let command = tokio::process::Command::new(server.command.clone());
    let env_values = resolve_name_values(&server.env)?;
    let transport = TokioChildProcess::new(command.configure(|cmd| {
        cmd.args(server.args.clone());
        for (name, value) in env_values {
            cmd.env(name, value);
        }
    }))
    .map_err(|error| {
        AppError::AiAgent(format!(
            "无法启动 MCP Server `{}` tools/call 进程: {error}",
            server.id
        ))
    })?;

    let client = ().serve(transport).await.map_err(|error| {
        AppError::AiAgent(format!("MCP Server `{}` 初始化失败: {error}", server.id))
    })?;
    let result = client
        .call_tool(CallToolRequestParams::new(tool_name).with_arguments(arguments))
        .await
        .map_err(|error| {
            AppError::AiAgent(format!(
                "MCP Server `{}` tools/call 失败: {error}",
                server.id
            ))
        })?;
    let _ = client.cancel().await;
    Ok(result)
}

async fn discover_http_tools(
    server: CustomMcpServerSetting,
) -> AppResult<Vec<CustomMcpServerToolSetting>> {
    let headers = resolve_headers(&server.headers)?;
    let mut config = StreamableHttpClientTransportConfig::with_uri(server.url.clone());
    if !headers.is_empty() {
        config = config.custom_headers(headers);
    }
    if !server.bearer_token_env_var.is_empty() {
        let token = env::var(&server.bearer_token_env_var).map_err(|_| {
            AppError::InvalidInput(format!(
                "环境变量 {} 不存在，无法读取 MCP Bearer token",
                server.bearer_token_env_var
            ))
        })?;
        config = config.auth_header(token);
    }
    let transport = StreamableHttpClientTransport::from_config(config);
    let client = ().serve(transport).await.map_err(|error| {
        AppError::AiAgent(format!("MCP Server `{}` 初始化失败: {error}", server.id))
    })?;
    let tools = client.list_all_tools().await.map_err(|error| {
        AppError::AiAgent(format!(
            "MCP Server `{}` tools/list 失败: {error}",
            server.id
        ))
    })?;
    let _ = client.cancel().await;
    Ok(tools.into_iter().map(discovered_tool_from_rmcp).collect())
}

async fn call_http_tool(
    server: CustomMcpServerSetting,
    tool_name: String,
    arguments: serde_json::Map<String, Value>,
) -> AppResult<CallToolResult> {
    let headers = resolve_headers(&server.headers)?;
    let mut config = StreamableHttpClientTransportConfig::with_uri(server.url.clone());
    if !headers.is_empty() {
        config = config.custom_headers(headers);
    }
    if !server.bearer_token_env_var.is_empty() {
        let token = env::var(&server.bearer_token_env_var).map_err(|_| {
            AppError::InvalidInput(format!(
                "环境变量 {} 不存在，无法读取 MCP Bearer token",
                server.bearer_token_env_var
            ))
        })?;
        config = config.auth_header(token);
    }
    let transport = StreamableHttpClientTransport::from_config(config);
    let client = ().serve(transport).await.map_err(|error| {
        AppError::AiAgent(format!("MCP Server `{}` 初始化失败: {error}", server.id))
    })?;
    let result = client
        .call_tool(CallToolRequestParams::new(tool_name).with_arguments(arguments))
        .await
        .map_err(|error| {
            AppError::AiAgent(format!(
                "MCP Server `{}` tools/call 失败: {error}",
                server.id
            ))
        })?;
    let _ = client.cancel().await;
    Ok(result)
}

fn discovered_tool_from_rmcp(tool: rmcp::model::Tool) -> CustomMcpServerToolSetting {
    CustomMcpServerToolSetting {
        audit: ToolAuditPolicy::Summary,
        confirmation: ToolConfirmationPolicy::Always,
        description: tool
            .description
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_default(),
        discovered_at: Some(unix_timestamp()),
        enabled: true,
        input_schema: Value::Object((*tool.input_schema).clone()),
        name: tool.name.to_string(),
        risk: ToolRiskLevel::Remote,
        title: tool.title.unwrap_or_default(),
    }
}

fn resolve_name_values(values: &[CustomMcpNameValue]) -> AppResult<Vec<(String, String)>> {
    values
        .iter()
        .map(|item| Ok((item.name.clone(), resolve_value_reference(&item.value)?)))
        .collect()
}

fn resolve_headers(values: &[CustomMcpNameValue]) -> AppResult<HashMap<HeaderName, HeaderValue>> {
    let mut headers = HashMap::new();
    for item in values {
        let name = HeaderName::from_bytes(item.name.as_bytes()).map_err(|error| {
            AppError::InvalidInput(format!("MCP HTTP header 名称无效 `{}`: {error}", item.name))
        })?;
        let value = resolve_value_reference(&item.value)?;
        let value = HeaderValue::from_str(&value).map_err(|error| {
            AppError::InvalidInput(format!("MCP HTTP header `{}` 值无效: {error}", item.name))
        })?;
        headers.insert(name, value);
    }
    Ok(headers)
}

fn resolve_value_reference(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if let Some(env_name) = trimmed
        .strip_prefix("${")
        .and_then(|rest| rest.strip_suffix('}'))
        .filter(|name| !name.is_empty())
    {
        return env::var(env_name).map_err(|_| {
            AppError::InvalidInput(format!("环境变量 {env_name} 不存在，无法解析 MCP 配置"))
        });
    }
    Ok(trimmed.to_owned())
}

fn unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}
