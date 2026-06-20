use super::*;

pub(super) fn summarize_arguments(arguments: &serde_json::Map<String, Value>) -> String {
    if arguments.is_empty() {
        return "无参数".to_owned();
    }

    arguments
        .iter()
        .map(|(key, value)| format!("{key}={}", summarize_value(key, value)))
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) fn summarize_mcp_call_result(tool_name: &str, result: &CallToolResult) -> String {
    let raw =
        serde_json::to_string(result).unwrap_or_else(|_| "无法序列化 MCP tool result".to_owned());
    let raw = truncate_audit_text(&raw, 1200);
    let (redacted, _) = redact_terminal_text(&raw);
    format!("MCP tool `{}` 返回：{}", tool_name, redacted)
}

pub(super) fn truncate_audit_text(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

pub(super) fn summarize_value(key: &str, value: &Value) -> String {
    if is_sensitive_key(key) {
        return "[已脱敏]".to_owned();
    }

    match value {
        Value::String(value) => {
            let value = truncate_string(value);
            let (value, _) = redact_terminal_text(&value);
            value
        }
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Null => "null".to_owned(),
        Value::Array(values) => format!("[{} 项]", values.len()),
        Value::Object(values) => summarize_object(values),
    }
}

pub(super) fn summarize_object(values: &serde_json::Map<String, Value>) -> String {
    if values.is_empty() {
        return "{}".to_owned();
    }

    let mut entries = values
        .iter()
        .take(6)
        .map(|(key, value)| format!("{key}={}", summarize_value(key, value)))
        .collect::<Vec<_>>();
    if values.len() > entries.len() {
        entries.push(format!("...共 {} 项", values.len()));
    }
    format!("{{{}}}", entries.join(", "))
}

pub(super) fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    ["key", "token", "secret", "password", "passwd", "credential"]
        .iter()
        .any(|part| key.contains(part))
}

pub(super) fn truncate_string(value: &str) -> String {
    const MAX_CHARS: usize = 96;
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(MAX_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}
