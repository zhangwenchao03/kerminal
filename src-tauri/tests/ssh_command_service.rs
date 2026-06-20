//! SSH 非交互命令服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType},
        ssh_command::SshCommandRequest,
    },
    paths::KerminalPaths,
    services::ssh_command_service::build_ssh_command_plan_with_executable,
    state::AppState,
};
use tempfile::{tempdir, TempDir};

#[test]
fn execute_rejects_unknown_remote_host_before_spawning_ssh() {
    let (_home, state) = test_state();

    let error = state
        .ssh_commands()
        .execute(
            state.storage(),
            SshCommandRequest {
                host_id: "missing-host".to_owned(),
                command: "uname -a".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(4096),
            },
        )
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
}

#[test]
fn build_plan_uses_parameterized_openssh_args_without_credentials() {
    let plan = build_ssh_command_plan_with_executable(
        &remote_host(RemoteHostAuthType::Key),
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "whoami".to_owned(),
            timeout_seconds: Some(10),
            max_output_bytes: Some(2048),
        },
    )
    .expect("build plan");

    assert_eq!(plan.executable, "ssh");
    assert!(plan.args.windows(2).any(|pair| pair == ["-p", "2222"]));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-o", "BatchMode=yes"]));
    assert!(plan.args.windows(2).any(|pair| pair == ["sh", "-s"]));
    assert!(plan
        .args
        .contains(&"PreferredAuthentications=publickey".to_owned()));
    assert_eq!(plan.script, "whoami\n");
    assert_eq!(plan.timeout_seconds, 10);
    assert_eq!(plan.max_output_bytes, 2048);
    assert!(!plan.args.iter().any(|arg| arg.contains("credential:ssh")));
}

#[test]
fn build_plan_rejects_empty_command() {
    let error = build_ssh_command_plan_with_executable(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "  ".to_owned(),
            timeout_seconds: None,
            max_output_bytes: None,
        },
    )
    .expect_err("reject empty command");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

fn remote_host(auth_type: RemoteHostAuthType) -> RemoteHost {
    RemoteHost {
        id: "host-1".to_owned(),
        group_id: Some("group-1".to_owned()),
        name: "dev".to_owned(),
        host: "dev.internal".to_owned(),
        port: 2222,
        username: "deploy".to_owned(),
        auth_type,
        credential_ref: Some("credential:ssh/dev".to_owned()),
        tags: vec!["dev".to_owned()],
        production: false,
        ssh_options: Default::default(),
        sort_order: 10,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
