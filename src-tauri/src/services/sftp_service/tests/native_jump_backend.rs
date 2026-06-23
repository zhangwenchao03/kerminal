//! Native SFTP jump host tests.
//!
//! @author kongweiguang

use super::*;
use crate::models::remote_host::SshJumpHostOptions;
use std::sync::atomic::Ordering;

#[tokio::test]
async fn native_sftp_backend_uses_password_jump_for_list_preview_and_shell_delete() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
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
    let known_hosts_path = client_root.path().join("known_hosts");
    let settings = SftpRuntimeSettings {
        pipeline_depth: 4,
        packet_bytes: 32 * 1024,
        timeout_seconds: 10,
        ..SftpRuntimeSettings::default()
    };
    let mut endpoint = jump_target_endpoint(
        "target-loopback",
        "target loopback",
        target_server.addr.port(),
        known_hosts_path.clone(),
    );
    endpoint.host.ssh_options.jump_hosts = vec![SshJumpHostOptions {
        name: "jump loopback".to_owned(),
        host: "127.0.0.1".to_owned(),
        port: jump_server.addr.port(),
        username: "jump".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        credential_secret: Some("jump-secret".to_owned()),
    }];

    let jump_host = jump_trust_host(jump_server.addr.port());
    trust_native_host_key(&jump_host, &known_hosts_path, settings)
        .await
        .expect("trust jump host key");
    trust_native_host_key(&endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust target host key");

    let backend = RusshSftpBackend;
    let listing = backend
        .list_directory(endpoint.clone(), "/".to_owned(), settings)
        .await
        .expect("list directory through jump");
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "hello.txt" && entry.kind == SftpEntryKind::File));

    let preview = backend
        .preview_file(endpoint.clone(), "/hello.txt".to_owned(), 256, settings)
        .await
        .expect("preview file through jump");
    assert_eq!(preview.content, "hello through jump");
    assert!(!preview.truncated);

    backend
        .delete(endpoint, "/managed".to_owned(), true, settings)
        .await
        .expect("delete directory through jump shell");
    assert!(!server_root.path().join("managed").exists());
    assert!(
        jump_server.direct_tcpip_requests.load(Ordering::SeqCst) >= 3,
        "list, preview, and shell delete should each open direct-tcpip through the jump host"
    );
}

fn jump_target_endpoint(
    id: &str,
    name: &str,
    port: u16,
    known_hosts_path: PathBuf,
) -> SftpEndpoint {
    SftpEndpoint {
        host: RemoteHost {
            id: id.to_owned(),
            group_id: None,
            name: name.to_owned(),
            host: "127.0.0.1".to_owned(),
            port,
            username: "deploy".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("secret".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
            sort_order: 0,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        },
        auth: SftpAuthMaterial::Password("secret".to_owned()),
        known_hosts_path,
    }
}

fn jump_trust_host(port: u16) -> RemoteHost {
    RemoteHost {
        id: "jump-loopback".to_owned(),
        group_id: None,
        name: "jump loopback".to_owned(),
        host: "127.0.0.1".to_owned(),
        port,
        username: "jump".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        credential_secret: Some("jump-secret".to_owned()),
        tags: Vec::new(),
        production: false,
        ssh_options: Default::default(),
        sort_order: 0,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}
