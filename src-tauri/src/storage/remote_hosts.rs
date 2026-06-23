//! 远程主机 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{
        RemoteHost, RemoteHostAuthType, RemoteHostGroup, RemoteHostGroupWithHosts, SshOptions,
    },
    storage::SqliteStore,
};

const UNGROUPED_REMOTE_HOST_GROUP_ID: &str = "__ungrouped__";
const UNGROUPED_REMOTE_HOST_GROUP_NAME: &str = "默认分组";

/// 写入 remote_host_groups 表的结构化数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteHostGroupWrite {
    /// 稳定分组 id。
    pub id: String,
    /// 用户可见分组名称。
    pub name: String,
    /// 排序字段。
    pub sort_order: i64,
}

/// 写入 remote_hosts 表的结构化数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteHostWrite {
    /// 稳定主机 id。
    pub id: String,
    /// 所属分组 id；为空表示未分组。
    pub group_id: Option<String>,
    /// 用户可见名称。
    pub name: String,
    /// SSH host。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// SSH 用户名。
    pub username: String,
    /// 认证方式。
    pub auth_type: RemoteHostAuthType,
    /// 私钥路径。
    pub credential_ref: Option<String>,
    /// SSH 密码或内联私钥内容，按用户选择明文保存。
    pub credential_secret: Option<String>,
    /// 标签。
    pub tags: Vec<String>,
    /// 是否生产主机。
    pub production: bool,
    /// SSH 附加连接选项。
    pub ssh_options: SshOptions,
    /// 排序字段。
    pub sort_order: i64,
}

impl SqliteStore {
    /// 返回远程主机分组。
    pub fn list_remote_host_groups(&self) -> AppResult<Vec<RemoteHostGroup>> {
        self.with_connection(list_groups)
    }

    /// 返回远程主机树。
    pub fn list_remote_host_tree(&self) -> AppResult<Vec<RemoteHostGroupWithHosts>> {
        self.with_connection(|conn| {
            let groups = list_groups(conn)?;
            let mut tree = groups
                .into_iter()
                .map(|group| {
                    let hosts = list_hosts_by_group(conn, &group.id)?;
                    Ok(RemoteHostGroupWithHosts {
                        id: group.id,
                        name: group.name,
                        sort_order: group.sort_order,
                        created_at: group.created_at,
                        updated_at: group.updated_at,
                        hosts,
                    })
                })
                .collect::<AppResult<Vec<_>>>()?;
            let ungrouped_hosts = list_ungrouped_hosts(conn)?;
            if !ungrouped_hosts.is_empty() {
                tree.insert(
                    0,
                    RemoteHostGroupWithHosts {
                        id: UNGROUPED_REMOTE_HOST_GROUP_ID.to_owned(),
                        name: UNGROUPED_REMOTE_HOST_GROUP_NAME.to_owned(),
                        sort_order: i64::MIN,
                        created_at: String::new(),
                        updated_at: String::new(),
                        hosts: ungrouped_hosts,
                    },
                );
            }
            Ok(tree)
        })
    }

    /// 返回远程主机分组数量。
    pub fn remote_host_group_count(&self) -> AppResult<usize> {
        self.with_connection(|conn| {
            let count: i64 =
                conn.query_row("SELECT COUNT(*) FROM remote_host_groups", [], |row| {
                    row.get(0)
                })?;
            Ok(count as usize)
        })
    }

