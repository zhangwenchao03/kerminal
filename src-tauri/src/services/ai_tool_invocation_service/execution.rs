use super::*;

pub(super) async fn execute_tool(
    context: &AiToolExecutionContext<'_>,
    tool_id: &str,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    match tool_id {
        "terminal.create" => execute_terminal_create(arguments),
        "terminal.resolve_current" => execute_terminal_resolve_current(
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        "terminal.list" => execute_terminal_list(context.terminals),
        "terminal.close" => execute_terminal_close(context.terminals, arguments),
        "terminal.log.start" => {
            execute_terminal_log_start(context.terminals, context.paths, arguments)
        }
        "terminal.log.stop" => execute_terminal_log_stop(context.terminals, arguments),
        "terminal.log.state" => execute_terminal_log_state(context.terminals, arguments),
        "settings.get" => execute_settings_get(context.settings, context.storage),
        "settings.update_theme" => {
            execute_update_theme(context.settings, context.storage, arguments)
        }
        "settings.update_terminal_appearance" => {
            execute_update_terminal_appearance(context.settings, context.storage, arguments)
        }
        "settings.update_ai_security" => {
            execute_update_ai_security(context.settings, context.storage, arguments)
        }
        "workspace.focus_tab" => execute_workspace_focus_tab(arguments),
        "workspace.open_tool" => execute_workspace_open_tool(arguments),
        "llm_provider.list" => execute_llm_provider_list(context.rig_providers, context.storage),
        "llm_provider.create" => execute_llm_provider_create(
            context.rig_providers,
            context.storage,
            context.credentials,
            arguments,
        ),
        "llm_provider.update" => execute_llm_provider_update(
            context.rig_providers,
            context.storage,
            context.credentials,
            arguments,
        ),
        "llm_provider.delete" => execute_llm_provider_delete(
            context.rig_providers,
            context.storage,
            context.credentials,
            arguments,
        ),
        "llm_provider.test" => execute_llm_provider_test(
            context.rig_providers,
            context.storage,
            context.credentials,
            arguments,
        ),
        "profile.list" => execute_profile_list(context.profiles, context.storage),
        "profile.detect_shells" => execute_profile_detect_shells(context.profiles),
        "profile.create" => execute_profile_create(context.profiles, context.storage, arguments),
        "profile.update" => execute_profile_update(context.profiles, context.storage, arguments),
        "profile.delete" => execute_profile_delete(context.profiles, context.storage, arguments),
        "remote_host.group_list" => {
            execute_remote_host_group_list(context.remote_hosts, context.storage)
        }
        "remote_host.tree" => execute_remote_host_tree(context.remote_hosts, context.storage),
        "remote_host.group_create" => {
            execute_remote_host_group_create(context.remote_hosts, context.storage, arguments)
        }
        "remote_host.group_update" => {
            execute_remote_host_group_update(context.remote_hosts, context.storage, arguments)
        }
        "remote_host.group_delete" => {
            execute_remote_host_group_delete(context.remote_hosts, context.storage, arguments)
        }
        "remote_host.create" => {
            execute_remote_host_create(context.remote_hosts, context.storage, arguments)
        }
        "remote_host.ensure" => {
            execute_remote_host_ensure(context.remote_hosts, context.storage, arguments)
        }
        "remote_host.last_used" => execute_remote_host_last_used(
            context.command_history,
            context.remote_hosts,
            context.storage,
            arguments,
        ),
        "remote_host.update" => {
            execute_remote_host_update(context.remote_hosts, context.storage, arguments)
        }
        "remote_host.delete" => {
            execute_remote_host_delete(context.remote_hosts, context.storage, arguments)
        }
        "ssh.connect" => execute_ssh_connect(context.remote_hosts, context.storage, arguments),
        "ssh.ensure_connected" => {
            execute_ssh_ensure_connected(context.remote_hosts, context.storage, arguments)
        }
        "ssh.command" => {
            execute_ssh_command(
                context.ssh_commands,
                context.command_history,
                context.paths,
                context.storage,
                arguments,
            )
            .await
        }
        "ssh.command_on_resolved_host" => {
            execute_ssh_command_on_resolved_host(
                context.ssh_commands,
                context.command_history,
                context.paths,
                context.remote_hosts,
                context.storage,
                arguments,
            )
            .await
        }
        "connection.rdp_open" => execute_connection_rdp_open(arguments),
        "server_info.snapshot" => {
            execute_server_info_snapshot(
                context.server_info,
                context.storage,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "diagnostics.runtime_health" => {
            execute_diagnostics_runtime_health(context.diagnostics, context.paths, context.storage)
        }
        "diagnostics.create_bundle" => execute_diagnostics_create_bundle(
            context.diagnostics,
            context.paths,
            context.storage,
            context.terminals,
        ),
        "sftp.list" => {
            execute_sftp_list(context.sftp, context.storage, context.paths, arguments).await
        }
        "sftp.rename" => {
            execute_sftp_rename(context.sftp, context.storage, context.paths, arguments).await
        }
        "sftp.move" => {
            execute_sftp_move(context.sftp, context.storage, context.paths, arguments).await
        }
        "sftp.preview" => {
            execute_sftp_preview(context.sftp, context.storage, context.paths, arguments).await
        }
        "sftp.create_directory" => {
            execute_sftp_create_directory(context.sftp, context.storage, context.paths, arguments)
                .await
        }
        "sftp.chmod" => {
            execute_sftp_chmod(context.sftp, context.storage, context.paths, arguments).await
        }
        "sftp.upload" => {
            execute_sftp_upload(context.sftp, context.storage, context.paths, arguments).await
        }
        "sftp.upload_directory" => {
            execute_sftp_upload_directory(context.sftp, context.storage, context.paths, arguments)
                .await
        }
        "sftp.download" => {
            execute_sftp_download(context.sftp, context.storage, context.paths, arguments).await
        }
        "sftp.download_directory" => {
            execute_sftp_download_directory(context.sftp, context.storage, context.paths, arguments)
                .await
        }
        "sftp.delete" => {
            execute_sftp_delete(context.sftp, context.storage, context.paths, arguments).await
        }
        "sftp.transfer.enqueue" => {
            execute_sftp_transfer_enqueue(context.sftp, context.storage, context.paths, arguments)
        }
        "sftp.transfer.list" => execute_sftp_transfer_list(context.sftp),
        "sftp.transfer.cancel" => execute_sftp_transfer_cancel(context.sftp, arguments),
        "sftp.transfer.clear_completed" => execute_sftp_transfer_clear_completed(context.sftp),
        "container.list" => {
            execute_container_list(
                context.docker_hosts,
                context.storage,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.list" => {
            execute_container_files_list(
                context.docker_hosts,
                context.storage,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.preview" => {
            execute_container_files_preview(
                context.docker_hosts,
                context.storage,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "port_forward.create" => execute_port_forward_create(
            context.port_forwards,
            context.local_network_proxy,
            context.storage,
            context.paths,
            arguments,
        ),
        "port_forward.list" => execute_port_forward_list(context.port_forwards, context.storage),
        "port_forward.close" => execute_port_forward_close(
            context.port_forwards,
            context.local_network_proxy,
            context.storage,
            arguments,
        ),
        "snippet.list" => execute_snippet_list(context.snippets, context.storage, arguments),
        "snippet.create" => execute_snippet_create(context.snippets, context.storage, arguments),
        "snippet.update" => execute_snippet_update(context.snippets, context.storage, arguments),
        "snippet.delete" => execute_snippet_delete(context.snippets, context.storage, arguments),
        "workflow.list" => execute_workflow_list(context.workflows, context.storage, arguments),
        "workflow.create" => execute_workflow_create(context.workflows, context.storage, arguments),
        "workflow.update" => execute_workflow_update(context.workflows, context.storage, arguments),
        "workflow.delete" => execute_workflow_delete(context.workflows, context.storage, arguments),
        "history.search" => {
            execute_history_search(context.command_history, context.storage, arguments)
        }
        "history.record" => {
            execute_history_record(context.command_history, context.storage, arguments)
        }
        "history.delete" => {
            execute_history_delete(context.command_history, context.storage, arguments)
        }
        "history.clear" => execute_history_clear(context.command_history, context.storage),
        "workspace.split_pane" => execute_workspace_split_pane(arguments),
        "terminal.resize" => execute_terminal_resize(context.terminals, arguments),
        "terminal.write" => execute_terminal_write(
            context.terminals,
            context.command_history,
            context.storage,
            arguments,
        ),
        _ => execute_custom_mcp_tool(context, tool_id, arguments).await,
    }
}

pub(super) async fn execute_custom_mcp_tool(
    context: &AiToolExecutionContext<'_>,
    tool_id: &str,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let settings = match context.settings.load_settings(context.storage) {
        Ok(settings) => settings,
        Err(error) => return failure(error.to_string()),
    };
    let Some((server, tool)) = settings
        .ai
        .mcp
        .servers
        .iter()
        .filter(|server| server.enabled)
        .find_map(|server| {
            server
                .tools
                .iter()
                .filter(|tool| tool.enabled)
                .find(|tool| custom_mcp_tool_id(&server.id, &tool.name) == tool_id)
                .map(|tool| (server.clone(), tool.clone()))
        })
    else {
        return ToolExecutionResult {
            status: AiToolInvocationStatus::Failed,
            result_summary: None,
            error: Some("该工具尚未接入受控执行器。".to_owned()),
            ..ToolExecutionResult::default()
        };
    };

    match call_mcp_server_tool(server, tool.name.clone(), arguments.clone()).await {
        Ok(result) => {
            let is_error = result.is_error.unwrap_or(false);
            ToolExecutionResult {
                status: if is_error {
                    AiToolInvocationStatus::Failed
                } else {
                    AiToolInvocationStatus::Succeeded
                },
                result_summary: Some(summarize_mcp_call_result(&tool.name, &result)),
                error: is_error.then(|| "MCP Server 返回 tool-level error。".to_owned()),
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => failure(error.to_string()),
    }
}
