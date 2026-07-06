use super::*;

pub(super) async fn execute_tool(
    context: &McpToolExecutionContext<'_>,
    tools: &[ToolDefinition],
    tool_id: &str,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    match tool_id {
        "kerminal.app_guide" => execute_kerminal_app_guide(tools),
        "kerminal.capabilities" => execute_kerminal_capabilities(tools),
        "kerminal.config_guide" => execute_kerminal_config_guide(),
        "kerminal.tool_help" => execute_kerminal_tool_help(tools, arguments),
        "kerminal.operation_guide" => execute_kerminal_operation_guide(tools, arguments),
        "kerminal.runtime_snapshot" => execute_kerminal_runtime_snapshot(context, tools),
        "terminal.list" => execute_terminal_list(context.terminals),
        "terminal.close" => execute_terminal_close(context.terminals, arguments),
        "terminal.log.start" => {
            execute_terminal_log_start(context.terminals, context.paths, arguments)
        }
        "terminal.log.stop" => execute_terminal_log_stop(context.terminals, arguments),
        "terminal.log.state" => execute_terminal_log_state(context.terminals, arguments),
        "ssh.command" => {
            execute_ssh_command(
                context.ssh_commands,
                context.command_history,
                context.paths,
                context.command_store,
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
                context.command_store,
                arguments,
            )
            .await
        }
        "server_info.snapshot" => {
            execute_server_info_snapshot(
                context.server_info,
                context.remote_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "diagnostics.runtime_health" => execute_diagnostics_runtime_health(
            context.diagnostics,
            context.paths,
            context.command_store,
        ),
        "diagnostics.create_bundle" => execute_diagnostics_create_bundle(
            context.diagnostics,
            context.paths,
            context.command_store,
            context.settings,
            context.terminals,
        ),
        "sftp.list" => execute_sftp_list(context.sftp, context.paths, arguments).await,
        "sftp.rename" => execute_sftp_rename(context.sftp, context.paths, arguments).await,
        "sftp.move" => execute_sftp_move(context.sftp, context.paths, arguments).await,
        "sftp.preview" => execute_sftp_preview(context.sftp, context.paths, arguments).await,
        "sftp.create_directory" => {
            execute_sftp_create_directory(context.sftp, context.paths, arguments).await
        }
        "sftp.chmod" => execute_sftp_chmod(context.sftp, context.paths, arguments).await,
        "sftp.upload" => execute_sftp_upload(context.sftp, context.paths, arguments).await,
        "sftp.upload_directory" => {
            execute_sftp_upload_directory(context.sftp, context.paths, arguments).await
        }
        "sftp.download" => execute_sftp_download(context.sftp, context.paths, arguments).await,
        "sftp.download_directory" => {
            execute_sftp_download_directory(context.sftp, context.paths, arguments).await
        }
        "sftp.delete" => execute_sftp_delete(context.sftp, context.paths, arguments).await,
        "sftp.transfer.enqueue" => {
            execute_sftp_transfer_enqueue(context.sftp, context.paths, arguments)
        }
        "sftp.transfer.list" => execute_sftp_transfer_list(context.sftp),
        "sftp.transfer.cancel" => execute_sftp_transfer_cancel(context.sftp, arguments),
        "sftp.transfer.clear_completed" => execute_sftp_transfer_clear_completed(context.sftp),
        "container.list" => {
            execute_container_list(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.inspect" => {
            execute_container_inspect(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.logs.tail" => {
            execute_container_logs_tail(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.stats" => {
            execute_container_stats(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.start" => {
            execute_container_start(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.stop" => {
            execute_container_stop(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.restart" => {
            execute_container_restart(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.remove" => {
            execute_container_remove(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.list" => {
            execute_container_files_list(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.preview" => {
            execute_container_files_preview(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.write_text" => {
            execute_container_files_write_text(
                context.docker_hosts,
                context.remote_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.create_directory" => {
            execute_container_files_create_directory(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.delete" => {
            execute_container_files_delete(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.rename" => {
            execute_container_files_rename(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.chmod" => {
            execute_container_files_chmod(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.upload" => {
            execute_container_files_upload(
                context.docker_hosts,
                context.remote_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "container.files.download" => {
            execute_container_files_download(
                context.docker_hosts,
                context.remote_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "tmux.probe" => {
            execute_tmux_probe(context.tmux, context.paths, context.ssh_commands, arguments).await
        }
        "tmux.list_sessions" => {
            execute_tmux_list_sessions(context.tmux, context.paths, context.ssh_commands, arguments)
                .await
        }
        "tmux.create_session" => {
            execute_tmux_create_session(
                context.tmux,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "tmux.rename_session" => {
            execute_tmux_rename_session(
                context.tmux,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        "tmux.kill_session" => {
            execute_tmux_kill_session(context.tmux, context.paths, context.ssh_commands, arguments)
                .await
        }
        "tmux.list_windows" => {
            execute_tmux_list_windows(context.tmux, context.paths, context.ssh_commands, arguments)
                .await
        }
        "tmux.list_panes" => {
            execute_tmux_list_panes(context.tmux, context.paths, context.ssh_commands, arguments)
                .await
        }
        "tmux.capture_pane" => {
            execute_tmux_capture_pane(context.tmux, context.paths, context.ssh_commands, arguments)
                .await
        }
        "tmux.attach_plan" => execute_tmux_attach_plan(context.tmux, arguments),
        "port_forward.create" => execute_port_forward_create(
            context.port_forwards,
            context.local_network_proxy,
            context.storage,
            context.remote_hosts,
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
        "history.search" => {
            execute_history_search(context.command_history, context.command_store, arguments)
        }
        "terminal.resize" => execute_terminal_resize(context.terminals, arguments),
        "terminal.snapshot" => execute_terminal_snapshot(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        "terminal.resolve_agent_target" => execute_terminal_resolve_agent_target(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        "kerminal.agent.current_session" => execute_agent_current_session(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        "kerminal.agent.target_context" => execute_agent_target_context(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        "kerminal.host.upsert_with_credential" => {
            execute_host_upsert_with_credential(context.remote_hosts, arguments)
        }
        "kerminal.vault.encrypt_secret" => execute_vault_encrypt_secret(context.paths, arguments),
        "kerminal.config.validate" => execute_config_validate(context.paths, arguments),
        "terminal.write" => execute_terminal_write(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            context.command_history,
            context.command_store,
            arguments,
        ),
        _ => ToolExecutionResult {
            status: McpToolExecutionStatus::Failed,
            result_summary: None,
            error: Some("该工具尚未接入受控执行器。".to_owned()),
            ..ToolExecutionResult::default()
        },
    }
}