    /// 返回某个分组下的主机数量。
    pub fn remote_host_count_by_group(&self, group_id: &str) -> AppResult<usize> {
        self.with_connection(|conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM remote_hosts WHERE group_id = ?1",
                [group_id],
                |row| row.get(0),
            )?;
            Ok(count as usize)
        })
    }

    /// 根据 id 读取远程主机分组。
    pub fn remote_host_group_by_id(&self, group_id: &str) -> AppResult<Option<RemoteHostGroup>> {
        self.with_connection(|conn| query_group_by_id_optional(conn, group_id))
    }

    /// 根据 id 读取远程主机。
    pub fn remote_host_by_id(&self, host_id: &str) -> AppResult<Option<RemoteHost>> {
        self.with_connection(|conn| query_host_by_id_optional(conn, host_id))
    }

    /// 返回下一个分组排序值。
    pub fn next_remote_host_group_sort_order(&self) -> AppResult<i64> {
        self.with_connection(|conn| next_sort_order(conn, "remote_host_groups", None))
    }

    /// 返回某分组下一个主机排序值。
    pub fn next_remote_host_sort_order(&self, group_id: Option<&str>) -> AppResult<i64> {
        self.with_connection(|conn| {
            if let Some(group_id) = group_id {
                return next_sort_order(
                    conn,
                    "remote_hosts",
                    Some(("group_id", group_id.to_owned())),
                );
            }

            let sort_order: Option<i64> = conn
                .query_row(
                    "SELECT MAX(sort_order) FROM remote_hosts WHERE group_id IS NULL",
                    [],
                    |row| row.get(0),
                )
                .optional()?
                .flatten();
            Ok(sort_order.unwrap_or(0) + 10)
        })
    }

    /// 插入远程主机分组。
    pub(crate) fn insert_remote_host_group(
        &self,
        group: &RemoteHostGroupWrite,
    ) -> AppResult<RemoteHostGroup> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO remote_host_groups (id, name, sort_order)
                VALUES (?1, ?2, ?3)
                ",
                params![group.id.as_str(), group.name.as_str(), group.sort_order],
            )?;

            query_group_by_id(conn, &group.id)
        })
    }

    /// 更新远程主机分组。
    pub(crate) fn update_remote_host_group(
        &self,
        group: &RemoteHostGroupWrite,
    ) -> AppResult<RemoteHostGroup> {
        self.with_connection_mut(|conn| {
            if query_group_by_id_optional(conn, &group.id)?.is_none() {
                return Err(AppError::NotFound(format!(
                    "远程主机分组不存在: {}",
                    group.id
                )));
            }

            conn.execute(
                "
                UPDATE remote_host_groups
                SET name = ?2,
                    sort_order = ?3,
                    updated_at = datetime('now')
                WHERE id = ?1
                ",
                params![group.id.as_str(), group.name.as_str(), group.sort_order],
            )?;

            query_group_by_id(conn, &group.id)
        })
    }

    /// 删除远程主机分组。
    pub fn delete_remote_host_group(&self, group_id: &str) -> AppResult<bool> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                UPDATE remote_hosts
                SET group_id = NULL,
                    updated_at = datetime('now')
                WHERE group_id = ?1
                ",
                [group_id],
            )?;
            let affected =
                conn.execute("DELETE FROM remote_host_groups WHERE id = ?1", [group_id])?;
            Ok(affected > 0)
        })
    }

    /// 插入远程主机。
    pub(crate) fn insert_remote_host(&self, host: &RemoteHostWrite) -> AppResult<RemoteHost> {
        self.with_connection_mut(|conn| {
            let tags_json = serde_json::to_string(&host.tags)?;
            let ssh_options_json = serde_json::to_string(&host.ssh_options)?;
            conn.execute(
                "
                INSERT INTO remote_hosts (
                    id, group_id, name, host, port, username, auth_type,
                    credential_ref, credential_secret, tags_json, production, ssh_options_json,
                    sort_order
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                ",
                params![
                    host.id.as_str(),
                    host.group_id.as_deref(),
                    host.name.as_str(),
                    host.host.as_str(),
                    i64::from(host.port),
                    host.username.as_str(),
                    host.auth_type.as_str(),
                    host.credential_ref.as_deref(),
                    host.credential_secret.as_deref(),
                    tags_json,
                    bool_to_i64(host.production),
                    ssh_options_json,
                    host.sort_order,
                ],
            )?;

            query_host_by_id(conn, &host.id)
        })
    }

    /// 更新远程主机。
    pub(crate) fn update_remote_host(&self, host: &RemoteHostWrite) -> AppResult<RemoteHost> {
        self.with_connection_mut(|conn| {
            if query_host_by_id_optional(conn, &host.id)?.is_none() {
                return Err(AppError::NotFound(format!("远程主机不存在: {}", host.id)));
            }

            let tags_json = serde_json::to_string(&host.tags)?;
            let ssh_options_json = serde_json::to_string(&host.ssh_options)?;
            conn.execute(
                "
                UPDATE remote_hosts
                SET group_id = ?2,
                    name = ?3,
                    host = ?4,
                    port = ?5,
                    username = ?6,
                    auth_type = ?7,
                    credential_ref = ?8,
                    credential_secret = ?9,
                    tags_json = ?10,
                    production = ?11,
                    ssh_options_json = ?12,
                    sort_order = ?13,
                    updated_at = datetime('now')
                WHERE id = ?1
                ",
                params![
                    host.id.as_str(),
                    host.group_id.as_deref(),
                    host.name.as_str(),
                    host.host.as_str(),
                    i64::from(host.port),
                    host.username.as_str(),
                    host.auth_type.as_str(),
                    host.credential_ref.as_deref(),
                    host.credential_secret.as_deref(),
                    tags_json,
                    bool_to_i64(host.production),
                    ssh_options_json,
                    host.sort_order,
                ],
            )?;

            query_host_by_id(conn, &host.id)
        })
    }

    /// 删除远程主机。
    pub fn delete_remote_host(&self, host_id: &str) -> AppResult<bool> {
        self.with_connection_mut(|conn| {
            let affected = conn.execute("DELETE FROM remote_hosts WHERE id = ?1", [host_id])?;
            Ok(affected > 0)
        })
    }
}

