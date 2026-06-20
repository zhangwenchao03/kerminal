//! SSH 端口转发服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::port_forward::{PortForwardCreateRequest, PortForwardKind},
    paths::KerminalPaths,
    state::AppState,
};
use tempfile::{tempdir, TempDir};

#[test]
fn create_forward_rejects_unknown_remote_host_before_spawning_ssh() {
    let (_home, state) = test_state();

    let error = state
        .port_forwards()
        .create(
            state.storage(),
            PortForwardCreateRequest {
                bind_host: Some("127.0.0.1".to_owned()),
                host_id: "missing-host".to_owned(),
                kind: PortForwardKind::Local,
                name: Some("missing".to_owned()),
                source_port: 15432,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(5432),
            },
        )
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
