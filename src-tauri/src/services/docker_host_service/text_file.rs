use super::*;

pub struct ContainerTextMetadata {
    pub modified: Option<String>,
    pub permissions: Option<String>,
    pub permissions_mode: Option<u32>,
    pub size: u64,
}

pub(super) async fn read_container_text_file(
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    request: DockerContainerReadTextFileRequest,
) -> AppResult<DockerContainerReadTextFileResponse> {
    let max_bytes = request.max_bytes.unwrap_or(DEFAULT_TEXT_FILE_BYTES);
    let read_limit = max_bytes.saturating_add(1);
    let read_args = [request.path.clone(), read_limit.to_string()];
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
mode=$(stat -c '%a' "$target" 2>/dev/null || printf '')
mtime=$(stat -c '%Y' "$target" 2>/dev/null || printf '')
perms=$(ls -ld "$target" 2>/dev/null | awk '{print $1}' || printf '')
printf '__KERMINAL_TEXT:%s:%s:%s:%s__\n' "$bytes" "$mode" "$mtime" "$perms"
dd if="$target" bs=1 count="$max_bytes" 2>/dev/null
"#,
            args: &read_args,
            timeout_seconds: CONTAINER_FILE_TIMEOUT_SECONDS,
            max_output_bytes: read_limit
                .saturating_add(1024)
                .min(MAX_TEXT_FILE_BYTES.saturating_add(1024)),
        },
    )
    .await?;
    let (metadata, content) = split_text_output(&output.stdout)?;
    let (content, content_limited) = limit_text_content(&content, max_bytes);
    let binary = is_binary_bytes(content.as_bytes());
    if binary {
        return Err(AppError::Docker(format!(
            "容器文件包含二进制内容，暂不支持作为文本编辑: {}",
            request.path
        )));
    }
    let bytes_read = content.len();
    let truncated = content_limited || output.stdout_truncated || metadata.size > bytes_read as u64;

    Ok(DockerContainerReadTextFileResponse {
        host_id: request.host_id,
        container_id: request.container_id,
        path: request.path,
        bytes_read,
        max_bytes,
        truncated,
        encoding: "utf-8-lossy".to_owned(),
        line_ending: detect_line_ending(&content),
        revision: SftpFileRevision {
            size: metadata.size,
            modified: metadata.modified,
            permissions: metadata.permissions,
            permissions_mode: metadata.permissions_mode,
            content_sha256: Some(sha256_hex(content.as_bytes())),
        },
        binary,
        readonly: false,
        content,
    })
}

pub(super) async fn container_file_revision(
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    request: &DockerContainerWriteTextFileRequest,
) -> AppResult<SftpFileRevision> {
    let response = read_container_text_file(
        paths,
        ssh_commands,
        DockerContainerReadTextFileRequest {
            host_id: request.host_id.clone(),
            container_id: request.container_id.clone(),
            runtime: request.runtime,
            path: request.path.clone(),
            max_bytes: Some(MAX_TEXT_FILE_BYTES),
        },
    )
    .await?;
    Ok(response.revision)
}

pub fn split_text_output(output: &str) -> AppResult<(ContainerTextMetadata, String)> {
    let marker_prefix = "__KERMINAL_TEXT:";
    let Some((marker, content)) = output.split_once('\n') else {
        return Err(AppError::Docker(
            "容器文本文件读取输出缺少元数据标记".to_owned(),
        ));
    };
    let marker = marker
        .strip_prefix(marker_prefix)
        .and_then(|value| value.strip_suffix("__"))
        .ok_or_else(|| AppError::Docker("容器文本文件元数据格式无效".to_owned()))?;
    let mut fields = marker.splitn(4, ':');
    let size = fields
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| AppError::Docker("容器文本文件缺少大小元数据".to_owned()))?;
    let permissions_mode = fields.next().and_then(parse_octal_permissions);
    let modified = fields
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let permissions = fields
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    Ok((
        ContainerTextMetadata {
            modified,
            permissions,
            permissions_mode,
            size,
        },
        content.to_owned(),
    ))
}

pub(super) fn parse_octal_permissions(value: &str) -> Option<u32> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    u32::from_str_radix(value, 8).ok()
}

pub(super) fn limit_text_content(content: &str, max_bytes: usize) -> (String, bool) {
    if content.len() <= max_bytes {
        return (content.to_owned(), false);
    }
    let bytes = content.as_bytes();
    (
        String::from_utf8_lossy(&bytes[..max_bytes]).into_owned(),
        true,
    )
}

pub(super) fn validate_text_encoding(encoding: &str) -> AppResult<()> {
    match encoding {
        "utf-8" | "utf-8-lossy" => Ok(()),
        _ => Err(AppError::InvalidInput(format!(
            "暂不支持的文本编码: {encoding}"
        ))),
    }
}

pub fn same_revision(expected: &SftpFileRevision, current: &SftpFileRevision) -> bool {
    match (&expected.content_sha256, &current.content_sha256) {
        (Some(expected_hash), Some(current_hash)) => expected_hash == current_hash,
        _ => expected.size == current.size && expected.modified == current.modified,
    }
}

pub(super) fn is_binary_bytes(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn detect_line_ending(content: &str) -> String {
    let crlf = content.matches("\r\n").count();
    let lf = content.matches('\n').count().saturating_sub(crlf);
    match (crlf > 0, lf > 0) {
        (true, true) => "mixed",
        (true, false) => "crlf",
        _ => "lf",
    }
    .to_owned()
}

pub(super) fn write_temp_container_text_file(content: &str) -> AppResult<PathBuf> {
    let temp_path =
        std::env::temp_dir().join(format!("kerminal-container-text-{}.tmp", Uuid::new_v4()));
    fs::write(&temp_path, content.as_bytes())?;
    Ok(temp_path)
}
