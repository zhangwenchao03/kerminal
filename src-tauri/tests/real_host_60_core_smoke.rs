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

async fn exercise_container_listing_if_runtime_exists(
    state: &AppState,
    env: &HashMap<String, String>,
) {
    if env.get("DOCKER_PRESENT").map(String::as_str) == Some("yes") {
        state
            .docker_hosts()
            .list_containers(
                state.paths(),
                state.ssh_commands(),
                DockerContainerListRequest {
                    host_id: REAL_HOST_ID.to_owned(),
                    runtime: ContainerRuntime::Docker,
                    include_stopped: true,
                },
            )
            .await
            .expect("list Docker containers on real host when docker is present");
    }
    if env.get("PODMAN_PRESENT").map(String::as_str) == Some("yes") {
        state
            .docker_hosts()
            .list_containers(
                state.paths(),
                state.ssh_commands(),
                DockerContainerListRequest {
                    host_id: REAL_HOST_ID.to_owned(),
                    runtime: ContainerRuntime::Podman,
                    include_stopped: true,
                },
            )
            .await
            .expect("list Podman containers on real host when podman is present");
    }
}

fn assert_browser_sftp_reuses_capability_lane(
    snapshot: &kerminal_lib::services::ssh_runtime::ManagedSshRuntimeSnapshot,
) {
    let interactive = snapshot
        .sessions
        .iter()
        .find(|session| session.key.runtime_flags.is_empty())
        .expect("interactive real-host session");
    assert_eq!(
        interactive.channel_counts.get(&SshChannelKind::Sftp),
        None,
        "read-only browser listings should not retain SFTP on the interactive shell lane"
    );
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
        .expect("browser/capability real-host session");
    assert_eq!(
        browser.channel_counts.get(&SshChannelKind::Sftp),
        Some(&1),
        "read-only browser listings should reuse one retained SFTP channel on the browser lane"
    );
}

fn exercise_port_forward(state: &AppState) {
    let forward_port = free_loopback_port();
    let forward = state
        .port_forwards()
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            PortForwardCreateRequest {
                host_id: REAL_HOST_ID.to_owned(),
                name: Some("real-host-60-core-smoke".to_owned()),
                kind: PortForwardKind::Local,
                origin: PortForwardOrigin::User,
                bind_host: Some("127.0.0.1".to_owned()),
                local_bind_host: Some("127.0.0.1".to_owned()),
                remote_bind_host: None,
                source_port: forward_port,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(22),
                local_endpoint: None,
                remote_endpoint: None,
                proxy_protocol: None,
                remote_access_scope: None,
                proxy_apply_scope: PortForwardProxyApplyScope::None,
            },
        )
        .expect("create local port forward to real-host SSH");
    assert_eq!(forward.status, PortForwardStatus::Running);
    assert_eq!(forward.source_port, forward_port);
    assert!(state
        .port_forwards()
        .list(state.storage())
        .expect("list port forwards")
        .iter()
        .any(|summary| summary.id == forward.id && summary.status == PortForwardStatus::Running));
    assert_ssh_banner_via_forward(forward_port);
    assert!(state
        .port_forwards()
        .stop(state.storage(), &forward.id)
        .expect("stop real-host port forward"));
}

fn exercise_ssh_terminal_shell(state: &AppState) {
    let baseline_active_channels = state
        .ssh_runtime()
        .snapshot()
        .expect("runtime snapshot before SSH terminal")
        .active_channels;
    let (sender, receiver) = mpsc::channel();
    let summary = state
        .ssh_terminals()
        .create_session(
            state.remote_hosts(),
            state.paths(),
            state.terminals(),
            SshTerminalCreateRequest {
                host_id: REAL_HOST_ID.to_owned(),
                cwd: None,
                remote_command: None,
                cols: 96,
                rows: 28,
            },
            move |event| sender.send(event).is_ok(),
        )
        .expect("create real-host SSH terminal session through Kerminal service");

    let result = (|| {
        state
            .terminals()
            .write(
                &summary.id,
                &format!(
                    "printf '{}\\n'\r",
                    shell_single_quote_content(TERMINAL_MARKER)
                ),
            )
            .map_err(|error| error.to_string())?;
        collect_terminal_until_output(
            state,
            &summary.id,
            &receiver,
            TERMINAL_MARKER,
            Duration::from_secs(15),
        )
    })();

    let close_result = state.terminals().close(&summary.id);
    let idle_result = wait_for_managed_active_channels_at_most(
        state,
        baseline_active_channels,
        Duration::from_secs(5),
    );

    let output = result.expect("real-host SSH terminal should echo smoke marker");
    assert!(
        output.contains(TERMINAL_MARKER),
        "terminal output should contain marker, got: {output:?}"
    );
    close_result.expect("close real-host SSH terminal session");
    idle_result.expect("managed SSH active channel count should return to baseline after close");
}

