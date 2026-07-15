//! 容器列表、生命周期、详情、日志和监控操作。

use super::*;

impl DockerHostService {
    /// 列出指定 SSH 宿主上的容器。
    pub async fn list_containers(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerListRequest,
    ) -> AppResult<Vec<DockerContainerSummary>> {
        let host_id = normalize_required("SSH 主机 id", &request.host_id)?;
        let command = build_container_list_script(request.runtime, request.include_stopped);
        let output = ssh_commands
            .execute_native(
                paths,
                SshCommandRequest {
                    host_id: host_id.clone(),
                    command,
                    timeout_seconds: Some(CONTAINER_LIST_TIMEOUT_SECONDS),
                    max_output_bytes: Some(CONTAINER_LIST_OUTPUT_BYTES),
                },
            )
            .await?;
        if !output.success {
            return Err(AppError::Docker(format!(
                "容器列表读取失败: {}",
                first_non_empty(&output.stderr, &output.stdout)
            )));
        }

        let mut containers =
            parse_container_list_output(&host_id, request.runtime, &output.stdout)?;
        self.enrich_container_list_labels(
            paths,
            ssh_commands,
            &host_id,
            request.runtime,
            &mut containers,
        )
        .await;
        Ok(containers)
    }

    async fn enrich_container_list_labels(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        host_id: &str,
        runtime: ContainerRuntime,
        containers: &mut [DockerContainerSummary],
    ) {
        let inspect_ids: Vec<String> = containers
            .iter()
            .filter(|container| container_summary_needs_label_inspect(container))
            .map(|container| container.id.clone())
            .collect();
        if inspect_ids.is_empty() {
            return;
        }

        let command = build_container_label_inspect_script(runtime, &inspect_ids);
        let output = ssh_commands
            .execute_native(
                paths,
                SshCommandRequest {
                    host_id: host_id.to_owned(),
                    command,
                    timeout_seconds: Some(CONTAINER_INSPECT_TIMEOUT_SECONDS),
                    max_output_bytes: Some(CONTAINER_INSPECT_OUTPUT_BYTES),
                },
            )
            .await;

        // Compose metadata is best-effort enrichment; the basic container list remains usable.
        let Ok(output) = output else {
            return;
        };
        if !output.success {
            return;
        }
        let Ok(labels_by_id) = parse_container_label_inspect_output(&output.stdout) else {
            return;
        };
        merge_container_summary_labels(containers, &labels_by_id);
    }

    /// 启动指定容器。
    pub async fn start_container(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerLifecycleRequest,
    ) -> AppResult<DockerContainerLifecycleResult> {
        self.run_container_lifecycle_action(
            paths,
            ssh_commands,
            request,
            DockerContainerLifecycleAction::Start,
        )
        .await
    }

    /// 停止指定容器。
    pub async fn stop_container(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerLifecycleRequest,
    ) -> AppResult<DockerContainerLifecycleResult> {
        self.run_container_lifecycle_action(
            paths,
            ssh_commands,
            request,
            DockerContainerLifecycleAction::Stop,
        )
        .await
    }

    /// 重启指定容器。
    pub async fn restart_container(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerLifecycleRequest,
    ) -> AppResult<DockerContainerLifecycleResult> {
        self.run_container_lifecycle_action(
            paths,
            ssh_commands,
            request,
            DockerContainerLifecycleAction::Restart,
        )
        .await
    }

    /// 删除指定容器。
    pub async fn remove_container(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerLifecycleRequest,
    ) -> AppResult<DockerContainerLifecycleResult> {
        self.run_container_lifecycle_action(
            paths,
            ssh_commands,
            request,
            DockerContainerLifecycleAction::Remove,
        )
        .await
    }

