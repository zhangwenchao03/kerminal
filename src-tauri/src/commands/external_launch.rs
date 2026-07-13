//! External SSH launch commands.
//!
//! @author kongweiguang

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::{
    models::remote_host::RemoteHostAuthType,
    paths::KerminalPaths,
    services::external_launch::{
        default_external_launch_alias_directory, delete_external_launch_aliases,
        external_target_id, generate_external_launch_aliases, inspect_external_host_key,
        inspect_external_launch_alias, trust_external_host_key, ExternalLaunchAliasGenerateRequest,
        ExternalLaunchAliasInspection, ExternalLaunchAliasInstallMode, ExternalLaunchAliasRemoval,
        ExternalLaunchAliasState, ExternalLaunchAliasSummary, ExternalLaunchEntrypoint,
        ExternalLaunchIntakeSnapshot, ExternalLaunchRequestDiagnostics,
        ExternalLaunchSecretBrokerSnapshot, ExternalLaunchSource, ExternalLaunchSourceTool,
        ExternalSshAuth, ExternalSshLaunchOptions, ExternalSshLaunchRequest, ExternalSshRouteHop,
        ExternalSshTarget, ExternalTargetSafety, EXTERNAL_LAUNCH_ALIAS_TOOLS,
        EXTERNAL_LAUNCH_DEEP_LINK_SCHEME,
    },
    state::AppState,
};

/// Windows `kerminal://` 动态注册状态；默认未注册，只有显式 command 才会改变系统关联。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchDeepLinkStatusDto {
    pub scheme: &'static str,
    pub supported: bool,
    pub registered: bool,
}

/// 查询当前进程是否仍是 `kerminal://` 的系统处理程序。
#[tauri::command]
pub fn external_launch_deep_link_status(
    app: AppHandle,
) -> Result<ExternalLaunchDeepLinkStatusDto, String> {
    let supported = cfg!(target_os = "windows");
    let registered = if supported {
        app.deep_link()
            .is_registered(EXTERNAL_LAUNCH_DEEP_LINK_SCHEME)
            .map_err(|error| error.to_string())?
    } else {
        false
    };
    Ok(ExternalLaunchDeepLinkStatusDto {
        scheme: EXTERNAL_LAUNCH_DEEP_LINK_SCHEME,
        supported,
        registered,
    })
}

/// 用户显式启用 Windows `kerminal://` 系统关联。
#[tauri::command]
pub fn external_launch_deep_link_register(
    app: AppHandle,
) -> Result<ExternalLaunchDeepLinkStatusDto, String> {
    ensure_windows_deep_link_support()?;
    app.deep_link()
        .register(EXTERNAL_LAUNCH_DEEP_LINK_SCHEME)
        .map_err(|error| error.to_string())?;
    external_launch_deep_link_status(app)
}

/// 用户显式关闭 Windows `kerminal://` 系统关联。
#[tauri::command]
pub fn external_launch_deep_link_unregister(
    app: AppHandle,
) -> Result<ExternalLaunchDeepLinkStatusDto, String> {
    ensure_windows_deep_link_support()?;
    app.deep_link()
        .unregister(EXTERNAL_LAUNCH_DEEP_LINK_SCHEME)
        .map_err(|error| error.to_string())?;
    external_launch_deep_link_status(app)
}

fn ensure_windows_deep_link_support() -> Result<(), String> {
    if cfg!(target_os = "windows") {
        Ok(())
    } else {
        Err("kerminal:// 动态注册当前仅在 Windows 上作为正式能力开放".to_owned())
    }
}

/// 领取待处理和可恢复的外部 SSH 请求；前端按 request id 去重，租约负责超时回收。
#[tauri::command]
pub fn external_launch_take_pending(
    state: State<'_, AppState>,
) -> Result<Vec<ExternalSshLaunchRequestDto>, String> {
    state
        .external_launch_intake()
        .recover_pending()
        .map(|requests| {
            requests
                .into_iter()
                .map(external_ssh_launch_request_to_dto)
                .collect()
        })
        .map_err(|error| error.to_string())
}

