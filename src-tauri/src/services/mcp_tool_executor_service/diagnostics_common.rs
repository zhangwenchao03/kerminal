//! MCP 诊断类工具共享 helper。
//!
//! @author kongweiguang

use super::tool_examples::example_arguments_for;
use super::*;
use serde::Serialize;

pub(super) fn exposed_tool_definitions(tools: &[ToolDefinition]) -> Vec<&ToolDefinition> {
    tools
        .iter()
        .filter(|tool| tool.enabled && tool.exposed_to_mcp)
        .collect()
}

pub(super) fn runtime_snapshot_diagnostic(source: &str, message: String) -> Value {
    json!({
        "source": source,
        "severity": "warning",
        "message": message
    })
}

pub(super) fn serialized_name<T: Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "unknown".to_owned())
}

pub(super) fn tool_references(tools: &[&ToolDefinition], tool_ids: &[&str]) -> Vec<Value> {
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

pub(super) fn available_tool_ids<'a>(
    tools: &[&ToolDefinition],
    candidate_tool_ids: &[&'a str],
) -> Vec<&'a str> {
    candidate_tool_ids
        .iter()
        .copied()
        .filter(|candidate| tools.iter().any(|tool| tool.id.as_str() == *candidate))
        .collect()
}

pub(super) fn missing_tool_ids<'a>(
    tools: &[&ToolDefinition],
    candidate_tool_ids: &[&'a str],
) -> Vec<&'a str> {
    candidate_tool_ids
        .iter()
        .copied()
        .filter(|candidate| tools.iter().all(|tool| tool.id.as_str() != *candidate))
        .collect()
}

pub(super) fn absent_tool_families() -> Vec<&'static str> {
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
