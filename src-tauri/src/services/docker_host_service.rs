//! SSH 宿主上的 Docker/Podman 容器服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::{
        docker::{
            DockerComposeMetadata, DockerComposeRuntimeFamily, DockerContainerChmodRequest,
            DockerContainerDeleteRequest, DockerContainerDirectoryListing,
            DockerContainerFilePreview, DockerContainerInfoRequest, DockerContainerInspectSummary,
            DockerContainerLifecycleAction, DockerContainerLifecycleRequest,
            DockerContainerLifecycleResult, DockerContainerListRequest, DockerContainerLogsRequest,
            DockerContainerLogsResult, DockerContainerPathRequest, DockerContainerPreviewRequest,
            DockerContainerReadTextFileRequest, DockerContainerReadTextFileResponse,
            DockerContainerRenameRequest, DockerContainerStatsRequest, DockerContainerStatsResult,
            DockerContainerStatus, DockerContainerSummary, DockerContainerTerminalCreateRequest,
            DockerContainerTransferRequest, DockerContainerWriteTextFileRequest,
            DockerContainerWriteTextFileResponse,
        },
        remote_host::RemoteHost,
        sftp::{SftpEntry, SftpEntryKind, SftpFileRevision, SftpTransferKind},
        ssh_command::SshCommandRequest,
        target::{ContainerRuntime, RemoteTargetRef, TargetCapabilities},
        terminal::{
            SshTerminalCreateRequest, TerminalCreateRequest, TerminalOutputEvent,
            TerminalSessionSummary,
        },
    },
    paths::KerminalPaths,
    services::{
        remote_host_service::RemoteHostService, ssh_command_service::SshCommandService,
        ssh_terminal_service::SshTerminalService, terminal_manager::TerminalManager,
    },
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File as StdFile},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
};
use tar::{Archive, Builder};
use uuid::Uuid;

const CONTAINER_LIST_TIMEOUT_SECONDS: u64 = 20;
const CONTAINER_LIST_OUTPUT_BYTES: usize = 128 * 1024;
const CONTAINER_LIFECYCLE_TIMEOUT_SECONDS: u64 = 30;
const CONTAINER_LIFECYCLE_OUTPUT_BYTES: usize = 64 * 1024;
const CONTAINER_INSPECT_TIMEOUT_SECONDS: u64 = 20;
const CONTAINER_INSPECT_OUTPUT_BYTES: usize = 512 * 1024;
const CONTAINER_LOGS_TIMEOUT_SECONDS: u64 = 20;
const CONTAINER_LOGS_OUTPUT_BYTES: usize = 256 * 1024;
const CONTAINER_STATS_TIMEOUT_SECONDS: u64 = 20;
const CONTAINER_STATS_OUTPUT_BYTES: usize = 64 * 1024;
const DEFAULT_CONTAINER_LOG_TAIL: u16 = 200;
const MAX_CONTAINER_LOG_TAIL: u16 = 1000;
const CONTAINER_FILE_TIMEOUT_SECONDS: u64 = 30;
const CONTAINER_FILE_OUTPUT_BYTES: usize = 512 * 1024;
const DEFAULT_PREVIEW_BYTES: usize = 64 * 1024;
const MAX_PREVIEW_BYTES: usize = 1024 * 1024;
const DEFAULT_TEXT_FILE_BYTES: usize = 10 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES: usize = 10 * 1024 * 1024;

mod helpers;
mod normalization;
mod parsing;
mod script;
mod terminal_request;
mod text_file;
mod transfer;

#[doc(hidden)]
pub mod rules {
    pub use super::parsing::{
        merge_container_summary_labels, parse_compose_metadata,
        parse_container_label_inspect_output, parse_container_list_output, parse_ls_entries,
        split_preview_output,
    };
    pub use super::script::{
        build_container_exec_script, build_container_inspect_script,
        build_container_label_inspect_script, build_container_lifecycle_script,
        build_container_logs_script, build_container_stats_script,
    };
    pub use super::terminal_request::{
        build_container_terminal_remote_command, build_container_terminal_request,
    };
    pub use super::text_file::{detect_line_ending, same_revision, split_text_output};
    pub use super::transfer::{extract_first_file, write_tar_stream};
    pub use super::{parse_container_inspect_summary, parse_container_stats_output};
}

