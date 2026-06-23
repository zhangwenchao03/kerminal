use super::*;
use crate::models::sftp::SftpTransferConflictPolicy;

impl SftpService {
    pub(super) fn enqueue_resolved_for_test(
        &self,
        endpoint: SftpEndpoint,
        request: SftpManagedTransferRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.enqueue_resolved_with_settings_for_test(
            endpoint,
            request,
            SftpRuntimeSettings::default(),
        )
    }

    pub(super) fn enqueue_resolved_with_settings_for_test(
        &self,
        endpoint: SftpEndpoint,
        request: SftpManagedTransferRequest,
        settings: SftpRuntimeSettings,
    ) -> AppResult<SftpTransferSummary> {
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
            total_bytes: None,
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
        self.spawn_transfer_task(id, endpoint, request, settings, cancel_requested, None);
        Ok(summary)
    }

    pub(super) fn enqueue_remote_copy_resolved_for_test(
        &self,
        source_endpoint: SftpEndpoint,
        target_endpoint: SftpEndpoint,
        request: SftpRemoteCopyRequest,
        temp_root: PathBuf,
    ) -> AppResult<SftpTransferSummary> {
        let request = normalize_remote_copy_request(request)?;
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let transport_mode = if should_stage_remote_copy(&request, SftpRuntimeSettings::default()) {
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
        self.spawn_remote_copy_task(RemoteCopyTaskInput {
            transfer_id: id,
            source_endpoint,
            target_endpoint,
            request,
            temp_root,
            settings: SftpRuntimeSettings::default(),
            cancel_requested,
            event_emitter: None,
        });
        Ok(summary)
    }

    pub(super) fn enqueue_archive_download_resolved_for_test(
        &self,
        endpoint: SftpEndpoint,
        request: SftpArchiveDownloadRequest,
        temp_root: PathBuf,
    ) -> AppResult<SftpTransferSummary> {
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
        self.spawn_archive_download_task(ArchiveDownloadTaskInput {
            transfer_id: id,
            endpoint,
            request,
            temp_root,
            settings: SftpRuntimeSettings::default(),
            cancel_requested,
            event_emitter: None,
        });
        Ok(summary)
    }

    pub(super) fn enqueue_archive_upload_resolved_for_test(
        &self,
        endpoint: SftpEndpoint,
        request: SftpArchiveUploadRequest,
        temp_root: PathBuf,
    ) -> AppResult<SftpTransferSummary> {
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
        self.spawn_archive_upload_task(ArchiveUploadTaskInput {
            transfer_id: id,
            endpoint,
            request,
            temp_root,
            settings: SftpRuntimeSettings::default(),
            cancel_requested,
            event_emitter: None,
        });
        Ok(summary)
    }

    pub(super) fn enqueue_clipboard_download_resolved_for_test(
        &self,
        endpoint: SftpEndpoint,
        request: SftpClipboardDownloadRequest,
        target_local_path: PathBuf,
        copy_to_clipboard: bool,
    ) -> AppResult<SftpTransferSummary> {
        let request = normalize_clipboard_download_request(request)?;
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let target_local_path_string = target_local_path.to_string_lossy().into_owned();
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
        self.spawn_clipboard_download_task(ClipboardDownloadTaskInput {
            transfer_id: id,
            endpoint,
            request,
            target_local_path,
            settings: SftpRuntimeSettings::default(),
            cancel_requested,
            copy_to_clipboard,
            event_emitter: None,
        });
        Ok(summary)
    }
}

pub(super) fn test_endpoint(host_id: &str) -> SftpEndpoint {
    SftpEndpoint {
        host: RemoteHost {
            id: host_id.to_owned(),
            group_id: None,
            name: "dev".to_owned(),
            host: "dev.internal".to_owned(),
            port: 22,
            username: "deploy".to_owned(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
            sort_order: 0,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        },
        auth: SftpAuthMaterial::Agent,
        known_hosts_path: PathBuf::from("known_hosts"),
    }
}

pub(super) fn test_transfer_request(host_id: &str) -> SftpManagedTransferRequest {
    SftpManagedTransferRequest {
        host_id: host_id.to_owned(),
        remote_path: "/var/log/app.log".to_owned(),
        local_path: "C:/tmp/app.log".to_owned(),
        direction: SftpTransferDirection::Download,
        kind: SftpTransferKind::File,
        conflict_policy: SftpTransferConflictPolicy::Overwrite,
        view_scope: None,
    }
}

pub(super) async fn eventually(mut condition: impl FnMut() -> bool) {
    for _ in 0..50 {
        if condition() {
            return;
        }
        sleep(Duration::from_millis(10)).await;
    }
    assert!(condition());
}
