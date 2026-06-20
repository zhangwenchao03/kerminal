//! Streamable HTTP MCP Server 服务。
//!
//! @author kongweiguang

use std::{
    future::Future,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{Arc, Mutex},
};

use axum::Router;
use rmcp::{
    model::{
        AnnotateAble, CallToolRequestParams, CallToolResult, GetPromptRequestParams,
        GetPromptResult, Implementation, ListPromptsResult, ListResourceTemplatesResult,
        ListResourcesResult, ListToolsResult, PaginatedRequestParams, Prompt, PromptArgument,
        PromptMessage, PromptMessageRole, RawResource, RawResourceTemplate,
        ReadResourceRequestParams, ReadResourceResult, ResourceContents, ResourceTemplate,
        ServerCapabilities, ServerInfo as RmcpServerInfo, Tool,
    },
    service::{MaybeSendFuture, RequestContext, RoleServer},
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData as McpError, ServerHandler,
};
use serde_json::{json, Value};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

use crate::{
    error::{AppError, AppResult},
    models::{
        ai_tool_invocation::{
            AiToolAuditRecord, AiToolConfirmRequest, AiToolInvocationStatus, AiToolPrepareRequest,
        },
        tool_registry::{
            McpHttpServerStartRequest, McpHttpServerStatus, McpPromptMessage,
            McpPromptRenderRequest, McpResourceReadRequest, ToolDefinition,
        },
    },
    services::{
        ai_tool_invocation_service::AiToolExecutionContext,
        mcp_tool_gateway::{
            custom_mcp_tool_definitions, tool_definition_to_rmcp_tool, McpPromptRenderRuntime,
            McpResourceReadRuntime, AGENT_SKILL_DETAIL_RESOURCE_URI_TEMPLATE,
            AI_AUDIT_SUMMARY_RESOURCE_URI, AI_POLICY_RESOURCE_URI,
        },
    },
    state::AppState,
};

const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1";
const MCP_PATH: &str = "/mcp";
const MCP_SERVER_INSTRUCTIONS: &str = "Kerminal exposes a local Streamable HTTP MCP server for terminal/workspace context, skills, prompts, and audited tools. Kerminal does not expose a custom confirmation round trip over MCP: configure your MCP host hooks/permission system to approve tool calls. Kerminal still validates its allowlist, applies local security settings, and audits every tool call.";

/// Streamable HTTP MCP Server 生命周期服务。
#[derive(Debug, Clone, Default)]
pub struct McpStreamableHttpServerService {
    inner: Arc<Mutex<Option<McpStreamableHttpServerHandle>>>,
}

#[derive(Debug, Clone)]
struct McpStreamableHttpServerHandle {
    endpoint: String,
    bind_address: String,
    port: u16,
    cancellation: CancellationToken,
}

#[derive(Clone)]
struct KerminalMcpServer {
    app: tauri::AppHandle,
}

impl McpStreamableHttpServerService {
    /// 创建 Streamable HTTP MCP Server 生命周期服务。
    pub fn new() -> Self {
        Self::default()
    }

