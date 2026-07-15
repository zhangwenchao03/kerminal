use super::*;

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
