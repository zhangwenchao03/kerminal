use super::*;
use crate::{
    models::target::RemoteTargetRef, services::external_agent_workspace::CONFIG_REFERENCE_BODY,
};
use serde::Serialize;

pub(super) fn execute_kerminal_capabilities(tools: &[ToolDefinition]) -> ToolExecutionResult {
    let exposed_tools = exposed_tool_definitions(tools);
    let exposed_tool_count = exposed_tools.len();
    let write_tool_ids = exposed_tools
        .iter()
        .filter(|tool| !tool.annotations.read_only_hint && !tool.annotations.destructive_hint)
        .map(|tool| tool.id.as_str())
        .collect::<Vec<_>>();
    let destructive_tool_ids = exposed_tools
        .iter()
        .filter(|tool| tool.annotations.destructive_hint)
        .map(|tool| tool.id.as_str())
        .collect::<Vec<_>>();

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Kerminal MCP 能力指南已读取：当前暴露 {exposed_tool_count} 个 tools；配置文件优先直接编辑，运行态能力通过 MCP 调用。"
        )),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "purpose": "Help external AI agents understand which Kerminal MCP tools to call, which workspace files to read, and which capabilities are intentionally file-first or host-owned.",
            "recommendedFirstCalls": [
                "kerminal.app_guide",
                "kerminal.config_guide",
                "kerminal.capabilities",
                "kerminal.tool_help",
                "kerminal.operation_guide",
                "kerminal.runtime_snapshot",
                "kerminal.agent.current_session",
                "kerminal.agent.target_context",
                "terminal.list",
                "kerminal.config.validate"
            ],
            "sessionWorkspace": {
                "readFirst": [
                    "AGENTS.md",
                    "CLAUDE.md",
                    "context/mcp-endpoint.json",
                    "context/target-binding.json",
                    "context/terminal-snapshot.json",
                    "kerminal-config.md"
                ],
                "refreshTools": [
                    "kerminal.agent.current_session",
                    "kerminal.agent.target_context",
                    "terminal.snapshot"
                ],
                "terminalWriteRule": "Before terminal.write, resolve the target with kerminal.agent.target_context or terminal.resolve_agent_target. For session-bound writes pass agentSessionId, bindingGeneration, and data; stale or mismatched targets require user rebind."
            },
            "runtimeToolFamilies": [
                capability_family("agentSession", "Use the current Kerminal Agent session and bound target safely.", &exposed_tools, &["kerminal.agent.", "terminal.resolve_agent_target"]),
                capability_family("terminal", "Read and write existing terminal sessions; creation and UI focus stay in the app/UI host.", &exposed_tools, &["terminal."]),
                capability_family("ssh", "Run non-interactive SSH commands through saved Kerminal host credentials.", &exposed_tools, &["ssh."]),
                capability_family("sftp", "Browse, preview, transfer, and manage remote files through Kerminal SFTP runtime.", &exposed_tools, &["sftp."]),
                capability_family("tmux", "Probe, list, create, rename, kill, inspect, capture, and attach-plan tmux sessions on local or SSH targets.", &exposed_tools, &["tmux."]),
                capability_family("container", "List, inspect, tail logs, read stats, manage lifecycle, and browse, edit, transfer, or manage files for SSH-host Docker/Podman containers.", &exposed_tools, &["container."]),
                capability_family("portForward", "Create, list, and close managed SSH port forwards and local proxy entries.", &exposed_tools, &["port_forward."]),
                capability_family("serverInfo", "Read machine health and system snapshots for SSH hosts.", &exposed_tools, &["server_info."]),
                capability_family("history", "Search command history; history writes, deletes, and clears are intentionally absent.", &exposed_tools, &["history."]),
                capability_family("diagnostics", "Read app guide, generated config guide, tool help, runtime health, operation guide, runtime snapshot, create redacted diagnostic bundles, and validate file-backed config.", &exposed_tools, &["diagnostics.", "kerminal.config.validate", "kerminal.app_guide", "kerminal.config_guide", "kerminal.capabilities", "kerminal.tool_help", "kerminal.operation_guide", "kerminal.runtime_snapshot"]),
                capability_family("credentials", "Save authorized SSH credentials into the encrypted vault without writing plaintext into ordinary config files.", &exposed_tools, &["kerminal.host.", "kerminal.vault."])
            ],
            "fileFirstConfiguration": {
                "editableFiles": [
                    "settings.toml",
                    "profiles/*.toml",
                    "hosts/groups.toml",
                    "hosts/*.toml",
                    "snippets/*.toml",
                    "workflows/*.toml"
                ],
                "manualGuide": "kerminal-config.md",
                "manualGuideTool": "kerminal.config_guide",
                "validator": "kerminal.config.validate",
                "secretBoundary": "Do not read or edit secrets/vault*.toml directly. Authorized credential changes use the UI save flow, kerminal.host.upsert_with_credential, or kerminal.vault.encrypt_secret; ordinary host files keep secret_ref only.",
                "autoRefresh": "When Kerminal is running, valid file-backed config edits auto-refresh the UI; invalid TOML keeps last-known-good. This does not replace validation."
            },
            "deliberatelyAbsentToolFamilies": absent_tool_families(),
            "hostPolicy": {
                "approvalOwner": "The MCP host owns confirmation, approval, permissions, hooks, and audit.",
                "kerminalRole": "Kerminal exposes tools, validates arguments, restricts HTTP MCP to loopback, and redacts sensitive output where applicable."
            },
            "toolCounts": {
                "exposed": exposed_tool_count,
                "write": write_tool_ids.len(),
                "destructive": destructive_tool_ids.len()
            },
            "writeToolIds": write_tool_ids,
            "destructiveToolIds": destructive_tool_ids
        })),
        entities: exposed_tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "mcpTool",
                    "id": tool.id.as_str(),
                    "category": tool.category.clone(),
                    "categoryLabel": tool.category.label(),
                    "readOnly": tool.annotations.read_only_hint,
                    "destructive": tool.annotations.destructive_hint,
                    "openWorld": tool.annotations.open_world_hint
                })
            })
            .collect(),
        next_hints: vec![
            "When you know the task type, call kerminal.operation_guide with an intent such as terminal, config, sftp, tmux, or credentials.".to_owned(),
            "For session work, call kerminal.agent.target_context before terminal.write.".to_owned(),
            "For config edits, read kerminal-config.md, edit files directly, then call kerminal.config.validate.".to_owned(),
            "Use kerminal.tool_help for exact schemas, examples, and safety annotations before calling a specific runtime tool.".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

pub(super) fn execute_kerminal_app_guide(tools: &[ToolDefinition]) -> ToolExecutionResult {
    let exposed_tools = exposed_tool_definitions(tools);
    let tool_family = |candidate_tool_ids: &[&'static str]| {
        available_tool_ids(&exposed_tools, candidate_tool_ids)
    };
    let discovery_tools = tool_family(&[
        "kerminal.app_guide",
        "kerminal.capabilities",
        "kerminal.tool_help",
        "kerminal.operation_guide",
        "kerminal.runtime_snapshot",
        "kerminal.agent.current_session",
        "kerminal.agent.target_context",
        "terminal.list",
        "terminal.snapshot",
    ]);
    let terminal_tools = tool_family(&[
        "terminal.list",
        "terminal.snapshot",
        "terminal.write",
        "terminal.resize",
        "terminal.resolve_agent_target",
        "terminal.log.start",
        "terminal.log.stop",
        "terminal.log.state",
        "terminal.close",
    ]);
    let remote_tools = tool_family(&[
        "ssh.command",
        "ssh.command_on_resolved_host",
        "server_info.snapshot",
        "history.search",
    ]);
    let sftp_tools = tool_family(&[
        "sftp.list",
        "sftp.preview",
        "sftp.upload",
        "sftp.upload_directory",
        "sftp.download",
        "sftp.download_directory",
        "sftp.rename",
        "sftp.move",
        "sftp.create_directory",
        "sftp.chmod",
        "sftp.delete",
        "sftp.transfer.enqueue",
        "sftp.transfer.list",
        "sftp.transfer.cancel",
        "sftp.transfer.clear_completed",
    ]);
    let container_tools = tool_family(&[
        "container.list",
        "container.inspect",
        "container.logs.tail",
        "container.stats",
        "container.start",
        "container.stop",
        "container.restart",
        "container.remove",
        "container.files.list",
        "container.files.preview",
        "container.files.write_text",
        "container.files.upload",
        "container.files.download",
        "container.files.create_directory",
        "container.files.rename",
        "container.files.chmod",
        "container.files.delete",
    ]);
    let tmux_tools = tool_family(&[
        "tmux.probe",
        "tmux.list_sessions",
        "tmux.create_session",
        "tmux.rename_session",
        "tmux.kill_session",
        "tmux.list_windows",
        "tmux.list_panes",
        "tmux.capture_pane",
        "tmux.attach_plan",
    ]);
    let port_forward_tools = tool_family(&[
        "port_forward.list",
        "port_forward.create",
        "port_forward.close",
    ]);
    let credential_tools = tool_family(&[
        "kerminal.host.upsert_with_credential",
        "kerminal.vault.encrypt_secret",
    ]);
    let config_tools = tool_family(&["kerminal.config_guide", "kerminal.config.validate"]);
    let diagnostics_tools = tool_family(&[
        "diagnostics.runtime_health",
        "diagnostics.create_bundle",
        "kerminal.config_guide",
        "kerminal.config.validate",
    ]);

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(
            "Kerminal 应用导航指南已读取：返回主界面区域、AI 可用 runtime 工具、配置文件边界和推荐入口。".to_owned(),
        ),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "purpose": "Give external AI agents a product-level map of Kerminal before choosing low-level runtime tools. This guide is read-only and does not perform UI choreography.",
            "recommendedEntrySequence": [
                "Read AGENTS.md / CLAUDE.md in the workspace or session root.",
                "Call kerminal.app_guide for product structure and MCP routing.",
                "Call kerminal.capabilities for the exact tool map and absent-tool boundaries.",
                "Call kerminal.tool_help with a toolId, family, or query when you need exact schemas, examples, and safety annotations.",
                "Call kerminal.config_guide before file-backed configuration edits when kerminal-config.md is not already available.",
                "Call kerminal.runtime_snapshot for the current live terminals, Agent sessions, and port forwards.",
                "Call kerminal.operation_guide with a task intent before invoking write or destructive tools."
            ],
            "applicationSurfaces": [
                {
                    "surface": "machineSidebar",
                    "userSees": "Saved Local/SSH/RDP/Telnet/Serial targets, groups, tags, connection entry points, and host context actions.",
                    "aiCanDo": [
                        "Read or update host/profile/group files directly when the user asks for configuration changes.",
                        "Run non-interactive SSH commands through saved credentials.",
                        "Open runtime views indirectly by using the corresponding MCP tool family rather than UI choreography."
                    ],
                    "runtimeTools": remote_tools.clone(),
                    "fileBackedConfig": ["hosts/groups.toml", "hosts/*.toml", "profiles/*.toml"],
                    "boundaries": [
                        "Do not expect remote_host.* CRUD/list MCP tools.",
                        "Do not read secrets/vault*.toml directly.",
                        "Ask for user/host approval before production writes or destructive remote commands."
                    ]
                },
                {
                    "surface": "terminalWorkspace",
                    "userSees": "Tabs, panes, split terminal workspace, command blocks, search, terminal logs, and bound target terminals for Agent sessions.",
                    "aiCanDo": [
                        "List and inspect existing terminals.",
                        "Write to an explicitly selected live terminal or the generation-matched Agent-bound target.",
                        "Resize terminals and manage terminal logging when requested."
                    ],
                    "runtimeTools": terminal_tools.clone(),
                    "sessionContextFiles": [
                        "context/mcp-endpoint.json",
                        "context/target-binding.json",
                        "context/terminal-snapshot.json"
                    ],
                    "boundaries": [
                        "MCP does not create terminals or focus UI tabs.",
                        "Before terminal.write, resolve and inspect the target.",
                        "Stale, closed, missing, or generation-mismatched Agent targets require user rebind."
                    ]
                },
                {
                    "surface": "rightToolPanel",
                    "userSees": "Agent Launcher, System, Files/SFTP, Ports, tmux, Snippets, Logs, and Settings.",
                    "aiCanDo": [
                        "Use runtime tools matching the right-panel domain.",
                        "Use file-first config for snippets, workflows, settings, hosts, and profiles.",
                        "Use diagnostics and runtime snapshot for app health and current state."
                    ],
                    "runtimeTools": {
                        "sftp": sftp_tools.clone(),
                        "tmux": tmux_tools.clone(),
                        "container": container_tools.clone(),
                        "portForward": port_forward_tools.clone(),
                        "diagnostics": diagnostics_tools.clone()
                    },
                    "fileBackedConfig": [
                        "settings.toml",
                        "snippets/*.toml",
                        "workflows/*.toml"
                    ],
                    "boundaries": [
                        "Do not expect settings.*, snippet.*, workflow.*, or workspace.* MCP CRUD tools.",
                        "Edit configuration files directly and validate.",
                        "MCP host owns confirmation, approval, permissions, hooks, and audit."
                    ]
                },
                {
                    "surface": "agentLauncher",
                    "userSees": "Codex, Claude, or custom CLI sessions launched from Kerminal with session-scoped workspace files.",
                    "aiCanDo": [
                        "Read current Agent session metadata.",
                        "Resolve the bound target and refresh terminal snapshot.",
                        "Operate the bound target with generation-checked terminal.write."
                    ],
                    "runtimeTools": discovery_tools.clone(),
                    "sessionWorkspaceFiles": [
                        "AGENTS.md",
                        "CLAUDE.md",
                        ".codex/config.toml",
                        ".mcp.json",
                        "context/mcp-endpoint.json",
                        "context/target-binding.json",
                        "context/terminal-snapshot.json"
                    ],
                    "boundaries": [
                        "Kerminal does not own model provider, account state, approval UI, hooks, or audit.",
                        "Agent terminal TUI behavior remains owned by the external CLI and MCP host."
                    ]
                },
                {
                    "surface": "configurationWorkspace",
                    "userSees": "~/.kerminal as the file-backed runtime workspace.",
                    "aiCanDo": [
                        "Read kerminal-config.md or call kerminal.config_guide before edits.",
                        "Edit ordinary TOML files directly.",
                        "Validate with kerminal.config.validate after every config edit.",
                        "Use authorized credential tools for encrypted vault writes."
                    ],
                    "runtimeTools": {
                        "config": config_tools.clone(),
                        "credentials": credential_tools.clone()
                    },
                    "editableFiles": [
                        "settings.toml",
                        "profiles/*.toml",
                        "hosts/groups.toml",
                        "hosts/*.toml",
                        "snippets/*.toml",
                        "workflows/*.toml"
                    ],
                    "protectedFiles": [
                        "data/command.sqlite",
                        "secrets/vault.toml",
                        "secrets/vault-key.toml",
                        "logs/",
                        "cache/",
                        "temp/"
                    ]
                }
            ],
            "taskRoutes": [
                app_task_route("understand-current-state", "Call kerminal.runtime_snapshot, then terminal.list or kerminal.agent.target_context if terminal context matters.", &discovery_tools),
                app_task_route("discover-mcp-capabilities", "Call kerminal.capabilities to read the current tool map, recommended first calls, file-first configuration boundary, and deliberately absent tool families.", &discovery_tools),
                app_task_route("operate-terminal", "Use terminal.list/snapshot/write on an explicit live terminal; in Agent sessions use kerminal.agent.target_context first.", &terminal_tools),
                app_task_route("run-ssh-command", "Identify host id from target context or hosts/*.toml, then use ssh.command_on_resolved_host or ssh.command.", &remote_tools),
                app_task_route("manage-remote-files", "Use sftp.list/preview before transfer or path changes; use transfer queue for long work.", &sftp_tools),
                app_task_route("manage-containers", "Use container.list/inspect/logs/stats first; use container.files.* for container filesystem work.", &container_tools),
                app_task_route("manage-tmux", "Probe and list sessions before capture/create/rename/kill/attach planning.", &tmux_tools),
                app_task_route("manage-port-forwarding", "Use port_forward.list before create or close; keep risky remote exposure behind user approval.", &port_forward_tools),
                app_task_route("edit-kerminal-config", "Read kerminal-config.md or call kerminal.config_guide, edit files directly, then call kerminal.config.validate.", &config_tools),
                app_task_route("save-credentials", "Use kerminal.host.upsert_with_credential or kerminal.vault.encrypt_secret only when the user explicitly provides/authorizes credential material.", &credential_tools),
                app_task_route("diagnose-app", "Use diagnostics.runtime_health, diagnostics.create_bundle, and runtime_snapshot; outputs are redacted where applicable.", &diagnostics_tools)
                ,
                app_task_route("inspect-tool-schema", "Use kerminal.tool_help with toolId, family, or query to retrieve schema-backed examples and safety annotations.", &discovery_tools)
            ],
            "mcpBoundaries": {
                "toolsOnly": true,
                "hostPolicyOwner": "The MCP host owns confirmation, approval, permissions, hooks, and audit.",
                "configCrudAbsent": ["settings.*", "profile.*", "remote_host.*", "snippet.*", "workflow.*", "workspace.*"],
                "uiChoreographyAbsent": ["terminal.create", "terminal.resolve_current", "workspace.focus_tab"],
                "historyWriteAbsent": ["history.record", "history.delete", "history.clear"]
            },
            "nextActions": [
                "Use this app guide for product orientation, then call kerminal.operation_guide with the closest intent.",
                "Use kerminal.tool_help for exact schemas, examples, and safety annotations before invoking any non-read-only tool.",
                "For config edits, call kerminal.config_guide or read kerminal-config.md before editing.",
                "For file-backed config, prefer direct file edits plus kerminal.config.validate instead of looking for MCP CRUD."
            ]
        })),
        entities: exposed_tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "mcpTool",
                    "id": tool.id.as_str(),
                    "category": tool.category.clone(),
                    "readOnly": tool.annotations.read_only_hint,
                    "destructive": tool.annotations.destructive_hint
                })
            })
            .collect(),
        next_hints: vec![
            "Call kerminal.operation_guide with a specific intent before write or destructive actions.".to_owned(),
            "Call kerminal.runtime_snapshot to see current live app state.".to_owned(),
            "Use direct file edits plus kerminal.config.validate for file-backed configuration.".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

pub(super) fn execute_kerminal_config_guide() -> ToolExecutionResult {
    let line_count = CONFIG_REFERENCE_BODY.lines().count();

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Kerminal 配置指南已读取：返回与 kerminal-config.md 同源的 {line_count} 行规则正文；配置仍然是直接编辑文件后调用 kerminal.config.validate。"
        )),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "guideFile": "kerminal-config.md",
            "lineCount": line_count,
            "purpose": "Expose the generated Kerminal configuration guide through MCP for external agents that do not have direct access to the initialized workspace files. This tool is read-only and does not perform config CRUD.",
            "markdown": CONFIG_REFERENCE_BODY,
            "editableFiles": [
                "settings.toml",
                "profiles/*.toml",
                "hosts/groups.toml",
                "hosts/*.toml",
                "snippets/*.toml",
                "workflows/*.toml"
            ],
            "protectedPaths": [
                "data/command.sqlite",
                "secrets/vault.toml",
                "secrets/vault-key.toml",
                "logs/",
                "cache/",
                "temp/"
            ],
            "validator": "kerminal.config.validate",
            "secretBoundary": "Do not read or edit secrets/vault*.toml directly. Authorized credential work uses kerminal.host.upsert_with_credential, kerminal.vault.encrypt_secret, or the Kerminal UI save flow; ordinary host files keep secret_ref only.",
            "mcpCrudBoundary": "Do not look for settings.*, profile.*, remote_host.*, snippet.*, workflow.*, or workspace.* MCP CRUD tools. Edit file-backed config directly and validate.",
            "deliberatelyAbsentToolFamilies": absent_tool_families(),
            "nextActions": [
                "Use this guide before editing file-backed Kerminal configuration.",
                "After edits, call kerminal.config.validate with scope all or the narrowest matching scope.",
                "For credential material, use kerminal.host.upsert_with_credential or kerminal.vault.encrypt_secret instead of ordinary TOML fields."
            ]
        })),
        entities: vec![json!({
            "type": "configGuide",
            "path": "kerminal-config.md",
            "validator": "kerminal.config.validate"
        })],
        next_hints: vec![
            "For config edits, keep changes in ordinary TOML files small and validate with kerminal.config.validate.".to_owned(),
            "For secrets, do not read secrets/; use authorized credential tools instead.".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

pub(super) fn execute_kerminal_tool_help(
    tools: &[ToolDefinition],
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let exposed_tools = exposed_tool_definitions(tools);
    let requested_tool_id = optional_nonempty_argument(arguments, "toolId");
    let requested_family = optional_nonempty_argument(arguments, "family");
    let requested_query = optional_nonempty_argument(arguments, "query");
    let include_schemas = arguments
        .get("includeSchemas")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let (match_mode, matched_tool_ids) = if let Some(tool_id) = requested_tool_id.as_deref() {
        (
            "toolId",
            exposed_tools
                .iter()
                .filter(|tool| tool.id.as_str() == tool_id)
                .map(|tool| tool.id.as_str())
                .collect::<Vec<_>>(),
        )
    } else if let Some(family) = requested_family.as_deref() {
        ("family", tool_ids_for_help_family(&exposed_tools, family))
    } else if let Some(query) = requested_query.as_deref() {
        ("query", tool_ids_for_help_query(&exposed_tools, query))
    } else {
        (
            "default",
            tool_ids_matching_prefixes(
                &exposed_tools,
                &[
                    "kerminal.app_guide",
                    "kerminal.config_guide",
                    "kerminal.capabilities",
                    "kerminal.tool_help",
                    "kerminal.operation_guide",
                    "kerminal.runtime_snapshot",
                ],
            ),
        )
    };

    let mut tool_reference = tool_references(&exposed_tools, &matched_tool_ids);
    if !include_schemas {
        for reference in &mut tool_reference {
            if let Some(object) = reference.as_object_mut() {
                object.remove("inputSchema");
            }
        }
    }

    let missing_tool_ids = requested_tool_id
        .as_deref()
        .filter(|_| matched_tool_ids.is_empty())
        .map(|tool_id| vec![tool_id.to_owned()])
        .unwrap_or_default();
    let absent_filter = requested_tool_id
        .as_deref()
        .or(requested_family.as_deref())
        .or(requested_query.as_deref());
    let absent_tool_matches = matching_absent_tool_families(absent_filter);
    let summary_suffix = if matched_tool_ids.is_empty() && !absent_tool_matches.is_empty() {
        format!(
            "；请求匹配 {} 个故意缺席的工具族，请按替代路径处理",
            absent_tool_matches.len()
        )
    } else if matched_tool_ids.is_empty() {
        "；未匹配到当前暴露的 MCP tools".to_owned()
    } else {
        String::new()
    };
    let entities = matched_tool_ids
        .iter()
        .map(|tool_id| json!({ "type": "mcpTool", "id": tool_id }))
        .collect::<Vec<_>>();

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Kerminal 工具帮助已读取：matchMode={match_mode}，匹配 {} 个当前暴露 tools{}。",
            matched_tool_ids.len(),
            summary_suffix
        )),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "purpose": "Return schema-backed help for currently exposed Kerminal MCP tools without executing the selected tools.",
            "filters": {
                "toolId": requested_tool_id,
                "family": requested_family,
                "query": requested_query,
                "includeSchemas": include_schemas
            },
            "matchMode": match_mode,
            "matchedToolCount": matched_tool_ids.len(),
            "toolReference": tool_reference,
            "availableToolIds": matched_tool_ids,
            "missingToolIds": missing_tool_ids,
            "absentToolMatches": absent_tool_matches,
            "deliberatelyAbsentToolFamilies": absent_tool_families(),
            "fallbacks": [
                "Call kerminal.operation_guide when you need a task sequence rather than a single tool schema.",
                "Use tools/list for the raw MCP protocol list when your host needs the unprocessed catalog.",
                "For file-backed configuration, read kerminal-config.md or call kerminal.config_guide, edit files directly, then call kerminal.config.validate."
            ],
            "safetyBoundaries": {
                "readOnly": "kerminal.tool_help is read-only and never invokes the referenced tool.",
                "hostPolicy": "The MCP host owns confirmation, approval, permissions, hooks, and audit before write or destructive tools.",
                "fileFirstConfiguration": "settings/profile/host/snippet/workflow CRUD tools are deliberately absent; use direct file edits plus validation.",
                "secrets": "Do not extract or print stored secrets. Authorized credential writes use kerminal.host.upsert_with_credential or kerminal.vault.encrypt_secret."
            },
            "nextActions": [
                "Call the selected read-only discovery or runtime tool only after checking required arguments.",
                "For terminal.write, resolve and inspect the target first; session-bound writes require agentSessionId, bindingGeneration, and data.",
                "For destructive tools, require clear user intent and host-side approval/audit."
            ]
        })),
        entities,
        next_hints: vec![
            "Use kerminal.operation_guide for task-level call order.".to_owned(),
            "Use kerminal.config_guide and kerminal.config.validate for file-backed configuration work.".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

pub(super) fn execute_kerminal_operation_guide(
    tools: &[ToolDefinition],
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let exposed_tools = exposed_tool_definitions(tools);
    let requested_intent = arguments
        .get("intent")
        .and_then(Value::as_str)
        .unwrap_or("overview")
        .trim();
    let goal = arguments
        .get("goal")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let plan = operation_guide_plan(requested_intent);
    let first_calls = available_tool_ids(&exposed_tools, &plan.recommended_first_calls);
    let referenced_tool_ids = unique_tool_ids(
        plan.recommended_first_calls
            .iter()
            .chain(plan.referenced_tool_ids.iter())
            .copied()
            .collect(),
    );
    let available_referenced_tool_ids = available_tool_ids(&exposed_tools, &referenced_tool_ids);
    let missing_referenced_tool_ids = missing_tool_ids(&exposed_tools, &referenced_tool_ids);
    let tool_reference = tool_references(&exposed_tools, &available_referenced_tool_ids);
    let intent_note = if plan.intent == requested_intent || requested_intent.is_empty() {
        None
    } else {
        Some(format!(
            "Unsupported intent `{requested_intent}` was normalized to `{}`.",
            plan.intent
        ))
    };

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Kerminal 操作指南已读取：intent={}；返回 {} 个步骤，{} 个当前可用相关 tools。",
            plan.intent,
            plan.workflow.len(),
            available_referenced_tool_ids.len()
        )),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "intent": plan.intent,
            "requestedIntent": requested_intent,
            "goal": goal,
            "note": intent_note,
            "purpose": "Give external AI agents a concrete, safety-aware sequence for operating Kerminal through runtime MCP tools while keeping file-backed configuration file-first.",
            "recommendedFirstCalls": first_calls,
            "workflow": plan.workflow.clone(),
            "toolReference": tool_reference,
            "requiredContextFiles": [
                "AGENTS.md",
                "CLAUDE.md",
                "context/mcp-endpoint.json",
                "context/target-binding.json",
                "context/terminal-snapshot.json",
                "kerminal-config.md"
            ],
            "fileFirstConfiguration": {
                "readBeforeEditing": "kerminal-config.md or kerminal.config_guide",
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
                "mcpCrudBoundary": "Do not look for settings.*, profile.*, remote_host.*, snippet.*, workflow.*, or workspace.* MCP CRUD tools. Edit files directly and validate.",
                "secretBoundary": "Do not read or edit secrets/vault*.toml directly. Authorized credential work uses kerminal.host.upsert_with_credential or kerminal.vault.encrypt_secret."
            },
            "safetyBoundaries": {
                "hostPolicy": "The MCP host owns confirmation, approval, permissions, hooks, and audit.",
                "terminalWrite": "Before terminal.write, resolve and inspect the target; session-bound writes require agentSessionId, bindingGeneration, and data.",
                "remoteWrite": "For remote file deletes, tmux kills, port-forward closes, credential writes, and production hosts, rely on host approval and user intent before calling write/destructive tools.",
                "secrets": "Never copy passwords, tokens, private keys, vault keys, or decrypted secret material into chat, docs, logs, ordinary config files, or diagnostics."
            },
            "deliberatelyAbsentToolFamilies": absent_tool_families(),
            "availableReferencedToolIds": available_referenced_tool_ids.clone(),
            "missingReferencedToolIds": missing_referenced_tool_ids,
            "fallbacks": plan.fallbacks.clone(),
            "stopConditions": [
                "The requested target terminal is stale, closed, missing, or generation-mismatched.",
                "The task requires config CRUD tools that are intentionally absent; switch to direct file edits plus validation.",
                "The task asks for secret extraction, vault file editing, or plaintext credential disclosure.",
                "A destructive remote action, production write, or external side effect lacks clear user intent or host approval."
            ]
        })),
        entities: available_referenced_tool_ids
            .iter()
            .map(|tool_id| {
                json!({
                    "type": "mcpTool",
                    "id": tool_id
                })
            })
            .collect(),
        next_hints: plan
            .next_hints
            .iter()
            .map(|hint| (*hint).to_owned())
            .collect(),
        ..ToolExecutionResult::default()
    }
}

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
                "targetRef": session.target_ref
            })
        })
        .collect::<Vec<_>>();

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
            "targetRef": session.target_ref
        })
    }));
    entities.extend(agent_sessions.iter().map(|record| {
        json!({
            "type": "agentSession",
            "id": record.session.agent_session_id.as_str(),
            "status": record.session.status,
            "title": record.session.title
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
            "Kerminal 运行态快照已读取：{} 个终端，{} 个 Agent session，{} 个端口转发（{} 个运行中），{} 个本机代理入口，{} 个 MCP tools{}。",
            terminals.len(),
            agent_sessions.len(),
            port_forwards.len(),
            running_port_forwards,
            local_proxy_entry_count,
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
                "localProxyEntryCount": local_proxy_entry_count
            },
            "terminalSessions": terminal_summaries,
            "agentSessions": agent_session_summaries,
            "portForwards": port_forward_summaries,
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
                "For config edits, read kerminal-config.md or call kerminal.config_guide, edit files directly, then call kerminal.config.validate."
            ]
        })),
        entities,
        next_hints: vec![
            "For live terminal work, inspect terminalSessions and resolve the target before terminal.write.".to_owned(),
            "For host ids, read file-backed hosts/*.toml or use the bound target context; remote_host.* MCP tools are intentionally absent.".to_owned(),
            "For config edits, validate with kerminal.config.validate after direct file edits.".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

fn exposed_tool_definitions(tools: &[ToolDefinition]) -> Vec<&ToolDefinition> {
    tools
        .iter()
        .filter(|tool| tool.enabled && tool.exposed_to_mcp)
        .collect()
}

fn runtime_snapshot_diagnostic(source: &str, message: String) -> Value {
    json!({
        "source": source,
        "severity": "warning",
        "message": message
    })
}

fn serialized_name<T: Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "unknown".to_owned())
}

