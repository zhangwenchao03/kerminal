//! Kerminal Tauri Command 模块。
//!
//! @author kongweiguang

#[cfg(not(test))]
pub mod ai;
#[cfg(not(test))]
pub mod ai_conversation;
#[cfg(not(test))]
pub mod command_history;
#[cfg(not(test))]
pub mod command_suggestion;
pub mod connection;
#[cfg(not(test))]
pub mod diagnostics;
#[cfg(not(test))]
pub mod docker;
pub mod file_dialog;
#[cfg(not(test))]
pub mod llm_provider;
pub mod local_files;
#[cfg(not(test))]
pub mod port_forward;
#[cfg(not(test))]
pub mod profile;
#[cfg(not(test))]
pub mod registry;
#[cfg(not(test))]
pub mod remote_host;
#[cfg(not(test))]
pub mod serial;
#[cfg(not(test))]
pub mod server_info;
#[cfg(not(test))]
pub mod settings;
#[cfg(not(test))]
pub mod sftp;
#[cfg(not(test))]
pub mod snippet;
#[cfg(not(test))]
pub mod ssh;
#[cfg(not(test))]
pub mod ssh_command;
#[cfg(not(test))]
pub mod telnet;
#[cfg(not(test))]
pub mod terminal;
#[cfg(not(test))]
pub mod terminal_session_binding;
#[cfg(not(test))]
pub mod tool_registry;
#[cfg(not(test))]
pub mod workflow;
