use super::*;

mod summaries;

use summaries::*;

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
