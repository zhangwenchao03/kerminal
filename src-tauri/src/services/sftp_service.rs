//! SFTP 文件工具服务。
//!
//! @author kongweiguang

use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::Window;
use uuid::Uuid;

use russh_sftp::protocol::{Status, StatusCode};

use crate::{
    error::{AppError, AppResult},
    models::sftp::{
        SftpArchiveDownloadRequest, SftpArchiveUploadRequest, SftpChmodRequest,
        SftpClassifyLocalPathsRequest, SftpClipboardDownloadRequest, SftpDeleteRequest,
        SftpDirectoryListing, SftpFilePreview, SftpHostKeyTrustSummary, SftpListDirectoryRequest,
        SftpLocalPathInfo, SftpManagedTransferRequest, SftpPathRequest, SftpPathStat,
        SftpPreviewRequest, SftpReadTextFileRequest, SftpReadTextFileResponse,
        SftpRemoteCopyRequest, SftpRenameRequest, SftpTransferCancelRequest, SftpTransferDirection,
        SftpTransferKind, SftpTransferOperation, SftpTransferRequest, SftpTransferScopeRequest,
        SftpTransferStatus, SftpTransferSummary, SftpTransferTransportMode,
        SftpTrustHostKeyRequest, SftpWriteTextFileRequest, SftpWriteTextFileResponse,
    },
    paths::KerminalPaths,
    services::{
        external_launch::{is_external_target_id, ExternalSessionMaterializer},
        ssh_runtime::{auth_broker::SshAuthBroker, ManagedSshSessionManager},
    },
};

mod archive;
mod backend;
mod native_ssh;

mod remote_text;
mod runtime_tasks;
mod transfer;
mod transfer_io;
mod transfer_lifecycle;
mod transfer_paths;
mod transfer_registry;

use self::archive::{
    zip_local_path_to_file, zip_local_path_to_file_with_conflict, zip_safe_entry_name,
};

use self::backend::{
    load_sftp_runtime_settings, resolve_endpoint_with_auth_broker, resolve_host, RusshSftpBackend,
    SftpBackend, SftpEndpoint, SftpRuntimeSettings,
};
use self::native_ssh::trust_native_host_key;
use self::runtime_tasks::{
    should_stage_remote_copy, ArchiveDownloadTaskInput, ArchiveUploadTaskInput,
    ClipboardDownloadTaskInput, RemoteCopyTaskInput,
};

use self::transfer_paths::{
    classify_local_paths, ensure_local_file_clipboard_supported, initial_total_bytes,
    is_remote_descendant_path, local_path_file_name, local_transfer_endpoint,
    managed_transfer_operation, managed_transfer_source, managed_transfer_target,
    normalize_archive_download_request, normalize_archive_upload_request,
    normalize_clipboard_download_request, normalize_managed_transfer_request,
    normalize_non_root_remote_path, normalize_preview_bytes, normalize_remote_copy_request,
    normalize_remote_path, normalize_text_file_bytes, read_local_file_clipboard,
    remote_copy_source_label, remote_path_file_name, remote_transfer_endpoint,
    reserve_clipboard_download_target_path, validate_chmod_mode, validate_text_encoding,
    write_local_file_clipboard,
};

use self::transfer::{
    ProgressReader, ProgressWriter, TransferEventEmitter, TransferLimiter, TransferProgress,
    TransferTask,
};

const DEFAULT_PREVIEW_BYTES: usize = 16 * 1024;
const MIN_PREVIEW_BYTES: usize = 256;
const MAX_PREVIEW_BYTES: usize = 128 * 1024;
const DEFAULT_TEXT_FILE_BYTES: usize = 2 * 1024 * 1024;
const MIN_TEXT_FILE_BYTES: usize = 1024;
const MAX_TEXT_FILE_BYTES: usize = 10 * 1024 * 1024;

/// SFTP 文件工具业务入口。
pub struct SftpService {
    auth_broker: Option<SshAuthBroker>,
    backend: Arc<dyn SftpBackend>,
    external_targets: Option<ExternalSessionMaterializer>,
    transfers: Arc<Mutex<HashMap<String, TransferTask>>>,
    transfer_limiter: Arc<TransferLimiter>,
}

impl fmt::Debug for SftpService {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SftpService")
            .field("backend", &"<native-russh-sftp>")
            .field("transfers", &"<transfer-registry>")
            .finish()
    }
}

