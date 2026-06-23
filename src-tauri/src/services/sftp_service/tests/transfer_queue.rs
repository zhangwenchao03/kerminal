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

#[test]
fn enqueue_transfer_from_sync_context_does_not_require_tokio_reactor() {
    let service = SftpService::with_backend(Arc::new(FakeSftpBackend {
        delay_ms: 1,
        ..FakeSftpBackend::default()
    }));
    let endpoint = test_endpoint("host-1");
    let request = test_transfer_request("host-1");
    let summary = service
        .enqueue_resolved_for_test(endpoint, request)
        .expect("enqueue transfer from sync context");

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        if service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Succeeded)
        {
            return;
        }

        assert!(
            std::time::Instant::now() < deadline,
            "sync enqueue should schedule its background transfer without a current Tokio reactor"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
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
            view_scope: None,
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

#[test]
fn clear_completed_transfers_keeps_active_tasks_in_created_order() {
    let service = SftpService::with_backend(Arc::new(FakeSftpBackend::default()));

    insert_transfer_with_status(&service, "succeeded", SftpTransferStatus::Succeeded, 1);
    insert_transfer_with_status(&service, "running-newer", SftpTransferStatus::Running, 4);
    insert_transfer_with_status(&service, "canceled", SftpTransferStatus::Canceled, 3);
    insert_transfer_with_status(&service, "queued-older", SftpTransferStatus::Queued, 2);
    insert_transfer_with_status(&service, "failed", SftpTransferStatus::Failed, 5);

    let remaining = service
        .clear_completed_transfers()
        .expect("clear completed transfers");

    assert_eq!(
        remaining
            .iter()
            .map(|summary| summary.id.as_str())
            .collect::<Vec<_>>(),
        vec!["queued-older", "running-newer"]
    );
    assert!(remaining.iter().all(|summary| matches!(
        summary.status,
        SftpTransferStatus::Queued | SftpTransferStatus::Running
    )));
}

#[test]
fn scoped_transfer_registry_keeps_view_histories_isolated() {
    let service = SftpService::with_backend(Arc::new(FakeSftpBackend::default()));

    insert_transfer_with_status_and_scope(
        &service,
        "succeeded-a",
        SftpTransferStatus::Succeeded,
        1,
        Some("scope-a"),
    );
    insert_transfer_with_status_and_scope(
        &service,
        "queued-a",
        SftpTransferStatus::Queued,
        2,
        Some("scope-a"),
    );
    insert_transfer_with_status_and_scope(
        &service,
        "succeeded-b",
        SftpTransferStatus::Succeeded,
        3,
        Some("scope-b"),
    );
    insert_transfer_with_status_and_scope(
        &service,
        "running-b",
        SftpTransferStatus::Running,
        4,
        Some("scope-b"),
    );

    let scope_a = SftpTransferScopeRequest {
        view_scope: Some("scope-a".to_owned()),
    };
    let scope_b = SftpTransferScopeRequest {
        view_scope: Some("scope-b".to_owned()),
    };

    assert_eq!(
        service
            .list_transfers_for_scope(scope_a.clone())
            .expect("list scope a")
            .iter()
            .map(|summary| summary.id.as_str())
            .collect::<Vec<_>>(),
        vec!["succeeded-a", "queued-a"]
    );
    assert!(
        service
            .cancel_transfer(SftpTransferCancelRequest {
                transfer_id: "queued-a".to_owned(),
                view_scope: scope_b.view_scope.clone(),
            })
            .is_err(),
        "a transfer from another view scope must not be cancelable"
    );

    let canceled = service
        .cancel_transfer(SftpTransferCancelRequest {
            transfer_id: "queued-a".to_owned(),
            view_scope: scope_a.view_scope.clone(),
        })
        .expect("cancel scope a transfer");
    assert_eq!(canceled.id, "queued-a");
    assert!(canceled.cancel_requested);

    let remaining_scope_a = service
        .clear_completed_transfers_for_scope(scope_a)
        .expect("clear scope a");
    assert!(
        remaining_scope_a.is_empty(),
        "scoped clear should return only the active view history"
    );
    assert_eq!(
        service
            .list_transfers_for_scope(scope_b)
            .expect("list scope b")
            .iter()
            .map(|summary| summary.id.as_str())
            .collect::<Vec<_>>(),
        vec!["succeeded-b", "running-b"]
    );
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
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
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
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
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
            view_scope: None,
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
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
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

fn insert_transfer_with_status(
    service: &SftpService,
    id: &str,
    status: SftpTransferStatus,
    created_at: u64,
) {
    insert_transfer_with_status_and_scope(service, id, status, created_at, None);
}

fn insert_transfer_with_status_and_scope(
    service: &SftpService,
    id: &str,
    status: SftpTransferStatus,
    created_at: u64,
    view_scope: Option<&str>,
) {
    let endpoint = test_endpoint("host-1");
    let mut request = test_transfer_request("host-1");
    request.view_scope = view_scope.map(str::to_owned);
    let cancel_requested = Arc::new(AtomicBool::new(status == SftpTransferStatus::Canceled));
    let summary = SftpTransferSummary {
        id: id.to_owned(),
        host_id: request.host_id.clone(),
        view_scope: request.view_scope.clone(),
        remote_path: request.remote_path.clone(),
        local_path: request.local_path.clone(),
        direction: request.direction,
        kind: request.kind,
        status,
        bytes_transferred: 0,
        total_bytes: None,
        error: if status == SftpTransferStatus::Failed {
            Some("failed for registry test".to_owned())
        } else {
            None
        },
        cancel_requested: status == SftpTransferStatus::Canceled,
        created_at,
        updated_at: created_at,
        operation: Some(managed_transfer_operation(request.direction)),
        source: Some(managed_transfer_source(&endpoint, &request)),
        target: Some(managed_transfer_target(&endpoint, &request)),
        transport_mode: Some(SftpTransferTransportMode::SingleHostSftp),
        phase: Some("queued".to_owned()),
        current_item: None,
    };

    service.transfers().expect("transfer registry").insert(
        id.to_owned(),
        TransferTask {
            summary,
            cancel_requested,
        },
    );
}
