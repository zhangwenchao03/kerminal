use super::*;
use crate::models::remote_host::RemoteHostAuthType;

pub fn build_container_terminal_remote_command(
    request: DockerContainerTerminalCreateRequest,
) -> AppResult<String> {
    if request.rows == 0 || request.cols == 0 {
        return Err(AppError::InvalidInput(
            "终端行数和列数必须大于 0".to_owned(),
        ));
    }
    let container_id = normalize_required("容器 id", &request.container_id)?;
    let shell_script = normalize_container_shell(request.shell.as_deref())?;
    let mut remote_command = vec![
        request.runtime.as_str().to_owned(),
        "exec".to_owned(),
        "-it".to_owned(),
    ];
    if let Some(user) = normalize_optional("容器用户", request.user.as_deref())? {
        remote_command.push("--user".to_owned());
        remote_command.push(shell_quote(&user));
    }
    if let Some(workdir) = normalize_optional("容器工作目录", request.workdir.as_deref())? {
        remote_command.push("--workdir".to_owned());
        remote_command.push(shell_quote(&workdir));
    }
    remote_command.push(shell_quote(&container_id));
    remote_command.push("sh".to_owned());
    remote_command.push("-lc".to_owned());
    remote_command.push(shell_quote(&shell_script));

    Ok(remote_command.join(" "))
}

pub fn build_container_terminal_request(
    host: &RemoteHost,
    ssh_executable: String,
    request: DockerContainerTerminalCreateRequest,
) -> AppResult<TerminalCreateRequest> {
    let rows = request.rows;
    let cols = request.cols;
    let remote_command = build_container_terminal_remote_command(request)?;
    let mut args = vec![
        "-tt".to_owned(),
        "-p".to_owned(),
        host.port.to_string(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
        "-o".to_owned(),
        "ServerAliveCountMax=3".to_owned(),
    ];
    args.extend(auth_args(host.auth_type));
    args.push(format!("{}@{}", host.username, host.host));
    args.push(remote_command);

    Ok(TerminalCreateRequest {
        shell: Some(ssh_executable),
        args,
        cwd: None,
        cols,
        rows,
        env: Default::default(),
        cleanup_paths: Vec::new(),
    })
}

pub(super) fn normalize_container_shell(shell: Option<&str>) -> AppResult<String> {
    let fallback = "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh; fi";
    let shell = shell.map(str::trim).filter(|value| !value.is_empty());
    let value = shell.unwrap_or(fallback);
    if value.contains('\0') || value.contains('\r') {
        return Err(AppError::InvalidInput(
            "容器 shell 不能包含控制字符".to_owned(),
        ));
    }
    Ok(value.to_owned())
}

pub(super) fn auth_args(auth_type: RemoteHostAuthType) -> Vec<String> {
    let preferred = match auth_type {
        RemoteHostAuthType::Password => "password,keyboard-interactive",
        RemoteHostAuthType::Key => "publickey",
        RemoteHostAuthType::Agent => "publickey,keyboard-interactive,password",
    };

    vec![
        "-o".to_owned(),
        format!("PreferredAuthentications={preferred}"),
    ]
}

pub(super) fn resolve_host(
    remote_hosts: &RemoteHostService,
    host_id: &str,
) -> AppResult<RemoteHost> {
    remote_hosts.require_host(host_id)
}

pub(super) fn resolve_ssh_executable() -> AppResult<String> {
    which::which("ssh")
        .or_else(|_| which::which("ssh.exe"))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|_| {
            AppError::Terminal(
                "未找到 OpenSSH 客户端，请安装 ssh 或确认 ssh 已加入 PATH".to_owned(),
            )
        })
}
