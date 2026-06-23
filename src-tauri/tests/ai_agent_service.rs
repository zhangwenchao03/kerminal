//! Kerminal Agent 对话服务集成测试。
//!
//! @author kongweiguang

use std::{
    future::Future,
    pin::Pin,
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};

use kerminal_lib::{
    error::AppResult,
    models::{
        ai_agent::{
            AiApplicationContextRequest, AiApplicationMachineContext, AiApplicationPaneContext,
            AiApplicationTabContext, AiChatAttachmentContext, AiChatRequest,
            AiCommandExecutionVisibility,
        },
        ai_context::AiTerminalContextRequest,
        ai_tool_invocation::{AiToolInvocationStatus, AiToolPendingInvocation},
        llm_provider::{
            LlmContextStrategy, LlmProvider, LlmProviderCreateRequest, LlmProviderKind,
            LlmReasoningEffort,
        },
        settings::{
            AiMcpSettings, CustomMcpServerSetting, CustomMcpServerToolSetting,
            CustomMcpSkillDirectorySetting, CustomMcpTransportKind,
        },
        terminal::{TerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
        tool_registry::{ToolAuditPolicy, ToolConfirmationPolicy, ToolRiskLevel},
    },
    paths::KerminalPaths,
    services::{
        ai_agent_service::{
            AiAgentChatContext, AiAgentService, AiChatExecutionRequest, AiChatExecutionResponse,
            AiChatExecutor,
        },
        credential_service::{CredentialService, MemoryCredentialVault},
        rig_provider_service::RigProviderService,
    },
    state::AppState,
};
use serde_json::json;
use tempfile::{tempdir, TempDir};

#[derive(Debug)]
struct RecordingExecutor {
    requests: Mutex<Vec<AiChatExecutionRequest>>,
    response: AiChatExecutionResponse,
}

impl RecordingExecutor {
    fn new(response: impl Into<String>) -> Self {
        Self {
            requests: Mutex::new(Vec::new()),
            response: AiChatExecutionResponse {
                message: response.into(),
                pending_invocations: Vec::new(),
            },
        }
    }

    fn requests(&self) -> Vec<AiChatExecutionRequest> {
        self.requests.lock().expect("executor requests").clone()
    }
}

impl AiChatExecutor for RecordingExecutor {
    fn execute<'a>(
        &'a self,
        request: AiChatExecutionRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiChatExecutionResponse>> + Send + 'a>> {
        let response = self.response.clone();
        self.requests
            .lock()
            .expect("executor requests")
            .push(request);
        Box::pin(async move { Ok(response) })
    }
}

fn setup_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    (home, state)
}

fn memory_credentials() -> CredentialService {
    CredentialService::with_vault(Arc::new(MemoryCredentialVault::new()))
}

fn chat_context<'a>(
    state: &'a AppState,
    credentials: &'a CredentialService,
) -> AiAgentChatContext<'a> {
    AiAgentChatContext {
        storage: state.storage(),
        credentials,
        ai_context: state.ai_context(),
        ai_tools: state.ai_tools(),
        terminals: state.terminals(),
        terminal_session_bindings: state.terminal_session_bindings(),

        tools: state.tools(),
        mcp_tools: state.mcp_tools(),
        settings: state.settings(),
        paths: state.paths(),
    }
}

fn create_provider(
    state: &AppState,
    credentials: &CredentialService,
    name: &str,
    enabled: bool,
    is_default: bool,
    api_key: Option<&str>,
    context_strategy: LlmContextStrategy,
) -> LlmProvider {
    create_provider_with_kind(
        state,
        credentials,
        name,
        LlmProviderKind::OpenAiChat,
        enabled,
        is_default,
        api_key,
        context_strategy,
    )
}

