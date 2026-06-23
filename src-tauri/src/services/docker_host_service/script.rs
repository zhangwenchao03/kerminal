use super::*;

pub(super) fn build_container_list_script(
    runtime: ContainerRuntime,
    include_stopped: bool,
) -> String {
    let all_flag = if include_stopped { " -a" } else { "" };
    format!(
        r#"set -eu
runtime={runtime}
if ! command -v "$runtime" >/dev/null 2>&1; then
  echo "container runtime not found: $runtime" >&2
  exit 127
fi
"$runtime" ps{all_flag} --no-trunc --format '{{{{json .}}}}'
"#,
        runtime = shell_quote(runtime.as_str()),
        all_flag = all_flag,
    )
}

pub(super) struct ContainerScriptRequest<'a> {
    pub(super) host_id: &'a str,
    pub(super) runtime: ContainerRuntime,
    pub(super) container_id: &'a str,
    pub(super) inner_script: &'a str,
    pub(super) args: &'a [String],
    pub(super) timeout_seconds: u64,
    pub(super) max_output_bytes: usize,
}

pub(super) async fn execute_container_script(
    storage: &SqliteStore,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    request: ContainerScriptRequest<'_>,
) -> AppResult<crate::models::ssh_command::SshCommandOutput> {
    let host_id = normalize_required("SSH 主机 id", request.host_id)?;
    let container_id = normalize_required("容器 id", request.container_id)?;
    let command = build_container_exec_script(
        request.runtime,
        &container_id,
        request.inner_script,
        request.args,
    );
    let output = ssh_commands
        .execute_native(
            storage,
            paths,
            SshCommandRequest {
                host_id,
                command,
                timeout_seconds: Some(request.timeout_seconds),
                max_output_bytes: Some(request.max_output_bytes),
            },
        )
        .await?;
    if !output.success {
        return Err(AppError::Docker(format!(
            "容器命令执行失败: {}",
            first_non_empty(&output.stderr, &output.stdout)
        )));
    }
    Ok(output)
}

pub(crate) fn build_container_exec_script(
    runtime: ContainerRuntime,
    container_id: &str,
    inner_script: &str,
    args: &[String],
) -> String {
    let mut command = format!(
        r#"set -eu
runtime={runtime}
container={container}
if ! command -v "$runtime" >/dev/null 2>&1; then
  echo "container runtime not found: $runtime" >&2
  exit 127
fi
"$runtime" exec "$container" sh -lc {inner} sh"#,
        runtime = shell_quote(runtime.as_str()),
        container = shell_quote(container_id),
        inner = shell_quote(inner_script),
    );
    for arg in args {
        command.push(' ');
        command.push_str(&shell_quote(arg));
    }
    command.push('\n');
    command
}
