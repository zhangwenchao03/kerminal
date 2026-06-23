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
        structured_result: Some(json!({
            "hostId": host.id,
            "host": {
                "id": host.id,
                "name": host.name,
                "host": host.host,
                "port": host.port,
                "username": host.username,
                "production": host.production,
            },
            "clientAction": "sshConnect",
        })),
        entities: vec![json!({
            "type": "remoteHost",
            "id": host.id,
            "name": host.name,
            "host": host.host,
            "port": host.port,
            "username": host.username,
            "production": host.production,
        })],
        ..ToolExecutionResult::default()
    }
}

pub(super) fn execute_ssh_ensure_connected(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let Some(cols) = number_to_u16(arguments.get("cols")) else {
        return failure("cols 必须是 1 到 65535 的数字。");
    };
    let Some(rows) = number_to_u16(arguments.get("rows")) else {
        return failure("rows 必须是 1 到 65535 的数字。");
    };
    let host = match resolve_ssh_target_host(remote_hosts, storage, arguments) {
        Ok(host) => host,
        Err(result) => return result,
    };
    ssh_connect_execution_result(&host, cols, rows, "SSH 终端已准备打开")
}

#[allow(clippy::result_large_err)]
fn resolve_ssh_target_host(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> Result<RemoteHost, ToolExecutionResult> {
    let tree = remote_hosts
        .list_tree(storage)
        .map_err(|error| failure(error.to_string()))?;
    let hosts = tree
        .iter()
        .flat_map(|group| {
            group
                .hosts
                .iter()
                .map(|host| (group.id.as_str(), group.name.as_str(), host))
        })
        .collect::<Vec<_>>();
    let selector =
        SshTargetSelector::from_arguments(arguments).map_err(|error| ToolExecutionResult {
            status: AiToolInvocationStatus::Failed,
            error: Some(error.to_string()),
            error_kind: Some("missingTarget".to_owned()),
            recoverable: true,
            next_hints: vec![
                "提供 hostId，或提供 groupName/name/host/username/port 组合后重试。".to_owned(),
            ],
            ..ToolExecutionResult::default()
        })?;

    if let Some(host_id) = selector.host_id.as_deref() {
        return hosts
            .iter()
            .find(|(_, _, host)| host.id == host_id)
            .map(|(_, _, host)| (*host).clone())
            .ok_or_else(|| target_not_found_result(&format!("远程主机不存在: {host_id}"), &hosts));
    }

    let matches = hosts
        .iter()
        .filter(|(group_id, group_name, host)| selector.matches(group_id, group_name, host))
        .map(|(_, _, host)| (*host).clone())
        .collect::<Vec<_>>();

    match matches.as_slice() {
        [host] => Ok(host.clone()),
        [] => Err(target_not_found_result("未找到匹配的 SSH 主机。", &hosts)),
        _ => Err(ambiguous_target_result(&matches)),
    }
}

#[derive(Debug)]
struct SshTargetSelector {
    host_id: Option<String>,
    group_id: Option<String>,
    group_name: Option<String>,
    name: Option<String>,
    host: Option<String>,
    username: Option<String>,
    port: Option<u16>,
}

impl SshTargetSelector {
    fn from_arguments(arguments: &serde_json::Map<String, Value>) -> AppResult<Self> {
        let selector = Self {
            host_id: trimmed_optional_string_arg(arguments, "hostId")?,
            group_id: trimmed_optional_string_arg(arguments, "groupId")?,
            group_name: trimmed_optional_string_arg(arguments, "groupName")?,
            name: trimmed_optional_string_arg(arguments, "name")?,
            host: trimmed_optional_string_arg(arguments, "host")?,
            username: trimmed_optional_string_arg(arguments, "username")?,
            port: number_to_u16(arguments.get("port")),
        };
        if selector.host_id.is_none()
            && selector.group_id.is_none()
            && selector.group_name.is_none()
            && selector.name.is_none()
            && selector.host.is_none()
            && selector.username.is_none()
            && selector.port.is_none()
        {
            return Err(AppError::InvalidInput(
                "SSH 目标需要 hostId，或至少一个主机选择条件。".to_owned(),
            ));
        }
        Ok(selector)
    }

    fn matches(&self, group_id: &str, group_name: &str, host: &RemoteHost) -> bool {
        self.group_id
            .as_deref()
            .is_none_or(|expected| group_id == expected)
            && self
                .group_name
                .as_deref()
                .is_none_or(|expected| group_name.eq_ignore_ascii_case(expected))
            && self
                .name
                .as_deref()
                .is_none_or(|expected| host.name.eq_ignore_ascii_case(expected))
            && self
                .host
                .as_deref()
                .is_none_or(|expected| host.host.eq_ignore_ascii_case(expected))
            && self
                .username
                .as_deref()
                .is_none_or(|expected| host.username.eq_ignore_ascii_case(expected))
            && self.port.is_none_or(|expected| host.port == expected)
    }
}

fn trimmed_optional_string_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<String>> {
    Ok(optional_string_arg(arguments, key)?
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty()))
}