#[allow(clippy::too_many_arguments)]
fn create_provider_with_kind(
    state: &AppState,
    credentials: &CredentialService,
    name: &str,
    kind: LlmProviderKind,
    enabled: bool,
    is_default: bool,
    api_key: Option<&str>,
    context_strategy: LlmContextStrategy,
) -> LlmProvider {
    RigProviderService::new()
        .create_provider(
            state.storage(),
            credentials,
            LlmProviderCreateRequest {
                name: name.to_string(),
                kind,
                base_url: "https://api.example.com/v1".to_string(),
                model: "gpt-test".to_string(),
                model_list: vec!["gpt-test".to_string()],
                temperature: 0.2,
                context_strategy,
                context_window_tokens: 128_000,
                reasoning_effort: LlmReasoningEffort::ModelDefault,
                max_retries: 3,
                user_agent: None,
                http_proxy: None,
                enabled,
                is_default,
                api_key: api_key.map(ToOwned::to_owned),
            },
        )
        .expect("create provider")
}

fn app_context_request(active_tool_id: &str, session_id: &str) -> AiApplicationContextRequest {
    AiApplicationContextRequest {
        active_tool_id: Some(active_tool_id.to_owned()),
        active_tab: Some(AiApplicationTabContext {
            id: "tab-1".to_owned(),
            title: "本地终端".to_owned(),
            machine_id: Some("local-powershell".to_owned()),
        }),
        focused_pane: Some(AiApplicationPaneContext {
            id: "pane-1".to_owned(),
            title: "本地 PowerShell".to_owned(),
            mode: "local".to_owned(),
            status: "online".to_owned(),
            machine_id: Some("local-powershell".to_owned()),
            session_id: Some(session_id.to_owned()),
        }),
        selected_machine: Some(AiApplicationMachineContext {
            id: "local-powershell".to_owned(),
            name: "PowerShell".to_owned(),
            kind: "local".to_owned(),
            status: "online".to_owned(),
            production: Some(false),
        }),
    }
}

fn custom_agent_mcp_settings(skill_directory: &str) -> AiMcpSettings {
    AiMcpSettings {
        servers: vec![CustomMcpServerSetting {
            args: vec!["--stdio".to_owned()],
            bearer_token_env_var: String::new(),
            command: "custom-mcp-server".to_owned(),
            description: "自定义测试 MCP Server".to_owned(),
            enabled: true,
            env: Vec::new(),
            headers: Vec::new(),
            id: "custom.agent".to_owned(),
            last_discovered_at: Some(123),
            last_discovery_error: None,
            name: "Custom Agent MCP".to_owned(),
            tools: vec![CustomMcpServerToolSetting {
                audit: ToolAuditPolicy::Summary,
                confirmation: ToolConfirmationPolicy::Always,
                description: "执行自定义只读查询".to_owned(),
                discovered_at: Some(123),
                enabled: true,
                input_schema: json!({ "type": "object" }),
                name: "query".to_owned(),
                risk: ToolRiskLevel::Read,
                title: "Custom Agent Query".to_owned(),
            }],
            transport: CustomMcpTransportKind::Stdio,
            url: String::new(),
        }],
        skill_directories: vec![CustomMcpSkillDirectorySetting {
            enabled: true,
            id: "custom-agent-skills".to_owned(),
            path: skill_directory.to_owned(),
        }],
    }
}

#[test]
fn chat_rejects_blank_message_before_provider_lookup() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let executor = Arc::new(RecordingExecutor::new("不会被调用"));
    let service = AiAgentService::with_executor(executor.clone());

    let error = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            message: "  ".to_string(),
            ..Default::default()
        },
    ))
    .expect_err("blank message should fail");

    assert!(error.to_string().contains("请输入要发送给 AI 的内容"));
    assert!(executor.requests().is_empty());
}

#[test]
fn chat_rejects_missing_enabled_provider() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let executor = Arc::new(RecordingExecutor::new("不会被调用"));
    let service = AiAgentService::with_executor(executor.clone());

    let error = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            message: "解释当前输出".to_string(),
            ..Default::default()
        },
    ))
    .expect_err("missing provider should fail");

    assert!(error.to_string().contains("请先在设置里配置并启用"));
    assert!(executor.requests().is_empty());
}

