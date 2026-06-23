//! Kerminal Agent 对话服务。
//!
//! @author kongweiguang

use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use rig_core::{
    agent::{Agent, PromptHook},
    client::CompletionClient,
    completion::{message::Message, CompletionModel, Prompt, ToolDefinition as RigToolDefinition},
    tool::{ToolDyn, ToolError},
    wasm_compat::WasmBoxedFuture,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        ai_agent::{AiChatRequest, AiChatResponse},
        ai_context::AiTerminalContextSnapshot,
        ai_tool_invocation::{AiToolPendingInvocation, AiToolPrepareRequest},
        llm_provider::{LlmProvider, LlmProviderKind},
        settings::AiSecuritySettings,
        tool_registry::ToolDefinition as RegistryToolDefinition,
    },
    paths::KerminalPaths,
    security::redaction::redact_terminal_text,
    services::{
        ai_agent_context::{
            build_agent_context, confirmation_label, provider_safe_tool_name, risk_label,
        },
        ai_context_service::AiContextService,
        ai_tool_invocation_service::AiToolInvocationService,
        credential_service::CredentialService,
        mcp_tool_gateway::{agent_system_prompt, custom_mcp_tool_definitions, McpToolGateway},
        rig_provider_service::{
            build_anthropic_client, build_openai_chat_client, build_openai_responses_client,
        },
        settings_service::SettingsService,
        terminal_manager::TerminalManager,
        terminal_session_binding_service::TerminalSessionBindingService,
        tool_registry_service::ToolRegistryService,
    },
    storage::SqliteStore,
};

mod vision;

pub use vision::AiChatVisionInput;
use vision::{build_prompt_message, resolve_chat_vision_usage};

const DEFAULT_AGENT_MAX_TOKENS: u64 = 2048;
const DEFAULT_AGENT_MAX_TURNS: usize = 6;

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
    /// 终端 pane/session 可信绑定旁路注册表。
    pub terminal_session_bindings: &'a TerminalSessionBindingService,
    /// Kerminal 工具目录服务。
    pub tools: &'a ToolRegistryService,
    /// rmcp 工具网关。
    pub mcp_tools: &'a McpToolGateway,
    /// 应用设置服务。
    pub settings: &'a SettingsService,
    /// Kerminal 本地数据目录，用于解析已持久化的受管附件。
    pub paths: &'a KerminalPaths,
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
    /// 当前 AI 会话 id，用于标准工具调用 pending 归属。
    pub conversation_id: String,
    /// 当前 AI 面板路由 slot 描述 JSON，用于标准工具调用 pending 归属。
    pub conversation_slot_json: Option<String>,
    /// 本次真正发送给 Provider 的图片字节输入。
    pub vision_inputs: Vec<AiChatVisionInput>,
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

    /// 判断 Provider 当前 model 是否可以尝试图片输入。
    pub fn provider_supports_vision(provider: &LlmProvider) -> bool {
        vision::provider_supports_vision(provider)
    }

    /// 执行一次 AI 对话。
    pub async fn chat(
        &self,
        context: AiAgentChatContext<'_>,
        request: AiChatRequest,
    ) -> AppResult<AiChatResponse> {
        let message = normalize_message(&request.message)?;
        let conversation_id = normalize_conversation_id(request.conversation_id.clone());
        let conversation_slot_json =
            normalize_optional_text(request.conversation_slot_json.clone());
        let provider = select_provider(context.storage, request.provider_id.as_deref())?;
        let api_key = load_provider_api_key(context.credentials, &provider)?;
        let (resolved_attachments, vision_usage, vision_inputs) = resolve_chat_vision_usage(
            context.storage,
            context.paths,
            &conversation_id,
            &request.attachments,
            &provider,
        )?;
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
            &resolved_attachments,
            &vision_usage,
            request.execution_visibility.unwrap_or_default(),
            &app_settings,
            &mcp_tools,
        );
        let execution_request = AiChatExecutionRequest {
            provider: provider.clone(),
            api_key,
            preamble: agent_preamble(),
            context: agent_context,
            prompt: build_chat_prompt(&request.history, &message),
            conversation_id: conversation_id.clone(),
            conversation_slot_json,
            vision_inputs,
            tool_definitions: execution_tools,
            ai_policy: app_settings.ai.clone(),
            ai_tools: context.ai_tools.clone(),
        };
        let execution = self.executor.execute(execution_request).await?;
        for pending in &execution.pending_invocations {
            if let Err(error) = context
                .ai_tools
                .persist_pending_invocation(context.storage, &pending.id)
            {
                if !matches!(error, AppError::NotFound(_)) {
                    return Err(error);
                }
            }
        }
        let guarded_message = guard_unverified_chat_success_claim(
            &message,
            &execution.message,
            execution.pending_invocations.len(),
        );
        let (message, response_redacted) = redact_terminal_text(&guarded_message);

        Ok(AiChatResponse {
            conversation_id,
            provider_id: provider.id,
            provider_name: provider.name,
            model: provider.model,
            message,
            pending_invocations: execution.pending_invocations,
            response_redacted,
            context_used: terminal_snapshot.is_some() || !resolved_attachments.is_empty(),
            tool_count: mcp_tools.tools.len(),
            generated_at: current_unix_timestamp(),
            vision_usage,
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
        build_prompt_message(&request)?,
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
        build_prompt_message(&request)?,
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
        build_prompt_message(&request)?,
        request.provider.max_retries,
        pending_collector,
    )
    .await
}

