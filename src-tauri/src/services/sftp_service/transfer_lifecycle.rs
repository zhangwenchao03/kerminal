//! SFTP transfer lifecycle facade methods.
//!
//! @author kongweiguang

use super::*;

impl SftpService {
    /// 创建可管理传输任务。
    pub fn enqueue_transfer(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpManagedTransferRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_transfer_with_events(storage, paths, request, None)
    }

    /// 创建可管理传输任务，并向当前窗口推送状态更新。
    #[cfg(not(test))]
    pub fn enqueue_transfer_for_window(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpManagedTransferRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_transfer_with_events(
            storage,
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_transfer_with_events(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpManagedTransferRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let request = normalize_managed_transfer_request(request)?;
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            view_scope: request.view_scope.clone(),
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
        paths: &KerminalPaths,
        request: SftpRemoteCopyRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_remote_copy_with_events(storage, paths, request, None)
    }

    /// 创建远程复制或跨主机传输任务，并向当前窗口推送状态更新。
    #[cfg(not(test))]
    pub fn enqueue_remote_copy_for_window(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpRemoteCopyRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_remote_copy_with_events(
            storage,
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_remote_copy_with_events(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpRemoteCopyRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(storage)?;
        let source_endpoint = resolve_endpoint(storage, paths, &request.source_host_id)?;
        let target_endpoint = resolve_endpoint(storage, paths, &request.target_host_id)?;
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
            view_scope: request.view_scope.clone(),
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
        paths: &KerminalPaths,
        request: SftpArchiveDownloadRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_download_with_events(storage, paths, request, None)
    }

    /// 创建远程条目下载为本地 ZIP 的归档任务，并向当前窗口推送状态更新。
    #[cfg(not(test))]
    pub fn enqueue_archive_download_for_window(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpArchiveDownloadRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_download_with_events(
            storage,
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_archive_download_with_events(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpArchiveDownloadRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let request = normalize_archive_download_request(request)?;
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            view_scope: request.view_scope.clone(),
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
        paths: &KerminalPaths,
        request: SftpArchiveUploadRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_upload_with_events(storage, paths, request, None)
    }

    /// 创建本地条目压缩为远程 ZIP 的归档上传任务，并向当前窗口推送状态更新。
    #[cfg(not(test))]
    pub fn enqueue_archive_upload_for_window(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpArchiveUploadRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_archive_upload_with_events(
            storage,
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_archive_upload_with_events(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpArchiveUploadRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let request = normalize_archive_upload_request(request)?;
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            view_scope: request.view_scope.clone(),
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
        paths: &KerminalPaths,
        request: SftpClipboardDownloadRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_clipboard_download_with_events(storage, paths, request, None)
    }

    /// 创建远程条目下载到本地文件剪贴板的任务，并向当前窗口推送状态更新。
    #[cfg(not(test))]
    pub fn enqueue_clipboard_download_for_window(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpClipboardDownloadRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_clipboard_download_with_events(
            storage,
            paths,
            request,
            Some(TransferEventEmitter::new(window)),
        )
    }

    fn enqueue_clipboard_download_with_events(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SftpClipboardDownloadRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        ensure_local_file_clipboard_supported()?;
        let settings = load_sftp_runtime_settings(storage)?;
        let endpoint = resolve_endpoint(storage, paths, &request.host_id)?;
        let request = normalize_clipboard_download_request(request)?;
        let target_local_path = reserve_clipboard_download_target_path(&request)?;
        let target_local_path_string = target_local_path.to_string_lossy().into_owned();
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let summary = SftpTransferSummary {
            id: id.clone(),
            host_id: request.host_id.clone(),
            view_scope: request.view_scope.clone(),
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
}
