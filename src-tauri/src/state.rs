//! Kerminal Tauri 运行时状态。
//!
//! @author kongweiguang

use std::sync::Arc;

use crate::{
    error::AppResult,
    models::settings::AppSettings,
    paths::KerminalPaths,
    services::{
        agent_context_service::AgentContextService,
        agent_session_service::AgentSessionService,
        command_history_service::CommandHistoryService,
        command_suggestion_service::CommandSuggestionService,
        config_change_observer_service::ConfigChangeObserverService,
        credential_service::CredentialService,
        diagnostics_service::DiagnosticsService,
        docker_host_service::DockerHostService,
        external_agent_workspace::ExternalAgentWorkspaceService,
        external_launch::{
            ExternalLaunchIntake, ExternalLaunchPolicy, ExternalLaunchTaskRegistry,
            ExternalSessionMaterializer,
        },
        local_network_proxy_service::LocalNetworkProxyService,
        mcp_streamable_http_server::McpStreamableHttpServerService,
        mcp_tool_catalog_service::McpToolCatalogService,
        mcp_tool_executor_service::McpToolExecutorService,
        port_forward_service::PortForwardService,
        profile_service::ProfileService,
        remote_host_service::RemoteHostService,
        serial_terminal_service::SerialTerminalService,
        server_info_service::ServerInfoService,
        settings_service::SettingsService,
        sftp_service::SftpService,
        snippet_service::SnippetService,
        ssh_command_service::SshCommandService,
        ssh_runtime::{
            auth_broker::SshAuthBroker, native_backend::NativeSshRuntimeBackend,
            ManagedSshSessionManager,
        },
        ssh_terminal_service::SshTerminalService,
        telnet_terminal_service::TelnetTerminalService,
        terminal_manager::TerminalManager,
        terminal_session_binding_service::TerminalSessionBindingService,
        tmux_service::TmuxService,
        workflow_service::WorkflowService,
        workspace_sync_service::WorkspaceSyncService,
    },
    storage::{config_file_store::ConfigFileStore, CommandSqliteStore, RuntimeFileStore},
};

/// Kerminal Rust 侧全局状态。
#[derive(Debug)]
pub struct AppState {
    agent_context: AgentContextService,
    agent_sessions: AgentSessionService,
    mcp_tool_executor: McpToolExecutorService,
    command_history: CommandHistoryService,
    command_store: CommandSqliteStore,
    command_suggestions: CommandSuggestionService,
    config_change_observer: ConfigChangeObserverService,
    credentials: CredentialService,
    diagnostics: DiagnosticsService,
    docker_hosts: DockerHostService,
    external_launch_intake: ExternalLaunchIntake,
    external_launch_tasks: ExternalLaunchTaskRegistry,
    external_session_materializer: ExternalSessionMaterializer,
    local_network_proxy: LocalNetworkProxyService,
    mcp_http_server: McpStreamableHttpServerService,
    paths: KerminalPaths,
    port_forwards: PortForwardService,
    profiles: ProfileService,
    remote_hosts: RemoteHostService,
    serial_terminals: SerialTerminalService,
    server_info: ServerInfoService,
    settings: SettingsService,
    sftp: SftpService,
    snippets: SnippetService,
    ssh_auth_broker: SshAuthBroker,
    ssh_commands: SshCommandService,
    ssh_runtime: ManagedSshSessionManager,
    ssh_terminals: SshTerminalService,
    telnet_terminals: TelnetTerminalService,
    storage: RuntimeFileStore,
    terminal_session_bindings: TerminalSessionBindingService,
    terminals: TerminalManager,
    tmux: TmuxService,
    mcp_tool_catalog: McpToolCatalogService,
    workflows: WorkflowService,
    workspace_sync: WorkspaceSyncService,
}

impl AppState {
    /// 使用当前系统 home 目录初始化应用状态。
    pub fn initialize() -> AppResult<Self> {
        Self::initialize_with_paths(KerminalPaths::from_environment_or_current_home()?)
    }

