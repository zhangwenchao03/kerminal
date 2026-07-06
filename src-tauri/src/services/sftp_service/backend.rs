//! SFTP native 后端、连接认证和端点解析。
//!
//! @author kongweiguang

use std::{
    fmt, io,
    path::{Path, PathBuf},
};

use async_trait::async_trait;
use russh::ChannelMsg;
use russh_sftp::{
    client::{Config as NativeSftpConfig, SftpSession},
    protocol::FileAttributes,
};
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
    services::{
        encrypted_vault_service::EncryptedVaultService,
        external_launch::{is_external_target_id, ExternalSessionMaterializer},
        ssh_credential_resolver::{ResolvedSshRouteAuth, SshCredentialResolver},
        ssh_identity_file::resolve_identity_file_path,
        ssh_runtime::{
            auth_broker::{SshAuthBroker, SshAuthBrokerResolution, SshAuthPromptPlan},
            session_key::{redacted_fingerprint_text, ssh_session_key_for_route},
            ManagedSshSessionManager, ManagedSshSftpChannel, SshRuntimeConnectRequest,
            SshRuntimeExecOutput, SshRuntimeExecRequest, SshRuntimeHostKeyPolicy,
            MANAGED_SSH_EXEC_UNSUPPORTED, MANAGED_SSH_SFTP_UNSUPPORTED,
        },
    },
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};

use super::native_ssh::{connect_native_ssh_chain, NativeSftpSshConnection};
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
const LEGACY_FALLBACK_SFTP_UNWIRED: &str = "managed-sftp-unwired";
const LEGACY_FALLBACK_SFTP_UNSUPPORTED: &str = "managed-sftp-unsupported";
const LEGACY_FALLBACK_SFTP_EXEC_UNWIRED: &str = "managed-sftp-directory-exec-unwired";
const LEGACY_FALLBACK_SFTP_EXEC_UNSUPPORTED: &str = "managed-sftp-directory-exec-unsupported";
const EXTERNAL_BULK_TRANSFER_PIPELINE_DEPTH: usize = 8;
const EXTERNAL_BULK_TRANSFER_PACKET_BYTES: u32 = 64 * 1024;
const EXTERNAL_BULK_TRANSFER_TIMEOUT_SECONDS: u64 = 180;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SftpManagedSessionLane {
    Interactive,
    BulkTransfer,
}

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

impl SftpRuntimeSettings {
    pub(super) fn for_bulk_transfer_target(self, endpoint: &SftpEndpoint) -> Self {
        if is_external_target_id(&endpoint.host.id) {
            return self.for_external_bulk_transfer();
        }
        self
    }

    pub(super) fn for_external_bulk_transfer(mut self) -> Self {
        self.host_transfers = 1;
        self.pipeline_depth = self
            .pipeline_depth
            .min(EXTERNAL_BULK_TRANSFER_PIPELINE_DEPTH);
        self.packet_bytes = self.packet_bytes.min(EXTERNAL_BULK_TRANSFER_PACKET_BYTES);
        self.timeout_seconds = self
            .timeout_seconds
            .max(EXTERNAL_BULK_TRANSFER_TIMEOUT_SECONDS);
        self
    }
}

#[derive(Clone)]
pub(super) struct SftpEndpoint {
    pub(super) host: RemoteHost,
    pub(super) auth: SftpAuthMaterial,
    pub(super) known_hosts_path: PathBuf,
    pub(super) route_auth: ResolvedSshRouteAuth,
}

impl fmt::Debug for SftpEndpoint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SftpEndpoint")
            .field("host_id", &self.host.id)
            .field("host", &self.host.host)
            .field("port", &self.host.port)
            .field("username", &self.host.username)
            .field("auth", &self.auth)
            .field("known_hosts_path", &"<workspace-known-hosts>")
            .field("route_auth", &self.route_auth.summary)
            .finish()
    }
}

#[derive(Clone)]
pub(super) enum SftpAuthMaterial {
    Agent,
    Password(String),
    PrivateKey(SftpPrivateKey),
}

