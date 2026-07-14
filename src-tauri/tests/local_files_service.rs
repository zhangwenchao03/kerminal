//! 本机文件删除 service ownership 聚焦测试。

use std::{fs, path::Path};

use kerminal_lib::{
    paths::KerminalPaths,
    services::local_file_service::{delete_path, record_delete_audit, LocalDeletePathRequest},
    storage::RuntimeFileStore,
};
use tempfile::tempdir;

#[test]
fn local_file_service_deletes_file_and_persists_success_audit() {
    let files = tempdir().expect("create files temp dir");
    let source = files.path().join("remove.txt");
    fs::write(&source, "delete me").expect("write source file");
    let request = LocalDeletePathRequest {
        confirm_name: "remove.txt".to_owned(),
        kind: "file".to_owned(),
        path: path_string(&source),
        recursive: false,
        root_path: Some(path_string(files.path())),
    };

    let outcome = delete_path(request.clone()).expect("delete through local file service");
    assert!(!source.exists());
    assert_eq!(outcome.parent_path, files.path().canonicalize().unwrap());

    let home = tempdir().expect("create storage temp dir");
    let paths = KerminalPaths::from_home_dir(home.path());
    let storage = RuntimeFileStore::open(&paths).expect("open runtime file store");
    let parent_path = path_string(&outcome.parent_path);
    record_delete_audit(&storage, &request, Ok(parent_path.as_str()))
        .expect("persist delete audit");

    let audits = storage
        .list_local_file_operation_audits(10)
        .expect("list delete audits");
    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].operation, "delete");
    assert_eq!(audits[0].status, "succeeded");
    assert_eq!(audits[0].parent_path.as_deref(), Some(parent_path.as_str()));
    assert!(audits[0].confirmation_matched);
    assert!(audits[0].error.is_none());
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
