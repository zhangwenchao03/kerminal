use super::*;

pub(super) fn field_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn first_csv_value(value: &str) -> String {
    value
        .split(',')
        .next()
        .map(str::trim)
        .unwrap_or_default()
        .trim_start_matches('/')
        .to_owned()
}

pub(super) fn short_container_id(id: &str) -> String {
    id.chars().take(12).collect()
}

pub(super) fn first_non_empty<'a>(left: &'a str, right: &'a str) -> &'a str {
    let left = left.trim();
    if left.is_empty() {
        right.trim()
    } else {
        left
    }
}

pub(super) fn normalize_required(field: &str, value: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    if value.contains('\0') || value.contains('\n') || value.contains('\r') {
        return Err(AppError::InvalidInput(format!("{field}不能包含控制字符")));
    }
    Ok(value.to_owned())
}

pub(super) fn normalize_optional(field: &str, value: Option<&str>) -> AppResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    normalize_required(field, value).map(Some)
}

pub(super) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