use self::{
    helpers::{
        field_string, first_csv_value, first_non_empty, normalize_optional, normalize_required,
        shell_quote, short_container_id,
    },
    normalization::{
        ensure_not_root_for_write, normalize_chmod_request, normalize_delete_request,
        normalize_path_request, normalize_preview_request, normalize_read_text_file_request,
        normalize_rename_request, normalize_transfer_request, normalize_write_text_file_request,
        parent_remote_path, remote_file_name,
    },
    parsing::{
        container_summary_needs_label_inspect, merge_container_summary_labels,
        parse_container_label_inspect_output, parse_container_list_output, parse_ls_entries,
        split_preview_output,
    },
    script::{
        build_container_inspect_script, build_container_label_inspect_script,
        build_container_lifecycle_script, build_container_list_script, build_container_logs_script,
        build_container_stats_script, execute_container_script, ContainerScriptRequest,
    },
    terminal_request::{
        auth_args, build_container_terminal_remote_command, resolve_host, resolve_ssh_executable,
    },
    text_file::{
        container_file_revision, detect_line_ending, read_container_text_file, same_revision,
        validate_text_encoding, write_temp_container_text_file,
    },
    transfer::{download_from_container, upload_to_container},
};

pub(crate) use self::script::build_container_exec_script;

/// Docker/Podman 容器业务入口。
#[derive(Debug, Default)]
pub struct DockerHostService;

impl DockerHostService {
    /// 创建容器服务。
    pub fn new() -> Self {
        Self
    }

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

    /// 创建指定容器的交互式终端会话。
    pub fn create_container_session<F>(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        ssh_terminals: &SshTerminalService,
        terminals: &TerminalManager,
        request: DockerContainerTerminalCreateRequest,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        let terminal_request = self.resolve_container_ssh_terminal_request(request)?;
        ssh_terminals.create_session(remote_hosts, paths, terminals, terminal_request, output)
    }

    /// 列出容器内目录。
    pub async fn list_directory(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerPathRequest,
    ) -> AppResult<DockerContainerDirectoryListing> {
        let request = normalize_path_request(request)?;
        let output = execute_container_script(
            paths,
            ssh_commands,
            ContainerScriptRequest {
                host_id: &request.host_id,
                runtime: request.runtime,
                container_id: &request.container_id,
                inner_script: r#"target=$1
if [ ! -d "$target" ]; then
  echo "not a directory: $target" >&2
  exit 66
fi
cd "$target" || exit 66
LC_ALL=C ls -la
"#,
                args: std::slice::from_ref(&request.path),
                timeout_seconds: CONTAINER_FILE_TIMEOUT_SECONDS,
                max_output_bytes: CONTAINER_FILE_OUTPUT_BYTES,
            },
        )
        .await?;
        let entries = parse_ls_entries(&request.path, &output.stdout)?;

        Ok(DockerContainerDirectoryListing {
            host_id: request.host_id,
            container_id: request.container_id,
            parent_path: parent_remote_path(&request.path),
            path: request.path,
            entries,
        })
    }

    /// 预览容器内文本文件。
    pub async fn preview_file(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerPreviewRequest,
    ) -> AppResult<DockerContainerFilePreview> {
        let request = normalize_preview_request(request)?;
        let max_bytes = request.max_bytes.unwrap_or(DEFAULT_PREVIEW_BYTES);
        let preview_args = [request.path.clone(), max_bytes.to_string()];
        let output = execute_container_script(
            paths,
            ssh_commands,
            ContainerScriptRequest {
                host_id: &request.host_id,
                runtime: request.runtime,
                container_id: &request.container_id,
                inner_script: r#"target=$1
max_bytes=$2
if [ ! -f "$target" ]; then
  echo "not a regular file: $target" >&2
  exit 66
fi
bytes=$(wc -c < "$target" | tr -d ' ')
printf '__KERMINAL_BYTES:%s__\n' "$bytes"
dd if="$target" bs=1 count="$max_bytes" 2>/dev/null
"#,
                args: &preview_args,
                timeout_seconds: CONTAINER_FILE_TIMEOUT_SECONDS,
                max_output_bytes: max_bytes.saturating_add(512).min(MAX_PREVIEW_BYTES + 512),
            },
        )
        .await?;
        let (content, bytes_read, total_bytes) = split_preview_output(&output.stdout)?;

        Ok(DockerContainerFilePreview {
            host_id: request.host_id,
            container_id: request.container_id,
            path: request.path,
            content,
            bytes_read,
            max_bytes,
            truncated: total_bytes.map(|size| size > bytes_read).unwrap_or(false),
            encoding: "utf-8-lossy".to_owned(),
        })
    }

