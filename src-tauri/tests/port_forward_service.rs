//! SSH 端口转发服务集成测试。
//!
//! @author kongweiguang

mod support;

use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::Arc,
    thread,
    time::Duration,
};

use kerminal_lib::{
    error::AppError,
    models::{
        port_forward::{
            PortForwardCreateRequest, PortForwardEndpoint, PortForwardKind, PortForwardOrigin,
            PortForwardProxyApplyScope, PortForwardProxyProtocol, PortForwardPurpose,
            PortForwardRuntimeMode, PortForwardStatus, PortForwardSummary,
        },
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest},
    },
    paths::KerminalPaths,
    services::{
        external_launch::{ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint},
        port_forward_service::PortForwardService,
        ssh_runtime::{
            ManagedSshSessionManager, SshChannelKind, SshRuntimeDynamicForwardRequest,
            SshRuntimeLocalForwardRequest, SshRuntimeRemoteDynamicForwardRequest,
            SshRuntimeRemoteForwardRequest, MANAGED_SSH_CAPABILITY_RUNTIME_FLAG,
        },
    },
    state::AppState,
};
use support::{
    managed_ssh_runtime::FakeManagedSshRuntime,
    ssh_terminal_smoke::{
        trust_loopback_host_key, LoopbackTerminalJumpServer, LOOPBACK_JUMP_PASSWORD,
    },
};
use tempfile::{tempdir, TempDir};

#[test]
fn create_forward_rejects_unknown_remote_host_before_spawning_ssh() {
    let (_home, state) = test_state();

    let error = state
        .port_forwards()
        .create(
            state.storage(),
            state.remote_hosts(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: "missing-host".to_owned(),
                kind: PortForwardKind::Local,
                name: Some("missing".to_owned()),
                source_port: 15432,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(5432),
                ..Default::default()
            },
        )
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
}

#[test]
fn create_forward_missing_external_target_does_not_read_host_toml_path() {
    let (_home, state) = test_state();

    let error = state
        .port_forwards()
        .create(
            state.storage(),
            state.remote_hosts(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: "external:missing-launch".to_owned(),
                kind: PortForwardKind::Local,
                name: Some("missing external".to_owned()),
                source_port: 15432,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(80),
                ..Default::default()
            },
        )
        .expect_err("missing external target should fail before file store");

    let message = error.to_string();
    assert!(matches!(error, AppError::NotFound(_)));
    assert!(message.contains("外部 SSH 临时目标不存在或已关闭"));
    assert!(!message.contains("invalid remote host id"));
    assert!(!message.contains("invalid file store path"));
}

#[test]
fn create_local_forward_prefers_managed_runtime_and_releases_channel_on_stop() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host_id.clone(),
                kind: PortForwardKind::Local,
                name: Some("managed local tunnel".to_owned()),
                source_port,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(5432),
                ..Default::default()
            },
        )
        .expect("create managed local forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    let runtime = summary.runtime.as_ref().expect("runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::ManagedSshRuntime);
    assert_eq!(runtime.backend, "native-russh");
    assert_eq!(runtime.tunnel_kind, "local");
    assert_eq!(runtime.cleanup_status, "active");
    assert_eq!(
        runtime.managed_channel_kind.as_deref(),
        Some(SshChannelKind::DirectTcpIp.as_str())
    );
    assert_eq!(
        runtime.managed_tunnel_id.as_deref(),
        Some("fake-managed-forward")
    );
    assert!(runtime
        .managed_session_id
        .as_deref()
        .is_some_and(|session_id| !session_id.is_empty()));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.local_forward_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_local_forward_request(),
        Some(SshRuntimeLocalForwardRequest::new(
            "127.0.0.1",
            source_port,
            "127.0.0.1",
            5432
        ))
    );
    let running_snapshot = manager.snapshot().expect("running managed snapshot");
    assert_eq!(running_snapshot.active_sessions, 1);
    assert_eq!(running_snapshot.active_channels, 1);
    assert!(running_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        running_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::DirectTcpIp),
        Some(&1)
    );

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop managed local forward"));
    let stopped = service
        .get(state.storage(), &summary.id)
        .expect("read stopped summary")
        .expect("stopped summary");
    assert_eq!(stopped.status, PortForwardStatus::Exited);
    assert_eq!(stopped.pid, None);
    assert_eq!(
        stopped
            .runtime
            .as_ref()
            .expect("stopped runtime diagnostics")
            .cleanup_status,
        "stopped"
    );
    let stopped_snapshot = manager.snapshot().expect("stopped managed snapshot");
    assert_eq!(stopped_snapshot.active_sessions, 1);
    assert_eq!(stopped_snapshot.active_channels, 0);
}

