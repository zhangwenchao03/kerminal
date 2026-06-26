//! Docker host service rule tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::{
        docker::{
            DockerComposeRuntimeFamily, DockerContainerLifecycleAction, DockerContainerStatus,
            DockerContainerSummary, DockerContainerTerminalCreateRequest,
        },
        remote_host::{RemoteHost, RemoteHostAuthType},
        sftp::{SftpEntryKind, SftpFileRevision, SftpTransferKind},
        target::ContainerRuntime,
    },
    services::docker_host_service::{
        rules::{
            build_container_exec_script, build_container_inspect_script,
            build_container_label_inspect_script, build_container_lifecycle_script,
            build_container_logs_script, build_container_stats_script,
            build_container_terminal_request, detect_line_ending, extract_first_file,
            merge_container_summary_labels, parse_compose_metadata,
            parse_container_inspect_summary, parse_container_label_inspect_output,
            parse_container_list_output, parse_container_stats_output, parse_ls_entries,
            same_revision, split_preview_output, split_text_output, write_tar_stream,
        },
        DockerHostService,
    },
};
use std::collections::BTreeMap;

fn remote_host(auth_type: RemoteHostAuthType) -> RemoteHost {
    let (credential_ref, credential_secret) = match auth_type {
        RemoteHostAuthType::Agent => (None, None),
        RemoteHostAuthType::Password => (None, Some("correct horse battery staple".to_owned())),
        RemoteHostAuthType::Key => (Some("C:/keys/dev.key".to_owned()), None),
    };

    RemoteHost {
        id: "host-1".to_owned(),
        group_id: Some("group-1".to_owned()),
        name: "dev".to_owned(),
        host: "dev.internal".to_owned(),
        port: 2222,
        username: "deploy".to_owned(),
        auth_type,
        credential_ref,
        credential_secret,
        tags: vec!["dev".to_owned()],
        production: false,
        ssh_options: Default::default(),
        sort_order: 10,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}

#[test]
fn parses_docker_ps_json_lines_into_container_targets() {
    let output = r#"{"ID":"abcdef1234567890","Image":"repo/api:latest","Names":"api,api-alias","Status":"Up 2 minutes","State":"running","Ports":"0.0.0.0:8080->80/tcp"}"#;

    let containers: Vec<DockerContainerSummary> =
        parse_container_list_output("host-1", ContainerRuntime::Docker, output).expect("parse");

    assert_eq!(containers.len(), 1);
    assert_eq!(containers[0].short_id, "abcdef123456");
    assert_eq!(containers[0].name, "api");
    assert_eq!(containers[0].status, DockerContainerStatus::Running);
    assert_eq!(
        containers[0].target.stable_id(),
        "docker:host-1:abcdef1234567890"
    );
    assert!(containers[0].capabilities.terminal);
}

#[test]
fn parses_docker_compose_labels_into_typed_metadata() {
    let output = r#"{"ID":"abcdef1234567890","Image":"repo/api:latest","Names":"api","Status":"Up 2 minutes","State":"running","Labels":"com.docker.compose.project=stack,com.docker.compose.service=api,com.docker.compose.project.working_dir=/srv/stack,com.docker.compose.project.config_files=compose.yaml,compose.override.yaml,com.docker.compose.container-number=1,com.docker.compose.oneoff=True"}"#;

    let containers =
        parse_container_list_output("host-1", ContainerRuntime::Docker, output).expect("parse");

    let compose = containers[0].compose.as_ref().expect("compose metadata");
    assert_eq!(compose.project, "stack");
    assert_eq!(compose.service.as_deref(), Some("api"));
    assert_eq!(compose.working_dir.as_deref(), Some("/srv/stack"));
    assert_eq!(
        compose.config_files,
        vec!["compose.yaml", "compose.override.yaml"]
    );
    assert_eq!(
        compose.config_paths,
        vec![
            "/srv/stack/compose.yaml",
            "/srv/stack/compose.override.yaml"
        ]
    );
    assert_eq!(compose.container_number.as_deref(), Some("1"));
    assert!(compose.oneoff);
    assert_eq!(
        compose.runtime_family,
        DockerComposeRuntimeFamily::DockerCompose
    );
    assert_eq!(
        containers[0]
            .labels
            .get("com.docker.compose.project")
            .map(String::as_str),
        Some("stack")
    );
}

#[test]
fn parses_podman_compose_labels_into_typed_metadata() {
    let output = r#"{"ID":"pod1234567890","Image":"repo/web:latest","Names":"web","Status":"Up 2 minutes","State":"running","Labels":{"io.podman.compose.project":"podstack","io.podman.compose.service":"web","io.podman.compose.project.working_dir":"/srv/podstack","io.podman.compose.project.config_files":"compose.yaml;compose.prod.yaml"}}"#;

    let containers =
        parse_container_list_output("host-1", ContainerRuntime::Podman, output).expect("parse");

    let compose = containers[0].compose.as_ref().expect("compose metadata");
    assert_eq!(compose.project, "podstack");
    assert_eq!(compose.service.as_deref(), Some("web"));
    assert_eq!(compose.working_dir.as_deref(), Some("/srv/podstack"));
    assert_eq!(
        compose.config_paths,
        vec![
            "/srv/podstack/compose.yaml",
            "/srv/podstack/compose.prod.yaml"
        ]
    );
    assert_eq!(
        compose.runtime_family,
        DockerComposeRuntimeFamily::PodmanCompose
    );
}

#[test]
fn leaves_standalone_container_without_compose_metadata() {
    let output = r#"{"ID":"deadbeef98765432","Image":"redis:7","Names":"redis","Status":"Exited (0) 1 hour ago","State":"exited","Ports":""}"#;

    let containers =
        parse_container_list_output("host-1", ContainerRuntime::Docker, output).expect("parse");

    assert!(containers[0].compose.is_none());
    assert!(containers[0].labels.is_empty());
    assert_eq!(containers[0].status, DockerContainerStatus::Exited);
}

#[test]
fn resolves_windows_compose_config_paths_without_colon_split() {
    let mut labels = BTreeMap::new();
    labels.insert(
        "com.docker.compose.project".to_owned(),
        "win-stack".to_owned(),
    );
    labels.insert(
        "com.docker.compose.project.working_dir".to_owned(),
        r"C:\apps\win-stack".to_owned(),
    );
    labels.insert(
        "com.docker.compose.project.config_files".to_owned(),
        r"C:\apps\win-stack\compose.yaml;compose.override.yaml".to_owned(),
    );

    let compose = parse_compose_metadata(&labels).expect("compose metadata");

    assert_eq!(
        compose.config_files,
        vec![r"C:\apps\win-stack\compose.yaml", "compose.override.yaml"]
    );
    assert_eq!(
        compose.config_paths,
        vec![
            r"C:\apps\win-stack\compose.yaml",
            r"C:\apps\win-stack\compose.override.yaml"
        ]
    );
}

#[test]
fn merges_batch_inspect_labels_into_container_summaries() {
    let output = r#"{"ID":"abcdef1234567890","Image":"repo/api:latest","Names":"api","Status":"Up 2 minutes","State":"running"}"#;
    let mut containers =
        parse_container_list_output("host-1", ContainerRuntime::Docker, output).expect("parse");
    assert!(containers[0].compose.is_none());

    let inspect_output = r#"{"Id":"abcdef1234567890","Config":{"Labels":{"com.docker.compose.project":"stack","com.docker.compose.service":"api","com.docker.compose.project.working_dir":"/srv/stack","com.docker.compose.project.config_files":"compose.yaml"}}}"#;
    let labels_by_id =
        parse_container_label_inspect_output(inspect_output).expect("inspect labels");
    merge_container_summary_labels(&mut containers, &labels_by_id);

    let compose = containers[0].compose.as_ref().expect("compose metadata");
    assert_eq!(compose.project, "stack");
    assert_eq!(compose.config_paths, vec!["/srv/stack/compose.yaml"]);
}

#[test]
fn build_container_terminal_request_uses_quoted_docker_exec() {
    let request = build_container_terminal_request(
        &remote_host(RemoteHostAuthType::Key),
        "ssh".to_owned(),
        DockerContainerTerminalCreateRequest {
            host_id: "host-1".to_owned(),
            container_id: "container 1".to_owned(),
            runtime: ContainerRuntime::Docker,
            shell: Some("exec /bin/bash -l".to_owned()),
            user: Some("app".to_owned()),
            workdir: Some("/srv/app".to_owned()),
            cols: 100,
            rows: 30,
        },
    )
    .expect("build request");

    assert_eq!(request.shell.as_deref(), Some("ssh"));
    assert_eq!(request.rows, 30);
    assert_eq!(request.cols, 100);
    assert!(request.args.contains(&"-tt".to_owned()));
    assert!(request.args.windows(2).any(|pair| pair == ["-p", "2222"]));
    let remote_command = request.args.last().expect("remote command");
    assert!(remote_command.contains("docker exec -it"));
    assert!(remote_command.contains("--user 'app'"));
    assert!(remote_command.contains("--workdir '/srv/app'"));
    assert!(remote_command.contains("'container 1' sh -lc 'exec /bin/bash -l'"));
}

#[test]
fn resolve_container_ssh_terminal_request_delegates_docker_exec_to_ssh_terminal_service() {
    let request = DockerHostService::new()
        .resolve_container_ssh_terminal_request(DockerContainerTerminalCreateRequest {
            host_id: "host-1".to_owned(),
            container_id: "container 1".to_owned(),
            runtime: ContainerRuntime::Docker,
            shell: Some("exec /bin/bash -l".to_owned()),
            user: Some("app".to_owned()),
            workdir: Some("/srv/app".to_owned()),
            cols: 100,
            rows: 30,
        })
        .expect("resolve docker container ssh terminal request");

    assert_eq!(request.host_id, "host-1");
    assert_eq!(request.rows, 30);
    assert_eq!(request.cols, 100);
    assert!(request.cwd.is_none());
    let remote_command = request.remote_command.expect("remote docker exec command");
    assert!(remote_command.contains("docker exec -it"));
    assert!(remote_command.contains("--user 'app'"));
    assert!(remote_command.contains("--workdir '/srv/app'"));
    assert!(remote_command.contains("'container 1' sh -lc 'exec /bin/bash -l'"));
}

#[test]
fn build_container_terminal_request_rejects_empty_container_id() {
    let error = build_container_terminal_request(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        DockerContainerTerminalCreateRequest {
            host_id: "host-1".to_owned(),
            container_id: " ".to_owned(),
            runtime: ContainerRuntime::Docker,
            shell: None,
            user: None,
            workdir: None,
            cols: 80,
            rows: 24,
        },
    )
    .expect_err("reject empty container id");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn parses_container_ls_output_with_directories_first() {
    let output = "\
total 8
drwxr-xr-x 2 root root 4096 Jun 18 12:00 .
drwxr-xr-x 3 root root 4096 Jun 18 12:00 ..
-rw-r--r-- 1 root root 128 Jun 18 12:01 app.log
drwxr-xr-x 2 root root 4096 Jun 18 12:02 config
lrwxrwxrwx 1 root root 8 Jun 18 12:03 latest -> app.log
";

    let entries = parse_ls_entries("/var/log", output).expect("parse ls");

    assert_eq!(entries[0].name, "config");
    assert_eq!(entries[0].kind, SftpEntryKind::Directory);
    assert_eq!(entries[1].path, "/var/log/app.log");
    assert_eq!(entries[2].name, "latest");
    assert_eq!(entries[2].kind, SftpEntryKind::Symlink);
}

#[test]
fn splits_preview_output_marker() {
    let (content, bytes_read, total_bytes) =
        split_preview_output("__KERMINAL_BYTES:12__\nhello").expect("split preview");

    assert_eq!(content, "hello");
    assert_eq!(bytes_read, 5);
    assert_eq!(total_bytes, Some(12));
}

#[test]
fn splits_container_text_output_metadata() {
    let (metadata, content) =
        split_text_output("__KERMINAL_TEXT:12:644:1770000000:-rw-r--__\nhello")
            .expect("split text");

    assert_eq!(content, "hello");
    assert_eq!(metadata.size, 12);
    assert_eq!(metadata.permissions_mode, Some(0o644));
    assert_eq!(metadata.modified.as_deref(), Some("1770000000"));
    assert_eq!(metadata.permissions.as_deref(), Some("-rw-r--"));
}

#[test]
fn compares_revisions_by_hash_when_available() {
    let expected = SftpFileRevision {
        size: 10,
        modified: Some("1".to_owned()),
        permissions: Some("-rw-r--".to_owned()),
        permissions_mode: Some(0o644),
        content_sha256: Some("same".to_owned()),
    };
    let current = SftpFileRevision {
        size: 10,
        modified: Some("2".to_owned()),
        permissions: Some("-rw-r--".to_owned()),
        permissions_mode: Some(0o644),
        content_sha256: Some("same".to_owned()),
    };

    assert!(same_revision(&expected, &current));
}

#[test]
fn detects_line_endings_for_container_editor() {
    assert_eq!(detect_line_ending("a\nb\n"), "lf");
    assert_eq!(detect_line_ending("a\r\nb\r\n"), "crlf");
    assert_eq!(detect_line_ending("a\r\nb\n"), "mixed");
}

#[test]
fn builds_container_exec_script_with_quoted_args() {
    let script = build_container_exec_script(
        ContainerRuntime::Docker,
        "api 1",
        "target=$1\necho \"$target\"",
        &["/path with space/file.txt".to_owned()],
    );

    assert!(script.contains("container='api 1'"));
    assert!(script.contains("docker"));
    assert!(script.contains("'/path with space/file.txt'"));
}

#[test]
fn builds_container_lifecycle_script_with_quoted_container_id() {
    let script = build_container_lifecycle_script(
        ContainerRuntime::Docker,
        DockerContainerLifecycleAction::Restart,
        "api $(touch owned)",
        false,
    );

    assert!(script.contains("runtime='docker'"));
    assert!(script.contains("container='api $(touch owned)'"));
    assert!(script.contains("\"$runtime\" restart \"$container\""));
    assert!(!script.contains("restart -f"));
}

#[test]
fn builds_forced_remove_lifecycle_script_only_for_remove() {
    let remove_script = build_container_lifecycle_script(
        ContainerRuntime::Podman,
        DockerContainerLifecycleAction::Remove,
        "api",
        true,
    );
    let start_script = build_container_lifecycle_script(
        ContainerRuntime::Podman,
        DockerContainerLifecycleAction::Start,
        "api",
        true,
    );

    assert!(remove_script.contains("runtime='podman'"));
    assert!(remove_script.contains("\"$runtime\" rm -f \"$container\""));
    assert!(start_script.contains("\"$runtime\" start \"$container\""));
    assert!(!start_script.contains("start -f"));
}

#[test]
fn builds_container_inspector_scripts_with_quoted_container_id() {
    let inspect_script = build_container_inspect_script(ContainerRuntime::Docker, "api $(owned)");
    let label_inspect_script = build_container_label_inspect_script(
        ContainerRuntime::Docker,
        &["api $(owned)".to_owned(), "worker".to_owned()],
    );
    let logs_script = build_container_logs_script(ContainerRuntime::Docker, "api $(owned)", 200);
    let stats_script = build_container_stats_script(ContainerRuntime::Podman, "api $(owned)");

    assert!(inspect_script.contains("container='api $(owned)'"));
    assert!(inspect_script.contains("\"$runtime\" inspect \"$container\""));
    assert!(label_inspect_script.contains("'api $(owned)' 'worker'"));
    assert!(label_inspect_script.contains("\"$runtime\" inspect --format '{{json .}}'"));
    assert!(logs_script.contains("tail=200"));
    assert!(logs_script.contains("\"$runtime\" logs --tail \"$tail\" \"$container\" 2>&1"));
    assert!(stats_script.contains("runtime='podman'"));
    assert!(stats_script
        .contains("\"$runtime\" stats --no-stream --format '{{json .}}' \"$container\""));
}

#[test]
fn parses_container_inspect_summary_fields() {
    let output = r#"[{
      "Id":"abcdef1234567890",
      "Name":"/api",
      "Created":"2026-06-25T08:00:00Z",
      "Config":{
        "Image":"repo/api:latest",
        "Entrypoint":["/entrypoint.sh"],
        "Cmd":["serve"],
        "WorkingDir":"/srv/app",
        "User":"app",
        "Labels":{"com.docker.compose.project":"stack"}
      },
      "State":{
        "Status":"running",
        "Running":true,
        "StartedAt":"2026-06-25T08:01:00Z",
        "FinishedAt":"0001-01-01T00:00:00Z"
      },
      "NetworkSettings":{
        "Ports":{"80/tcp":[{"HostIp":"0.0.0.0","HostPort":"8080"}]},
        "Networks":{"bridge":{}}
      }
    }]"#;

    let summary = parse_container_inspect_summary(
        "host-1",
        "abcdef1234567890",
        ContainerRuntime::Docker,
        output,
    )
    .expect("parse inspect");

    assert_eq!(summary.name, "api");
    assert_eq!(summary.image, "repo/api:latest");
    assert_eq!(summary.status, "running");
    assert!(summary.running);
    assert_eq!(summary.entrypoint, vec!["/entrypoint.sh"]);
    assert_eq!(summary.command, vec!["serve"]);
    assert_eq!(summary.working_dir.as_deref(), Some("/srv/app"));
    assert_eq!(
        summary
            .labels
            .get("com.docker.compose.project")
            .map(String::as_str),
        Some("stack")
    );
    assert_eq!(summary.ports, vec!["0.0.0.0:8080->80/tcp"]);
    assert_eq!(summary.networks, vec!["bridge"]);
}

