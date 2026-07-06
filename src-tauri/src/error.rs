//! Kerminal 后端错误类型。
//!
//! @author kongweiguang

use thiserror::Error;

/// Kerminal Rust 后端统一错误。
#[derive(Debug, Error)]
pub enum AppError {
    /// 无法解析当前用户主目录。
    #[error("无法定位当前用户主目录")]
    HomeDirectoryUnavailable,

    /// 本地文件系统操作失败。
    #[error("本地文件系统操作失败: {0}")]
    Io(#[from] std::io::Error),

    /// SQLite 操作失败。
    #[error("SQLite 操作失败: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// JSON 序列化或反序列化失败。
    #[error("JSON 数据处理失败: {0}")]
    Json(#[from] serde_json::Error),

    /// 当前应用不支持该 SQLite schema 版本。
    #[error(
        "数据库版本 {database_version} 高于当前应用支持版本 {supported_version}，请升级 Kerminal 后重试"
    )]
    UnsupportedSchemaVersion {
        /// 数据库中的 schema 版本。
        database_version: u32,
        /// 当前应用支持的 schema 版本。
        supported_version: u32,
    },

    /// 运行时共享状态锁已损坏。
    #[error("运行时共享状态不可用: {0}")]
    StateLockPoisoned(&'static str),

    /// 用户输入参数不合法。
    #[error("参数不合法: {0}")]
    InvalidInput(String),

    /// 请求的数据不存在。
    #[error("数据不存在: {0}")]
    NotFound(String),

    /// 终端会话操作失败。
    #[error("终端会话操作失败: {0}")]
    Terminal(String),

    /// SFTP 文件操作失败。
    #[error("SFTP 文件操作失败: {0}")]
    Sftp(String),

    /// SSH 端口转发操作失败。
    #[error("端口转发操作失败: {0}")]
    PortForward(String),

    /// 服务器信息采集失败。
    #[error("服务器信息采集失败: {0}")]
    ServerInfo(String),

    /// 本地诊断信息采集失败。
    #[error("诊断信息采集失败: {0}")]
    Diagnostics(String),

    /// SSH 远程命令执行失败。
    #[error("SSH 远程命令执行失败: {0}")]
    SshCommand(String),

    /// SSH 认证需要前端继续输入一次性或可保存凭据。
    #[error("SSH 认证需要用户输入: {message}")]
    SshAuthPromptRequired {
        /// 面向用户的脱敏提示。
        message: String,
        /// 脱敏 prompt plan；只包含主机、用户、端口、角色和 secret kind。
        prompt_plan: serde_json::Value,
    },

    /// Docker/Podman 容器操作失败。
    #[error("容器操作失败: {0}")]
    Docker(String),

    /// 本地凭据存储操作失败。
    #[error("凭据存储操作失败: {0}")]
    Credential(String),
}

/// Kerminal 后端通用 Result。
pub type AppResult<T> = Result<T, AppError>;