#[test]
fn create_external_local_forward_uses_capability_runtime_lane() {
    let (_home, state) = test_state();
    let launch_id = queue_putty_external_password_launch(&state, 2222);
    let pending = state
        .external_launch_intake()
        .take_pending()
        .expect("take pending external launch");
    assert_eq!(pending.len(), 1);
    let target = state
        .external_session_materializer()
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external launch");
    state
        .external_launch_intake()
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external launch secret");
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: target.host_id,
                kind: PortForwardKind::Local,
                name: Some("external managed local tunnel".to_owned()),
                source_port,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(80),
                ..Default::default()
            },
        )
        .expect("create external managed local forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.local_forward_count(), 1);
    assert_eq!(
        backend.last_local_forward_request(),
        Some(SshRuntimeLocalForwardRequest::new(
            "127.0.0.1",
            source_port,
            "127.0.0.1",
            80
        ))
    );
    let key = backend.last_key().expect("runtime key");
    assert!(key
        .runtime_flags
        .iter()
        .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG));
    let snapshot = manager.snapshot().expect("managed snapshot");
    assert_eq!(snapshot.active_sessions, 1);
    assert_eq!(snapshot.sessions[0].key.runtime_flags, key.runtime_flags);

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop external managed local forward"));
}

#[test]
fn create_remote_forward_prefers_managed_runtime_and_releases_channel_on_stop() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: host_id.clone(),
                kind: PortForwardKind::Remote,
                name: Some("managed remote tunnel".to_owned()),
                remote_bind_host: Some("127.0.0.1".to_owned()),
                source_port,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(5432),
                ..Default::default()
            },
        )
        .expect("create managed remote forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    let runtime = summary.runtime.as_ref().expect("runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::ManagedSshRuntime);
    assert_eq!(runtime.backend, "native-russh");
    assert_eq!(runtime.tunnel_kind, "remote");
    assert_eq!(
        runtime.managed_channel_kind.as_deref(),
        Some(SshChannelKind::ForwardListener.as_str())
    );
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.remote_forward_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_remote_forward_request(),
        Some(SshRuntimeRemoteForwardRequest::new(
            "127.0.0.1",
            source_port,
            "127.0.0.1",
            5432
        ))
    );
    let running_snapshot = manager.snapshot().expect("running managed snapshot");
    assert_eq!(running_snapshot.active_sessions, 1);
    assert_eq!(running_snapshot.active_channels, 1);
    assert!(running_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        running_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::ForwardListener),
        Some(&1)
    );

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop managed remote forward"));
    let stopped_snapshot = manager.snapshot().expect("stopped managed snapshot");
    assert_eq!(stopped_snapshot.active_sessions, 1);
    assert_eq!(stopped_snapshot.active_channels, 0);
}