/// 在可信 UI 成功打开 pane 后确认请求，并释放 intake 持有的 secret。
#[tauri::command]
pub fn external_launch_ack(state: State<'_, AppState>, launch_id: String) -> Result<usize, String> {
    state
        .external_launch_intake()
        .acknowledge(&launch_id)
        .map_err(|error| error.to_string())?;
    state
        .external_launch_intake()
        .secret_broker()
        .ack_launch(&launch_id)
        .map_err(|error| error.to_string())
}

/// Materialize a trusted pending launch into a temporary SSH target.
#[tauri::command]
pub fn external_launch_materialize(
    state: State<'_, AppState>,
    request: ExternalLaunchMaterializeRequestDto,
) -> Result<ExternalLaunchMaterializedTargetDto, String> {
    state
        .external_session_materializer()
        .materialize(state.paths(), &request.launch_id, request.username)
        .map(materialized_target_to_dto)
        .map_err(|error| error.to_string())
}

/// 在打开 terminal pane 前探测 external target 的 SSH fingerprint。
#[tauri::command]
pub async fn external_launch_host_key_inspect(
    state: State<'_, AppState>,
    launch_id: String,
) -> Result<crate::services::external_launch::ExternalHostKeyInspection, String> {
    let target = state
        .external_session_materializer()
        .resolve_target(&external_target_id(&launch_id))
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            format!(
                "外部 SSH 临时目标不存在: request_hash={}",
                crate::services::external_launch::redaction::opaque_id_hash(&launch_id)
            )
        })?;
    inspect_external_host_key(state.paths(), &target)
        .await
        .map_err(|error| error.to_string())
}

/// 按用户确认的 fingerprint 二次探测并写入 known_hosts。
#[tauri::command]
pub async fn external_launch_host_key_trust(
    state: State<'_, AppState>,
    launch_id: String,
    expected_fingerprint: String,
) -> Result<crate::services::external_launch::ExternalHostKeyInspection, String> {
    let target = state
        .external_session_materializer()
        .resolve_target(&external_target_id(&launch_id))
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            format!(
                "外部 SSH 临时目标不存在: request_hash={}",
                crate::services::external_launch::redaction::opaque_id_hash(&launch_id)
            )
        })?;
    trust_external_host_key(state.paths(), &target, expected_fingerprint.trim())
        .await
        .map_err(|error| error.to_string())
}

/// Cancel a launch and release its session-only secret refs.
#[tauri::command]
pub fn external_launch_cancel(
    state: State<'_, AppState>,
    launch_id: String,
) -> Result<usize, String> {
    let cancellation = state
        .external_launch_tasks()
        .cancel(&launch_id)
        .map_err(|error| error.to_string())?;
    if let Some(session_id) = cancellation.session_id {
        let _ = state.terminals().close(&session_id);
    }
    state
        .external_launch_intake()
        .cancel(&launch_id)
        .map_err(|error| error.to_string())?;
    let _ = state
        .external_session_materializer()
        .forget_launch(&launch_id)
        .map_err(|error| error.to_string())?;
    state
        .external_launch_intake()
        .secret_broker()
        .cancel_launch(&launch_id)
        .map_err(|error| error.to_string())
}

/// Close a launch-owned runtime and release external launch secret refs.
#[tauri::command]
pub fn external_launch_close(
    state: State<'_, AppState>,
    launch_id: String,
) -> Result<usize, String> {
    let cancellation = state
        .external_launch_tasks()
        .cancel(&launch_id)
        .map_err(|error| error.to_string())?;
    if let Some(session_id) = cancellation.session_id {
        let _ = state.terminals().close(&session_id);
    }
    state
        .external_launch_intake()
        .cancel(&launch_id)
        .map_err(|error| error.to_string())?;
    let _ = state
        .external_session_materializer()
        .forget_launch(&launch_id)
        .map_err(|error| error.to_string())?;
    state
        .external_launch_intake()
        .secret_broker()
        .close_launch(&launch_id)
        .map_err(|error| error.to_string())
}

