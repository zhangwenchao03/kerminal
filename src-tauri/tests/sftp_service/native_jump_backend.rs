//! Native SFTP jump host integration tests.
//!
//! @author kongweiguang

use super::support::{
    create_password_remote_host_with_credentials, create_password_remote_host_with_options,
    loopback::{start_loopback_sftp_jump_server, start_loopback_sftp_server},
    test_state,
};
use kerminal_lib::{
    models::{
        remote_host::{RemoteHostAuthType, SshJumpHostOptions, SshOptions},
        sftp::{
            SftpDeleteRequest, SftpEntryKind, SftpListDirectoryRequest, SftpPreviewRequest,
            SftpTrustHostKeyRequest,
        },
    },
    state::AppState,
};
use std::sync::atomic::Ordering;
use tokio::fs;

#[tokio::test]
async fn native_sftp_service_uses_password_jump_for_list_preview_and_shell_delete() {
    let server_root = tempfile::tempdir().expect("server root");
    fs::write(server_root.path().join("hello.txt"), b"hello through jump")
        .await
        .expect("seed remote file");
    fs::create_dir_all(server_root.path().join("managed/nested"))
        .await
        .expect("seed remote directory");
    fs::write(
        server_root.path().join("managed/nested/app.log"),
        b"delete through jump",
    )
    .await
    .expect("seed nested remote file");

    let target_server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let jump_server = start_loopback_sftp_jump_server(target_server.addr).await;
    let (_home, state) = test_state();
    let jump_host_id = create_password_remote_host_with_credentials(
        &state,
        "jump loopback",
        jump_server.addr.port(),
        "jump",
        "jump-secret",
        SshOptions::default(),
    );
    trust_loopback_host(&state, &jump_host_id).await;

    let target_host_id = create_password_remote_host_with_options(
        &state,
        "target loopback",
        target_server.addr.port(),
        SshOptions {
            jump_hosts: vec![SshJumpHostOptions {
                name: "jump loopback".to_owned(),
                host: "127.0.0.1".to_owned(),
                port: jump_server.addr.port(),
                username: "jump".to_owned(),
                auth_type: RemoteHostAuthType::Password,
                credential_ref: None,
                secret_ref: None,
                key_passphrase_ref: None,
                key_passphrase_secret: None,
                credential_secret: Some("jump-secret".to_owned()),
                credential_status: Default::default(),
            }],
            ..SshOptions::default()
        },
    );
    trust_loopback_host(&state, &target_host_id).await;
    let direct_tcpip_after_trust = jump_server.direct_tcpip_requests.load(Ordering::SeqCst);

    let listing = state
        .sftp()
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: target_host_id.clone(),
                path: "/".to_owned(),
            },
        )
        .await
        .expect("list directory through jump");
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "hello.txt" && entry.kind == SftpEntryKind::File));
    let direct_tcpip_after_list = jump_server.direct_tcpip_requests.load(Ordering::SeqCst);
    assert!(
        direct_tcpip_after_list > direct_tcpip_after_trust,
        "first SFTP operation should open the target SSH transport through the jump host"
    );

    let preview = state
        .sftp()
        .preview_file(
            state.paths(),
            SftpPreviewRequest {
                host_id: target_host_id.clone(),
                path: "/hello.txt".to_owned(),
                max_bytes: Some(256),
            },
        )
        .await
        .expect("preview file through jump");
    assert_eq!(preview.content, "hello through jump");
    assert!(!preview.truncated);
    assert_eq!(
        jump_server.direct_tcpip_requests.load(Ordering::SeqCst),
        direct_tcpip_after_list,
        "preview should reuse the managed SFTP jump connection instead of opening a second transport"
    );

    state
        .sftp()
        .delete(
            state.paths(),
            SftpDeleteRequest {
                host_id: target_host_id,
                path: "/managed".to_owned(),
                directory: true,
            },
        )
        .await
        .expect("delete directory through jump shell");
    assert!(!server_root.path().join("managed").exists());
    assert_eq!(
        jump_server.direct_tcpip_requests.load(Ordering::SeqCst),
        direct_tcpip_after_list,
        "directory delete should reuse the managed jump target transport instead of opening a second direct-tcpip"
    );
}

async fn trust_loopback_host(state: &AppState, host_id: &str) {
    state
        .sftp()
        .trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: host_id.to_owned(),
            },
        )
        .await
        .expect("trust loopback host key");
}