#[test]
fn create_host_network_assist_http_prefers_managed_remote_forward() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();
    let local_proxy_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: host_id.clone(),
                kind: PortForwardKind::Remote,
                local_endpoint: Some(PortForwardEndpoint {
                    host: "127.0.0.1".to_owned(),
                    label: Some("本机 HTTP CONNECT 代理".to_owned()),
                    port: Some(local_proxy_port),
                }),
                name: Some("managed host network assist".to_owned()),
                origin: PortForwardOrigin::NetworkAssist,
                proxy_protocol: Some(PortForwardProxyProtocol::Http),
                purpose: PortForwardPurpose::HostNetworkAssist,
                remote_bind_host: Some("127.0.0.1".to_owned()),
                source_port,
                ..Default::default()
            },
        )
        .expect("create managed host network assist http forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    let runtime = summary.runtime.as_ref().expect("runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::ManagedSshRuntime);
    assert_eq!(runtime.tunnel_kind, "hostNetworkAssistHttp");
    assert_eq!(
        runtime.managed_channel_kind.as_deref(),
        Some(SshChannelKind::ForwardListener.as_str())
    );
    assert_eq!(summary.purpose, PortForwardPurpose::HostNetworkAssist);
    assert_eq!(summary.origin, PortForwardOrigin::NetworkAssist);
    assert_eq!(summary.proxy_protocol, Some(PortForwardProxyProtocol::Http));
    assert_eq!(summary.target_host.as_deref(), Some("127.0.0.1"));
    assert_eq!(summary.target_port, Some(local_proxy_port));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.remote_forward_count(), 1);
    assert_eq!(backend.local_forward_count(), 0);
    assert_eq!(backend.dynamic_forward_count(), 0);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_remote_forward_request(),
        Some(SshRuntimeRemoteForwardRequest::new(
            "127.0.0.1",
            source_port,
            "127.0.0.1",
            local_proxy_port
        ))
    );
    let running_snapshot = manager.snapshot().expect("running managed snapshot");
    assert_eq!(running_snapshot.active_sessions, 1);
    assert_eq!(running_snapshot.active_channels, 1);
    assert!(running_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        running_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::ForwardListener),
        Some(&1)
    );

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop managed host network assist forward"));
    let stopped = service
        .get(state.storage(), &summary.id)
        .expect("read stopped summary")
        .expect("stopped summary");
    assert_eq!(stopped.status, PortForwardStatus::Exited);
    assert_eq!(stopped.pid, None);
    let stopped_snapshot = manager.snapshot().expect("stopped managed snapshot");
    assert_eq!(stopped_snapshot.active_sessions, 1);
    assert_eq!(stopped_snapshot.active_channels, 0);
}

#[test]
fn create_host_network_assist_socks5_prefers_managed_remote_dynamic_forward() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: host_id.clone(),
                kind: PortForwardKind::Remote,
                name: Some("managed host network assist socks".to_owned()),
                origin: PortForwardOrigin::NetworkAssist,
                proxy_protocol: Some(PortForwardProxyProtocol::Socks5),
                purpose: PortForwardPurpose::HostNetworkAssist,
                remote_bind_host: Some("127.0.0.1".to_owned()),
                source_port,
                ..Default::default()
            },
        )
        .expect("create managed host network assist socks forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    let runtime = summary.runtime.as_ref().expect("runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::ManagedSshRuntime);
    assert_eq!(runtime.tunnel_kind, "hostNetworkAssistSocks5");
    assert_eq!(
        runtime.managed_channel_kind.as_deref(),
        Some(SshChannelKind::ForwardListener.as_str())
    );
    assert_eq!(summary.purpose, PortForwardPurpose::HostNetworkAssist);
    assert_eq!(summary.origin, PortForwardOrigin::NetworkAssist);
    assert_eq!(
        summary.proxy_protocol,
        Some(PortForwardProxyProtocol::Socks5)
    );
    assert_eq!(summary.target_host, None);
    assert_eq!(summary.target_port, None);
    assert_eq!(
        summary.proxy_url,
        Some(format!("socks5h://127.0.0.1:{source_port}"))
    );
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.remote_dynamic_forward_count(), 1);
    assert_eq!(backend.remote_forward_count(), 0);
    assert_eq!(backend.local_forward_count(), 0);
    assert_eq!(backend.dynamic_forward_count(), 0);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_remote_dynamic_forward_request(),
        Some(SshRuntimeRemoteDynamicForwardRequest::new(
            "127.0.0.1",
            source_port
        ))
    );
    let running_snapshot = manager.snapshot().expect("running managed snapshot");
    assert_eq!(running_snapshot.active_sessions, 1);
    assert_eq!(running_snapshot.active_channels, 1);
    assert!(running_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        running_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::ForwardListener),
        Some(&1)
    );

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop managed host network assist socks forward"));
    let stopped_snapshot = manager.snapshot().expect("stopped managed snapshot");
    assert_eq!(stopped_snapshot.active_sessions, 1);
    assert_eq!(stopped_snapshot.active_channels, 0);
}