    /// 返回当前运行状态。
    pub fn status(&self) -> AppResult<McpHttpServerStatus> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("mcp_http_server"))?;
        Ok(status_from_handle(guard.as_ref()))
    }

    /// 启动本地 Streamable HTTP MCP Server。
    pub async fn start(
        &self,
        app: tauri::AppHandle,
        request: Option<McpHttpServerStartRequest>,
    ) -> AppResult<McpHttpServerStatus> {
        {
            let guard = self
                .inner
                .lock()
                .map_err(|_| AppError::StateLockPoisoned("mcp_http_server"))?;
            if let Some(handle) = guard.as_ref() {
                return Ok(status_from_handle(Some(handle)));
            }
        }

        let request = request.unwrap_or_default();
        let bind_address = normalize_bind_address(request.host.as_deref())?;
        let port = request.port.unwrap_or(0);
        let socket_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), port);
        let listener = tokio::net::TcpListener::bind(socket_addr).await?;
        let local_addr = listener.local_addr()?;
        let endpoint = format!(
            "http://{}:{}{}",
            DEFAULT_BIND_ADDRESS,
            local_addr.port(),
            MCP_PATH
        );
        let cancellation = CancellationToken::new();

        let config = StreamableHttpServerConfig::default()
            .with_stateful_mode(true)
            .with_allowed_hosts(["localhost", DEFAULT_BIND_ADDRESS, "::1"])
            .with_cancellation_token(cancellation.child_token());
        let session_manager = Arc::new(LocalSessionManager::default());
        let service: StreamableHttpService<KerminalMcpServer, LocalSessionManager> =
            StreamableHttpService::new(
                {
                    let app = app.clone();
                    move || Ok(KerminalMcpServer { app: app.clone() })
                },
                session_manager,
                config,
            );
        let router = Router::new().nest_service(MCP_PATH, service);
        let shutdown = cancellation.child_token();

        tauri::async_runtime::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(shutdown.cancelled_owned())
                .await
            {
                eprintln!("Kerminal Streamable HTTP MCP server stopped with error: {error}");
            }
        });

        let handle = McpStreamableHttpServerHandle {
            endpoint,
            bind_address,
            port: local_addr.port(),
            cancellation,
        };
        let status = status_from_handle(Some(&handle));
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("mcp_http_server"))?;
        *guard = Some(handle);
        Ok(status)
    }

    /// 停止本地 Streamable HTTP MCP Server。
    pub fn stop(&self) -> AppResult<McpHttpServerStatus> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("mcp_http_server"))?;
        if let Some(handle) = guard.take() {
            handle.cancellation.cancel();
        }
        Ok(status_from_handle(None))
    }
}