fn capability_family(
    family: &str,
    use_when: &str,
    tools: &[&ToolDefinition],
    prefixes_or_ids: &[&str],
) -> Value {
    let tool_ids = tools
        .iter()
        .filter(|tool| {
            prefixes_or_ids
                .iter()
                .any(|prefix_or_id| tool.id == *prefix_or_id || tool.id.starts_with(*prefix_or_id))
        })
        .map(|tool| tool.id.as_str())
        .collect::<Vec<_>>();

    json!({
        "family": family,
        "useWhen": use_when,
        "toolIds": tool_ids
    })
}

fn app_task_route(task: &str, route: &str, tool_ids: &[&str]) -> Value {
    json!({
        "task": task,
        "route": route,
        "toolIds": tool_ids
    })
}

struct OperationGuidePlan {
    intent: &'static str,
    recommended_first_calls: Vec<&'static str>,
    workflow: Vec<Value>,
    referenced_tool_ids: Vec<&'static str>,
    fallbacks: Vec<&'static str>,
    next_hints: Vec<&'static str>,
}

fn operation_guide_plan(requested_intent: &str) -> OperationGuidePlan {
    let normalized_intent = requested_intent
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");

    match normalized_intent.as_str() {
        "terminal" => guide_plan(
            "terminal",
            vec!["kerminal.runtime_snapshot", "terminal.list"],
            vec![
                guide_step(
                    "discover",
                    Some("terminal.list"),
                    "List live terminal sessions and choose an explicit target session id.",
                    &[],
                    "There is no implicit target in the global workspace.",
                ),
                guide_step(
                    "inspect",
                    Some("terminal.snapshot"),
                    "Read recent output before deciding whether to write.",
                    &["sessionId"],
                    "Do not write to a terminal whose purpose is unclear.",
                ),
                guide_step(
                    "act",
                    Some("terminal.write"),
                    "Write only the requested input to the selected live terminal.",
                    &["sessionId", "data"],
                    "MCP host confirmation owns approval; never infer a target from filenames.",
                ),
            ],
            vec!["terminal.snapshot", "terminal.write"],
            vec![
                "If no live terminal exists, ask the user to create or bind one in Kerminal.",
                "If the terminal output is ambiguous, ask before writing.",
            ],
            vec!["Use session-terminal intent inside an Agent session workspace."],
        ),
        "session-terminal" | "session" | "agent" => guide_plan(
            "session-terminal",
            vec![
                "kerminal.runtime_snapshot",
                "kerminal.agent.current_session",
                "kerminal.agent.target_context",
            ],
            vec![
                guide_step(
                    "read-context",
                    None,
                    "Read context/mcp-endpoint.json, context/target-binding.json, and context/terminal-snapshot.json.",
                    &["session workspace"],
                    "These files seed the session-scoped endpoint and last known target; refresh with live tools before writes.",
                ),
                guide_step(
                    "resolve",
                    Some("kerminal.agent.target_context"),
                    "Resolve the current Agent target and refresh the bounded terminal snapshot.",
                    &["agentSessionId"],
                    "Stop if target status is stale, missing, closed, or generation-mismatched.",
                ),
                guide_step(
                    "inspect",
                    Some("terminal.snapshot"),
                    "Inspect the bound target output before acting.",
                    &["agentSessionId"],
                    "Use the returned binding generation for subsequent writes.",
                ),
                guide_step(
                    "act",
                    Some("terminal.write"),
                    "Write to the bound target using agentSessionId, bindingGeneration, and data.",
                    &["agentSessionId", "bindingGeneration", "data"],
                    "Never substitute a guessed sessionId when the binding is invalid.",
                ),
            ],
            vec!["terminal.snapshot", "terminal.write", "terminal.resolve_agent_target"],
            vec![
                "If the target is stale, ask the user to rebind the Agent session in Kerminal.",
                "If the session-scoped endpoint is unavailable, use the global endpoint only with an explicit live sessionId.",
            ],
            vec!["Call kerminal.agent.target_context again after a target rebind."],
        ),
        "ssh-command" | "ssh" => guide_plan(
            "ssh-command",
            vec!["kerminal.runtime_snapshot", "ssh.command_on_resolved_host"],
            vec![
                guide_step(
                    "target",
                    None,
                    "Identify the host id from the bound Agent target or by reading hosts/*.toml.",
                    &["host id or target context"],
                    "Do not add remote_host.* expectations; host metadata is file-backed.",
                ),
                guide_step(
                    "execute",
                    Some("ssh.command_on_resolved_host"),
                    "Run a non-interactive command on a saved host through Kerminal credentials.",
                    &["hostId", "command"],
                    "Avoid interactive commands; use terminal tools for interactive shells.",
                ),
                guide_step(
                    "fallback",
                    Some("ssh.command"),
                    "Use direct SSH command execution when the request provides an explicit target ref accepted by the tool schema.",
                    &["target", "command"],
                    "Do not embed passwords, tokens, or private keys in commands.",
                ),
            ],
            vec!["ssh.command", "kerminal.agent.target_context"],
            vec![
                "If host metadata is missing, edit hosts/*.toml directly and validate before running commands.",
                "If credentials are missing, ask for authorization and use credential tools; do not read secrets/.",
            ],
            vec!["For repeated interactive work, ask the user to open or bind a terminal."],
        ),
        "sftp" => guide_plan(
            "sftp",
            vec!["sftp.list"],
            vec![
                guide_step(
                    "browse",
                    Some("sftp.list"),
                    "List the remote directory before previewing or transferring files.",
                    &["hostId", "path"],
                    "Use saved Kerminal host credentials; do not read vault files.",
                ),
                guide_step(
                    "inspect",
                    Some("sftp.preview"),
                    "Preview text-like files before editing or transferring when the user needs content context.",
                    &["hostId", "path"],
                    "Avoid dumping large or sensitive files into chat.",
                ),
                guide_step(
                    "transfer",
                    Some("sftp.transfer.enqueue"),
                    "Queue upload/download/copy style transfer work when a managed transfer is needed.",
                    &["operation", "source", "destination"],
                    "Confirm overwrite/delete semantics through the MCP host for risky paths.",
                ),
            ],
            vec![
                "sftp.preview",
                "sftp.upload",
                "sftp.upload_directory",
                "sftp.download",
                "sftp.download_directory",
                "sftp.rename",
                "sftp.move",
                "sftp.create_directory",
                "sftp.chmod",
                "sftp.delete",
                "sftp.transfer.enqueue",
                "sftp.transfer.list",
                "sftp.transfer.cancel",
                "sftp.transfer.clear_completed",
            ],
            vec![
                "If the host id is unknown, read hosts/*.toml directly or use the bound target context.",
                "If a destructive remote file operation is requested, rely on host approval and clear user intent.",
            ],
            vec!["Use sftp.transfer.list after enqueueing long-running transfers."],
        ),
        "tmux" => guide_plan(
            "tmux",
            vec!["tmux.probe", "tmux.list_sessions"],
            vec![
                guide_step(
                    "probe",
                    Some("tmux.probe"),
                    "Check whether tmux is available on the local or SSH target.",
                    &["targetKind"],
                    "Do not assume tmux exists just because a terminal is running.",
                ),
                guide_step(
                    "discover",
                    Some("tmux.list_sessions"),
                    "List sessions before creating, attaching, renaming, killing, or capturing panes.",
                    &["targetKind"],
                    "Use list_windows/list_panes before pane-specific operations.",
                ),
                guide_step(
                    "inspect",
                    Some("tmux.capture_pane"),
                    "Capture pane output for context.",
                    &["session", "window", "pane"],
                    "Limit output size and avoid leaking secrets from scrollback.",
                ),
            ],
            vec![
                "tmux.create_session",
                "tmux.rename_session",
                "tmux.kill_session",
                "tmux.list_windows",
                "tmux.list_panes",
                "tmux.capture_pane",
                "tmux.attach_plan",
            ],
            vec![
                "If tmux is unavailable, use ordinary terminal or SSH command tools.",
                "Treat tmux.kill_session as destructive and require clear user intent.",
            ],
            vec!["Use tmux.attach_plan to explain how the user can attach from the UI/terminal."],
        ),
        "container" | "docker" | "podman" => guide_plan(
            "container",
            vec!["container.list"],
            vec![
                guide_step(
                    "discover",
                    Some("container.list"),
                    "List containers on the SSH host.",
                    &["hostId"],
                    "Container tools inspect runtime state; host definitions remain file-backed.",
                ),
                guide_step(
                    "inspect",
                    Some("container.inspect"),
                    "Read inspect summary before lifecycle changes or deep troubleshooting.",
                    &["hostId", "containerId"],
                    "Inspect output is summarized; avoid copying raw inspect JSON into chat unless needed.",
                ),
                guide_step(
                    "observe",
                    Some("container.logs.tail"),
                    "Tail recent container logs for runtime context.",
                    &["hostId", "containerId", "tail"],
                    "Keep tail bounded and avoid exposing secrets from application logs.",
                ),
                guide_step(
                    "stats",
                    Some("container.stats"),
                    "Read a one-shot no-stream stats snapshot.",
                    &["hostId", "containerId"],
                    "Stats are read-only but still execute remotely through the saved host.",
                ),
                guide_step(
                    "files",
                    Some("container.files.list"),
                    "List files inside a selected container path.",
                    &["hostId", "containerId", "path"],
                    "Prefer preview before copying sensitive paths into chat.",
                ),
                guide_step(
                    "preview",
                    Some("container.files.preview"),
                    "Preview a file inside the selected container.",
                    &["hostId", "containerId", "path"],
                    "Avoid large binary or secret-like paths.",
                ),
                guide_step(
                    "write-text",
                    Some("container.files.write_text"),
                    "Write UTF-8 text inside the selected container, using expectedRevision when editing an existing file.",
                    &["hostId", "containerId", "path", "content", "encoding"],
                    "For existing files, preview/read first and avoid overwriteOnConflict unless the user explicitly accepts replacement.",
                ),
                guide_step(
                    "transfer",
                    Some("container.files.upload"),
                    "Upload local files or directories into a container, or use container.files.download for the reverse direction.",
                    &["hostId", "containerId", "localPath", "remotePath", "kind"],
                    "Transfers are remote side effects; confirm destination, kind, and overwrite expectations first.",
                ),
                guide_step(
                    "manage-files",
                    Some("container.files.rename"),
                    "Create directories, rename paths, chmod paths, or delete only an explicitly selected container path.",
                    &["hostId", "containerId", "path"],
                    "container.files.delete is destructive and requires clear user intent plus host approval/audit.",
                ),
                guide_step(
                    "lifecycle",
                    Some("container.restart"),
                    "Start, stop, restart, or remove only the explicitly selected container.",
                    &["hostId", "containerId"],
                    "Lifecycle changes are remote side effects; container.remove is destructive and requires clear user intent.",
                ),
            ],
            vec![
                "container.inspect",
                "container.logs.tail",
                "container.stats",
                "container.start",
                "container.stop",
                "container.restart",
                "container.remove",
                "container.files.list",
                "container.files.preview",
                "container.files.write_text",
                "container.files.create_directory",
                "container.files.rename",
                "container.files.chmod",
                "container.files.upload",
                "container.files.download",
                "container.files.delete",
            ],
            vec![
                "If the host id is unknown, read hosts/*.toml directly or use the bound target context.",
                "Use SSH command tools only for container actions that are not exposed as dedicated MCP tools.",
            ],
            vec![
                "For destructive lifecycle or container file deletion work, inspect first and rely on host approval/audit before calling remove/delete.",
            ],
        ),
        "port-forward" | "port" | "forward" => guide_plan(
            "port-forward",
            vec!["port_forward.list"],
            vec![
                guide_step(
                    "discover",
                    Some("port_forward.list"),
                    "List existing managed port forwards and local proxy entries.",
                    &[],
                    "Reuse a running forward when it already matches the target.",
                ),
                guide_step(
                    "create",
                    Some("port_forward.create"),
                    "Create a managed SSH port forward for an explicit host and target port.",
                    &["hostId", "targetHost", "targetPort"],
                    "Avoid binding public interfaces unless the user explicitly asks.",
                ),
                guide_step(
                    "close",
                    Some("port_forward.close"),
                    "Close only the managed forward selected by id.",
                    &["id"],
                    "Closing is disruptive; confirm the selected id and purpose first.",
                ),
            ],
            vec!["port_forward.create", "port_forward.close"],
            vec![
                "If the local port is busy, choose another port or ask the user.",
                "If the host id is missing, edit/read hosts/*.toml directly before creating a forward.",
            ],
            vec!["Call kerminal.runtime_snapshot to see running forward counts in a broader runtime view."],
        ),
        "server-info" | "server" | "info" => guide_plan(
            "server-info",
            vec!["server_info.snapshot"],
            vec![guide_step(
                "snapshot",
                Some("server_info.snapshot"),
                "Read machine health and system summary for a saved SSH host.",
                &["hostId"],
                "This is read-only but still uses saved host access; do not expose secrets from diagnostics.",
            )],
            vec![],
            vec!["If host id is unknown, read hosts/*.toml directly or use the bound target context."],
            vec!["Use diagnostics.runtime_health for local Kerminal process health instead."],
        ),
        "history" => guide_plan(
            "history",
            vec!["history.search"],
            vec![guide_step(
                "search",
                Some("history.search"),
                "Search command history for relevant prior commands.",
                &["query"],
                "History is read-only over MCP; history.record/delete/clear tools are intentionally absent.",
            )],
            vec![],
            vec!["Do not edit data/command.sqlite directly."],
            vec!["Use terminal snapshots or SSH logs for live output, not history search."],
        ),
        "config" | "configuration" => guide_plan(
            "config",
            vec!["kerminal.config_guide", "kerminal.config.validate"],
            vec![
                guide_step(
                    "read-guide",
                    Some("kerminal.config_guide"),
                    "Read the generated Kerminal configuration guide before editing any Kerminal configuration file. In an initialized workspace, kerminal-config.md contains the same rules.",
                    &["kerminal-config.md or MCP access"],
                    "Do not guess field names or relationships from filenames alone.",
                ),
                guide_step(
                    "edit-files",
                    None,
                    "Edit only the requested file-backed config: settings.toml, profiles/*.toml, hosts/groups.toml, hosts/*.toml, snippets/*.toml, or workflows/*.toml.",
                    &["direct file edit"],
                    "Preserve comments, ids, unknown fields, timestamps, and ordering unless the request needs a change.",
                ),
                guide_step(
                    "validate",
                    Some("kerminal.config.validate"),
                    "Validate with scope all or the narrowest matching scope.",
                    &["scope"],
                    "Fix every diagnostic before reporting success; auto-refresh notices do not replace validation.",
                ),
            ],
            vec![],
            vec![
                "If MCP is unavailable, manually check kerminal-config.md and state that validation was manual only.",
                "If credential material is involved, switch to credentials intent and do not edit secrets/vault*.toml directly.",
            ],
            vec!["Never add MCP config CRUD tools for settings/profile/host/snippet/workflow edits."],
        ),
        "credentials" | "credential" | "vault" | "secret" => guide_plan(
            "credentials",
            vec![
                "kerminal.host.upsert_with_credential",
                "kerminal.vault.encrypt_secret",
                "kerminal.config.validate",
            ],
            vec![
                guide_step(
                    "authorize",
                    None,
                    "Proceed only when the user explicitly asks for credential save or rotation work.",
                    &["explicit user intent"],
                    "Never extract or reveal existing secret material.",
                ),
                guide_step(
                    "save-host",
                    Some("kerminal.host.upsert_with_credential"),
                    "Create or update a host and save the provided credential into the encrypted vault.",
                    &["host metadata", "credential material"],
                    "Ordinary hosts/*.toml must keep only secret_ref, not plaintext.",
                ),
                guide_step(
                    "encrypt",
                    Some("kerminal.vault.encrypt_secret"),
                    "Encrypt authorized secret material for an existing host reference.",
                    &["kind", "hostId", "scope", "material", "plaintext"],
                    "Do not copy plaintext into docs, logs, chat, or tests.",
                ),
                guide_step(
                    "validate",
                    Some("kerminal.config.validate"),
                    "Validate host configuration after credential save.",
                    &["scope=hosts"],
                    "Do not read or edit secrets/vault*.toml directly.",
                ),
            ],
            vec![],
            vec![
                "If the user asks to inspect stored secrets, refuse plaintext extraction and offer connection testing or credential rotation.",
                "If the credential belongs in ssh-agent or a local key file, store only the reference in host TOML.",
            ],
            vec!["Credential tools are write tools; the MCP host owns confirmation and audit."],
        ),
        "diagnostics" | "diagnostic" => guide_plan(
            "diagnostics",
            vec!["kerminal.runtime_snapshot", "diagnostics.runtime_health"],
            vec![
                guide_step(
                    "runtime",
                    Some("kerminal.runtime_snapshot"),
                    "Read current terminal, Agent session, port-forward, and MCP tool counts.",
                    &[],
                    "Snapshot is summarized and does not read secrets.",
                ),
                guide_step(
                    "health",
                    Some("diagnostics.runtime_health"),
                    "Read local Kerminal process, system, storage, and command database health.",
                    &[],
                    "Output is summarized for external agents.",
                ),
                guide_step(
                    "bundle",
                    Some("diagnostics.create_bundle"),
                    "Create a redacted diagnostic bundle when the user needs a support artifact.",
                    &[],
                    "Do not attach or paste sensitive raw files; rely on redaction.",
                ),
            ],
            vec!["diagnostics.create_bundle", "kerminal.config.validate"],
            vec![
                "If the issue is a bad config edit, run kerminal.config.validate first.",
                "If the issue is terminal-specific, inspect the target with terminal.snapshot or kerminal.agent.target_context.",
            ],
            vec!["Use kerminal.operation_guide with a narrower intent after the failing subsystem is known."],
        ),
        _ => guide_plan(
            "overview",
            vec!["kerminal.runtime_snapshot"],
            vec![
                guide_step(
                    "discover",
                    Some("kerminal.capabilities"),
                    "Read the current tool map, runtime families, file-first config boundary, and intentionally absent tools.",
                    &[],
                    "Use kerminal.tool_help for exact schemas, examples, and safety annotations before calling a runtime tool.",
                ),
                guide_step(
                    "snapshot",
                    Some("kerminal.runtime_snapshot"),
                    "Read the current running terminals, Agent sessions, port forwards, local proxy entries, and next actions.",
                    &[],
                    "The snapshot is a summary; use specialized tools for details.",
                ),
                guide_step(
                    "narrow",
                    Some("kerminal.operation_guide"),
                    "Call this tool again with a narrower intent such as terminal, session-terminal, config, sftp, tmux, credentials, or diagnostics.",
                    &["intent"],
                    "Choose the intent from the user's requested action, not from guessed files.",
                ),
            ],
            vec![],
            vec![
                "If the task is file-backed config, read kerminal-config.md and edit files directly.",
                "If the task requires live runtime state, use MCP tools after checking capabilities and snapshots.",
            ],
            vec!["Start with overview when the task type is unclear."],
        ),
    }
}

