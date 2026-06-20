use super::*;

pub(super) fn request_from_arguments<T>(
    arguments: &serde_json::Map<String, Value>,
    request_name: &str,
) -> AppResult<T>
where
    T: DeserializeOwned,
{
    serde_json::from_value(Value::Object(arguments.clone()))
        .map_err(|error| AppError::InvalidInput(format!("{request_name} 参数无效: {error}")))
}

pub(super) fn required_string_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<String> {
    match arguments.get(key) {
        Some(Value::String(value)) => Ok(value.to_owned()),
        Some(Value::Null) | None => Err(AppError::InvalidInput(format!("{key} 不能为空。"))),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是字符串。"))),
    }
}

pub(super) fn optional_string_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<String>> {
    match arguments.get(key) {
        Some(Value::String(value)) => Ok(Some(value.to_owned())),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是字符串。"))),
    }
}

pub(super) fn optional_string_patch_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<String>> {
    optional_string_arg(arguments, key)
}

pub(super) fn optional_string_array_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Vec<String>> {
    match arguments.get(key) {
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| AppError::InvalidInput(format!("{key} 必须是字符串数组。")))
            })
            .collect(),
        Some(Value::Null) | None => Ok(Vec::new()),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是字符串数组。"))),
    }
}

pub(super) fn optional_string_array_action_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<Vec<String>>> {
    if !arguments.contains_key(key) || arguments.get(key).is_some_and(Value::is_null) {
        return Ok(None);
    }
    optional_string_array_arg(arguments, key).map(Some)
}

pub(super) fn optional_string_map_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<HashMap<String, String>> {
    match arguments.get(key) {
        Some(Value::Object(values)) => values
            .iter()
            .map(|(name, value)| {
                value
                    .as_str()
                    .map(|value| (name.to_owned(), value.to_owned()))
                    .ok_or_else(|| AppError::InvalidInput(format!("{key} 必须是字符串值对象。")))
            })
            .collect(),
        Some(Value::Null) | None => Ok(HashMap::new()),
        _ => Err(AppError::InvalidInput(format!(
            "{key} 必须是字符串值对象。"
        ))),
    }
}

pub(super) fn optional_string_map_action_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<HashMap<String, String>>> {
    if !arguments.contains_key(key) || arguments.get(key).is_some_and(Value::is_null) {
        return Ok(None);
    }
    optional_string_map_arg(arguments, key).map(Some)
}

pub(super) fn optional_bool_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<bool> {
    match arguments.get(key) {
        Some(Value::Bool(value)) => Ok(*value),
        Some(Value::Null) | None => Ok(false),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是布尔值。"))),
    }
}

pub(super) fn optional_bool_patch_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<bool>> {
    match arguments.get(key) {
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是布尔值。"))),
    }
}

pub(super) fn optional_usize_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<usize>> {
    match arguments.get(key) {
        Some(Value::Number(value)) => {
            let Some(value) = value.as_u64() else {
                return Err(AppError::InvalidInput(format!("{key} 必须是正整数。")));
            };
            usize::try_from(value)
                .map(Some)
                .map_err(|_| AppError::InvalidInput(format!("{key} 超出支持范围。")))
        }
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是数字。"))),
    }
}

pub(super) fn optional_usize_patch_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<usize>> {
    optional_usize_arg(arguments, key)
}

pub(super) fn required_i64_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<i64> {
    match arguments.get(key) {
        Some(Value::Number(value)) => value
            .as_i64()
            .ok_or_else(|| AppError::InvalidInput(format!("{key} 必须是整数。"))),
        Some(Value::Null) | None => Err(AppError::InvalidInput(format!("{key} 不能为空。"))),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是数字。"))),
    }
}

pub(super) fn optional_u16_patch_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<u16>> {
    match arguments.get(key) {
        Some(Value::Number(value)) => value
            .as_u64()
            .and_then(|value| u16::try_from(value).ok())
            .map(Some)
            .ok_or_else(|| AppError::InvalidInput(format!("{key} 必须是正整数。"))),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是数字。"))),
    }
}

pub(super) fn optional_u32_patch_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<u32>> {
    match arguments.get(key) {
        Some(Value::Number(value)) => value
            .as_u64()
            .and_then(|value| u32::try_from(value).ok())
            .map(Some)
            .ok_or_else(|| AppError::InvalidInput(format!("{key} 必须是正整数。"))),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是数字。"))),
    }
}

pub(super) fn optional_f64_patch_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<f64>> {
    match arguments.get(key) {
        Some(Value::Number(value)) => value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(Some)
            .ok_or_else(|| AppError::InvalidInput(format!("{key} 必须是有效数字。"))),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是数字。"))),
    }
}

pub(super) fn optional_u64_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<u64>> {
    match arguments.get(key) {
        Some(Value::Number(value)) => value
            .as_u64()
            .map(Some)
            .ok_or_else(|| AppError::InvalidInput(format!("{key} 必须是正整数。"))),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是数字。"))),
    }
}

pub(super) fn optional_remote_host_auth_type_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<RemoteHostAuthType> {
    match arguments.get("authType") {
        Some(Value::String(value)) => {
            RemoteHostAuthType::try_from(value.as_str()).map_err(AppError::InvalidInput)
        }
        Some(Value::Null) | None => Ok(RemoteHostAuthType::Agent),
        _ => Err(AppError::InvalidInput("authType 必须是字符串。".to_owned())),
    }
}

pub(super) fn number_to_u16(value: Option<&Value>) -> Option<u16> {
    let number = value?;
    let value = number
        .as_u64()
        .or_else(|| number.as_f64().map(|value| value as u64))?;
    u16::try_from(value).ok().filter(|value| *value > 0)
}
