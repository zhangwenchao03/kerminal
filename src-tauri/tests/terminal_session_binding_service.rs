use kerminal_lib::services::terminal_session_binding_service::{
    TerminalSessionBindingCapabilityUse, TerminalSessionBindingEventKind,
    TerminalSessionBindingMetadata, TerminalSessionBindingService, TerminalSessionBindingStatus,
    TerminalSessionSnapshotStatus,
};
use std::time::Duration;

#[test]
fn lifecycle_events_drive_active_and_stale_queries() {
    let service = TerminalSessionBindingService::new(16, Duration::from_millis(100));

    let registered = service
        .register_at("pane-a", "session-a", 10)
        .expect("register binding");
    assert_eq!(registered.status, TerminalSessionBindingStatus::Registered);
    assert_eq!(registered.generation, 1);
    assert_eq!(
        service
            .active_binding_for_pane("pane-a")
            .expect("query pane")
            .map(|binding| binding.session_id),
        Some("session-a".to_owned())
    );

    let ready = service
        .ready_at("pane-a", "session-a", 20)
        .expect("ready binding")
        .expect("registered binding");
    assert_eq!(ready.status, TerminalSessionBindingStatus::Ready);
    assert_eq!(ready.generation, 2);
    assert_eq!(ready.ready_at_ms, Some(20));

    service
        .disconnected_at("pane-a", "session-a", 30)
        .expect("disconnect binding");
    assert!(
        service
            .active_binding_for_session("session-a")
            .expect("query session")
            .is_none(),
        "disconnected bindings are not active"
    );
    assert!(service
        .stale_sessions_at(129)
        .expect("query stale sessions")
        .is_empty());
    assert_eq!(
        service
            .stale_sessions_at(130)
            .expect("query stale sessions")
            .len(),
        1
    );

    let reconnected = service
        .reconnected_at("pane-a", "session-a", 140)
        .expect("reconnect binding")
        .expect("registered binding");
    assert_eq!(reconnected.generation, 4);
    assert!(service
        .stale_sessions_at(240)
        .expect("query stale sessions")
        .is_empty());
    assert_eq!(
        service
            .active_binding_for_session("session-a")
            .expect("query session")
            .map(|binding| binding.pane_id),
        Some("pane-a".to_owned())
    );

    assert!(service
        .closed_at("pane-a", "session-a", 150)
        .expect("close binding"));
    assert!(service
        .active_binding_for_pane("pane-a")
        .expect("query pane")
        .is_none());

    let kinds: Vec<_> = service
        .events()
        .expect("events")
        .into_iter()
        .map(|event| event.kind)
        .collect();
    assert_eq!(
        kinds,
        vec![
            TerminalSessionBindingEventKind::Registered,
            TerminalSessionBindingEventKind::Ready,
            TerminalSessionBindingEventKind::Disconnected,
            TerminalSessionBindingEventKind::Reconnected,
            TerminalSessionBindingEventKind::Closed,
        ]
    );
}

#[test]
fn dual_index_rebinding_records_mismatch_and_replaces_previous_owner() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));

    let first = service
        .register_at("pane-a", "session-a", 1)
        .expect("register first binding");
    assert_eq!(first.generation, 1);
    let second = service
        .register_at("pane-a", "session-b", 2)
        .expect("rebind pane to new session");
    assert_eq!(second.generation, 2);
    assert!(service
        .active_binding_for_session("session-a")
        .expect("query old session")
        .is_none());
    assert_eq!(
        service
            .active_binding_for_pane("pane-a")
            .expect("query pane")
            .map(|binding| (binding.session_id, binding.generation)),
        Some(("session-b".to_owned(), 2))
    );

    let third = service
        .register_at("pane-b", "session-b", 3)
        .expect("rebind session to new pane");
    assert_eq!(third.generation, 3);
    assert!(service
        .active_binding_for_pane("pane-a")
        .expect("query old pane")
        .is_none());
    assert_eq!(
        service
            .active_binding_for_session("session-b")
            .expect("query session")
            .map(|binding| (binding.pane_id, binding.generation)),
        Some(("pane-b".to_owned(), 3))
    );

    let mismatch_count = service
        .events()
        .expect("events")
        .into_iter()
        .filter(|event| event.kind == TerminalSessionBindingEventKind::Mismatch)
        .count();
    assert_eq!(mismatch_count, 2);
}