    async fn run_container_lifecycle_action(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerLifecycleRequest,
        action: DockerContainerLifecycleAction,
    ) -> AppResult<DockerContainerLifecycleResult> {
        let host_id = normalize_required("SSH 主机 id", &request.host_id)?;
        let container_id = normalize_required("容器 id", &request.container_id)?;
        let command =
            build_container_lifecycle_script(request.runtime, action, &container_id, request.force);
        let output = ssh_commands
            .execute_native(
                paths,
                SshCommandRequest {
                    host_id: host_id.clone(),
                    command,
                    timeout_seconds: Some(CONTAINER_LIFECYCLE_TIMEOUT_SECONDS),
                    max_output_bytes: Some(CONTAINER_LIFECYCLE_OUTPUT_BYTES),
                },
            )
            .await?;
        if !output.success {
            return Err(AppError::Docker(format!(
                "容器{}失败: {}",
                lifecycle_action_label(action),
                first_non_empty(&output.stderr, &output.stdout)
            )));
        }

        Ok(DockerContainerLifecycleResult {
            action,
            container_id,
            host_id,
            output: first_non_empty(&output.stdout, &output.stderr).to_owned(),
            runtime: request.runtime,
            success: true,
        })
    }

    /// 读取容器 inspect 摘要。
    pub async fn inspect_container(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerInfoRequest,
    ) -> AppResult<DockerContainerInspectSummary> {
        let host_id = normalize_required("SSH 主机 id", &request.host_id)?;
        let container_id = normalize_required("容器 id", &request.container_id)?;
        let command = build_container_inspect_script(request.runtime, &container_id);
        let output = ssh_commands
            .execute_native(
                paths,
                SshCommandRequest {
                    host_id: host_id.clone(),
                    command,
                    timeout_seconds: Some(CONTAINER_INSPECT_TIMEOUT_SECONDS),
                    max_output_bytes: Some(CONTAINER_INSPECT_OUTPUT_BYTES),
                },
            )
            .await?;
        if !output.success {
            return Err(AppError::Docker(format!(
                "容器详情读取失败: {}",
                first_non_empty(&output.stderr, &output.stdout)
            )));
        }

        parse_container_inspect_summary(&host_id, &container_id, request.runtime, &output.stdout)
    }

    /// 读取容器最近日志。
    pub async fn tail_container_logs(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerLogsRequest,
    ) -> AppResult<DockerContainerLogsResult> {
        let host_id = normalize_required("SSH 主机 id", &request.host_id)?;
        let container_id = normalize_required("容器 id", &request.container_id)?;
        let tail = request
            .tail
            .unwrap_or(DEFAULT_CONTAINER_LOG_TAIL)
            .clamp(1, MAX_CONTAINER_LOG_TAIL);
        let command = build_container_logs_script(request.runtime, &container_id, tail);
        let output = ssh_commands
            .execute_native(
                paths,
                SshCommandRequest {
                    host_id: host_id.clone(),
                    command,
                    timeout_seconds: Some(CONTAINER_LOGS_TIMEOUT_SECONDS),
                    max_output_bytes: Some(CONTAINER_LOGS_OUTPUT_BYTES),
                },
            )
            .await?;
        if !output.success {
            return Err(AppError::Docker(format!(
                "容器日志读取失败: {}",
                first_non_empty(&output.stderr, &output.stdout)
            )));
        }

        Ok(DockerContainerLogsResult {
            container_id,
            host_id,
            logs: first_non_empty(&output.stdout, &output.stderr).to_owned(),
            runtime: request.runtime,
            tail,
        })
    }

    /// 读取容器一次性 stats。
    pub async fn container_stats(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerStatsRequest,
    ) -> AppResult<DockerContainerStatsResult> {
        let host_id = normalize_required("SSH 主机 id", &request.host_id)?;
        let container_id = normalize_required("容器 id", &request.container_id)?;
        let command = build_container_stats_script(request.runtime, &container_id);
        let output = ssh_commands
            .execute_native(
                paths,
                SshCommandRequest {
                    host_id: host_id.clone(),
                    command,
                    timeout_seconds: Some(CONTAINER_STATS_TIMEOUT_SECONDS),
                    max_output_bytes: Some(CONTAINER_STATS_OUTPUT_BYTES),
                },
            )
            .await?;
        if !output.success {
            return Err(AppError::Docker(format!(
                "容器监控读取失败: {}",
                first_non_empty(&output.stderr, &output.stdout)
            )));
        }

        Ok(parse_container_stats_output(
            &host_id,
            &container_id,
            request.runtime,
            &output.stdout,
        ))
    }
}
