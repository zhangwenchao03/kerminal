use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use kerminal_lib::{
    models::{
        docker::DockerContainerListRequest,
        port_forward::{
            PortForwardCreateRequest, PortForwardKind, PortForwardOrigin,
            PortForwardProxyApplyScope, PortForwardStatus,
        },
        server_info::ServerInfoRequest,
        sftp::{
            SftpChmodRequest, SftpDeleteRequest, SftpEntryKind, SftpListDirectoryRequest,
            SftpPathRequest, SftpReadTextFileRequest, SftpRenameRequest,
            SftpTransferConflictPolicy, SftpTransferRequest, SftpWriteTextFileRequest,
        },
        ssh_command::SshCommandRequest,
        target::{ContainerRuntime, RemoteTargetRef},
        terminal::{SshTerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
    },
    services::ssh_runtime::{SshChannelKind, MANAGED_SSH_CAPABILITY_RUNTIME_FLAG},
    state::AppState,
};

const REAL_HOST_ID: &str = "ddd68b0a-1845-4ac6-97b2-142e49d19c68";
const TERMINAL_MARKER: &str = "kerminal-terminal-60-ok";

#[tokio::test]
#[ignore = "requires local Kerminal config/vault and reachable 172.16.41.60"]
async fn real_host_60_read_only_core_services_work() {
    let state = AppState::initialize().expect("initialize app state from local Kerminal home");
    let env = remote_environment(&state).await;
    assert_eq!(env.get("SSH_OK").map(String::as_str), Some("yes"));
    let remote_home = env
        .get("HOME")
        .filter(|value| value.starts_with('/'))
        .expect("remote HOME should be an absolute path");

    let server_info = state
        .server_info()
        .snapshot_native(
            state.remote_hosts(),
            state.paths(),
            state.ssh_commands(),
            ServerInfoRequest {
                host_id: REAL_HOST_ID.to_owned(),
                target: RemoteTargetRef::Ssh {
                    host_id: REAL_HOST_ID.to_owned(),
                },
            },
        )
        .await
        .expect("collect real-host server info snapshot");
    assert_eq!(server_info.host_id, REAL_HOST_ID);
    assert!(server_info.hostname.is_some() || server_info.os.is_some());
    assert!(server_info.memory_total_bytes.unwrap_or_default() > 0);

    let home_listing = state
        .sftp()
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_home.to_owned(),
            },
        )
        .await
        .expect("list remote home directory");
    assert_eq!(home_listing.path, *remote_home);
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
        .expect("list remote /tmp directory");
    assert_eq!(tmp_listing.path, "/tmp");

    let snapshot = state.ssh_runtime().snapshot().expect("runtime snapshot");
    assert_browser_sftp_reuses_capability_lane(&snapshot);

    exercise_port_forward(&state);
    exercise_container_listing_if_runtime_exists(&state, &env).await;
}

#[test]
#[ignore = "requires local Kerminal config/vault and reachable 172.16.41.60"]
fn real_host_60_ssh_terminal_core_works() {
    let state = AppState::initialize().expect("initialize app state from local Kerminal home");
    exercise_ssh_terminal_shell(&state);
}

#[test]
#[ignore = "requires local Kerminal config/vault and reachable 172.16.41.60"]
fn real_host_60_sftp_then_ssh_terminal_same_state_works() {
    let state = AppState::initialize().expect("initialize app state from local Kerminal home");
    let runtime = tokio::runtime::Runtime::new().expect("create smoke runtime");
    runtime.block_on(async {
        let env = remote_environment(&state).await;
        let remote_home = env
            .get("HOME")
            .filter(|value| value.starts_with('/'))
            .expect("remote HOME should be an absolute path");
        state
            .sftp()
            .list_directory(
                state.paths(),
                SftpListDirectoryRequest {
                    host_id: REAL_HOST_ID.to_owned(),
                    path: remote_home.to_owned(),
                },
            )
            .await
            .expect("list remote home directory before SSH terminal");
        state
            .sftp()
            .list_directory(
                state.paths(),
                SftpListDirectoryRequest {
                    host_id: REAL_HOST_ID.to_owned(),
                    path: "/tmp".to_owned(),
                },
            )
            .await
            .expect("list remote /tmp directory before SSH terminal");
    });
    let snapshot = state.ssh_runtime().snapshot().expect("runtime snapshot");
    assert_browser_sftp_reuses_capability_lane(&snapshot);
    exercise_ssh_terminal_shell(&state);
}

#[tokio::test]
#[ignore = "requires local Kerminal config/vault and reachable 172.16.41.60"]
async fn real_host_60_port_forward_core_works() {
    let state = AppState::initialize().expect("initialize app state from local Kerminal home");
    exercise_port_forward(&state);
}

