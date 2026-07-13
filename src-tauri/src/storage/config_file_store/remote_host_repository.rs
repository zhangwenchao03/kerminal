//! 远程主机配置聚合的事务仓储操作。
//!
//! @author kongweiguang

use std::{io::ErrorKind, path::Path};

use uuid::Uuid;

use crate::{
    models::remote_host::RemoteHostGroup,
    storage::file_store::{FileStoreError, FileStoreResult, TomlDocument},
};

use super::{
    timestamp_now, with_error_path, ConfigFileStore, RemoteHostGroupsTomlDocument,
    HOST_GROUPS_RELATIVE_PATH,
};

impl ConfigFileStore {
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
