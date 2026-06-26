//! SSH 服务器信息采集服务。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    io::Write,
    process::Stdio,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType},
        server_info::{
            ServerDiskInfo, ServerGpuInfo, ServerInfoRequest, ServerInfoSnapshot,
            ServerNetworkInterfaceInfo, ServerProcessInfo,
        },
        ssh_command::SshCommandRequest,
        target::RemoteTargetRef,
    },
    paths::KerminalPaths,
    services::{
        docker_host_service::build_container_exec_script, process_command::silent_command,
        remote_host_service::RemoteHostService, ssh_command_service::SshCommandService,
    },
};

const SERVER_INFO_TIMEOUT: Duration = Duration::from_secs(15);
const SERVER_INFO_OUTPUT_BYTES: usize = 128 * 1024;

/// 服务器信息采集业务入口。
#[derive(Debug, Default)]
pub struct ServerInfoService;

impl ServerInfoService {
    /// 创建服务器信息服务。
    pub fn new() -> Self {
        Self
    }

    /// 采集当前 SSH 主机的系统信息快照。
    pub fn snapshot(
        &self,
        remote_hosts: &RemoteHostService,
        request: ServerInfoRequest,
    ) -> AppResult<ServerInfoSnapshot> {
        let target = Self::target_from_request(request)?;
        let host_id = target.host_id().ok_or_else(|| {
            AppError::InvalidInput("服务器信息目标必须是 SSH 主机或容器".to_owned())
        })?;
        let host = remote_hosts.require_host(host_id)?;
        self.snapshot_target(host, target)
    }

    /// 采集指定 SSH 主机的系统信息快照。
    pub fn snapshot_host(&self, host: RemoteHost) -> AppResult<ServerInfoSnapshot> {
        let target = RemoteTargetRef::Ssh {
            host_id: host.id.clone(),
        };
        self.snapshot_target(host, target)
    }

    /// 使用远程主机记录里的 SSH 认证信息采集 SSH 主机或容器目标的系统信息快照。
    pub async fn snapshot_native(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: ServerInfoRequest,
    ) -> AppResult<ServerInfoSnapshot> {
        let target = Self::target_from_request(request)?;
        let host_id = target.host_id().ok_or_else(|| {
            AppError::InvalidInput("服务器信息目标必须是 SSH 主机或容器".to_owned())
        })?;
        let host = remote_hosts.require_host(host_id)?;
        let command_request = build_server_info_command_request(&host, &target)?;
        let output = ssh_commands
            .execute_native(paths, command_request)
            .await
            .map_err(server_info_transport_error)?;

        if !output.success {
            return Err(server_info_command_failure(&output.stdout, &output.stderr));
        }

        let mut snapshot = parse_server_info_output(&host, &output.stdout, unix_timestamp());
        apply_target_metadata(&mut snapshot, &target);

        Ok(snapshot)
    }

    /// 采集指定统一目标的系统信息快照。
    pub fn snapshot_target(
        &self,
        host: RemoteHost,
        target: RemoteTargetRef,
    ) -> AppResult<ServerInfoSnapshot> {
        let plan = build_server_info_plan_for_target(&host, &target)?;
        let stdout = execute_server_info_plan(&plan)?;
        let mut snapshot = parse_server_info_output(&host, &stdout, unix_timestamp());
        apply_target_metadata(&mut snapshot, &target);

        Ok(snapshot)
    }

    /// 从 IPC 请求解析有效目标；兼容旧的仅 host_id 请求。
    pub fn target_from_request(request: ServerInfoRequest) -> AppResult<RemoteTargetRef> {
        let request_host_id = normalize_plain_text("远程主机 id", &request.host_id)?;
        let target = request.target.unwrap_or(RemoteTargetRef::Ssh {
            host_id: request_host_id.clone(),
        });
        target.validate()?;
        let target_host_id = target.host_id().ok_or_else(|| {
            AppError::InvalidInput("服务器信息目标必须是 SSH 主机或容器".to_owned())
        })?;
        if target_host_id != request_host_id {
            return Err(AppError::InvalidInput(
                "服务器信息目标主机和请求主机不一致".to_owned(),
            ));
        }
        Ok(target)
    }
}

/// 受控 SSH 命令计划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerInfoCommandPlan {
    /// SSH 可执行文件。
    pub executable: String,
    /// SSH 参数。
    pub args: Vec<String>,
    /// 远端执行脚本，通过 stdin 传入 `sh -s`。
    pub script: String,
}

