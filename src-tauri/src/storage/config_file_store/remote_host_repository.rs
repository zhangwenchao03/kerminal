//! 远程主机配置聚合的事务仓储操作。
//!
//! @author kongweiguang

use std::{io::ErrorKind, path::Path};

use uuid::Uuid;

use crate::{
    models::remote_host::{RemoteHost, RemoteHostGroup},
    storage::{
        durable_file_transaction::DurableFileTransaction,
        file_store::{FileStoreError, FileStoreResult, TomlDocument, TomlParseError},
    },
};

use super::{
    remote_host_relative_path, timestamp_now, with_error_path, ConfigFileStore,
    RemoteHostGroupsTomlDocument, RemoteHostTomlDocument, HOST_GROUPS_RELATIVE_PATH,
};

impl ConfigFileStore {
    pub(super) fn read_remote_host_metadata(&self, host_id: &str) -> FileStoreResult<RemoteHost> {
        let relative_path = remote_host_relative_path(host_id)?;
        let document = self
            .files
            .read_toml::<RemoteHostTomlDocument>(&relative_path)?;
        validate_remote_host_id(
            with_error_path(document.into_host(), &relative_path)?,
            host_id,
            relative_path,
        )
    }

    /// 在调用方事务锁内读取主机元数据，缺失时返回 `None`。
    pub(crate) fn remote_host_by_id_in_transaction(
        &self,
        transaction: &mut DurableFileTransaction<'_>,
        host_id: &str,
    ) -> FileStoreResult<Option<RemoteHost>> {
        let relative_path = remote_host_relative_path(host_id)?;
        let document = match transaction.read_toml::<RemoteHostTomlDocument>(&relative_path) {
            Ok(document) => document,
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => {
                return Ok(None)
            }
            Err(error) => return Err(error),
        };
        validate_remote_host_id(
            with_error_path(document.into_host(), &relative_path)?,
            host_id,
            relative_path,
        )
        .map(Some)
    }

    /// 把单个主机元数据加入调用方已持有的事务，用于与凭据 vault 同步提交。
    pub(crate) fn stage_remote_host_write(
        &self,
        transaction: &mut DurableFileTransaction<'_>,
        host: &RemoteHost,
    ) -> FileStoreResult<()> {
        let host_path = remote_host_relative_path(&host.id)?;
        let document = RemoteHostTomlDocument::from_host(host.clone());
        transaction.write(host_path, document.encode_toml()?.into_bytes())
    }

    /// 在同一 FileStore 事务内读取现有分组、分配排序值并追加新分组。
    ///
    /// 该入口避免并发 `create_group` 在锁外执行 read-modify-write 导致后写覆盖先写。
    pub fn append_remote_host_group(
        &self,
        mut group: RemoteHostGroup,
    ) -> FileStoreResult<RemoteHostGroup> {
        let timestamp = timestamp_now();
        let change_set_id = format!("remote-host-group-{}", Uuid::new_v4());
        self.files
            .run_transaction(&change_set_id, &timestamp, |transaction| {
                let mut groups = match transaction
                    .read_toml::<RemoteHostGroupsTomlDocument>(HOST_GROUPS_RELATIVE_PATH)
                {
                    Ok(document) => with_error_path(
                        document.into_groups(),
                        Path::new(HOST_GROUPS_RELATIVE_PATH),
                    )?,
                    Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => {
                        Vec::new()
                    }
                    Err(error) => return Err(error),
                };
                group.sort_order = groups
                    .iter()
                    .map(|candidate| candidate.sort_order)
                    .max()
                    .unwrap_or(0)
                    + 10;
                groups.push(group.clone());
                let document = RemoteHostGroupsTomlDocument::from_groups(groups);
                transaction.write(
                    HOST_GROUPS_RELATIVE_PATH,
                    document.encode_toml()?.into_bytes(),
                )?;
                Ok(group.clone())
            })
    }
}

fn validate_remote_host_id(
    host: RemoteHost,
    host_id: &str,
    relative_path: std::path::PathBuf,
) -> FileStoreResult<RemoteHost> {
    if host.id == host_id {
        return Ok(host);
    }
    Err(FileStoreError::TomlParse(
        TomlParseError::single(
            1,
            1,
            format!(
                "remote host file id mismatch: expected {host_id}, found {}",
                host.id
            ),
        )
        .with_path(relative_path)
        .with_key("id")
        .with_recovery("Make the host id match the hosts/<id>.toml file name."),
    ))
}
