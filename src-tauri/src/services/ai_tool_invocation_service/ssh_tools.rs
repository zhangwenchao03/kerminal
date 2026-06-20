use super::*;

pub(super) fn execute_ssh_connect(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let host_id = match required_string_arg(arguments, "hostId") {
        Ok(host_id) => host_id,
        Err(error) => return failure(error.to_string()),
    };
    if number_to_u16(arguments.get("cols")).is_none() {
        return failure("cols 必须是 1 到 65535 的数字。");
    }
    if number_to_u16(arguments.get("rows")).is_none() {
        return failure("rows 必须是 1 到 65535 的数字。");
    }

    let tree = match remote_hosts.list_tree(storage) {
        Ok(tree) => tree,
        Err(error) => return failure(error.to_string()),
    };
    let Some(host) = tree
        .iter()
        .flat_map(|group| group.hosts.iter())
        .find(|host| host.id == host_id)
    else {
        return failure(format!("远程主机不存在: {host_id}"));
    };
    let production_label = if host.production {
        "，目标为生产主机"
    } else {
        ""
    };

    ToolExecutionResult {
        status: AiToolInvocationStatus::Succeeded,
        result_summary: Some(format!(
            "SSH 终端已批准打开：{}（{}@{}:{}{}），客户端将创建远程 tab。",
            host.name, host.username, host.host, host.port, production_label
        )),
        error: None,
    }
}

pub(super) async fn execute_ssh_command(
    ssh_commands: &SshCommandService,
    command_history: &CommandHistoryService,
    credentials: &CredentialService,
    paths: &KerminalPaths,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match ssh_command_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let history_request = CommandHistoryRecordRequest {
        command: request.command.clone(),
        source: CommandHistorySource::Ai,
        target: CommandHistoryTarget::Ssh,
        record: None,
        session_id: None,
        pane_id: None,
        tab_id: None,
        profile_id: None,
        remote_host_id: Some(request.host_id.clone()),
        cwd: None,
        shell: Some("ssh".to_owned()),
    };

    match ssh_commands
        .execute_with_credentials(storage, credentials, paths, request)
        .await
    {
        Ok(output) if output.success => {
            let _ = command_history.record_command(storage, history_request);
            ToolExecutionResult {
                status: AiToolInvocationStatus::Succeeded,
                result_summary: Some(summarize_ssh_command_output_for_ai(&output)),
                error: None,
            }
        }
        Ok(output) => {
            let exit_code = output
                .exit_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "未知".to_owned());
            ToolExecutionResult {
                status: AiToolInvocationStatus::Failed,
                result_summary: Some(summarize_ssh_command_output_for_ai(&output)),
                error: Some(format!("远程命令退出码 {exit_code}")),
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn ssh_command_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SshCommandRequest> {
    Ok(SshCommandRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        command: required_string_arg(arguments, "command")?,
        timeout_seconds: optional_u64_arg(arguments, "timeoutSeconds")?,
        max_output_bytes: optional_usize_arg(arguments, "maxOutputBytes")?,
    })
}

/// 将远程命令执行输出压缩成 AI 工具审计摘要，避免记录完整 stdout/stderr。
pub fn summarize_ssh_command_output_for_ai(output: &SshCommandOutput) -> String {
    let exit_code = output
        .exit_code
        .map(|code| code.to_string())
        .unwrap_or_else(|| "未知".to_owned());
    let stdout = output_stream_summary(
        "stdout",
        &output.stdout,
        output.stdout_bytes,
        output.stdout_truncated,
    );
    let stderr = output_stream_summary(
        "stderr",
        &output.stderr,
        output.stderr_bytes,
        output.stderr_truncated,
    );

    format!(
        "远程命令已执行：{}（{}@{}:{}），退出码：{}，{}，{}，耗时：{} ms。",
        output.host_name,
        output.username,
        output.host,
        output.port,
        exit_code,
        stdout,
        stderr,
        output.duration_ms
    )
}

pub(super) fn output_stream_summary(
    label: &str,
    text: &str,
    bytes: usize,
    truncated: bool,
) -> String {
    let sample = text.lines().take(4).collect::<Vec<_>>().join(" ");
    let sample = collapse_whitespace(&sample);
    let sample = truncate_string(&sample);
    let (sample, redacted) = redact_terminal_text(&sample);
    let truncation_label = if truncated { "，已截断" } else { "" };
    let redaction_label = if redacted { "，已脱敏" } else { "" };

    if sample.is_empty() {
        format!("{label}：{bytes} 字节{truncation_label}{redaction_label}")
    } else {
        format!("{label}：{bytes} 字节{truncation_label}{redaction_label}，片段：{sample}")
    }
}