impl fmt::Debug for SftpAuthMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Agent => formatter.write_str("Agent"),
            Self::Password(_) => formatter
                .debug_tuple("Password")
                .field(&"<redacted>")
                .finish(),
            Self::PrivateKey(private_key) => formatter
                .debug_tuple("PrivateKey")
                .field(private_key)
                .finish(),
        }
    }
}

#[derive(Clone)]
pub(super) enum SftpPrivateKey {
    Path {
        path: PathBuf,
        passphrase: Option<String>,
    },
    Pem {
        content: String,
        passphrase: Option<String>,
    },
}

impl fmt::Debug for SftpPrivateKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Path { path, passphrase } => formatter
                .debug_struct("Path")
                .field(
                    "fingerprint",
                    &redacted_fingerprint_text(path.to_string_lossy().as_ref()),
                )
                .field("passphrase", &passphrase.as_ref().map(|_| "<redacted>"))
                .finish(),
            Self::Pem { passphrase, .. } => formatter
                .debug_struct("Pem")
                .field("content", &"<redacted>")
                .field("passphrase", &passphrase.as_ref().map(|_| "<redacted>"))
                .finish(),
        }
    }
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
pub(super) struct RusshSftpBackend {
    managed_runtime: Option<ManagedSshSessionManager>,
}

impl RusshSftpBackend {
    pub(super) fn with_managed_runtime(managed_runtime: ManagedSshSessionManager) -> Self {
        Self {
            managed_runtime: Some(managed_runtime),
        }
    }

    fn managed_runtime(&self) -> Option<&ManagedSshSessionManager> {
        self.managed_runtime.as_ref()
    }
}

#[async_trait]
impl SftpBackend for RusshSftpBackend {
    async fn list_directory(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpDirectoryListing> {
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Interactive,
        )
        .await?;
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
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Interactive,
        )
        .await?;
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
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Interactive,
        )
        .await?;
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
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Interactive,
        )
        .await?;
        read_remote_text_file(&session.sftp, endpoint.host.id, path, max_bytes).await
    }

    async fn write_text_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        request: SftpWriteTextFileRequest,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpWriteTextFileResponse> {
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Interactive,
        )
        .await?;
        write_remote_text_file(&session.sftp, endpoint.host.id, path, request).await
    }

    async fn stat_path(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpPathStat> {
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Interactive,
        )
        .await?;
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
            return remove_remote_directory_with_shell(
                &endpoint,
                &path,
                settings,
                self.managed_runtime(),
            )
            .await;
        }

        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Interactive,
        )
        .await?;
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
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Interactive,
        )
        .await?;
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
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::Interactive,
        )
        .await?;
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
        let settings = settings.for_bulk_transfer_target(&endpoint);
        let session = connect_native_sftp(
            &endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::BulkTransfer,
        )
        .await?;
        match (request.direction, request.kind) {
            (SftpTransferDirection::Upload, SftpTransferKind::File) => {
                upload_file(
                    &session.sftp,
                    Path::new(&request.local_path),
                    &request.remote_path,
                    &progress,
                    settings,
                    request.conflict_policy,
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
                    request.conflict_policy,
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
                    request.conflict_policy,
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
                    request.conflict_policy,
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
        let settings = settings
            .for_bulk_transfer_target(&source_endpoint)
            .for_bulk_transfer_target(&target_endpoint);
        let source_session = connect_native_sftp(
            &source_endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::BulkTransfer,
        )
        .await?;
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
                        request.conflict_policy,
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
                        request.conflict_policy,
                    )
                    .await
                }
            };
        }

        let target_session = connect_native_sftp(
            &target_endpoint,
            settings,
            self.managed_runtime(),
            SftpManagedSessionLane::BulkTransfer,
        )
        .await?;
        match request.kind {
            SftpTransferKind::File => {
                copy_remote_file_between_sessions(
                    &source_session.sftp,
                    &request.source_remote_path,
                    &target_session.sftp,
                    &request.target_remote_path,
                    &progress,
                    settings,
                    request.conflict_policy,
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
                    request.conflict_policy,
                )
                .await
            }
        }
    }
}

struct NativeSftpConnection {
    sftp: SftpSession,
    _ssh: Option<NativeSftpSshConnection>,
    _managed_sftp: Option<ManagedSshSftpChannel>,
}

