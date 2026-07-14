//! MCP HTTP server 并发生命周期回归测试。
//!
//! @author kongweiguang

use std::{collections::BTreeSet, sync::Arc, time::Duration};

use kerminal_lib::{
    models::mcp_server::McpHttpServerStartRequest, paths::KerminalPaths, state::AppState,
};
use tauri::Manager;
use tokio::{net::TcpListener, sync::Barrier};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_start_is_single_flight_and_stop_releases_the_port() {
    let home = tempfile::tempdir().expect("temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let service = app.state::<AppState>().mcp_http_server().clone();
    let barrier = Arc::new(Barrier::new(17));
    let mut starts = Vec::new();

    for _ in 0..16 {
        let service = service.clone();
        let app_handle = app.handle().clone();
        let barrier = barrier.clone();
        starts.push(tokio::spawn(async move {
            barrier.wait().await;
            service
                .start(
                    app_handle,
                    Some(McpHttpServerStartRequest {
                        host: Some("127.0.0.1".to_owned()),
                        port: Some(0),
                    }),
                )
                .await
                .expect("concurrent MCP start")
        }));
    }
    barrier.wait().await;

    let mut endpoints = BTreeSet::new();
    let mut ports = BTreeSet::new();
    for start in starts {
        let status = start.await.expect("join MCP start");
        endpoints.insert(status.endpoint.expect("running endpoint"));
        ports.insert(status.port.expect("running port"));
    }
    assert_eq!(endpoints.len(), 1, "all starts must share one server");
    assert_eq!(ports.len(), 1, "all starts must share one listener");
    let port = *ports.first().expect("bound port");

    service
        .stop_and_wait()
        .await
        .expect("stop and join MCP server");
    assert!(!service.status().expect("status after stop").running);
    let rebound = tokio::time::timeout(
        Duration::from_secs(3),
        TcpListener::bind(("127.0.0.1", port)),
    )
    .await
    .expect("port release timeout")
    .expect("rebind released MCP port");
    drop(rebound);

    let restarted = service
        .start(
            app.handle().clone(),
            Some(McpHttpServerStartRequest {
                host: None,
                port: Some(port),
            }),
        )
        .await
        .expect("restart MCP server on released port");
    assert_eq!(restarted.port, Some(port));
    service.stop_and_wait().await.expect("final MCP stop");
}

#[tokio::test]
async fn repeated_stop_is_idempotent() {
    let service =
        kerminal_lib::services::mcp_streamable_http_server::McpStreamableHttpServerService::new();

    service.stop_and_wait().await.expect("first stop");
    service.stop_and_wait().await.expect("second stop");
    assert!(!service.status().expect("stopped status").running);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_start_stop_cycles_never_leave_a_listener_or_stale_status() {
    let home = tempfile::tempdir().expect("temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let service = app.state::<AppState>().mcp_http_server().clone();

    for _ in 0..12 {
        let start_service = service.clone();
        let app_handle = app.handle().clone();
        let start = tokio::spawn(async move { start_service.start(app_handle, None).await });
        let stop_service = service.clone();
        let stop = tokio::spawn(async move { stop_service.stop_and_wait().await });

        let _ = start.await.expect("join racing start");
        stop.await
            .expect("join racing stop")
            .expect("racing stop result");
        service.stop_and_wait().await.expect("settle stopped state");
        assert!(!service.status().expect("cycle status").running);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn aborted_start_future_never_leaves_the_service_stuck_in_starting() {
    let home = tempfile::tempdir().expect("temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let service = app.state::<AppState>().mcp_http_server().clone();

    for _ in 0..32 {
        let start_service = service.clone();
        let app_handle = app.handle().clone();
        let start = tokio::spawn(async move { start_service.start(app_handle, None).await });
        tokio::task::yield_now().await;
        start.abort();
        let _ = start.await;
        tokio::time::timeout(Duration::from_secs(2), service.stop_and_wait())
            .await
            .expect("aborted start must not strand lifecycle waiters")
            .expect("settle aborted start");
    }

    let restarted = service
        .start(app.handle().clone(), None)
        .await
        .expect("start after aborted futures");
    assert!(restarted.running);
    service.stop_and_wait().await.expect("final stop");
}