fn collect_terminal_until_output(
    state: &AppState,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut received = String::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let event = receiver
            .recv_timeout(remaining)
            .map_err(|_| format!("timed out waiting for terminal output {expected:?}"))?;
        match event.kind {
            TerminalOutputKind::Data => {
                received.push_str(&event.data);
                if event.data.contains("\u{1b}[6n") {
                    state
                        .terminals()
                        .write(session_id, "\u{1b}[1;1R")
                        .map_err(|error| error.to_string())?;
                }
            }
            TerminalOutputKind::Error => {
                return Err(format!(
                    "terminal error while waiting for {expected:?}: {}",
                    event.data
                ));
            }
            TerminalOutputKind::Closed => {
                return Err(format!(
                    "terminal closed before {expected:?}, got output: {received:?}"
                ));
            }
            TerminalOutputKind::AgentSignal => {}
        }
        if received.contains(expected) {
            return Ok(received);
        }
    }
    Err(format!(
        "expected SSH terminal output to contain {expected:?}, got: {received:?}"
    ))
}

fn wait_for_managed_active_channels_at_most(
    state: &AppState,
    baseline_active_channels: u64,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        let active_channels = state
            .ssh_runtime()
            .snapshot()
            .map_err(|error| error.to_string())?
            .active_channels;
        if active_channels <= baseline_active_channels {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "managed SSH runtime still has {active_channels} active channel(s), expected at most {baseline_active_channels}"
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

async fn remote_environment(state: &AppState) -> HashMap<String, String> {
    let output = ssh_exec(
        state,
        r#"
printf 'SSH_OK=yes\n'
printf 'USER=%s\n' "$(id -un)"
printf 'HOME=%s\n' "$HOME"
printf 'PWD=%s\n' "$PWD"
printf 'HOSTNAME=%s\n' "$(hostname)"
if [ -w /dev/shm ] && [ "$(df -Pk /dev/shm 2>/dev/null | awk 'NR==2 {print $4}')" -gt 1024 ]; then
  printf 'SCRATCH_BASE=/dev/shm\n'
  printf 'SCRATCH_WRITABLE=yes\n'
elif [ -w "$HOME" ]; then
  printf 'SCRATCH_BASE=%s\n' "$HOME"
  printf 'SCRATCH_WRITABLE=yes\n'
else
  printf 'SCRATCH_BASE=%s\n' "$HOME"
  printf 'SCRATCH_WRITABLE=no\n'
fi
if command -v docker >/dev/null 2>&1; then printf 'DOCKER_PRESENT=yes\n'; else printf 'DOCKER_PRESENT=no\n'; fi
if command -v podman >/dev/null 2>&1; then printf 'PODMAN_PRESENT=yes\n'; else printf 'PODMAN_PRESENT=no\n'; fi
"#,
    )
    .await
    .expect("probe real-host SSH environment");
    assert!(
        output.success,
        "environment probe failed: {}",
        output.stderr
    );
    output
        .stdout
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_owned(), value.trim().to_owned()))
        .collect()
}

async fn ssh_exec(
    state: &AppState,
    command: &str,
) -> kerminal_lib::error::AppResult<kerminal_lib::models::ssh_command::SshCommandOutput> {
    state
        .ssh_commands()
        .execute_native(
            state.paths(),
            SshCommandRequest {
                host_id: REAL_HOST_ID.to_owned(),
                command: command.to_owned(),
                timeout_seconds: Some(20),
                max_output_bytes: Some(32 * 1024),
            },
        )
        .await
}

fn free_loopback_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind an ephemeral local port")
        .local_addr()
        .expect("read ephemeral local port")
        .port()
}

fn assert_ssh_banner_via_forward(port: u16) {
    let address = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect_timeout(
        &address.parse().expect("valid loopback socket address"),
        Duration::from_secs(5),
    )
    .expect("connect through local SSH port forward");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("set read timeout");
    let mut buffer = [0_u8; 128];
    let read = match stream.read(&mut buffer) {
        Ok(read) => read,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
            ) =>
        {
            stream
                .write_all(b"SSH-2.0-kerminal_core_smoke\r\n")
                .expect("write SSH client banner through local forward");
            stream.read(&mut buffer).expect("read SSH banner")
        }
        Err(error) => panic!("read SSH banner: {error}"),
    };
    let banner = String::from_utf8_lossy(&buffer[..read]);
    assert!(
        banner.starts_with("SSH-"),
        "forwarded connection should expose SSH banner, got: {banner:?}"
    );
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn shell_single_quote_content(value: &str) -> String {
    value.replace('\'', "'\\''")
}