async fn connect_native_sftp(
    endpoint: &SftpEndpoint,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
    managed_lane: SftpManagedSessionLane,
) -> AppResult<NativeSftpConnection> {
    if let Some(connection) =
        connect_managed_sftp(endpoint, settings, managed_runtime, managed_lane).await?
    {
        return Ok(connection);
    }

    let connection = connect_native_ssh_chain(endpoint, settings).await?;

    let channel = connection
        .target()
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
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
    Ok(NativeSftpConnection {
        sftp,
        _ssh: Some(connection),
        _managed_sftp: None,
    })
}

async fn connect_managed_sftp(
    endpoint: &SftpEndpoint,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
    managed_lane: SftpManagedSessionLane,
) -> AppResult<Option<NativeSftpConnection>> {
    let Some(managed_runtime) = managed_runtime else {
        return Ok(None);
    };
    let key = ssh_session_key_for_route(
        &endpoint.host,
        &endpoint.route_auth,
        &endpoint.known_hosts_path,
    )
    .map_err(managed_sftp_error)?;
    let target = Some(key.summary().target);
    let request = SshRuntimeConnectRequest::native(
        key,
        endpoint.host.clone(),
        endpoint.known_hosts_path.clone(),
        settings.timeout_seconds,
    )
    .with_host_key_policy(host_key_policy_for_host(&endpoint.host));
    let session = match managed_lane {
        SftpManagedSessionLane::Interactive if is_external_target_id(&endpoint.host.id) => {
            managed_runtime.acquire_capability_session_with_request(request)
        }
        SftpManagedSessionLane::Interactive => {
            managed_runtime.acquire_session_with_request(request)
        }
        SftpManagedSessionLane::BulkTransfer => {
            managed_runtime.acquire_bulk_transfer_session_with_request(request)
        }
    };
    let session = match session {
        Ok(session) => session,
        Err(error) if is_managed_runtime_unwired(&error) => {
            managed_runtime.record_legacy_fallback("sftp", LEGACY_FALLBACK_SFTP_UNWIRED, target);
            return Ok(None);
        }
        Err(error) if is_managed_sftp_unsupported(&error) => {
            managed_runtime.record_legacy_fallback(
                "sftp",
                LEGACY_FALLBACK_SFTP_UNSUPPORTED,
                target,
            );
            return Ok(None);
        }
        Err(error) => return Err(managed_sftp_error(error)),
    };
    let mut channel = match session.open_sftp().await {
        Ok(channel) => channel,
        Err(error) if is_managed_runtime_unwired(&error) => {
            managed_runtime.record_legacy_fallback(
                "sftp",
                LEGACY_FALLBACK_SFTP_UNWIRED,
                Some(sftp_host_label(&endpoint.host)),
            );
            return Ok(None);
        }
        Err(error) if is_managed_sftp_unsupported(&error) => {
            managed_runtime.record_legacy_fallback(
                "sftp",
                LEGACY_FALLBACK_SFTP_UNSUPPORTED,
                Some(sftp_host_label(&endpoint.host)),
            );
            return Ok(None);
        }
        Err(error) => return Err(managed_sftp_error(error)),
    };
    let stream = channel.take_stream()?;
    let sftp = SftpSession::new_with_config(
        stream,
        NativeSftpConfig {
            max_packet_len: settings.packet_bytes,
            max_concurrent_writes: settings.pipeline_depth,
            request_timeout_secs: settings.timeout_seconds,
        },
    )
    .await
    .map_err(native_sftp_error)?;
    Ok(Some(NativeSftpConnection {
        sftp,
        _ssh: None,
        _managed_sftp: Some(channel),
    }))
}

fn is_managed_sftp_unsupported(error: &AppError) -> bool {
    let message = error.to_string();
    message.contains(MANAGED_SSH_SFTP_UNSUPPORTED)
}

fn managed_sftp_error(error: AppError) -> AppError {
    AppError::Sftp(format!("受管 SSH SFTP channel 失败: {error}"))
}

fn is_managed_runtime_unwired(error: &AppError) -> bool {
    matches!(error, AppError::SshCommand(message) if message.contains("managed SSH runtime backend is not wired yet"))
}