#[test]
fn chat_uses_default_provider_and_returns_metadata() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(
        &state,
        &credentials,
        "默认 Provider",
        true,
        true,
        Some("sk-test-default"),
        LlmContextStrategy::CurrentTerminal,
    );
    let executor = Arc::new(RecordingExecutor::new("这是 Kerminal Agent 的中文回复。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            message: "帮我看下当前终端状态".to_string(),
            conversation_id: Some("conversation-1".to_string()),
            ..Default::default()
        },
    ))
    .expect("chat response");

    assert_eq!(response.conversation_id, "conversation-1");
    assert_eq!(response.provider_id, provider.id);
    assert_eq!(response.provider_name, "默认 Provider");
    assert_eq!(response.model, "gpt-test");
    assert_eq!(response.message, "这是 Kerminal Agent 的中文回复。");
    assert!(!response.context_used);
    assert!(response.tool_count > 0);

    let requests = executor.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].provider.id, provider.id);
    assert_eq!(requests[0].provider.kind, LlmProviderKind::OpenAiChat);
    assert_eq!(requests[0].api_key, "sk-test-default");
    assert!(requests[0].preamble.contains("默认使用中文回复"));
    assert!(requests[0].context.contains("rmcp 工具目录"));
}

#[test]
fn chat_includes_attachment_context_without_claiming_vision_pixels() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "附件 Provider",
        true,
        true,
        Some("sk-attachment"),
        LlmContextStrategy::Minimal,
    );
    let executor = Arc::new(RecordingExecutor::new("已读取附件上下文。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "这张图里有 SSH 连接方式，帮我配置主机".to_string(),
            conversation_id: Some("conversation-with-image".to_string()),
            conversation_slot_json: None,
            provider_id: None,
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![AiChatAttachmentContext {
                height: Some(720),
                id: "att-ssh-image".to_string(),
                kind: "image".to_string(),
                mime_type: "image/png".to_string(),
                missing_reason: None,
                ocr_text: Some("ssh deploy@10.0.0.12 -p 2222".to_string()),
                original_name: "ssh-login.png".to_string(),
                redaction_summary: None,
                size_bytes: 42_000,
                status: "available".to_string(),
                vision_usage: Some("ocrOnly".to_string()),
                width: Some(1280),
            }],
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    assert!(response.context_used);
    let requests = executor.requests();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].context.contains("当前附件上下文"));
    assert!(requests[0].context.contains("ssh-login.png"));
    assert!(requests[0].context.contains("visionUsage ocrOnly"));
    assert!(requests[0].context.contains("ssh deploy@10.0.0.12 -p 2222"));
    assert!(requests[0].context.contains("只能通过受控工具建议创建主机"));
    assert!(requests[0].context.contains("不要声称已经看见图片像素"));
}