/// Return a redacted diagnostics snapshot for the external launch queue.
#[tauri::command]
pub fn external_launch_snapshot(
    state: State<'_, AppState>,
) -> Result<ExternalLaunchSnapshotDto, String> {
    let intake = state
        .external_launch_intake()
        .snapshot()
        .map_err(|error| error.to_string())?;
    let secrets = state
        .external_launch_intake()
        .secret_broker()
        .snapshot()
        .map_err(|error| error.to_string())?;
    let tasks = state
        .external_launch_tasks()
        .snapshot()
        .map_err(|error| error.to_string())?;

    Ok(external_launch_snapshot_to_dto(intake, secrets, tasks))
}

/// Return the current compatibility alias installation status.
#[tauri::command]
pub fn external_launch_alias_status(
    state: State<'_, AppState>,
) -> Result<ExternalLaunchAliasStatusDto, String> {
    let current_exe = env::current_exe().map_err(|error| error.to_string())?;
    external_launch_alias_status_for_paths(state.paths(), current_exe)
        .map_err(|error| error.to_string())
}

/// Generate opt-in compatibility aliases such as `putty.exe` or `MobaXterm.exe`.
#[tauri::command]
pub fn external_launch_alias_generate(
    state: State<'_, AppState>,
    request: ExternalLaunchAliasCommandRequestDto,
) -> Result<Vec<ExternalLaunchAliasSummaryDto>, String> {
    let current_exe = env::current_exe().map_err(|error| error.to_string())?;
    external_launch_alias_generate_for_paths(state.paths(), current_exe, request)
        .map_err(|error| error.to_string())
}

/// Delete Kerminal-managed compatibility aliases.
#[tauri::command]
pub fn external_launch_alias_delete(
    state: State<'_, AppState>,
    request: ExternalLaunchAliasCommandRequestDto,
) -> Result<Vec<ExternalLaunchAliasRemovalDto>, String> {
    let current_exe = env::current_exe().map_err(|error| error.to_string())?;
    external_launch_alias_delete_for_paths(state.paths(), current_exe, request)
        .map_err(|error| error.to_string())
}