#[test]
fn create_dynamic_forward_prefers_managed_runtime_and_releases_channel_on_stop() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = PortForwardService::with_ssh_runtime(
        manager.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let source_port = unused_local_port();

    let summary = service
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host_id.clone(),
                kind: PortForwardKind::Dynamic,
                name: Some("managed socks tunnel".to_owned()),
                source_port,
                ..Default::default()
            },
        )
        .expect("create managed dynamic forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    let runtime = summary.runtime.as_ref().expect("runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::ManagedSshRuntime);
    assert_eq!(runtime.tunnel_kind, "dynamic");
    assert_eq!(
        runtime.managed_channel_kind.as_deref(),
        Some(SshChannelKind::DirectTcpIp.as_str())
    );
    assert_eq!(
        summary.proxy_protocol,
        Some(PortForwardProxyProtocol::Socks5)
    );
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.dynamic_forward_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_dynamic_forward_request(),
        Some(SshRuntimeDynamicForwardRequest::new(
            "127.0.0.1",
            source_port
        ))
    );
    let running_snapshot = manager.snapshot().expect("running managed snapshot");
    assert_eq!(running_snapshot.active_sessions, 1);
    assert_eq!(running_snapshot.active_channels, 1);
    assert!(running_snapshot.recent_legacy_fallbacks.is_empty());
    assert_eq!(
        running_snapshot.sessions[0]
            .channel_counts
            .get(&SshChannelKind::DirectTcpIp),
        Some(&1)
    );

    assert!(service
        .stop(state.storage(), &summary.id)
        .expect("stop managed dynamic forward"));
    let stopped_snapshot = manager.snapshot().expect("stopped managed snapshot");
    assert_eq!(stopped_snapshot.active_sessions, 1);
    assert_eq!(stopped_snapshot.active_channels, 0);
}