fn guide_plan(
    intent: &'static str,
    extra_first_calls: Vec<&'static str>,
    workflow: Vec<Value>,
    referenced_tool_ids: Vec<&'static str>,
    fallbacks: Vec<&'static str>,
    next_hints: Vec<&'static str>,
) -> OperationGuidePlan {
    let mut recommended_first_calls = vec![
        "kerminal.capabilities",
        "kerminal.tool_help",
        "kerminal.operation_guide",
    ];
    recommended_first_calls.extend(extra_first_calls);
    let recommended_first_calls = unique_tool_ids(recommended_first_calls);
    let mut all_referenced_tool_ids = recommended_first_calls.clone();
    all_referenced_tool_ids.extend(referenced_tool_ids);

    OperationGuidePlan {
        intent,
        recommended_first_calls,
        workflow,
        referenced_tool_ids: unique_tool_ids(all_referenced_tool_ids),
        fallbacks,
        next_hints,
    }
}

fn guide_step(
    phase: &str,
    tool_id: Option<&str>,
    action: &str,
    requires: &[&str],
    safety: &str,
) -> Value {
    json!({
        "phase": phase,
        "toolId": tool_id,
        "action": action,
        "requires": requires,
        "safety": safety,
        "exampleArguments": tool_id.and_then(example_arguments_for)
    })
}