    /// 读取容器内文本文件供工作区编辑器使用。
    pub async fn read_text_file(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerReadTextFileRequest,
    ) -> AppResult<DockerContainerReadTextFileResponse> {
        let request = normalize_read_text_file_request(request)?;
        read_container_text_file(paths, ssh_commands, request).await
    }

    /// 写入容器内文本文件供工作区编辑器使用。
    pub async fn write_text_file(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerWriteTextFileRequest,
    ) -> AppResult<DockerContainerWriteTextFileResponse> {
        let request = normalize_write_text_file_request(request)?;
        ensure_not_root_for_write(&request.path)?;
        validate_text_encoding(&request.encoding)?;

        if request.create && !request.overwrite_on_conflict {
            if let Ok(existing_revision) =
                container_file_revision(paths, ssh_commands, &request).await
            {
                return Err(AppError::Docker(format!(
                    "容器文件已存在，不能按新建方式覆盖: {} ({:?})",
                    request.path, existing_revision.modified
                )));
            }
        }

        let current_revision =
            if request.expected_revision.is_some() || request.overwrite_on_conflict {
                container_file_revision(paths, ssh_commands, &request)
                    .await
                    .ok()
            } else {
                None
            };

        if !request.overwrite_on_conflict {
            if let (Some(expected), Some(current)) = (
                request.expected_revision.as_ref(),
                current_revision.as_ref(),
            ) {
                if !same_revision(expected, current) {
                    return Err(AppError::Docker(
                        "容器文件已变更，请重新加载或选择覆盖后再保存".to_owned(),
                    ));
                }
            }
        }

        let host = resolve_host(remote_hosts, &request.host_id)?;
        let temp_path = write_temp_container_text_file(&request.content)?;
        let upload_request = DockerContainerTransferRequest {
            host_id: request.host_id.clone(),
            container_id: request.container_id.clone(),
            runtime: request.runtime,
            remote_path: request.path.clone(),
            local_path: temp_path.to_string_lossy().into_owned(),
            kind: SftpTransferKind::File,
        };
        let upload_result = upload_to_container(&host, upload_request);
        let _ = fs::remove_file(&temp_path);
        upload_result?;

        let revision = container_file_revision(paths, ssh_commands, &request).await?;
        Ok(DockerContainerWriteTextFileResponse {
            host_id: request.host_id,
            container_id: request.container_id,
            path: request.path,
            bytes_written: request.content.len(),
            encoding: "utf-8".to_owned(),
            line_ending: detect_line_ending(&request.content),
            revision,
        })
    }

    /// 创建容器内目录。
    pub async fn create_directory(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerPathRequest,
    ) -> AppResult<bool> {
        let request = normalize_path_request(request)?;
        ensure_not_root_for_write(&request.path)?;
        execute_container_script(
            paths,
            ssh_commands,
            ContainerScriptRequest {
                host_id: &request.host_id,
                runtime: request.runtime,
                container_id: &request.container_id,
                inner_script: r#"target=$1
mkdir -p "$target"
"#,
                args: &[request.path],
                timeout_seconds: CONTAINER_FILE_TIMEOUT_SECONDS,
                max_output_bytes: CONTAINER_FILE_OUTPUT_BYTES,
            },
        )
        .await?;
        Ok(true)
    }

    /// 删除容器内路径。
    pub async fn delete_path(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerDeleteRequest,
    ) -> AppResult<bool> {
        let request = normalize_delete_request(request)?;
        ensure_not_root_for_write(&request.path)?;
        let script = if request.directory {
            r#"target=$1
rm -rf "$target"
"#
        } else {
            r#"target=$1
rm -f "$target"
"#
        };
        execute_container_script(
            paths,
            ssh_commands,
            ContainerScriptRequest {
                host_id: &request.host_id,
                runtime: request.runtime,
                container_id: &request.container_id,
                inner_script: script,
                args: &[request.path],
                timeout_seconds: CONTAINER_FILE_TIMEOUT_SECONDS,
                max_output_bytes: CONTAINER_FILE_OUTPUT_BYTES,
            },
        )
        .await?;
        Ok(true)
    }

