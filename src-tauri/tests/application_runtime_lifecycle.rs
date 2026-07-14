//! ApplicationRuntime 关闭编排与资源释放回归测试。
//!
//! @author kongweiguang

use std::{fs, sync::Arc, time::Duration};

use kerminal_lib::{
    models::mcp_server::McpHttpServerStartRequest,
    paths::KerminalPaths,
    services::external_launch::{external_launch_bridge_endpoint, ExternalLaunchBridgeEventSink},
    state::AppState,
};
use tauri::Manager;
use tokio::net::TcpListener;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn shutdown_joins_long_running_services_and_releases_resources() {
    let home = tempfile::tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let state = app.state::<AppState>();
    let endpoint = external_launch_bridge_endpoint(&paths.root);
    let sink: ExternalLaunchBridgeEventSink = Arc::new(|_| {});

    state
        .application_runtime()
        .start(
            app.handle().clone(),
            endpoint.clone(),
            state.external_launch_intake().clone(),
            sink.clone(),
        )
        .expect("start application runtime");
    state
        .application_runtime()
        .start(
            app.handle().clone(),
            endpoint.clone(),
            state.external_launch_intake().clone(),
            sink,
        )
        .expect("repeat application runtime start");
    assert!(
        state
            .application_runtime()
            .snapshot()
            .expect("runtime snapshot")
            .bridge_running
    );
    assert!(state.config_change_observer().status().enabled);

    wait_for_file(&endpoint.descriptor_path).await;
    let mcp = state
        .mcp_http_server()
        .start(
            app.handle().clone(),
            Some(McpHttpServerStartRequest {
                host: None,
                port: Some(0),
            }),
        )
        .await
        .expect("start MCP server");
    let port = mcp.port.expect("MCP port");

    let runtime = state.application_runtime().clone();
    let shutdowns = (0..8)
        .map(|_| {
            let runtime = runtime.clone();
            tokio::spawn(async move { runtime.shutdown().await })
        })
        .collect::<Vec<_>>();
    for shutdown in shutdowns {
        shutdown
            .await
            .expect("join concurrent runtime shutdown")
            .expect("concurrent runtime shutdown");
    }

    assert!(
        !state
            .application_runtime()
            .snapshot()
            .expect("stopped snapshot")
            .bridge_running
    );
    assert!(!state.config_change_observer().status().enabled);
    assert!(
        !state
            .mcp_http_server()
            .status()
            .expect("MCP stopped status")
            .running
    );
    assert!(!std::path::Path::new(&endpoint.descriptor_path).exists());
    TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("MCP port released after runtime shutdown");
}

async fn wait_for_file(path: &str) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        if fs::metadata(path).is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("timed out waiting for bridge descriptor");
}
