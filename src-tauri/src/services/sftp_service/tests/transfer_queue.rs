use super::*;

#[tokio::test]
async fn transfer_progress_tracks_running_and_successful_tasks() {
    let service = SftpService::with_backend(Arc::new(FakeSftpBackend {
        delay_ms: 1,
        ..FakeSftpBackend::default()
    }));
    let endpoint = test_endpoint("host-1");
    let request = test_transfer_request("host-1");
    let summary = service
        .enqueue_resolved_for_test(endpoint, request)
        .expect("enqueue transfer");

    eventually(|| {
        let tasks = service.list_transfers().expect("list transfers");
        let current = tasks
            .iter()
            .find(|task| task.id == summary.id)
            .expect("task exists");
        current.status == SftpTransferStatus::Succeeded
            && current.bytes_transferred == 100
            && current.total_bytes == Some(100)
    })
    .await;
}

#[tokio::test]
async fn transfer_cancel_marks_running_task_canceled() {
    let service = SftpService::with_backend(Arc::new(FakeSftpBackend {
        delay_ms: 10,
        ..FakeSftpBackend::default()
    }));
    let endpoint = test_endpoint("host-1");
    let request = test_transfer_request("host-1");
    let summary = service
        .enqueue_resolved_for_test(endpoint, request)
        .expect("enqueue transfer");

    eventually(|| {
        service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Running)
    })
    .await;

    let canceled = service
        .cancel_transfer(SftpTransferCancelRequest {
            transfer_id: summary.id.clone(),
        })
        .expect("cancel transfer");
    assert!(canceled.cancel_requested);

    eventually(|| {
        service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Canceled)
    })
    .await;
}

#[tokio::test]
async fn transfer_queue_uses_configured_global_and_host_limits() {
    let backend = Arc::new(FakeSftpBackend {
        delay_ms: 15,
        ..FakeSftpBackend::default()
    });
    let service = SftpService::with_backend(backend.clone());
    let settings = SftpRuntimeSettings {
        global_transfers: 2,
        host_transfers: 1,
        ..SftpRuntimeSettings::default()
    };

    for host_id in ["host-1", "host-1", "host-2", "host-2"] {
        service
            .enqueue_resolved_with_settings_for_test(
                test_endpoint(host_id),
                test_transfer_request(host_id),
                settings,
            )
            .expect("enqueue transfer");
    }

    eventually(|| {
        service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .all(|task| task.status == SftpTransferStatus::Succeeded)
    })
    .await;

    assert!(
        backend.max_global() <= 2,
        "configured global limit must cap concurrent transfers"
    );
    assert_eq!(backend.max_host("host-1"), 1);
    assert_eq!(backend.max_host("host-2"), 1);
}

#[tokio::test]
async fn remote_copy_task_uses_source_and_target_hosts() {
    let backend = Arc::new(FakeSftpBackend {
        delay_ms: 1,
        ..FakeSftpBackend::default()
    });
    let service = SftpService::with_backend(backend.clone());
    let temp_root = tempdir().expect("remote copy temp root");
    let summary = service
        .enqueue_remote_copy_resolved_for_test(
            test_endpoint("source-host"),
            test_endpoint("target-host"),
            SftpRemoteCopyRequest {
                source_host_id: "source-host".to_owned(),
                source_remote_path: "/var/log/app.log".to_owned(),
                target_host_id: "target-host".to_owned(),
                target_remote_path: "/srv/app/app.log".to_owned(),
                kind: SftpTransferKind::File,
            },
            temp_root.path().to_path_buf(),
        )
        .expect("enqueue remote copy");

    assert_eq!(summary.host_id, "target-host");
    assert_eq!(summary.direction, SftpTransferDirection::Upload);
    assert_eq!(summary.remote_path, "/srv/app/app.log");
    assert_eq!(summary.local_path, "sftp://source-host/var/log/app.log");
    assert_eq!(summary.operation, Some(SftpTransferOperation::RemoteCopy));
    assert_eq!(
        summary.transport_mode,
        Some(SftpTransferTransportMode::ClientBridge)
    );
    assert_eq!(summary.phase.as_deref(), Some("queued"));
    assert_eq!(
        summary.source,
        Some(SftpTransferEndpoint::Remote {
            host_id: "source-host".to_owned(),
            host_label: "dev".to_owned(),
            path: "/var/log/app.log".to_owned(),
        })
    );
    assert_eq!(
        summary.target,
        Some(SftpTransferEndpoint::Remote {
            host_id: "target-host".to_owned(),
            host_label: "dev".to_owned(),
            path: "/srv/app/app.log".to_owned(),
        })
    );

    eventually(|| {
        service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Succeeded)
    })
    .await;

    assert_eq!(backend.max_host("source-host"), 1);
    assert_eq!(backend.max_host("target-host"), 1);
    assert_eq!(backend.max_global(), 2);
}

#[tokio::test]
async fn remote_copy_cancel_marks_task_canceled_and_releases_permits() {
    let backend = Arc::new(FakeSftpBackend {
        delay_ms: 10,
        ..FakeSftpBackend::default()
    });
    let service = SftpService::with_backend(backend.clone());
    let temp_root = tempdir().expect("remote copy cancel temp root");
    let summary = service
        .enqueue_remote_copy_resolved_for_test(
            test_endpoint("source-host"),
            test_endpoint("target-host"),
            SftpRemoteCopyRequest {
                source_host_id: "source-host".to_owned(),
                source_remote_path: "/var/log/app.log".to_owned(),
                target_host_id: "target-host".to_owned(),
                target_remote_path: "/srv/app/app.log".to_owned(),
                kind: SftpTransferKind::File,
            },
            temp_root.path().to_path_buf(),
        )
        .expect("enqueue remote copy");

    eventually(|| {
        service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Running)
    })
    .await;

    service
        .cancel_transfer(SftpTransferCancelRequest {
            transfer_id: summary.id.clone(),
        })
        .expect("cancel remote copy");

    eventually(|| {
        service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Canceled)
    })
    .await;

    eventually(|| backend.active_global.load(Ordering::SeqCst) == 0).await;
}

#[tokio::test]
async fn staged_remote_copy_removes_temp_dir_on_success() {
    let backend = Arc::new(FakeSftpBackend {
        delay_ms: 1,
        write_downloads: true,
        ..FakeSftpBackend::default()
    });
    let service = SftpService::with_backend(backend);
    let temp_root = tempdir().expect("staged remote copy temp root");
    let summary = service
        .enqueue_remote_copy_resolved_for_test(
            test_endpoint("same-host"),
            test_endpoint("same-host"),
            SftpRemoteCopyRequest {
                source_host_id: "same-host".to_owned(),
                source_remote_path: "/var".to_owned(),
                target_host_id: "same-host".to_owned(),
                target_remote_path: "/var/backup".to_owned(),
                kind: SftpTransferKind::Directory,
            },
            temp_root.path().to_path_buf(),
        )
        .expect("enqueue staged remote copy");

    assert_eq!(
        summary.transport_mode,
        Some(SftpTransferTransportMode::LocalStage)
    );

    eventually(|| {
        service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Succeeded)
    })
    .await;

    assert!(
        !temp_root
            .path()
            .join("sftp-remote-copy")
            .join(&summary.id)
            .exists(),
        "staged remote copy should remove its temporary directory"
    );
}
