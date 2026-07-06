use super::*;

pub(super) async fn execute_container_list(
    docker_hosts: &DockerHostService,
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
        .list_containers(paths, ssh_commands, request)
        .await
    {
        Ok(containers) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_container_list_for_agent(&containers)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_inspect(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerInfoRequest>(
        arguments,
        "container.inspect",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match docker_hosts
        .inspect_container(paths, ssh_commands, request)
        .await
    {
        Ok(inspect) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_container_inspect_for_agent(&inspect)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_logs_tail(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerLogsRequest>(
        arguments,
        "container.logs.tail",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match docker_hosts
        .tail_container_logs(paths, ssh_commands, request)
        .await
    {
        Ok(logs) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_container_logs_for_agent(&logs)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_stats(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request =
        match request_from_arguments::<DockerContainerStatsRequest>(arguments, "container.stats") {
            Ok(request) => request,
            Err(error) => return failure(error.to_string()),
        };

    match docker_hosts
        .container_stats(paths, ssh_commands, request)
        .await
    {
        Ok(stats) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_container_stats_for_agent(&stats)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_start(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    execute_container_lifecycle(
        docker_hosts,
        paths,
        ssh_commands,
        arguments,
        "container.start",
        DockerContainerLifecycleAction::Start,
    )
    .await
}

pub(super) async fn execute_container_stop(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    execute_container_lifecycle(
        docker_hosts,
        paths,
        ssh_commands,
        arguments,
        "container.stop",
        DockerContainerLifecycleAction::Stop,
    )
    .await
}

pub(super) async fn execute_container_restart(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    execute_container_lifecycle(
        docker_hosts,
        paths,
        ssh_commands,
        arguments,
        "container.restart",
        DockerContainerLifecycleAction::Restart,
    )
    .await
}

pub(super) async fn execute_container_remove(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    execute_container_lifecycle(
        docker_hosts,
        paths,
        ssh_commands,
        arguments,
        "container.remove",
        DockerContainerLifecycleAction::Remove,
    )
    .await
}

async fn execute_container_lifecycle(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
    tool_id: &str,
    action: DockerContainerLifecycleAction,
) -> ToolExecutionResult {
    let request =
        match request_from_arguments::<DockerContainerLifecycleRequest>(arguments, tool_id) {
            Ok(request) => request,
            Err(error) => return failure(error.to_string()),
        };

    let result = match action {
        DockerContainerLifecycleAction::Start => {
            docker_hosts
                .start_container(paths, ssh_commands, request)
                .await
        }
        DockerContainerLifecycleAction::Stop => {
            docker_hosts
                .stop_container(paths, ssh_commands, request)
                .await
        }
        DockerContainerLifecycleAction::Restart => {
            docker_hosts
                .restart_container(paths, ssh_commands, request)
                .await
        }
        DockerContainerLifecycleAction::Remove => {
            docker_hosts
                .remove_container(paths, ssh_commands, request)
                .await
        }
    };

    match result {
        Ok(result) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_container_lifecycle_for_agent(&result)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_list(
    docker_hosts: &DockerHostService,
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
        .list_directory(paths, ssh_commands, request)
        .await
    {
        Ok(listing) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_container_listing_for_agent(&listing)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_preview(
    docker_hosts: &DockerHostService,
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
        .preview_file(paths, ssh_commands, request)
        .await
    {
        Ok(preview) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_container_preview_for_agent(&preview)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_write_text(
    docker_hosts: &DockerHostService,
    remote_hosts: &RemoteHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerWriteTextFileRequest>(
        arguments,
        "container.files.write_text",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match docker_hosts
        .write_text_file(remote_hosts, paths, ssh_commands, request)
        .await
    {
        Ok(response) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_container_write_text_for_agent(&response)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_create_directory(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerPathRequest>(
        arguments,
        "container.files.create_directory",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_container_create_directory_for_agent(&request);

    match docker_hosts
        .create_directory(paths, ssh_commands, request)
        .await
    {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("容器目录创建未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_delete(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerDeleteRequest>(
        arguments,
        "container.files.delete",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_container_delete_for_agent(&request);

    match docker_hosts.delete_path(paths, ssh_commands, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("容器路径删除未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_rename(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerRenameRequest>(
        arguments,
        "container.files.rename",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_container_rename_for_agent(&request);

    match docker_hosts.rename_path(paths, ssh_commands, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("容器路径重命名未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_chmod(
    docker_hosts: &DockerHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerChmodRequest>(
        arguments,
        "container.files.chmod",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_container_chmod_for_agent(&request);

    match docker_hosts.chmod_path(paths, ssh_commands, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("容器路径 chmod 未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_upload(
    docker_hosts: &DockerHostService,
    remote_hosts: &RemoteHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerTransferRequest>(
        arguments,
        "container.files.upload",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_container_upload_for_agent(&request);

    match docker_hosts
        .upload(remote_hosts, paths, ssh_commands, request)
        .await
    {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("容器上传未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_container_files_download(
    docker_hosts: &DockerHostService,
    remote_hosts: &RemoteHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<DockerContainerTransferRequest>(
        arguments,
        "container.files.download",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_container_download_for_agent(&request);

    match docker_hosts
        .download(remote_hosts, paths, ssh_commands, request)
        .await
    {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("容器下载未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_container_inspect_for_agent(
    inspect: &DockerContainerInspectSummary,
) -> String {
    let ports = summarize_string_list(&inspect.ports, 4, "无端口");
    let networks = summarize_string_list(&inspect.networks, 4, "无网络");
    let running = if inspect.running {
        "running"
    } else {
        "stopped"
    };
    format!(
        "容器详情已读取：{}:{}（{}，{}，{}），状态：{} / {}，端口：{}，网络：{}，labels {} 个。",
        inspect.host_id,
        inspect.container_id,
        inspect.name,
        inspect.image,
        inspect.runtime.as_str(),
        inspect.status,
        running,
        ports,
        networks,
        inspect.labels.len()
    )
}

pub(super) fn summarize_container_logs_for_agent(logs: &DockerContainerLogsResult) -> String {
    let line_count = logs.logs.lines().count();
    let sample = logs.logs.lines().take(6).collect::<Vec<_>>().join(" ");
    let sample = truncate_string(&collapse_whitespace(&sample));
    let (sample, redacted) = redact_terminal_text(&sample);
    let sample = if sample.is_empty() {
        "无日志片段".to_owned()
    } else if redacted {
        format!("片段已脱敏：{sample}")
    } else {
        format!("片段：{sample}")
    };
    format!(
        "容器日志已读取：{}:{}（{}），tail={}，返回 {} 行，{}。",
        logs.host_id,
        logs.container_id,
        logs.runtime.as_str(),
        logs.tail,
        line_count,
        sample
    )
}

pub(super) fn summarize_container_stats_for_agent(stats: &DockerContainerStatsResult) -> String {
    format!(
        "容器监控已读取：{}:{}（{}），CPU：{}，内存：{} / {}，网络：{}，块 IO：{}，PIDs：{}。",
        stats.host_id,
        stats.container_id,
        stats.runtime.as_str(),
        stats.cpu_percent.as_deref().unwrap_or("未知"),
        stats.memory_usage.as_deref().unwrap_or("未知"),
        stats.memory_percent.as_deref().unwrap_or("未知"),
        stats.network_io.as_deref().unwrap_or("未知"),
        stats.block_io.as_deref().unwrap_or("未知"),
        stats.pids.as_deref().unwrap_or("未知")
    )
}

pub(super) fn summarize_container_lifecycle_for_agent(
    result: &DockerContainerLifecycleResult,
) -> String {
    let output = truncate_string(&collapse_whitespace(&result.output));
    let (output, redacted) = redact_terminal_text(&output);
    let output = if output.is_empty() {
        "无输出".to_owned()
    } else if redacted {
        format!("输出已脱敏：{output}")
    } else {
        format!("输出：{output}")
    };
    format!(
        "容器{}已执行：{}:{}（{}），{}。",
        container_lifecycle_action_label(result.action),
        result.host_id,
        result.container_id,
        result.runtime.as_str(),
        output
    )
}

pub(super) fn summarize_container_write_text_for_agent(
    response: &DockerContainerWriteTextFileResponse,
) -> String {
    format!(
        "容器文本文件已写入：{}:{}:{}，写入 {} 字节，编码：{}，行尾：{}。",
        response.host_id,
        response.container_id,
        response.path,
        response.bytes_written,
        response.encoding,
        response.line_ending
    )
}

pub(super) fn summarize_container_create_directory_for_agent(
    request: &DockerContainerPathRequest,
) -> String {
    format!(
        "容器目录已创建：{}:{}:{}（{}）。",
        request.host_id,
        request.container_id,
        request.path,
        request.runtime.as_str()
    )
}

pub(super) fn summarize_container_delete_for_agent(
    request: &DockerContainerDeleteRequest,
) -> String {
    let target = if request.directory {
        "容器目录"
    } else {
        "容器文件"
    };
    format!(
        "{target}删除已执行：{}:{}:{}（{}）。",
        request.host_id,
        request.container_id,
        request.path,
        request.runtime.as_str()
    )
}

pub(super) fn summarize_container_rename_for_agent(
    request: &DockerContainerRenameRequest,
) -> String {
    format!(
        "容器路径已重命名：{}:{}:{} -> {}（{}）。",
        request.host_id,
        request.container_id,
        request.from_path,
        request.to_path,
        request.runtime.as_str()
    )
}

pub(super) fn summarize_container_chmod_for_agent(request: &DockerContainerChmodRequest) -> String {
    format!(
        "容器路径权限已修改：{}:{}:{} -> {}（{}）。",
        request.host_id,
        request.container_id,
        request.path,
        request.mode,
        request.runtime.as_str()
    )
}

pub(super) fn summarize_container_upload_for_agent(
    request: &DockerContainerTransferRequest,
) -> String {
    format!(
        "本地{}已上传到容器：{} -> {}:{}:{}（{}）。",
        container_transfer_kind_label(request.kind),
        request.local_path,
        request.host_id,
        request.container_id,
        request.remote_path,
        request.runtime.as_str()
    )
}

pub(super) fn summarize_container_download_for_agent(
    request: &DockerContainerTransferRequest,
) -> String {
    format!(
        "容器{}已下载到本地：{}:{}:{} -> {}（{}）。",
        container_transfer_kind_label(request.kind),
        request.host_id,
        request.container_id,
        request.remote_path,
        request.local_path,
        request.runtime.as_str()
    )
}

pub(super) fn summarize_container_list_for_agent(containers: &[DockerContainerSummary]) -> String {
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

fn summarize_string_list(values: &[String], max_items: usize, empty_label: &str) -> String {
    if values.is_empty() {
        return empty_label.to_owned();
    }
    let sample = values
        .iter()
        .take(max_items)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    if values.len() > max_items {
        format!("{sample}，另有 {} 个", values.len() - max_items)
    } else {
        sample
    }
}

fn container_lifecycle_action_label(action: DockerContainerLifecycleAction) -> &'static str {
    match action {
        DockerContainerLifecycleAction::Start => "启动",
        DockerContainerLifecycleAction::Stop => "停止",
        DockerContainerLifecycleAction::Restart => "重启",
        DockerContainerLifecycleAction::Remove => "删除",
    }
}

fn container_transfer_kind_label(kind: SftpTransferKind) -> &'static str {
    match kind {
        SftpTransferKind::File => "文件",
        SftpTransferKind::Directory => "目录",
    }
}

pub(super) fn summarize_container_listing_for_agent(
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

pub(super) fn summarize_container_preview_for_agent(
    preview: &DockerContainerFilePreview,
) -> String {
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
