//! Kerminal Agent 对话服务。
//!
//! @author kongweiguang

use std::{
    collections::BTreeSet,
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use rig_core::{
    agent::{Agent, PromptHook},
    client::CompletionClient,
    completion::{CompletionModel, Prompt, ToolDefinition as RigToolDefinition},
    tool::{ToolDyn, ToolError},
    wasm_compat::WasmBoxedFuture,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        ai_agent::{AiApplicationContextRequest, AiChatRequest, AiChatResponse},
        ai_context::AiTerminalContextSnapshot,
        ai_tool_invocation::{AiToolPendingInvocation, AiToolPrepareRequest},
        llm_provider::{LlmContextStrategy, LlmProvider, LlmProviderKind},
        settings::{AiCommandApprovalPolicy, AiSecuritySettings, AppSettings},
        tool_registry::{
            McpAgentProfile, McpSkillDefinition, McpToolList, ToolConfirmationPolicy,
            ToolDefinition as RegistryToolDefinition, ToolRiskLevel,
        },
    },
    security::redaction::redact_terminal_text,
    services::{
        ai_context_service::AiContextService,
        ai_tool_invocation_service::AiToolInvocationService,
        credential_service::CredentialService,
        mcp_tool_gateway::{
            agent_profile, agent_skills_with_custom, agent_system_prompt,
            custom_mcp_tool_definitions, McpToolGateway,
        },
        rig_provider_service::{
            build_anthropic_client, build_openai_chat_client, build_openai_responses_client,
        },
        settings_service::SettingsService,
        terminal_manager::TerminalManager,
        tool_registry_service::ToolRegistryService,
    },
    storage::SqliteStore,
};

const MAX_PROVIDER_TOOL_NAME_LEN: usize = 64;
const DEFAULT_AGENT_MAX_TOKENS: u64 = 2048;
const MAX_LISTED_TOOLS: usize = 40;

/// AI Agent 对话依赖集合。
#[derive(Clone, Copy)]
pub struct AiAgentChatContext<'a> {
    /// SQLite 存储入口。
    pub storage: &'a SqliteStore,
    /// 本地凭据服务。
    pub credentials: &'a CredentialService,
    /// 终端上下文服务。
    pub ai_context: &'a AiContextService,
    /// AI 工具审批与审计服务。
    pub ai_tools: &'a AiToolInvocationService,
    /// 终端会话管理器。
    pub terminals: &'a TerminalManager,
    /// Kerminal 工具目录服务。
    pub tools: &'a ToolRegistryService,
    /// rmcp 工具网关。
    pub mcp_tools: &'a McpToolGateway,
    /// 应用设置服务。
    pub settings: &'a SettingsService,
}

/// 交给具体 LLM executor 的完整请求。
#[derive(Debug, Clone)]
pub struct AiChatExecutionRequest {
    /// 实际使用的 Provider 元数据。
    pub provider: LlmProvider,
    /// 从凭据仓库读取出的 API key，只在 executor 内使用。
    pub api_key: String,
    /// Kerminal Agent system prompt。
    pub preamble: String,
    /// Kerminal Agent static context，包含终端上下文、skills 和 rmcp 工具目录摘要。
    pub context: String,
    /// 用户输入 prompt。
    pub prompt: String,
    /// 本次暴露给 Rig 的 Kerminal 工具定义快照。
    pub tool_definitions: Vec<RegistryToolDefinition>,
    /// 本次对话使用的 AI 安全策略快照。
    pub ai_policy: AiSecuritySettings,
    /// AI 工具审批服务共享句柄。
    pub ai_tools: AiToolInvocationService,
}

/// Rig executor 返回的对话文本和标准工具调用副产物。
#[derive(Debug, Clone, PartialEq)]
pub struct AiChatExecutionResponse {
    /// 模型最终回复文本。
    pub message: String,
    /// 通过标准 tool-call 创建的待审批工具调用。
    pub pending_invocations: Vec<AiToolPendingInvocation>,
}

/// AI chat executor 抽象，生产实现使用 Rig，测试实现不访问网络。
pub trait AiChatExecutor: Send + Sync {
    /// 执行一次 LLM 对话。
    fn execute<'a>(
        &'a self,
        request: AiChatExecutionRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiChatExecutionResponse>> + Send + 'a>>;
}