#[test]
fn chat_reports_vision_capability_and_effective_attachment_usage() {
    for (model, expected_support, ocr_text, expected_effective, warning_fragment) in [
        (
            "gpt-test",
            false,
            None,
            "metadataOnly",
            "Provider 未标记为支持视觉",
        ),
        (
            "gpt-4o-mini",
            true,
            Some("ssh deploy@10.0.0.12 -p 2222"),
            "ocrOnly",
            "没有找到已持久化附件记录",
        ),
    ] {
        let (_home, state) = setup_state();
        let credentials = memory_credentials();
        let provider = RigProviderService::new()
            .create_provider(
                state.storage(),
                &credentials,
                LlmProviderCreateRequest {
                    name: format!("Vision Provider {model}"),
                    kind: LlmProviderKind::OpenAiChat,
                    base_url: "https://api.example.com/v1".to_string(),
                    model: model.to_string(),
                    model_list: vec![model.to_string()],
                    temperature: 0.2,
                    context_strategy: LlmContextStrategy::Minimal,
                    context_window_tokens: 128_000,
                    reasoning_effort: LlmReasoningEffort::ModelDefault,
                    max_retries: 3,
                    user_agent: None,
                    http_proxy: None,
                    enabled: true,
                    is_default: true,
                    api_key: Some("sk-vision".to_owned()),
                },
            )
            .expect("create vision provider");
        let executor = Arc::new(RecordingExecutor::new("vision status ok"));
        let service = AiAgentService::with_executor(executor.clone());

        let response = tauri::async_runtime::block_on(service.chat(
            chat_context(&state, &credentials),
            AiChatRequest {
                application_context: None,
                message: "这张图能直接看吗？".to_string(),
                conversation_id: None,
                conversation_slot_json: None,
                provider_id: Some(provider.id),
                terminal_context: None,
                execution_visibility: None,
                attachments: vec![AiChatAttachmentContext {
                    height: Some(720),
                    id: format!("att-{model}"),
                    kind: "image".to_string(),
                    mime_type: "image/png".to_string(),
                    missing_reason: None,
                    ocr_text: ocr_text.map(str::to_owned),
                    original_name: "screen.png".to_string(),
                    redaction_summary: None,
                    size_bytes: 42_000,
                    status: "available".to_string(),
                    vision_usage: Some("visionInput".to_string()),
                    width: Some(1280),
                }],
                history: Vec::new(),
            },
        ))
        .expect("chat response");

        assert_eq!(
            response.vision_usage.provider_supports_vision,
            expected_support
        );
        assert_eq!(
            response.vision_usage.vision_adapter_enabled,
            expected_support
        );
        let status = &response.vision_usage.attachments[0];
        assert_eq!(status.requested_usage, "visionInput");
        assert_eq!(status.effective_usage, expected_effective);
        assert_eq!(status.model_input, "textContext");
        assert!(status
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains(warning_fragment)));

        let requests = executor.requests();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].context.contains("本次图片像素进入模型：0 个"));
        assert!(requests[0]
            .context
            .contains(&format!("effectiveVisionUsage {expected_effective}")));
        assert!(requests[0].context.contains(warning_fragment));
    }
}

#[test]
fn chat_preserves_supported_provider_kinds_for_execution() {
    for kind in [
        LlmProviderKind::OpenAiChat,
        LlmProviderKind::OpenAiResponses,
        LlmProviderKind::Anthropic,
    ] {
        let (_home, state) = setup_state();
        let credentials = memory_credentials();
        let provider = create_provider_with_kind(
            &state,
            &credentials,
            &format!("{kind:?} Provider"),
            kind,
            true,
            true,
            Some("sk-kind"),
            LlmContextStrategy::Minimal,
        );
        let executor = Arc::new(RecordingExecutor::new("provider kind ok"));
        let service = AiAgentService::with_executor(executor.clone());

        let response = tauri::async_runtime::block_on(service.chat(
            chat_context(&state, &credentials),
            AiChatRequest {
                application_context: None,
                message: "检查 provider kind".to_string(),
                conversation_id: None,
                conversation_slot_json: None,
                provider_id: Some(provider.id.clone()),
                terminal_context: None,
                execution_visibility: None,
                attachments: Vec::new(),
                history: Vec::new(),
            },
        ))
        .unwrap_or_else(|error| panic!("chat should accept provider kind {kind:?}: {error}"));

        assert_eq!(response.provider_id, provider.id);
        let requests = executor.requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].provider.kind, kind);
        assert_eq!(requests[0].provider.base_url, "https://api.example.com/v1");
        assert_eq!(requests[0].provider.model, "gpt-test");
        assert!(requests[0].context.contains("rmcp 工具目录"));
    }
}

