//! 工具定义和 JSON schema 构造器。
//!
//! @author kongweiguang

use serde_json::{json, Value};

use crate::models::tool_registry::{
    ToolAuditPolicy, ToolCategory, ToolConfirmationPolicy, ToolDefinition, ToolRiskLevel,
};

pub(super) fn tool(
    id: &str,
    title: &str,
    description: &str,
    category: ToolCategory,
    risk: ToolRiskLevel,
    input_schema: Value,
) -> ToolDefinition {
    tool_with_policy(
        id,
        title,
        description,
        category,
        risk,
        risk.default_confirmation(),
        ToolAuditPolicy::Summary,
        true,
        true,
        input_schema,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn tool_with_policy(
    id: &str,
    title: &str,
    description: &str,
    category: ToolCategory,
    risk: ToolRiskLevel,
    confirmation: ToolConfirmationPolicy,
    audit: ToolAuditPolicy,
    enabled: bool,
    exposed_to_mcp: bool,
    input_schema: Value,
) -> ToolDefinition {
    ToolDefinition {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        category,
        risk,
        confirmation,
        audit,
        enabled,
        exposed_to_mcp,
        input_schema,
    }
}

pub(super) fn object_schema(fields: Vec<FieldSchema>) -> Value {
    let mut properties = serde_json::Map::new();
    let mut required = Vec::new();

    for field in fields {
        if field.required {
            required.push(Value::String(field.name.clone()));
        }
        properties.insert(field.name, field.schema);
    }

    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": properties,
        "required": required,
    })
}

pub(super) struct FieldSchema {
    name: String,
    required: bool,
    schema: Value,
}

pub(super) fn string_field(name: &str, description: &str, required: bool) -> FieldSchema {
    field(
        name,
        required,
        json!({ "type": "string", "description": description }),
    )
}

pub(super) fn string_array_field(name: &str, description: &str, required: bool) -> FieldSchema {
    field(
        name,
        required,
        json!({
            "type": "array",
            "description": description,
            "items": { "type": "string" },
        }),
    )
}

pub(super) fn string_record_field(name: &str, description: &str, required: bool) -> FieldSchema {
    field(
        name,
        required,
        json!({
            "type": "object",
            "description": description,
            "additionalProperties": { "type": "string" },
        }),
    )
}

pub(super) fn number_field(name: &str, description: &str, required: bool) -> FieldSchema {
    field(
        name,
        required,
        json!({ "type": "number", "description": description }),
    )
}

pub(super) fn boolean_field(name: &str, description: &str, required: bool) -> FieldSchema {
    field(
        name,
        required,
        json!({ "type": "boolean", "description": description }),
    )
}

pub(super) fn enum_field(
    name: &str,
    description: &str,
    required: bool,
    values: Vec<&str>,
) -> FieldSchema {
    field(
        name,
        required,
        json!({
            "type": "string",
            "description": description,
            "enum": values,
        }),
    )
}

pub(super) fn workflow_steps_field() -> FieldSchema {
    field(
        "steps",
        true,
        json!({
            "type": "array",
            "description": "有序命令步骤；仅保存，不自动执行。",
            "items": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "可选稳定步骤 id。"
                    },
                    "title": {
                        "type": "string",
                        "description": "步骤标题。"
                    },
                    "command": {
                        "type": "string",
                        "description": "步骤命令内容。"
                    },
                    "description": {
                        "type": "string",
                        "description": "可选步骤说明。"
                    },
                    "scope": {
                        "type": "string",
                        "description": "步骤适用范围；为空时继承工作流作用域。",
                        "enum": ["any", "local", "ssh"]
                    },
                    "requiresConfirmation": {
                        "type": "boolean",
                        "description": "发送该步骤前是否需要用户二次确认。"
                    }
                },
                "required": ["title", "command"]
            }
        }),
    )
}

fn field(name: &str, required: bool, schema: Value) -> FieldSchema {
    FieldSchema {
        name: name.to_string(),
        required,
        schema,
    }
}