#[test]
fn create_local_forward_with_native_runtime_proxies_bytes_over_direct_tcpip() {
    let echo = EchoServer::start();
    let ssh_server = LoopbackTerminalJumpServer::start(echo.addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host.id.clone(),
                kind: PortForwardKind::Local,
                name: Some("native direct-tcpip".to_owned()),
                source_port,
                target_host: Some(echo.addr.ip().to_string()),
                target_port: Some(echo.addr.port()),
                ..Default::default()
            },
        )
        .expect("create native managed local forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);

    let payload = b"kerminal-managed-forward";
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect local forward listener");
    client.write_all(payload).expect("write forward payload");
    let mut echoed = vec![0_u8; payload.len()];
    client.read_exact(&mut echoed).expect("read echo payload");

    assert_eq!(echoed, payload);
    assert_eq!(
        ssh_server
            .direct_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed local forward"));
    let stopped_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("stopped native managed snapshot");
    assert_eq!(stopped_snapshot.active_channels, 0);
    echo.join();
}

#[test]
fn create_local_forward_with_native_runtime_proxies_http_assets_over_direct_tcpip() {
    let http = HttpAssetServer::start(4);
    let ssh_server = LoopbackTerminalJumpServer::start(http.addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback http forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host.id.clone(),
                kind: PortForwardKind::Local,
                name: Some("native direct-tcpip http assets".to_owned()),
                source_port,
                target_host: Some(http.addr.ip().to_string()),
                target_port: Some(http.addr.port()),
                ..Default::default()
            },
        )
        .expect("create native managed local forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);

    let paths = ["/", "/map.min.js", "/three.min.js", "/assets/index.css"];
    let clients = paths
        .into_iter()
        .map(|path| {
            thread::spawn(move || {
                let response = http_get_via_forward(source_port, path);
                assert!(
                    response.starts_with("HTTP/1.1 200 OK"),
                    "unexpected response for {path}: {response:?}"
                );
                assert!(
                    response.contains(&format!("asset:{path}:")),
                    "missing HTTP asset body for {path}: {response:?}"
                );
            })
        })
        .collect::<Vec<_>>();
    for client in clients {
        client.join().expect("HTTP asset client should finish");
    }

    assert_eq!(
        ssh_server
            .direct_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        4
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed local HTTP forward"));
    let stopped_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("stopped native managed snapshot");
    assert_eq!(stopped_snapshot.active_channels, 0);
    http.join();
}

#[test]
fn local_forward_target_failure_keeps_cached_connection_alive() {
    let allowed_target = TcpListener::bind(("127.0.0.1", 0)).expect("bind allowed target marker");
    let allowed_addr = allowed_target
        .local_addr()
        .expect("read allowed target marker");
    let ssh_server = LoopbackTerminalJumpServer::start(allowed_addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback reconnect forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();
    let rejected_target_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host.id.clone(),
                kind: PortForwardKind::Local,
                name: Some("native direct-tcpip reconnect".to_owned()),
                source_port,
                target_host: Some(allowed_addr.ip().to_string()),
                target_port: Some(rejected_target_port),
                ..Default::default()
            },
        )
        .expect("create native managed local forward");

    trigger_local_forward_attempt(source_port);
    wait_for_atomic_count(&ssh_server.auth_attempts, 1);
    trigger_local_forward_attempt(source_port);
    thread::sleep(Duration::from_millis(200));

    assert_eq!(
        ssh_server
            .auth_attempts
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed reconnect forward"));
}

#[test]
fn create_dynamic_forward_with_native_runtime_proxies_socks5_over_direct_tcpip() {
    let echo = EchoServer::start();
    let ssh_server = LoopbackTerminalJumpServer::start(echo.addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback dynamic forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: host.id.clone(),
                kind: PortForwardKind::Dynamic,
                name: Some("native socks direct-tcpip".to_owned()),
                source_port,
                ..Default::default()
            },
        )
        .expect("create native managed dynamic forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);

    let payload = b"kerminal-managed-socks-forward";
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect dynamic forward listener");
    socks5_connect(&mut client, echo.addr);
    client.write_all(payload).expect("write socks payload");
    let mut echoed = vec![0_u8; payload.len()];
    client
        .read_exact(&mut echoed)
        .expect("read socks echo payload");

    assert_eq!(echoed, payload);
    assert_eq!(
        ssh_server
            .direct_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed dynamic forward"));
    let stopped_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("stopped native managed snapshot");
    assert_eq!(stopped_snapshot.active_channels, 0);
    echo.join();
}

#[test]
fn create_remote_forward_with_native_runtime_proxies_bytes_over_forwarded_tcpip() {
    let echo = EchoServer::start();
    let ssh_server = LoopbackTerminalJumpServer::start(echo.addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback remote forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: host.id.clone(),
                kind: PortForwardKind::Remote,
                name: Some("native forwarded-tcpip".to_owned()),
                remote_bind_host: Some("127.0.0.1".to_owned()),
                source_port,
                target_host: Some(echo.addr.ip().to_string()),
                target_port: Some(echo.addr.port()),
                ..Default::default()
            },
        )
        .expect("create native managed remote forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);

    let payload = b"kerminal-managed-remote-forward";
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect remote forward listener");
    client.write_all(payload).expect("write forward payload");
    let mut echoed = vec![0_u8; payload.len()];
    client.read_exact(&mut echoed).expect("read echo payload");

    assert_eq!(echoed, payload);
    assert_eq!(
        ssh_server
            .forwarded_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed remote forward"));
    let stopped_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("stopped native managed snapshot");
    assert_eq!(stopped_snapshot.active_channels, 0);
    echo.join();
}

#[test]
fn create_host_network_assist_socks5_with_native_runtime_proxies_remote_dynamic_bytes() {
    let echo = EchoServer::start();
    let ssh_server = LoopbackTerminalJumpServer::start(echo.addr);
    let (_home, state) = test_state();
    trust_loopback_host_key(
        state.paths(),
        "127.0.0.1",
        ssh_server.addr.port(),
        &ssh_server.host_key,
    )
    .expect("trust loopback SSH host key");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: "loopback remote dynamic forward".to_owned(),
            port: ssh_server.addr.port(),
            production: false,
            ssh_options: Default::default(),
            tags: Vec::new(),
            username: "jump".to_owned(),
        })
        .expect("create loopback SSH host");
    let source_port = unused_local_port();

    let summary = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: host.id.clone(),
                kind: PortForwardKind::Remote,
                name: Some("native remote dynamic socks".to_owned()),
                origin: PortForwardOrigin::NetworkAssist,
                proxy_protocol: Some(PortForwardProxyProtocol::Socks5),
                purpose: PortForwardPurpose::HostNetworkAssist,
                remote_bind_host: Some("127.0.0.1".to_owned()),
                source_port,
                ..Default::default()
            },
        )
        .expect("create native managed remote dynamic forward");

    assert_eq!(summary.status, PortForwardStatus::Running);
    assert_eq!(summary.pid, None);
    assert_eq!(summary.target_host, None);
    assert_eq!(summary.target_port, None);

    let payload = b"kerminal-managed-remote-dynamic-forward";
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect remote dynamic listener");
    socks5_connect(&mut client, echo.addr);
    client
        .write_all(payload)
        .expect("write remote dynamic payload");
    let mut echoed = vec![0_u8; payload.len()];
    client
        .read_exact(&mut echoed)
        .expect("read remote dynamic echo payload");

    assert_eq!(echoed, payload);
    assert_eq!(
        ssh_server
            .forwarded_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    assert_eq!(
        ssh_server
            .direct_tcpip_requests
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), &summary.id)
        .expect("stop native managed remote dynamic forward"));
    let stopped_snapshot = state
        .ssh_runtime()
        .snapshot()
        .expect("stopped native managed snapshot");
    assert_eq!(stopped_snapshot.active_channels, 0);
    echo.join();
}