#[allow(clippy::manual_async_fn)]
impl ServerHandler for KerminalMcpServer {
    fn get_info(&self) -> RmcpServerInfo {
        RmcpServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
        )
        .with_server_info(
            Implementation::new("kerminal", env!("CARGO_PKG_VERSION"))
                .with_title("Kerminal")
                .with_description("Kerminal local terminal workspace MCP server"),
        )
        .with_instructions(MCP_SERVER_INSTRUCTIONS)
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, McpError>> + MaybeSendFuture + '_ {
        async move {
            let state = self.app.state::<AppState>();
            let definitions = externally_callable_tool_definitions(&state)?;
            Ok(ListToolsResult::with_all_items(
                definitions
                    .iter()
                    .map(tool_definition_to_rmcp_tool)
                    .collect::<Vec<_>>(),
            ))
        }
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        let state = self.app.state::<AppState>();
        externally_callable_tool_definitions(&state)
            .ok()?
            .into_iter()
            .find(|definition| definition.id == name)
            .map(|definition| tool_definition_to_rmcp_tool(&definition))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<CallToolResult, McpError>> + MaybeSendFuture + '_ {
        async move { self.call_tool_inner(request).await }
    }

    fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListResourcesResult, McpError>> + MaybeSendFuture + '_ {
        async move {
            let state = self.app.state::<AppState>();
            let manifest = manifest_snapshot(&state)?;
            let resources = manifest
                .resources
                .into_iter()
                .map(|resource| {
                    RawResource::new(resource.uri, resource.name)
                        .with_title(resource.title)
                        .with_description(resource.description)
                        .with_mime_type(resource.mime_type)
                        .no_annotation()
                })
                .collect::<Vec<_>>();
            Ok(ListResourcesResult::with_all_items(resources))
        }
    }

    fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListResourceTemplatesResult, McpError>> + MaybeSendFuture + '_
    {
        async move {
            Ok(ListResourceTemplatesResult::with_all_items(vec![
                agent_skill_detail_resource_template(),
            ]))
        }
    }

    fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ReadResourceResult, McpError>> + MaybeSendFuture + '_ {
        async move {
            let state = self.app.state::<AppState>();
            let runtime = resource_runtime(&state, &request.uri)?;
            let content = state
                .mcp_tools()
                .read_resource(
                    &state.tools().list_tools(),
                    McpResourceReadRequest {
                        uri: request.uri.clone(),
                        application_context: None,
                        terminal_context: None,
                        audit_limit: Some(20),
                    },
                    runtime,
                )
                .map_err(app_error_to_mcp_error)?;
            let text = serde_json::to_string_pretty(&content.content)
                .map_err(AppError::from)
                .map_err(app_error_to_mcp_error)?;
            Ok(ReadResourceResult::new(vec![ResourceContents::text(
                text,
                content.uri,
            )
            .with_mime_type(content.mime_type)]))
        }
    }

    fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListPromptsResult, McpError>> + MaybeSendFuture + '_ {
        async move {
            let state = self.app.state::<AppState>();
            let manifest = manifest_snapshot(&state)?;
            let prompts = manifest
                .prompts
                .into_iter()
                .map(|prompt| {
                    Prompt::new(
                        prompt.name,
                        Some(prompt.description),
                        Some(
                            prompt
                                .arguments
                                .into_iter()
                                .map(|argument| {
                                    PromptArgument::new(argument.name)
                                        .with_description(argument.description)
                                        .with_required(argument.required)
                                })
                                .collect::<Vec<_>>(),
                        ),
                    )
                    .with_title(prompt.title)
                })
                .collect::<Vec<_>>();
            Ok(ListPromptsResult::with_all_items(prompts))
        }
    }

    fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<GetPromptResult, McpError>> + MaybeSendFuture + '_ {
        async move {
            let state = self.app.state::<AppState>();
            let settings = state
                .settings()
                .load_settings(state.storage())
                .map_err(app_error_to_mcp_error)?;
            let result = state
                .mcp_tools()
                .render_prompt(
                    McpPromptRenderRequest {
                        name: request.name,
                        arguments: request.arguments.unwrap_or_default(),
                        application_context: None,
                        terminal_context: None,
                    },
                    McpPromptRenderRuntime {
                        custom_mcp: settings.ai.mcp,
                        ..Default::default()
                    },
                )
                .map_err(app_error_to_mcp_error)?;
            Ok(GetPromptResult::new(
                result
                    .messages
                    .into_iter()
                    .map(prompt_message_to_rmcp)
                    .collect::<Vec<_>>(),
            )
            .with_description(result.description))
        }
    }
}

impl KerminalMcpServer {
    async fn call_tool_inner(
        &self,
        request: CallToolRequestParams,
    ) -> Result<CallToolResult, McpError> {
        let state = self.app.state::<AppState>();
        let definitions = externally_callable_tool_definitions(&state)?;
        let settings = state
            .settings()
            .load_settings(state.storage())
            .map_err(app_error_to_mcp_error)?;
        let tool_id = request.name.to_string();
        if !definitions
            .iter()
            .any(|definition| definition.id == tool_id)
        {
            return Err(McpError::invalid_params(
                format!("未知或不可通过 HTTP MCP 直接调用的工具: {tool_id}"),
                None,
            ));
        }

        let pending = state
            .ai_tools()
            .prepare_with_ai_policy(
                &definitions,
                &settings.ai,
                AiToolPrepareRequest {
                    tool_id,
                    arguments: Value::Object(request.arguments.unwrap_or_default()),
                    requested_by: Some("kerminal-streamable-http-mcp".to_owned()),
                    reason: Some("external MCP tools/call".to_owned()),
                },
            )
            .map_err(app_error_to_mcp_error)?;
        let audit = state
            .ai_tools()
            .confirm_async(
                execution_context(&state),
                AiToolConfirmRequest {
                    invocation_id: pending.id.clone(),
                    approved: true,
                },
            )
            .await
            .map_err(app_error_to_mcp_error)?;

        Ok(audit_to_call_tool_result(audit))
    }
}

