//! AppState 的远程连接能力组合。
//!
//! 此模块集中拥有共享 SSH runtime、认证 broker 和依赖它们的远程服务，避免
//! AppState 构造函数分散复制同一条依赖链。
//!
//! @author kongweiguang

use crate::{
    error::AppResult,
    paths::KerminalPaths,
    services::{
        docker_host_service::DockerHostService,
        external_launch::{ExternalLaunchIntake, ExternalSessionMaterializer},
        port_forward_service::PortForwardService,
        remote_host_service::RemoteHostService,
        serial_terminal_service::SerialTerminalService,
        server_info_service::ServerInfoService,
        sftp_service::SftpService,
        ssh_command_service::SshCommandService,
        ssh_runtime::{auth_broker::SshAuthBroker, ManagedSshSessionManager},
        ssh_terminal_service::SshTerminalService,
        telnet_terminal_service::TelnetTerminalService,
        tmux_service::TmuxService,
    },
    storage::config_file_store::ConfigFileStore,
};

use super::AppStateExternalPorts;

/// 共用 SSH runtime 的远程服务集合。
#[derive(Debug)]
pub(super) struct RemoteCapabilities {
    pub(super) docker_hosts: DockerHostService,
    pub(super) external_session_materializer: ExternalSessionMaterializer,
    pub(super) port_forwards: PortForwardService,
    pub(super) remote_hosts: RemoteHostService,
    pub(super) serial_terminals: SerialTerminalService,
    pub(super) server_info: ServerInfoService,
    pub(super) sftp: SftpService,
    pub(super) ssh_auth_broker: SshAuthBroker,
    pub(super) ssh_commands: SshCommandService,
    pub(super) ssh_runtime: ManagedSshSessionManager,
    pub(super) ssh_terminals: SshTerminalService,
    pub(super) telnet_terminals: TelnetTerminalService,
    pub(super) tmux: TmuxService,
}

impl RemoteCapabilities {
    /// 创建共享认证/runtime 链路和所有依赖它的能力。
    pub(super) fn new(
        paths: &KerminalPaths,
        config_files: ConfigFileStore,
        external_launch_intake: ExternalLaunchIntake,
        external_ports: &dyn AppStateExternalPorts,
    ) -> AppResult<Self> {
        let remote_hosts = RemoteHostService::new(config_files);
        let ssh_auth_broker = SshAuthBroker::new();
        let ssh_runtime = external_ports.create_ssh_runtime()?;
        let external_session_materializer = ExternalSessionMaterializer::with_remote_hosts(
            external_launch_intake,
            ssh_auth_broker.clone(),
            remote_hosts.clone(),
        );
        let port_forwards = PortForwardService::with_ssh_runtime(
            ssh_runtime.clone(),
            ssh_auth_broker.clone(),
            external_session_materializer.clone(),
        );
        let sftp = SftpService::with_ssh_runtime(
            ssh_runtime.clone(),
            ssh_auth_broker.clone(),
            external_session_materializer.clone(),
        );
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
        ssh_terminals.cleanup_temporary_identity_files(paths)?;

        Ok(Self {
            docker_hosts: DockerHostService::new(),
            external_session_materializer,
            port_forwards,
            remote_hosts,
            serial_terminals: SerialTerminalService::new(),
            server_info: ServerInfoService::new(),
            sftp,
            ssh_auth_broker,
            ssh_commands,
            ssh_runtime,
            ssh_terminals,
            telnet_terminals: TelnetTerminalService::new(),
            tmux: TmuxService::new(),
        })
    }
}
