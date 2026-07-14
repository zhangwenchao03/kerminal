use super::*;

pub async fn exercise_container_listing_if_runtime_exists(
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

pub fn assert_browser_sftp_reuses_capability_lane(
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

pub fn exercise_port_forward(state: &AppState) {
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

pub fn exercise_ssh_terminal_shell(state: &AppState) {
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

pub fn collect_terminal_until_output(
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

pub fn wait_for_managed_active_channels_at_most(
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

pub async fn remote_environment(state: &AppState) -> HashMap<String, String> {
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

pub async fn ssh_exec(
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

pub fn free_loopback_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind an ephemeral local port")
        .local_addr()
        .expect("read ephemeral local port")
        .port()
}

pub fn assert_ssh_banner_via_forward(port: u16) {
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

pub fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn shell_single_quote_content(value: &str) -> String {
    value.replace('\'', "'\\''")
}
