//! 前端 Tool Registry contract fixture 同步测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::tool_registry::ToolDefinition, services::tool_registry_service::ToolRegistryService,
};

#[test]
fn frontend_tool_registry_contract_fixture_matches_rust_registry() {
    let fixture: Vec<ToolDefinition> = serde_json::from_str(include_str!(
        "../../src/lib/toolRegistryContract.fixture.json"
    ))
    .expect("parse frontend tool registry contract fixture");
    let registry = ToolRegistryService::new().list_tools();

    assert_eq!(fixture, registry);
}
