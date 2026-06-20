//! SQLite 连接和基础操作。
//!
//! @author kongweiguang

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use rusqlite::{params, Connection, OptionalExtension};

use crate::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
    storage::migrations,
};

/// Kerminal SQLite 存储入口。
#[derive(Debug)]
pub struct SqliteStore {
    database_file: PathBuf,
    conn: Mutex<Connection>,
}

impl SqliteStore {
    /// 打开并初始化 Kerminal SQLite 主库。
    pub fn open(paths: &KerminalPaths) -> AppResult<Self> {
        paths.ensure_directories()?;

        let mut conn = Connection::open(&paths.database_file)?;
        configure_connection(&conn)?;
        migrations::migrate(&mut conn)?;

        Ok(Self {
            database_file: paths.database_file.clone(),
            conn: Mutex::new(conn),
        })
    }

    /// 返回数据库文件路径。
    pub fn database_file(&self) -> &Path {
        &self.database_file
    }

    /// 读取当前 schema 版本。
    pub fn schema_version(&self) -> AppResult<u32> {
        self.with_connection(migrations::schema_version)
    }

    /// 设置基础 metadata，供后续启动标识和 smoke test 复用。
    pub fn set_metadata(&self, key: &str, value: &str) -> AppResult<()> {
        self.with_connection(|conn| {
            conn.execute(
                "
                INSERT INTO kerminal_metadata (key, value, updated_at)
                VALUES (?1, ?2, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                ",
                params![key, value],
            )?;

            Ok(())
        })
    }

    /// 读取基础 metadata。
    pub fn metadata_value(&self, key: &str) -> AppResult<Option<String>> {
        self.with_connection(|conn| {
            Ok(conn
                .query_row(
                    "SELECT value FROM kerminal_metadata WHERE key = ?1",
                    [key],
                    |row| row.get(0),
                )
                .optional()?)
        })
    }

    pub(crate) fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("sqlite connection"))?;

        operation(&conn)
    }

    pub(crate) fn with_connection_mut<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("sqlite connection"))?;

        operation(&mut conn)
    }
}

fn configure_connection(conn: &Connection) -> AppResult<()> {
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}