/// 使用指定 SSH 可执行文件构建服务器信息采集计划。
pub fn build_server_info_plan_with_executable(
    host: &RemoteHost,
    executable: String,
) -> AppResult<ServerInfoCommandPlan> {
    build_server_info_plan_for_target_with_executable(
        host,
        &RemoteTargetRef::Ssh {
            host_id: host.id.clone(),
        },
        executable,
    )
}

/// 构建服务器信息采集用的带凭据 SSH 命令请求。
pub fn build_server_info_command_request(
    host: &RemoteHost,
    target: &RemoteTargetRef,
) -> AppResult<SshCommandRequest> {
    Ok(SshCommandRequest {
        host_id: host.id.clone(),
        command: build_server_info_script_for_target(host, target)?,
        timeout_seconds: Some(SERVER_INFO_TIMEOUT.as_secs()),
        max_output_bytes: Some(SERVER_INFO_OUTPUT_BYTES),
    })
}

/// 使用指定 SSH 可执行文件构建目标系统信息采集计划。
pub fn build_server_info_plan_for_target_with_executable(
    host: &RemoteHost,
    target: &RemoteTargetRef,
    executable: String,
) -> AppResult<ServerInfoCommandPlan> {
    ensure_target_matches_host(host, target)?;
    let mut args = vec![
        "-p".to_owned(),
        host.port.to_string(),
        "-o".to_owned(),
        "BatchMode=yes".to_owned(),
        "-o".to_owned(),
        "ConnectTimeout=10".to_owned(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
        "-o".to_owned(),
        "ServerAliveCountMax=3".to_owned(),
    ];
    args.extend(auth_args(host.auth_type));
    args.push(format!("{}@{}", host.username, host.host));
    args.push("sh".to_owned());
    args.push("-s".to_owned());
    let script = build_server_info_script_for_target(host, target)?;

    Ok(ServerInfoCommandPlan {
        executable,
        args,
        script,
    })
}

fn build_server_info_script_for_target(
    host: &RemoteHost,
    target: &RemoteTargetRef,
) -> AppResult<String> {
    ensure_target_matches_host(host, target)?;
    match target {
        RemoteTargetRef::Ssh { .. } => Ok(SERVER_INFO_SCRIPT.to_owned()),
        RemoteTargetRef::DockerContainer {
            container_id,
            runtime,
            ..
        } => {
            let container_id = normalize_plain_text("容器 id", container_id)?;
            Ok(build_container_exec_script(
                *runtime,
                &container_id,
                SERVER_INFO_SCRIPT,
                &[],
            ))
        }
        RemoteTargetRef::Local { .. }
        | RemoteTargetRef::Telnet { .. }
        | RemoteTargetRef::Serial { .. } => Err(AppError::InvalidInput(
            "服务器信息目标必须是 SSH 主机或容器".to_owned(),
        )),
    }
}

fn build_server_info_plan_for_target(
    host: &RemoteHost,
    target: &RemoteTargetRef,
) -> AppResult<ServerInfoCommandPlan> {
    build_server_info_plan_for_target_with_executable(host, target, resolve_ssh_executable()?)
}

fn ensure_target_matches_host(host: &RemoteHost, target: &RemoteTargetRef) -> AppResult<()> {
    target.validate()?;
    let target_host_id = target
        .host_id()
        .ok_or_else(|| AppError::InvalidInput("服务器信息目标必须是 SSH 主机或容器".to_owned()))?;
    if target_host_id != host.id {
        return Err(AppError::InvalidInput(
            "服务器信息目标主机和 SSH 主机不一致".to_owned(),
        ));
    }
    Ok(())
}

fn apply_target_metadata(snapshot: &mut ServerInfoSnapshot, target: &RemoteTargetRef) {
    if let RemoteTargetRef::DockerContainer {
        container_id,
        container_name,
        ..
    } = target
    {
        snapshot.host_name = container_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| short_target_label(container_id));
    }
}

fn short_target_label(value: &str) -> String {
    let trimmed = value.trim();
    let shortened: String = trimmed.chars().take(12).collect();
    if shortened.is_empty() {
        "container".to_owned()
    } else {
        shortened
    }
}