async fn prompt_with_retries<M, P>(
    agent: Agent<M, P>,
    prompt: Message,
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
        match agent
            .prompt(prompt.clone())
            .max_turns(DEFAULT_AGENT_MAX_TURNS)
            .await
        {
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
    conversation_id: String,
    conversation_slot_json: Option<String>,
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
                        conversation_id: Some(self.conversation_id.clone()),
                        conversation_slot_json: self.conversation_slot_json.clone(),
                        run_id: None,
                        step_id: None,
                    },
                )
                .map_err(|error| ToolError::ToolCallError(Box::new(error)))?;
            self.pending_collector
                .push(pending.clone())
                .map_err(|error| ToolError::ToolCallError(Box::new(error)))?;
            let (status, message) = if pending.requires_confirmation {
                (
                    "pending_approval",
                    "Kerminal 已创建待审批工具调用。该工具尚未执行，必须等待用户在确认面板批准或拒绝。",
                )
            } else {
                (
                    "auto_approved",
                    "Kerminal 已按当前权限策略创建可自动执行的工具调用，无需用户手动确认。",
                )
            };
            serde_json::to_string(&json!({
                "status": status,
                "invocationId": pending.id,
                "toolId": pending.tool_id,
                "toolTitle": pending.tool_title,
                "requiresConfirmation": pending.requires_confirmation,
                "message": message
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
                conversation_id: request.conversation_id.clone(),
                conversation_slot_json: request.conversation_slot_json.clone(),
                ai_policy: request.ai_policy.clone(),
                ai_tools: request.ai_tools.clone(),
                pending_collector: pending_collector.clone(),
            }) as Box<dyn ToolDyn>
        })
        .collect()
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

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

fn guard_unverified_chat_success_claim(
    goal: &str,
    response: &str,
    pending_invocation_count: usize,
) -> String {
    if !chat_goal_requires_action(goal)
        || !chat_response_claims_action_completed(response)
        || chat_response_acknowledges_not_executed(response)
    {
        return response.to_owned();
    }

    if pending_invocation_count > 0 {
        return "我已创建待确认工具调用，但该操作尚未执行；请先在确认面板批准或拒绝，完成后我会基于工具结果继续。"
            .to_owned();
    }

    "我不能在没有工具调用结果的情况下宣称已经完成这个操作；请先让我调用合适的 Kerminal 工具并等待执行结果。"
        .to_owned()
}

