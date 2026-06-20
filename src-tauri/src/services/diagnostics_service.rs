//! Kerminal 本地诊断包服务。
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::json;
use sysinfo::{
    CpuRefreshKind, MemoryRefreshKind, ProcessRefreshKind, ProcessesToUpdate, System,
    MINIMUM_CPU_UPDATE_INTERVAL,
};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        diagnostics::{
            DiagnosticBundle, RuntimeGpuHealth, RuntimeHealthSnapshot, RuntimeProcessHealth,
            RuntimeSamplingInfo, RuntimeStorageHealth, RuntimeSystemHealth,
        },
        settings::AppSettings,
        terminal::{TerminalSessionStatus, TerminalSessionSummary},
    },
    paths::KerminalPaths,
    security::redaction::redact_terminal_text,
    services::{process_command::silent_command, terminal_manager::TerminalManager},
    storage::SqliteStore,
};

const DIAGNOSTIC_SCHEMA: &str = "kerminal.diagnostics.v1";

/// 生成本地脱敏诊断包，供用户排查和人工提交问题时使用。
#[derive(Debug, Default)]
pub struct DiagnosticsService;

/// 诊断包生成所需的轻量状态快照。
#[derive(Debug, Clone)]
pub struct DiagnosticBundleSnapshot {
    /// SQLite 数据库文件路径。
    pub database_file: PathBuf,
    /// 当前 SQLite schema 版本。
    pub schema_version: u32,
    /// 当前终端会话摘要。
    pub sessions: Vec<TerminalSessionSummary>,
    /// 当前应用设置。
    pub settings: AppSettings,
}

impl DiagnosticsService {
    /// 创建诊断服务。
    pub fn new() -> Self {
        Self
    }

    /// 生成一个本地 JSON 诊断包。
    pub fn create_bundle(
        &self,
        paths: &KerminalPaths,
        storage: &SqliteStore,
        terminals: &TerminalManager,
    ) -> AppResult<DiagnosticBundle> {
        let snapshot = DiagnosticBundleSnapshot {
            database_file: storage.database_file().to_path_buf(),
            schema_version: storage.schema_version()?,
            sessions: terminals.list_sessions()?,
            settings: storage.load_app_settings()?,
        };

        self.create_bundle_from_snapshot(paths, snapshot)
    }

    /// 基于已采集的轻量状态快照生成一个本地 JSON 诊断包。
    pub fn create_bundle_from_snapshot(
        &self,
        paths: &KerminalPaths,
        snapshot: DiagnosticBundleSnapshot,
    ) -> AppResult<DiagnosticBundle> {
        paths.ensure_directories()?;
        fs::create_dir_all(&paths.diagnostics)?;

        let DiagnosticBundleSnapshot {
            database_file,
            schema_version,
            sessions,
            settings,
        } = snapshot;
        let id = Uuid::new_v4().to_string();
        let created_at = unix_timestamp_string();
        let file_name = format!("diagnostics-{}-{}.json", created_at, safe_id_suffix(&id));
        let path = paths.diagnostics.join(&file_name);
        let sections = vec![
            "app".to_owned(),
            "environment".to_owned(),
            "runtimeHealth".to_owned(),
            "paths".to_owned(),
            "database".to_owned(),
            "settings".to_owned(),
            "terminalSessions".to_owned(),
        ];
        let runtime_health = self.runtime_health_for_database_file(paths, &database_file)?;
        let running_sessions = sessions
            .iter()
            .filter(|session| matches!(session.status, TerminalSessionStatus::Running))
            .count();
        let database_file_size = file_size(&database_file);

        let payload = json!({
            "schema": DIAGNOSTIC_SCHEMA,
            "createdAt": created_at,
            "app": {
                "name": "Kerminal",
                "version": env!("CARGO_PKG_VERSION"),
                "rustPackage": env!("CARGO_PKG_NAME"),
            },
            "environment": {
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "family": std::env::consts::FAMILY,
            },
            "runtimeHealth": runtime_health,
            "paths": {
                "root": path_string(&paths.root),
                "databaseFile": path_string(&database_file),
                "logs": path_string(&paths.logs),
                "cache": path_string(&paths.cache),
                "diagnostics": path_string(&paths.diagnostics),
            },
            "database": {
                "schemaVersion": schema_version,
                "fileSizeBytes": database_file_size,
            },
            "settings": {
                "themeMode": settings.theme_mode,
                "terminal": {
                    "fontFamily": settings.terminal.font_family,
                    "fontSize": settings.terminal.font_size,
                    "lineHeight": settings.terminal.line_height,
                    "cursorBlink": settings.terminal.cursor_blink,
                    "scrollback": settings.terminal.scrollback,
                },
                "keybindingCount": settings.keybindings.len(),
                "ai": {
                    "contextMaxOutputBytes": settings.ai.context_max_output_bytes,
                    "includeCommandHistory": settings.ai.include_command_history,
                    "requireRemoteApproval": settings.ai.require_remote_approval,
                    "allowDestructiveTools": settings.ai.allow_destructive_tools,
                },
            },
            "terminalSessions": {
                "total": sessions.len(),
                "running": running_sessions,
                "exited": sessions.len().saturating_sub(running_sessions),
                "items": sessions,
                "rawOutputIncluded": false,
            },
            "security": {
                "secretRedaction": true,
                "rawTerminalOutputIncluded": false,
                "commandHistoryIncluded": false,
                "credentialValuesIncluded": false,
            },
            "sections": sections.clone(),
        });

        let content = serde_json::to_string_pretty(&payload)?;
        let (content, _) = redact_terminal_text(&content);
        fs::write(&path, content.as_bytes())?;

        Ok(DiagnosticBundle {
            id,
            created_at,
            file_name,
            path: path_string(&path),
            bytes_written: content.len() as u64,
            sections,
            redacted: true,
        })
    }

