//! Kerminal Tauri 运行时状态。
//!
//! @author kongweiguang

use crate::{
    error::AppResult,
    paths::KerminalPaths,
    services::{
        ai_agent_run_service::AiAgentRunService, ai_agent_service::AiAgentService,
        ai_context_service::AiContextService, ai_conversation_service::AiConversationService,
        ai_tool_invocation_service::AiToolInvocationService,
        command_history_service::CommandHistoryService,
        command_suggestion_service::CommandSuggestionService,
        credential_service::CredentialService, diagnostics_service::DiagnosticsService,
        docker_host_service::DockerHostService,
        local_network_proxy_service::LocalNetworkProxyService,
        mcp_streamable_http_server::McpStreamableHttpServerService,
        mcp_tool_gateway::McpToolGateway, port_forward_service::PortForwardService,
        profile_service::ProfileService, remote_host_service::RemoteHostService,
        rig_provider_service::RigProviderService, serial_terminal_service::SerialTerminalService,
        server_info_service::ServerInfoService, settings_service::SettingsService,
        sftp_service::SftpService, snippet_service::SnippetService,
        ssh_command_service::SshCommandService, ssh_terminal_service::SshTerminalService,
        telnet_terminal_service::TelnetTerminalService, terminal_manager::TerminalManager,
        terminal_session_binding_service::TerminalSessionBindingService,
        tool_registry_service::ToolRegistryService, workflow_service::WorkflowService,
    },
    storage::{migrations::CURRENT_SCHEMA_VERSION, SqliteStore},
};

/// Kerminal Rust 侧全局状态。
#[derive(Debug)]
pub struct AppState {
    ai_agent: AiAgentService,
    ai_agent_runs: AiAgentRunService,
    ai_conversations: AiConversationService,
    ai_context: AiContextService,
    ai_tools: AiToolInvocationService,
    command_history: CommandHistoryService,
    command_suggestions: CommandSuggestionService,
    credentials: CredentialService,
    diagnostics: DiagnosticsService,
    docker_hosts: DockerHostService,
    local_network_proxy: LocalNetworkProxyService,
    mcp_http_server: McpStreamableHttpServerService,
    mcp_tools: McpToolGateway,
    paths: KerminalPaths,
    port_forwards: PortForwardService,
    profiles: ProfileService,
    remote_hosts: RemoteHostService,
    rig_providers: RigProviderService,
    serial_terminals: SerialTerminalService,
    server_info: ServerInfoService,
    settings: SettingsService,
    sftp: SftpService,
    snippets: SnippetService,
    ssh_commands: SshCommandService,
    ssh_terminals: SshTerminalService,
    telnet_terminals: TelnetTerminalService,
    storage: SqliteStore,
    terminal_session_bindings: TerminalSessionBindingService,
    terminals: TerminalManager,
    tools: ToolRegistryService,
    workflows: WorkflowService,
}

impl AppState {
    /// 使用当前系统 home 目录初始化应用状态。
    pub fn initialize() -> AppResult<Self> {
        Self::initialize_with_paths(KerminalPaths::from_current_home()?)
    }

    /// 使用指定路径初始化应用状态，主要用于测试和未来 portable 模式。
    pub fn initialize_with_paths(paths: KerminalPaths) -> AppResult<Self> {
        let storage = SqliteStore::open(&paths)?;
        storage.set_metadata("schema_version", &CURRENT_SCHEMA_VERSION.to_string())?;
        let credentials = CredentialService::new();
        let ai_agent = AiAgentService::new();
        let ai_agent_runs = AiAgentRunService::new();
        let ai_conversations = AiConversationService::new();
        let ai_context = AiContextService::new();
        let ai_tools = AiToolInvocationService::new();
        let command_history = CommandHistoryService::new();
        let command_suggestions = CommandSuggestionService::new();
        let mcp_http_server = McpStreamableHttpServerService::new();
        let mcp_tools = McpToolGateway::new();
        let diagnostics = DiagnosticsService::new();
        let docker_hosts = DockerHostService::new();
        let local_network_proxy = LocalNetworkProxyService::new();
        let port_forwards = PortForwardService::new();
        let profiles = ProfileService::new();
        profiles.ensure_seed_profiles(&storage)?;
        let remote_hosts = RemoteHostService::new();
        let rig_providers = RigProviderService::new();
        let serial_terminals = SerialTerminalService::new();
        let server_info = ServerInfoService::new();
        let settings = SettingsService::new();
        let sftp = SftpService::new();
        let snippets = SnippetService::new();
        let ssh_commands = SshCommandService::new();
        let ssh_terminals = SshTerminalService::new();
        ssh_terminals.cleanup_temporary_identity_files(&paths)?;
        let telnet_terminals = TelnetTerminalService::new();
        let tools = ToolRegistryService::new();
        let workflows = WorkflowService::new();

        Ok(Self {
            ai_agent,
            ai_agent_runs,
            ai_conversations,
            ai_context,
            ai_tools,
            command_history,
            command_suggestions,
            credentials,
            diagnostics,
            docker_hosts,
            local_network_proxy,
            mcp_http_server,
            mcp_tools,
            paths,
            port_forwards,
            profiles,
            remote_hosts,
            rig_providers,
            serial_terminals,
            server_info,
            settings,
            sftp,
            snippets,
            ssh_commands,
            ssh_terminals,
            telnet_terminals,
            storage,
            terminal_session_bindings: TerminalSessionBindingService::default(),
            terminals: TerminalManager::new(),
            tools,
            workflows,
        })
    }