fn chat_goal_requires_action(goal: &str) -> bool {
    let goal = goal.trim().to_lowercase();
    if goal.is_empty() || chat_goal_is_informational(&goal) {
        return false;
    }
    [
        "把",
        "放到",
        "加入",
        "归入",
        "移到",
        "移入",
        "添加",
        "创建",
        "新建",
        "更新",
        "修改",
        "删除",
        "连接",
        "打开",
        "执行",
        "运行",
        "写入",
        "保存",
        "上传",
        "下载",
        "重命名",
        "add ",
        "create ",
        "move ",
        "update ",
        "modify ",
        "delete ",
        "connect ",
        "open ",
        "run ",
        "execute ",
        "write ",
        "save ",
        "upload ",
        "download ",
        "rename ",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn chat_goal_is_informational(goal: &str) -> bool {
    [
        "怎么",
        "如何",
        "怎样",
        "为什么",
        "说明",
        "解释",
        "教程",
        "给我方案",
        "帮我想",
        "what ",
        "why ",
        "how ",
        "explain",
        "show me how",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn chat_response_claims_action_completed(response: &str) -> bool {
    let response = response.trim().to_lowercase();
    [
        "已将",
        "已经",
        "已创建",
        "已添加",
        "已加入",
        "已归入",
        "已放到",
        "已移动",
        "已连接",
        "已打开",
        "已执行",
        "已运行",
        "已写入",
        "已保存",
        "已上传",
        "已下载",
        "已删除",
        "完成",
        "成功",
        "done",
        "completed",
        "successfully",
    ]
    .iter()
    .any(|keyword| response.contains(keyword))
}

fn chat_response_acknowledges_not_executed(response: &str) -> bool {
    let response = response.trim().to_lowercase();
    [
        "尚未执行",
        "未执行",
        "待确认",
        "待审批",
        "等待批准",
        "needs approval",
    ]
    .iter()
    .any(|keyword| response.contains(keyword))
}

pub(crate) fn select_provider(
    storage: &SqliteStore,
    provider_id: Option<&str>,
) -> AppResult<LlmProvider> {
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

pub(crate) fn load_provider_api_key(
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
    context.ai_context.terminal_context_snapshot_for_chat(
        context.terminals,
        Some(context.terminal_session_bindings),
        provider,
        request.terminal_context.clone(),
    )
}

fn build_chat_prompt(
    history: &[crate::models::ai_agent::AiChatHistoryMessage],
    message: &str,
) -> String {
    let transcript = history
        .iter()
        .filter_map(format_history_message)
        .collect::<Vec<_>>()
        .join("\n\n");
    if transcript.is_empty() {
        return message.to_owned();
    }

    [
        "请基于以下会话历史继续回答。不要重复历史内容，优先处理最后一个用户问题。",
        "",
        "<history>",
        transcript.as_str(),
        "</history>",
        "",
        "用户最新问题:",
        message,
    ]
    .join("\n")
}

fn format_history_message(
    message: &crate::models::ai_agent::AiChatHistoryMessage,
) -> Option<String> {
    let content = message.content.trim();
    if content.is_empty() {
        return None;
    }
    let speaker = match message.role.as_str() {
        "user" => "用户",
        "assistant" => "AI",
        _ => return None,
    };
    Some(format!("{speaker}: {content}"))
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
    use crate::models::settings::AiCommandApprovalPolicy;
    use crate::models::tool_registry::{
        ToolAuditPolicy, ToolCategory, ToolConfirmationPolicy, ToolRiskLevel,
    };
    use crate::services::ai_agent_context::MAX_PROVIDER_TOOL_NAME_LEN;

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
            conversation_id: "conv-test".to_owned(),
            conversation_slot_json: None,
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
            conversation_id: "conv-test".to_owned(),
            conversation_slot_json: None,
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

    #[test]
    fn approval_tool_call_reports_auto_approved_when_confirmation_not_required() {
        let definition = registry_tool("server_info.snapshot");
        let tool = KerminalApprovalTool {
            model_tool_name: provider_safe_tool_name(&definition.id),
            definition,
            conversation_id: "conv-test".to_owned(),
            conversation_slot_json: None,
            ai_policy: AiSecuritySettings {
                command_approval_policy: AiCommandApprovalPolicy::Relaxed,
                require_remote_approval: false,
                ..AiSecuritySettings::legacy_tool_policy()
            },
            ai_tools: AiToolInvocationService::new(),
            pending_collector: PendingToolInvocationCollector::default(),
        };

        let payload = tauri::async_runtime::block_on(tool.call("{}".to_owned()))
            .expect("tool call should prepare auto invocation");
        let payload: Value = serde_json::from_str(&payload).expect("tool call payload json");

        assert_eq!(payload["status"], "auto_approved");
        assert_eq!(payload["requiresConfirmation"], false);
        assert_eq!(payload["toolId"], "server_info.snapshot");
    }

    #[test]
    fn chat_guard_replaces_unverified_success_claim() {
        let guarded = guard_unverified_chat_success_claim(
            "把 172.16.40.105 主机放到 bwy 分组",
            "已将主机加入 bwy 分组。",
            0,
        );

        assert!(guarded.contains("没有工具调用结果"));
        assert!(!guarded.contains("已将主机加入"));
    }

    #[test]
    fn chat_guard_reports_pending_invocation_instead_of_success() {
        let guarded = guard_unverified_chat_success_claim(
            "添加 172.16.40.105 到 bwy 分组",
            "已经添加完成。",
            1,
        );

        assert!(guarded.contains("待确认工具调用"));
        assert!(guarded.contains("尚未执行"));
    }
}
