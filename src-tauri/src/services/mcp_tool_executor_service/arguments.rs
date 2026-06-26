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

pub(super) fn number_to_u16(value: Option<&Value>) -> Option<u16> {
    let number = value?;
    let value = number
        .as_u64()
        .or_else(|| number.as_f64().map(|value| value as u64))?;
    u16::try_from(value).ok().filter(|value| *value > 0)
}
