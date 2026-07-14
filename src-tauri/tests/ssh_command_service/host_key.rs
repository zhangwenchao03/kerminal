//! SSH 主机密钥与跳板机信任集成测试。

use super::support::*;
use super::*;

#[tokio::test]
async fn native_command_executes_through_loopback_jump_host() {
    let target = start_loopback_command_server().await;
    let jump = start_loopback_jump_server(target.addr).await;
    let (_home, state) = test_state();
    let known_hosts_path = state.paths().root.join("known_hosts");
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        jump.addr.port(),
        &jump.host_key,
        &known_hosts_path,
    )
    .expect("trust jump host key");
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        target.addr.port(),
        &target.host_key,
        &known_hosts_path,
    )
    .expect("trust target host key");

    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = target.addr.port();
    host.credential_secret = Some("secret".to_owned());
    host.ssh_options.jump_hosts = vec![SshJumpHostOptions {
        name: "loopback jump".to_owned(),
        host: "127.0.0.1".to_owned(),
        port: jump.addr.port(),
        username: "jump".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: Some("jump-secret".to_owned()),
        credential_status: Default::default(),
    }];
    let host = create_saved_password_remote_host(&state, host);

    let output = SshCommandService::new()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: host.id.clone(),
                command: "printf through-jump".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute native command through jump");

    assert!(output.success);
    assert_eq!(output.exit_code, Some(0));
    assert_eq!(output.stdout, "exec=sh -s\nscript=printf through-jump\n");
    assert_eq!(output.stderr, "loopback stderr\n");
    assert_eq!(jump.direct_tcpip_requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn native_command_rejects_untrusted_loopback_host_key() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = server.addr.port();
    host.credential_secret = Some("secret".to_owned());
    let host = create_saved_password_remote_host(&state, host);

    assert!(matches!(
        SshCommandService::new()
            .execute_native(
                state.paths(),
                SshCommandRequest {
                    host_id: host.id.clone(),
                    command: "printf ready".to_owned(),
                    timeout_seconds: Some(5),
                    max_output_bytes: Some(1024),
                },
            )
            .await,
        Err(AppError::SshCommand(_))
    ));
}

#[tokio::test]
async fn external_native_command_rejects_unknown_loopback_host_key() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    let known_hosts_path = state.paths().root.join("known_hosts");
    assert!(!known_hosts_path.exists());

    let intake = ExternalLaunchIntake::new();
    let auth_broker = SshAuthBroker::new();
    let materializer = ExternalSessionMaterializer::new(intake.clone(), auth_broker.clone());
    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "deploy@127.0.0.1".to_owned(),
                "-P".to_owned(),
                server.addr.port().to_string(),
                "-pw".to_owned(),
                "secret".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue external launch");
    let launch_id = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    };
    let _ = intake.take_pending().expect("take pending launch");
    let target = materializer
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external loopback target");
    intake
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");

    let ssh_commands = SshCommandService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new())),
        auth_broker,
        materializer,
    );
    let error = ssh_commands
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: target.host_id,
                command: "printf external-ready".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect_err("unknown external host key must require explicit confirmation");

    assert!(error.to_string().contains("Unknown server key"));
    assert!(
        !known_hosts_path.exists(),
        "external command must not silently learn an unknown host key"
    );
}

#[tokio::test]
async fn external_native_command_rejects_changed_loopback_host_key() {
    let server = start_loopback_command_server().await;
    let (_home, state) = test_state();
    let known_hosts_path = state.paths().root.join("known_hosts");
    let wrong_private_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
        .expect("generate wrong host key");
    keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        wrong_private_key.public_key(),
        &known_hosts_path,
    )
    .expect("write changed known host key");

    let intake = ExternalLaunchIntake::new();
    let auth_broker = SshAuthBroker::new();
    let materializer = ExternalSessionMaterializer::new(intake.clone(), auth_broker.clone());
    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "deploy@127.0.0.1".to_owned(),
                "-P".to_owned(),
                server.addr.port().to_string(),
                "-pw".to_owned(),
                "secret".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue external launch");
    let launch_id = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    };
    let _ = intake.take_pending().expect("take pending launch");
    let target = materializer
        .materialize(state.paths(), &launch_id, None)
        .expect("materialize external loopback target");
    intake
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");

    let ssh_commands = SshCommandService::with_ssh_runtime(
        ManagedSshSessionManager::with_backend(Arc::new(NativeSshRuntimeBackend::new())),
        auth_broker,
        materializer,
    );
    let error = ssh_commands
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: target.host_id,
                command: "printf should-not-run".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect_err("changed host key should block external target");
    let error = error.to_string();

    assert!(!error.contains("secret"));
    assert!(error.contains("key") || error.contains("host") || error.contains("验证"));
}

#[tokio::test]
async fn native_connection_test_trusts_unknown_loopback_host_key() {
    let server = start_loopback_command_server().await;
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let known_hosts_path = paths.root.join("known_hosts");
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.host = "127.0.0.1".to_owned();
    host.port = server.addr.port();
    host.credential_secret = Some("secret".to_owned());

    assert!(!known_hosts_path.exists());
    SshCommandService::new()
        .test_connection(&paths, &host)
        .await
        .expect("test connection trusts unknown loopback key");

    assert!(keys::known_hosts::check_known_hosts_path(
        "127.0.0.1",
        server.addr.port(),
        &server.host_key,
        &known_hosts_path,
    )
    .expect("check learned known host"));
}
