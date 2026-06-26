//! 本地文件对话框路径模型。
//!
//! @author kongweiguang

use std::path::{Path, PathBuf};

/// 拆分保存对话框默认路径中的目录和文件名。
pub fn default_save_path_parts(default_path: Option<&str>) -> (Option<PathBuf>, Option<String>) {
    let Some(default_path) = default_path.map(str::trim).filter(|path| !path.is_empty()) else {
        return (None, None);
    };

    let path = Path::new(default_path);
    let directory = path
        .parent()
        .filter(|parent| parent.components().count() > 0)
        .map(Path::to_path_buf);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned);
    (directory, file_name)
}

/// 将本地路径转为前端可消费的字符串。
pub fn path_to_string(path: PathBuf) -> String {
    normalize_local_path_string(&path.to_string_lossy())
}

/// 去掉 Windows verbatim 前缀，避免前端展示 `\\?\` 形式路径。
pub fn normalize_local_path_string(path: &str) -> String {
    strip_windows_verbatim_prefix(path).unwrap_or_else(|| path.to_owned())
}

fn strip_windows_verbatim_prefix(path: &str) -> Option<String> {
    let path = path
        .strip_prefix("\\\\?\\")
        .or_else(|| path.strip_prefix("\\?\\"))
        .or_else(|| path.strip_prefix("\\\\.\\"))
        .or_else(|| path.strip_prefix("\\.\\"))?;

    Some(
        path.strip_prefix("UNC\\")
            .map(|rest| format!("\\\\{rest}"))
            .unwrap_or_else(|| path.to_owned()),
    )
}