/// Open the compatibility alias directory, creating it when needed.
#[tauri::command]
pub async fn external_launch_alias_open_directory(
    state: State<'_, AppState>,
    alias_directory: Option<String>,
) -> Result<String, String> {
    let alias_directory =
        resolve_alias_directory(state.paths(), alias_directory.map(PathBuf::from));
    let alias_directory_text = path_to_string(&alias_directory);
    crate::commands::file_dialog::file_dialog_open_local_directory(alias_directory_text.clone())
        .await?;
    Ok(alias_directory_text)
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchMaterializeRequestDto {
    pub launch_id: String,
    #[serde(default)]
    pub username: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchMaterializedTargetDto {
    pub launch_id: String,
    pub target_id: String,
    pub display_name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: RemoteHostAuthType,
    pub production: bool,
    pub safety: ExternalTargetSafety,
}

#[doc(hidden)]
pub fn external_ssh_launch_request_to_dto(
    request: ExternalSshLaunchRequest,
) -> ExternalSshLaunchRequestDto {
    let mut diagnostics = request.diagnostics;
    diagnostics.argv_redacted =
        crate::services::external_launch::redaction::public_argv_shape(&diagnostics.argv_redacted);
    ExternalSshLaunchRequestDto {
        id: request.id,
        source: source_to_dto(request.source),
        received_at: request.received_at,
        target: target_to_dto(request.target),
        auth: auth_to_dto(request.auth),
        options: request.options,
        diagnostics,
    }
}

#[doc(hidden)]
pub fn external_launch_snapshot_to_dto(
    intake: ExternalLaunchIntakeSnapshot,
    secrets: ExternalLaunchSecretBrokerSnapshot,
    tasks: crate::services::external_launch::ExternalLaunchTaskSnapshot,
) -> ExternalLaunchSnapshotDto {
    ExternalLaunchSnapshotDto {
        intake: intake_snapshot_to_dto(intake),
        secrets: ExternalLaunchSecretSnapshotDto {
            active_secret_count: secrets.active_secret_count,
            request_hashes: secrets
                .launch_ids
                .iter()
                .map(|launch_id| {
                    crate::services::external_launch::redaction::opaque_id_hash(launch_id)
                })
                .collect(),
        },
        tasks: ExternalLaunchTaskSnapshotDto {
            queued_count: tasks.queued_count,
            in_flight_count: tasks.in_flight_count,
            connected_count: tasks.connected_count,
            cancelled_count: tasks.cancelled_count,
            deadline_count: tasks.deadline_count,
            late_cleanup_count: tasks.late_cleanup_count,
            completed_count: tasks.completed_count,
            oldest_task_age_ms: tasks.oldest_task_age_ms,
            last_connect_latency_ms: tasks.last_connect_latency_ms,
        },
    }
}

fn materialized_target_to_dto(
    target: crate::services::external_launch::ExternalMaterializedTarget,
) -> ExternalLaunchMaterializedTargetDto {
    ExternalLaunchMaterializedTargetDto {
        auth_type: target.host.auth_type,
        display_name: target.display_name,
        host: target.host.host,
        launch_id: target.launch_id,
        port: target.host.port,
        production: target.host.production,
        safety: target.safety,
        target_id: target.host_id,
        username: target.host.username,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSshLaunchRequestDto {
    pub id: String,
    pub source: ExternalLaunchSourceDto,
    pub received_at: String,
    pub target: ExternalSshTargetDto,
    pub auth: ExternalSshAuthDto,
    pub options: ExternalSshLaunchOptions,
    pub diagnostics: ExternalLaunchRequestDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchSourceDto {
    pub tool: ExternalLaunchSourceTool,
    pub entrypoint: ExternalLaunchEntrypoint,
    pub persona: Option<String>,
    pub argv0: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSshTargetDto {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    #[serde(default)]
    pub route: Vec<ExternalSshRouteHop>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSshAuthDto {
    pub has_password: bool,
    pub has_key_passphrase: bool,
    pub identity_file: Option<String>,
    pub password_file_present: bool,
    pub agent: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchSnapshotDto {
    pub intake: ExternalLaunchIntakeSnapshotDto,
    pub secrets: ExternalLaunchSecretSnapshotDto,
    pub tasks: ExternalLaunchTaskSnapshotDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchIntakeSnapshotDto {
    pub pending_count: usize,
    pub pending_request_hashes: Vec<String>,
    pub claimed_count: usize,
    pub claimed_request_hashes: Vec<String>,
    pub accepted_count: u64,
    pub rejected_count: u64,
    pub noop_count: u64,
    pub last_rejection: Option<ExternalLaunchRejectedDto>,
    pub policy: crate::services::external_launch::ExternalLaunchPolicy,
    pub health: ExternalLaunchRuntimeHealthSnapshotDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchRuntimeHealthSnapshotDto {
    pub bridge_listening: bool,
    pub bridge_generation_tag: Option<String>,
    pub bridge_restart_count: u64,
    pub bridge_active_clients: usize,
    pub dedup_count: u64,
    pub backpressure_count: u64,
    pub expiry_count: u64,
    pub cancel_count: u64,
    pub oldest_launch_age_ms: u64,
    pub last_intake_latency_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchTaskSnapshotDto {
    pub queued_count: usize,
    pub in_flight_count: usize,
    pub connected_count: usize,
    pub cancelled_count: u64,
    pub deadline_count: u64,
    pub late_cleanup_count: u64,
    pub completed_count: u64,
    pub oldest_task_age_ms: u64,
    pub last_connect_latency_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchRejectedDto {
    pub entrypoint: ExternalLaunchEntrypoint,
    pub source_tool: Option<ExternalLaunchSourceTool>,
    pub message: String,
    pub arg_count: usize,
    pub raw_hash: String,
    pub cwd_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchSecretSnapshotDto {
    pub active_secret_count: usize,
    pub request_hashes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchAliasStatusDto {
    pub install_directory: Option<String>,
    pub kerminal_executable: String,
    pub shim_executable: String,
    pub shim_available: bool,
    pub alias_directory: String,
    pub aliases: Vec<ExternalLaunchAliasInspectionDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchAliasCommandRequestDto {
    #[serde(default)]
    pub tools: Option<Vec<ExternalLaunchSourceTool>>,
    #[serde(default)]
    pub alias_directory: Option<String>,
    #[serde(default)]
    pub shim_executable: Option<String>,
    #[serde(default)]
    pub prefer_hard_link: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchAliasInspectionDto {
    pub tool: ExternalLaunchSourceTool,
    pub alias_path: String,
    pub marker_path: String,
    pub state: ExternalLaunchAliasState,
    pub marker_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchAliasSummaryDto {
    pub tool: ExternalLaunchSourceTool,
    pub alias_path: String,
    pub marker_path: String,
    pub state: ExternalLaunchAliasState,
    pub install_mode: Option<ExternalLaunchAliasInstallMode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchAliasRemovalDto {
    pub tool: ExternalLaunchSourceTool,
    pub alias_path: String,
    pub marker_path: String,
    pub removed_alias: bool,
    pub removed_marker: bool,
}

fn source_to_dto(source: ExternalLaunchSource) -> ExternalLaunchSourceDto {
    ExternalLaunchSourceDto {
        tool: source.tool,
        entrypoint: source.entrypoint,
        persona: source.persona,
        argv0: source.argv0,
    }
}

fn target_to_dto(target: ExternalSshTarget) -> ExternalSshTargetDto {
    ExternalSshTargetDto {
        host: target.host,
        port: target.port,
        username: target.username,
        route: target.route,
    }
}

fn auth_to_dto(auth: ExternalSshAuth) -> ExternalSshAuthDto {
    ExternalSshAuthDto {
        has_password: auth.password.is_some(),
        has_key_passphrase: auth.key_passphrase.is_some(),
        identity_file: auth.identity_file,
        password_file_present: auth.password_file.is_some(),
        agent: auth.agent,
    }
}

fn intake_snapshot_to_dto(
    snapshot: ExternalLaunchIntakeSnapshot,
) -> ExternalLaunchIntakeSnapshotDto {
    ExternalLaunchIntakeSnapshotDto {
        pending_count: snapshot.pending_count,
        pending_request_hashes: snapshot
            .pending_launch_ids
            .iter()
            .map(|launch_id| crate::services::external_launch::redaction::opaque_id_hash(launch_id))
            .collect(),
        claimed_count: snapshot.claimed_count,
        claimed_request_hashes: snapshot
            .claimed_launch_ids
            .iter()
            .map(|launch_id| crate::services::external_launch::redaction::opaque_id_hash(launch_id))
            .collect(),
        accepted_count: snapshot.accepted_count,
        rejected_count: snapshot.rejected_count,
        noop_count: snapshot.noop_count,
        policy: snapshot.policy,
        health: ExternalLaunchRuntimeHealthSnapshotDto {
            bridge_listening: snapshot.health.bridge_listening,
            bridge_generation_tag: snapshot.health.bridge_generation_tag,
            bridge_restart_count: snapshot.health.bridge_restart_count,
            bridge_active_clients: snapshot.health.bridge_active_clients,
            dedup_count: snapshot.health.dedup_count,
            backpressure_count: snapshot.health.backpressure_count,
            expiry_count: snapshot.health.expiry_count,
            cancel_count: snapshot.health.cancel_count,
            oldest_launch_age_ms: snapshot.health.oldest_launch_age_ms,
            last_intake_latency_ms: snapshot.health.last_intake_latency_ms,
        },
        last_rejection: snapshot
            .last_rejection
            .map(|rejection| ExternalLaunchRejectedDto {
                entrypoint: rejection.entrypoint,
                source_tool: rejection.source_tool,
                message: rejection.message,
                arg_count: rejection.arg_count,
                raw_hash: rejection.raw_hash,
                cwd_present: rejection.cwd_present,
            }),
    }
}

#[doc(hidden)]
pub fn external_launch_alias_status_for_paths(
    paths: &KerminalPaths,
    current_exe: PathBuf,
) -> crate::error::AppResult<ExternalLaunchAliasStatusDto> {
    let alias_directory = default_external_launch_alias_directory(paths);
    let shim_executable = default_shim_executable(&current_exe);
    let aliases = EXTERNAL_LAUNCH_ALIAS_TOOLS
        .iter()
        .copied()
        .map(|tool| {
            inspect_external_launch_alias(&alias_directory, tool).map(alias_inspection_to_dto)
        })
        .collect::<crate::error::AppResult<Vec<_>>>()?;

    Ok(ExternalLaunchAliasStatusDto {
        install_directory: current_exe.parent().map(path_to_string),
        kerminal_executable: path_to_string(current_exe),
        shim_available: fs::metadata(&shim_executable).is_ok_and(|metadata| metadata.is_file()),
        shim_executable: path_to_string(shim_executable),
        alias_directory: path_to_string(alias_directory),
        aliases,
    })
}

#[doc(hidden)]
pub fn external_launch_alias_generate_for_paths(
    paths: &KerminalPaths,
    current_exe: PathBuf,
    request: ExternalLaunchAliasCommandRequestDto,
) -> crate::error::AppResult<Vec<ExternalLaunchAliasSummaryDto>> {
    let alias_directory = resolve_alias_directory(paths, optional_path(request.alias_directory));
    let shim_executable =
        resolve_shim_executable(&current_exe, optional_path(request.shim_executable));
    let mut generate_request = ExternalLaunchAliasGenerateRequest::new(
        shim_executable,
        alias_directory,
        request.tools.unwrap_or_default(),
    );
    if let Some(prefer_hard_link) = request.prefer_hard_link {
        generate_request.prefer_hard_link = prefer_hard_link;
    }
    generate_external_launch_aliases(generate_request)
        .map(|summaries| summaries.into_iter().map(alias_summary_to_dto).collect())
}

#[doc(hidden)]
pub fn external_launch_alias_delete_for_paths(
    paths: &KerminalPaths,
    _current_exe: PathBuf,
    request: ExternalLaunchAliasCommandRequestDto,
) -> crate::error::AppResult<Vec<ExternalLaunchAliasRemovalDto>> {
    let alias_directory = resolve_alias_directory(paths, optional_path(request.alias_directory));
    let tools = request.tools.unwrap_or_default();
    delete_external_launch_aliases(alias_directory, &tools)
        .map(|removals| removals.into_iter().map(alias_removal_to_dto).collect())
}

fn alias_inspection_to_dto(
    inspection: ExternalLaunchAliasInspection,
) -> ExternalLaunchAliasInspectionDto {
    ExternalLaunchAliasInspectionDto {
        tool: inspection.tool,
        alias_path: path_to_string(inspection.alias_path),
        marker_path: path_to_string(inspection.marker_path),
        state: inspection.state,
        marker_present: inspection.marker_present,
    }
}

fn alias_summary_to_dto(summary: ExternalLaunchAliasSummary) -> ExternalLaunchAliasSummaryDto {
    ExternalLaunchAliasSummaryDto {
        tool: summary.tool,
        alias_path: path_to_string(summary.alias_path),
        marker_path: path_to_string(summary.marker_path),
        state: summary.state,
        install_mode: summary.install_mode,
    }
}

fn alias_removal_to_dto(removal: ExternalLaunchAliasRemoval) -> ExternalLaunchAliasRemovalDto {
    ExternalLaunchAliasRemovalDto {
        tool: removal.tool,
        alias_path: path_to_string(removal.alias_path),
        marker_path: path_to_string(removal.marker_path),
        removed_alias: removal.removed_alias,
        removed_marker: removal.removed_marker,
    }
}

fn optional_path(value: Option<String>) -> Option<PathBuf> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn resolve_alias_directory(paths: &KerminalPaths, alias_directory: Option<PathBuf>) -> PathBuf {
    alias_directory.unwrap_or_else(|| default_external_launch_alias_directory(paths))
}

fn resolve_shim_executable(current_exe: &Path, shim_executable: Option<PathBuf>) -> PathBuf {
    shim_executable.unwrap_or_else(|| default_shim_executable(current_exe))
}

fn default_shim_executable(current_exe: &Path) -> PathBuf {
    current_exe
        .parent()
        .map(|parent| parent.join(default_shim_executable_file_name()))
        .unwrap_or_else(|| PathBuf::from(default_shim_executable_file_name()))
}

fn default_shim_executable_file_name() -> &'static str {
    if cfg!(windows) {
        "kerminal-launch-shim.exe"
    } else {
        "kerminal-launch-shim"
    }
}

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}
