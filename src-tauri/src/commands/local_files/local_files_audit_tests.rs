//! 本机文件写操作审计测试。
//!
//! @author kongweiguang

use super::{local_delete_audit_write, LocalDeletePathRequest};

#[test]
fn local_delete_audit_write_records_failed_confirmation() {
    let request = LocalDeletePathRequest {
        confirm_name: "other.txt".to_owned(),
        kind: "file".to_owned(),
        path: "C:\\Users\\24052\\remove.txt".to_owned(),
        recursive: false,
        root_path: Some("C:\\Users\\24052".to_owned()),
    };

    let audit = local_delete_audit_write(&request, &Err("删除确认名称不匹配".to_owned()));

    assert_eq!(audit.operation, "delete");
    assert_eq!(audit.status, "failed");
    assert!(!audit.confirmation_matched);
    assert_eq!(audit.error.as_deref(), Some("删除确认名称不匹配"));
}
