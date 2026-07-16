//! Workflow TOML repository operations.

use super::*;

impl ConfigFileStore {
    /// Read all workflow TOML files ordered by sort order and title.
    pub fn list_workflows(&self) -> FileStoreResult<Vec<CommandWorkflow>> {
        let workflows_dir = self.files.path_for(WORKFLOWS_RELATIVE_DIR)?;
        let entries = match fs::read_dir(&workflows_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };

        let mut workflows = Vec::new();
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
            let Some(workflow_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            workflows.push(self.read_workflow(workflow_id)?);
        }

        sort_workflows(&mut workflows);
        Ok(workflows)
    }

    /// Read one command workflow by id.
    pub fn workflow_by_id(&self, workflow_id: &str) -> FileStoreResult<Option<CommandWorkflow>> {
        match self.read_workflow(workflow_id) {
            Ok(workflow) => Ok(Some(workflow)),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Return the next workflow sort order.
    pub fn next_workflow_sort_order(&self) -> FileStoreResult<i64> {
        Ok(self
            .list_workflows()?
            .into_iter()
            .map(|workflow| workflow.sort_order)
            .max()
            .unwrap_or(0)
            + 10)
    }

    /// Apply workflow writes/deletes as one recoverable change set.
    pub fn apply_workflow_change_set(
        &self,
        workflows_to_write: &[CommandWorkflow],
        workflow_ids_to_delete: &[String],
    ) -> FileStoreResult<()> {
        let timestamp = timestamp_now();
        let change_set_id = format!("workflows-{}", Uuid::new_v4());
        let mut changes =
            Vec::with_capacity(workflows_to_write.len() + workflow_ids_to_delete.len());

        for workflow in workflows_to_write {
            let relative_path = workflow_relative_path(&workflow.id)?;
            let document = WorkflowTomlDocument::from_workflow(workflow.clone());
            changes.push(FileStoreChange::new(
                relative_path,
                document.encode_toml()?.into_bytes(),
            )?);
        }

        for workflow_id in workflow_ids_to_delete {
            changes.push(FileStoreChange::delete(workflow_relative_path(
                workflow_id,
            )?)?);
        }

        self.files
            .apply_change_set(&change_set_id, &timestamp, changes)?;
        Ok(())
    }

    fn read_workflow(&self, workflow_id: &str) -> FileStoreResult<CommandWorkflow> {
        let relative_path = workflow_relative_path(workflow_id)?;
        let document = self
            .files
            .read_toml::<WorkflowTomlDocument>(&relative_path)?;
        let workflow = with_error_path(document.into_workflow(), &relative_path)?;
        if workflow.id != workflow_id {
            return Err(FileStoreError::TomlParse(
                TomlParseError::single(
                    1,
                    1,
                    format!(
                        "workflow file id mismatch: expected {workflow_id}, found {}",
                        workflow.id
                    ),
                )
                .with_path(relative_path)
                .with_key("id")
                .with_recovery("Make the workflow id match the workflows/<id>.toml file name."),
            ));
        }
        Ok(workflow)
    }
}