#[test]
fn chat_context_includes_custom_mcp_tools_and_skills_from_settings() {
    let (home, state) = setup_state();
    let skill_root = home.path().join("skills");
    let skill_dir = skill_root.join("custom-agent-skill");
    std::fs::create_dir_all(&skill_dir).expect("create custom agent skill");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: Custom Agent Skill\ndescription: 用于测试自定义 MCP Agent 上下文。\n---\n\n# Fallback\n自定义 skill 正文摘要必须进入 Agent 上下文。\n",
    )
    .expect("write custom agent skill");
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "自定义 MCP Provider",
        true,
        true,
        Some("sk-custom-mcp"),
        LlmContextStrategy::Minimal,
    );
    let mut settings = state
        .settings()
        .load_settings(state.storage())
        .expect("load settings");
    settings.ai.mcp = custom_agent_mcp_settings(skill_root.to_string_lossy().as_ref());
    state
        .settings()
        .update_settings(state.storage(), settings)
        .expect("save custom mcp settings");

    let executor = Arc::new(RecordingExecutor::new("收到自定义 MCP 上下文。"));
    let service = AiAgentService::with_executor(executor.clone());
    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "使用自定义 MCP 查询一下".to_string(),
            conversation_id: None,
            conversation_slot_json: None,
            provider_id: None,
            terminal_context: None,
            execution_visibility: None,
            attachments: Vec::new(),
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    let system_mcp_tool_count = state
        .mcp_tools()
        .list_tools(&state.tools().list_tools())
        .tools
        .len();
    assert_eq!(response.tool_count, system_mcp_tool_count + 1);
    let requests = executor.requests();
    assert_eq!(requests.len(), 1);
    assert!(requests[0]
        .tool_definitions
        .iter()
        .any(|tool| tool.id == "custom.agent.query"));
    assert!(requests[0].context.contains("custom.agent.query"));
    assert!(requests[0]
        .context
        .contains("custom-skill.custom-agent-skills.custom-agent-skill"));
    assert!(requests[0]
        .context
        .contains("自定义 skill 正文摘要必须进入 Agent 上下文"));
    assert!(requests[0].context.contains("用户自定义 MCP"));
    assert!(requests[0].context.contains("server discovery"));
}

#[test]
fn chat_rejects_message_over_context_limit_before_executor_call() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "边界 Provider",
        true,
        true,
        Some("sk-too-long"),
        LlmContextStrategy::CurrentTerminal,
    );
    let executor = Arc::new(RecordingExecutor::new("不会被调用"));
    let service = AiAgentService::with_executor(executor.clone());

    let error = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "x".repeat(12 * 1024 + 1),
            conversation_id: None,
            conversation_slot_json: None,
            provider_id: None,
            terminal_context: None,
            execution_visibility: None,
            attachments: Vec::new(),
            history: Vec::new(),
        },
    ))
    .expect_err("oversized message should fail");

    assert!(error.to_string().contains("AI 对话内容不能超过 12 KB"));
    assert!(executor.requests().is_empty());
}

#[test]
fn chat_rejects_provider_without_api_key() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(
        &state,
        &credentials,
        "无 Key Provider",
        true,
        true,
        None,
        LlmContextStrategy::CurrentTerminal,
    );
    let executor = Arc::new(RecordingExecutor::new("不会被调用"));
    let service = AiAgentService::with_executor(executor.clone());

    let error = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "解释当前输出".to_string(),
            conversation_id: None,
            conversation_slot_json: None,
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: Vec::new(),
            history: Vec::new(),
        },
    ))
    .expect_err("missing api key should fail");

    assert!(error.to_string().contains("API key 未配置"));
    assert!(executor.requests().is_empty());
}

#[test]
fn chat_rejects_disabled_requested_provider() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(
        &state,
        &credentials,
        "停用 Provider",
        false,
        false,
        Some("sk-disabled"),
        LlmContextStrategy::CurrentTerminal,
    );
    let executor = Arc::new(RecordingExecutor::new("不会被调用"));
    let service = AiAgentService::with_executor(executor.clone());

    let error = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "解释当前输出".to_string(),
            conversation_id: None,
            conversation_slot_json: None,
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: Vec::new(),
            history: Vec::new(),
        },
    ))
    .expect_err("disabled provider should fail");

    assert!(error.to_string().contains("LLM Provider 已停用"));
    assert!(executor.requests().is_empty());
}

