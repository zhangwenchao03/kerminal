//! Kerminal runtime snapshot MCP tool.
//!
//! @author kongweiguang

use super::diagnostics_common::{
    exposed_tool_definitions, runtime_snapshot_diagnostic, serialized_name,
};
use super::*;
use crate::services::external_launch::{
    ExternalLaunchIntakeSnapshot, ExternalLaunchRejected, ExternalLaunchSecretBrokerSnapshot,
};

pub(super) fn execute_kerminal_runtime_snapshot(
    context: &McpToolExecutionContext<'_>,
    tools: &[ToolDefinition],
) -> ToolExecutionResult {
    let exposed_tools = exposed_tool_definitions(tools);
    let mut diagnostics = Vec::new();

    let terminals = match context.terminals.list_sessions() {
        Ok(sessions) => sessions,
        Err(error) => {
            diagnostics.push(runtime_snapshot_diagnostic(
                "terminal.list",
                error.to_string(),
            ));
            Vec::new()
        }
    };
    let terminal_summaries = terminals
        .iter()
        .map(|session| {
            json!({
                "id": session.id,
                "shell": session.shell,
                "cwd": session.cwd,
                "cols": session.cols,
                "rows": session.rows,
                "pid": session.pid,
                "status": session.status,
                "targetRef": session.target_ref,
                "agentSessionId": session.agent_session_id,
                "agentSignal": session.agent_signal
            })
        })
        .collect::<Vec<_>>();
    let agent_signal_by_agent_session_id = terminals
        .iter()
        .filter_map(|session| {
            Some((
                session.agent_session_id.as_ref()?.clone(),
                session.agent_signal.clone()?,
            ))
        })
        .collect::<std::collections::HashMap<_, _>>();

    let agent_sessions = match context.agent_sessions.list_sessions() {
        Ok(list) => {
            for diagnostic in &list.diagnostics {
                diagnostics.push(json!({
                    "source": "agent.sessions",
                    "severity": "warning",
                    "code": diagnostic.code,
                    "message": diagnostic.message,
                    "path": diagnostic.path,
                    "line": diagnostic.line,
                    "column": diagnostic.column
                }));
            }
            list.sessions
        }
        Err(error) => {
            diagnostics.push(runtime_snapshot_diagnostic(
                "agent.sessions",
                error.to_string(),
            ));
            Vec::new()
        }
    };
    let mut active_agent_sessions = 0usize;
    let mut archived_agent_sessions = 0usize;
    let mut stale_agent_sessions = 0usize;
    let agent_session_summaries = agent_sessions
        .iter()
        .map(|record| {
            let status = serialized_name(&record.session.status);
            let agent_signal = agent_signal_by_agent_session_id
                .get(record.session.agent_session_id.as_str())
                .cloned();
            match status.as_str() {
                "active" => active_agent_sessions += 1,
                "archived" => archived_agent_sessions += 1,
                "stale" => stale_agent_sessions += 1,
                _ => {}
            }
            json!({
                "agentSessionId": record.session.agent_session_id.as_str(),
                "agentId": record.session.agent_id,
                "title": record.session.title,
                "status": record.session.status,
                "sessionRoot": record.session.session_root,
                "agentSignal": agent_signal,
                "target": record.session.target.as_ref().map(|target| {
                    json!({
                        "liveStatus": target.live_status,
                        "targetTerminalSessionId": target.target_terminal_session_id,
                        "targetRef": target.target_ref,
                        "targetKind": target.target_kind,
                        "cwd": target.cwd,
                        "shell": target.shell,
                        "bindingGeneration": target.binding_generation
                    })
                }),
                "context": {
                    "mcpEndpointJson": record.paths.context.mcp_endpoint_json,
                    "targetBindingJson": record.paths.context.target_binding_json,
                    "terminalSnapshotJson": record.paths.context.terminal_snapshot_json
                }
            })
        })
        .collect::<Vec<_>>();

    let port_forwards = match context.port_forwards.list(context.storage) {
        Ok(summaries) => summaries,
        Err(error) => {
            diagnostics.push(runtime_snapshot_diagnostic(
                "port_forward.list",
                error.to_string(),
            ));
            Vec::new()
        }
    };
    let running_port_forwards = port_forwards
        .iter()
        .filter(|summary| serialized_name(&summary.status) == "running")
        .count();
    let port_forward_summaries = port_forwards
        .iter()
        .map(|summary| {
            json!({
                "id": summary.id,
                "hostId": summary.host_id,
                "hostName": summary.host_name,
                "name": summary.name,
                "kind": summary.kind,
                "purpose": summary.purpose,
                "origin": summary.origin,
                "bindHost": summary.bind_host,
                "sourcePort": summary.source_port,
                "targetHost": summary.target_host,
                "targetPort": summary.target_port,
                "proxyUrl": summary.proxy_url,
                "status": summary.status,
                "pid": summary.pid
            })
        })
        .collect::<Vec<_>>();

    let local_proxy_entry_count = match context.local_network_proxy.active_entry_count() {
        Ok(count) => count,
        Err(error) => {
            diagnostics.push(runtime_snapshot_diagnostic(
                "local_network_proxy",
                error.to_string(),
            ));
            0
        }
    };

    let external_launch_intake = match context.external_launch_intake.snapshot() {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            diagnostics.push(runtime_snapshot_diagnostic(
                "external_launch.intake",
                error.to_string(),
            ));
            None
        }
    };
    let external_launch_secrets = match context.external_launch_intake.secret_broker().snapshot() {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            diagnostics.push(runtime_snapshot_diagnostic(
                "external_launch.secrets",
                error.to_string(),
            ));
            None
        }
    };
    let external_launch_pending_count = external_launch_intake
        .as_ref()
        .map(|snapshot| snapshot.pending_count)
        .unwrap_or(0);
    let external_launch_secret_count = external_launch_secrets
        .as_ref()
        .map(|snapshot| snapshot.active_secret_count)
        .unwrap_or(0);
    let external_launch_runtime = external_launch_snapshot_json(
        external_launch_intake.as_ref(),
        external_launch_secrets.as_ref(),
    );

    let managed_ssh_runtime = match context.ssh_runtime.snapshot() {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            diagnostics.push(runtime_snapshot_diagnostic(
                "ssh_runtime.snapshot",
                error.to_string(),
            ));
            None
        }
    };
    let managed_ssh_active_session_count = managed_ssh_runtime
        .as_ref()
        .map(|snapshot| snapshot.active_sessions)
        .unwrap_or(0);
    let managed_ssh_active_channel_count = managed_ssh_runtime
        .as_ref()
        .map(|snapshot| snapshot.active_channels)
        .unwrap_or(0);

    let tool_count = exposed_tools.len();
    let write_tool_count = exposed_tools
        .iter()
        .filter(|tool| !tool.annotations.read_only_hint && !tool.annotations.destructive_hint)
        .count();
    let destructive_tool_count = exposed_tools
        .iter()
        .filter(|tool| tool.annotations.destructive_hint)
        .count();

    let mut entities = Vec::new();
    entities.extend(terminals.iter().map(|session| {
        json!({
            "type": "terminalSession",
            "id": session.id,
            "status": session.status,
            "targetRef": session.target_ref,
            "agentSessionId": session.agent_session_id,
            "agentSignal": session.agent_signal
        })
    }));
    entities.extend(agent_sessions.iter().map(|record| {
        let agent_signal = agent_signal_by_agent_session_id
            .get(record.session.agent_session_id.as_str())
            .cloned();
        json!({
            "type": "agentSession",
            "id": record.session.agent_session_id.as_str(),
            "status": record.session.status,
            "title": record.session.title,
            "agentSignal": agent_signal
        })
    }));
    entities.extend(port_forwards.iter().map(|summary| {
        json!({
            "type": "portForward",
            "id": summary.id,
            "status": summary.status,
            "hostId": summary.host_id
        })
    }));

    let diagnostic_suffix = if diagnostics.is_empty() {
        String::new()
    } else {
        format!("；{} 个子系统读取有诊断", diagnostics.len())
    };

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Kerminal 运行态快照已读取：{} 个终端，{} 个 Agent session，{} 个端口转发（{} 个运行中），{} 个本机代理入口，{} 个外部 SSH 启动待处理，{} 个受管 SSH session（{} 个 active channel），{} 个 MCP tools{}。",
            terminals.len(),
            agent_sessions.len(),
            port_forwards.len(),
            running_port_forwards,
            local_proxy_entry_count,
            external_launch_pending_count,
            managed_ssh_active_session_count,
            managed_ssh_active_channel_count,
            tool_count,
            diagnostic_suffix
        )),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "generatedAt": current_unix_timestamp(),
            "workspace": {
                "root": context.paths.root.to_string_lossy().into_owned(),
                "configGuide": context.paths.root.join("kerminal-config.md").to_string_lossy().into_owned(),
                "agentSessionsRoot": context.paths.root.join("agents").join("sessions").to_string_lossy().into_owned()
            },
            "mcp": {
                "toolsOnly": true,
                "exposedToolCount": tool_count,
                "writeToolCount": write_tool_count,
                "destructiveToolCount": destructive_tool_count,
                "appGuideTool": "kerminal.app_guide",
                "configGuideTool": "kerminal.config_guide",
                "selfDiscoveryTool": "kerminal.capabilities",
                "toolHelpTool": "kerminal.tool_help",
                "operationGuideTool": "kerminal.operation_guide",
                "configValidatorTool": "kerminal.config.validate"
            },
            "runtime": {
                "terminalSessionCount": terminals.len(),
                "agentSessionCount": agent_sessions.len(),
                "activeAgentSessionCount": active_agent_sessions,
                "archivedAgentSessionCount": archived_agent_sessions,
                "staleAgentSessionCount": stale_agent_sessions,
                "portForwardCount": port_forwards.len(),
                "runningPortForwardCount": running_port_forwards,
                "localProxyEntryCount": local_proxy_entry_count,
                "externalLaunchPendingCount": external_launch_pending_count,
                "externalLaunchActiveSecretCount": external_launch_secret_count,
                "managedSshActiveSessionCount": managed_ssh_active_session_count,
                "managedSshActiveChannelCount": managed_ssh_active_channel_count
            },
            "terminalSessions": terminal_summaries,
            "agentSessions": agent_session_summaries,
            "portForwards": port_forward_summaries,
            "externalLaunch": external_launch_runtime,
            "managedSsh": managed_ssh_runtime,
            "fileFirstConfiguration": {
                "guide": "kerminal-config.md",
                "guideTool": "kerminal.config_guide",
                "editableFiles": [
                    "settings.toml",
                    "profiles/*.toml",
                    "hosts/groups.toml",
                    "hosts/*.toml",
                    "snippets/*.toml",
                    "workflows/*.toml"
                ],
                "validator": "kerminal.config.validate",
                "hostDiscovery": "Read hosts/*.toml directly when host ids are needed; Kerminal intentionally does not expose remote_host.* CRUD/list tools over MCP.",
                "secretBoundary": "Do not read or edit secrets/vault*.toml directly; authorized credential writes use kerminal.host.upsert_with_credential or kerminal.vault.encrypt_secret."
            },
            "diagnostics": diagnostics,
            "nextActions": [
                "Call kerminal.app_guide for the Kerminal product structure and MCP routing map.",
                "Call kerminal.capabilities for exact tool families and absent-tool boundaries.",
                "Call kerminal.tool_help with a toolId, family, or query for exact schemas, examples, and safety annotations.",
                "Call kerminal.config_guide or read kerminal-config.md before editing file-backed configuration.",
                "Call kerminal.operation_guide with intent when you need a concrete tool sequence for a task.",
                "Call terminal.list or terminal.snapshot for terminal details before terminal.write.",
                "In a session workspace, call kerminal.agent.target_context before writing to the bound terminal.",
                "Inspect managedSsh in this snapshot when debugging SSH terminal/SFTP/exec/tmux/container/port-forward session reuse; it is redacted and does not expose passwords, private keys, or vault refs.",
                "Inspect externalLaunch in this snapshot before debugging bastion/jump-host launch compatibility; edit settings.toml externalLaunch and validate instead of looking for external_launch.* MCP control tools.",
                "For config edits, read kerminal-config.md or call kerminal.config_guide, edit files directly, then call kerminal.config.validate."
            ]
        })),
        entities,
        next_hints: vec![
            "For live terminal work, inspect terminalSessions and resolve the target before terminal.write.".to_owned(),
            "For SSH reuse diagnostics, inspect managedSsh session/channel counts before assuming SFTP or exec opened a separate connection.".to_owned(),
            "For host ids, read file-backed hosts/*.toml or use the bound target context; remote_host.* MCP tools are intentionally absent.".to_owned(),
            "For config edits, validate with kerminal.config.validate after direct file edits.".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

fn external_launch_snapshot_json(
    intake: Option<&ExternalLaunchIntakeSnapshot>,
    secrets: Option<&ExternalLaunchSecretBrokerSnapshot>,
) -> Value {
    json!({
        "intake": intake.map(|snapshot| {
            json!({
                "pendingCount": snapshot.pending_count,
                "pendingLaunchIds": &snapshot.pending_launch_ids,
                "acceptedCount": snapshot.accepted_count,
                "rejectedCount": snapshot.rejected_count,
                "noopCount": snapshot.noop_count,
                "lastRejection": snapshot.last_rejection.as_ref().map(external_launch_rejection_json),
                "policy": &snapshot.policy
            })
        }),
        "secrets": secrets.map(|snapshot| {
            json!({
                "activeSecretCount": snapshot.active_secret_count,
                "launchIds": &snapshot.launch_ids
            })
        }),
        "configuration": {
            "file": "settings.toml",
            "section": "externalLaunch",
            "validator": "kerminal.config.validate",
            "mcpCrudBoundary": "external_launch.* control/configuration tools are intentionally absent; edit settings.toml and validate."
        },
        "secretBoundary": "External launch passwords, URL passwords, password file contents, private keys, and key passphrases are never included in runtime snapshots; only counts and launch ids are exposed."
    })
}

fn external_launch_rejection_json(rejection: &ExternalLaunchRejected) -> Value {
    json!({
        "entrypoint": rejection.entrypoint,
        "sourceTool": rejection.source_tool,
        "message": rejection.message,
        "argCount": rejection.arg_count,
        "rawHash": rejection.raw_hash,
        "cwdPresent": rejection.cwd_present
    })
}
