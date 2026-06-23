//! 导出前端 browser preview 使用的 Tool Registry 契约快照。
//!
//! @author kongweiguang

use kerminal_lib::services::tool_registry_service::ToolRegistryService;

fn main() {
    let tools = ToolRegistryService::new().list_tools();
    let payload = serde_json::to_string_pretty(&tools).expect("serialize tool registry contract");
    println!("{payload}");
}
