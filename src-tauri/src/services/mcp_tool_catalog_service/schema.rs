//! 工具定义和 JSON schema 构造器。
//!
//! @author kongweiguang

use serde_json::{json, Value};

use crate::models::mcp_server::{McpToolAnnotations, ToolCategory, ToolDefinition};

use super::{ToolDescriptor, ToolId};

#[derive(Debug, Clone, Copy)]
pub(super) enum ToolEffect {
    Read,
    Write,
    Remote,
    Destructive,
}

impl ToolEffect {
    fn annotations(self) -> McpToolAnnotations {
        match self {
            Self::Read => McpToolAnnotations {
                read_only_hint: true,
                idempotent_hint: true,
                ..McpToolAnnotations::default()
            },
            Self::Write => McpToolAnnotations::default(),
            Self::Remote => McpToolAnnotations {
                open_world_hint: true,
                ..McpToolAnnotations::default()
            },
            Self::Destructive => McpToolAnnotations {
                destructive_hint: true,
                open_world_hint: true,
                ..McpToolAnnotations::default()
            },
        }
    }
}

pub(super) fn tool(
    id: ToolId,
    title: &str,
    description: &str,
    category: ToolCategory,
    effect: ToolEffect,
    input_schema: Value,
) -> ToolDescriptor {
    tool_with_exposure(
        id,
        title,
        description,
        category,
        effect,
        true,
        true,
        input_schema,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn tool_with_exposure(
    id: ToolId,
    title: &str,
    description: &str,
    category: ToolCategory,
    effect: ToolEffect,
    enabled: bool,
    exposed_to_mcp: bool,
    input_schema: Value,
) -> ToolDescriptor {
    let definition = ToolDefinition {
        id: id.as_str().to_owned(),
        title: title.to_string(),
        description: description.to_string(),
        category,
        annotations: effect.annotations(),
        enabled,
        exposed_to_mcp,
        input_schema,
    };
    ToolDescriptor::new(id, definition)
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

pub(super) fn object_field(
    name: &str,
    description: &str,
    required: bool,
    fields: Vec<FieldSchema>,
) -> FieldSchema {
    let mut schema = object_schema(fields);
    if let Some(object) = schema.as_object_mut() {
        object.insert(
            "description".to_owned(),
            Value::String(description.to_owned()),
        );
    }
    field(name, required, schema)
}

fn field(name: &str, required: bool, schema: Value) -> FieldSchema {
    FieldSchema {
        name: name.to_string(),
        required,
        schema,
    }
}