/// 判断工具是否适合通过外部 MCP client 直接调用。
pub fn is_externally_callable_tool(definition: &ToolDefinition) -> bool {
    definition.enabled
        && definition.exposed_to_mcp
        && !matches!(
            definition.id.as_str(),
            "terminal.create"
                | "workspace.split_pane"
                | "workspace.focus_tab"
                | "workspace.open_tool"
                | "ssh.connect"
        )
}

fn externally_callable_tool_definitions(state: &AppState) -> Result<Vec<ToolDefinition>, McpError> {
    let settings = state
        .settings()
        .load_settings(state.storage())
        .map_err(app_error_to_mcp_error)?;
    let mut definitions = state.tools().list_tools();
    definitions.extend(custom_mcp_tool_definitions(&settings.ai.mcp));
    Ok(definitions
        .into_iter()
        .filter(is_externally_callable_tool)
        .collect())
}

fn manifest_snapshot(
    state: &AppState,
) -> Result<crate::models::tool_registry::McpGatewayManifest, McpError> {
    let settings = state
        .settings()
        .load_settings(state.storage())
        .map_err(app_error_to_mcp_error)?;
    Ok(state
        .mcp_tools()
        .manifest(&state.tools().list_tools(), &settings.ai.mcp))
}

fn agent_skill_detail_resource_template() -> ResourceTemplate {
    RawResourceTemplate::new(
        AGENT_SKILL_DETAIL_RESOURCE_URI_TEMPLATE,
        "agent-skill-detail",
    )
    .with_title("Agent Skill 详情")
    .with_description("按 skill id 读取用户自定义标准 SKILL.md 的完整说明正文和文件夹能力摘要。")
    .with_mime_type("application/json")
    .no_annotation()
}

fn resource_runtime(state: &AppState, uri: &str) -> Result<McpResourceReadRuntime, McpError> {
    let settings = state
        .settings()
        .load_settings(state.storage())
        .map_err(app_error_to_mcp_error)?;
    let mut runtime = McpResourceReadRuntime {
        custom_mcp: settings.ai.mcp.clone(),
        ..Default::default()
    };

    if uri == AI_AUDIT_SUMMARY_RESOURCE_URI {
        runtime.audit_records = state
            .ai_tools()
            .list_audits_with_request(state.storage(), None)
            .map_err(app_error_to_mcp_error)?;
    }

    if uri == AI_POLICY_RESOURCE_URI {
        runtime.ai_policy = Some(settings.ai);
    }

    Ok(runtime)
}

fn execution_context<'a>(state: &'a AppState) -> AiToolExecutionContext<'a> {
    AiToolExecutionContext {
        terminals: state.terminals(),
        command_history: state.command_history(),
        credentials: state.credentials(),
        settings: state.settings(),
        profiles: state.profiles(),
        remote_hosts: state.remote_hosts(),
        rig_providers: state.rig_providers(),
        server_info: state.server_info(),
        diagnostics: state.diagnostics(),
        sftp: state.sftp(),
        port_forwards: state.port_forwards(),
        snippets: state.snippets(),
        workflows: state.workflows(),
        ssh_commands: state.ssh_commands(),
        paths: state.paths(),
        storage: state.storage(),
    }
}

fn status_from_handle(handle: Option<&McpStreamableHttpServerHandle>) -> McpHttpServerStatus {
    match handle {
        Some(handle) => McpHttpServerStatus {
            running: true,
            endpoint: Some(handle.endpoint.clone()),
            bind_address: handle.bind_address.clone(),
            port: Some(handle.port),
            local_only: true,
        },
        None => McpHttpServerStatus {
            running: false,
            endpoint: None,
            bind_address: DEFAULT_BIND_ADDRESS.to_owned(),
            port: None,
            local_only: true,
        },
    }
}

