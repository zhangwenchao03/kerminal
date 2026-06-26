use super::*;

pub(super) async fn execute_sftp_rename(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_rename_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_sftp_rename_for_agent(&request);

    match sftp.rename(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 重命名未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_rename_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpRenameRequest> {
    Ok(SftpRenameRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        from_path: required_string_arg(arguments, "fromPath")?,
        to_path: required_string_arg(arguments, "toPath")?,
    })
}

pub(super) fn summarize_sftp_rename_for_agent(request: &SftpRenameRequest) -> String {
    format!(
        "远程路径已重命名：{}:{} -> {}。",
        request.host_id, request.from_path, request.to_path
    )
}

pub(super) async fn execute_sftp_move(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_rename_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_sftp_move_for_agent(&request);

    match sftp.rename(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 移动未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_sftp_move_for_agent(request: &SftpRenameRequest) -> String {
    format!(
        "远程路径已移动：{}:{} -> {}。",
        request.host_id, request.from_path, request.to_path
    )
}

pub(super) async fn execute_sftp_preview(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_preview_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match sftp.preview_file(paths, request).await {
        Ok(preview) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_sftp_preview_for_agent(&preview)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_preview_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpPreviewRequest> {
    Ok(SftpPreviewRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        path: required_string_arg(arguments, "path")?,
        max_bytes: optional_usize_arg(arguments, "maxBytes")?,
    })
}

/// 将 SFTP 文件预览压缩成外部 Agent 可读摘要，避免返回完整文件内容。
pub fn summarize_sftp_preview_for_agent(preview: &SftpFilePreview) -> String {
    let sample = preview
        .content
        .lines()
        .take(4)
        .collect::<Vec<_>>()
        .join(" ");
    let sample = collapse_whitespace(&sample);
    let sample = truncate_string(&sample);
    let (sample, redacted) = redact_terminal_text(&sample);
    let redaction_label = if redacted { "，片段已脱敏" } else { "" };
    let truncation_label = if preview.truncated {
        "，内容已截断"
    } else {
        ""
    };

    if sample.is_empty() {
        format!(
            "远程文件已预览：{}:{}，读取 {} / {} 字节{}{}。",
            preview.host_id,
            preview.path,
            preview.bytes_read,
            preview.max_bytes,
            truncation_label,
            redaction_label
        )
    } else {
        format!(
            "远程文件已预览：{}:{}，读取 {} / {} 字节{}{}，片段：{}。",
            preview.host_id,
            preview.path,
            preview.bytes_read,
            preview.max_bytes,
            truncation_label,
            redaction_label,
            sample
        )
    }
}

pub(super) async fn execute_sftp_create_directory(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_path_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = format!("远程目录已创建：{}:{}。", request.host_id, request.path);

    match sftp.create_directory(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 创建目录未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_path_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpPathRequest> {
    Ok(SftpPathRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        path: required_string_arg(arguments, "path")?,
    })
}

pub(super) async fn execute_sftp_chmod(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_chmod_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = format!(
        "远程路径权限已修改：{}:{} -> {}。",
        request.host_id, request.path, request.mode
    );

    match sftp.chmod(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP chmod 未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_chmod_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpChmodRequest> {
    Ok(SftpChmodRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        path: required_string_arg(arguments, "path")?,
        mode: required_string_arg(arguments, "mode")?,
    })
}

pub(super) async fn execute_sftp_upload(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_transfer_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_sftp_upload_for_agent(&request);

    match sftp.upload(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 上传未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_sftp_upload_for_agent(request: &SftpTransferRequest) -> String {
    format!(
        "本地文件已上传：{} -> {}:{}。",
        request.local_path, request.host_id, request.remote_path
    )
}

pub(super) async fn execute_sftp_upload_directory(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_transfer_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = format!(
        "本地目录已递归上传：{} -> {}:{}。",
        request.local_path, request.host_id, request.remote_path
    );

    match sftp.upload_directory(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 递归上传未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_sftp_download(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_transfer_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_sftp_download_for_agent(&request);

    match sftp.download(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 下载未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_sftp_download_directory(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_transfer_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = format!(
        "远程目录已递归下载：{}:{} -> {}。",
        request.host_id, request.remote_path, request.local_path
    );

    match sftp.download_directory(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 递归下载未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_transfer_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpTransferRequest> {
    Ok(SftpTransferRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        remote_path: required_string_arg(arguments, "remotePath")?,
        local_path: required_string_arg(arguments, "localPath")?,
        conflict_policy: SftpTransferConflictPolicy::Overwrite,
    })
}

pub(super) fn summarize_sftp_download_for_agent(request: &SftpTransferRequest) -> String {
    format!(
        "远程文件已下载：{}:{} -> {}。",
        request.host_id, request.remote_path, request.local_path
    )
}

pub(super) async fn execute_sftp_delete(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_delete_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_sftp_delete_for_agent(&request);

    match sftp.delete(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 删除未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_delete_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpDeleteRequest> {
    Ok(SftpDeleteRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        path: required_string_arg(arguments, "path")?,
        directory: optional_bool_arg(arguments, "directory")?,
    })
}

pub(super) fn summarize_sftp_delete_for_agent(request: &SftpDeleteRequest) -> String {
    let target = if request.directory {
        "远程空目录"
    } else {
        "远程文件"
    };
    format!("{target}删除已执行：{}:{}。", request.host_id, request.path)
}

pub(super) fn execute_sftp_transfer_enqueue(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<SftpManagedTransferRequest>(
        arguments,
        "sftp.transfer.enqueue",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match sftp.enqueue_transfer(paths, request) {
        Ok(summary) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_sftp_transfer_for_agent(
                "SFTP 传输任务已加入队列",
                &summary,
            )),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_sftp_transfer_list(sftp: &SftpService) -> ToolExecutionResult {
    match sftp.list_transfers() {
        Ok(transfers) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_sftp_transfers_for_agent(&transfers)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_sftp_transfer_cancel(
    sftp: &SftpService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<SftpTransferCancelRequest>(
        arguments,
        "sftp.transfer.cancel",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match sftp.cancel_transfer(request) {
        Ok(summary) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_sftp_transfer_for_agent(
                "SFTP 传输任务已请求取消",
                &summary,
            )),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_sftp_transfer_clear_completed(sftp: &SftpService) -> ToolExecutionResult {
    match sftp.clear_completed_transfers() {
        Ok(remaining) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(format!(
                "已清理结束的 SFTP 传输任务，当前仍保留 {} 个未结束任务。",
                remaining.len()
            )),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_sftp_transfers_for_agent(transfers: &[SftpTransferSummary]) -> String {
    if transfers.is_empty() {
        return "当前没有 SFTP 传输任务。".to_owned();
    }

    let samples = transfers
        .iter()
        .take(5)
        .map(|summary| summarize_sftp_transfer_for_agent("任务", summary))
        .collect::<Vec<_>>()
        .join("；");
    format!(
        "当前共有 {} 个 SFTP 传输任务。示例：{}。",
        transfers.len(),
        samples
    )
}

pub(super) fn summarize_sftp_transfer_for_agent(
    prefix: &str,
    summary: &SftpTransferSummary,
) -> String {
    let progress = summary
        .total_bytes
        .map(|total| format!("{} / {} 字节", summary.bytes_transferred, total))
        .unwrap_or_else(|| format!("{} 字节", summary.bytes_transferred));
    format!(
        "{prefix}：{} {} {}:{} <-> {}，状态：{}，进度：{}，id={}。",
        sftp_transfer_direction_label(summary.direction),
        sftp_transfer_kind_label(summary.kind),
        summary.host_id,
        summary.remote_path,
        summary.local_path,
        sftp_transfer_status_label(summary.status),
        progress,
        summary.id
    )
}

pub(super) fn sftp_transfer_direction_label(direction: SftpTransferDirection) -> &'static str {
    match direction {
        SftpTransferDirection::Upload => "上传",
        SftpTransferDirection::Download => "下载",
    }
}

pub(super) fn sftp_transfer_kind_label(kind: SftpTransferKind) -> &'static str {
    match kind {
        SftpTransferKind::File => "文件",
        SftpTransferKind::Directory => "目录",
    }
}

pub(super) fn sftp_transfer_status_label(status: SftpTransferStatus) -> &'static str {
    match status {
        SftpTransferStatus::Queued => "排队中",
        SftpTransferStatus::Running => "运行中",
        SftpTransferStatus::Succeeded => "已成功",
        SftpTransferStatus::Failed => "已失败",
        SftpTransferStatus::Canceled => "已取消",
    }
}

pub(super) async fn execute_sftp_list(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let host_id = match required_string_arg(arguments, "hostId") {
        Ok(host_id) => host_id,
        Err(error) => return failure(error.to_string()),
    };
    let path = match required_string_arg(arguments, "path") {
        Ok(path) => path,
        Err(error) => return failure(error.to_string()),
    };

    match sftp
        .list_directory(paths, SftpListDirectoryRequest { host_id, path })
        .await
    {
        Ok(listing) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_sftp_listing_for_agent(&listing)),
            error: None,
            structured_result: Some(json!({
                "hostId": listing.host_id,
                "path": listing.path,
                "entryCount": listing.entries.len(),
                "entries": listing.entries,
            })),
            entities: listing
                .entries
                .iter()
                .map(|entry| {
                    json!({
                        "type": "sftpEntry",
                        "hostId": listing.host_id,
                        "path": listing.path,
                        "name": entry.name,
                        "kind": entry.kind,
                        "size": entry.size,
                        "modified": entry.modified,
                    })
                })
                .collect(),
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

/// 将 SFTP 目录列表压缩成外部 Agent 可读摘要。
pub fn summarize_sftp_listing_for_agent(listing: &SftpDirectoryListing) -> String {
    let directory_count = listing
        .entries
        .iter()
        .filter(|entry| matches!(&entry.kind, SftpEntryKind::Directory))
        .count();
    let file_count = listing
        .entries
        .iter()
        .filter(|entry| matches!(&entry.kind, SftpEntryKind::File))
        .count();
    let symlink_count = listing
        .entries
        .iter()
        .filter(|entry| matches!(&entry.kind, SftpEntryKind::Symlink))
        .count();
    let sample = listing
        .entries
        .iter()
        .take(5)
        .map(|entry| entry.name.as_str())
        .collect::<Vec<_>>();
    let sample_text = if sample.is_empty() {
        "无条目".to_owned()
    } else {
        sample.join("、")
    };

    format!(
        "远程目录已读取：{}:{}，共 {} 项（目录 {}、文件 {}、链接 {}），示例：{}。",
        listing.host_id,
        listing.path,
        listing.entries.len(),
        directory_count,
        file_count,
        symlink_count,
        sample_text
    )
}