fn normalize_plain_text(field: &str, value: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    if value.contains('\0') || value.contains('\n') || value.contains('\r') {
        return Err(AppError::InvalidInput(format!("{field}不能包含控制字符")));
    }
    Ok(value.to_owned())
}

fn execute_server_info_plan(plan: &ServerInfoCommandPlan) -> AppResult<String> {
    let mut child = silent_command(&plan.executable)
        .args(&plan.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| AppError::ServerInfo(format!("无法启动 SSH 客户端: {error}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(plan.script.as_bytes())
            .map_err(|error| AppError::ServerInfo(format!("无法写入远程采集脚本: {error}")))?;
    }

    let started_at = Instant::now();
    loop {
        match child
            .try_wait()
            .map_err(|error| AppError::ServerInfo(format!("无法读取服务器信息状态: {error}")))?
        {
            Some(_) => break,
            None if started_at.elapsed() >= SERVER_INFO_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::ServerInfo(
                    "服务器信息采集超时，请稍后重试或检查 SSH 连接状态".to_owned(),
                ));
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|error| AppError::ServerInfo(format!("无法读取服务器信息输出: {error}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(AppError::ServerInfo(if detail.is_empty() {
            "服务器信息采集失败".to_owned()
        } else {
            detail
        }));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn server_info_transport_error(error: AppError) -> AppError {
    match error {
        AppError::Credential(message) | AppError::SshCommand(message) => {
            AppError::ServerInfo(message)
        }
        other => other,
    }
}

fn server_info_command_failure(stdout: &str, stderr: &str) -> AppError {
    let stderr = stderr.trim();
    let stdout = stdout.trim();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    AppError::ServerInfo(if detail.is_empty() {
        "远端采集脚本未成功退出".to_owned()
    } else {
        detail.to_owned()
    })
}

fn auth_args(auth_type: RemoteHostAuthType) -> Vec<String> {
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

fn resolve_ssh_executable() -> AppResult<String> {
    which::which("ssh")
        .or_else(|_| which::which("ssh.exe"))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|_| {
            AppError::ServerInfo(
                "未找到 OpenSSH 客户端，请安装 ssh 或确认 ssh 已加入 PATH".to_owned(),
            )
        })
}

/// 解析远端 key=value 输出为服务器信息快照。
pub fn parse_server_info_output(
    host: &RemoteHost,
    stdout: &str,
    captured_at: String,
) -> ServerInfoSnapshot {
    let values = key_value_lines(stdout);

    ServerInfoSnapshot {
        host_id: host.id.clone(),
        host_name: host.name.clone(),
        host: host.host.clone(),
        port: host.port,
        username: host.username.clone(),
        hostname: optional_text(&values, "hostname"),
        os: optional_text(&values, "os"),
        architecture: optional_text(&values, "architecture"),
        kernel: optional_text(&values, "kernel"),
        uptime_seconds: parse_u64(&values, "uptime_seconds"),
        load_average: parse_load_average(&values),
        cpu_usage_percent: parse_f64(&values, "cpu_usage_percent"),
        cpu_count: parse_u64(&values, "cpu_count"),
        cpu_model: optional_text(&values, "cpu_model"),
        cpu_core_usage_percents: parse_cpu_core_usage_percents(&values),
        process_count: parse_u64(&values, "process_count"),
        running_process_count: parse_u64(&values, "running_process_count"),
        memory_total_bytes: parse_u64(&values, "memory_total_bytes"),
        memory_used_bytes: parse_u64(&values, "memory_used_bytes"),
        memory_available_bytes: parse_u64(&values, "memory_available_bytes"),
        memory_buffers_bytes: parse_u64(&values, "memory_buffers_bytes"),
        memory_cached_bytes: parse_u64(&values, "memory_cached_bytes"),
        swap_total_bytes: parse_u64(&values, "swap_total_bytes"),
        swap_used_bytes: parse_u64(&values, "swap_used_bytes"),
        disk_total_bytes: parse_u64(&values, "disk_total_bytes"),
        disk_used_bytes: parse_u64(&values, "disk_used_bytes"),
        disk_available_bytes: parse_u64(&values, "disk_available_bytes"),
        disk_mount: optional_text(&values, "disk_mount"),
        disks: parse_server_disks(&values),
        network_rx_bytes: parse_u64(&values, "network_rx_bytes"),
        network_tx_bytes: parse_u64(&values, "network_tx_bytes"),
        network_interfaces: parse_network_interfaces(&values),
        top_processes: parse_server_processes(&values),
        gpu_probe_status: optional_text(&values, "gpu_probe_status"),
        gpus: parse_server_gpus(&values),
        captured_at,
    }
}

fn key_value_lines(stdout: &str) -> HashMap<String, String> {
    stdout
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_owned(), value.trim().to_owned()))
        .filter(|(key, _)| !key.is_empty())
        .collect()
}

fn optional_text(values: &HashMap<String, String>, key: &str) -> Option<String> {
    values
        .get(key)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn parse_u64(values: &HashMap<String, String>, key: &str) -> Option<u64> {
    values
        .get(key)?
        .split_once('.')
        .map(|(integer, _)| integer)
        .unwrap_or_else(|| values.get(key).expect("checked above"))
        .parse()
        .ok()
}

fn parse_u32(values: &HashMap<String, String>, key: &str) -> Option<u32> {
    parse_u64(values, key).and_then(|value| u32::try_from(value).ok())
}

fn parse_f64(values: &HashMap<String, String>, key: &str) -> Option<f64> {
    values.get(key)?.parse().ok()
}

fn parse_load_average(values: &HashMap<String, String>) -> Option<[f64; 3]> {
    let parts = values
        .get("load_average")?
        .split_whitespace()
        .filter_map(|part| part.parse::<f64>().ok())
        .collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }
    Some([parts[0], parts[1], parts[2]])
}

fn parse_cpu_core_usage_percents(values: &HashMap<String, String>) -> Vec<f64> {
    let mut entries = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("cpu_core_")?;
            let index = rest.strip_suffix("_usage_percent")?;
            index.parse::<usize>().ok().map(|index| (index, key))
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|(index, _)| *index);

    entries
        .into_iter()
        .filter_map(|(_, key)| values.get(key)?.parse::<f64>().ok())
        .collect()
}