#[test]
fn chat_includes_redacted_terminal_context_and_mcp_tool_summary() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "上下文 Provider",
        true,
        true,
        Some("sk-context"),
        LlmContextStrategy::CurrentTerminal,
    );
    let executor = Arc::new(RecordingExecutor::new(
        "建议先运行 `cargo test --test ai_agent_service`。",
    ));
    let service = AiAgentService::with_executor(executor.clone());
    let (sender, receiver) = mpsc::channel();
    let session = state
        .terminals()
        .create_session(secret_output_request(), move |event| {
            sender.send(event).is_ok()
        })
        .expect("create terminal session");
    wait_for_output(
        state.terminals(),
        &session.id,
        &receiver,
        "kerminal-agent-context",
    );
    state
        .terminal_session_bindings()
        .register("pane-1", session.id.clone())
        .expect("register pane session binding");
    state
        .terminal_session_bindings()
        .ready("pane-1", &session.id)
        .expect("mark pane session binding ready");

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: Some(app_context_request("ai", &session.id)),
            message: "解释最近输出".to_string(),
            conversation_id: None,
            conversation_slot_json: None,
            provider_id: None,
            terminal_context: Some(AiTerminalContextRequest {
                session_id: session.id.clone(),
                pane_id: Some("pane-1".to_string()),
                pane_title: Some("本地 PowerShell".to_string()),
                tab_id: Some("tab-1".to_string()),
                tab_title: Some("本地终端".to_string()),
                machine_id: Some("local-powershell".to_string()),
                machine_name: Some("PowerShell".to_string()),
                machine_kind: Some("local".to_string()),
                max_output_bytes: Some(4096),
            }),
            execution_visibility: None,
            attachments: Vec::new(),
            history: Vec::new(),
        },
    ))
    .expect("chat with terminal context");

    state.terminals().close(&session.id).expect("close session");

    assert!(response.context_used);
    assert!(response.tool_count > 0);

    let requests = executor.requests();
    assert_eq!(requests.len(), 1);
    let context = &requests[0].context;
    assert!(context.contains("当前终端上下文"));
    assert!(context.contains("当前应用上下文"));
    assert!(context.contains("Kerminal Agent 是当前 Kerminal 应用的操作层"));
    assert!(context.contains("MCP 工具是可受控调用的手脚"));
    assert!(context.contains("当前 pane：本地 PowerShell"));
    assert!(context.contains("当前主机：PowerShell"));
    assert!(context.contains("AI 命令显示模式：显示在当前终端"));
    assert!(context.contains("terminal.write"));
    assert!(context.contains(&format!("session `{}`", session.id)));
    assert!(context.contains("Agent Skills 路由"));
    assert!(context.contains("kerminal-agent-context"));
    assert!(context.contains("rmcp 工具目录"));
    assert!(context.contains("terminal.write"));
    assert!(!context.contains("sk-agent-secret"));
    assert!(context.contains("[已脱敏"));
    assert!(!requests[0].prompt.contains("sk-context"));
    assert!(!requests[0].context.contains("sk-context"));
}

#[test]
fn chat_context_includes_background_execution_visibility() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "后台 Provider",
        true,
        true,
        Some("sk-background"),
        LlmContextStrategy::Minimal,
    );
    let executor = Arc::new(RecordingExecutor::new("后台工具调用需要清楚展示结果。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "后台检查一下状态".to_string(),
            conversation_id: None,
            conversation_slot_json: None,
            provider_id: None,
            terminal_context: None,
            execution_visibility: Some(AiCommandExecutionVisibility::Background),
            attachments: Vec::new(),
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    assert_eq!(response.message, "后台工具调用需要清楚展示结果。");
    let requests = executor.requests();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].context.contains("AI 命令显示模式：后台运行"));
    assert!(requests[0].context.contains("不要声称命令会出现在终端"));
}