impl Default for SftpService {
    fn default() -> Self {
        Self::new()
    }
}

impl SftpService {
    /// 创建 SFTP 服务。
    pub fn new() -> Self {
        Self::with_backend(Arc::new(RusshSftpBackend::default()))
    }

    /// 创建接入受管 SSH 运行时的 SFTP 服务。
    pub fn with_ssh_runtime(
        managed_runtime: ManagedSshSessionManager,
        auth_broker: SshAuthBroker,
        external_targets: ExternalSessionMaterializer,
    ) -> Self {
        Self::with_backend_auth_broker_and_external_targets(
            Arc::new(RusshSftpBackend::with_managed_runtime(managed_runtime)),
            Some(auth_broker),
            Some(external_targets),
        )
    }

    fn with_backend(backend: Arc<dyn SftpBackend>) -> Self {
        Self::with_backend_and_auth_broker(backend, None)
    }

    fn with_backend_and_auth_broker(
        backend: Arc<dyn SftpBackend>,
        auth_broker: Option<SshAuthBroker>,
    ) -> Self {
        Self::with_backend_auth_broker_and_external_targets(backend, auth_broker, None)
    }

    fn with_backend_auth_broker_and_external_targets(
        backend: Arc<dyn SftpBackend>,
        auth_broker: Option<SshAuthBroker>,
        external_targets: Option<ExternalSessionMaterializer>,
    ) -> Self {
        Self {
            auth_broker,
            backend,
            external_targets,
            transfers: Arc::new(Mutex::new(HashMap::new())),
            transfer_limiter: Arc::new(TransferLimiter::default()),
        }
    }

