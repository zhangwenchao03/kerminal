//! ApplicationRuntime 关闭编排与资源释放回归测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::mcp_server::McpHttpServerStartRequest, paths::KerminalPaths, state::AppState,
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
    state
        .application_runtime()
        .start(app.handle().clone())
        .expect("start application runtime");
    state
        .application_runtime()
        .start(app.handle().clone())
        .expect("repeat application runtime start");
    assert!(state.config_change_observer().status().enabled);

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
            .shutting_down
    );
    assert!(!state.config_change_observer().status().enabled);
    assert!(
        !state
            .mcp_http_server()
            .status()
            .expect("MCP stopped status")
            .running
    );
    TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("MCP port released after runtime shutdown");
}
