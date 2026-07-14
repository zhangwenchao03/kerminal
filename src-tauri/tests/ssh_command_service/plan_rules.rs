//! SSH 命令计划与认证材料集成测试。

use super::support::*;
use super::*;

#[tokio::test]
async fn execute_native_rejects_unknown_remote_host_before_opening_managed_exec() {
    let (_home, state) = test_state();

    let error = state
        .ssh_commands()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: "missing-host".to_owned(),
                command: "uname -a".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(4096),
            },
        )
        .await
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
fn build_plan_uses_identity_file_for_key_path_hosts() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("id_ed25519".to_owned());

    let plan = build_ssh_command_plan_with_executable(
        &host,
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "command -v git".to_owned(),
            timeout_seconds: None,
            max_output_bytes: None,
        },
    )
    .expect("build ssh command plan with identity file");

    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-i", "id_ed25519"]));
    assert!(!plan.args.iter().any(|arg| arg.contains("credential:ssh")));
}

#[test]
fn build_plan_expands_home_relative_identity_file() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("~/.ssh/id_ed25519".to_owned());
    let expected_identity = dirs::home_dir()
        .expect("current user home")
        .join(".ssh")
        .join("id_ed25519")
        .to_string_lossy()
        .into_owned();

    let plan = build_ssh_command_plan_with_executable(
        &host,
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "whoami".to_owned(),
            timeout_seconds: Some(10),
            max_output_bytes: Some(2048),
        },
    )
    .expect("build plan");

    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair[0] == "-i" && pair[1] == expected_identity));
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

#[test]
fn build_plan_rejects_control_characters_in_identity_file_path() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("/tmp/id_ed25519\nProxyCommand=bad".to_owned());

    assert!(matches!(
        build_ssh_command_plan_with_executable(
            &host,
            "ssh".to_owned(),
            SshCommandRequest {
                host_id: "host-1".to_owned(),
                command: "whoami".to_owned(),
                timeout_seconds: None,
                max_output_bytes: None,
            },
        ),
        Err(AppError::InvalidInput(_))
    ));
}

#[test]
fn native_auth_material_uses_plaintext_password_from_host() {
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.credential_secret = Some("s3cret".to_owned());

    assert_eq!(
        rules::resolve_native_auth_material_summary(&host).expect("resolve password auth"),
        NativeAuthMaterialSummary::Password("s3cret".to_owned())
    );
}

#[test]
fn native_auth_material_uses_plaintext_inline_private_key_from_host() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = None;
    host.credential_secret = Some(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----".to_owned(),
    );

    match rules::resolve_native_auth_material_summary(&host).expect("resolve private key auth") {
        NativeAuthMaterialSummary::PrivateKeyPem {
            content,
            passphrase,
        } => {
            assert!(content.contains("OPENSSH PRIVATE KEY"));
            assert_eq!(passphrase, None);
        }
        other => panic!("expected inline private key auth material, got {other:?}"),
    }
}

#[test]
fn native_auth_material_uses_key_path_from_host() {
    let mut host = remote_host(RemoteHostAuthType::Key);
    host.credential_ref = Some("id_ed25519".to_owned());

    assert_eq!(
        rules::resolve_native_auth_material_summary(&host).expect("resolve key path auth"),
        NativeAuthMaterialSummary::PrivateKeyPath {
            path: Path::new("id_ed25519").to_path_buf(),
            passphrase: None,
        }
    );
}

#[test]
fn native_auth_material_preserves_key_passphrase_for_path_and_inline_keys() {
    let mut path_host = remote_host(RemoteHostAuthType::Key);
    path_host.credential_ref = Some("id_ed25519".to_owned());
    path_host.key_passphrase_secret = Some("path-passphrase".to_owned());

    assert_eq!(
        rules::resolve_native_auth_material_summary(&path_host).expect("resolve key path auth"),
        NativeAuthMaterialSummary::PrivateKeyPath {
            path: Path::new("id_ed25519").to_path_buf(),
            passphrase: Some("path-passphrase".to_owned()),
        }
    );

    let mut pem_host = remote_host(RemoteHostAuthType::Key);
    pem_host.credential_ref = None;
    pem_host.credential_secret = Some(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----".to_owned(),
    );
    pem_host.key_passphrase_secret = Some("pem-passphrase".to_owned());

    match rules::resolve_native_auth_material_summary(&pem_host).expect("resolve private key auth")
    {
        NativeAuthMaterialSummary::PrivateKeyPem {
            content,
            passphrase,
        } => {
            assert!(content.contains("OPENSSH PRIVATE KEY"));
            assert_eq!(passphrase.as_deref(), Some("pem-passphrase"));
        }
        other => panic!("expected inline private key auth material, got {other:?}"),
    }
}

#[test]
fn native_auth_material_rejects_missing_password_before_connect() {
    let mut host = remote_host(RemoteHostAuthType::Password);
    host.credential_secret = None;

    assert!(matches!(
        rules::resolve_native_auth_material_summary(&host),
        Err(AppError::InvalidInput(_))
    ));
}