fn parse_server_disks(values: &HashMap<String, String>) -> Vec<ServerDiskInfo> {
    let mut indices = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("disk_")?;
            let (index, field) = rest.split_once('_')?;
            if field == "mount" {
                index.parse::<usize>().ok()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    indices.sort_unstable();
    indices.dedup();

    indices
        .into_iter()
        .filter_map(|index| {
            let prefix = format!("disk_{index}_");
            let mount = optional_text(values, &format!("{prefix}mount"))?;
            let filesystem = optional_text(values, &format!("{prefix}filesystem"))
                .unwrap_or_else(|| "-".to_owned());
            Some(ServerDiskInfo {
                available_bytes: parse_u64(values, &format!("{prefix}available_bytes")),
                filesystem,
                mount,
                total_bytes: parse_u64(values, &format!("{prefix}total_bytes")),
                used_bytes: parse_u64(values, &format!("{prefix}used_bytes")),
            })
        })
        .collect()
}

fn parse_network_interfaces(values: &HashMap<String, String>) -> Vec<ServerNetworkInterfaceInfo> {
    let mut indices = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("network_interface_")?;
            let (index, field) = rest.split_once('_')?;
            if field == "name" {
                index.parse::<usize>().ok()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    indices.sort_unstable();
    indices.dedup();

    indices
        .into_iter()
        .filter_map(|index| {
            let prefix = format!("network_interface_{index}_");
            Some(ServerNetworkInterfaceInfo {
                name: optional_text(values, &format!("{prefix}name"))?,
                rx_bytes: parse_u64(values, &format!("{prefix}rx_bytes")),
                tx_bytes: parse_u64(values, &format!("{prefix}tx_bytes")),
            })
        })
        .collect()
}

fn parse_server_processes(values: &HashMap<String, String>) -> Vec<ServerProcessInfo> {
    let mut indices = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("process_")?;
            let (index, field) = rest.split_once('_')?;
            if field == "pid" {
                index.parse::<usize>().ok()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    indices.sort_unstable();
    indices.dedup();

    indices
        .into_iter()
        .filter_map(|index| {
            let prefix = format!("process_{index}_");
            Some(ServerProcessInfo {
                cpu_usage_percent: parse_f64(values, &format!("{prefix}cpu_usage_percent")),
                memory_bytes: parse_u64(values, &format!("{prefix}memory_bytes")),
                memory_percent: parse_f64(values, &format!("{prefix}memory_percent")),
                name: optional_text(values, &format!("{prefix}name"))?,
                pid: parse_u32(values, &format!("{prefix}pid"))?,
            })
        })
        .collect()
}

fn parse_server_gpus(values: &HashMap<String, String>) -> Vec<ServerGpuInfo> {
    let mut indices = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("gpu_")?;
            let (index, field) = rest.split_once('_')?;
            if field == "name" {
                index.parse::<usize>().ok()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    indices.sort_unstable();
    indices.dedup();

    indices
        .into_iter()
        .filter_map(|index| {
            let prefix = format!("gpu_{index}_");
            let name = optional_text(values, &format!("{prefix}name"))?;
            if is_gpu_probe_error_name(&name) {
                return None;
            }
            Some(ServerGpuInfo {
                driver_version: optional_text(values, &format!("{prefix}driver_version")),
                memory_total_bytes: parse_u64(values, &format!("{prefix}memory_total_bytes")),
                memory_used_bytes: parse_u64(values, &format!("{prefix}memory_used_bytes")),
                name,
                temperature_celsius: parse_f64(values, &format!("{prefix}temperature_celsius")),
                utilization_percent: parse_f64(values, &format!("{prefix}utilization_percent")),
                vendor: optional_text(values, &format!("{prefix}vendor")),
            })
        })
        .collect()
}

fn is_gpu_probe_error_name(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase();
    normalized.starts_with("nvidia-smi has failed")
        || normalized.starts_with("failed to initialize nvml")
        || normalized == "no devices were found"
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

const SERVER_INFO_SCRIPT: &str = r#"
printf 'hostname=%s\n' "$(hostname 2>/dev/null)"
if [ -r /etc/os-release ]; then
  os_pretty="$(awk -F= '/^PRETTY_NAME=/ {
    value=$2
    gsub(/^"/, "", value)
    gsub(/"$/, "", value)
    print value
    exit
  }' /etc/os-release 2>/dev/null)"
fi
if [ -n "$os_pretty" ]; then
  printf 'os=%s\n' "$os_pretty"
else
  printf 'os=%s\n' "$(uname -s 2>/dev/null)"
fi
printf 'architecture=%s\n' "$(uname -m 2>/dev/null)"
printf 'kernel=%s\n' "$(uname -r 2>/dev/null)"

if [ -r /proc/uptime ]; then
  awk '{ printf "uptime_seconds=%s\n", $1 }' /proc/uptime
fi

if [ -r /proc/loadavg ]; then
  awk '{ printf "load_average=%s %s %s\n", $1, $2, $3 }' /proc/loadavg
fi

cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null)"
if [ -n "$cpu_count" ]; then
  printf 'cpu_count=%s\n' "$cpu_count"
fi

if [ -r /proc/cpuinfo ]; then
  awk -F: '
    /^(model name|Hardware|Processor)[[:space:]]*:/ {
      value=$2
      sub(/^[[:space:]]+/, "", value)
      if (value != "") {
        printf "cpu_model=%s\n", value
        exit
      }
    }
  ' /proc/cpuinfo
fi

if [ -r /proc/stat ]; then
  read_cpu_snapshot() {
    awk '/^cpu[0-9]* / {
      total=0
      for (i=2; i<=NF; i++) total += $i
      idle=$5 + $6
      printf "%s %s %s\n", $1, idle, total
    }' /proc/stat
  }
  {
    read_cpu_snapshot
    printf "__KERMINAL_CPU_AFTER__\n"
    sleep 0.12 2>/dev/null || sleep 1
    read_cpu_snapshot
  } | awk '
    $1 == "__KERMINAL_CPU_AFTER__" {
      after=1
      next
    }
    after != 1 {
      if ($1 != "") {
        before_idle[$1]=$2
        before_total[$1]=$3
      }
      next
    }
    {
      key=$1
      if (key == "" || !(key in before_total)) next
      idle=$2-before_idle[key]
      total=$3-before_total[key]
      if (total <= 0) next
      usage=(total-idle)*100/total
      if (key == "cpu") {
        printf "cpu_usage_percent=%.2f\n", usage
      } else if (key ~ /^cpu[0-9]+$/) {
        core_index=substr(key, 4)
        printf "cpu_core_%s_usage_percent=%.2f\n", core_index, usage
      }
    }
  '
fi

if [ -r /proc/meminfo ]; then
  awk '
    /^MemTotal:/ { mem_total=$2*1024 }
    /^MemAvailable:/ { mem_available=$2*1024 }
    /^Buffers:/ { mem_buffers=$2*1024 }
    /^Cached:/ { mem_cached=$2*1024 }
    /^SwapTotal:/ { swap_total=$2*1024 }
    /^SwapFree:/ { swap_free=$2*1024 }
    END {
      if (mem_total > 0) {
        printf "memory_total_bytes=%.0f\n", mem_total
        printf "memory_used_bytes=%.0f\n", mem_total-mem_available
        printf "memory_available_bytes=%.0f\n", mem_available
        printf "memory_buffers_bytes=%.0f\n", mem_buffers
        printf "memory_cached_bytes=%.0f\n", mem_cached
      }
      if (swap_total >= 0) {
        printf "swap_total_bytes=%.0f\n", swap_total
        printf "swap_used_bytes=%.0f\n", swap_total-swap_free
      }
    }
  ' /proc/meminfo
fi

df -Pk / 2>/dev/null | awk 'NR==2 {
  printf "disk_total_bytes=%.0f\n", $2*1024
  printf "disk_used_bytes=%.0f\n", $3*1024
  printf "disk_available_bytes=%.0f\n", $4*1024
  printf "disk_mount=%s\n", $6
}'

df -Pk 2>/dev/null | awk 'NR > 1 {
  if ($1 == "tmpfs" || $1 == "devtmpfs") next
  printf "disk_%d_filesystem=%s\n", idx, $1
  printf "disk_%d_total_bytes=%.0f\n", idx, $2*1024
  printf "disk_%d_used_bytes=%.0f\n", idx, $3*1024
  printf "disk_%d_available_bytes=%.0f\n", idx, $4*1024
  printf "disk_%d_mount=%s\n", idx, $6
  idx++
}'

if [ -r /proc/net/dev ]; then
  awk 'NR > 2 {
    split($0, parts, ":")
    name=parts[1]
    sub(/^[[:space:]]+/, "", name)
    sub(/[[:space:]]+$/, "", name)
    split(parts[2], fields, /[[:space:]]+/)
    rx += fields[1]
    tx += fields[9]
    printf "network_interface_%d_name=%s\n", idx, name
    printf "network_interface_%d_rx_bytes=%.0f\n", idx, fields[1]
    printf "network_interface_%d_tx_bytes=%.0f\n", idx, fields[9]
    idx++
  } END {
    printf "network_rx_bytes=%.0f\n", rx
    printf "network_tx_bytes=%.0f\n", tx
  }' /proc/net/dev
fi

if command -v ps >/dev/null 2>&1; then
  ps -eo stat= 2>/dev/null | awk '{
    count++
    if ($1 ~ /^R/) running++
  } END {
    if (count > 0) {
      printf "process_count=%d\n", count
      printf "running_process_count=%d\n", running
    }
  }'
  ps -eo pid=,comm=,pcpu=,pmem=,rss= 2>/dev/null | sort -k3 -nr 2>/dev/null | awk 'NF >= 5 {
    printf "process_%d_pid=%s\n", idx, $1
    printf "process_%d_name=%s\n", idx, $2
    printf "process_%d_cpu_usage_percent=%s\n", idx, $3
    printf "process_%d_memory_percent=%s\n", idx, $4
    printf "process_%d_memory_bytes=%.0f\n", idx, $5*1024
    idx++
    if (idx >= 5) exit
  }'