fn target_not_found_result(
    message: &str,
    hosts: &[(&str, &str, &RemoteHost)],
) -> ToolExecutionResult {
    ToolExecutionResult {
        status: AiToolInvocationStatus::Failed,
        error: Some(message.to_owned()),
        structured_result: Some(json!({
            "candidateCount": hosts.len(),
            "candidates": hosts
                .iter()
                .take(10)
                .map(|(group_id, group_name, host)| ssh_target_candidate(group_id, group_name, host))
                .collect::<Vec<_>>(),
        })),
        entities: hosts
            .iter()
            .take(10)
            .map(|(group_id, group_name, host)| ssh_target_entity(group_id, group_name, host))
            .collect(),
        error_kind: Some("targetNotFound".to_owned()),
        recoverable: true,
        next_hints: vec![
            "先调用 remote_host.tree 查看可用主机，或改用 remote_host.ensure 创建/复用主机。"
                .to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

fn ambiguous_target_result(matches: &[RemoteHost]) -> ToolExecutionResult {
    ToolExecutionResult {
        status: AiToolInvocationStatus::Failed,
        error: Some(format!(
            "匹配到 {} 个 SSH 主机，请补充 hostId。",
            matches.len()
        )),
        structured_result: Some(json!({
            "candidateCount": matches.len(),
            "candidates": matches
                .iter()
                .take(10)
                .map(|host| {
                    json!({
                        "hostId": host.id,
                        "groupId": host.group_id,
                        "name": host.name,
                        "host": host.host,
                        "port": host.port,
                        "username": host.username,
                        "production": host.production,
                    })
                })
                .collect::<Vec<_>>(),
        })),
        entities: matches
            .iter()
            .take(10)
            .map(|host| {
                json!({
                    "type": "remoteHost",
                    "id": host.id,
                    "groupId": host.group_id,
                    "name": host.name,
                    "host": host.host,
                    "port": host.port,
                    "username": host.username,
                    "production": host.production,
                })
            })
            .collect(),
        error_kind: Some("ambiguousTarget".to_owned()),
        recoverable: true,
        next_hints: vec!["从 candidates 中选择一个 hostId 后重试。".to_owned()],
        ..ToolExecutionResult::default()
    }
}

fn ssh_connect_execution_result(
    host: &RemoteHost,
    cols: u16,
    rows: u16,
    action_label: &str,
) -> ToolExecutionResult {
    let production_label = if host.production {
        "，目标为生产主机"
    } else {
        ""
    };
    ToolExecutionResult {
        status: AiToolInvocationStatus::Succeeded,
        result_summary: Some(format!(
            "{action_label}：{}（{}@{}:{}{}），客户端将创建远程 tab。",
            host.name, host.username, host.host, host.port, production_label
        )),
        error: None,
        structured_result: Some(json!({
            "hostId": host.id,
            "host": {
                "id": host.id,
                "groupId": host.group_id,
                "name": host.name,
                "host": host.host,
                "port": host.port,
                "username": host.username,
                "production": host.production,
            },
            "clientAction": "sshConnect",
            "cols": cols,
            "rows": rows,
        })),
        entities: vec![json!({
            "type": "remoteHost",
            "id": host.id,
            "groupId": host.group_id,
            "name": host.name,
            "host": host.host,
            "port": host.port,
            "username": host.username,
            "production": host.production,
        })],
        ..ToolExecutionResult::default()
    }
}

fn ssh_target_candidate(group_id: &str, group_name: &str, host: &RemoteHost) -> Value {
    json!({
        "hostId": host.id,
        "groupId": group_id,
        "groupName": group_name,
        "name": host.name,
        "host": host.host,
        "port": host.port,
        "username": host.username,
        "production": host.production,
    })
}

fn ssh_target_entity(group_id: &str, group_name: &str, host: &RemoteHost) -> Value {
    json!({
        "type": "remoteHost",
        "id": host.id,
        "groupId": group_id,
        "groupName": group_name,
        "name": host.name,
        "host": host.host,
        "port": host.port,
        "username": host.username,
        "production": host.production,
    })
}

pub(super) async fn execute_ssh_command(
    ssh_commands: &SshCommandService,
    command_history: &CommandHistoryService,
    paths: &KerminalPaths,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match ssh_command_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    execute_ssh_command_request(ssh_commands, command_history, paths, storage, request, None).await
}

pub(super) async fn execute_ssh_command_on_resolved_host(
    ssh_commands: &SshCommandService,
    command_history: &CommandHistoryService,
    paths: &KerminalPaths,
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let host = match resolve_ssh_target_host(remote_hosts, storage, arguments) {
        Ok(host) => host,
        Err(result) => return result,
    };
    let request = match ssh_command_request_from_arguments_with_host_id(arguments, host.id.clone())
    {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    execute_ssh_command_request(
        ssh_commands,
        command_history,
        paths,
        storage,
        request,
        Some(&host),
    )
    .await
}

async fn execute_ssh_command_request(
    ssh_commands: &SshCommandService,
    command_history: &CommandHistoryService,
    paths: &KerminalPaths,
    storage: &SqliteStore,
    request: SshCommandRequest,
    resolved_host: Option<&RemoteHost>,
) -> ToolExecutionResult {
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

    match ssh_commands.execute_native(storage, paths, request).await {
        Ok(output) if output.success => {
            let _ = command_history.record_command(storage, history_request);
            ToolExecutionResult {
                status: AiToolInvocationStatus::Succeeded,
                result_summary: Some(summarize_ssh_command_output_for_ai(&output)),
                error: None,
                structured_result: Some(ssh_command_structured_result(&output, resolved_host)),
                entities: ssh_command_entities(&output, resolved_host),
                ..ToolExecutionResult::default()
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
                structured_result: Some(ssh_command_structured_result(&output, resolved_host)),
                entities: ssh_command_entities(&output, resolved_host),
                error_kind: Some("remoteCommandFailed".to_owned()),
                recoverable: true,
                next_hints: vec!["检查远程命令、权限和工作目录后重试。".to_owned()],
            }
        }
        Err(error) => ToolExecutionResult {
            status: AiToolInvocationStatus::Failed,
            error: Some(error.to_string()),
            entities: resolved_host
                .map(|host| vec![ssh_host_entity(host)])
                .unwrap_or_default(),
            error_kind: Some("remoteFailure".to_owned()),
            recoverable: true,
            next_hints: vec!["检查 SSH 主机、凭据、网络和主机密钥信任状态后重试。".to_owned()],
            ..ToolExecutionResult::default()
        },
    }
}

pub(super) fn ssh_command_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SshCommandRequest> {
    ssh_command_request_from_arguments_with_host_id(
        arguments,
        required_string_arg(arguments, "hostId")?,
    )
}

fn ssh_command_request_from_arguments_with_host_id(
    arguments: &serde_json::Map<String, Value>,
    host_id: String,
) -> AppResult<SshCommandRequest> {
    let command = required_string_arg(arguments, "command")?;
    Ok(SshCommandRequest {
        host_id,
        command: wrap_command_with_proxy_env(
            command,
            optional_string_arg(arguments, "proxyUrl")?,
            optional_string_arg(arguments, "proxyProtocol")?,
        )?,
        timeout_seconds: optional_u64_arg(arguments, "timeoutSeconds")?,
        max_output_bytes: optional_usize_arg(arguments, "maxOutputBytes")?,
    })
}

fn ssh_command_structured_result(
    output: &SshCommandOutput,
    resolved_host: Option<&RemoteHost>,
) -> Value {
    json!({
        "hostId": output.host_id,
        "groupId": resolved_host.and_then(|host| host.group_id.clone()),
        "host": resolved_host
            .map(ssh_host_details)
            .unwrap_or_else(|| json!({
                "id": output.host_id,
                "name": output.host_name,
                "host": output.host,
                "port": output.port,
                "username": output.username,
            })),
        "command": {
            "maxOutputBytes": output.max_output_bytes,
        },
        "output": {
            "success": output.success,
            "exitCode": output.exit_code,
            "stdout": output.stdout,
            "stderr": output.stderr,
            "stdoutBytes": output.stdout_bytes,
            "stderrBytes": output.stderr_bytes,
            "stdoutTruncated": output.stdout_truncated,
            "stderrTruncated": output.stderr_truncated,
            "durationMs": output.duration_ms,
        },
    })
}

fn ssh_command_entities(
    output: &SshCommandOutput,
    resolved_host: Option<&RemoteHost>,
) -> Vec<Value> {
    match resolved_host {
        Some(host) => vec![ssh_host_entity(host)],
        None => vec![json!({
            "type": "remoteHost",
            "id": output.host_id,
            "name": output.host_name,
            "host": output.host,
            "port": output.port,
            "username": output.username,
        })],
    }
}

fn ssh_host_details(host: &RemoteHost) -> Value {
    json!({
        "id": host.id,
        "groupId": host.group_id,
        "name": host.name,
        "host": host.host,
        "port": host.port,
        "username": host.username,
        "production": host.production,
    })
}

fn ssh_host_entity(host: &RemoteHost) -> Value {
    json!({
        "type": "remoteHost",
        "id": host.id,
        "groupId": host.group_id,
        "name": host.name,
        "host": host.host,
        "port": host.port,
        "username": host.username,
        "production": host.production,
    })
}

fn wrap_command_with_proxy_env(
    command: String,
    proxy_url: Option<String>,
    proxy_protocol: Option<String>,
) -> AppResult<String> {
    let Some(proxy_url) = proxy_url else {
        return Ok(command);
    };
    validate_proxy_url(&proxy_url)?;
    let protocol = proxy_protocol.unwrap_or_else(|| {
        if proxy_url.starts_with("socks5h://") {
            "socks5".to_owned()
        } else {
            "http".to_owned()
        }
    });
    let quoted_proxy = shell_quote(&proxy_url);
    let quoted_no_proxy = shell_quote("localhost,127.0.0.1");
    let exports = match protocol.as_str() {
        "http" => vec![
            format!("export HTTP_PROXY={quoted_proxy}"),
            format!("export HTTPS_PROXY={quoted_proxy}"),
            format!("export http_proxy={quoted_proxy}"),
            format!("export https_proxy={quoted_proxy}"),
            format!("export NO_PROXY={quoted_no_proxy}"),
            format!("export no_proxy={quoted_no_proxy}"),
        ],
        "socks5" => vec![
            format!("export ALL_PROXY={quoted_proxy}"),
            format!("export all_proxy={quoted_proxy}"),
            format!("export NO_PROXY={quoted_no_proxy}"),
            format!("export no_proxy={quoted_no_proxy}"),
        ],
        _ => {
            return Err(AppError::InvalidInput(
                "proxyProtocol 只支持 http 或 socks5。".to_owned(),
            ));
        }
    };

    Ok(format!("{}\n{}", exports.join("\n"), command))
}

fn validate_proxy_url(proxy_url: &str) -> AppResult<()> {
    if proxy_url.contains('\0') || proxy_url.contains('\n') || proxy_url.contains('\r') {
        return Err(AppError::InvalidInput(
            "proxyUrl 不能包含控制字符。".to_owned(),
        ));
    }
    if proxy_url.starts_with("http://")
        || proxy_url.starts_with("https://")
        || proxy_url.starts_with("socks5h://")
    {
        return Ok(());
    }
    Err(AppError::InvalidInput(
        "proxyUrl 只支持 http://、https:// 或 socks5h://。".to_owned(),
    ))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn wraps_ai_ssh_command_with_http_proxy_exports() {
        let arguments = json!({
            "hostId": "host-a",
            "command": "curl -I https://example.com",
            "proxyUrl": "http://127.0.0.1:18080",
            "proxyProtocol": "http"
        });
        let arguments = arguments.as_object().expect("object args");

        let request = ssh_command_request_from_arguments(arguments).expect("parse ssh command");

        assert_eq!(request.host_id, "host-a");
        assert!(request
            .command
            .starts_with("export HTTP_PROXY='http://127.0.0.1:18080'\n"));
        assert!(request
            .command
            .contains("export HTTPS_PROXY='http://127.0.0.1:18080'\n"));
        assert!(request.command.ends_with("curl -I https://example.com"));
    }

    #[test]
    fn wraps_ai_ssh_command_with_socks_proxy_exports() {
        let arguments = json!({
            "hostId": "host-a",
            "command": "git ls-remote origin",
            "proxyUrl": "socks5h://127.0.0.1:18080"
        });
        let arguments = arguments.as_object().expect("object args");

        let request = ssh_command_request_from_arguments(arguments).expect("parse ssh command");

        assert!(request
            .command
            .starts_with("export ALL_PROXY='socks5h://127.0.0.1:18080'\n"));
        assert!(request.command.ends_with("git ls-remote origin"));
    }

    #[test]
    fn rejects_invalid_ai_ssh_command_proxy_url() {
        let arguments = json!({
            "hostId": "host-a",
            "command": "curl example.com",
            "proxyUrl": "file:///tmp/proxy"
        });
        let arguments = arguments.as_object().expect("object args");

        let error = ssh_command_request_from_arguments(arguments).expect_err("invalid proxy url");

        assert!(error.to_string().contains("proxyUrl 只支持"));
    }
}