/// AI Agent 服务，负责 Provider 选择、上下文收集、skills 路由、工具目录摘要和 Rig executor 调用。
#[derive(Clone)]
pub struct AiAgentService {
    executor: Arc<dyn AiChatExecutor>,
}

impl std::fmt::Debug for AiAgentService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AiAgentService")
            .field("executor", &"<dyn AiChatExecutor>")
            .finish()
    }
}

impl Default for AiAgentService {
    fn default() -> Self {
        Self::new()
    }
}

impl AiAgentService {
    /// 创建使用 Rig executor 的 AI Agent 服务。
    pub fn new() -> Self {
        Self {
            executor: Arc::new(RigAiChatExecutor),
        }
    }

    /// 使用指定 executor 创建服务，主要用于测试。
    pub fn with_executor(executor: Arc<dyn AiChatExecutor>) -> Self {
        Self { executor }
    }

    /// 执行一次 AI 对话。
    pub async fn chat(
        &self,
        context: AiAgentChatContext<'_>,
        request: AiChatRequest,
    ) -> AppResult<AiChatResponse> {
        let message = normalize_message(&request.message)?;
        let conversation_id = normalize_conversation_id(request.conversation_id.clone());
        let provider = select_provider(context.storage, request.provider_id.as_deref())?;
        let api_key = load_provider_api_key(context.credentials, &provider)?;
        let registry_tools = context.tools.list_tools();
        let app_settings = context.settings.load_settings(context.storage)?;
        let mcp_tools = context
            .mcp_tools
            .list_tools_with_custom(&registry_tools, &app_settings.ai.mcp);
        let mut execution_tools = registry_tools.clone();
        execution_tools.extend(custom_mcp_tool_definitions(&app_settings.ai.mcp));
        let terminal_snapshot = terminal_snapshot_for_request(context, &provider, &request)?;
        let agent_context = build_agent_context(
            terminal_snapshot.as_ref(),
            request.application_context.as_ref(),
            request.execution_visibility.unwrap_or_default(),
            &app_settings,
            &mcp_tools,
        );
        let execution_request = AiChatExecutionRequest {
            provider: provider.clone(),
            api_key,
            preamble: agent_preamble(),
            context: agent_context,
            prompt: message,
            tool_definitions: execution_tools,
            ai_policy: app_settings.ai.clone(),
            ai_tools: context.ai_tools.clone(),
        };
        let execution = self.executor.execute(execution_request).await?;
        let (message, response_redacted) = redact_terminal_text(&execution.message);

        Ok(AiChatResponse {
            conversation_id,
            provider_id: provider.id,
            provider_name: provider.name,
            model: provider.model,
            message,
            pending_invocations: execution.pending_invocations,
            response_redacted,
            context_used: terminal_snapshot.is_some(),
            tool_count: mcp_tools.tools.len(),
            generated_at: current_unix_timestamp(),
        })
    }
}

#[derive(Debug, Default)]
struct RigAiChatExecutor;

impl AiChatExecutor for RigAiChatExecutor {
    fn execute<'a>(
        &'a self,
        request: AiChatExecutionRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiChatExecutionResponse>> + Send + 'a>> {
        Box::pin(async move {
            match request.provider.kind {
                LlmProviderKind::OpenAiResponses => execute_openai_responses_chat(request).await,
                LlmProviderKind::OpenAiChat => execute_openai_chat_completions(request).await,
                LlmProviderKind::Anthropic => execute_anthropic_chat(request).await,
            }
        })
    }
}

async fn execute_openai_responses_chat(
    request: AiChatExecutionRequest,
) -> AppResult<AiChatExecutionResponse> {
    let client = build_openai_responses_client(&request.provider, &request.api_key)?;
    let pending_collector = PendingToolInvocationCollector::default();
    let tools = approval_tools(&request, pending_collector.clone());
    let agent = client
        .agent(request.provider.model.clone())
        .preamble(&request.preamble)
        .context(&request.context)
        .temperature(request.provider.temperature)
        .max_tokens(DEFAULT_AGENT_MAX_TOKENS)
        .tools(tools)
        .build();
    prompt_with_retries(
        agent,
        request.prompt,
        request.provider.max_retries,
        pending_collector,
    )
    .await
}