#[test]
fn list_restores_persisted_forward_as_exited_after_restart() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    let host = state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            group_id: None,
            name: "dev".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: 22,
            username: "tester".to_owned(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            credential_secret: None,
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
        })
        .expect("create remote host");
    state
        .storage()
        .upsert_port_forward_summary(&PortForwardSummary {
            id: "forward-restart-1".to_owned(),
            host_id: host.id,
            host_name: host.name,
            name: "网络助手".to_owned(),
            kind: PortForwardKind::Remote,
            purpose: PortForwardPurpose::HostNetworkAssist,
            origin: PortForwardOrigin::NetworkAssist,
            bind_host: "127.0.0.1".to_owned(),
            local_bind_host: Some("127.0.0.1".to_owned()),
            remote_bind_host: Some("127.0.0.1".to_owned()),
            source_port: 18080,
            target_host: Some("127.0.0.1".to_owned()),
            target_port: Some(18081),
            local_endpoint: Some(PortForwardEndpoint {
                host: "127.0.0.1".to_owned(),
                label: Some("本机 HTTP CONNECT 代理".to_owned()),
                port: Some(18081),
            }),
            remote_endpoint: None,
            proxy_protocol: Some(PortForwardProxyProtocol::Http),
            remote_access_scope: None,
            proxy_url: Some("http://127.0.0.1:18080".to_owned()),
            proxy_apply_scope: PortForwardProxyApplyScope::FutureTerminals,
            shared_proxy_service_id: Some("proxy-service-1".to_owned()),
            local_proxy_entry_id: Some("proxy-entry-1".to_owned()),
            command_preview: "ssh -R 127.0.0.1:18080:127.0.0.1:18081 tester@127.0.0.1".to_owned(),
            last_error: None,
            runtime: None,
            pid: Some(4242),
            status: PortForwardStatus::Running,
            created_at: "1710000000".to_owned(),
        })
        .expect("persist port forward summary");
    let state_file = paths
        .root
        .join("data")
        .join("port-forwards")
        .join("sessions.json");
    let state_json = fs::read_to_string(&state_file).expect("read port forward state file");
    assert!(
        state_json.contains("forward-restart-1"),
        "port forward state should be file-backed"
    );
    drop(state);

    let state = AppState::initialize_with_paths(paths).expect("reinitialize app state");
    let summaries = state
        .port_forwards()
        .list(state.storage())
        .expect("list restored forwards");

    assert_eq!(summaries.len(), 1);
    let restored = &summaries[0];
    assert_eq!(restored.id, "forward-restart-1");
    assert_eq!(restored.status, PortForwardStatus::Exited);
    assert_eq!(restored.pid, None);
    assert_eq!(restored.shared_proxy_service_id, None);
    assert_eq!(restored.local_proxy_entry_id, None);
    assert_eq!(
        restored.last_error.as_deref(),
        Some("应用重启后隧道不会自动重连。")
    );
    let runtime = restored
        .runtime
        .as_ref()
        .expect("restored runtime diagnostics");
    assert_eq!(runtime.mode, PortForwardRuntimeMode::Restored);
    assert_eq!(runtime.backend, "restored");
    assert_eq!(runtime.tunnel_kind, "hostNetworkAssistHttp");
    assert_eq!(runtime.cleanup_status, "restoredAfterAppRestart");
    assert_eq!(
        runtime.recent_failure.as_deref(),
        Some("应用重启后隧道不会自动重连。")
    );

    assert!(state
        .port_forwards()
        .stop(state.storage(), "forward-restart-1")
        .expect("stop restored forward"));
    let summaries = state
        .port_forwards()
        .list(state.storage())
        .expect("list after stop");
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].status, PortForwardStatus::Exited);

    assert!(state
        .port_forwards()
        .delete(state.storage(), "forward-restart-1")
        .expect("delete restored forward"));
    assert!(state
        .port_forwards()
        .list(state.storage())
        .expect("list after delete")
        .is_empty());
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

