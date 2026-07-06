use super::*;

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

pub(super) fn resolve_host(
    remote_hosts: &RemoteHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    host_id: &str,
) -> AppResult<RemoteHost> {
    if is_external_target_id(host_id) {
        return ssh_commands.resolve_native_runtime_host_metadata(paths, host_id);
    }
    remote_hosts.require_host(host_id)
}