async fn execute_openai_chat_completions(
    request: AiChatExecutionRequest,
) -> AppResult<AiChatExecutionResponse> {
    let client = build_openai_chat_client(&request.provider, &request.api_key)?;
    let pending_collector = PendingToolInvocationCollector::default();
    let tools = approval_tools(&request, pending_collector.clone());
    let agent = client
        .agent(request.provider.model.clone())
        .preamble(&request.preamble)
        .context(&request.context)
        .temperature(request.provider.temperature)
        .max_tokens(DEFAULT_AGENT_MAX_TOKENS)
        .tools(tools)
        .build();
    prompt_with_retries(
        agent,
        request.prompt,
        request.provider.max_retries,
        pending_collector,
    )
    .await
}

async fn execute_anthropic_chat(
    request: AiChatExecutionRequest,
) -> AppResult<AiChatExecutionResponse> {
    let client = build_anthropic_client(&request.provider, &request.api_key)?;
    let pending_collector = PendingToolInvocationCollector::default();
    let tools = approval_tools(&request, pending_collector.clone());
    let agent = client
        .agent(request.provider.model.clone())
        .preamble(&request.preamble)
        .context(&request.context)
        .temperature(request.provider.temperature)
        .max_tokens(DEFAULT_AGENT_MAX_TOKENS)
        .tools(tools)
        .build();
    prompt_with_retries(
        agent,
        request.prompt,
        request.provider.max_retries,
        pending_collector,
    )
    .await
}

async fn prompt_with_retries<M, P>(
    agent: Agent<M, P>,
    prompt: String,
    max_retries: u8,
    pending_collector: PendingToolInvocationCollector,
) -> AppResult<AiChatExecutionResponse>
where
    M: CompletionModel + 'static,
    P: PromptHook<M> + 'static,
{
    let max_attempts = usize::from(max_retries) + 1;
    let mut last_error = None;
    for _attempt in 0..max_attempts {
        match agent.prompt(prompt.clone()).max_turns(2).await {
            Ok(message) => {
                return Ok(AiChatExecutionResponse {
                    message,
                    pending_invocations: pending_collector.items()?,
                });
            }
            Err(error) => {
                last_error = Some(error.to_string());
            }
        }
    }

    Err(AppError::AiAgent(format!(
        "Kerminal Agent 对话失败: {}",
        last_error.unwrap_or_else(|| "未知错误".to_string())
    )))
}

#[derive(Debug, Clone, Default)]
struct PendingToolInvocationCollector {
    inner: Arc<Mutex<Vec<AiToolPendingInvocation>>>,
}

impl PendingToolInvocationCollector {
    fn push(&self, invocation: AiToolPendingInvocation) -> AppResult<()> {
        self.inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ai_tool_call_collector"))?
            .push(invocation);
        Ok(())
    }

    fn items(&self) -> AppResult<Vec<AiToolPendingInvocation>> {
        self.inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ai_tool_call_collector"))
            .map(|items| items.clone())
    }
}

#[derive(Debug, Clone)]
struct KerminalApprovalTool {
    definition: RegistryToolDefinition,
    model_tool_name: String,
    ai_policy: AiSecuritySettings,
    ai_tools: AiToolInvocationService,
    pending_collector: PendingToolInvocationCollector,
}

impl ToolDyn for KerminalApprovalTool {
    fn name(&self) -> String {
        self.model_tool_name.clone()
    }

