//! Snippet TOML repository operations.

use super::*;

impl ConfigFileStore {
    /// Read all snippet TOML files ordered by sort order and title.
    pub fn list_snippets(&self) -> FileStoreResult<Vec<CommandSnippet>> {
        let snippets_dir = self.files.path_for(SNIPPETS_RELATIVE_DIR)?;
        let entries = match fs::read_dir(&snippets_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };

        let mut snippets = Vec::new();
        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("toml") {
                continue;
            }
            let Some(snippet_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            snippets.push(self.read_snippet(snippet_id)?);
        }

        sort_snippets(&mut snippets);
        Ok(snippets)
    }

    /// Read one command snippet by id.
    pub fn snippet_by_id(&self, snippet_id: &str) -> FileStoreResult<Option<CommandSnippet>> {
        match self.read_snippet(snippet_id) {
            Ok(snippet) => Ok(Some(snippet)),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Return the next snippet sort order.
    pub fn next_snippet_sort_order(&self) -> FileStoreResult<i64> {
        Ok(self
            .list_snippets()?
            .into_iter()
            .map(|snippet| snippet.sort_order)
            .max()
            .unwrap_or(0)
            + 10)
    }

    /// Apply snippet writes/deletes as one recoverable change set.
    pub fn apply_snippet_change_set(
        &self,
        snippets_to_write: &[CommandSnippet],
        snippet_ids_to_delete: &[String],
    ) -> FileStoreResult<()> {
        let timestamp = timestamp_now();
        let change_set_id = format!("snippets-{}", Uuid::new_v4());
        let mut changes = Vec::with_capacity(snippets_to_write.len() + snippet_ids_to_delete.len());

        for snippet in snippets_to_write {
            let relative_path = snippet_relative_path(&snippet.id)?;
            let document = SnippetTomlDocument::from_snippet(snippet.clone());
            changes.push(FileStoreChange::new(
                relative_path,
                document.encode_toml()?.into_bytes(),
            )?);
        }

        for snippet_id in snippet_ids_to_delete {
            changes.push(FileStoreChange::delete(snippet_relative_path(snippet_id)?)?);
        }

        self.files
            .apply_change_set(&change_set_id, &timestamp, changes)?;
        Ok(())
    }

    /// 删除单个片段并返回短时恢复 receipt。
    pub fn delete_snippet_with_receipt(
        &self,
        snippet_id: &str,
    ) -> FileStoreResult<SnippetDeleteReceipt> {
        let relative_path = snippet_relative_path(snippet_id)?;
        let change_set_id = format!("snippet-delete-{}", Uuid::new_v4());
        self.files.apply_change_set(
            &change_set_id,
            &timestamp_now(),
            vec![FileStoreChange::delete(relative_path)?],
        )?;
        Ok(SnippetDeleteReceipt {
            change_set_id,
            snippet_id: snippet_id.to_owned(),
            expires_at_unix_ms: unix_time_millis() + 15_000,
        })
    }

    /// receipt 超时或 ID 已被占用时拒绝覆盖。
    pub fn restore_deleted_snippet(
        &self,
        receipt: &SnippetDeleteReceipt,
    ) -> FileStoreResult<CommandSnippet> {
        if unix_time_millis() > receipt.expires_at_unix_ms {
            return Err(FileStoreError::InvalidPath(
                "snippet delete receipt expired".to_owned(),
            ));
        }
        if self.snippet_by_id(&receipt.snippet_id)?.is_some() {
            return Err(FileStoreError::RevisionConflict(snippet_relative_path(
                &receipt.snippet_id,
            )?));
        }
        self.files
            .restore_change_set(&receipt.change_set_id, &timestamp_now())?;
        self.read_snippet(&receipt.snippet_id)
    }
}