fn list_groups(conn: &Connection) -> AppResult<Vec<RemoteHostGroup>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, name, sort_order, created_at, updated_at
        FROM remote_host_groups
        ORDER BY sort_order ASC, name ASC
        ",
    )?;

    let groups = stmt
        .query_map([], group_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(groups)
}

fn list_hosts_by_group(conn: &Connection, group_id: &str) -> AppResult<Vec<RemoteHost>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, group_id, name, host, port, username, auth_type, credential_ref,
               credential_secret, tags_json, production, ssh_options_json, sort_order,
               created_at, updated_at
        FROM remote_hosts
        WHERE group_id = ?1
        ORDER BY sort_order ASC, name ASC
        ",
    )?;

    let hosts = stmt
        .query_map([group_id], host_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(hosts)
}

fn list_ungrouped_hosts(conn: &Connection) -> AppResult<Vec<RemoteHost>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, group_id, name, host, port, username, auth_type, credential_ref,
               credential_secret, tags_json, production, ssh_options_json, sort_order,
               created_at, updated_at
        FROM remote_hosts
        WHERE group_id IS NULL
        ORDER BY sort_order ASC, name ASC
        ",
    )?;

    let hosts = stmt
        .query_map([], host_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(hosts)
}

fn query_group_by_id(conn: &Connection, group_id: &str) -> AppResult<RemoteHostGroup> {
    query_group_by_id_optional(conn, group_id)?
        .ok_or_else(|| AppError::NotFound(format!("远程主机分组不存在: {group_id}")))
}

fn query_group_by_id_optional(
    conn: &Connection,
    group_id: &str,
) -> AppResult<Option<RemoteHostGroup>> {
    Ok(conn
        .query_row(
            "
            SELECT id, name, sort_order, created_at, updated_at
            FROM remote_host_groups
            WHERE id = ?1
            ",
            [group_id],
            group_from_row,
        )
        .optional()?)
}

fn query_host_by_id(conn: &Connection, host_id: &str) -> AppResult<RemoteHost> {
    query_host_by_id_optional(conn, host_id)?
        .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {host_id}")))
}

fn query_host_by_id_optional(conn: &Connection, host_id: &str) -> AppResult<Option<RemoteHost>> {
    Ok(conn
        .query_row(
            "
            SELECT id, group_id, name, host, port, username, auth_type, credential_ref,
                   credential_secret, tags_json, production, ssh_options_json, sort_order,
                   created_at, updated_at
            FROM remote_hosts
            WHERE id = ?1
            ",
            [host_id],
            host_from_row,
        )
        .optional()?)
}

fn next_sort_order(
    conn: &Connection,
    table_name: &str,
    where_clause: Option<(&str, String)>,
) -> AppResult<i64> {
    let sort_order: Option<i64> = if let Some((column, value)) = where_clause {
        let sql = format!("SELECT MAX(sort_order) FROM {table_name} WHERE {column} = ?1");
        conn.query_row(&sql, [value], |row| row.get(0))
            .optional()?
            .flatten()
    } else {
        let sql = format!("SELECT MAX(sort_order) FROM {table_name}");
        conn.query_row(&sql, [], |row| row.get(0))
            .optional()?
            .flatten()
    };

    Ok(sort_order.unwrap_or(0) + 10)
}

fn group_from_row(row: &Row<'_>) -> rusqlite::Result<RemoteHostGroup> {
    Ok(RemoteHostGroup {
        id: row.get(0)?,
        name: row.get(1)?,
        sort_order: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn host_from_row(row: &Row<'_>) -> rusqlite::Result<RemoteHost> {
    let auth_type_text: String = row.get(6)?;
    let tags_json: String = row.get(9)?;
    let production: i64 = row.get(10)?;
    let ssh_options_json: String = row.get(11)?;
    let port: i64 = row.get(4)?;
    let auth_type =
        RemoteHostAuthType::try_from(auth_type_text.as_str()).map_err(text_to_sqlite_error)?;
    let tags = serde_json::from_str(&tags_json).map_err(json_to_sqlite_error)?;
    let ssh_options = serde_json::from_str(&ssh_options_json).map_err(json_to_sqlite_error)?;

    Ok(RemoteHost {
        id: row.get(0)?,
        group_id: row.get(1)?,
        name: row.get(2)?,
        host: row.get(3)?,
        port: port as u16,
        username: row.get(5)?,
        auth_type,
        credential_ref: row.get(7)?,
        credential_secret: row.get(8)?,
        tags,
        production: production == 1,
        ssh_options,
        sort_order: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn json_to_sqlite_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn text_to_sqlite_error(error: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
    )
}