    fn definition<'a>(&'a self, _prompt: String) -> WasmBoxedFuture<'a, RigToolDefinition> {
        Box::pin(async move {
            RigToolDefinition {
                name: self.model_tool_name.clone(),
                description: tool_description(&self.definition),
                parameters: self.definition.input_schema.clone(),
            }
        })
    }

    fn call<'a>(&'a self, args: String) -> WasmBoxedFuture<'a, Result<String, ToolError>> {
        Box::pin(async move {
            let arguments = parse_tool_arguments(&args).map_err(ToolError::JsonError)?;
            let pending = self
                .ai_tools
                .prepare_with_ai_policy(
                    std::slice::from_ref(&self.definition),
                    &self.ai_policy,
                    AiToolPrepareRequest {
                        tool_id: self.definition.id.clone(),
                        arguments,
                        requested_by: Some("kerminal-agent".to_owned()),
                        reason: Some(format!(
                            "Kerminal Agent 通过标准工具调用请求执行 {}。",
                            self.definition.title
                        )),
                    },
                )
                .map_err(|error| ToolError::ToolCallError(Box::new(error)))?;
            self.pending_collector
                .push(pending.clone())
                .map_err(|error| ToolError::ToolCallError(Box::new(error)))?;
            serde_json::to_string(&json!({
                "status": "pending_approval",
                "invocationId": pending.id,
                "toolId": pending.tool_id,
                "toolTitle": pending.tool_title,
                "requiresConfirmation": pending.requires_confirmation,
                "message": "Kerminal 已创建待审批工具调用。该工具尚未执行，必须等待用户在确认面板批准或拒绝。"
            }))
            .map_err(ToolError::JsonError)
        })
    }
}

fn approval_tools(
    request: &AiChatExecutionRequest,
    pending_collector: PendingToolInvocationCollector,
) -> Vec<Box<dyn ToolDyn>> {
    request
        .tool_definitions
        .iter()
        .filter(|tool| tool.enabled && tool.exposed_to_mcp)
        .cloned()
        .map(|definition| {
            let model_tool_name = provider_safe_tool_name(&definition.id);
            Box::new(KerminalApprovalTool {
                model_tool_name,
                definition,
                ai_policy: request.ai_policy.clone(),
                ai_tools: request.ai_tools.clone(),
                pending_collector: pending_collector.clone(),
            }) as Box<dyn ToolDyn>
        })
        .collect()
}

fn provider_safe_tool_name(tool_id: &str) -> String {
    let mut safe = tool_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if safe.is_empty() {
        safe.push_str("tool");
    }
    if safe == tool_id && safe.len() <= MAX_PROVIDER_TOOL_NAME_LEN {
        return safe;
    }

    let suffix = format!("_{:016x}", stable_tool_name_hash(tool_id));
    let max_prefix_len = MAX_PROVIDER_TOOL_NAME_LEN.saturating_sub(suffix.len());
    if safe.len() > max_prefix_len {
        safe.truncate(max_prefix_len);
    }
    safe.push_str(&suffix);
    safe
}

fn stable_tool_name_hash(tool_id: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in tool_id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn tool_description(tool: &RegistryToolDefinition) -> String {
    format!(
        "{}\n\nKerminal internal tool id: {}.\n\nKerminal host-side approval: calling this tool only creates a pending invocation. It does not execute until the user approves it in Kerminal. Risk: {}; confirmation: {}.",
        tool.description,
        tool.id.as_str(),
        risk_label(tool.risk),
        confirmation_label(tool.confirmation),
    )
}

fn parse_tool_arguments(args: &str) -> serde_json::Result<Value> {
    if args.trim().is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    match serde_json::from_str(args)? {
        Value::Null => Ok(Value::Object(serde_json::Map::new())),
        value => Ok(value),
    }
}

fn normalize_message(message: &str) -> AppResult<String> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::InvalidInput(
            "请输入要发送给 AI 的内容".to_string(),
        ));
    }
    if message.len() > 12 * 1024 {
        return Err(AppError::InvalidInput(
            "AI 对话内容不能超过 12 KB".to_string(),
        ));
    }
    Ok(message.to_string())
}

fn select_provider(storage: &SqliteStore, provider_id: Option<&str>) -> AppResult<LlmProvider> {
    if let Some(provider_id) = provider_id.map(str::trim).filter(|value| !value.is_empty()) {
        let provider = storage
            .llm_provider_by_id(provider_id)?
            .ok_or_else(|| AppError::NotFound(format!("LLM Provider 不存在: {provider_id}")))?;
        if !provider.enabled {
            return Err(AppError::InvalidInput(format!(
                "LLM Provider 已停用: {}",
                provider.name
            )));
        }
        return Ok(provider);
    }

    let providers = storage.list_llm_providers()?;
    providers
        .iter()
        .find(|provider| provider.enabled && provider.is_default)
        .cloned()
        .or_else(|| providers.into_iter().find(|provider| provider.enabled))
        .ok_or_else(|| AppError::InvalidInput("请先在设置里配置并启用 LLM Provider".to_string()))
}

