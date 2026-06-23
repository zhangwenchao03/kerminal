//! 本机文件 stat / preflight command。
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

use super::{contains_forbidden_path_char, existing_directory, local_file_kind, path_entry_exists};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalStatPathRequest {
    pub path: String,
    pub root_path: Option<String>,
}

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

/// 获取本机路径元信息，用于传输冲突预检；不存在不是错误。
pub async fn local_files_stat_path(request: LocalStatPathRequest) -> Result<LocalPathStat, String> {
    tokio::task::spawn_blocking(move || stat_path(request))
        .await
        .map_err(|error| format!("读取本机路径状态线程失败: {error}"))?
}

fn stat_path(request: LocalStatPathRequest) -> Result<LocalPathStat, String> {
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

    let metadata = fs::symlink_metadata(&requested_path)
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

fn assert_path_within_root(path: &Path, root_path: Option<&str>) -> Result<(), String> {
    let Some(root_path) = root_path else {
        return Ok(());
    };
    if root_path.trim().is_empty() {
        return Ok(());
    }

    let root = existing_directory(root_path, "根目录")?;
    let scoped_path = scoped_comparison_path(path)?;
    if !scoped_path.starts_with(&root) {
        return Err(format!("路径超出允许根目录: {}", path.display()));
    }
    Ok(())
}

fn scoped_comparison_path(path: &Path) -> Result<PathBuf, String> {
    if path_entry_exists(path) {
        if fs::symlink_metadata(path)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stat_path_reports_missing_target_inside_root() {
        let root = tempfile::tempdir().expect("temp dir");
        let target = root.path().join("missing.txt");

        let stat = stat_path(LocalStatPathRequest {
            path: target.to_string_lossy().into_owned(),
            root_path: Some(root.path().to_string_lossy().into_owned()),
        })
        .expect("stat missing path");

        assert!(!stat.exists);
        assert_eq!(stat.kind, None);
        assert_eq!(stat.size, None);
    }

    #[test]
    fn stat_path_reports_existing_file_metadata() {
        let root = tempfile::tempdir().expect("temp dir");
        let target = root.path().join("notes.txt");
        fs::write(&target, b"hello").expect("write file");

        let stat = stat_path(LocalStatPathRequest {
            path: target.to_string_lossy().into_owned(),
            root_path: Some(root.path().to_string_lossy().into_owned()),
        })
        .expect("stat file");

        assert!(stat.exists);
        assert_eq!(stat.kind.as_deref(), Some("file"));
        assert_eq!(stat.size, Some(5));
        assert!(stat.modified.is_some());
    }

    #[test]
    fn stat_path_rejects_target_outside_root() {
        let root = tempfile::tempdir().expect("temp dir");
        let outside = tempfile::tempdir().expect("outside dir");
        let target = outside.path().join("notes.txt");

        let error = stat_path(LocalStatPathRequest {
            path: target.to_string_lossy().into_owned(),
            root_path: Some(root.path().to_string_lossy().into_owned()),
        })
        .expect_err("outside root should fail");

        assert!(error.contains("路径超出允许根目录"));
    }
}