    /// 列出远程目录。
    pub async fn list_directory(
        &self,
        paths: &KerminalPaths,
        request: SftpListDirectoryRequest,
    ) -> AppResult<SftpDirectoryListing> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_remote_path(&request.path)?;
        self.backend.list_directory(endpoint, path, settings).await
    }

    /// 创建远程目录。
    pub async fn create_directory(
        &self,
        paths: &KerminalPaths,
        request: SftpPathRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend
            .create_directory(endpoint, path, settings)
            .await?;
        Ok(true)
    }

    /// 预览远程文本文件。
    pub async fn preview_file(
        &self,
        paths: &KerminalPaths,
        request: SftpPreviewRequest,
    ) -> AppResult<SftpFilePreview> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        let max_bytes = normalize_preview_bytes(request.max_bytes);
        self.backend
            .preview_file(endpoint, path, max_bytes, settings)
            .await
    }

    /// 读取远程文本文件供编辑器打开。
    pub async fn read_text_file(
        &self,
        paths: &KerminalPaths,
        request: SftpReadTextFileRequest,
    ) -> AppResult<SftpReadTextFileResponse> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        let max_bytes = normalize_text_file_bytes(request.max_bytes);
        self.backend
            .read_text_file(endpoint, path, max_bytes, settings)
            .await
    }

    /// 写入远程文本文件，并在默认情况下检查打开时的 revision。
    pub async fn write_text_file(
        &self,
        paths: &KerminalPaths,
        request: SftpWriteTextFileRequest,
    ) -> AppResult<SftpWriteTextFileResponse> {
        validate_text_encoding(&request.encoding)?;
        if !request.create && !request.overwrite_on_conflict && request.expected_revision.is_none()
        {
            return Err(AppError::InvalidInput(
                "保存远程文件必须提供 expectedRevision，避免静默覆盖远端修改".to_owned(),
            ));
        }

        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend
            .write_text_file(endpoint, path, request, settings)
            .await
    }

    /// 读取远程路径状态，供文件树和保存冲突检查复用。
    pub async fn stat_path(
        &self,
        paths: &KerminalPaths,
        request: SftpPathRequest,
    ) -> AppResult<SftpPathStat> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend.stat_path(endpoint, path, settings).await
    }

    /// 删除远程文件或目录。
    pub async fn delete(
        &self,
        paths: &KerminalPaths,
        request: SftpDeleteRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend
            .delete(endpoint, path, request.directory, settings)
            .await?;
        Ok(true)
    }

    /// 重命名远程路径。
    pub async fn rename(
        &self,
        paths: &KerminalPaths,
        request: SftpRenameRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let from_path = normalize_non_root_remote_path(&request.from_path)?;
        let to_path = normalize_non_root_remote_path(&request.to_path)?;
        self.backend
            .rename(endpoint, from_path, to_path, settings)
            .await?;
        Ok(true)
    }

    /// 修改远程路径权限。
    pub async fn chmod(&self, paths: &KerminalPaths, request: SftpChmodRequest) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(paths)?;
        let endpoint = self.resolve_endpoint(paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        let mode = validate_chmod_mode(&request.mode)?;
        self.backend.chmod(endpoint, path, mode, settings).await?;
        Ok(true)
    }

    /// 上传本地文件到远程路径。
    pub async fn upload(
        &self,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::File,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
                conflict_policy: request.conflict_policy,
                view_scope: None,
            },
        )
        .await
    }

    /// 递归上传本地目录到远程路径。
    pub async fn upload_directory(
        &self,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::Directory,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
                conflict_policy: request.conflict_policy,
                view_scope: None,
            },
        )
        .await
    }

    /// 下载远程文件到本地路径。
    pub async fn download(
        &self,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::File,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
                conflict_policy: request.conflict_policy,
                view_scope: None,
            },
        )
        .await
    }

    /// 递归下载远程目录到本地路径。
    pub async fn download_directory(
        &self,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::Directory,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
                conflict_policy: request.conflict_policy,
                view_scope: None,
            },
        )
        .await
    }

    /// 分类本地拖放路径，供前端决定加入文件还是目录上传队列。
    pub fn classify_local_paths(
        &self,
        request: SftpClassifyLocalPathsRequest,
    ) -> AppResult<Vec<SftpLocalPathInfo>> {
        classify_local_paths(request)
    }

    /// 读取系统文件剪贴板中的本地文件或目录路径。
    pub fn read_local_file_clipboard(&self) -> AppResult<Vec<SftpLocalPathInfo>> {
        read_local_file_clipboard()
    }

    /// 显式信任远程 SSH 主机密钥。
    pub async fn trust_host_key(
        &self,
        paths: &KerminalPaths,
        request: SftpTrustHostKeyRequest,
    ) -> AppResult<SftpHostKeyTrustSummary> {
        let settings = load_sftp_runtime_settings(paths)?;
        let host = if is_external_target_id(&request.host_id) {
            let target = self
                .external_targets
                .as_ref()
                .ok_or_else(|| {
                    AppError::NotFound(format!("外部 SSH 临时目标不存在: {}", request.host_id))
                })?
                .resolve_target(&request.host_id)?
                .ok_or_else(|| {
                    AppError::NotFound(format!("外部 SSH 临时目标不存在: {}", request.host_id))
                })?;
            target.host
        } else {
            resolve_host(paths, &request.host_id)?
        };
        let known_hosts_path = paths.root.join("known_hosts");
        trust_native_host_key(&host, &known_hosts_path, settings).await?;
        Ok(SftpHostKeyTrustSummary {
            host_id: host.id,
            host: host.host,
            port: host.port,
            known_hosts_path: known_hosts_path.to_string_lossy().into_owned(),
        })
    }

    fn transfers(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, TransferTask>>> {
        self.transfers
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("sftp transfers"))
    }

    fn resolve_endpoint(&self, paths: &KerminalPaths, host_id: &str) -> AppResult<SftpEndpoint> {
        resolve_endpoint_with_auth_broker(
            paths,
            host_id,
            self.auth_broker.as_ref(),
            self.external_targets.as_ref(),
        )
    }
}

fn is_already_exists_error(error: &russh_sftp::client::error::Error) -> bool {
    match error {
        russh_sftp::client::error::Error::Status(status) => {
            is_already_exists_status(status.status_code, &status.error_message)
        }
        _ => false,
    }
}

fn is_ambiguous_sftp_failure(error: &russh_sftp::client::error::Error) -> bool {
    matches!(
        error,
        russh_sftp::client::error::Error::Status(Status {
            status_code: StatusCode::Failure,
            ..
        })
    ) && !is_already_exists_error(error)
}

fn is_no_such_file_error(error: &russh_sftp::client::error::Error) -> bool {
    matches!(
        error,
        russh_sftp::client::error::Error::Status(Status {
            status_code: StatusCode::NoSuchFile,
            ..
        })
    )
}

fn is_already_exists_status(status_code: StatusCode, error_message: &str) -> bool {
    matches!(status_code, StatusCode::Failure) && already_exists_message(error_message)
}