fn optional_nonempty_argument(
    arguments: &serde_json::Map<String, Value>,
    name: &str,
) -> Option<String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn tool_ids_for_help_family<'a>(
    tools: &[&'a ToolDefinition],
    requested_family: &str,
) -> Vec<&'a str> {
    let normalized_family = requested_family
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");
    match normalized_family.as_str() {
        "discovery" | "guide" | "guides" => tool_ids_matching_prefixes(
            tools,
            &[
                "kerminal.app_guide",
                "kerminal.config_guide",
                "kerminal.capabilities",
                "kerminal.tool_help",
                "kerminal.operation_guide",
                "kerminal.runtime_snapshot",
            ],
        ),
        "agent" | "agent-session" | "session" => tool_ids_matching_prefixes(
            tools,
            &[
                "kerminal.agent.",
                "terminal.resolve_agent_target",
                "terminal.snapshot",
                "terminal.write",
            ],
        ),
        "terminal" => tool_ids_matching_prefixes(tools, &["terminal."]),
        "ssh" | "ssh-command" => tool_ids_matching_prefixes(tools, &["ssh."]),
        "sftp" => tool_ids_matching_prefixes(tools, &["sftp."]),
        "tmux" => tool_ids_matching_prefixes(tools, &["tmux."]),
        "container" | "docker" | "podman" => tool_ids_matching_prefixes(tools, &["container."]),
        "port" | "port-forward" | "port-forwarding" => {
            tool_ids_matching_prefixes(tools, &["port_forward."])
        }
        "server" | "server-info" => tool_ids_matching_prefixes(tools, &["server_info."]),
        "history" => tool_ids_matching_prefixes(tools, &["history."]),
        "diagnostics" | "diagnostic" => tool_ids_matching_prefixes(
            tools,
            &[
                "diagnostics.",
                "kerminal.app_guide",
                "kerminal.config_guide",
                "kerminal.capabilities",
                "kerminal.tool_help",
                "kerminal.operation_guide",
                "kerminal.runtime_snapshot",
                "kerminal.config.validate",
            ],
        ),
        "config" | "configuration" => tool_ids_matching_prefixes(
            tools,
            &["kerminal.config_guide", "kerminal.config.validate"],
        ),
        "credentials" | "credential" | "vault" | "secret" => {
            tool_ids_matching_prefixes(tools, &["kerminal.host.", "kerminal.vault."])
        }
        _ => Vec::new(),
    }
}

