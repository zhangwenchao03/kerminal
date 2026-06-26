//! FileStore public TOML behavior integration tests.
//!
//! @author kongweiguang

use std::{fs, path::Path};

use kerminal_lib::storage::{
    file_store::{FileStore, FileStoreError},
    storage_manifest::StorageManifest,
};
use tempfile::tempdir;

#[test]
fn toml_roundtrip_writes_and_reads_storage_manifest() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());
    let mut manifest = StorageManifest::new();
    manifest.begin_change_set(
        "change-1",
        "2026-06-24T10:00:00+08:00",
        vec!["settings.toml".to_owned()],
    );

    store
        .write_toml("manifest.toml", &manifest)
        .expect("write manifest");
    let loaded = store
        .read_toml::<StorageManifest>("manifest.toml")
        .expect("read manifest");

    assert_eq!(loaded, manifest);
}

#[test]
fn bad_toml_returns_parse_diagnostics_with_path() {
    let temp = tempdir().expect("temp dir");
    let store = FileStore::new(temp.path());
    fs::write(temp.path().join("manifest.toml"), "schema_version =\n").expect("bad toml");

    let error = store
        .read_toml::<StorageManifest>("manifest.toml")
        .expect_err("bad TOML should fail");

    match error {
        FileStoreError::TomlParse(parse_error) => {
            let diagnostics = parse_error.diagnostics();
            assert_eq!(diagnostics.len(), 1);
            assert_eq!(
                diagnostics[0].path.as_deref(),
                Some(Path::new("manifest.toml"))
            );
            assert_eq!(diagnostics[0].line, 1);
        }
        other => panic!("expected TOML parse error, got {other:?}"),
    }
}