    /// 重命名容器内路径。
    pub async fn rename_path(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerRenameRequest,
    ) -> AppResult<bool> {
        let request = normalize_rename_request(request)?;
        ensure_not_root_for_write(&request.from_path)?;
        ensure_not_root_for_write(&request.to_path)?;
        let rename_args = [request.from_path, request.to_path];
        execute_container_script(
            paths,
            ssh_commands,
            ContainerScriptRequest {
                host_id: &request.host_id,
                runtime: request.runtime,
                container_id: &request.container_id,
                inner_script: r#"from_path=$1
to_path=$2
mv "$from_path" "$to_path"
"#,
                args: &rename_args,
                timeout_seconds: CONTAINER_FILE_TIMEOUT_SECONDS,
                max_output_bytes: CONTAINER_FILE_OUTPUT_BYTES,
            },
        )
        .await?;
        Ok(true)
    }

    /// 修改容器内路径权限。
    pub async fn chmod_path(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerChmodRequest,
    ) -> AppResult<bool> {
        let request = normalize_chmod_request(request)?;
        ensure_not_root_for_write(&request.path)?;
        let chmod_args = [request.path, request.mode];
        execute_container_script(
            paths,
            ssh_commands,
            ContainerScriptRequest {
                host_id: &request.host_id,
                runtime: request.runtime,
                container_id: &request.container_id,
                inner_script: r#"target=$1
mode=$2
chmod "$mode" "$target"
"#,
                args: &chmod_args,
                timeout_seconds: CONTAINER_FILE_TIMEOUT_SECONDS,
                max_output_bytes: CONTAINER_FILE_OUTPUT_BYTES,
            },
        )
        .await?;
        Ok(true)
    }

    /// 上传本地文件或目录到容器。
    pub fn upload(
        &self,
        remote_hosts: &RemoteHostService,
        request: DockerContainerTransferRequest,
    ) -> AppResult<bool> {
        let request = normalize_transfer_request(request)?;
        ensure_not_root_for_write(&request.remote_path)?;
        let host = resolve_host(remote_hosts, &request.host_id)?;
        upload_to_container(&host, request)?;
        Ok(true)
    }

    /// 下载容器内文件或目录到本地。
    pub fn download(
        &self,
        remote_hosts: &RemoteHostService,
        request: DockerContainerTransferRequest,
    ) -> AppResult<bool> {
        let request = normalize_transfer_request(request)?;
        let host = resolve_host(remote_hosts, &request.host_id)?;
        download_from_container(&host, request)?;
        Ok(true)
    }

    /// 将容器目标解析为普通 SSH 终端启动请求，复用 SSH 密码/私钥/跳板链。
    pub fn resolve_container_ssh_terminal_request(
        &self,
        request: DockerContainerTerminalCreateRequest,
    ) -> AppResult<SshTerminalCreateRequest> {
        let host_id = request.host_id.clone();
        let rows = request.rows;
        let cols = request.cols;
        let remote_command = build_container_terminal_remote_command(request)?;

        Ok(SshTerminalCreateRequest {
            host_id,
            cwd: None,
            remote_command: Some(remote_command),
            cols,
            rows,
        })
    }
}

fn lifecycle_action_label(action: DockerContainerLifecycleAction) -> &'static str {
    match action {
        DockerContainerLifecycleAction::Start => "启动",
        DockerContainerLifecycleAction::Stop => "停止",
        DockerContainerLifecycleAction::Restart => "重启",
        DockerContainerLifecycleAction::Remove => "删除",
    }
}