fn create_saved_password_host(state: &AppState) -> String {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("correct horse battery staple".to_owned()),
            group_id: None,
            host: "dev.internal".to_owned(),
            name: "dev".to_owned(),
            port: 2222,
            production: false,
            ssh_options: Default::default(),
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
        })
        .expect("create saved password host")
        .id
}

fn queue_putty_external_password_launch(state: &AppState, port: u16) -> String {
    let outcome = state
        .external_launch_intake()
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "deploy@127.0.0.1".to_owned(),
                "-P".to_owned(),
                port.to_string(),
                "-pw".to_owned(),
                "secret".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue external launch");
    match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    }
}

fn unused_local_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .expect("bind unused local port")
        .local_addr()
        .expect("unused local addr")
        .port()
}

fn socks5_connect(stream: &mut TcpStream, target: SocketAddr) {
    stream
        .write_all(&[0x05, 0x01, 0x00])
        .expect("write socks greeting");
    let mut method_response = [0_u8; 2];
    stream
        .read_exact(&mut method_response)
        .expect("read socks method response");
    assert_eq!(method_response, [0x05, 0x00]);

    let mut request = vec![0x05, 0x01, 0x00];
    match target.ip() {
        std::net::IpAddr::V4(ip) => {
            request.push(0x01);
            request.extend(ip.octets());
        }
        std::net::IpAddr::V6(ip) => {
            request.push(0x04);
            request.extend(ip.octets());
        }
    }
    request.extend(target.port().to_be_bytes());
    stream.write_all(&request).expect("write socks connect");

    let mut connect_response = [0_u8; 10];
    stream
        .read_exact(&mut connect_response)
        .expect("read socks connect response");
    assert_eq!(&connect_response[..2], &[0x05, 0x00]);
}

fn trigger_local_forward_attempt(source_port: u16) {
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect local forward listener");
    client
        .set_read_timeout(Some(Duration::from_millis(500)))
        .expect("set local forward read timeout");
    let _ = client.write_all(b"x");
    let mut buffer = [0_u8; 1];
    let _ = client.read(&mut buffer);
}

fn http_get_via_forward(source_port: u16, path: &str) -> String {
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect local HTTP forward");
    client
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("set HTTP forward read timeout");
    write!(
        client,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{source_port}\r\nUser-Agent: kerminal-test\r\nConnection: close\r\n\r\n"
    )
    .expect("write HTTP request");
    let mut response = String::new();
    client
        .read_to_string(&mut response)
        .expect("read HTTP response");
    response
}

fn wait_for_atomic_count(counter: &std::sync::atomic::AtomicUsize, expected: usize) {
    for _ in 0..100 {
        if counter.load(std::sync::atomic::Ordering::SeqCst) >= expected {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!(
        "expected atomic count >= {expected}, got {}",
        counter.load(std::sync::atomic::Ordering::SeqCst)
    );
}

struct HttpAssetServer {
    addr: SocketAddr,
    worker: Option<thread::JoinHandle<()>>,
}

impl HttpAssetServer {
    fn start(expected_requests: usize) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind HTTP asset server");
        let addr = listener.local_addr().expect("read HTTP asset server addr");
        let worker = thread::spawn(move || {
            let mut workers = Vec::new();
            for _ in 0..expected_requests {
                let Ok((mut stream, _peer)) = listener.accept() else {
                    break;
                };
                workers.push(thread::spawn(move || {
                    let mut buffer = [0_u8; 4096];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]);
                    let path = request
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .unwrap_or("/");
                    let body = format!("asset:{path}:{}", "0123456789abcdef".repeat(192 * 1024));
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                }));
            }
            for worker in workers {
                let _ = worker.join();
            }
        });
        Self {
            addr,
            worker: Some(worker),
        }
    }

    fn join(mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

struct EchoServer {
    addr: SocketAddr,
    worker: Option<thread::JoinHandle<()>>,
}

impl EchoServer {
    fn start() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind echo server");
        let addr = listener.local_addr().expect("read echo server addr");
        let worker = thread::spawn(move || {
            if let Ok((mut stream, _peer)) = listener.accept() {
                let mut buffer = [0_u8; 4096];
                if let Ok(read) = stream.read(&mut buffer) {
                    let _ = stream.write_all(&buffer[..read]);
                }
            }
        });
        Self {
            addr,
            worker: Some(worker),
        }
    }

    fn join(mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
