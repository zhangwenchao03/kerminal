use kerminal_lib::{
    models::sftp::SftpListDirectoryRequest,
    services::ssh_runtime::{SshChannelKind, MANAGED_SSH_CAPABILITY_RUNTIME_FLAG},
    state::AppState,
};

const REAL_HOST_ID: &str = "ddd68b0a-1845-4ac6-97b2-142e49d19c68";

#[tokio::test]
#[ignore = "requires local Kerminal config/vault and reachable 172.16.41.60"]
async fn real_host_sftp_browser_reuses_retained_channel() {
    let state = AppState::initialize().expect("initialize app state from local Kerminal home");

    let home_listing = state
        .sftp()
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: "/home/ubuntu".to_owned(),
            },
        )
        .await
        .expect("list /home/ubuntu on real host");
    assert_eq!(home_listing.path, "/home/ubuntu");

    let tmp_listing = state
        .sftp()
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: "/tmp".to_owned(),
            },
        )
        .await
        .expect("list /tmp on real host");
    assert_eq!(tmp_listing.path, "/tmp");

    let snapshot = state.ssh_runtime().snapshot().expect("runtime snapshot");
    let browser = snapshot
        .sessions
        .iter()
        .find(|session| {
            session
                .key
                .runtime_flags
                .iter()
                .any(|flag| flag == MANAGED_SSH_CAPABILITY_RUNTIME_FLAG)
        })
        .expect("browser/capability real-host SFTP session");
    assert_eq!(
        browser.channel_counts.get(&SshChannelKind::Sftp),
        Some(&1),
        "two real-host browser listings should reuse one SFTP channel on the browser lane"
    );
    assert_eq!(
        snapshot.active_channels, 1,
        "retained real-host browser SFTP channel should remain active during browser lifetime"
    );
}
