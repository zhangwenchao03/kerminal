//! 应用设置服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::settings::AppSettings,
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};

/// 应用设置服务，负责设置校验和持久化边界。
#[derive(Debug, Clone)]
pub struct SettingsService {
    config: ConfigFileStore,
}

impl SettingsService {
    /// 创建应用设置服务。
    pub fn new(config: ConfigFileStore) -> Self {
        Self { config }
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
        self.config
            .read_settings_or_default()
            .map_err(config_file_error)
    }

    /// 更新应用设置。
    pub fn update_settings(&self, request: AppSettings) -> AppResult<AppSettings> {
        let settings = request.validated()?;
        self.config
            .write_settings(&settings)
            .map_err(config_file_error)?;
        Ok(settings)
    }
}

fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}
