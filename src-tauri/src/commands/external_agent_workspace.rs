//! External agent workspace Tauri commands.
//!
//! @author kongweiguang

use tauri::{AppHandle, State};

use crate::{
    models::agent_session::{
        AgentMcpEndpointContext, AgentSessionId, AgentSessionLaunch, AgentSessionUpdateRequest,
    },
    models::mcp_server::McpHttpServerStartRequest,
    services::external_agent_workspace::{
        ExternalAgentLaunchSpec, ExternalAgentWorkspaceService, ExternalAgentWorkspaceStatus,
        PrepareExternalAgentWorkspaceRequest,
    },
    state::AppState,
};

#[tauri::command]
pub fn get_external_agent_workspace_status(
    state: State<'_, AppState>,
) -> Result<ExternalAgentWorkspaceStatus, String> {
    let mcp_status = state
        .mcp_http_server()
        .status()
        .map_err(|error| error.to_string())?;
    let service = ExternalAgentWorkspaceService::new(
        state.paths().root.clone(),
        mcp_status.endpoint,
        mcp_status.running,
    );
    Ok(service.status())
}

#[tauri::command]
pub async fn prepare_external_agent_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    request: PrepareExternalAgentWorkspaceRequest,
) -> Result<ExternalAgentLaunchSpec, String> {
    let mcp_status = if request.dry_run {
        state
            .mcp_http_server()
            .status()
            .map_err(|error| error.to_string())?
    } else {
        state
            .mcp_http_server()
            .start(app, Some(McpHttpServerStartRequest::default()))
            .await
            .map_err(|error| error.to_string())?
    };
    let service = ExternalAgentWorkspaceService::new(
        state.paths().root.clone(),
        mcp_status.endpoint,
        mcp_status.running,
    );
    let spec = service
        .prepare(&request)
        .map_err(|error| error.to_string())?;
    if !request.dry_run {
        sync_agent_session_launch(state.inner(), &spec).map_err(|error| error.to_string())?;
    }
    Ok(spec)
}

fn sync_agent_session_launch(
    state: &AppState,
    spec: &ExternalAgentLaunchSpec,
) -> crate::error::AppResult<()> {
    let Some(agent_session_id) = spec
        .agent_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let agent_session_id = AgentSessionId::new(agent_session_id.to_owned())?;
    let mcp_endpoint = spec
        .env
        .as_ref()
        .and_then(|env| env.get("KERMINAL_MCP_ENDPOINT").cloned());
    state.agent_sessions().update_session(
        &agent_session_id,
        AgentSessionUpdateRequest {
            launch: Some(AgentSessionLaunch {
                command_label: launch_command_label(spec),
                shell: spec.shell.clone(),
                args: spec.args.clone(),
                cwd: spec.cwd.clone(),
            }),
            mcp_endpoint: Some(AgentMcpEndpointContext::new(
                agent_session_id.clone(),
                mcp_endpoint,
                current_unix_timestamp_string(),
            )),
            ..AgentSessionUpdateRequest::default()
        },
    )?;
    Ok(())
}

fn launch_command_label(spec: &ExternalAgentLaunchSpec) -> String {
    if spec.agent_id == "custom" {
        [spec.shell.as_str()]
            .into_iter()
            .chain(spec.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        spec.agent_id.clone()
    }
}

fn current_unix_timestamp_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
