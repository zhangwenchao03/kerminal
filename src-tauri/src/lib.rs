//! Kerminal Tauri 入口。
//!
//! @author kongweiguang

pub mod app_menu;
pub mod app_tray;
pub mod commands;
pub mod error;
pub mod models;
pub mod paths;
pub mod security;
pub mod services;
pub mod state;
pub mod storage;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state =
        AppState::initialize().expect("failed to initialize Kerminal data directory and SQLite");

    let mut builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .manage(app_state)
        .setup(|app| {
            app_tray::apply_default_window_icon(app)?;
            app_tray::setup_app_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ai::ai_chat,
            commands::ai::ai_terminal_context_snapshot,
            commands::ai::ai_tool_prepare,
            commands::ai::ai_tool_confirm,
            commands::ai::ai_tool_audit_list,
            commands::ai::ai_tool_audit_export,
            commands::ai::ai_tool_audit_clear,
            commands::command_history::command_history_list,
            commands::command_history::command_history_record,
            commands::command_history::command_history_delete,
            commands::command_history::command_history_clear,
            commands::command_suggestion::command_suggestion_list,
            commands::command_suggestion::command_suggestion_cleanup_diagnostics,
            commands::command_suggestion::command_suggestion_record_audit_event,
            commands::command_suggestion::command_suggestion_record_feedback,
            commands::command_suggestion::command_suggestion_refresh_git_refs,
            commands::command_suggestion::command_suggestion_refresh_remote_commands,
            commands::command_suggestion::command_suggestion_refresh_remote_history,
            commands::command_suggestion::command_suggestion_refresh_remote_paths,
            commands::command_suggestion::command_suggestion_telemetry_export,
            commands::command_suggestion::command_suggestion_telemetry_summary,
            commands::connection::connection_rdp_open,
            commands::connection::connection_rdp_open_saved,
            commands::diagnostics::diagnostics_create_bundle,
            commands::diagnostics::diagnostics_runtime_health,
            commands::docker::docker_list_containers,
            commands::docker::docker_create_container_session,
            commands::docker::docker_list_directory,
            commands::docker::docker_preview_file,
            commands::docker::docker_read_text_file,
            commands::docker::docker_write_text_file,
            commands::docker::docker_create_directory,
            commands::docker::docker_delete_path,
            commands::docker::docker_rename_path,
            commands::docker::docker_chmod_path,
            commands::docker::docker_upload,
            commands::docker::docker_download,
            commands::file_dialog::file_dialog_select_local_file,
            commands::file_dialog::file_dialog_select_local_directory,
            commands::file_dialog::file_dialog_get_app_skills_directory,
            commands::file_dialog::file_dialog_open_local_directory,
            commands::file_dialog::file_dialog_select_save_file,
            commands::llm_provider::llm_provider_list,
            commands::llm_provider::llm_provider_create,
            commands::llm_provider::llm_provider_update,
            commands::llm_provider::llm_provider_delete,
            commands::llm_provider::llm_provider_test,
            commands::port_forward::port_forward_create,
            commands::port_forward::port_forward_list,
            commands::port_forward::port_forward_close,
            commands::profile::profile_list,
            commands::profile::profile_detect_shells,
            commands::profile::profile_create,
            commands::profile::profile_update,
            commands::profile::profile_delete,
            commands::remote_host::remote_host_group_list,
            commands::remote_host::remote_host_tree,
            commands::remote_host::remote_host_group_create,
            commands::remote_host::remote_host_group_update,
            commands::remote_host::remote_host_group_delete,
            commands::remote_host::remote_host_create,
            commands::remote_host::remote_host_update,
            commands::remote_host::remote_host_delete,
            commands::serial::serial_create_session,
            commands::server_info::server_info_snapshot,
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::sftp::sftp_list_directory,
            commands::sftp::sftp_create_directory,
            commands::sftp::sftp_preview_file,
            commands::sftp::sftp_read_text_file,
            commands::sftp::sftp_write_text_file,
            commands::sftp::sftp_stat_path,
            commands::sftp::sftp_delete,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_chmod,
            commands::sftp::sftp_upload,
            commands::sftp::sftp_upload_directory,
            commands::sftp::sftp_download,
            commands::sftp::sftp_download_directory,
            commands::sftp::sftp_enqueue_transfer,
            commands::sftp::sftp_enqueue_remote_copy,
            commands::sftp::sftp_enqueue_archive_download,
            commands::sftp::sftp_enqueue_archive_upload,
            commands::sftp::sftp_enqueue_clipboard_download,
            commands::sftp::sftp_list_transfers,
            commands::sftp::sftp_cancel_transfer,
            commands::sftp::sftp_clear_completed_transfers,
            commands::sftp::sftp_classify_local_paths,
            commands::sftp::sftp_read_local_file_clipboard,
            commands::sftp::sftp_trust_host_key,
            commands::snippet::snippet_list,
            commands::snippet::snippet_create,
            commands::snippet::snippet_update,
            commands::snippet::snippet_delete,
            commands::ssh::ssh_create_session,
            commands::ssh_command::ssh_command_execute,
            commands::telnet::telnet_create_session,
            commands::terminal::terminal_create_session,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::terminal::terminal_list_sessions,
            commands::terminal::terminal_start_log,
            commands::terminal::terminal_stop_log,
            commands::terminal::terminal_log_state,
            commands::tool_registry::tool_registry_list,
            commands::tool_registry::tool_registry_mcp_list,
            commands::tool_registry::tool_registry_mcp_manifest,
            commands::tool_registry::tool_registry_mcp_http_start,
            commands::tool_registry::tool_registry_mcp_http_status,
            commands::tool_registry::tool_registry_mcp_http_stop,
            commands::tool_registry::tool_registry_mcp_prompt_render,
            commands::tool_registry::tool_registry_mcp_resource_read,
            commands::tool_registry::tool_registry_mcp_server_discover_tools,
            commands::workflow::workflow_list,
            commands::workflow::workflow_create,
            commands::workflow::workflow_update,
            commands::workflow::workflow_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
