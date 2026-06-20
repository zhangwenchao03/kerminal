use super::*;

pub(super) fn parse_container_list_output(
    host_id: &str,
    runtime: ContainerRuntime,
    output: &str,
) -> AppResult<Vec<DockerContainerSummary>> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| parse_container_line(host_id, runtime, line))
        .collect()
}

pub(super) fn parse_container_line(
    host_id: &str,
    runtime: ContainerRuntime,
    line: &str,
) -> AppResult<DockerContainerSummary> {
    let value: Value = serde_json::from_str(line).map_err(|error| {
        AppError::Docker(format!("无法解析容器列表 JSON: {error}; line={line}"))
    })?;
    let id = field_string(&value, "ID")
        .or_else(|| field_string(&value, "Id"))
        .ok_or_else(|| AppError::Docker("容器列表缺少 ID 字段".to_owned()))?;
    let name = field_string(&value, "Names")
        .or_else(|| field_string(&value, "Name"))
        .map(|value| first_csv_value(&value))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| short_container_id(&id));
    let image = field_string(&value, "Image").unwrap_or_default();
    let status_text = field_string(&value, "Status").unwrap_or_default();
    let state = field_string(&value, "State").unwrap_or_default();
    let status = DockerContainerStatus::from_cli_fields(&state, &status_text);
    let ports = field_string(&value, "Ports")
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let target = RemoteTargetRef::DockerContainer {
        host_id: host_id.to_owned(),
        container_id: id.clone(),
        runtime,
        container_name: Some(name.clone()),
        user: None,
        workdir: None,
    };

    Ok(DockerContainerSummary {
        host_id: host_id.to_owned(),
        short_id: short_container_id(&id),
        id,
        name,
        image,
        status_text,
        status,
        state,
        ports,
        runtime,
        target,
        capabilities: TargetCapabilities::docker_container(),
    })
}

pub(super) fn parse_ls_entries(base_path: &str, output: &str) -> AppResult<Vec<SftpEntry>> {
    let mut entries = Vec::new();
    for raw in output.lines().map(str::trim_end) {
        if raw.is_empty() || raw.starts_with("total ") {
            continue;
        }
        let Some(entry) = parse_ls_entry(base_path, raw) else {
            continue;
        };
        if entry.name == "." || entry.name == ".." {
            continue;
        }
        entries.push(entry);
    }
    entries.sort_by(|left, right| {
        sftp_entry_kind_rank(&left.kind)
            .cmp(&sftp_entry_kind_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

pub(super) fn sftp_entry_kind_rank(kind: &SftpEntryKind) -> u8 {
    match kind {
        SftpEntryKind::Directory => 0,
        SftpEntryKind::File => 1,
        SftpEntryKind::Symlink => 2,
        SftpEntryKind::Other => 3,
    }
}

pub(super) fn parse_ls_entry(base_path: &str, raw: &str) -> Option<SftpEntry> {
    let parts: Vec<&str> = raw.split_whitespace().collect();
    if parts.len() < 9 {
        return None;
    }
    let permissions = parts[0].to_owned();
    let kind = match permissions.chars().next() {
        Some('d') => SftpEntryKind::Directory,
        Some('l') => SftpEntryKind::Symlink,
        Some('-') => SftpEntryKind::File,
        _ => SftpEntryKind::Other,
    };
    let size = parts.get(4).and_then(|value| value.parse::<u64>().ok());
    let modified = parts.get(5..8).map(|values| values.join(" "));
    let name = parts[8..].join(" ");
    let display_name = if matches!(kind, SftpEntryKind::Symlink) {
        name.split(" -> ").next().unwrap_or(&name).to_owned()
    } else {
        name
    };
    let path = join_remote_path(base_path, &display_name);

    Some(SftpEntry {
        name: display_name,
        path,
        kind,
        size,
        permissions: Some(permissions),
        modified,
        raw: raw.to_owned(),
    })
}

pub(super) fn join_remote_path(base_path: &str, child: &str) -> String {
    let child = child.trim_start_matches('/');
    if base_path == "/" {
        format!("/{child}")
    } else {
        format!("{}/{}", base_path.trim_end_matches('/'), child)
    }
}

pub(super) fn split_preview_output(output: &str) -> AppResult<(String, usize, Option<usize>)> {
    let marker_prefix = "__KERMINAL_BYTES:";
    let Some((marker, content)) = output.split_once('\n') else {
        return Err(AppError::Docker("容器文件预览输出缺少大小标记".to_owned()));
    };
    let total_bytes = marker
        .strip_prefix(marker_prefix)
        .and_then(|value| value.strip_suffix("__"))
        .and_then(|value| value.parse::<usize>().ok());
    let bytes_read = content.len();
    Ok((content.to_owned(), bytes_read, total_bytes))
}
