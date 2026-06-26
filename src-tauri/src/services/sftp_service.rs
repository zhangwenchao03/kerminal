//! SFTP 文件工具服务。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    fmt,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::Window;
use uuid::Uuid;

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
    load_sftp_runtime_settings, resolve_endpoint, resolve_host, RusshSftpBackend, SftpBackend,
    SftpRuntimeSettings,
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
    backend: Arc<dyn SftpBackend>,
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
        Self::with_backend(Arc::new(RusshSftpBackend))
    }

    fn with_backend(backend: Arc<dyn SftpBackend>) -> Self {
        Self {
            backend,
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
        let endpoint = resolve_endpoint(paths, &request.host_id)?;
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
        let endpoint = resolve_endpoint(paths, &request.host_id)?;
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
        let endpoint = resolve_endpoint(paths, &request.host_id)?;
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
        let endpoint = resolve_endpoint(paths, &request.host_id)?;
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
        let endpoint = resolve_endpoint(paths, &request.host_id)?;
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
        let endpoint = resolve_endpoint(paths, &request.host_id)?;
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
        let endpoint = resolve_endpoint(paths, &request.host_id)?;
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
        let endpoint = resolve_endpoint(paths, &request.host_id)?;
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
        let endpoint = resolve_endpoint(paths, &request.host_id)?;
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
        let host = resolve_host(paths, &request.host_id)?;
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
}

fn is_already_exists_error(error: &russh_sftp::client::error::Error) -> bool {
    error.to_string().to_lowercase().contains("failure")
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
    use tokio::fs;

    use crate::{
        error::{AppError, AppResult},
        models::sftp::{
            SftpLocalPathInfo, SftpRemoteCopyRequest, SftpTransferConflictPolicy, SftpTransferKind,
            SftpTransferStatus, SftpTransferSummary,
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

    /// 生成取消标记，供归档规则测试和运行时调用者复用。
    pub fn new_cancel_flag(cancelled: bool) -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(cancelled))
    }

    /// 读取取消标记的当前状态。
    pub fn is_cancelled(cancel_requested: &Arc<AtomicBool>) -> bool {
        cancel_requested.load(Ordering::SeqCst)
    }
}
