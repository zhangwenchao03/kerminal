//! SFTP native 后端、连接认证和端点解析。
//!
//! @author kongweiguang

use std::{
    io,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use russh::{
    client,
    keys::{
        self, agent::AgentIdentity, load_secret_key, PrivateKey, PrivateKeyWithHashAlg, PublicKey,
    },
    ChannelMsg,
};
use russh_sftp::{
    client::{Config as NativeSftpConfig, SftpSession},
    protocol::FileAttributes,
};
use serde::Deserialize;
use tokio::io::AsyncReadExt;

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType},
        settings::SftpPerformanceSettings,
        sftp::{
            SftpDirectoryListing, SftpFilePreview, SftpManagedTransferRequest, SftpPathStat,
            SftpReadTextFileResponse, SftpRemoteCopyRequest, SftpTransferDirection,
            SftpTransferKind, SftpWriteTextFileRequest, SftpWriteTextFileResponse,
        },
    },
    paths::KerminalPaths,
    services::credential_service::CredentialService,
    storage::SqliteStore,
};

use super::remote_text::{
    read_remote_text_file, sftp_entry_from_native, sftp_entry_kind_rank, stat_remote_path,
    write_remote_text_file,
};
use super::transfer_io::{
    copy_remote_directory_between_sessions, copy_remote_file_between_sessions, download_directory,
    download_file, upload_directory, upload_file,
};
use super::transfer_paths::parent_remote_path;
use super::TransferProgress;

const DIRECTORY_DELETE_ERROR_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct SftpRuntimeSettings {
    pub(super) global_transfers: usize,
    pub(super) host_transfers: usize,
    pub(super) pipeline_depth: usize,
    pub(super) packet_bytes: u32,
    pub(super) timeout_seconds: u64,
}

impl Default for SftpRuntimeSettings {
    fn default() -> Self {
        Self::from(SftpPerformanceSettings::default())
    }
}