    /// 使用指定路径初始化应用状态，主要用于测试和未来 portable 模式。
    pub fn initialize_with_paths(paths: KerminalPaths) -> AppResult<Self> {
        let storage = RuntimeFileStore::open(&paths)?;
        let command_store = CommandSqliteStore::open(&paths)?;
        ExternalAgentWorkspaceService::new(paths.root.clone(), None, false)
            .ensure_default_agent_files()?;
        let credentials = CredentialService::new();
        let agent_context = AgentContextService::new();
        let agent_sessions = AgentSessionService::new(paths.root.clone());
        let mcp_tool_executor = McpToolExecutorService::new();
        let command_history = CommandHistoryService::new();
        let command_suggestions = CommandSuggestionService::new();
        let mcp_http_server = McpStreamableHttpServerService::new();
        let diagnostics = DiagnosticsService::new();
        let docker_hosts = DockerHostService::new();
        let external_launch_intake = ExternalLaunchIntake::new();
        let external_launch_tasks = ExternalLaunchTaskRegistry::new();
        let local_network_proxy = LocalNetworkProxyService::new();
        let config_files = ConfigFileStore::new(paths.root.clone());
        let workspace_sync = WorkspaceSyncService::new(paths.clone());
        workspace_sync.ensure_bootstrap()?;
        let settings = SettingsService::new(config_files.clone());
        settings.ensure_seed_settings()?;
        let persisted_settings = settings.load_settings()?;
        external_launch_intake.configure_policy(ExternalLaunchPolicy::from(
            &persisted_settings.external_launch,
        ))?;
        let profiles = ProfileService::new(config_files.clone());
        profiles.ensure_seed_profiles()?;
        let remote_hosts = RemoteHostService::new(config_files.clone());
        let serial_terminals = SerialTerminalService::new();
        let ssh_auth_broker = SshAuthBroker::new();
        let ssh_runtime =
            ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new()));
        let external_session_materializer = ExternalSessionMaterializer::with_remote_hosts(
            external_launch_intake.clone(),
            ssh_auth_broker.clone(),
            remote_hosts.clone(),
        );
        let port_forwards = PortForwardService::with_ssh_runtime(
            ssh_runtime.clone(),
            ssh_auth_broker.clone(),
            external_session_materializer.clone(),
        );
        let server_info = ServerInfoService::new();
        let sftp = SftpService::with_ssh_runtime(
            ssh_runtime.clone(),
            ssh_auth_broker.clone(),
            external_session_materializer.clone(),
        );
        let snippets = SnippetService::new(config_files.clone());
        let ssh_commands = SshCommandService::with_ssh_runtime(
            ssh_runtime.clone(),
            ssh_auth_broker.clone(),
            external_session_materializer.clone(),
        );
        let ssh_terminals = SshTerminalService::with_ssh_runtime(
            ssh_runtime.clone(),
            ssh_auth_broker.clone(),
            external_session_materializer.clone(),
        );
        ssh_terminals.cleanup_temporary_identity_files(&paths)?;
        let telnet_terminals = TelnetTerminalService::new();
        let mcp_tool_catalog = McpToolCatalogService::new();
        let tmux = TmuxService::new();
        let workflows = WorkflowService::new(config_files.clone());
        let config_change_observer = ConfigChangeObserverService::new(config_files);
        let shell_integration_cache = paths.cache.clone();

        Ok(Self {
            agent_context,
            agent_sessions,
            mcp_tool_executor,
            command_history,
            command_store,
            command_suggestions,
            config_change_observer,
            credentials,
            diagnostics,
            docker_hosts,
            external_launch_intake,
            external_launch_tasks,
            external_session_materializer,
            local_network_proxy,
            mcp_http_server,
            paths,
            port_forwards,
            profiles,
            remote_hosts,
            serial_terminals,
            server_info,
            settings,
            sftp,
            snippets,
            ssh_auth_broker,
            ssh_commands,
            ssh_runtime,
            ssh_terminals,
            telnet_terminals,
            storage,
            terminal_session_bindings: TerminalSessionBindingService::default(),
            terminals: TerminalManager::with_shell_integration_cache_dir(shell_integration_cache),
            tmux,
            mcp_tool_catalog,
            workflows,
            workspace_sync,
        })
    }

    /// 返回本地数据目录集合。
    pub fn paths(&self) -> &KerminalPaths {
        &self.paths
    }

    /// 返回外部 Agent / MCP 上下文服务。
    pub fn agent_context(&self) -> &AgentContextService {
        &self.agent_context
    }

    /// 返回外部 Agent session 文件服务。
    pub fn agent_sessions(&self) -> &AgentSessionService {
        &self.agent_sessions
    }

    /// 返回 MCP tool 直接执行器。
    pub fn mcp_tool_executor(&self) -> &McpToolExecutorService {
        &self.mcp_tool_executor
    }

    /// 返回命令历史服务。
    pub fn command_history(&self) -> &CommandHistoryService {
        &self.command_history
    }

    /// 返回命令历史和命令建议专用 SQLite 存储。
    pub fn command_store(&self) -> &CommandSqliteStore {
        &self.command_store
    }

    /// 返回命令建议服务。
    pub fn command_suggestions(&self) -> &CommandSuggestionService {
        &self.command_suggestions
    }

    /// 返回文件型配置变更观察服务。
    pub fn config_change_observer(&self) -> &ConfigChangeObserverService {
        &self.config_change_observer
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

    /// 返回外部 SSH 启动 intake 服务。
    pub fn external_launch_intake(&self) -> &ExternalLaunchIntake {
        &self.external_launch_intake
    }

    /// 返回 external SSH 创建任务注册表。
    pub fn external_launch_tasks(&self) -> &ExternalLaunchTaskRegistry {
        &self.external_launch_tasks
    }

    /// 返回外部 SSH 启动临时 target materializer。
    pub fn external_session_materializer(&self) -> &ExternalSessionMaterializer {
        &self.external_session_materializer
    }

    /// 返回本机共享网络代理服务。
    pub fn local_network_proxy(&self) -> &LocalNetworkProxyService {
        &self.local_network_proxy
    }

    /// 返回 Streamable HTTP MCP Server 生命周期服务。
    pub fn mcp_http_server(&self) -> &McpStreamableHttpServerService {
        &self.mcp_http_server
    }

    /// 返回 SSH 端口转发服务。
    pub fn port_forwards(&self) -> &PortForwardService {
        &self.port_forwards
    }

    /// 返回运行态文件存储入口。
    pub fn storage(&self) -> &RuntimeFileStore {
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

    /// 更新应用设置并同步需要立即生效的运行态策略。
    pub fn update_settings(&self, request: AppSettings) -> AppResult<AppSettings> {
        let settings = self.settings.update_settings(request)?;
        self.external_launch_intake
            .configure_policy(ExternalLaunchPolicy::from(&settings.external_launch))?;
        Ok(settings)
    }

    /// 返回 SFTP 文件工具服务。
    pub fn sftp(&self) -> &SftpService {
        &self.sftp
    }

    /// 返回脚本片段服务。
    pub fn snippets(&self) -> &SnippetService {
        &self.snippets
    }

    /// 返回 SSH 认证 broker。
    pub fn ssh_auth_broker(&self) -> &SshAuthBroker {
        &self.ssh_auth_broker
    }

    /// 返回 SSH 非交互命令服务。
    pub fn ssh_commands(&self) -> &SshCommandService {
        &self.ssh_commands
    }

    /// 返回受管 SSH 会话运行时。
    pub fn ssh_runtime(&self) -> &ManagedSshSessionManager {
        &self.ssh_runtime
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

    /// 返回 tmux 管理服务。
    pub fn tmux(&self) -> &TmuxService {
        &self.tmux
    }

    /// 返回 Kerminal MCP tool catalog。
    pub fn mcp_tool_catalog(&self) -> &McpToolCatalogService {
        &self.mcp_tool_catalog
    }

    /// 返回命令工作流服务。
    pub fn workflows(&self) -> &WorkflowService {
        &self.workflows
    }

    /// 返回工作空间同步与 encrypted vault bootstrap 服务。
    pub fn workspace_sync(&self) -> &WorkspaceSyncService {
        &self.workspace_sync
    }
}