    /// 返回本地数据目录集合。
    pub fn paths(&self) -> &KerminalPaths {
        &self.paths
    }

    /// 返回 AI Agent 对话服务。
    pub fn ai_agent(&self) -> &AiAgentService {
        &self.ai_agent
    }

    /// 返回 AI Agent run 状态服务。
    pub fn ai_agent_runs(&self) -> &AiAgentRunService {
        &self.ai_agent_runs
    }

    /// 返回 AI 会话持久化服务。
    pub fn ai_conversations(&self) -> &AiConversationService {
        &self.ai_conversations
    }

    /// 返回 AI 上下文服务。
    pub fn ai_context(&self) -> &AiContextService {
        &self.ai_context
    }

    /// 返回 AI 工具调用服务。
    pub fn ai_tools(&self) -> &AiToolInvocationService {
        &self.ai_tools
    }

    /// 返回命令历史服务。
    pub fn command_history(&self) -> &CommandHistoryService {
        &self.command_history
    }

    /// 返回命令建议服务。
    pub fn command_suggestions(&self) -> &CommandSuggestionService {
        &self.command_suggestions
    }

    /// 返回本地凭据服务。
    pub fn credentials(&self) -> &CredentialService {
        &self.credentials
    }

    /// 返回诊断包服务。
    pub fn diagnostics(&self) -> &DiagnosticsService {
        &self.diagnostics
    }

    /// 返回 SSH 宿主上的容器服务。
    pub fn docker_hosts(&self) -> &DockerHostService {
        &self.docker_hosts
    }

    /// 返回本机共享网络代理服务。
    pub fn local_network_proxy(&self) -> &LocalNetworkProxyService {
        &self.local_network_proxy
    }

    /// 返回 rmcp 工具网关。
    pub fn mcp_tools(&self) -> &McpToolGateway {
        &self.mcp_tools
    }

    /// 返回 Streamable HTTP MCP Server 生命周期服务。
    pub fn mcp_http_server(&self) -> &McpStreamableHttpServerService {
        &self.mcp_http_server
    }

    /// 返回 SSH 端口转发服务。
    pub fn port_forwards(&self) -> &PortForwardService {
        &self.port_forwards
    }

    /// 返回 SQLite 存储入口。
    pub fn storage(&self) -> &SqliteStore {
        &self.storage
    }

    /// 返回终端 Profile 服务。
    pub fn profiles(&self) -> &ProfileService {
        &self.profiles
    }

    /// 返回远程主机服务。
    pub fn remote_hosts(&self) -> &RemoteHostService {
        &self.remote_hosts
    }

    /// 返回 Rig LLM Provider 服务。
    pub fn rig_providers(&self) -> &RigProviderService {
        &self.rig_providers
    }

    /// 返回 Serial 串口终端服务。
    pub fn serial_terminals(&self) -> &SerialTerminalService {
        &self.serial_terminals
    }

    /// 返回服务器信息采集服务。
    pub fn server_info(&self) -> &ServerInfoService {
        &self.server_info
    }

    /// 返回应用设置服务。
    pub fn settings(&self) -> &SettingsService {
        &self.settings
    }

    /// 返回 SFTP 文件工具服务。
    pub fn sftp(&self) -> &SftpService {
        &self.sftp
    }

    /// 返回脚本片段服务。
    pub fn snippets(&self) -> &SnippetService {
        &self.snippets
    }

    /// 返回 SSH 非交互命令服务。
    pub fn ssh_commands(&self) -> &SshCommandService {
        &self.ssh_commands
    }

    /// 返回 SSH 远程终端服务。
    pub fn ssh_terminals(&self) -> &SshTerminalService {
        &self.ssh_terminals
    }

    /// 返回 Telnet 远程终端服务。
    pub fn telnet_terminals(&self) -> &TelnetTerminalService {
        &self.telnet_terminals
    }

    /// 返回终端会话管理服务。
    pub fn terminals(&self) -> &TerminalManager {
        &self.terminals
    }

    /// 返回终端 pane/session 绑定旁路服务。
    pub fn terminal_session_bindings(&self) -> &TerminalSessionBindingService {
        &self.terminal_session_bindings
    }

    /// 返回 Kerminal Tool Registry。
    pub fn tools(&self) -> &ToolRegistryService {
        &self.tools
    }

    /// 返回命令工作流服务。
    pub fn workflows(&self) -> &WorkflowService {
        &self.workflows
    }
}
