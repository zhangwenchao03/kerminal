//! AppState 的本地运行态与 MCP 能力组合。
//!
//! @author kongweiguang

use crate::{
    error::AppResult,
    paths::KerminalPaths,
    services::{
        agent_context_service::AgentContextService,
        agent_session_service::AgentSessionService,
        command_history_service::CommandHistoryService,
        command_suggestion_service::CommandSuggestionService,
        credential_service::CredentialService,
        diagnostics_service::DiagnosticsService,
        external_agent_workspace::ExternalAgentWorkspaceService,
        external_launch::{ExternalLaunchIntake, ExternalLaunchTaskRegistry},
        mcp_streamable_http_server::McpStreamableHttpServerService,
        mcp_tool_catalog_service::McpToolCatalogService,
        mcp_tool_executor_service::McpToolExecutorService,
        terminal_manager::TerminalManager,
        terminal_session_binding_service::TerminalSessionBindingService,
    },
    storage::{CommandSqliteStore, RuntimeFileStore},
};

/// 不依赖远程会话的本地运行态和 MCP 能力集合。
#[derive(Debug)]
pub(super) struct OperationalCapabilities {
    pub(super) agent_context: AgentContextService,
    pub(super) agent_sessions: AgentSessionService,
    pub(super) command_history: CommandHistoryService,
    pub(super) command_store: CommandSqliteStore,
    pub(super) command_suggestions: CommandSuggestionService,
    pub(super) credentials: CredentialService,
    pub(super) diagnostics: DiagnosticsService,
    pub(super) external_launch_intake: ExternalLaunchIntake,
    pub(super) external_launch_tasks: ExternalLaunchTaskRegistry,
    pub(super) mcp_http_server: McpStreamableHttpServerService,
    pub(super) mcp_tool_catalog: McpToolCatalogService,
    pub(super) mcp_tool_executor: McpToolExecutorService,
    pub(super) storage: RuntimeFileStore,
    pub(super) terminal_session_bindings: TerminalSessionBindingService,
    pub(super) terminals: TerminalManager,
}

impl OperationalCapabilities {
    /// 打开本地持久化运行态，并初始化不持久化的进程内服务。
    pub(super) fn initialize(paths: &KerminalPaths) -> AppResult<Self> {
        let storage = RuntimeFileStore::open(paths)?;
        let command_store = CommandSqliteStore::open(paths)?;
        ExternalAgentWorkspaceService::new(paths.root.clone(), None, false)
            .ensure_default_agent_files()?;

        Ok(Self {
            agent_context: AgentContextService::new(),
            agent_sessions: AgentSessionService::new(paths.root.clone()),
            command_history: CommandHistoryService::new(),
            command_store,
            command_suggestions: CommandSuggestionService::new(),
            credentials: CredentialService::new(),
            diagnostics: DiagnosticsService::new(),
            external_launch_intake: ExternalLaunchIntake::new(),
            external_launch_tasks: ExternalLaunchTaskRegistry::new(),
            mcp_http_server: McpStreamableHttpServerService::new(),
            mcp_tool_catalog: McpToolCatalogService::new(),
            mcp_tool_executor: McpToolExecutorService::new(),
            storage,
            terminal_session_bindings: TerminalSessionBindingService::default(),
            terminals: TerminalManager::with_shell_integration_cache_dir(paths.cache.clone()),
        })
    }
}
