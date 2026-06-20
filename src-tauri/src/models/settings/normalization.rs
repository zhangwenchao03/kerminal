//! 设置输入归一化工具。
//!
//! @author kongweiguang

use crate::error::{AppError, AppResult};

use super::{
    CustomMcpNameValue, DEFAULT_CUSTOM_SKILLS_DIRECTORY, ERRONEOUS_CODEX_SKILLS_DIRECTORY,
};

pub(super) fn normalize_identifier(value: &str, label: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{label} 不能为空")));
    }
    if value.len() > 80 {
        return Err(AppError::InvalidInput(format!(
            "{label} 不能超过 80 个字符"
        )));
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
    {
        return Err(AppError::InvalidInput(format!(
            "{label} 只能包含字母、数字、点、短横线和下划线"
        )));
    }
    Ok(value.to_string())
}

pub(super) fn normalize_optional_identifier(value: &str, max_len: usize) -> String {
    value
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
        .take(max_len)
        .collect()
}

pub(super) fn normalize_tool_name(value: &str, label: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{label} 不能为空")));
    }
    if value.len() > 160 {
        return Err(AppError::InvalidInput(format!(
            "{label} 不能超过 160 个字符"
        )));
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | ':'))
    {
        return Err(AppError::InvalidInput(format!(
            "{label} 只能包含字母、数字、点、短横线、下划线、斜线和冒号"
        )));
    }
    Ok(value.to_string())
}

pub(super) fn normalize_required_text(
    value: &str,
    label: &str,
    max_len: usize,
) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{label} 不能为空")));
    }
    if value.len() > max_len {
        return Err(AppError::InvalidInput(format!(
            "{label} 不能超过 {max_len} 个字符"
        )));
    }
    Ok(value.to_string())
}

pub(super) fn normalize_optional_text(value: &str, max_len: usize) -> String {
    value.trim().chars().take(max_len).collect()
}

pub(super) fn normalize_custom_skill_directory_path(value: &str) -> AppResult<String> {
    let path = normalize_required_text(value, "Skills 文件夹路径", 1000)?;
    Ok(if path == ERRONEOUS_CODEX_SKILLS_DIRECTORY {
        DEFAULT_CUSTOM_SKILLS_DIRECTORY.to_owned()
    } else {
        path
    })
}

pub(super) fn normalize_string_list(
    values: Vec<String>,
    max_items: usize,
    max_len: usize,
) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().chars().take(max_len).collect::<String>())
        .filter(|value| !value.is_empty())
        .take(max_items)
        .collect()
}

pub(super) fn normalize_name_values(
    values: Vec<CustomMcpNameValue>,
    max_items: usize,
    max_len: usize,
) -> Vec<CustomMcpNameValue> {
    values
        .into_iter()
        .filter_map(|value| {
            let name = value.name.trim().chars().take(120).collect::<String>();
            if name.is_empty() {
                return None;
            }
            Some(CustomMcpNameValue {
                name,
                value: value.value.trim().chars().take(max_len).collect(),
            })
        })
        .take(max_items)
        .collect()
}
