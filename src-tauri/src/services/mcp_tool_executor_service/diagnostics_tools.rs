use super::*;

pub(super) async fn execute_server_info_snapshot(
    server_info: &ServerInfoService,
    remote_hosts: &RemoteHostService,
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let host_id = match required_string_arg(arguments, "hostId") {
        Ok(host_id) => host_id,
        Err(error) => return failure(error.to_string()),
    };

    match server_info
        .snapshot_native(
            remote_hosts,
            paths,
            ssh_commands,
            ServerInfoRequest {
                host_id,
                target: None,
            },
        )
        .await
    {
        Ok(snapshot) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_server_info_snapshot_for_agent(&snapshot)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

/// 将服务器信息快照压缩成外部 Agent 可读摘要。
pub fn summarize_server_info_snapshot_for_agent(snapshot: &ServerInfoSnapshot) -> String {
    let system = [snapshot.os.as_deref(), snapshot.architecture.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    let system = if system.is_empty() {
        "未知系统"
    } else {
        &system
    };
    let cpu = snapshot
        .cpu_usage_percent
        .map(|value| format!("{value:.1}%"))
        .unwrap_or_else(|| "未知".to_owned());
    let memory = percent_summary(snapshot.memory_used_bytes, snapshot.memory_total_bytes);
    let disk = percent_summary(snapshot.disk_used_bytes, snapshot.disk_total_bytes);
    let uptime = snapshot
        .uptime_seconds
        .map(format_duration)
        .unwrap_or_else(|| "未知".to_owned());

    format!(
        "服务器信息已读取：{}（{}@{}:{}），系统：{}，CPU：{}，内存：{}，磁盘：{}，运行时间：{}。",
        snapshot.host_name,
        snapshot.username,
        snapshot.host,
        snapshot.port,
        system,
        cpu,
        memory,
        disk,
        uptime
    )
}

pub(super) fn execute_diagnostics_runtime_health(
    diagnostics: &DiagnosticsService,
    paths: &KerminalPaths,
    command_store: &CommandSqliteStore,
) -> ToolExecutionResult {
    match diagnostics.runtime_health(paths, command_store) {
        Ok(snapshot) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_runtime_health_for_agent(&snapshot)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_diagnostics_create_bundle(
    diagnostics: &DiagnosticsService,
    paths: &KerminalPaths,
    command_store: &CommandSqliteStore,
    settings: &SettingsService,
    terminals: &TerminalManager,
) -> ToolExecutionResult {
    let settings = match settings.load_settings() {
        Ok(settings) => settings,
        Err(error) => return failure(error.to_string()),
    };
    match diagnostics.create_bundle(paths, command_store, terminals, settings) {
        Ok(bundle) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_diagnostic_bundle_for_agent(&bundle)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_runtime_health_for_agent(snapshot: &RuntimeHealthSnapshot) -> String {
    let process_memory = byte_size_summary(snapshot.process.memory_bytes);
    let system_memory = percent_summary(
        Some(snapshot.system.used_memory_bytes),
        Some(snapshot.system.total_memory_bytes),
    );
    let data_root_size = byte_size_summary(snapshot.storage.root_size_bytes);
    let command_database_size =
        byte_size_summary(snapshot.storage.command_database_file_size_bytes);

    format!(
        "运行体检已读取：进程 {}({}) CPU {:.1}%，内存 {}；系统 {} {}，CPU {:.1}%，内存 {}；数据目录 {}，命令库 {}；采样 {} / {}ms，已脱敏。",
        snapshot.process.name,
        snapshot.process.pid,
        snapshot.process.cpu_usage_percent,
        process_memory,
        snapshot.system.os,
        snapshot.system.arch,
        snapshot.system.global_cpu_usage_percent,
        system_memory,
        data_root_size,
        command_database_size,
        snapshot.sampling.source,
        snapshot.sampling.cpu_sample_interval_ms
    )
}

pub(super) fn summarize_diagnostic_bundle_for_agent(bundle: &DiagnosticBundle) -> String {
    let redacted_label = if bundle.redacted { "是" } else { "否" };
    format!(
        "诊断包已生成：{}，大小 {}，分区 {} 个，已脱敏：{}，路径：{}。",
        bundle.file_name,
        byte_size_summary(bundle.bytes_written),
        bundle.sections.len(),
        redacted_label,
        bundle.path
    )
}

pub(super) fn percent_summary(used: Option<u64>, total: Option<u64>) -> String {
    match (used, total) {
        (Some(used), Some(total)) if total > 0 => {
            format!("{:.1}%", used as f64 * 100.0 / total as f64)
        }
        _ => "未知".to_owned(),
    }
}

pub(super) fn byte_size_summary(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let bytes = bytes as f64;
    if bytes >= GB {
        format!("{:.1} GB", bytes / GB)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes / MB)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes / KB)
    } else {
        format!("{} B", bytes as u64)
    }
}

pub(super) fn format_duration(seconds: u64) -> String {
    let days = seconds / 86_400;
    let hours = (seconds % 86_400) / 3_600;
    if days > 0 {
        format!("{days} 天 {hours} 小时")
    } else {
        format!("{hours} 小时")
    }
}
