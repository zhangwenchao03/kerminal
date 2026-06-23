use super::*;

pub(super) async fn execute_container_list(
    docker_hosts: &DockerHostService,
    storage: &SqliteStore,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request =
        match request_from_arguments::<DockerContainerListRequest>(arguments, "container.list") {
            Ok(request) => request,
            Err(error) => return failure(error.to_string()),
        };

    match docker_hosts
        .list_containers(storage, paths, ssh_commands, request)
        .await
    {
        Ok(containers) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_container_list_for_ai(&containers)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_list(
    docker_hosts: &DockerHostService,
    storage: &SqliteStore,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerPathRequest>(
        arguments,
        "container.files.list",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match docker_hosts
        .list_directory(storage, paths, ssh_commands, request)
        .await
    {
        Ok(listing) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_container_listing_for_ai(&listing)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_preview(
    docker_hosts: &DockerHostService,
    storage: &SqliteStore,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerPreviewRequest>(
        arguments,
        "container.files.preview",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match docker_hosts
        .preview_file(storage, paths, ssh_commands, request)
        .await
    {
        Ok(preview) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_container_preview_for_ai(&preview)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_container_list_for_ai(containers: &[DockerContainerSummary]) -> String {
    let sample = containers
        .iter()
        .take(8)
        .map(|container| {
            format!(
                "{} ({}, {}, {})",
                container.name, container.short_id, container.image, container.status_text
            )
        })
        .collect::<Vec<_>>();
    if sample.is_empty() {
        "容器列表已读取：0 个容器。".to_owned()
    } else {
        let suffix = if containers.len() > sample.len() {
            format!("，另有 {} 个未显示", containers.len() - sample.len())
        } else {
            String::new()
        };
        format!(
            "容器列表已读取：{} 个容器，{}{}。",
            containers.len(),
            sample.join("；"),
            suffix
        )
    }
}

pub(super) fn summarize_container_listing_for_ai(
    listing: &DockerContainerDirectoryListing,
) -> String {
    let sample = listing
        .entries
        .iter()
        .take(10)
        .map(|entry| format!("{} ({:?})", entry.name, entry.kind))
        .collect::<Vec<_>>();
    if sample.is_empty() {
        format!(
            "容器目录已读取：{}:{}:{}，0 个条目。",
            listing.host_id, listing.container_id, listing.path
        )
    } else {
        let suffix = if listing.entries.len() > sample.len() {
            format!("，另有 {} 个未显示", listing.entries.len() - sample.len())
        } else {
            String::new()
        };
        format!(
            "容器目录已读取：{}:{}:{}，{} 个条目，{}{}。",
            listing.host_id,
            listing.container_id,
            listing.path,
            listing.entries.len(),
            sample.join("；"),
            suffix
        )
    }
}

pub(super) fn summarize_container_preview_for_ai(preview: &DockerContainerFilePreview) -> String {
    let sample = preview
        .content
        .lines()
        .take(4)
        .collect::<Vec<_>>()
        .join(" ");
    let sample = truncate_string(&collapse_whitespace(&sample));
    let (sample, redacted) = redact_terminal_text(&sample);
    let redaction_label = if redacted { "，片段已脱敏" } else { "" };
    let truncation_label = if preview.truncated {
        "，内容已截断"
    } else {
        ""
    };

    if sample.is_empty() {
        format!(
            "容器文件已预览：{}:{}:{}，读取 {} / {} 字节{}{}。",
            preview.host_id,
            preview.container_id,
            preview.path,
            preview.bytes_read,
            preview.max_bytes,
            truncation_label,
            redaction_label
        )
    } else {
        format!(
            "容器文件已预览：{}:{}:{}，读取 {} / {} 字节{}{}，片段：{}。",
            preview.host_id,
            preview.container_id,
            preview.path,
            preview.bytes_read,
            preview.max_bytes,
            truncation_label,
            redaction_label,
            sample
        )
    }
}