fn load_provider_api_key(
    credentials: &CredentialService,
    provider: &LlmProvider,
) -> AppResult<String> {
    let credential_ref = provider
        .api_key_credential_ref
        .as_deref()
        .ok_or_else(|| AppError::InvalidInput("API key 未配置".to_string()))?;
    credentials
        .get_secret(credential_ref)?
        .ok_or_else(|| AppError::InvalidInput("API key 未配置".to_string()))
}

fn terminal_snapshot_for_request(
    context: AiAgentChatContext<'_>,
    provider: &LlmProvider,
    request: &AiChatRequest,
) -> AppResult<Option<AiTerminalContextSnapshot>> {
    if provider.context_strategy == LlmContextStrategy::Minimal {
        return Ok(None);
    }
    request
        .terminal_context
        .clone()
        .map(|terminal_context| {
            context
                .ai_context
                .terminal_context_snapshot(context.terminals, terminal_context)
        })
        .transpose()
}

fn build_agent_context(
    terminal_snapshot: Option<&AiTerminalContextSnapshot>,
    application_context: Option<&AiApplicationContextRequest>,
    execution_visibility: crate::models::ai_agent::AiCommandExecutionVisibility,
    app_settings: &AppSettings,
    mcp_tools: &McpToolList,
) -> String {
    let mut sections = Vec::new();
    let profile = agent_profile();
    let skills = agent_skills_with_custom(&app_settings.ai.mcp);
    sections.push(format_agent_profile_context(&profile));
    sections.push(format_application_context(
        application_context,
        execution_visibility,
        app_settings,
        mcp_tools,
    ));
    sections.push(format_agent_skill_context(&skills, mcp_tools));
    if let Some(snapshot) = terminal_snapshot {
        sections.push(format_terminal_context(snapshot));
    } else {
        sections.push("当前终端上下文：本次没有提供 terminal session 快照。".to_string());
    }
    sections.push(format_mcp_tool_context(mcp_tools));
    sections.join("\n\n")
}