fn already_exists_message(error_message: &str) -> bool {
    let message = error_message.to_lowercase();
    message.contains("file exists") || message.contains("already exists")
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn unix_timestamp_millis() -> u64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

/// SFTP 传输规则的窄测试入口。
#[doc(hidden)]
pub mod rules {
    use std::{
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
    };

    use russh::{client::Handler as _, keys::PublicKey};
    use russh_sftp::protocol::StatusCode;
    use tokio::fs;

    use crate::{
        error::{AppError, AppResult},
        models::{
            settings::SftpPerformanceSettings,
            sftp::{
                SftpLocalPathInfo, SftpRemoteCopyRequest, SftpTransferConflictPolicy,
                SftpTransferKind, SftpTransferStatus, SftpTransferSummary,
            },
        },
    };

    /// 返回预览字节数的默认值。
    pub fn default_preview_bytes() -> usize {
        super::DEFAULT_PREVIEW_BYTES
    }

    /// 返回预览字节数的下限。
    pub fn min_preview_bytes() -> usize {
        super::MIN_PREVIEW_BYTES
    }

    /// 返回预览字节数的上限。
    pub fn max_preview_bytes() -> usize {
        super::MAX_PREVIEW_BYTES
    }

    /// 归一化远程文件预览的最大字节数。
    pub fn normalize_preview_bytes(max_bytes: Option<usize>) -> usize {
        super::transfer_paths::normalize_preview_bytes(max_bytes)
    }

    /// 校验 chmod 的八进制权限文本。
    pub fn validate_chmod_mode(mode: &str) -> AppResult<u32> {
        super::transfer_paths::validate_chmod_mode(mode)
    }

    /// 归一化远程路径文本。
    pub fn normalize_remote_path(path: &str) -> AppResult<String> {
        super::transfer_paths::normalize_remote_path(path)
    }

    /// 校验并归一化本地路径文本。
    pub fn validate_local_path(path: &str) -> AppResult<String> {
        super::transfer_paths::validate_local_path(path)
    }

    /// 归一化远程复制请求。
    pub fn normalize_remote_copy_request(
        request: SftpRemoteCopyRequest,
    ) -> AppResult<SftpRemoteCopyRequest> {
        super::transfer_paths::normalize_remote_copy_request(request)
    }

    /// 按剪贴板本地路径规则分类文件和目录。
    pub fn classify_clipboard_local_paths(
        paths: Vec<PathBuf>,
    ) -> AppResult<Vec<SftpLocalPathInfo>> {
        super::transfer_paths::classify_clipboard_local_paths(paths)
    }

    /// 当前平台是否支持系统级文件列表剪贴板。
    pub fn system_file_clipboard_supports_native_file_list() -> bool {
        super::transfer_paths::system_file_clipboard_support().supports_native_file_list()
    }

    /// 校验当前平台是否支持系统级文件列表剪贴板。
    pub fn ensure_local_file_clipboard_supported() -> AppResult<()> {
        super::transfer_paths::ensure_local_file_clipboard_supported()
    }

    /// 读取系统级文件列表剪贴板。
    pub fn read_local_file_clipboard() -> AppResult<Vec<SftpLocalPathInfo>> {
        super::transfer_paths::read_local_file_clipboard()
    }

    /// 为剪贴板下载保留目标路径。
    pub fn reserve_clipboard_download_target_path_in(
        target_root: &Path,
        request: &crate::models::sftp::SftpClipboardDownloadRequest,
    ) -> AppResult<PathBuf> {
        super::transfer_paths::reserve_clipboard_download_target_path_in(target_root, request)
    }

    /// 为远端 shell 删除命令做单引号转义。
    pub fn shell_single_quote(value: &str) -> String {
        super::backend::shell_single_quote(value)
    }

    /// 校验远端目录 shell 删除路径的安全边界。
    pub fn validate_remote_directory_shell_delete_path(path: &str) -> AppResult<()> {
        super::backend::validate_remote_directory_shell_delete_path(path)
    }

    /// 判断远端复制是否需要落本地临时文件兜底。
    pub fn should_stage_remote_copy(
        request: &SftpRemoteCopyRequest,
        global_transfers: usize,
    ) -> bool {
        let settings = super::backend::SftpRuntimeSettings {
            global_transfers,
            ..super::backend::SftpRuntimeSettings::default()
        };
        super::runtime_tasks::should_stage_remote_copy(request, settings)
    }

    /// 返回普通 SFTP 性能设置归一化后的运行时参数。
    pub fn normalized_sftp_runtime_settings(
        settings: SftpPerformanceSettings,
    ) -> (usize, usize, u32, u64) {
        let settings = super::backend::SftpRuntimeSettings::from(settings);
        (
            settings.host_transfers,
            settings.pipeline_depth,
            settings.packet_bytes,
            settings.timeout_seconds,
        )
    }

    /// 返回外部堡垒机 bulk transfer 使用的稳定运行时参数。
    pub fn external_bulk_transfer_runtime_settings(
        settings: SftpPerformanceSettings,
    ) -> (usize, usize, u32, u64) {
        let settings =
            super::backend::SftpRuntimeSettings::from(settings).for_external_bulk_transfer();
        (
            settings.host_transfers,
            settings.pipeline_depth,
            settings.packet_bytes,
            settings.timeout_seconds,
        )
    }

    /// 把本地文件或目录写入 ZIP 文件。
    pub fn zip_local_path_to_file(
        source_path: &Path,
        target_zip_path: &Path,
        root_name: &str,
        kind: SftpTransferKind,
        cancel_requested: Arc<AtomicBool>,
    ) -> AppResult<()> {
        super::archive::zip_local_path_to_file(
            source_path,
            target_zip_path,
            root_name,
            kind,
            cancel_requested,
        )
    }

    /// 按 native SFTP 的 known_hosts 策略校验主机公钥。
    pub async fn check_native_host_key(
        host: &str,
        port: u16,
        known_hosts_path: PathBuf,
        trust_unknown: bool,
        server_public_key: &PublicKey,
    ) -> AppResult<bool> {
        let mut handler = super::native_ssh::NativeClientHandler {
            host: host.to_owned(),
            port,
            known_hosts_path,
            host_key_policy: if trust_unknown {
                super::native_ssh::HostKeyPolicy::TrustUnknown
            } else {
                super::native_ssh::HostKeyPolicy::RequireKnown
            },
        };
        handler
            .check_server_key(server_public_key)
            .await
            .map_err(|error| AppError::Sftp(format!("SFTP 主机密钥校验失败: {error}")))
    }

    /// 生成本地冲突重命名候选的文件名。
    pub fn numbered_candidate_name(name: &str, index: usize) -> String {
        super::transfer_io::numbered_candidate_name(name, index)
    }

    /// 生成可靠传输 partial 文件名。
    pub fn reliable_partial_file_name(name: &str) -> String {
        super::transfer_io::reliable_partial_file_name(name)
    }

    /// 生成可靠传输远端 partial 路径。
    pub fn reliable_remote_partial_path(final_path: &str) -> String {
        super::transfer_io::reliable_remote_partial_path(final_path)
    }

    /// 生成可靠传输本地 partial 路径。
    pub fn reliable_local_partial_path(final_path: &Path) -> PathBuf {
        super::transfer_io::reliable_local_partial_path(final_path)
    }

    /// 计算可靠传输写入计划，返回稳定测试标签和 resume offset。
    pub fn reliable_write_decision(
        conflict_policy: SftpTransferConflictPolicy,
        final_exists: bool,
        source_bytes: u64,
        partial_bytes: Option<u64>,
    ) -> (&'static str, Option<u64>) {
        match super::transfer_io::plan_reliable_write(
            conflict_policy,
            final_exists,
            source_bytes,
            partial_bytes,
        ) {
            super::transfer_io::ReliableWriteDecision::SkipExistingFinal => {
                ("skip-existing-final", None)
            }
            super::transfer_io::ReliableWriteDecision::ChooseRenamedFinal => {
                ("choose-renamed-final", None)
            }
            super::transfer_io::ReliableWriteDecision::Fresh => ("fresh", None),
            super::transfer_io::ReliableWriteDecision::Resume { offset } => {
                ("resume", Some(offset))
            }
            super::transfer_io::ReliableWriteDecision::CommitExistingPartial => {
                ("commit-existing-partial", None)
            }
            super::transfer_io::ReliableWriteDecision::RestartPartial => ("restart-partial", None),
        }
    }

    /// 判断可靠传输提交前的 size 确认是否通过。
    pub fn reliable_size_confirmed(expected: u64, actual: u64) -> bool {
        matches!(
            super::transfer_io::confirm_reliable_write_size(expected, actual),
            super::transfer_io::ReliableSizeConfirmation::Verified
        )
    }

    /// 构造 SFTP status 错误并判断是否是明确的 already-exists 冲突。
    pub fn sftp_status_error_is_already_exists(
        status_code: StatusCode,
        error_message: &str,
    ) -> bool {
        let error = russh_sftp::client::error::Error::Status(super::Status {
            id: 0,
            status_code,
            error_message: error_message.to_owned(),
            language_tag: String::new(),
        });
        super::is_already_exists_error(&error)
    }

    /// 准备本地可靠写入目标，返回 final/partial 路径和 partial 文件句柄。
    pub async fn prepare_local_reliable_write_target(
        local_path: &Path,
        conflict_policy: SftpTransferConflictPolicy,
        source_bytes: u64,
    ) -> AppResult<Option<(PathBuf, PathBuf, u64, fs::File)>> {
        super::transfer_io::prepare_local_reliable_write_target(
            local_path,
            conflict_policy,
            source_bytes,
        )
        .await
        .map(|target| {
            target.map(|target| {
                (
                    target.final_path,
                    target.partial_path,
                    target.offset,
                    target.file,
                )
            })
        })
    }

    /// 提交本地可靠写入目标。
    pub async fn commit_local_reliable_write_target(
        final_path: &Path,
        partial_path: &Path,
        expected_bytes: u64,
    ) -> AppResult<()> {
        super::transfer_io::commit_local_reliable_write_target(
            final_path,
            partial_path,
            expected_bytes,
        )
        .await
    }

    /// 按传输冲突策略准备本地文件写入目标。
    pub async fn open_local_write_target(
        local_path: &Path,
        conflict_policy: SftpTransferConflictPolicy,
        skipped_bytes: u64,
    ) -> AppResult<Option<fs::File>> {
        super::transfer_io::open_local_write_target(local_path, conflict_policy, skipped_bytes)
            .await
    }

    /// 按传输冲突策略准备本地目录写入根路径。
    pub async fn prepare_local_directory_root(
        local_path: &Path,
        conflict_policy: SftpTransferConflictPolicy,
    ) -> AppResult<Option<PathBuf>> {
        super::transfer_io::prepare_local_directory_root(local_path, conflict_policy).await
    }

    /// 判断传输摘要是否属于指定视图 scope。
    pub fn transfer_matches_scope(summary: &SftpTransferSummary, view_scope: Option<&str>) -> bool {
        super::transfer_registry::transfer_matches_scope(summary, view_scope)
    }

    /// 判断 clear-completed 后是否应保留传输摘要。
    pub fn retain_after_clear_completed(
        summary: &SftpTransferSummary,
        view_scope: Option<&str>,
    ) -> bool {
        !transfer_matches_scope(summary, view_scope)
            || !matches!(
                summary.status,
                SftpTransferStatus::Succeeded
                    | SftpTransferStatus::Failed
                    | SftpTransferStatus::Canceled
            )
    }

    /// 返回内存中保留的最近完成传输数量上限。
    pub fn completed_transfer_retention_limit() -> usize {
        super::transfer_registry::RECENT_COMPLETED_TRANSFER_LIMIT
    }

    /// 返回完成传输按时间保留的秒数。
    pub fn completed_transfer_retention_seconds() -> u64 {
        super::transfer_registry::RECENT_COMPLETED_TRANSFER_SECONDS
    }

    /// 返回会被 retention policy 裁剪的完成传输 id，供策略测试复用。
    pub fn pruned_completed_transfer_ids(
        summaries: &[SftpTransferSummary],
        now: u64,
    ) -> Vec<String> {
        let mut ids = super::transfer_registry::completed_transfer_prune_ids(summaries.iter(), now)
            .into_iter()
            .collect::<Vec<_>>();
        ids.sort();
        ids
    }

    /// 生成取消标记，供归档规则测试和运行时调用者复用。
    pub fn new_cancel_flag(cancelled: bool) -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(cancelled))
    }

    /// 读取取消标记的当前状态。
    pub fn is_cancelled(cancel_requested: &Arc<AtomicBool>) -> bool {
        cancel_requested.load(Ordering::SeqCst)
    }
}
