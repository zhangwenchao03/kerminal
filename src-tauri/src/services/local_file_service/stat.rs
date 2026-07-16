//! 本机路径 stat 与冲突预检服务。
//!
//! @author kongweiguang

use std::{
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

use super::{
    assert_path_within_root, contains_forbidden_path_char, local_file_kind, path_entry_exists,
};

/// 本机路径 stat 请求，用于传输冲突预检。
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalStatPathRequest {
    pub path: String,
    pub root_path: Option<String>,
}

/// 路径预检元信息；不存在是正常结果。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalPathStat {
    pub path: String,
    pub exists: bool,
    pub kind: Option<String>,
    pub size: Option<u64>,
    pub modified: Option<String>,
    pub readonly: bool,
}

/// 获取路径元信息，并在可选 root scope 内验证不存在路径的父目录。
pub fn stat_path(request: LocalStatPathRequest) -> Result<LocalPathStat, String> {
    let requested_path = normalize_requested_path(&request.path)?;
    assert_path_within_root(&requested_path, request.root_path.as_deref())?;
    if !path_entry_exists(&requested_path) {
        return Ok(LocalPathStat {
            exists: false,
            kind: None,
            modified: None,
            path: requested_path.to_string_lossy().into_owned(),
            readonly: false,
            size: None,
        });
    }
    let metadata = std::fs::symlink_metadata(&requested_path)
        .map_err(|error| format!("读取路径元数据失败 {}: {error}", requested_path.display()))?;
    let kind = if metadata.file_type().is_symlink() {
        "symlink"
    } else {
        local_file_kind(&requested_path)?
    };
    Ok(LocalPathStat {
        exists: true,
        kind: Some(kind.to_owned()),
        modified: metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs().to_string()),
        path: requested_path.to_string_lossy().into_owned(),
        readonly: metadata.permissions().readonly(),
        size: if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        },
    })
}

fn normalize_requested_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_owned());
    }
    if contains_forbidden_path_char(trimmed) {
        return Err("路径包含非法字符".to_owned());
    }
    Ok(PathBuf::from(trimmed))
}

pub(super) fn scoped_comparison_path(path: &Path) -> Result<PathBuf, String> {
    if path_entry_exists(path) {
        if std::fs::symlink_metadata(path)
            .map_err(|error| format!("读取路径元数据失败 {}: {error}", path.display()))?
            .file_type()
            .is_symlink()
        {
            return Ok(path.to_path_buf());
        }
        return path
            .canonicalize()
            .map_err(|error| format!("解析路径失败 {}: {error}", path.display()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("路径缺少父目录: {}", path.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("路径缺少文件名: {}", path.display()))?;
    let parent = parent
        .canonicalize()
        .map_err(|error| format!("解析父目录失败 {}: {error}", parent.display()))?;
    Ok(parent.join(file_name))
}
