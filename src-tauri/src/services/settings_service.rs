//! 应用设置服务。
//!
//! @author kongweiguang

use crate::{error::AppResult, models::settings::AppSettings, storage::SqliteStore};

/// 应用设置服务，负责设置校验和持久化边界。
#[derive(Debug, Default)]
pub struct SettingsService;

impl SettingsService {
    /// 创建应用设置服务。
    pub fn new() -> Self {
        Self
    }

    /// 读取应用设置。
    pub fn load_settings(&self, storage: &SqliteStore) -> AppResult<AppSettings> {
        storage.load_app_settings()
    }

    /// 更新应用设置。
    pub fn update_settings(
        &self,
        storage: &SqliteStore,
        request: AppSettings,
    ) -> AppResult<AppSettings> {
        storage.save_app_settings(request)
    }
}
