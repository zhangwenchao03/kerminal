//! 应用设置 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, OptionalExtension};

use crate::{error::AppResult, models::settings::AppSettings, storage::SqliteStore};

const APP_SETTINGS_KEY: &str = "app";

impl SqliteStore {
    /// 读取应用设置；没有持久化记录时返回默认设置。
    pub fn load_app_settings(&self) -> AppResult<AppSettings> {
        self.with_connection(|conn| {
            let value_json: Option<String> = conn
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key = ?1",
                    [APP_SETTINGS_KEY],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(value_json) = value_json else {
                return Ok(AppSettings::default());
            };

            serde_json::from_str::<AppSettings>(&value_json)?.validated()
        })
    }

    /// 覆盖写入应用设置，并返回持久化后的结构化数据。
    pub fn save_app_settings(&self, settings: AppSettings) -> AppResult<AppSettings> {
        let settings = settings.validated()?;
        let value_json = serde_json::to_string(&settings)?;

        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO app_settings (key, value_json, updated_at)
                VALUES (?1, ?2, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at = excluded.updated_at
                ",
                params![APP_SETTINGS_KEY, value_json],
            )?;

            Ok(settings)
        })
    }
}