#[test]
fn parses_container_stats_json_output() {
    let stats = parse_container_stats_output(
        "host-1",
        "api",
        ContainerRuntime::Docker,
        r#"{"CPUPerc":"0.42%","MemUsage":"42MiB / 1GiB","MemPerc":"4.1%","NetIO":"1kB / 2kB","BlockIO":"0B / 0B","PIDs":"7"}"#,
    );

    assert_eq!(stats.cpu_percent.as_deref(), Some("0.42%"));
    assert_eq!(stats.memory_usage.as_deref(), Some("42MiB / 1GiB"));
    assert_eq!(stats.network_io.as_deref(), Some("1kB / 2kB"));
    assert_eq!(stats.pids.as_deref(), Some("7"));
}

#[test]
fn tar_stream_round_trip_for_uploaded_file() {
    let temp = tempfile::tempdir().expect("tempdir");
    let source = temp.path().join("source.txt");
    let target = temp.path().join("target.txt");
    std::fs::write(&source, b"hello container").expect("write source");
    let mut bytes = Vec::new();

    write_tar_stream(&mut bytes, &source, "target.txt", SftpTransferKind::File).expect("write tar");
    extract_first_file(std::io::Cursor::new(bytes), &target).expect("extract tar");

    assert_eq!(
        std::fs::read_to_string(target).expect("read target"),
        "hello container"
    );
}