#[test]
fn register_binding_stores_normalized_target_metadata_in_snapshot() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));

    let snapshot = service
        .register_at_with_metadata(
            "pane-a",
            "session-a",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some(" tab-a ".to_owned()),
                target_ref: Some(" ssh:host-a ".to_owned()),
                target_kind: Some(" ssh ".to_owned()),
                remote_host_id: Some(" host-a ".to_owned()),
                profile_id: None,
                cwd: Some(" /srv/app ".to_owned()),
                shell: Some(" bash ".to_owned()),
            }),
            10,
        )
        .expect("register binding with metadata");

    let metadata = snapshot.metadata.expect("metadata is stored");
    assert_eq!(metadata.tab_id.as_deref(), Some("tab-a"));
    assert_eq!(metadata.target_ref.as_deref(), Some("ssh:host-a"));
    assert_eq!(metadata.target_kind.as_deref(), Some("ssh"));
    assert_eq!(metadata.remote_host_id.as_deref(), Some("host-a"));
    assert_eq!(metadata.cwd.as_deref(), Some("/srv/app"));
    assert_eq!(metadata.shell.as_deref(), Some("bash"));
    assert_eq!(
        service
            .active_binding_for_pane("pane-a")
            .expect("query pane")
            .and_then(|binding| binding.metadata)
            .and_then(|metadata| metadata.remote_host_id),
        Some("host-a".to_owned())
    );
}

#[test]
fn authoritative_target_ref_overwrites_client_metadata() {
    let metadata = TerminalSessionBindingMetadata::with_authoritative_target_ref(
        Some(TerminalSessionBindingMetadata {
            tab_id: Some("tab-a".to_owned()),
            target_ref: Some("ssh:evil".to_owned()),
            target_kind: Some("ssh".to_owned()),
            remote_host_id: Some("host-a".to_owned()),
            profile_id: None,
            cwd: None,
            shell: None,
        }),
        Some("ssh:host-a".to_owned()),
    )
    .expect("metadata remains present");

    assert_eq!(metadata.target_ref.as_deref(), Some("ssh:host-a"));
    assert_eq!(metadata.remote_host_id.as_deref(), Some("host-a"));
}

#[test]
fn missing_authoritative_target_ref_strips_client_target_ref() {
    let metadata = TerminalSessionBindingMetadata::with_authoritative_target_ref(
        Some(TerminalSessionBindingMetadata {
            tab_id: None,
            target_ref: Some("ssh:evil".to_owned()),
            target_kind: None,
            remote_host_id: None,
            profile_id: None,
            cwd: None,
            shell: None,
        }),
        None,
    );

    assert!(metadata.is_none());
}

#[test]
fn repeated_register_updates_metadata_and_advances_generation() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));

    let first = service
        .register_at_with_metadata(
            "pane-a",
            "session-a",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-a".to_owned()),
                target_ref: Some("local:profile-a".to_owned()),
                target_kind: Some("local".to_owned()),
                remote_host_id: None,
                profile_id: Some("profile-a".to_owned()),
                cwd: Some("/tmp/old".to_owned()),
                shell: Some("pwsh".to_owned()),
            }),
            10,
        )
        .expect("register first binding");
    let second = service
        .register_at_with_metadata(
            "pane-a",
            "session-a",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-a".to_owned()),
                target_ref: Some("local:profile-a".to_owned()),
                target_kind: Some("local".to_owned()),
                remote_host_id: None,
                profile_id: Some("profile-a".to_owned()),
                cwd: Some("/tmp/new".to_owned()),
                shell: Some("pwsh".to_owned()),
            }),
            20,
        )
        .expect("register metadata update");

    assert!(second.generation > first.generation);
    assert_eq!(second.registered_at_ms, 20);
    assert_eq!(
        service
            .active_binding_for_pane("pane-a")
            .expect("query active binding")
            .map(|binding| {
                (
                    binding.generation,
                    binding
                        .metadata
                        .and_then(|metadata| metadata.cwd)
                        .unwrap_or_default(),
                )
            }),
        Some((second.generation, "/tmp/new".to_owned()))
    );
}