fi

run_with_timeout() {
  timeout_seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_seconds" "$@"
  else
    "$@"
  fi
}

if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_lines="$(run_with_timeout 4 nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>/dev/null || true)"
  gpu_lines="$(printf '%s\n' "$gpu_lines" | awk -F, 'NF >= 6 { print }')"
  gpu_count="$(printf '%s\n' "$gpu_lines" | awk 'NF { count++ } END { print count+0 }')"
  if [ "$gpu_count" -gt 0 ] 2>/dev/null; then
    printf 'gpu_probe_status=nvidia_smi\n'
    printf 'gpu_count=%s\n' "$gpu_count"
    gpu_index=0
    printf '%s\n' "$gpu_lines" | while IFS=, read -r gpu_name gpu_driver gpu_mem_total gpu_mem_used gpu_util gpu_temp; do
      gpu_name="$(printf '%s' "$gpu_name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      gpu_driver="$(printf '%s' "$gpu_driver" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      gpu_mem_total="$(printf '%s' "$gpu_mem_total" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      gpu_mem_used="$(printf '%s' "$gpu_mem_used" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      gpu_util="$(printf '%s' "$gpu_util" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      gpu_temp="$(printf '%s' "$gpu_temp" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      if [ -z "$gpu_name" ]; then
        continue
      fi
      printf 'gpu_%s_name=%s\n' "$gpu_index" "$gpu_name"
      printf 'gpu_%s_vendor=NVIDIA\n' "$gpu_index"
      if [ -n "$gpu_driver" ] && [ "$gpu_driver" != "N/A" ]; then
        printf 'gpu_%s_driver_version=%s\n' "$gpu_index" "$gpu_driver"
      fi
      gpu_mem_total_bytes="$(awk -v mib="$gpu_mem_total" 'BEGIN { if (mib ~ /^[0-9.]+$/) printf "%.0f", mib*1048576 }')"
      gpu_mem_used_bytes="$(awk -v mib="$gpu_mem_used" 'BEGIN { if (mib ~ /^[0-9.]+$/) printf "%.0f", mib*1048576 }')"
      if [ -n "$gpu_mem_total_bytes" ]; then
        printf 'gpu_%s_memory_total_bytes=%s\n' "$gpu_index" "$gpu_mem_total_bytes"
      fi
      if [ -n "$gpu_mem_used_bytes" ]; then
        printf 'gpu_%s_memory_used_bytes=%s\n' "$gpu_index" "$gpu_mem_used_bytes"
      fi
      if printf '%s' "$gpu_util" | awk '{ exit !($1 ~ /^[0-9.]+$/) }'; then
        printf 'gpu_%s_utilization_percent=%s\n' "$gpu_index" "$gpu_util"
      fi
      if printf '%s' "$gpu_temp" | awk '{ exit !($1 ~ /^[0-9.]+$/) }'; then
        printf 'gpu_%s_temperature_celsius=%s\n' "$gpu_index" "$gpu_temp"
      fi
      gpu_index=$((gpu_index + 1))
    done
  else
    gpu_lines="$(run_with_timeout 3 nvidia-smi -L 2>/dev/null | sed -n 's/^GPU [0-9][0-9]*: //p' | sed 's/ (UUID:.*$//' || true)"
    gpu_count="$(printf '%s\n' "$gpu_lines" | awk 'NF { count++ } END { print count+0 }')"
    if [ "$gpu_count" -gt 0 ] 2>/dev/null; then
      printf 'gpu_probe_status=nvidia_smi_list\n'
      printf 'gpu_count=%s\n' "$gpu_count"
      gpu_index=0
      printf '%s\n' "$gpu_lines" | while IFS= read -r gpu_name; do
        gpu_name="$(printf '%s' "$gpu_name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        if [ -z "$gpu_name" ]; then
          continue
        fi
        printf 'gpu_%s_name=%s\n' "$gpu_index" "$gpu_name"
        printf 'gpu_%s_vendor=NVIDIA\n' "$gpu_index"
        gpu_index=$((gpu_index + 1))
      done
    else
      printf 'gpu_probe_status=nvidia_smi_no_devices\n'
    fi
  fi
elif command -v lspci >/dev/null 2>&1; then
  gpu_lines="$(run_with_timeout 2 lspci 2>/dev/null | awk -F': ' '/(VGA compatible controller|3D controller|Display controller)/ { print $2 }')"
  gpu_count="$(printf '%s\n' "$gpu_lines" | awk 'NF { count++ } END { print count+0 }')"
  if [ "$gpu_count" -gt 0 ] 2>/dev/null; then
    printf 'gpu_probe_status=lspci\n'
    gpu_index=0
    printf '%s\n' "$gpu_lines" | while IFS= read -r gpu_name; do
      gpu_name="$(printf '%s' "$gpu_name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      if [ -z "$gpu_name" ]; then
        continue
      fi
      printf 'gpu_%s_name=%s\n' "$gpu_index" "$gpu_name"
      gpu_index=$((gpu_index + 1))
    done
  else
    printf 'gpu_probe_status=lspci_no_devices\n'
  fi
else
  printf 'gpu_probe_status=no_probe_command\n'
fi
"#;
