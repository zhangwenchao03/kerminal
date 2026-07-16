//! 应用设置服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::settings::AppSettings,
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};
use std::sync::{Arc, RwLock};

/// 应用设置服务，负责设置校验和持久化边界。
#[derive(Debug, Clone)]
pub struct SettingsService {
    config: ConfigFileStore,
    read_only_fallback: Arc<RwLock<Option<AppSettings>>>,
}

impl SettingsService {
    /// 创建应用设置服务。
    pub fn new(config: ConfigFileStore) -> Self {
        Self {
            config,
            read_only_fallback: Arc::new(RwLock::new(None)),
        }
    }

    /// 初始化默认设置文件。
    pub fn ensure_seed_settings(&self) -> AppResult<()> {
        match self.config.read_settings() {
            Ok(_) => Ok(()),
            Err(FileStoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => self
                .config
                .write_settings(&AppSettings::default())
                .map(|_| ())
                .map_err(config_file_error),
            Err(error) => Err(config_file_error(error)),
        }
    }

    /// 读取应用设置。
    pub fn load_settings(&self) -> AppResult<AppSettings> {
        if let Some(settings) = self
            .read_only_fallback
            .read()
            .map_err(|_| AppError::StateLockPoisoned("settings_recovery"))?
            .clone()
        {
            return Ok(settings);
        }
        self.config
            .read_settings_or_default()
            .map_err(config_file_error)
    }

    /// 更新应用设置。
    pub fn update_settings(&self, request: AppSettings) -> AppResult<AppSettings> {
        if self
            .read_only_fallback
            .read()
            .map_err(|_| AppError::StateLockPoisoned("settings_recovery"))?
            .is_some()
        {
            return Err(AppError::InvalidInput(
                "settings.toml 处于只读恢复；请修复原文件并重新启动 Kerminal".to_owned(),
            ));
        }
        let settings = request.validated()?;
        self.config
            .write_settings(&settings)
            .map_err(config_file_error)?;
        Ok(settings)
    }

    /// 配置损坏时安装进程内 fallback；后续读取可用但所有设置写入 fail closed。
    pub fn enter_read_only_recovery(&self, fallback: AppSettings) -> AppResult<()> {
        *self
            .read_only_fallback
            .write()
            .map_err(|_| AppError::StateLockPoisoned("settings_recovery"))? = Some(fallback);
        Ok(())
    }
}

fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}
