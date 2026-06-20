//! Kerminal 本地数据目录约定。
//!
//! @author kongweiguang

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Kerminal 固定数据目录名。
pub const KERMINAL_DIR_NAME: &str = ".kerminal";

/// Kerminal 主 SQLite 数据库文件名。
pub const DATABASE_FILE_NAME: &str = "kerminal.db";

/// Kerminal 本地持久化目录集合。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KerminalPaths {
    /// `~/.kerminal` 根目录。
    pub root: PathBuf,
    /// SQLite 主库路径。
    pub database_file: PathBuf,
    /// 应用日志目录。
    pub logs: PathBuf,
    /// 本地缓存目录。
    pub cache: PathBuf,
    /// 主题文件目录。
    pub themes: PathBuf,
    /// 用户自定义 Agent Skills 根目录。
    pub skills: PathBuf,
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

    /// 从指定 home 目录解析 `.kerminal`，用于测试和跨平台路径抽象。
    pub fn from_home_dir(home_dir: impl AsRef<Path>) -> Self {
        Self::from_root(home_dir.as_ref().join(KERMINAL_DIR_NAME))
    }

    /// 从指定 Kerminal 根目录构建所有路径。
    pub fn from_root(root: impl Into<PathBuf>) -> Self {
        let root = root.into();

        Self {
            database_file: root.join(DATABASE_FILE_NAME),
            logs: root.join("logs"),
            cache: root.join("cache"),
            themes: root.join("themes"),
            skills: root.join("skills"),
            snippets: root.join("snippets"),
            exports: root.join("exports"),
            temp: root.join("temp"),
            diagnostics: root.join("diagnostics"),
            root,
        }
    }

    /// 返回所有需要启动时创建的目录。
    pub fn managed_directories(&self) -> [&Path; 9] {
        [
            self.root.as_path(),
            self.logs.as_path(),
            self.cache.as_path(),
            self.themes.as_path(),
            self.skills.as_path(),
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
}
