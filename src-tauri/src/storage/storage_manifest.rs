//! File storage manifest model.
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

pub const STORAGE_MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StorageManifest {
    pub schema_version: u32,
    pub active_change_set_id: Option<String>,
    pub last_applied_change_set_id: Option<String>,
    pub repair_state: Option<ManifestRepairState>,
    pub change_sets: Vec<ManifestChangeSet>,
}

impl Default for StorageManifest {
    fn default() -> Self {
        Self::new()
    }
}

impl StorageManifest {
    pub fn new() -> Self {
        Self {
            schema_version: STORAGE_MANIFEST_SCHEMA_VERSION,
            active_change_set_id: None,
            last_applied_change_set_id: None,
            repair_state: None,
            change_sets: Vec::new(),
        }
    }

    pub fn begin_change_set(
        &mut self,
        id: impl Into<String>,
        started_at: impl Into<String>,
        touched_files: Vec<String>,
    ) {
        let id = id.into();
        self.active_change_set_id = Some(id.clone());
        self.change_sets.push(ManifestChangeSet {
            id,
            status: ChangeSetStatus::Started,
            started_at: started_at.into(),
            completed_at: None,
            touched_files,
            backup_dir: None,
            error: None,
        });
    }

    pub fn mark_applied(&mut self, id: &str, completed_at: impl Into<String>) {
        let completed_at = completed_at.into();
        if let Some(change_set) = self.change_sets.iter_mut().find(|item| item.id == id) {
            change_set.status = ChangeSetStatus::Applied;
            change_set.completed_at = Some(completed_at);
            change_set.error = None;
        }
        self.active_change_set_id = None;
        self.last_applied_change_set_id = Some(id.to_string());
        self.repair_state = None;
    }

    pub fn set_backup_dir(&mut self, id: &str, backup_dir: impl Into<String>) {
        if let Some(change_set) = self.change_sets.iter_mut().find(|item| item.id == id) {
            change_set.backup_dir = Some(backup_dir.into());
        }
    }

    pub fn mark_failed(
        &mut self,
        id: &str,
        completed_at: impl Into<String>,
        error: impl Into<String>,
    ) {
        let completed_at = completed_at.into();
        let error = error.into();
        if let Some(change_set) = self.change_sets.iter_mut().find(|item| item.id == id) {
            change_set.status = ChangeSetStatus::Failed;
            change_set.completed_at = Some(completed_at.clone());
            change_set.error = Some(error.clone());
        }
        if self.active_change_set_id.as_deref() == Some(id) {
            self.active_change_set_id = None;
        }
        self.repair_state = Some(ManifestRepairState {
            change_set_id: id.to_string(),
            reason: error,
            detected_at: completed_at,
        });
    }

    pub fn mark_repaired(&mut self, id: &str, completed_at: impl Into<String>) {
        let completed_at = completed_at.into();
        if let Some(change_set) = self.change_sets.iter_mut().find(|item| item.id == id) {
            change_set.status = ChangeSetStatus::Repaired;
            change_set.completed_at = Some(completed_at);
            change_set.error = None;
        }
        if self.active_change_set_id.as_deref() == Some(id) {
            self.active_change_set_id = None;
        }
        if self
            .repair_state
            .as_ref()
            .map(|state| state.change_set_id.as_str())
            == Some(id)
        {
            self.repair_state = None;
        }
    }

    pub fn change_set(&self, id: &str) -> Option<&ManifestChangeSet> {
        self.change_sets.iter().find(|item| item.id == id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestChangeSet {
    pub id: String,
    pub status: ChangeSetStatus,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub touched_files: Vec<String>,
    pub backup_dir: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeSetStatus {
    Started,
    Applied,
    Failed,
    Repaired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestRepairState {
    pub change_set_id: String,
    pub reason: String,
    pub detected_at: String,
}
