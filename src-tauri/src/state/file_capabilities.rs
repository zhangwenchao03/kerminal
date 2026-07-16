//! AppState 的本地文件与持久化能力组合。

use crate::{
    error::AppResult,
    paths::KerminalPaths,
    services::{credential_service::CredentialService, diagnostics_service::DiagnosticsService},
    storage::{CommandSqliteStore, RuntimeFileStore},
};

/// 本地文件、SQLite 与其直接服务的能力集合。
#[derive(Debug)]
pub(super) struct FileCapabilities {
    pub(super) command_store: CommandSqliteStore,
    pub(super) credentials: CredentialService,
    pub(super) diagnostics: DiagnosticsService,
    pub(super) storage: RuntimeFileStore,
}

impl FileCapabilities {
    /// 先创建运行态文件存储，再打开命令域 SQLite，保持原有启动顺序。
    pub(super) fn initialize(paths: &KerminalPaths) -> AppResult<Self> {
        Ok(Self {
            storage: RuntimeFileStore::open(paths)?,
            command_store: CommandSqliteStore::open(paths)?,
            credentials: CredentialService::new(),
            diagnostics: DiagnosticsService::new(),
        })
    }
}
