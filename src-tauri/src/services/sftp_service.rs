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

#[cfg(not(test))]
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
    storage::SqliteStore,
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
    SftpEndpoint, SftpRuntimeSettings,
};
#[cfg(test)]
use self::backend::{
    shell_single_quote, validate_remote_directory_shell_delete_path, SftpAuthMaterial,
};
use self::native_ssh::trust_native_host_key;
#[cfg(test)]
use self::native_ssh::{HostKeyPolicy, NativeClientHandler};
use self::runtime_tasks::{
    should_stage_remote_copy, ArchiveDownloadTaskInput, ArchiveUploadTaskInput,
    ClipboardDownloadTaskInput, RemoteCopyTaskInput,
};

#[cfg(test)]
use self::transfer_paths::{
    classify_clipboard_local_paths, clipboard_download_target_path_in,
    reserve_clipboard_download_target_path_in,
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

#[cfg(test)]
use self::remote_text::{detect_line_ending, sha256_hex};

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
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpListDirectoryRequest,
    ) -> AppResult<SftpDirectoryListing> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let path = normalize_remote_path(&request.path)?;
        self.backend.list_directory(endpoint, path, settings).await
    }

    /// 创建远程目录。
    pub async fn create_directory(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpPathRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend
            .create_directory(endpoint, path, settings)
            .await?;
        Ok(true)
    }

    /// 预览远程文本文件。
    pub async fn preview_file(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpPreviewRequest,
    ) -> AppResult<SftpFilePreview> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        let max_bytes = normalize_preview_bytes(request.max_bytes);
        self.backend
            .preview_file(endpoint, path, max_bytes, settings)
            .await
    }

    /// 读取远程文本文件供编辑器打开。
    pub async fn read_text_file(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpReadTextFileRequest,
    ) -> AppResult<SftpReadTextFileResponse> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        let max_bytes = normalize_text_file_bytes(request.max_bytes);
        self.backend
            .read_text_file(endpoint, path, max_bytes, settings)
            .await
    }

    /// 写入远程文本文件，并在默认情况下检查打开时的 revision。
    pub async fn write_text_file(
        &self,
        storage: &SqliteStore,
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

        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend
            .write_text_file(endpoint, path, request, settings)
            .await
    }

    /// 读取远程路径状态，供文件树和保存冲突检查复用。
    pub async fn stat_path(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpPathRequest,
    ) -> AppResult<SftpPathStat> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend.stat_path(endpoint, path, settings).await
    }

    /// 删除远程文件或目录。
    pub async fn delete(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpDeleteRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend
            .delete(endpoint, path, request.directory, settings)
            .await?;
        Ok(true)
    }

    /// 重命名远程路径。
    pub async fn rename(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpRenameRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let from_path = normalize_non_root_remote_path(&request.from_path)?;
        let to_path = normalize_non_root_remote_path(&request.to_path)?;
        self.backend
            .rename(endpoint, from_path, to_path, settings)
            .await?;
        Ok(true)
    }

    /// 修改远程路径权限。
    pub async fn chmod(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpChmodRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        let mode = validate_chmod_mode(&request.mode)?;
        self.backend.chmod(endpoint, path, mode, settings).await?;
        Ok(true)
    }

    /// 上传本地文件到远程路径。
    pub async fn upload(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            storage,
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
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            storage,
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
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            storage,
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
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            storage,
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
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpTrustHostKeyRequest,
    ) -> AppResult<SftpHostKeyTrustSummary> {
        let settings = load_sftp_runtime_settings(storage)?;
        let host = resolve_host(storage, &request.host_id)?;
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

#[cfg(not(test))]
fn unix_timestamp_millis() -> u64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests;
