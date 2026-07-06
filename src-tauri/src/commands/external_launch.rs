//! External SSH launch commands.
//!
//! @author kongweiguang

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    models::remote_host::RemoteHostAuthType,
    paths::KerminalPaths,
    services::external_launch::{
        default_external_launch_alias_directory, delete_external_launch_aliases,
        generate_external_launch_aliases, inspect_external_launch_alias,
        ExternalLaunchAliasGenerateRequest, ExternalLaunchAliasInspection,
        ExternalLaunchAliasInstallMode, ExternalLaunchAliasRemoval, ExternalLaunchAliasState,
        ExternalLaunchAliasSummary, ExternalLaunchEntrypoint, ExternalLaunchIntakeSnapshot,
        ExternalLaunchRequestDiagnostics, ExternalLaunchSecretBrokerSnapshot, ExternalLaunchSource,
        ExternalLaunchSourceTool, ExternalSshAuth, ExternalSshLaunchOptions,
        ExternalSshLaunchRequest, ExternalSshRouteHop, ExternalSshTarget,
        EXTERNAL_LAUNCH_ALIAS_TOOLS,
    },
    state::AppState,
};

/// Return and drain all queued external SSH launches.
#[tauri::command]
pub fn external_launch_take_pending(
    state: State<'_, AppState>,
) -> Result<Vec<ExternalSshLaunchRequestDto>, String> {
    state
        .external_launch_intake()
        .take_pending()
        .map(|requests| {
            requests
                .into_iter()
                .map(external_ssh_launch_request_to_dto)
                .collect()
        })
        .map_err(|error| error.to_string())
}

/// Acknowledge a launch after the trusted UI has opened it.
#[tauri::command]
pub fn external_launch_ack(state: State<'_, AppState>, launch_id: String) -> Result<usize, String> {
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

/// Cancel a launch and release its session-only secret refs.
#[tauri::command]
pub fn external_launch_cancel(
    state: State<'_, AppState>,
    launch_id: String,
) -> Result<usize, String> {
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

    Ok(external_launch_snapshot_to_dto(intake, secrets))
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
}

#[doc(hidden)]
pub fn external_ssh_launch_request_to_dto(
    request: ExternalSshLaunchRequest,
) -> ExternalSshLaunchRequestDto {
    ExternalSshLaunchRequestDto {
        id: request.id,
        source: source_to_dto(request.source),
        received_at: request.received_at,
        target: target_to_dto(request.target),
        auth: auth_to_dto(request.auth),
        options: request.options,
        diagnostics: request.diagnostics,
    }
}

#[doc(hidden)]
pub fn external_launch_snapshot_to_dto(
    intake: ExternalLaunchIntakeSnapshot,
    secrets: ExternalLaunchSecretBrokerSnapshot,
) -> ExternalLaunchSnapshotDto {
    ExternalLaunchSnapshotDto {
        intake: intake_snapshot_to_dto(intake),
        secrets: ExternalLaunchSecretSnapshotDto {
            active_secret_count: secrets.active_secret_count,
            launch_ids: secrets.launch_ids,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchIntakeSnapshotDto {
    pub pending_count: usize,
    pub pending_launch_ids: Vec<String>,
    pub accepted_count: u64,
    pub rejected_count: u64,
    pub noop_count: u64,
    pub last_rejection: Option<ExternalLaunchRejectedDto>,
    pub policy: crate::services::external_launch::ExternalLaunchPolicy,
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
    pub launch_ids: Vec<String>,
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
        pending_launch_ids: snapshot.pending_launch_ids,
        accepted_count: snapshot.accepted_count,
        rejected_count: snapshot.rejected_count,
        noop_count: snapshot.noop_count,
        policy: snapshot.policy,
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