    /// 采集当前 Kerminal 进程和本机资源的一次性运行体检快照。
    pub fn runtime_health(
        &self,
        paths: &KerminalPaths,
        storage: &SqliteStore,
    ) -> AppResult<RuntimeHealthSnapshot> {
        self.runtime_health_for_database_file(paths, storage.database_file())
    }

    /// 采集当前 Kerminal 进程和本机资源，并使用指定数据库路径生成存储摘要。
    pub fn runtime_health_for_database_file(
        &self,
        paths: &KerminalPaths,
        database_file: &Path,
    ) -> AppResult<RuntimeHealthSnapshot> {
        paths.ensure_directories()?;

        let pid =
            sysinfo::get_current_pid().map_err(|error| AppError::Diagnostics(error.to_owned()))?;
        let pids = [pid];
        let process_refresh = ProcessRefreshKind::nothing()
            .with_cpu()
            .with_disk_usage()
            .with_memory();
        let mut system = System::new();

        system.refresh_memory_specifics(MemoryRefreshKind::everything());
        system.refresh_cpu_specifics(CpuRefreshKind::everything());
        system.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, process_refresh);

        // sysinfo 的 CPU 使用率基于前后两次采样差值，诊断按钮允许一次短暂采样。
        std::thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);
        system.refresh_cpu_usage();
        system.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, process_refresh);

        let process = system.process(pid).ok_or_else(|| {
            AppError::Diagnostics(format!("无法读取当前进程 {} 的资源信息", pid.as_u32()))
        })?;
        let disk_usage = process.disk_usage();

        Ok(RuntimeHealthSnapshot {
            captured_at: unix_timestamp_string(),
            process: RuntimeProcessHealth {
                cpu_usage_percent: round_percent(process.cpu_usage()),
                disk_read_bytes: disk_usage.total_read_bytes,
                disk_written_bytes: disk_usage.total_written_bytes,
                memory_bytes: process.memory(),
                name: process.name().to_string_lossy().into_owned(),
                pid: pid.as_u32(),
                started_at_seconds: process.start_time(),
                uptime_seconds: process.run_time(),
                virtual_memory_bytes: process.virtual_memory(),
            },
            redacted: true,
            sampling: RuntimeSamplingInfo {
                cpu_refreshed_twice: true,
                cpu_sample_interval_ms: MINIMUM_CPU_UPDATE_INTERVAL.as_millis() as u64,
                source: "sysinfo".to_owned(),
            },
            storage: RuntimeStorageHealth {
                database_file: path_string(database_file),
                database_file_size_bytes: file_size(database_file),
                diagnostics: path_string(&paths.diagnostics),
                logs: path_string(&paths.logs),
                root: path_string(&paths.root),
                root_size_bytes: directory_size(&paths.root),
            },
            system: RuntimeSystemHealth {
                arch: std::env::consts::ARCH.to_owned(),
                available_memory_bytes: system.available_memory(),
                boot_time_seconds: System::boot_time(),
                cpu_core_usage_percents: system
                    .cpus()
                    .iter()
                    .map(|cpu| round_percent(cpu.cpu_usage()))
                    .collect(),
                cpu_count: system.cpus().len(),
                global_cpu_usage_percent: round_percent(system.global_cpu_usage()),
                gpus: runtime_gpus(),
                host_name: System::host_name(),
                kernel_version: System::kernel_version(),
                os: System::long_os_version()
                    .or_else(System::name)
                    .unwrap_or_else(|| std::env::consts::OS.to_owned()),
                os_version: System::os_version(),
                total_memory_bytes: system.total_memory(),
                total_swap_bytes: system.total_swap(),
                uptime_seconds: System::uptime(),
                used_memory_bytes: system.used_memory(),
                used_swap_bytes: system.used_swap(),
            },
        })
    }
}