#[tokio::test]
#[ignore = "requires local Kerminal config/vault and reachable 172.16.41.60"]
async fn real_host_60_storage_diagnostics_and_cleanup() {
    let state = AppState::initialize().expect("initialize app state from local Kerminal home");
    let output = ssh_exec(
        &state,
        r#"
set -u
rm -rf "$HOME"/.kerminal-core-smoke-* "$HOME"/.kerminal-core-direct-*.txt
rm -rf /tmp/kerminal-core-smoke-* /tmp/kerminal-real-host-smoke-*
printf '=== df-home-tmp ===\n'
df -h "$HOME" /tmp 2>/dev/null || true
printf '=== df-inodes-home-tmp ===\n'
df -i "$HOME" /tmp 2>/dev/null || true
printf '=== kerminal-temp-leftovers ===\n'
find "$HOME" /tmp -maxdepth 1 \( -name '.kerminal-core-smoke-*' -o -name '.kerminal-core-direct-*.txt' -o -name 'kerminal-core-smoke-*' -o -name 'kerminal-real-host-smoke-*' \) -print 2>/dev/null || true
"#,
    )
    .await
    .expect("run storage diagnostics over Kerminal SSH command");
    assert!(
        output.success,
        "storage diagnostics failed: stdout={} stderr={}",
        output.stdout, output.stderr
    );
    println!("{}", output.stdout);
}