fn is_managed_exec_unsupported(error: &AppError) -> bool {
    matches!(error, AppError::SshCommand(message) if message == MANAGED_SSH_EXEC_UNSUPPORTED)
}

fn managed_exec_error(error: AppError) -> AppError {
    AppError::Sftp(format!("受管 SSH exec channel 失败: {error}"))
}

async fn remove_remote_directory_with_shell(
    endpoint: &SftpEndpoint,
    path: &str,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
) -> AppResult<()> {
    validate_remote_directory_shell_delete_path(path)?;
    let script = format!("rm -rf -- {}\n", shell_single_quote(path));
    if let Some(output) =
        execute_managed_directory_delete(endpoint, &script, settings, managed_runtime).await?
    {
        return finish_remote_directory_delete(output.exit_code, &output.stderr);
    }

    let connection = connect_native_ssh_chain(endpoint, settings).await?;

    let mut channel = connection
        .target()
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
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
    connection.disconnect("directory deleted").await;

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

async fn execute_managed_directory_delete(
    endpoint: &SftpEndpoint,
    script: &str,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
) -> AppResult<Option<SshRuntimeExecOutput>> {
    let Some(managed_runtime) = managed_runtime else {
        return Ok(None);
    };
    let key = ssh_session_key_for_route(
        &endpoint.host,
        &endpoint.route_auth,
        &endpoint.known_hosts_path,
    )
    .map_err(managed_exec_error)?;
    let target = Some(key.summary().target);
    let request = SshRuntimeConnectRequest::native(
        key,
        endpoint.host.clone(),
        endpoint.known_hosts_path.clone(),
        settings.timeout_seconds,
    )
    .with_host_key_policy(host_key_policy_for_host(&endpoint.host));
    let session = if is_external_target_id(&endpoint.host.id) {
        managed_runtime.acquire_capability_session_with_request(request)
    } else {
        managed_runtime.acquire_session_with_request(request)
    };
    let session = match session {
        Ok(session) => session,
        Err(error) if is_managed_runtime_unwired(&error) => {
            managed_runtime.record_legacy_fallback(
                "sftp.exec",
                LEGACY_FALLBACK_SFTP_EXEC_UNWIRED,
                target,
            );
            return Ok(None);
        }
        Err(error) => return Err(managed_exec_error(error)),
    };
    let request = SshRuntimeExecRequest::new(
        script.to_owned(),
        settings.timeout_seconds,
        DIRECTORY_DELETE_ERROR_BYTES,
    );
    match session.execute_exec(request).await {
        Ok(output) => Ok(Some(output)),
        Err(error) if is_managed_exec_unsupported(&error) => {
            managed_runtime.record_legacy_fallback(
                "sftp.exec",
                LEGACY_FALLBACK_SFTP_EXEC_UNSUPPORTED,
                Some(sftp_host_label(&endpoint.host)),
            );
            Ok(None)
        }
        Err(error) => Err(managed_exec_error(error)),
    }
}

fn sftp_host_label(host: &RemoteHost) -> String {
    format!("{}@{}:{}", host.username, host.host, host.port)
}

fn host_key_policy_for_host(host: &RemoteHost) -> SshRuntimeHostKeyPolicy {
    if is_external_target_id(&host.id) {
        SshRuntimeHostKeyPolicy::TrustUnknown
    } else {
        SshRuntimeHostKeyPolicy::RequireKnown
    }
}

fn finish_remote_directory_delete(exit_code: Option<i32>, stderr: &str) -> AppResult<()> {
    if exit_code == Some(0) {
        return Ok(());
    }

    let detail = stderr.trim();
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

pub(super) fn resolve_endpoint_with_auth_broker(
    paths: &KerminalPaths,
    host_id: &str,
    auth_broker: Option<&SshAuthBroker>,
    external_targets: Option<&ExternalSessionMaterializer>,
) -> AppResult<SftpEndpoint> {
    if let Some(external_targets) = external_targets {
        if let Some(target) = external_targets.resolve_target(host_id)? {
            let auth = resolve_auth_material(&target.host)?;
            return Ok(SftpEndpoint {
                host: target.host,
                auth,
                known_hosts_path: paths.root.join("known_hosts"),
                route_auth: target.route_auth,
            });
        }
    }
    if is_external_target_id(host_id) {
        return Err(external_target_not_available_error(host_id));
    }
    let host = resolve_host(paths, host_id)?;
    let resolver = SshCredentialResolver::new(EncryptedVaultService::new(paths.clone()));
    let resolved_auth = resolver.resolve_host(&host)?;
    let resolved_auth = match auth_broker {
        Some(auth_broker) => match auth_broker.resolve_route_auth(&resolved_auth)? {
            SshAuthBrokerResolution::Ready { auth } => auth,
            SshAuthBrokerResolution::PromptRequired { prompt_plan, .. } => {
                return Err(prompt_required_sftp_error(prompt_plan));
            }
        },
        None => resolved_auth,
    };
    let host = SshCredentialResolver::materialize_runtime_host_from_auth(&host, &resolved_auth);
    let auth = resolve_auth_material(&host)?;
    Ok(SftpEndpoint {
        host,
        auth,
        known_hosts_path: paths.root.join("known_hosts"),
        route_auth: resolved_auth,
    })
}

fn prompt_required_sftp_error(prompt_plan: SshAuthPromptPlan) -> AppError {
    let prompts = prompt_plan
        .prompts
        .iter()
        .map(|prompt| {
            format!(
                "{}@{}:{} {}",
                prompt.username,
                prompt.host,
                prompt.port,
                prompt.secret_kind.as_str()
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    AppError::Credential(format!(
        "SSH authentication is required before SFTP can connect: {prompts}"
    ))
}

pub(super) fn load_sftp_runtime_settings(paths: &KerminalPaths) -> AppResult<SftpRuntimeSettings> {
    let settings = ConfigFileStore::new(paths.root.clone())
        .read_settings_or_default()
        .map_err(config_file_error)?;
    Ok(SftpRuntimeSettings::from(settings.sftp))
}

fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}

pub(super) fn resolve_host(paths: &KerminalPaths, host_id: &str) -> AppResult<RemoteHost> {
    if is_external_target_id(host_id) {
        return Err(external_target_not_available_error(host_id));
    }
    ConfigFileStore::new(paths.root.clone())
        .remote_host_by_id(host_id)
        .map_err(config_file_error)?
        .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {host_id}")))
}

fn external_target_not_available_error(host_id: &str) -> AppError {
    AppError::NotFound(format!("外部 SSH 临时目标不存在或已关闭: {host_id}"))
}

fn resolve_auth_material(host: &RemoteHost) -> AppResult<SftpAuthMaterial> {
    match host.auth_type {
        RemoteHostAuthType::Agent => Ok(SftpAuthMaterial::Agent),
        RemoteHostAuthType::Password => {
            let password = required_credential_secret(host, "密码认证需要已保存 SSH 密码")?;
            Ok(SftpAuthMaterial::Password(password))
        }
        RemoteHostAuthType::Key => {
            if let Some(secret) = normalized_credential_secret(host) {
                return Ok(SftpAuthMaterial::PrivateKey(SftpPrivateKey::Pem {
                    content: secret.to_owned(),
                    passphrase: normalized_key_passphrase_secret(host).map(ToOwned::to_owned),
                }));
            }
            let credential_ref = required_credential_ref(host)?;
            if credential_ref.starts_with("credential:") {
                return Err(AppError::InvalidInput(
                    "SSH 主机不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容"
                        .to_owned(),
                ));
            }
            Ok(SftpAuthMaterial::PrivateKey(SftpPrivateKey::Path {
                path: resolve_identity_file_path(credential_ref)?,
                passphrase: normalized_key_passphrase_secret(host).map(ToOwned::to_owned),
            }))
        }
    }
}

fn required_credential_ref(host: &RemoteHost) -> AppResult<&str> {
    host.credential_ref
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::InvalidInput("密钥认证需要保存私钥路径或明文私钥内容".to_owned()))
}

fn required_credential_secret(host: &RemoteHost, message: &str) -> AppResult<String> {
    normalized_credential_secret(host)
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::InvalidInput(message.to_owned()))
}

fn normalized_credential_secret(host: &RemoteHost) -> Option<&str> {
    host.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn normalized_key_passphrase_secret(host: &RemoteHost) -> Option<&str> {
    host.key_passphrase_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
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