fn unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn safe_id_suffix(id: &str) -> String {
    id.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(12)
        .collect()
}

fn path_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };

    entries
        .filter_map(Result::ok)
        .map(|entry| {
            let Ok(file_type) = entry.file_type() else {
                return 0;
            };
            if file_type.is_file() {
                return entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            }
            if file_type.is_dir() {
                return directory_size(&entry.path());
            }
            0
        })
        .sum()
}

fn round_percent(value: f32) -> f32 {
    (value * 10.0).round() / 10.0
}

#[cfg(target_os = "windows")]
fn runtime_gpus() -> Vec<RuntimeGpuHealth> {
    let script = r#"
$controllers = @(Get-CimInstance Win32_VideoController |
  Select-Object Name,AdapterCompatibility,DriverVersion,AdapterRAM)
$usageByGpu = @{}
$totalUsage = 0.0
try {
  $samples = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples
  foreach ($sample in $samples) {
    $value = [double]$sample.CookedValue
    $totalUsage += $value
    if ($sample.InstanceName -match 'phys_(\d+)') {
      $index = [int]$Matches[1]
      if (-not $usageByGpu.ContainsKey($index)) { $usageByGpu[$index] = 0.0 }
      $usageByGpu[$index] += $value
    }
  }
} catch {}
$dedicatedUsageByGpu = @{}
try {
  $samples = (Get-Counter '\GPU Adapter Memory(*)\Dedicated Usage' -ErrorAction Stop).CounterSamples
  foreach ($sample in $samples) {
    if ($sample.InstanceName -match 'phys_(\d+)') {
      $index = [int]$Matches[1]
      if (-not $dedicatedUsageByGpu.ContainsKey($index)) { $dedicatedUsageByGpu[$index] = 0.0 }
      $dedicatedUsageByGpu[$index] += [double]$sample.CookedValue
    }
  }
} catch {}
$items = for ($i = 0; $i -lt $controllers.Count; $i++) {
  $controller = $controllers[$i]
  $usage = $null
  if ($usageByGpu.ContainsKey($i)) {
    $usage = [math]::Min(100.0, [math]::Round([double]$usageByGpu[$i], 1))
  } elseif ($controllers.Count -eq 1 -and $totalUsage -gt 0) {
    $usage = [math]::Min(100.0, [math]::Round($totalUsage, 1))
  }
  $dedicatedUsage = $null
  if ($dedicatedUsageByGpu.ContainsKey($i)) {
    $dedicatedUsage = [uint64][math]::Max(0.0, [math]::Round([double]$dedicatedUsageByGpu[$i], 0))
  }
  [pscustomobject]@{
    Name = $controller.Name
    AdapterCompatibility = $controller.AdapterCompatibility
    DriverVersion = $controller.DriverVersion
    AdapterRAM = $controller.AdapterRAM
    UtilizationPercent = $usage
    DedicatedUsageBytes = $dedicatedUsage
  }
}
$items | ConvertTo-Json -Compress
"#;
    let Ok(output) = silent_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    parse_windows_gpu_json(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(target_os = "windows")]
fn parse_windows_gpu_json(stdout: &str) -> Vec<RuntimeGpuHealth> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(stdout.trim()) else {
        return Vec::new();
    };

    match value {
        serde_json::Value::Array(items) => items
            .into_iter()
            .filter_map(windows_gpu_from_json)
            .collect(),
        item => windows_gpu_from_json(item).into_iter().collect(),
    }
}

#[cfg(target_os = "windows")]
fn windows_gpu_from_json(value: serde_json::Value) -> Option<RuntimeGpuHealth> {
    let name = json_optional_text(&value, "Name")?;
    Some(RuntimeGpuHealth {
        driver_version: json_optional_text(&value, "DriverVersion"),
        memory_total_bytes: json_optional_u64(&value, "AdapterRAM"),
        memory_used_bytes: json_optional_u64(&value, "DedicatedUsageBytes"),
        name,
        temperature_celsius: None,
        utilization_percent: json_optional_f32(&value, "UtilizationPercent").map(round_percent),
        vendor: json_optional_text(&value, "AdapterCompatibility"),
    })
}

#[cfg(target_os = "windows")]
fn json_optional_text(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(target_os = "windows")]
fn json_optional_u64(value: &serde_json::Value, key: &str) -> Option<u64> {
    let value = value.get(key)?;
    if let Some(value) = value.as_u64() {
        return Some(value);
    }
    if let Some(value) = value.as_i64() {
        return u64::try_from(value).ok();
    }
    value.as_str()?.trim().parse().ok()
}