pub fn parse_container_inspect_summary(
    host_id: &str,
    container_id: &str,
    runtime: ContainerRuntime,
    output: &str,
) -> AppResult<DockerContainerInspectSummary> {
    let value: Value = serde_json::from_str(output.trim())?;
    let subject = value
        .as_array()
        .and_then(|items| items.first())
        .unwrap_or(&value);
    let name = json_string(subject.pointer("/Name"))
        .map(|value| value.trim_start_matches('/').to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| container_id.to_owned());
    let status = json_string(subject.pointer("/State/Status")).unwrap_or_else(|| "unknown".into());

    Ok(DockerContainerInspectSummary {
        command: json_array_strings(subject.pointer("/Config/Cmd")),
        container_id: container_id.to_owned(),
        created: json_string(subject.get("Created")),
        entrypoint: json_array_strings(subject.pointer("/Config/Entrypoint")),
        finished_at: json_string(subject.pointer("/State/FinishedAt")),
        host_id: host_id.to_owned(),
        id: json_string(subject.get("Id")).unwrap_or_else(|| container_id.to_owned()),
        image: json_string(subject.pointer("/Config/Image"))
            .or_else(|| json_string(subject.get("Image")))
            .unwrap_or_default(),
        labels: json_string_map(subject.pointer("/Config/Labels")),
        name,
        networks: json_object_keys(subject.pointer("/NetworkSettings/Networks")),
        ports: inspect_ports(subject.pointer("/NetworkSettings/Ports")),
        raw_json: serde_json::to_string_pretty(subject)
            .unwrap_or_else(|_| output.trim().to_owned()),
        running: json_bool(subject.pointer("/State/Running")).unwrap_or(false),
        runtime,
        started_at: json_string(subject.pointer("/State/StartedAt")),
        status,
        user: json_non_empty_string(subject.pointer("/Config/User")),
        working_dir: json_non_empty_string(subject.pointer("/Config/WorkingDir")),
    })
}

pub fn parse_container_stats_output(
    host_id: &str,
    container_id: &str,
    runtime: ContainerRuntime,
    output: &str,
) -> DockerContainerStatsResult {
    let trimmed = output.trim();
    let value = serde_json::from_str::<Value>(trimmed).ok();
    let subject = value.as_ref();

    DockerContainerStatsResult {
        block_io: first_json_field(subject, &["BlockIO", "BlockI", "blockIO", "block_io"]),
        container_id: container_id.to_owned(),
        cpu_percent: first_json_field(subject, &["CPUPerc", "CPU%", "cpuPercent", "cpu_percent"]),
        host_id: host_id.to_owned(),
        memory_percent: first_json_field(subject, &["MemPerc", "Mem%", "memoryPercent"]),
        memory_usage: first_json_field(subject, &["MemUsage", "Mem", "memoryUsage"]),
        network_io: first_json_field(subject, &["NetIO", "Net", "networkIO", "network_io"]),
        pids: first_json_field(subject, &["PIDs", "Pids", "pids"]),
        raw: trimmed.to_owned(),
        runtime,
    }
}

fn json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(|value| match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    })
}

fn json_non_empty_string(value: Option<&Value>) -> Option<String> {
    json_string(value).filter(|value| !value.trim().is_empty())
}

fn json_bool(value: Option<&Value>) -> Option<bool> {
    value.and_then(Value::as_bool)
}

fn json_array_strings(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| json_string(Some(item)))
            .collect(),
        Some(Value::String(text)) if !text.trim().is_empty() => vec![text.clone()],
        _ => Vec::new(),
    }
}

fn json_string_map(value: Option<&Value>) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    if let Some(Value::Object(map)) = value {
        for (key, value) in map {
            if let Some(text) = json_string(Some(value)) {
                values.insert(key.clone(), text);
            }
        }
    }
    values
}

fn json_object_keys(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Object(map)) => map.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

fn inspect_ports(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Object(ports)) = value else {
        return Vec::new();
    };
    let mut summaries = Vec::new();
    for (container_port, bindings) in ports {
        match bindings {
            Value::Array(items) if !items.is_empty() => {
                for binding in items {
                    let host_ip = json_string(binding.get("HostIp")).unwrap_or_default();
                    let host_port = json_string(binding.get("HostPort")).unwrap_or_default();
                    let host = match (host_ip.trim().is_empty(), host_port.trim().is_empty()) {
                        (true, true) => String::new(),
                        (true, false) => host_port,
                        (false, true) => host_ip,
                        (false, false) => format!("{host_ip}:{host_port}"),
                    };
                    summaries.push(if host.is_empty() {
                        container_port.clone()
                    } else {
                        format!("{host}->{container_port}")
                    });
                }
            }
            _ => summaries.push(container_port.clone()),
        }
    }
    summaries
}

fn first_json_field(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    let object = value.and_then(Value::as_object)?;
    keys.iter()
        .find_map(|key| json_non_empty_string(object.get(*key)))
}