fn normalize_bind_address(host: Option<&str>) -> AppResult<String> {
    match host.map(str::trim).filter(|host| !host.is_empty()) {
        None | Some("localhost") | Some(DEFAULT_BIND_ADDRESS) => {
            Ok(DEFAULT_BIND_ADDRESS.to_owned())
        }
        Some("::1") => Ok(DEFAULT_BIND_ADDRESS.to_owned()),
        Some(value) => Err(AppError::InvalidInput(format!(
            "Streamable HTTP MCP Server 只允许绑定本机 loopback 地址，当前请求: {value}"
        ))),
    }
}

fn audit_to_call_tool_result(audit: AiToolAuditRecord) -> CallToolResult {
    let value = json!({
        "status": audit.status,
        "approvedBy": "mcpHostHooks",
        "auditId": audit.id,
        "invocationId": audit.invocation_id,
        "toolId": audit.tool_id,
        "toolTitle": audit.tool_title,
        "risk": audit.risk,
        "confirmation": audit.confirmation,
        "argumentsSummary": audit.arguments_summary,
        "riskSummary": audit.risk_summary,
        "resultSummary": audit.result_summary,
        "error": audit.error,
        "createdAt": audit.created_at,
        "completedAt": audit.completed_at,
    });

    match audit.status {
        AiToolInvocationStatus::Succeeded => CallToolResult::structured(value),
        AiToolInvocationStatus::Rejected => CallToolResult::structured_error(value),
        AiToolInvocationStatus::Failed => CallToolResult::structured_error(value),
        AiToolInvocationStatus::Pending => CallToolResult::structured_error(value),
    }
}

fn prompt_message_to_rmcp(message: McpPromptMessage) -> PromptMessage {
    let role = match message.role.as_str() {
        "assistant" => PromptMessageRole::Assistant,
        _ => PromptMessageRole::User,
    };
    PromptMessage::new_text(role, message.text)
}

fn app_error_to_mcp_error(error: AppError) -> McpError {
    match error {
        AppError::InvalidInput(message) => McpError::invalid_params(message, None),
        AppError::NotFound(message) => McpError::invalid_params(message, None),
        other => McpError::internal_error(other.to_string(), None),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::models::tool_registry::{
        ToolAuditPolicy, ToolCategory, ToolConfirmationPolicy, ToolDefinition, ToolRiskLevel,
    };

    use super::{
        agent_skill_detail_resource_template, is_externally_callable_tool, normalize_bind_address,
        DEFAULT_BIND_ADDRESS,
    };

    fn tool(id: &str) -> ToolDefinition {
        ToolDefinition {
            id: id.to_owned(),
            title: id.to_owned(),
            description: id.to_owned(),
            category: ToolCategory::Terminal,
            risk: ToolRiskLevel::Read,
            confirmation: ToolConfirmationPolicy::Auto,
            audit: ToolAuditPolicy::Summary,
            enabled: true,
            exposed_to_mcp: true,
            input_schema: json!({"type": "object"}),
        }
    }

    #[test]
    fn filters_client_action_tools_from_external_mcp_surface() {
        assert!(!is_externally_callable_tool(&tool("terminal.create")));
        assert!(!is_externally_callable_tool(&tool("workspace.split_pane")));
        assert!(!is_externally_callable_tool(&tool("ssh.connect")));
        assert!(is_externally_callable_tool(&tool("terminal.list")));
    }

    #[test]
    fn only_accepts_loopback_bind_addresses() {
        assert_eq!(
            normalize_bind_address(None).unwrap(),
            DEFAULT_BIND_ADDRESS.to_owned()
        );
        assert_eq!(
            normalize_bind_address(Some("localhost")).unwrap(),
            DEFAULT_BIND_ADDRESS.to_owned()
        );
        assert!(normalize_bind_address(Some("0.0.0.0")).is_err());
    }

    #[test]
    fn exposes_skill_detail_resource_template() {
        let template = agent_skill_detail_resource_template();

        assert_eq!(template.uri_template, "kerminal://agent/skills/{skillId}");
        assert_eq!(template.name, "agent-skill-detail");
        assert_eq!(template.mime_type.as_deref(), Some("application/json"));
    }
}