fn format_application_context(
    application_context: Option<&AiApplicationContextRequest>,
    execution_visibility: crate::models::ai_agent::AiCommandExecutionVisibility,
    app_settings: &AppSettings,
    mcp_tools: &McpToolList,
) -> String {
    let mut lines = vec![
        "当前应用上下文：Kerminal Agent 是当前 Kerminal 应用的操作层；应用上下文是感知，MCP 工具是可受控调用的手脚。".to_owned(),
        format!(
            "- 工具暴露：当前 MCP 工具 {} 个，所有可操作能力必须从该工具目录中选择。",
            mcp_tools.tools.len()
        ),
        format!(
            "- 用户自定义 MCP：{} 个 server、{} 个已发现 tool、{} 个 skills 文件夹已配置；外部 MCP 工具必须来自 server discovery，不能手工发明。",
            app_settings.ai.mcp.servers.len(),
            app_settings
                .ai
                .mcp
                .servers
                .iter()
                .map(|server| server.tools.len())
                .sum::<usize>(),
            app_settings.ai.mcp.skill_directories.len(),
        ),
        format!(
            "- AI 安全策略：执行模式 {}；远程确认 {}；破坏性工具 {}；上下文上限 {} bytes；命令超时 {} 秒。",
            approval_policy_label(&app_settings.ai.command_approval_policy),
            if app_settings.ai.require_remote_approval {
                "开启"
            } else {
                "关闭"
            },
            if app_settings.ai.allow_destructive_tools {
                "允许进入确认链"
            } else {
                "默认关闭"
            },
            app_settings.ai.context_max_output_bytes,
            app_settings.ai.command_timeout_seconds,
        ),
        format_command_visibility_context(execution_visibility, application_context),
        format!(
            "- UI 设置：主题 {:?}；界面密度 {:?}；终端字体 {} {}px；SFTP 并发 {}/{}。",
            app_settings.theme_mode,
            app_settings.interface_density,
            app_settings.terminal.font_family,
            app_settings.terminal.font_size,
            app_settings.sftp.host_transfers,
            app_settings.sftp.global_transfers,
        ),
    ];

    if let Some(custom_instructions) = (!app_settings.ai.custom_instructions.trim().is_empty())
        .then(|| app_settings.ai.custom_instructions.trim())
    {
        lines.push(format!("- 用户自定义 AI 指令：{custom_instructions}"));
    }

    if let Some(context) = application_context {
        lines.push(format!(
            "- 当前右侧工具：{}",
            context.active_tool_id.as_deref().unwrap_or("ai")
        ));
        if let Some(tab) = context.active_tab.as_ref() {
            lines.push(format!(
                "- 当前 tab：{} ({})，主机 {}",
                tab.title,
                tab.id,
                tab.machine_id.as_deref().unwrap_or("-")
            ));
        }
        if let Some(pane) = context.focused_pane.as_ref() {
            lines.push(format!(
                "- 当前 pane：{} ({})，mode {}，status {}，session {}，主机 {}",
                pane.title,
                pane.id,
                pane.mode,
                pane.status,
                pane.session_id.as_deref().unwrap_or("-"),
                pane.machine_id.as_deref().unwrap_or("-")
            ));
        }
        if let Some(machine) = context.selected_machine.as_ref() {
            lines.push(format!(
                "- 当前主机：{} ({})，kind {}，status {}，production {}",
                machine.name,
                machine.id,
                machine.kind,
                machine.status,
                match machine.production {
                    Some(true) => "是",
                    Some(false) => "否",
                    None => "-",
                }
            ));
        }
    } else {
        lines.push(
            "- 前端工作台状态：本次没有提供 active tab、focused pane 和选中主机摘要。".to_owned(),
        );
    }

    lines.join("\n")
}

fn format_command_visibility_context(
    execution_visibility: crate::models::ai_agent::AiCommandExecutionVisibility,
    application_context: Option<&AiApplicationContextRequest>,
) -> String {
    match execution_visibility {
        crate::models::ai_agent::AiCommandExecutionVisibility::Terminal => {
            let session_id = application_context
                .and_then(|context| context.focused_pane.as_ref())
                .and_then(|pane| pane.session_id.as_deref())
                .unwrap_or("-");
            format!(
                "- AI 命令显示模式：显示在当前终端。需要执行本地或当前会话命令时，优先使用 `terminal.write` 把完整命令和回车写入当前 focused pane 的 session `{session_id}`，让用户在终端里看到命令和随后输出；不要用后台非交互工具替代可见终端执行，除非没有可用 session 或用户明确要求后台运行。"
            )
        }
        crate::models::ai_agent::AiCommandExecutionVisibility::Background => {
            "- AI 命令显示模式：后台运行。可以使用非交互后台工具执行，但必须在回复和待确认工具卡片中说明将执行的命令；不要声称命令会出现在终端，结果以 AI 工具审计和回复摘要为准。".to_owned()
        }
    }
}

