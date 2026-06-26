//! 文件存储 manifest 模型集成测试。
//!
//! @author kongweiguang

use kerminal_lib::storage::storage_manifest::{
    ChangeSetStatus, ManifestRepairState, StorageManifest,
};

#[test]
fn manifest_tracks_backup_failure_and_repair_lifecycle() {
    let mut manifest = StorageManifest::new();

    manifest.begin_change_set(
        "change-1",
        "2026-06-24T09:00:00+08:00",
        vec!["settings.toml".to_owned()],
    );
    manifest.set_backup_dir("change-1", "backups/change-1");
    manifest.mark_failed("change-1", "2026-06-24T09:00:01+08:00", "replace failed");

    assert_eq!(manifest.active_change_set_id, None);
    assert_eq!(
        manifest.repair_state,
        Some(ManifestRepairState {
            change_set_id: "change-1".to_owned(),
            reason: "replace failed".to_owned(),
            detected_at: "2026-06-24T09:00:01+08:00".to_owned(),
        })
    );
    assert_eq!(
        manifest.change_sets[0].backup_dir.as_deref(),
        Some("backups/change-1")
    );
    assert_eq!(manifest.change_sets[0].status, ChangeSetStatus::Failed);

    manifest.mark_repaired("change-1", "2026-06-24T09:00:02+08:00");

    assert_eq!(manifest.repair_state, None);
    assert_eq!(manifest.change_sets[0].status, ChangeSetStatus::Repaired);
    assert_eq!(manifest.change_sets[0].error, None);
}

#[test]
fn manifest_clears_active_change_set_after_success() {
    let mut manifest = StorageManifest::new();
    manifest.begin_change_set(
        "change-2",
        "2026-06-24T09:00:00+08:00",
        vec!["profiles/default.toml".to_owned()],
    );

    manifest.mark_applied("change-2", "2026-06-24T09:00:01+08:00");

    assert_eq!(manifest.active_change_set_id, None);
    assert_eq!(
        manifest.last_applied_change_set_id.as_deref(),
        Some("change-2")
    );
    assert_eq!(manifest.change_sets[0].status, ChangeSetStatus::Applied);
}