#[tokio::test]
#[ignore = "requires local Kerminal config/vault and reachable 172.16.41.60"]
async fn real_host_60_core_services_work() {
    let state = AppState::initialize().expect("initialize app state from local Kerminal home");
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after epoch")
        .as_millis();

    let env = remote_environment(&state).await;
    assert_eq!(env.get("SSH_OK").map(String::as_str), Some("yes"));
    let remote_home = env
        .get("HOME")
        .filter(|value| value.starts_with('/'))
        .expect("remote HOME should be an absolute path");
    let remote_scratch = env
        .get("SCRATCH_BASE")
        .filter(|value| value.starts_with('/'))
        .expect("remote scratch base should be an absolute path");
    assert_eq!(env.get("SCRATCH_WRITABLE").map(String::as_str), Some("yes"));
    let remote_root = format!("{remote_scratch}/kerminal-core-smoke-{unique}");
    let remote_text = format!("{remote_root}/hello.txt");
    let remote_renamed = format!("{remote_root}/renamed.txt");
    let remote_uploaded = format!("{remote_root}/uploaded.txt");
    let remote_download_dir = format!("{remote_root}/jdk-21.0.2");
    let remote_download_bin_dir = format!("{remote_download_dir}/bin");
    let remote_short_read_file = format!("{remote_download_bin_dir}/java");
    let remote_direct_text = format!("{remote_scratch}/kerminal-core-direct-{unique}.txt");
    let local_upload = std::env::temp_dir().join(format!("kerminal-core-upload-{unique}.txt"));
    let local_download = std::env::temp_dir().join(format!("kerminal-core-download-{unique}.txt"));
    let local_short_read_source =
        std::env::temp_dir().join(format!("kerminal-core-short-read-source-{unique}.bin"));
    let local_directory_download =
        std::env::temp_dir().join(format!("kerminal-core-directory-download-{unique}"));

    let _ = ssh_exec(
        &state,
        &format!("rm -rf {}", shell_single_quote(&remote_root)),
    )
    .await;
    let shell_mkdir = ssh_exec(
        &state,
        &format!(
            "mkdir {} && rmdir {}",
            shell_single_quote(&remote_root),
            shell_single_quote(&remote_root)
        ),
    )
    .await
    .expect("probe shell mkdir/rmdir on remote smoke directory");
    assert!(
        shell_mkdir.success,
        "shell mkdir/rmdir probe failed: stdout={} stderr={}",
        shell_mkdir.stdout, shell_mkdir.stderr
    );

    state
        .sftp()
        .write_text_file(
            state.paths(),
            SftpWriteTextFileRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_direct_text.clone(),
                content: "direct write before mkdir\n".to_owned(),
                encoding: "utf-8".to_owned(),
                expected_revision: None,
                create: true,
                overwrite_on_conflict: false,
            },
        )
        .await
        .expect("direct SFTP write into remote home before mkdir");
    state
        .sftp()
        .delete(
            state.paths(),
            SftpDeleteRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_direct_text,
                directory: false,
            },
        )
        .await
        .expect("delete direct SFTP write probe file");

    let home_listing = state
        .sftp()
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_home.to_owned(),
            },
        )
        .await
        .expect("list remote home directory");
    assert_eq!(home_listing.path, *remote_home);

    state
        .sftp()
        .create_directory(
            state.paths(),
            SftpPathRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_root.clone(),
            },
        )
        .await
        .expect("create remote smoke directory through Kerminal SFTP");

    state
        .sftp()
        .write_text_file(
            state.paths(),
            SftpWriteTextFileRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_text.clone(),
                content: "hello from kerminal core smoke\n".to_owned(),
                encoding: "utf-8".to_owned(),
                expected_revision: None,
                create: true,
                overwrite_on_conflict: false,
            },
        )
        .await
        .expect("write real-host SFTP text file");

    let read = state
        .sftp()
        .read_text_file(
            state.paths(),
            SftpReadTextFileRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_text.clone(),
                max_bytes: Some(1024),
            },
        )
        .await
        .expect("read real-host SFTP text file");
    assert_eq!(read.content, "hello from kerminal core smoke\n");
    assert!(!read.truncated);
    assert!(!read.binary);

    let stat = state
        .sftp()
        .stat_path(
            state.paths(),
            SftpPathRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_text.clone(),
            },
        )
        .await
        .expect("stat real-host SFTP text file");
    assert_eq!(stat.kind, SftpEntryKind::File);
    assert_eq!(stat.size, Some(read.bytes_read as u64));

    state
        .sftp()
        .chmod(
            state.paths(),
            SftpChmodRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_text.clone(),
                mode: "0600".to_owned(),
            },
        )
        .await
        .expect("chmod real-host SFTP text file");

    state
        .sftp()
        .rename(
            state.paths(),
            SftpRenameRequest {
                host_id: REAL_HOST_ID.to_owned(),
                from_path: remote_text,
                to_path: remote_renamed.clone(),
            },
        )
        .await
        .expect("rename real-host SFTP text file");

    let listing_after_rename = state
        .sftp()
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_root.clone(),
            },
        )
        .await
        .expect("list remote smoke directory after rename");
    assert!(listing_after_rename
        .entries
        .iter()
        .any(|entry| entry.name == "renamed.txt"));

    fs::write(&local_upload, "uploaded from local core smoke\n")
        .expect("write local upload source");
    state
        .sftp()
        .upload(
            state.paths(),
            SftpTransferRequest {
                host_id: REAL_HOST_ID.to_owned(),
                remote_path: remote_uploaded.clone(),
                local_path: local_upload.to_string_lossy().into_owned(),
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
            },
        )
        .await
        .expect("upload local file to real host through Kerminal SFTP");

    state
        .sftp()
        .download(
            state.paths(),
            SftpTransferRequest {
                host_id: REAL_HOST_ID.to_owned(),
                remote_path: remote_uploaded.clone(),
                local_path: local_download.to_string_lossy().into_owned(),
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
            },
        )
        .await
        .expect("download file from real host through Kerminal SFTP");
    assert_eq!(
        fs::read_to_string(&local_download).expect("read downloaded local file"),
        "uploaded from local core smoke\n"
    );

    let short_read_payload = (0..76_018)
        .map(|index| (index % 251) as u8)
        .collect::<Vec<_>>();
    fs::write(&local_short_read_source, &short_read_payload)
        .expect("write local short-read source file");
    state
        .sftp()
        .create_directory(
            state.paths(),
            SftpPathRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_download_dir.clone(),
            },
        )
        .await
        .expect("create real-host directory download root");
    state
        .sftp()
        .create_directory(
            state.paths(),
            SftpPathRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_download_bin_dir,
            },
        )
        .await
        .expect("create real-host directory download nested directory");
    state
        .sftp()
        .upload(
            state.paths(),
            SftpTransferRequest {
                host_id: REAL_HOST_ID.to_owned(),
                remote_path: remote_short_read_file,
                local_path: local_short_read_source.to_string_lossy().into_owned(),
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
            },
        )
        .await
        .expect("upload short-read-sized file to real host");
    state
        .sftp()
        .download_directory(
            state.paths(),
            SftpTransferRequest {
                host_id: REAL_HOST_ID.to_owned(),
                remote_path: remote_download_dir.clone(),
                local_path: local_directory_download.to_string_lossy().into_owned(),
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
            },
        )
        .await
        .expect("download real-host directory containing short-read-sized file");
    assert_eq!(
        fs::read(local_directory_download.join("bin/java"))
            .expect("read downloaded real-host short-read-sized file"),
        short_read_payload
    );

    state
        .sftp()
        .delete(
            state.paths(),
            SftpDeleteRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_renamed,
                directory: false,
            },
        )
        .await
        .expect("delete renamed real-host SFTP file");
    state
        .sftp()
        .delete(
            state.paths(),
            SftpDeleteRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_uploaded,
                directory: false,
            },
        )
        .await
        .expect("delete uploaded real-host SFTP file");
    state
        .sftp()
        .delete(
            state.paths(),
            SftpDeleteRequest {
                host_id: REAL_HOST_ID.to_owned(),
                path: remote_root.clone(),
                directory: true,
            },
        )
        .await
        .expect("delete real-host SFTP smoke directory");

    exercise_container_listing_if_runtime_exists(&state, &env).await;

    let _ = ssh_exec(
        &state,
        &format!("rm -rf {}", shell_single_quote(&remote_root)),
    )
    .await;
    let _ = fs::remove_file(local_upload);
    let _ = fs::remove_file(local_download);
    let _ = fs::remove_file(local_short_read_source);
    let _ = fs::remove_dir_all(local_directory_download);
}

#[path = "real_host_60_core_smoke/support.rs"]
mod support;
use support::*;