fn tool_ids_matching_prefixes<'a>(
    tools: &[&'a ToolDefinition],
    prefixes_or_ids: &[&str],
) -> Vec<&'a str> {
    tools
        .iter()
        .filter(|tool| {
            prefixes_or_ids
                .iter()
                .any(|prefix_or_id| tool.id == *prefix_or_id || tool.id.starts_with(*prefix_or_id))
        })
        .map(|tool| tool.id.as_str())
        .collect()
}

fn tool_ids_for_help_query<'a>(
    tools: &[&'a ToolDefinition],
    requested_query: &str,
) -> Vec<&'a str> {
    let normalized_query = requested_query.trim().to_ascii_lowercase();
    if normalized_query.is_empty() {
        return Vec::new();
    }

    tools
        .iter()
        .filter(|tool| {
            tool.id.to_ascii_lowercase().contains(&normalized_query)
                || tool.title.to_ascii_lowercase().contains(&normalized_query)
                || tool
                    .description
                    .to_ascii_lowercase()
                    .contains(&normalized_query)
                || tool
                    .category
                    .label()
                    .to_ascii_lowercase()
                    .contains(&normalized_query)
        })
        .map(|tool| tool.id.as_str())
        .collect()
}

fn matching_absent_tool_families(filter: Option<&str>) -> Vec<&'static str> {
    let Some(filter) = filter else {
        return Vec::new();
    };
    let normalized_filter = filter.trim().to_ascii_lowercase();
    let dashed_filter = normalized_filter.replace('_', "-");

    absent_tool_families()
        .into_iter()
        .filter(|family| {
            let family_lower = family.to_ascii_lowercase();
            let family_token = family_lower
                .trim_end_matches('*')
                .trim_end_matches('.')
                .to_owned();
            let dashed_family_token = family_token.replace('_', "-");

            normalized_filter.contains(&family_token)
                || dashed_filter.contains(&dashed_family_token)
                || family_lower.contains(&normalized_filter)
        })
        .collect()
}

