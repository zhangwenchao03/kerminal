use super::*;

pub(super) fn normalize_required_text(
    field: &str,
    value: String,
    max_chars: usize,
) -> AppResult<String> {
    normalize_optional_text(field, Some(value), max_chars)?
        .ok_or_else(|| AppError::InvalidInput(format!("{field}不能为空")))
}

pub(super) fn normalize_optional_text(
    field: &str,
    value: Option<String>,
    max_chars: usize,
) -> AppResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Ok(None);
    }
    ensure_max_chars(field, &value, max_chars)?;
    Ok(Some(value))
}

pub(super) fn normalize_audit_metadata(
    metadata: BTreeMap<String, String>,
) -> AppResult<BTreeMap<String, String>> {
    let mut normalized = BTreeMap::new();
    for (key, value) in metadata.into_iter().take(MAX_AUDIT_METADATA_ENTRIES) {
        let key = key.trim().to_owned();
        if key.is_empty() {
            continue;
        }
        ensure_max_chars("审计 metadata key", &key, MAX_AUDIT_METADATA_KEY_CHARS)?;
        let value = value.trim().to_owned();
        ensure_max_chars(
            "审计 metadata value",
            &value,
            MAX_AUDIT_METADATA_VALUE_CHARS,
        )?;
        normalized.insert(key, value);
    }
    Ok(normalized)
}

pub(super) fn ensure_max_chars(field: &str, value: &str, max_chars: usize) -> AppResult<()> {
    if value.chars().count() > max_chars {
        return Err(AppError::InvalidInput(format!(
            "{field}不能超过 {max_chars} 个字符"
        )));
    }
    Ok(())
}
