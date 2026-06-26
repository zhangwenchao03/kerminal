//! JSONL audit log storage integration tests.
//!
//! @author kongweiguang

use std::{fs::OpenOptions, io::Write};

use kerminal_lib::storage::audit_log_store::AuditLogStore;
use serde::{Deserialize, Serialize};
use tempfile::tempdir;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct AuditEvent {
    id: String,
    operation: String,
}

#[test]
fn jsonl_reader_skips_bad_lines_and_reports_diagnostics() {
    let temp = tempdir().expect("temp dir");
    let store = AuditLogStore::new(temp.path());
    let first = AuditEvent {
        id: "one".to_string(),
        operation: "delete".to_string(),
    };
    let second = AuditEvent {
        id: "two".to_string(),
        operation: "delete".to_string(),
    };

    store
        .append_jsonl("logs/local-file-operations/2026-06-23.jsonl", &first)
        .expect("append first");
    OpenOptions::new()
        .append(true)
        .open(
            temp.path()
                .join("logs/local-file-operations/2026-06-23.jsonl"),
        )
        .expect("open log")
        .write_all(b"not-json\n")
        .expect("write bad line");
    store
        .append_jsonl("logs/local-file-operations/2026-06-23.jsonl", &second)
        .expect("append second");

    let read = store
        .read_jsonl::<AuditEvent>("logs/local-file-operations/2026-06-23.jsonl")
        .expect("read jsonl");

    assert_eq!(read.records, vec![first, second]);
    assert_eq!(read.diagnostics.len(), 1);
    assert_eq!(read.diagnostics[0].line_number, 2);
    assert_eq!(read.diagnostics[0].raw_line, "not-json");
}