fn tool_references(tools: &[&ToolDefinition], tool_ids: &[&str]) -> Vec<Value> {
    tool_ids
        .iter()
        .filter_map(|tool_id| {
            tools
                .iter()
                .find(|tool| tool.id.as_str() == *tool_id)
                .map(|tool| {
                    json!({
                        "id": tool.id.as_str(),
                        "title": tool.title.as_str(),
                        "description": tool.description.as_str(),
                        "category": tool.category.clone(),
                        "categoryLabel": tool.category.label(),
                        "annotations": {
                            "readOnlyHint": tool.annotations.read_only_hint,
                            "destructiveHint": tool.annotations.destructive_hint,
                            "idempotentHint": tool.annotations.idempotent_hint,
                            "openWorldHint": tool.annotations.open_world_hint
                        },
                        "inputSchema": tool.input_schema.clone(),
                        "exampleArguments": example_arguments_for(tool.id.as_str())
                    })
                })
        })
        .collect()
}

fn example_arguments_for(tool_id: &str) -> Option<Value> {
    match tool_id {
        "kerminal.capabilities" | "kerminal.runtime_snapshot" | "terminal.list" => Some(json!({})),
        "kerminal.operation_guide" => Some(json!({
            "intent": "session-terminal",
            "goal": "Inspect and operate the currently bound Kerminal target safely."
        })),
        "kerminal.tool_help" => Some(json!({
            "toolId": "terminal.write",
            "includeSchemas": true
        })),
        "kerminal.agent.current_session" => Some(json!({
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>"
        })),
        "kerminal.agent.target_context" => Some(json!({
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>",
            "maxBytes": 24576
        })),
        "terminal.resolve_agent_target" => Some(json!({
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>"
        })),
        "terminal.snapshot" => Some(json!({
            "agentSessionId": "<agent-session-id>",
            "maxBytes": 24576
        })),
        "terminal.write" => Some(json!({
            "agentSessionId": "<agent-session-id>",
            "bindingGeneration": 7,
            "data": "pwd\n"
        })),
        "terminal.resize" => Some(json!({
            "sessionId": "<terminal-session-id>",
            "cols": 120,
            "rows": 32
        })),
        "terminal.close" | "terminal.log.start" | "terminal.log.stop" | "terminal.log.state" => {
            Some(json!({
                "sessionId": "<terminal-session-id>"
            }))
        }
        "ssh.command_on_resolved_host" => Some(json!({
            "hostId": "<host-id-from-hosts-toml-or-bound-target>",
            "command": "uname -a"
        })),
        "ssh.command" => Some(json!({
            "hostId": "<host-id>",
            "command": "uptime"
        })),
        "sftp.list" | "sftp.preview" => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app"
        })),
        "sftp.create_directory" => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app/new-directory"
        })),
        "sftp.rename" => Some(json!({
            "hostId": "<host-id>",
            "fromPath": "/srv/app/old-name.txt",
            "toPath": "/srv/app/new-name.txt"
        })),
        "sftp.move" => Some(json!({
            "hostId": "<host-id>",
            "fromPath": "/srv/app/source.txt",
            "toPath": "/srv/app/archive/source.txt"
        })),
        "sftp.chmod" => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app/script.sh",
            "mode": "0755"
        })),
        "sftp.delete" => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app/obsolete.txt",
            "directory": false
        })),
        "sftp.upload" | "sftp.upload_directory" => Some(json!({
            "hostId": "<host-id>",
            "localPath": "C:/path/to/local/file-or-directory",
            "remotePath": "/srv/app/file-or-directory"
        })),
        "sftp.download" | "sftp.download_directory" => Some(json!({
            "hostId": "<host-id>",
            "remotePath": "/srv/app/file-or-directory",
            "localPath": "C:/path/to/local/file-or-directory"
        })),
        "sftp.transfer.enqueue" => Some(json!({
            "hostId": "<host-id>",
            "remotePath": "/srv/app/archive.tar.gz",
            "localPath": "C:/path/to/archive.tar.gz",
            "direction": "download",
            "kind": "file"
        })),
        "sftp.transfer.cancel" => Some(json!({
            "transferId": "<transfer-id-from-sftp.transfer.list>"
        })),
        "sftp.transfer.list" | "sftp.transfer.clear_completed" => Some(json!({})),
        "tmux.probe" | "tmux.list_sessions" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>"
        })),
        "tmux.create_session" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "name": "work"
        })),
        "tmux.rename_session" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "sessionId": "old-name",
            "name": "new-name"
        })),
        "tmux.kill_session" | "tmux.list_windows" | "tmux.attach_plan" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "sessionId": "work"
        })),
        "tmux.list_panes" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "targetId": "work:0"
        })),
        "tmux.capture_pane" => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "paneId": "%1",
            "lines": 200
        })),
        "container.list" => Some(json!({
            "hostId": "<host-id>",
            "runtime": "docker",
            "includeStopped": false
        })),
        "container.inspect" | "container.stats" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker"
        })),
        "container.logs.tail" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "tail": 120
        })),
        "container.start" | "container.stop" | "container.restart" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker"
        })),
        "container.remove" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "force": false
        })),
        "container.files.list" | "container.files.preview" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app"
        })),
        "container.files.write_text" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/config.local",
            "content": "KEY=value\n",
            "encoding": "utf-8",
            "create": true,
            "overwriteOnConflict": false
        })),
        "container.files.create_directory" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/new-directory"
        })),
        "container.files.rename" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "fromPath": "/app/old-name.txt",
            "toPath": "/app/new-name.txt"
        })),
        "container.files.chmod" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/script.sh",
            "mode": "0755"
        })),
        "container.files.upload" | "container.files.download" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "localPath": "C:/path/to/local/file-or-directory",
            "remotePath": "/app/file-or-directory",
            "kind": "file"
        })),
        "container.files.delete" => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/obsolete.txt",
            "directory": false
        })),
        "port_forward.list" => Some(json!({})),
        "port_forward.create" => Some(json!({
            "hostId": "<host-id>",
            "kind": "local",
            "bindHost": "127.0.0.1",
            "sourcePort": 15432,
            "targetHost": "127.0.0.1",
            "targetPort": 5432
        })),
        "port_forward.close" => Some(json!({
            "forwardId": "<port-forward-id-from-port_forward.list>"
        })),
        "server_info.snapshot" => Some(json!({
            "hostId": "<host-id>"
        })),
        "history.search" => Some(json!({
            "query": "docker compose",
            "limit": 20
        })),
        "kerminal.app_guide"
        | "kerminal.config_guide"
        | "diagnostics.runtime_health"
        | "diagnostics.create_bundle" => Some(json!({})),
        "kerminal.config.validate" => Some(json!({
            "scope": "all"
        })),
        "kerminal.host.upsert_with_credential" => Some(json!({
            "id": "<optional-host-id>",
            "name": "staging-web",
            "host": "staging.example.internal",
            "port": 22,
            "username": "deploy",
            "production": false,
            "password": "<credential-provided-by-user-for-this-save-only>"
        })),
        "kerminal.vault.encrypt_secret" => Some(json!({
            "kind": "ssh-host",
            "hostId": "<host-id>",
            "scope": "target",
            "material": "password",
            "plaintext": "<credential-provided-by-user-for-this-save-only>"
        })),
        _ => None,
    }
}

