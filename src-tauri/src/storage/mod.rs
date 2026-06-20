//! Kerminal 本地持久化入口。
//!
//! @author kongweiguang

pub mod ai_tool_audits;
pub mod command_history;
pub mod command_suggestion_audit;
pub mod command_suggestion_cache;
pub mod command_suggestion_cleanup;
pub mod command_suggestion_feedback;
pub mod command_suggestion_telemetry;
pub mod llm_providers;
pub mod migrations;
pub mod profiles;
pub mod remote_hosts;
pub mod settings;
pub mod snippets;
pub mod sqlite;
pub mod workflows;

pub use sqlite::SqliteStore;
