use super::*;
use super::{
    script::build_container_exec_script,
    text_file::split_text_output,
    transfer::{extract_first_file, write_tar_stream},
};

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

#[test]
fn parses_docker_ps_json_lines_into_container_targets() {
    let output = r#"{"ID":"abcdef1234567890","Image":"repo/api:latest","Names":"api,api-alias","Status":"Up 2 minutes","State":"running","Ports":"0.0.0.0:8080->80/tcp"}"#;

    let containers =
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
        split_text_output("__KERMINAL_TEXT:12:644:1770000000:-rw-r--r--__\nhello")
            .expect("split text");

    assert_eq!(content, "hello");
    assert_eq!(metadata.size, 12);
    assert_eq!(metadata.permissions_mode, Some(0o644));
    assert_eq!(metadata.modified.as_deref(), Some("1770000000"));
    assert_eq!(metadata.permissions.as_deref(), Some("-rw-r--r--"));
}

#[test]
fn compares_revisions_by_hash_when_available() {
    let expected = SftpFileRevision {
        size: 10,
        modified: Some("1".to_owned()),
        permissions: Some("-rw-r--r--".to_owned()),
        permissions_mode: Some(0o644),
        content_sha256: Some("same".to_owned()),
    };
    let current = SftpFileRevision {
        size: 10,
        modified: Some("2".to_owned()),
        permissions: Some("-rw-r--r--".to_owned()),
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