#[test]
fn target_capability_rejects_expired_unclaimed_token() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));

    let result = service.register_at_with_metadata_and_capability(
        "pane-a",
        "session-a",
        None,
        Some(TerminalSessionBindingCapabilityUse {
            jti: "token-a".to_owned(),
            expires_at_ms: 99,
        }),
        100,
    );

    assert!(result
        .expect_err("expired capability is rejected")
        .to_string()
        .contains("已过期"));
    assert_eq!(
        service
            .events()
            .expect("events")
            .last()
            .map(|event| event.kind),
        Some(TerminalSessionBindingEventKind::Mismatch)
    );
}

#[test]
fn target_capability_binds_jti_to_first_pane_session_pair() {
    let service = TerminalSessionBindingService::new(16, Duration::from_secs(60));

    let first = service
        .register_at_with_metadata_and_capability(
            "pane-a",
            "session-a",
            None,
            Some(TerminalSessionBindingCapabilityUse {
                jti: "token-a".to_owned(),
                expires_at_ms: 100,
            }),
            10,
        )
        .expect("first claim");
    let second = service
        .register_at_with_metadata_and_capability(
            "pane-a",
            "session-a",
            None,
            Some(TerminalSessionBindingCapabilityUse {
                jti: "token-a".to_owned(),
                expires_at_ms: 100,
            }),
            200,
        )
        .expect("same binding can refresh after claim");
    let replay = service.register_at_with_metadata_and_capability(
        "pane-b",
        "session-a",
        None,
        Some(TerminalSessionBindingCapabilityUse {
            jti: "token-a".to_owned(),
            expires_at_ms: 100,
        }),
        210,
    );

    assert_eq!(first.generation, 1);
    assert!(second.generation > first.generation);
    assert!(replay
        .expect_err("cross-pane replay is rejected")
        .to_string()
        .contains("已被其它终端绑定使用"));
}

#[test]
fn snapshot_events_update_binding_and_event_log_is_bounded() {
    let service = TerminalSessionBindingService::new(4, Duration::from_secs(60));

    service
        .register_at("pane-a", "session-a", 10)
        .expect("register binding");
    service
        .record_snapshot_resolved_at("pane-a", "session-a", 11)
        .expect("resolve snapshot");
    service
        .record_snapshot_rejected_at("pane-a", "session-a", 12)
        .expect("reject snapshot");
    let degraded = service
        .record_snapshot_degraded_at("pane-a", "session-a", 13)
        .expect("degrade snapshot")
        .expect("registered binding");
    assert_eq!(degraded.generation, 4);
    assert_eq!(
        degraded.last_snapshot_status,
        Some(TerminalSessionSnapshotStatus::Degraded)
    );

    service
        .ready_at("pane-missing", "session-missing", 14)
        .expect("missing ready records mismatch");

    let events = service.events().expect("events");
    assert_eq!(events.len(), 4);
    assert_eq!(events[0].sequence, 2, "oldest event was evicted");
    assert_eq!(
        events.iter().map(|event| event.kind).collect::<Vec<_>>(),
        vec![
            TerminalSessionBindingEventKind::SnapshotResolved,
            TerminalSessionBindingEventKind::SnapshotRejected,
            TerminalSessionBindingEventKind::SnapshotDegraded,
            TerminalSessionBindingEventKind::Mismatch,
        ]
    );
}
