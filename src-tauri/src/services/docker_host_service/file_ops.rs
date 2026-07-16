//! 容器目录、预览和可变文件操作。

use super::*;

impl DockerHostService {
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

        let host = resolve_host(remote_hosts, paths, ssh_commands, &request.host_id)?;
        let temp_path = write_temp_container_text_file(&request.content)?;
        let upload_request = DockerContainerTransferRequest {
            host_id: request.host_id.clone(),
            container_id: request.container_id.clone(),
            runtime: request.runtime,
            remote_path: request.path.clone(),
            local_path: temp_path.to_string_lossy().into_owned(),
            kind: SftpTransferKind::File,
        };
        let upload_result = upload_to_container(paths, ssh_commands, &host, upload_request).await;
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
}