#[cfg(target_os = "windows")]
fn json_optional_f32(value: &serde_json::Value, key: &str) -> Option<f32> {
    let value = value.get(key)?;
    if let Some(value) = value.as_f64() {
        return Some(value as f32);
    }
    value.as_str()?.trim().parse().ok()
}

#[cfg(target_os = "linux")]
fn runtime_gpus() -> Vec<RuntimeGpuHealth> {
    let Ok(output) = silent_command("nvidia-smi")
        .args([
            "--query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,temperature.gpu",
            "--format=csv,noheader,nounits",
        ])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_nvidia_smi_gpu_line)
        .collect()
}

#[cfg(target_os = "linux")]
fn parse_nvidia_smi_gpu_line(line: &str) -> Option<RuntimeGpuHealth> {
    let parts = line.split(',').map(str::trim).collect::<Vec<_>>();
    if parts.len() < 6 {
        return None;
    }

    Some(RuntimeGpuHealth {
        driver_version: optional_command_text(parts[1]),
        memory_total_bytes: parse_mib_to_bytes(parts[2]),
        memory_used_bytes: parse_mib_to_bytes(parts[3]),
        name: optional_command_text(parts[0])?,
        temperature_celsius: parse_optional_f32(parts[5]),
        utilization_percent: parse_optional_f32(parts[4]).map(round_percent),
        vendor: Some("NVIDIA".to_owned()),
    })
}

#[cfg(target_os = "linux")]
fn parse_mib_to_bytes(value: &str) -> Option<u64> {
    parse_optional_f32(value).map(|mib| (f64::from(mib) * 1_048_576.0).round() as u64)
}

#[cfg(target_os = "macos")]
fn runtime_gpus() -> Vec<RuntimeGpuHealth> {
    let Ok(output) = silent_command("system_profiler")
        .args(["SPDisplaysDataType"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    parse_macos_gpus(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(target_os = "macos")]
fn parse_macos_gpus(stdout: &str) -> Vec<RuntimeGpuHealth> {
    let mut gpus = Vec::new();
    let mut current: Option<RuntimeGpuHealth> = None;

    for line in stdout.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix("Chipset Model:") {
            if let Some(gpu) = current.take() {
                gpus.push(gpu);
            }
            current = Some(RuntimeGpuHealth {
                driver_version: None,
                memory_total_bytes: None,
                memory_used_bytes: None,
                name: name.trim().to_owned(),
                temperature_celsius: None,
                utilization_percent: None,
                vendor: None,
            });
            continue;
        }

        let Some(gpu) = current.as_mut() else {
            continue;
        };
        if let Some(vendor) = line.strip_prefix("Vendor:") {
            gpu.vendor = optional_command_text(vendor);
        } else if let Some(vram) = line
            .strip_prefix("VRAM (Total):")
            .or_else(|| line.strip_prefix("VRAM:"))
        {
            gpu.memory_total_bytes = parse_macos_vram_bytes(vram);
        }
    }

    if let Some(gpu) = current {
        gpus.push(gpu);
    }
    gpus
}

#[cfg(target_os = "macos")]
fn parse_macos_vram_bytes(value: &str) -> Option<u64> {
    let lower = value.to_ascii_lowercase();
    let amount = lower
        .split_whitespace()
        .find_map(|part| part.replace(',', ".").parse::<f64>().ok())?;
    let multiplier = if lower.contains("gb") {
        1_073_741_824.0
    } else if lower.contains("mb") {
        1_048_576.0
    } else if lower.contains("kb") {
        1024.0
    } else {
        1.0
    };
    Some((amount * multiplier).round() as u64)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn optional_command_text(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("N/A") || value.eq_ignore_ascii_case("[N/A]")
    {
        return None;
    }
    Some(value.to_owned())
}

#[cfg(target_os = "linux")]
fn parse_optional_f32(value: &str) -> Option<f32> {
    optional_command_text(value)?.parse().ok()
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn runtime_gpus() -> Vec<RuntimeGpuHealth> {
    Vec::new()
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn parse_windows_gpu_json_keeps_usage_and_dedicated_memory() {
        let gpus = parse_windows_gpu_json(
            r#"[{"Name":"NVIDIA GeForce RTX 4060","AdapterCompatibility":"NVIDIA","DriverVersion":"31.0.15","AdapterRAM":8589934592,"UtilizationPercent":42.25,"DedicatedUsageBytes":2147483648}]"#,
        );

        assert_eq!(gpus.len(), 1);
        assert_eq!(gpus[0].name, "NVIDIA GeForce RTX 4060");
        assert_eq!(gpus[0].vendor.as_deref(), Some("NVIDIA"));
        assert_eq!(gpus[0].memory_total_bytes, Some(8_589_934_592));
        assert_eq!(gpus[0].memory_used_bytes, Some(2_147_483_648));
        assert_eq!(gpus[0].utilization_percent, Some(42.3));
    }
}