impl From<SftpPerformanceSettings> for SftpRuntimeSettings {
    fn from(settings: SftpPerformanceSettings) -> Self {
        let settings = settings.normalized();
        Self {
            global_transfers: settings.global_transfers,
            host_transfers: settings.host_transfers,
            pipeline_depth: settings.pipeline_depth,
            packet_bytes: settings.packet_bytes,
            timeout_seconds: u64::from(settings.timeout_seconds),
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct SftpEndpoint {
    pub(super) host: RemoteHost,
    pub(super) auth: SftpAuthMaterial,
    pub(super) known_hosts_path: PathBuf,
}

#[derive(Debug, Clone)]
pub(super) enum SftpAuthMaterial {
    Agent,
    Password(String),
    PrivateKey(SftpPrivateKey),
}

#[derive(Debug, Clone)]
pub(super) enum SftpPrivateKey {
    Path(PathBuf),
    Pem {
        content: String,
        passphrase: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPrivateKey {
    private_key: String,
    passphrase: Option<String>,
}

#[async_trait]
pub(super) trait SftpBackend: Send + Sync + 'static {
    async fn list_directory(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpDirectoryListing>;

    async fn create_directory(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()>;

    async fn preview_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        max_bytes: usize,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpFilePreview>;

    async fn read_text_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        max_bytes: usize,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpReadTextFileResponse>;

    async fn write_text_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        request: SftpWriteTextFileRequest,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpWriteTextFileResponse>;

    async fn stat_path(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpPathStat>;

    async fn delete(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        directory: bool,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()>;

    async fn rename(
        &self,
        endpoint: SftpEndpoint,
        from_path: String,
        to_path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()>;

    async fn chmod(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        mode: u32,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()>;

    async fn transfer(
        &self,
        endpoint: SftpEndpoint,
        request: SftpManagedTransferRequest,
        progress: TransferProgress,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()>;

    async fn remote_copy(
        &self,
        source_endpoint: SftpEndpoint,
        target_endpoint: SftpEndpoint,
        request: SftpRemoteCopyRequest,
        progress: TransferProgress,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()>;
}

#[derive(Debug, Default)]
pub(super) struct RusshSftpBackend;

#[async_trait]
impl SftpBackend for RusshSftpBackend {
    async fn list_directory(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpDirectoryListing> {
        let session = connect_native_sftp(&endpoint, settings).await?;
        let entries = session
            .sftp
            .read_dir(path.clone())
            .await
            .map_err(native_sftp_error)?;
        let mut mapped = Vec::new();
        for entry in entries {
            mapped.push(sftp_entry_from_native(&entry));
        }
        mapped.sort_by(|left, right| {
            sftp_entry_kind_rank(&left.kind)
                .cmp(&sftp_entry_kind_rank(&right.kind))
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(SftpDirectoryListing {
            host_id: endpoint.host.id,
            parent_path: parent_remote_path(&path),
            path,
            entries: mapped,
        })
    }

    async fn create_directory(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        let session = connect_native_sftp(&endpoint, settings).await?;
        session
            .sftp
            .create_dir(path)
            .await
            .map_err(native_sftp_error)
    }

    async fn preview_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        max_bytes: usize,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpFilePreview> {
        let session = connect_native_sftp(&endpoint, settings).await?;
        let file = session
            .sftp
            .open(path.clone())
            .await
            .map_err(native_sftp_error)?;
        let read_limit = max_bytes.saturating_add(1);
        let mut bytes = Vec::with_capacity(read_limit);
        let mut reader = file.take(read_limit as u64);
        reader
            .read_to_end(&mut bytes)
            .await
            .map_err(io_sftp_error)?;
        let truncated = bytes.len() > max_bytes;
        let visible_bytes = if truncated {
            &bytes[..max_bytes]
        } else {
            bytes.as_slice()
        };

        Ok(SftpFilePreview {
            host_id: endpoint.host.id,
            path,
            content: String::from_utf8_lossy(visible_bytes).into_owned(),
            bytes_read: visible_bytes.len(),
            max_bytes,
            truncated,
            encoding: "utf-8-lossy".to_owned(),
        })
    }

    async fn read_text_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        max_bytes: usize,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpReadTextFileResponse> {
        let session = connect_native_sftp(&endpoint, settings).await?;
        read_remote_text_file(&session.sftp, endpoint.host.id, path, max_bytes).await
    }

    async fn write_text_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        request: SftpWriteTextFileRequest,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpWriteTextFileResponse> {
        let session = connect_native_sftp(&endpoint, settings).await?;
        write_remote_text_file(&session.sftp, endpoint.host.id, path, request).await
    }

    async fn stat_path(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpPathStat> {
        let session = connect_native_sftp(&endpoint, settings).await?;
        stat_remote_path(&session.sftp, endpoint.host.id, path).await
    }

    async fn delete(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        directory: bool,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        if directory {
            return remove_remote_directory_with_shell(&endpoint, &path, settings).await;
        }

        let session = connect_native_sftp(&endpoint, settings).await?;
        session
            .sftp
            .remove_file(path)
            .await
            .map_err(native_sftp_error)
    }

    async fn rename(
        &self,
        endpoint: SftpEndpoint,
        from_path: String,
        to_path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        let session = connect_native_sftp(&endpoint, settings).await?;
        session
            .sftp
            .rename(from_path, to_path)
            .await
            .map_err(native_sftp_error)
    }

    async fn chmod(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        mode: u32,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        let session = connect_native_sftp(&endpoint, settings).await?;
        let mut attrs = FileAttributes::empty();
        attrs.permissions = Some(mode);
        session
            .sftp
            .set_metadata(path, attrs)
            .await
            .map_err(native_sftp_error)
    }

    async fn transfer(
        &self,
        endpoint: SftpEndpoint,
        request: SftpManagedTransferRequest,
        progress: TransferProgress,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        progress.ensure_not_cancelled()?;
        let session = connect_native_sftp(&endpoint, settings).await?;
        match (request.direction, request.kind) {
            (SftpTransferDirection::Upload, SftpTransferKind::File) => {
                upload_file(
                    &session.sftp,
                    Path::new(&request.local_path),
                    &request.remote_path,
                    &progress,
                    settings,
                    true,
                )
                .await
            }
            (SftpTransferDirection::Upload, SftpTransferKind::Directory) => {
                upload_directory(
                    &session.sftp,
                    Path::new(&request.local_path),
                    &request.remote_path,
                    &progress,
                    settings,
                )
                .await
            }
            (SftpTransferDirection::Download, SftpTransferKind::File) => {
                download_file(
                    &session.sftp,
                    &request.remote_path,
                    Path::new(&request.local_path),
                    &progress,
                    settings,
                    true,
                )
                .await
            }
            (SftpTransferDirection::Download, SftpTransferKind::Directory) => {
                download_directory(
                    &session.sftp,
                    &request.remote_path,
                    Path::new(&request.local_path),
                    &progress,
                    settings,
                )
                .await
            }
        }
    }

    async fn remote_copy(
        &self,
        source_endpoint: SftpEndpoint,
        target_endpoint: SftpEndpoint,
        request: SftpRemoteCopyRequest,
        progress: TransferProgress,
        settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        progress.ensure_not_cancelled()?;
        let source_session = connect_native_sftp(&source_endpoint, settings).await?;
        if request.source_host_id == request.target_host_id {
            return match request.kind {
                SftpTransferKind::File => {
                    copy_remote_file_between_sessions(
                        &source_session.sftp,
                        &request.source_remote_path,
                        &source_session.sftp,
                        &request.target_remote_path,
                        &progress,
                        settings,
                        true,
                    )
                    .await
                }
                SftpTransferKind::Directory => {
                    copy_remote_directory_between_sessions(
                        &source_session.sftp,
                        &request.source_remote_path,
                        &source_session.sftp,
                        &request.target_remote_path,
                        &progress,
                        settings,
                    )
                    .await
                }
            };
        }

        let target_session = connect_native_sftp(&target_endpoint, settings).await?;
        match request.kind {
            SftpTransferKind::File => {
                copy_remote_file_between_sessions(
                    &source_session.sftp,
                    &request.source_remote_path,
                    &target_session.sftp,
                    &request.target_remote_path,
                    &progress,
                    settings,
                    true,
                )
                .await
            }
            SftpTransferKind::Directory => {
                copy_remote_directory_between_sessions(
                    &source_session.sftp,
                    &request.source_remote_path,
                    &target_session.sftp,
                    &request.target_remote_path,
                    &progress,
                    settings,
                )
                .await
            }
        }
    }
}

struct NativeSftpConnection {
    _ssh: client::Handle<NativeClientHandler>,
    sftp: SftpSession,
}

#[derive(Debug)]
pub(super) struct NativeClientHandler {
    pub(super) host: String,
    pub(super) port: u16,
    pub(super) known_hosts_path: PathBuf,
    pub(super) host_key_policy: HostKeyPolicy,
}

#[derive(Debug, Clone, Copy)]
pub(super) enum HostKeyPolicy {
    RequireKnown,
    TrustUnknown,
}

impl client::Handler for NativeClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        match keys::known_hosts::check_known_hosts_path(
            &self.host,
            self.port,
            server_public_key,
            &self.known_hosts_path,
        ) {
            Ok(true) => Ok(true),
            Ok(false) => match self.host_key_policy {
                HostKeyPolicy::RequireKnown => Ok(false),
                HostKeyPolicy::TrustUnknown => Ok(keys::known_hosts::learn_known_hosts_path(
                    &self.host,
                    self.port,
                    server_public_key,
                    &self.known_hosts_path,
                )
                .is_ok()),
            },
            Err(_) => Ok(false),
        }
    }
}

async fn connect_native_sftp(
    endpoint: &SftpEndpoint,
    settings: SftpRuntimeSettings,
) -> AppResult<NativeSftpConnection> {
    let mut ssh = connect_native_ssh(
        &endpoint.host,
        endpoint.known_hosts_path.clone(),
        HostKeyPolicy::RequireKnown,
        settings,
    )
    .await?;

    authenticate_native_sftp(&mut ssh, endpoint).await?;

    let channel = ssh.channel_open_session().await.map_err(native_ssh_error)?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(native_ssh_error)?;
    let sftp = SftpSession::new_with_config(
        channel.into_stream(),
        NativeSftpConfig {
            max_packet_len: settings.packet_bytes,
            max_concurrent_writes: settings.pipeline_depth,
            request_timeout_secs: settings.timeout_seconds,
        },
    )
    .await
    .map_err(native_sftp_error)?;
    Ok(NativeSftpConnection { _ssh: ssh, sftp })
}

async fn connect_native_ssh(
    host: &RemoteHost,
    known_hosts_path: PathBuf,
    host_key_policy: HostKeyPolicy,
    settings: SftpRuntimeSettings,
) -> AppResult<client::Handle<NativeClientHandler>> {
    let config = client::Config {
        inactivity_timeout: Some(Duration::from_secs(settings.timeout_seconds)),
        ..Default::default()
    };
    let handler = NativeClientHandler {
        host: host.host.clone(),
        port: host.port,
        known_hosts_path,
        host_key_policy,
    };
    client::connect(Arc::new(config), (host.host.as_str(), host.port), handler)
        .await
        .map_err(native_ssh_error)
}

pub(super) async fn trust_native_host_key(
    host: &RemoteHost,
    known_hosts_path: &Path,
    settings: SftpRuntimeSettings,
) -> AppResult<()> {
    let ssh = connect_native_ssh(
        host,
        known_hosts_path.to_path_buf(),
        HostKeyPolicy::TrustUnknown,
        settings,
    )
    .await?;
    let _ = ssh
        .disconnect(russh::Disconnect::ByApplication, "host key trusted", "")
        .await;
    Ok(())
}

async fn remove_remote_directory_with_shell(
    endpoint: &SftpEndpoint,
    path: &str,
    settings: SftpRuntimeSettings,
) -> AppResult<()> {
    validate_remote_directory_shell_delete_path(path)?;
    let script = format!("rm -rf -- {}\n", shell_single_quote(path));
    let mut ssh = connect_native_ssh(
        &endpoint.host,
        endpoint.known_hosts_path.clone(),
        HostKeyPolicy::RequireKnown,
        settings,
    )
    .await?;
    authenticate_native_sftp(&mut ssh, endpoint).await?;

    let mut channel = ssh.channel_open_session().await.map_err(native_ssh_error)?;
    channel
        .exec(true, "sh -s")
        .await
        .map_err(native_ssh_error)?;
    channel
        .data_bytes(script.into_bytes())
        .await
        .map_err(native_ssh_error)?;
    channel.eof().await.map_err(native_ssh_error)?;

    let mut stderr = Vec::new();
    let mut exit_code = None;
    let mut exec_request_failed = false;
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::ExtendedData { data, .. } => {
                push_limited_bytes(&mut stderr, data.as_ref(), DIRECTORY_DELETE_ERROR_BYTES);
            }
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = i32::try_from(exit_status).ok();
            }
            ChannelMsg::ExitSignal {
                signal_name,
                error_message,
                ..
            } => {
                if !error_message.trim().is_empty() {
                    push_limited_bytes(
                        &mut stderr,
                        error_message.as_bytes(),
                        DIRECTORY_DELETE_ERROR_BYTES,
                    );
                    push_limited_bytes(&mut stderr, b"\n", DIRECTORY_DELETE_ERROR_BYTES);
                }
                push_limited_bytes(
                    &mut stderr,
                    format!("remote process terminated by signal: {signal_name:?}\n").as_bytes(),
                    DIRECTORY_DELETE_ERROR_BYTES,
                );
            }
            ChannelMsg::Failure => {
                exec_request_failed = true;
            }
            ChannelMsg::Close => break,
            _ => {}
        }
    }

    let _ = channel.close().await;
    let _ = ssh
        .disconnect(russh::Disconnect::ByApplication, "directory deleted", "")
        .await;

    if exec_request_failed {
        return Err(AppError::Sftp("远端拒绝执行目录递归删除命令".to_owned()));
    }
    if exit_code == Some(0) {
        return Ok(());
    }

    let detail = String::from_utf8_lossy(&stderr).trim().to_owned();
    let exit_detail = exit_code
        .map(|code| format!("退出码 {code}"))
        .unwrap_or_else(|| "退出码未知".to_owned());
    if detail.is_empty() {
        Err(AppError::Sftp(format!(
            "远程目录递归删除失败: {exit_detail}"
        )))
    } else {
        Err(AppError::Sftp(format!(
            "远程目录递归删除失败: {exit_detail}: {detail}"
        )))
    }
}

pub(super) fn validate_remote_directory_shell_delete_path(path: &str) -> AppResult<()> {
    if !path.starts_with('/') {
        return Err(AppError::InvalidInput(
            "目录递归删除需要使用绝对远程路径".to_owned(),
        ));
    }
    if path == "/" {
        return Err(AppError::InvalidInput(
            "不允许对远程根目录执行该操作".to_owned(),
        ));
    }
    if path.split('/').any(|segment| segment == "..") {
        return Err(AppError::InvalidInput(
            "目录递归删除路径不能包含 .. 路径段".to_owned(),
        ));
    }
    Ok(())
}

pub(super) fn shell_single_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_owned();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn push_limited_bytes(buffer: &mut Vec<u8>, bytes: &[u8], max_bytes: usize) {
    let remaining = max_bytes.saturating_sub(buffer.len());
    if remaining == 0 {
        return;
    }
    buffer.extend_from_slice(&bytes[..bytes.len().min(remaining)]);
}

async fn authenticate_native_sftp(
    ssh: &mut client::Handle<NativeClientHandler>,
    endpoint: &SftpEndpoint,
) -> AppResult<()> {
    let username = endpoint.host.username.clone();
    let authenticated = match &endpoint.auth {
        SftpAuthMaterial::Password(password) => ssh
            .authenticate_password(username, password.clone())
            .await
            .map_err(native_ssh_error)?
            .success(),
        SftpAuthMaterial::PrivateKey(private_key) => {
            let key = load_private_key(private_key)?;
            let hash = ssh
                .best_supported_rsa_hash()
                .await
                .map_err(native_ssh_error)?
                .flatten();
            ssh.authenticate_publickey(username, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await
                .map_err(native_ssh_error)?
                .success()
        }
        SftpAuthMaterial::Agent => authenticate_with_agent(ssh, username).await?,
    };

    if authenticated {
        Ok(())
    } else {
        Err(AppError::Sftp(format!(
            "SSH 认证失败: {}@{}:{}",
            endpoint.host.username, endpoint.host.host, endpoint.host.port
        )))
    }
}

async fn authenticate_with_agent(
    ssh: &mut client::Handle<NativeClientHandler>,
    username: String,
) -> AppResult<bool> {
    let mut agent = connect_agent().await?;
    let identities = agent.request_identities().await.map_err(agent_error)?;
    for identity in identities {
        let key = match &identity {
            AgentIdentity::PublicKey { key, .. } => key.clone(),
            AgentIdentity::Certificate { .. } => identity.public_key().into_owned(),
        };
        let hash = ssh
            .best_supported_rsa_hash()
            .await
            .map_err(native_ssh_error)?
            .flatten();
        let result = ssh
            .authenticate_publickey_with(username.clone(), key, hash, &mut agent)
            .await
            .map_err(|error| AppError::Sftp(format!("SSH agent 认证失败: {error}")))?;
        if result.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(unix)]
async fn connect_agent() -> AppResult<
    keys::agent::client::AgentClient<Box<dyn keys::agent::client::AgentStream + Send + Unpin>>,
> {
    keys::agent::client::AgentClient::connect_env()
        .await
        .map(|client| client.dynamic())
        .map_err(agent_error)
}

#[cfg(windows)]
async fn connect_agent() -> AppResult<
    keys::agent::client::AgentClient<Box<dyn keys::agent::client::AgentStream + Send + Unpin>>,
> {
    const OPENSSH_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

    match keys::agent::client::AgentClient::connect_named_pipe(OPENSSH_AGENT_PIPE).await {
        Ok(client) => Ok(client.dynamic()),
        Err(openssh_error) => keys::agent::client::AgentClient::connect_pageant()
            .await
            .map(|client| client.dynamic())
            .map_err(|pageant_error| {
                AppError::Sftp(format!(
                    "SSH agent 连接失败: OpenSSH agent ({OPENSSH_AGENT_PIPE}) {openssh_error}; Pageant {pageant_error}"
                ))
            }),
    }
}

#[cfg(not(any(unix, windows)))]
async fn connect_agent() -> AppResult<
    keys::agent::client::AgentClient<Box<dyn keys::agent::client::AgentStream + Send + Unpin>>,
> {
    Err(AppError::Sftp(
        "当前平台不支持 SSH agent 认证，请改用密码或私钥凭据".to_owned(),
    ))
}

fn load_private_key(private_key: &SftpPrivateKey) -> AppResult<PrivateKey> {
    match private_key {
        SftpPrivateKey::Path(path) => load_secret_key(path, None).map_err(key_error),
        SftpPrivateKey::Pem {
            content,
            passphrase,
        } => keys::decode_secret_key(content, passphrase.as_deref()).map_err(key_error),
    }
}

pub(super) fn resolve_endpoint(
    storage: &SqliteStore,
    credentials: &CredentialService,
    paths: &KerminalPaths,
    host_id: &str,
) -> AppResult<SftpEndpoint> {
    let host = resolve_host(storage, host_id)?;
    let auth = resolve_auth_material(&host, credentials)?;
    Ok(SftpEndpoint {
        host,
        auth,
        known_hosts_path: paths.root.join("known_hosts"),
    })
}

pub(super) fn load_sftp_runtime_settings(storage: &SqliteStore) -> AppResult<SftpRuntimeSettings> {
    Ok(SftpRuntimeSettings::from(storage.load_app_settings()?.sftp))
}

pub(super) fn resolve_host(storage: &SqliteStore, host_id: &str) -> AppResult<RemoteHost> {
    storage
        .remote_host_by_id(host_id)?
        .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {host_id}")))
}

fn resolve_auth_material(
    host: &RemoteHost,
    credentials: &CredentialService,
) -> AppResult<SftpAuthMaterial> {
    match host.auth_type {
        RemoteHostAuthType::Agent => Ok(SftpAuthMaterial::Agent),
        RemoteHostAuthType::Password => {
            let credential_ref = required_credential_ref(host)?;
            let password = credentials.get_secret(credential_ref)?.ok_or_else(|| {
                AppError::Credential(format!("未找到 SSH 密码凭据: {credential_ref}"))
            })?;
            Ok(SftpAuthMaterial::Password(password))
        }
        RemoteHostAuthType::Key => {
            let credential_ref = required_credential_ref(host)?;
            if credential_ref.starts_with("credential:") {
                let secret = credentials.get_secret(credential_ref)?.ok_or_else(|| {
                    AppError::Credential(format!("未找到 SSH 私钥凭据: {credential_ref}"))
                })?;
                return Ok(SftpAuthMaterial::PrivateKey(parse_private_key_secret(
                    &secret,
                )));
            }
            Ok(SftpAuthMaterial::PrivateKey(SftpPrivateKey::Path(
                PathBuf::from(credential_ref),
            )))
        }
    }
}

fn required_credential_ref(host: &RemoteHost) -> AppResult<&str> {
    host.credential_ref
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::InvalidInput("该 SSH 认证方式需要配置凭据引用".to_owned()))
}

fn parse_private_key_secret(secret: &str) -> SftpPrivateKey {
    serde_json::from_str::<StoredPrivateKey>(secret)
        .map(|stored| SftpPrivateKey::Pem {
            content: stored.private_key,
            passphrase: stored.passphrase,
        })
        .unwrap_or_else(|_| SftpPrivateKey::Pem {
            content: secret.to_owned(),
            passphrase: None,
        })
}

fn native_ssh_error(error: russh::Error) -> AppError {
    AppError::Sftp(format!("SSH 连接失败: {error}"))
}

pub(super) fn native_sftp_error(error: russh_sftp::client::error::Error) -> AppError {
    AppError::Sftp(format!("SFTP 协议失败: {error}"))
}

pub(super) fn io_sftp_error(error: io::Error) -> AppError {
    AppError::Sftp(format!("SFTP 本地 I/O 失败: {error}"))
}

fn key_error(error: keys::Error) -> AppError {
    AppError::Sftp(format!("SSH 私钥加载失败: {error}"))
}

fn agent_error(error: keys::Error) -> AppError {
    AppError::Sftp(format!("SSH agent 连接失败: {error}"))
}
