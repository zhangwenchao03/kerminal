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
        SftpTransferKind, SftpTransferOperation, SftpTransferRequest, SftpTransferStatus,
        SftpTransferSummary, SftpTransferTransportMode, SftpTrustHostKeyRequest,
        SftpWriteTextFileRequest, SftpWriteTextFileResponse,
    },
    paths::KerminalPaths,
    services::credential_service::CredentialService,
    storage::SqliteStore,
};

mod archive;
mod backend;

mod remote_text;
mod runtime_tasks;
mod transfer;
mod transfer_io;
mod transfer_paths;

use self::archive::{zip_local_path_to_file, zip_safe_entry_name};

use self::backend::{
    load_sftp_runtime_settings, resolve_endpoint, resolve_host, trust_native_host_key,
    RusshSftpBackend, SftpBackend, SftpEndpoint, SftpRuntimeSettings,
};
#[cfg(test)]
use self::backend::{
    shell_single_quote, validate_remote_directory_shell_delete_path, HostKeyPolicy,
    NativeClientHandler, SftpAuthMaterial,
};
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
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpListDirectoryRequest,
    ) -> AppResult<SftpDirectoryListing> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
        let path = normalize_remote_path(&request.path)?;
        self.backend.list_directory(endpoint, path, settings).await
    }

    /// 创建远程目录。
    pub async fn create_directory(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpPathRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
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
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpPreviewRequest,
    ) -> AppResult<SftpFilePreview> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
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
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpReadTextFileRequest,
    ) -> AppResult<SftpReadTextFileResponse> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
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
        credentials: &CredentialService,
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
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend
            .write_text_file(endpoint, path, request, settings)
            .await
    }

    /// 读取远程路径状态，供文件树和保存冲突检查复用。
    pub async fn stat_path(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpPathRequest,
    ) -> AppResult<SftpPathStat> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        self.backend.stat_path(endpoint, path, settings).await
    }

    /// 删除远程文件或目录。
    pub async fn delete(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpDeleteRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
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
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpRenameRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
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
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpChmodRequest,
    ) -> AppResult<bool> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
        let path = normalize_non_root_remote_path(&request.path)?;
        let mode = validate_chmod_mode(&request.mode)?;
        self.backend.chmod(endpoint, path, mode, settings).await?;
        Ok(true)
    }

    /// 上传本地文件到远程路径。
    pub async fn upload(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            storage,
            credentials,
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::File,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
            },
        )
        .await
    }

    /// 递归上传本地目录到远程路径。
    pub async fn upload_directory(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            storage,
            credentials,
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::Directory,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
            },
        )
        .await
    }

    /// 下载远程文件到本地路径。
    pub async fn download(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            storage,
            credentials,
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::File,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
            },
        )
        .await
    }

    /// 递归下载远程目录到本地路径。
    pub async fn download_directory(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpTransferRequest,
    ) -> AppResult<bool> {
        self.run_transfer_now(
            storage,
            credentials,
            paths,
            SftpManagedTransferRequest {
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::Directory,
                host_id: request.host_id,
                local_path: request.local_path,
                remote_path: request.remote_path,
            },
        )
        .await
    }

    /// 创建可管理传输任务。
    pub fn enqueue_transfer(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpManagedTransferRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_transfer_with_events(storage, credentials, paths, request, None)
    }

    /// 创建可管理传输任务，并向当前窗口推送状态更新。
    pub fn enqueue_transfer_for_window(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpManagedTransferRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_transfer_with_events(
            storage,
            credentials,
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_transfer_with_events(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpManagedTransferRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
        let request = normalize_managed_transfer_request(request)?;
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            remote_path: request.remote_path.clone(),
            local_path: request.local_path.clone(),
            direction: request.direction,
            kind: request.kind,
            status: SftpTransferStatus::Queued,
            bytes_transferred: 0,
            total_bytes: initial_total_bytes(&request),
            error: None,
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            operation: Some(managed_transfer_operation(request.direction)),
            source: Some(managed_transfer_source(&endpoint, &request)),
            target: Some(managed_transfer_target(&endpoint, &request)),
            transport_mode: Some(SftpTransferTransportMode::SingleHostSftp),
            phase: Some("queued".to_owned()),
            current_item: None,
        };

        self.transfers()?.insert(
            id.clone(),
            TransferTask {
                summary: summary.clone(),
                cancel_requested: cancel_requested.clone(),
            },
        );
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        self.spawn_transfer_task(
            id,
            endpoint,
            request,
            settings,
            cancel_requested,
            event_emitter,
        );
        Ok(summary)
    }

    /// 创建远程复制或跨主机传输任务。
    pub fn enqueue_remote_copy(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpRemoteCopyRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_remote_copy_with_events(storage, credentials, paths, request, None)
    }

    /// 创建远程复制或跨主机传输任务，并向当前窗口推送状态更新。
    pub fn enqueue_remote_copy_for_window(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpRemoteCopyRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_remote_copy_with_events(
            storage,
            credentials,
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_remote_copy_with_events(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpRemoteCopyRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(storage)?;
        let source_endpoint =
            resolve_endpoint(storage, credentials, paths, &request.source_host_id)?;
        let target_endpoint =
            resolve_endpoint(storage, credentials, paths, &request.target_host_id)?;
        let request = normalize_remote_copy_request(request)?;
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let transport_mode = if should_stage_remote_copy(&request, settings) {
            SftpTransferTransportMode::LocalStage
        } else {
            SftpTransferTransportMode::ClientBridge
        };
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.target_host_id.clone(),
            remote_path: request.target_remote_path.clone(),
            local_path: remote_copy_source_label(&request),
            direction: SftpTransferDirection::Upload,
            kind: request.kind,
            status: SftpTransferStatus::Queued,
            bytes_transferred: 0,
            total_bytes: None,
            error: None,
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            operation: Some(SftpTransferOperation::RemoteCopy),
            source: Some(remote_transfer_endpoint(
                &source_endpoint.host,
                request.source_remote_path.clone(),
            )),
            target: Some(remote_transfer_endpoint(
                &target_endpoint.host,
                request.target_remote_path.clone(),
            )),
            transport_mode: Some(transport_mode),
            phase: Some("queued".to_owned()),
            current_item: None,
        };

        self.transfers()?.insert(
            id.clone(),
            TransferTask {
                summary: summary.clone(),
                cancel_requested: cancel_requested.clone(),
            },
        );
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        self.spawn_remote_copy_task(RemoteCopyTaskInput {
            transfer_id: id,
            source_endpoint,
            target_endpoint,
            request,
            temp_root: paths.temp.clone(),
            settings,
            cancel_requested,
            event_emitter: event_emitter.clone(),
        });
        Ok(summary)
    }

    /// 创建远程条目下载为本地 ZIP 的归档任务。
    pub fn enqueue_archive_download(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpArchiveDownloadRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_download_with_events(storage, credentials, paths, request, None)
    }

    /// 创建远程条目下载为本地 ZIP 的归档任务，并向当前窗口推送状态更新。
    pub fn enqueue_archive_download_for_window(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpArchiveDownloadRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_download_with_events(
            storage,
            credentials,
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_archive_download_with_events(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpArchiveDownloadRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
        let request = normalize_archive_download_request(request)?;
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            remote_path: request.source_remote_path.clone(),
            local_path: request.target_local_path.clone(),
            direction: SftpTransferDirection::Download,
            kind: request.kind,
            status: SftpTransferStatus::Queued,
            bytes_transferred: 0,
            total_bytes: None,
            error: None,
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            operation: Some(SftpTransferOperation::ArchiveDownload),
            source: Some(remote_transfer_endpoint(
                &endpoint.host,
                request.source_remote_path.clone(),
            )),
            target: Some(local_transfer_endpoint(request.target_local_path.clone())),
            transport_mode: Some(SftpTransferTransportMode::SingleHostSftp),
            phase: Some("queued".to_owned()),
            current_item: None,
        };

        self.transfers()?.insert(
            id.clone(),
            TransferTask {
                summary: summary.clone(),
                cancel_requested: cancel_requested.clone(),
            },
        );
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        self.spawn_archive_download_task(ArchiveDownloadTaskInput {
            transfer_id: id,
            endpoint,
            request,
            temp_root: paths.temp.clone(),
            settings,
            cancel_requested,
            event_emitter: event_emitter.clone(),
        });
        Ok(summary)
    }

    /// 创建本地条目压缩为远程 ZIP 的归档上传任务。
    pub fn enqueue_archive_upload(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpArchiveUploadRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_upload_with_events(storage, credentials, paths, request, None)
    }

    /// 创建本地条目压缩为远程 ZIP 的归档上传任务，并向当前窗口推送状态更新。
    pub fn enqueue_archive_upload_for_window(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpArchiveUploadRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_upload_with_events(
            storage,
            credentials,
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_archive_upload_with_events(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpArchiveUploadRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
        let request = normalize_archive_upload_request(request)?;
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            remote_path: request.target_remote_path.clone(),
            local_path: request.source_local_path.clone(),
            direction: SftpTransferDirection::Upload,
            kind: SftpTransferKind::File,
            status: SftpTransferStatus::Queued,
            bytes_transferred: 0,
            total_bytes: None,
            error: None,
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            operation: Some(SftpTransferOperation::ArchiveUpload),
            source: Some(local_transfer_endpoint(request.source_local_path.clone())),
            target: Some(remote_transfer_endpoint(
                &endpoint.host,
                request.target_remote_path.clone(),
            )),
            transport_mode: Some(SftpTransferTransportMode::SingleHostSftp),
            phase: Some("queued".to_owned()),
            current_item: None,
        };

        self.transfers()?.insert(
            id.clone(),
            TransferTask {
                summary: summary.clone(),
                cancel_requested: cancel_requested.clone(),
            },
        );
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        self.spawn_archive_upload_task(ArchiveUploadTaskInput {
            transfer_id: id,
            endpoint,
            request,
            temp_root: paths.temp.clone(),
            settings,
            cancel_requested,
            event_emitter: event_emitter.clone(),
        });
        Ok(summary)
    }

    /// 创建远程条目下载到本地文件剪贴板的任务。
    pub fn enqueue_clipboard_download(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpClipboardDownloadRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_clipboard_download_with_events(storage, credentials, paths, request, None)
    }

    /// 创建远程条目下载到本地文件剪贴板的任务，并向当前窗口推送状态更新。
    pub fn enqueue_clipboard_download_for_window(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpClipboardDownloadRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_clipboard_download_with_events(
            storage,
            credentials,
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_clipboard_download_with_events(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        paths: &KerminalPaths,
        request: SftpClipboardDownloadRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        ensure_local_file_clipboard_supported()?;
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, credentials, paths, &request.host_id)?;
        let request = normalize_clipboard_download_request(request)?;
        let target_local_path = reserve_clipboard_download_target_path(&request)?;
        let target_local_path_string = target_local_path.to_string_lossy().into_owned();
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            remote_path: request.source_remote_path.clone(),
            local_path: target_local_path_string.clone(),
            direction: SftpTransferDirection::Download,
            kind: request.kind,
            status: SftpTransferStatus::Queued,
            bytes_transferred: 0,
            total_bytes: None,
            error: None,
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            operation: Some(SftpTransferOperation::ClipboardDownload),
            source: Some(remote_transfer_endpoint(
                &endpoint.host,
                request.source_remote_path.clone(),
            )),
            target: Some(local_transfer_endpoint(target_local_path_string.clone())),
            transport_mode: Some(SftpTransferTransportMode::SingleHostSftp),
            phase: Some("queued".to_owned()),
            current_item: None,
        };

        self.transfers()?.insert(
            id.clone(),
            TransferTask {
                summary: summary.clone(),
                cancel_requested: cancel_requested.clone(),
            },
        );
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        self.spawn_clipboard_download_task(ClipboardDownloadTaskInput {
            transfer_id: id,
            endpoint,
            request,
            target_local_path,
            settings,
            cancel_requested,
            copy_to_clipboard: true,
            event_emitter: event_emitter.clone(),
        });
        Ok(summary)
    }

    /// 列出传输任务。
    pub fn list_transfers(&self) -> AppResult<Vec<SftpTransferSummary>> {
        let mut summaries = self
            .transfers()?
            .values()
            .map(|task| task.summary.clone())
            .collect::<Vec<_>>();
        summaries.sort_by_key(|summary| summary.created_at);
        Ok(summaries)
    }

    /// 取消传输任务。
    pub fn cancel_transfer(
        &self,
        request: SftpTransferCancelRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.cancel_transfer_with_events(request, None)
    }

    /// 取消传输任务，并向当前窗口推送状态更新。
    pub fn cancel_transfer_for_window(
        &self,
        request: SftpTransferCancelRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.cancel_transfer_with_events(request, Some(TransferEventEmitter::new(window)))
    }

    fn cancel_transfer_with_events(
        &self,
        request: SftpTransferCancelRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let mut transfers = self.transfers()?;
        let Some(task) = transfers.get_mut(&request.transfer_id) else {
            return Err(AppError::NotFound(format!(
                "SFTP 传输任务不存在: {}",
                request.transfer_id
            )));
        };

        task.cancel_requested.store(true, Ordering::SeqCst);
        task.summary.cancel_requested = true;
        task.summary.updated_at = unix_timestamp();
        if task.summary.status == SftpTransferStatus::Queued {
            task.summary.status = SftpTransferStatus::Canceled;
        }
        let summary = task.summary.clone();
        drop(transfers);
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        Ok(summary)
    }

    /// 清理已经完成的传输任务。
    pub fn clear_completed_transfers(&self) -> AppResult<Vec<SftpTransferSummary>> {
        let mut transfers = self.transfers()?;
        transfers.retain(|_, task| {
            !matches!(
                task.summary.status,
                SftpTransferStatus::Succeeded
                    | SftpTransferStatus::Failed
                    | SftpTransferStatus::Canceled
            )
        });
        let mut summaries = transfers
            .values()
            .map(|task| task.summary.clone())
            .collect::<Vec<_>>();
        summaries.sort_by_key(|summary| summary.created_at);
        Ok(summaries)
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

fn unix_timestamp_millis() -> u64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests;