fn unique_tool_ids(ids: Vec<&'static str>) -> Vec<&'static str> {
    let mut unique = Vec::new();
    for id in ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    unique
}

fn available_tool_ids<'a>(
    tools: &[&ToolDefinition],
    candidate_tool_ids: &[&'a str],
) -> Vec<&'a str> {
    candidate_tool_ids
        .iter()
        .copied()
        .filter(|candidate| tools.iter().any(|tool| tool.id.as_str() == *candidate))
        .collect()
}

fn missing_tool_ids<'a>(tools: &[&ToolDefinition], candidate_tool_ids: &[&'a str]) -> Vec<&'a str> {
    candidate_tool_ids
        .iter()
        .copied()
        .filter(|candidate| tools.iter().all(|tool| tool.id.as_str() != *candidate))
        .collect()
}

fn absent_tool_families() -> Vec<&'static str> {
    vec![
        "settings.*",
        "profile.*",
        "remote_host.*",
        "snippet.*",
        "workflow.*",
        "workspace.*",
        "terminal.create",
        "terminal.resolve_current",
        "history.record",
        "history.delete",
        "history.clear",
        "pending/confirm/approval/audit queues",
    ]
}

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
                target: RemoteTargetRef::Ssh {
                    host_id: host_id.clone(),
                },
                host_id,
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