fn format_agent_profile_context(profile: &McpAgentProfile) -> String {
    let capabilities = profile
        .capabilities
        .iter()
        .map(|capability| {
            let tools = capability
                .tool_examples
                .iter()
                .map(|tool| provider_safe_tool_reference(tool))
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "- {title}：{description}；代表工具 {tools}",
                title = capability.title,
                description = capability.description,
                tools = tools,
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let rules = profile
        .operating_rules
        .iter()
        .map(|rule| format!("- {rule}"))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "\
Agent 身份：
- id: {id}
- name: {name}
- role: {role}
- description: {description}
- tool call protocol: {tool_call_protocol}

Agent 能力：
{capabilities}

Agent 行为规则：
{rules}",
        id = profile.id,
        name = profile.name,
        role = profile.role,
        description = profile.description,
        tool_call_protocol = profile.tool_call_protocol,
    )
}

fn format_agent_skill_context(skills: &[McpSkillDefinition], mcp_tools: &McpToolList) -> String {
    let exposed_tool_ids = mcp_tools
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<BTreeSet<_>>();
    let lines = skills
        .iter()
        .map(|skill| {
            let available_tools = skill
                .tool_ids
                .iter()
                .filter(|tool_id| exposed_tool_ids.contains(tool_id.as_str()))
                .map(|tool_id| provider_safe_tool_reference(tool_id))
                .collect::<Vec<_>>();
            format!(
                "- {id} / {title} [{origin}]：{when}\n  guidance: {guidance}\n  tools: {tools}",
                id = skill.id,
                title = skill.title,
                origin = skill_origin_label(skill.origin),
                when = skill.when_to_use,
                guidance = skill.prompt_guidance,
                tools = if available_tools.is_empty() {
                    "-".to_owned()
                } else {
                    available_tools.join(", ")
                }
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "Agent Skills 路由：共 {} 个 skill。请先选择 skill，再选择 MCP 工具。\n{}",
        skills.len(),
        lines
    )
}

fn format_terminal_context(snapshot: &AiTerminalContextSnapshot) -> String {
    format!(
        "\
当前终端上下文：
- session: {session_id}
- shell: {shell}
- cwd: {cwd}
- pane: {pane}
- tab: {tab}
- host: {machine}
- 最近输出是否脱敏: {redacted}
- 最近输出：
{output}",
        session_id = snapshot.session.id,
        shell = snapshot.session.shell,
        cwd = snapshot.session.cwd.as_deref().unwrap_or("-"),
        pane = snapshot.source.pane_title.as_deref().unwrap_or("-"),
        tab = snapshot.source.tab_title.as_deref().unwrap_or("-"),
        machine = snapshot.source.machine_name.as_deref().unwrap_or("-"),
        redacted = if snapshot.redacted { "是" } else { "否" },
        output = snapshot.output.data,
    )
}

fn format_mcp_tool_context(mcp_tools: &McpToolList) -> String {
    let mut lines = vec![format!(
        "rmcp 工具目录：协议 {}，共 {} 个工具。需要操作时请使用标准 tool-call；Kerminal 会先创建待审批调用，确认前不得声称已经执行。",
        mcp_tools.protocol,
        mcp_tools.tools.len()
    )];
    let mut tools = mcp_tools.tools.iter().collect::<Vec<_>>();
    tools.sort_by_key(|tool| match tool.origin {
        crate::models::tool_registry::McpDefinitionOrigin::Custom => 0,
        crate::models::tool_registry::McpDefinitionOrigin::System => 1,
    });
    for tool in tools.iter().take(MAX_LISTED_TOOLS) {
        lines.push(format!(
            "- {name}：{title}；Kerminal id {source_tool_id}；风险 {risk}；确认策略 {confirmation}",
            name = provider_safe_tool_name(&tool.name),
            title = tool.title.as_deref().unwrap_or("-"),
            source_tool_id = tool.name.as_str(),
            risk = risk_label(tool.risk),
            confirmation = confirmation_label(tool.confirmation),
        ));
    }
    if tools.len() > MAX_LISTED_TOOLS {
        lines.push(format!(
            "- 其余 {} 个工具已省略。",
            tools.len() - MAX_LISTED_TOOLS
        ));
    }
    lines.join("\n")
}

fn provider_safe_tool_reference(tool_id: &str) -> String {
    let name = provider_safe_tool_name(tool_id);
    if name == tool_id {
        name
    } else {
        format!("{name} (Kerminal id {tool_id})")
    }
}

fn agent_preamble() -> String {
    agent_system_prompt()
}

fn normalize_conversation_id(conversation_id: Option<String>) -> String {
    conversation_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("chat-{}", Uuid::new_v4()))
}

fn risk_label(risk: ToolRiskLevel) -> &'static str {
    match risk {
        ToolRiskLevel::Read => "读取",
        ToolRiskLevel::Write => "写入",
        ToolRiskLevel::Remote => "远程",
        ToolRiskLevel::Batch => "批量",
        ToolRiskLevel::Destructive => "破坏性",
    }
}

fn confirmation_label(confirmation: ToolConfirmationPolicy) -> &'static str {
    match confirmation {
        ToolConfirmationPolicy::Auto => "可自动执行",
        ToolConfirmationPolicy::Contextual => "按上下文确认",
        ToolConfirmationPolicy::Always => "每次确认",
    }
}

