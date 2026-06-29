//! Kerminal 本地数据目录约定。
//!
//! @author kongweiguang

use std::{
    env,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Kerminal 固定数据目录名。
pub const KERMINAL_DIR_NAME: &str = ".kerminal";

/// Override the Kerminal config root for portable/dev/smoke runs.
pub const KERMINAL_CONFIG_ROOT_ENV: &str = "KERMINAL_CONFIG_ROOT";

/// 命令历史和命令建议专用 SQLite 数据库文件名。
pub const COMMAND_DATABASE_FILE_NAME: &str = "command.sqlite";
/// tauri-plugin-log active file stem.
pub const APP_LOG_FILE_STEM: &str = "kerminal";
/// tauri-plugin-log active file name.
pub const APP_LOG_FILE_NAME: &str = "kerminal.log";
/// tauri-plugin-log per-file size cap.
pub const APP_LOG_MAX_FILE_SIZE_BYTES: u64 = 1_000_000;
/// tauri-plugin-log retained rotated file count, including the active file.
pub const APP_LOG_ROTATION_KEEP_FILES: usize = 5;

/// Kerminal 本地持久化目录集合。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KerminalPaths {
    /// `~/.kerminal` 根目录。
    pub root: PathBuf,
    /// 命令历史和命令建议专用 SQLite 路径。
    pub command_database_file: PathBuf,
    /// 结构化运行数据目录。
    pub data: PathBuf,
    /// 应用日志目录。
    pub logs: PathBuf,
    /// 本地缓存目录。
    pub cache: PathBuf,
    /// Encrypted credential vault directory.
    pub secrets: PathBuf,
    /// 主题文件目录。
    pub themes: PathBuf,
    /// 脚本片段目录。
    pub snippets: PathBuf,
    /// 导出文件目录。
    pub exports: PathBuf,
    /// 临时文件目录。
    pub temp: PathBuf,
    /// 诊断包目录。
    pub diagnostics: PathBuf,
}

impl KerminalPaths {
    /// 从当前系统用户主目录解析 `~/.kerminal`。
    pub fn from_current_home() -> AppResult<Self> {
        let home = dirs::home_dir().ok_or(AppError::HomeDirectoryUnavailable)?;
        Ok(Self::from_home_dir(home))
    }

    /// Resolve the Kerminal root from `KERMINAL_CONFIG_ROOT` when set, otherwise
    /// fall back to the current user's `~/.kerminal`.
    pub fn from_environment_or_current_home() -> AppResult<Self> {
        let Some(raw_root) = env::var_os(KERMINAL_CONFIG_ROOT_ENV) else {
            return Self::from_current_home();
        };
        let raw_root_text = raw_root.to_string_lossy();
        if raw_root_text.trim().is_empty() {
            return Self::from_current_home();
        }
        if let Some(root_text) = raw_root.to_str() {
            return Ok(Self::from_root(expand_home_relative_path(root_text)?));
        }
        Ok(Self::from_root(PathBuf::from(raw_root)))
    }

    /// 从指定 home 目录解析 `.kerminal`，用于测试和跨平台路径抽象。
    pub fn from_home_dir(home_dir: impl AsRef<Path>) -> Self {
        Self::from_root(home_dir.as_ref().join(KERMINAL_DIR_NAME))
    }

    /// 从指定 Kerminal 根目录构建所有路径。
    pub fn from_root(root: impl Into<PathBuf>) -> Self {
        let root = root.into();

        Self {
            command_database_file: root.join("data").join(COMMAND_DATABASE_FILE_NAME),
            data: root.join("data"),
            logs: root.join("logs"),
            cache: root.join("cache"),
            secrets: root.join("secrets"),
            themes: root.join("themes"),
            snippets: root.join("snippets"),
            exports: root.join("exports"),
            temp: root.join("temp"),
            diagnostics: root.join("diagnostics"),
            root,
        }
    }

    /// 返回所有需要启动时创建的目录。
    pub fn managed_directories(&self) -> [&Path; 10] {
        [
            self.root.as_path(),
            self.data.as_path(),
            self.logs.as_path(),
            self.cache.as_path(),
            self.secrets.as_path(),
            self.themes.as_path(),
            self.snippets.as_path(),
            self.exports.as_path(),
            self.temp.as_path(),
            self.diagnostics.as_path(),
        ]
    }

    /// 创建所有 Kerminal 管理目录。
    pub fn ensure_directories(&self) -> AppResult<()> {
        for directory in self.managed_directories() {
            std::fs::create_dir_all(directory)?;
        }

        Ok(())
    }

    /// 返回当前 Tauri 日志插件活跃日志文件路径。
    pub fn app_log_file(&self) -> PathBuf {
        self.logs.join(APP_LOG_FILE_NAME)
    }

    /// Return the workspace `.gitignore` path.
    pub fn gitignore_file(&self) -> PathBuf {
        self.root.join(".gitignore")
    }

    /// Return the encrypted vault key file path.
    pub fn vault_key_file(&self) -> PathBuf {
        self.secrets.join("vault-key.toml")
    }

    /// Return the encrypted vault file path.
    pub fn vault_file(&self) -> PathBuf {
        self.secrets.join("vault.toml")
    }
}

/// Expand current-user home notation in local paths.
///
/// Supports only `~`, `~/...`, and `~\...` for the current user. User-specific
/// forms such as `~alice/...` are intentionally left unchanged because their
/// platform semantics differ across Windows, macOS, and Linux.
pub fn expand_home_relative_path(path: &str) -> AppResult<PathBuf> {
    let Some(suffix) = home_relative_suffix(path) else {
        return Ok(PathBuf::from(path));
    };
    let home = dirs::home_dir().ok_or(AppError::HomeDirectoryUnavailable)?;
    Ok(join_home_suffix(home, suffix))
}

fn home_relative_suffix(path: &str) -> Option<&str> {
    if path == "~" {
        return Some("");
    }
    path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\"))
}

fn join_home_suffix(mut home: PathBuf, suffix: &str) -> PathBuf {
    for part in suffix.split(['/', '\\']).filter(|part| !part.is_empty()) {
        home.push(part);
    }
    home
}