#[test]
fn minimal_context_strategy_ignores_terminal_snapshot_request() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "Minimal Provider",
        true,
        true,
        Some("sk-minimal"),
        LlmContextStrategy::Minimal,
    );
    let executor = Arc::new(RecordingExecutor::new("minimal context"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "不要读取终端上下文".to_string(),
            conversation_id: None,
            conversation_slot_json: None,
            provider_id: None,
            terminal_context: Some(AiTerminalContextRequest {
                session_id: "missing-session-is-ignored".to_string(),
                pane_id: Some("pane-ignored".to_string()),
                pane_title: Some("不应读取".to_string()),
                tab_id: None,
                tab_title: None,
                machine_id: None,
                machine_name: None,
                machine_kind: None,
                max_output_bytes: Some(128),
            }),
            execution_visibility: None,
            attachments: Vec::new(),
            history: Vec::new(),
        },
    ))
    .expect("minimal context should not require terminal session");

    assert!(!response.context_used);
    let requests = executor.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].provider.context_strategy,
        LlmContextStrategy::Minimal
    );
    assert!(requests[0]
        .context
        .contains("本次没有提供 terminal session 快照"));
    assert!(!requests[0].context.contains("不应读取"));
    assert!(!requests[0]
        .context
        .contains("session `missing-session-is-ignored`"));
}

#[test]
fn chat_returns_pending_invocations_from_standard_tool_call_executor() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "工具建议 Provider",
        true,
        true,
        Some("sk-suggestion"),
        LlmContextStrategy::CurrentTerminal,
    );
    let executor = Arc::new(RecordingExecutor {
        requests: Mutex::new(Vec::new()),
        response: AiChatExecutionResponse {
            message: "已创建待审批工具调用，等待你确认。".to_owned(),
            pending_invocations: vec![AiToolPendingInvocation {
                arguments_summary: "sessionId=session-1, data=cargo test\\r".to_owned(),
                audit: ToolAuditPolicy::Summary,
                client_action: None,
                confirmation: ToolConfirmationPolicy::Contextual,
                conversation_id: None,
                conversation_slot_json: None,
                run_id: None,
                step_id: None,
                created_at: "1".to_owned(),
                id: "tool-call-1".to_owned(),
                reason: Some("运行测试确认当前改动。".to_owned()),
                requested_by: Some("kerminal-agent".to_owned()),
                requires_confirmation: true,
                risk: ToolRiskLevel::Write,
                risk_summary: None,
                status: AiToolInvocationStatus::Pending,
                tool_id: "terminal.write".to_owned(),
                tool_title: "写入终端".to_owned(),
            }],
        },
    });
    let service = AiAgentService::with_executor(executor);

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "帮我跑测试".to_string(),
            conversation_id: None,
            conversation_slot_json: None,
            provider_id: None,
            terminal_context: None,
            execution_visibility: None,
            attachments: Vec::new(),
            history: Vec::new(),
        },
    ))
    .expect("chat with pending invocation");

    assert_eq!(response.message, "已创建待审批工具调用，等待你确认。");
    assert_eq!(response.pending_invocations.len(), 1);
    assert_eq!(response.pending_invocations[0].id, "tool-call-1");
    assert_eq!(response.pending_invocations[0].tool_id, "terminal.write");
}

fn wait_for_output(
    manager: &kerminal_lib::services::terminal_manager::TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
            if event.data.contains("\u{1b}[6n") {
                manager.write(session_id, "\u{1b}[1;1R").unwrap();
            }
        }

        if received.contains(expected) {
            return;
        }
    }

    panic!("expected PTY output to contain {expected:?}, got: {received:?}");
}

#[cfg(target_os = "windows")]
fn secret_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec![
            "/C".to_owned(),
            "echo API_KEY=sk-agent-secret-12345 && echo kerminal-agent-context".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn secret_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            "printf 'API_KEY=sk-agent-secret-12345\\nkerminal-agent-context\\n'".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}