fn skill_origin_label(origin: crate::models::tool_registry::McpDefinitionOrigin) -> &'static str {
    match origin {
        crate::models::tool_registry::McpDefinitionOrigin::System => "system",
        crate::models::tool_registry::McpDefinitionOrigin::Custom => "custom",
    }
}

fn approval_policy_label(policy: &AiCommandApprovalPolicy) -> &'static str {
    match policy {
        AiCommandApprovalPolicy::Always => "每次确认",
        AiCommandApprovalPolicy::Risky => "高风险确认",
        AiCommandApprovalPolicy::Relaxed => "放开模式",
    }
}

fn current_unix_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::tool_registry::{ToolAuditPolicy, ToolCategory};

    fn registry_tool(id: &str) -> RegistryToolDefinition {
        RegistryToolDefinition {
            id: id.to_owned(),
            title: "读取服务器配置".to_owned(),
            description: "读取当前服务器配置摘要。".to_owned(),
            category: ToolCategory::ServerInfo,
            risk: ToolRiskLevel::Read,
            confirmation: ToolConfirmationPolicy::Auto,
            audit: ToolAuditPolicy::Summary,
            enabled: true,
            exposed_to_mcp: true,
            input_schema: json!({ "type": "object" }),
        }
    }

    #[test]
    fn provider_safe_tool_name_rewrites_internal_dot_ids() {
        let name = provider_safe_tool_name("server_info.snapshot");

        assert_ne!(name, "server_info.snapshot");
        assert!(name.starts_with("server_info_snapshot_"));
        assert!(name.len() <= MAX_PROVIDER_TOOL_NAME_LEN);
        assert!(name
            .chars()
            .all(|character| character.is_ascii_alphanumeric()
                || character == '_'
                || character == '-'));
    }

    #[test]
    fn provider_safe_tool_name_adds_hash_when_safe_name_would_collide() {
        let dotted = provider_safe_tool_name("settings.get");
        let underscored = provider_safe_tool_name("settings_get");

        assert_ne!(dotted, underscored);
        assert!(dotted.starts_with("settings_get_"));
        assert_eq!(underscored, "settings_get");
    }

    #[test]
    fn approval_tool_uses_provider_name_and_preserves_kerminal_id() {
        let definition = registry_tool("server_info.snapshot");
        let model_tool_name = provider_safe_tool_name(&definition.id);
        let tool = KerminalApprovalTool {
            definition,
            model_tool_name: model_tool_name.clone(),
            ai_policy: AiSecuritySettings::legacy_tool_policy(),
            ai_tools: AiToolInvocationService::new(),
            pending_collector: PendingToolInvocationCollector::default(),
        };

        let rig_definition = tauri::async_runtime::block_on(tool.definition(String::new()));

        assert_eq!(tool.name(), model_tool_name);
        assert_eq!(rig_definition.name, model_tool_name);
        assert!(rig_definition
            .description
            .contains("Kerminal internal tool id: server_info.snapshot"));
    }

    #[test]
    fn approval_tool_call_creates_pending_invocation_for_original_tool_id() {
        let definition = registry_tool("server_info.snapshot");
        let tool = KerminalApprovalTool {
            model_tool_name: provider_safe_tool_name(&definition.id),
            definition,
            ai_policy: AiSecuritySettings::legacy_tool_policy(),
            ai_tools: AiToolInvocationService::new(),
            pending_collector: PendingToolInvocationCollector::default(),
        };

        let payload = tauri::async_runtime::block_on(tool.call("{}".to_owned()))
            .expect("tool call should prepare pending invocation");
        let payload: Value = serde_json::from_str(&payload).expect("tool call payload json");

        assert_eq!(payload["status"], "pending_approval");
        assert_eq!(payload["toolId"], "server_info.snapshot");
        assert_eq!(payload["toolTitle"], "读取服务器配置");
        let pending = tool.pending_collector.items().expect("pending invocations");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].tool_id, "server_info.snapshot");
    }
}
