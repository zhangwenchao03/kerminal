use std::fs;

use kerminal_lib::{
    models::snippet::{
        SnippetCatalogVariable, SnippetContextBinding, SnippetContextBindingKind, SnippetScope,
    },
    paths::KerminalPaths,
    storage::{
        config_file_store::{ConfigFileStore, SnippetDocumentPatch},
        file_store::FileStoreError,
    },
};
use tempfile::tempdir;

fn source() -> &'static str {
    r#"# 用户注释必须保留
schema_version = 1
id = "sample"
title = "旧标题"
description = "旧说明"
command = "echo old"
tags = ["ops"]
scope = "any"
sort_order = 10
created_at = "1"
updated_at = "1"
future_key = "外部 Agent 拥有"
"#
}

#[test]
fn patch_preserves_comments_and_unknown_fields() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("dirs");
    let path = paths.snippets.join("sample.toml");
    fs::write(&path, source()).expect("fixture");
    let store = ConfigFileStore::new(paths.root);
    let snapshot = store.read_snippet_document("sample").expect("read");
    let updated = store
        .patch_snippet_document(
            "sample",
            &SnippetDocumentPatch {
                expected_revision: snapshot.revision.clone(),
                title: "新标题".to_owned(),
                description: None,
                command: "echo new".to_owned(),
                tags: vec!["ops".to_owned(), "daily".to_owned()],
                scope: SnippetScope::Ssh,
                sort_order: 20,
                updated_at: "2".to_owned(),
                category: None,
                risk: None,
                default_action: None,
                variables: Vec::new(),
                context_bindings: Vec::new(),
                derived_from: None,
            },
        )
        .expect("patch");
    let encoded = fs::read_to_string(path).expect("source");
    assert!(encoded.contains("# 用户注释必须保留"));
    assert!(encoded.contains("future_key = \"外部 Agent 拥有\""));
    assert!(!encoded.contains("description ="));
    assert_eq!(updated.snippet.title, "新标题");
    assert_ne!(updated.revision, snapshot.revision);
}

#[test]
fn stale_revision_never_overwrites_external_edit() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("dirs");
    let path = paths.snippets.join("sample.toml");
    fs::write(&path, source()).expect("fixture");
    let store = ConfigFileStore::new(paths.root);
    let snapshot = store.read_snippet_document("sample").expect("read");
    fs::write(&path, source().replace("旧标题", "外部标题")).expect("external edit");
    let error = store
        .patch_snippet_document(
            "sample",
            &SnippetDocumentPatch {
                expected_revision: snapshot.revision,
                title: "UI 标题".to_owned(),
                description: None,
                command: "echo ui".to_owned(),
                tags: vec![],
                scope: SnippetScope::Any,
                sort_order: 10,
                updated_at: "2".to_owned(),
                category: None,
                risk: None,
                default_action: None,
                variables: Vec::new(),
                context_bindings: Vec::new(),
                derived_from: None,
            },
        )
        .expect_err("revision conflict");
    assert!(matches!(error, FileStoreError::RevisionConflict(_)));
    assert!(fs::read_to_string(path)
        .expect("source")
        .contains("外部标题"));
}

#[test]
fn typed_metadata_round_trips_while_unknown_fields_remain_lossless() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("dirs");
    let path = paths.snippets.join("sample.toml");
    fs::write(&path, source()).expect("fixture");
    let store = ConfigFileStore::new(paths.root);
    let snapshot = store.read_snippet_document("sample").expect("read v1");
    assert_eq!(snapshot.snippet.category, None);
    assert_eq!(snapshot.snippet.risk, None);
    assert_eq!(snapshot.snippet.default_action, None);
    assert!(snapshot.snippet.variables.is_empty());
    assert!(snapshot.snippet.context_bindings.is_empty());
    assert_eq!(snapshot.snippet.derived_from, None);

    let updated = store
        .patch_snippet_document(
            "sample",
            &SnippetDocumentPatch {
                expected_revision: snapshot.revision,
                title: "新标题".to_owned(),
                description: Some("typed metadata".to_owned()),
                command: "echo {{ service }}".to_owned(),
                tags: vec!["ops".to_owned()],
                scope: SnippetScope::Ssh,
                sort_order: 20,
                updated_at: "2".to_owned(),
                category: Some("service".to_owned()),
                risk: Some("change".to_owned()),
                default_action: Some("insert".to_owned()),
                variables: vec![SnippetCatalogVariable {
                    name: "service".to_owned(),
                    label: "服务".to_owned(),
                    description: "systemd 服务名".to_owned(),
                    kind: "service".to_owned(),
                    required: true,
                    default_value: Some("nginx".to_owned()),
                    suggestions: vec!["nginx".to_owned()],
                    validation: None,
                    render_strategy: "validatedRaw".to_owned(),
                    sensitive: false,
                }],
                context_bindings: vec![SnippetContextBinding {
                    kind: SnippetContextBindingKind::Host,
                    target_id: Some("host-prod".to_owned()),
                }],
                derived_from: Some("core.service-status".to_owned()),
            },
        )
        .expect("patch typed metadata");

    assert_eq!(updated.snippet.category.as_deref(), Some("service"));
    assert_eq!(updated.snippet.risk.as_deref(), Some("change"));
    assert_eq!(updated.snippet.default_action.as_deref(), Some("insert"));
    assert_eq!(
        updated.snippet.variables[0].default_value.as_deref(),
        Some("nginx")
    );
    assert_eq!(
        updated.snippet.context_bindings[0].target_id.as_deref(),
        Some("host-prod")
    );
    assert_eq!(
        updated.snippet.derived_from.as_deref(),
        Some("core.service-status")
    );
    let encoded = fs::read_to_string(path).expect("source");
    assert!(encoded.contains("# 用户注释必须保留"));
    assert!(encoded.contains("future_key = \"外部 Agent 拥有\""));
    assert!(encoded.contains("default_value = \"nginx\""));
    assert!(encoded.contains("target_id = \"host-prod\""));
}

#[test]
fn secret_variable_values_are_rejected_without_writing() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("dirs");
    let path = paths.snippets.join("sample.toml");
    fs::write(&path, source()).expect("fixture");
    let store = ConfigFileStore::new(paths.root);
    let snapshot = store.read_snippet_document("sample").expect("read");
    let error = store
        .patch_snippet_document(
            "sample",
            &SnippetDocumentPatch {
                expected_revision: snapshot.revision,
                title: "secret".to_owned(),
                description: None,
                command: "echo {{ token }}".to_owned(),
                tags: vec![],
                scope: SnippetScope::Any,
                sort_order: 10,
                updated_at: "2".to_owned(),
                category: None,
                risk: Some("change".to_owned()),
                default_action: Some("insert".to_owned()),
                variables: vec![SnippetCatalogVariable {
                    name: "token".to_owned(),
                    label: "Token".to_owned(),
                    description: String::new(),
                    kind: "secret".to_owned(),
                    required: true,
                    default_value: Some("must-not-write".to_owned()),
                    suggestions: Vec::new(),
                    validation: None,
                    render_strategy: "shellArg".to_owned(),
                    sensitive: true,
                }],
                context_bindings: Vec::new(),
                derived_from: None,
            },
        )
        .expect_err("reject secret value");
    assert!(matches!(error, FileStoreError::TomlEncode(_)));
    assert_eq!(fs::read_to_string(path).expect("source"), source());
}

#[test]
fn invalid_file_is_isolated_from_valid_snippets() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("dirs");
    fs::write(paths.snippets.join("sample.toml"), source()).expect("valid");
    fs::write(paths.snippets.join("broken.toml"), "title = [").expect("broken");
    let store = ConfigFileStore::new(paths.root);
    let result = store.list_snippet_documents().expect("partial list");
    assert_eq!(result.snippets.len(), 1);
    assert_eq!(result.snippets[0].id, "sample");
    assert_eq!(result.warnings.len(), 1);
    assert_eq!(result.warnings[0].file_name, "broken.toml");
}

#[test]
fn invalid_optional_metadata_is_isolated_and_patch_is_rejected() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("dirs");
    fs::write(paths.snippets.join("sample.toml"), source()).expect("valid");
    fs::write(
        paths.snippets.join("invalid-metadata.toml"),
        source()
            .replace("id = \"sample\"", "id = \"invalid-metadata\"")
            .replace(
                "updated_at = \"1\"",
                "updated_at = \"1\"\nrisk = \"surprise\"",
            ),
    )
    .expect("invalid metadata");
    let store = ConfigFileStore::new(paths.root);
    let listed = store.list_snippet_documents().expect("partial list");
    assert_eq!(listed.snippets.len(), 1);
    assert_eq!(listed.warnings.len(), 1);

    let snapshot = store.read_snippet_document("sample").expect("read");
    let error = store
        .patch_snippet_document(
            "sample",
            &SnippetDocumentPatch {
                expected_revision: snapshot.revision,
                title: "invalid".to_owned(),
                description: None,
                command: "echo {{ value }}".to_owned(),
                tags: Vec::new(),
                scope: SnippetScope::Any,
                sort_order: 10,
                updated_at: "2".to_owned(),
                category: None,
                risk: Some("inspect".to_owned()),
                default_action: Some("insert".to_owned()),
                variables: vec![SnippetCatalogVariable {
                    name: "value".to_owned(),
                    label: "Value".to_owned(),
                    description: String::new(),
                    kind: "mystery".to_owned(),
                    required: true,
                    default_value: None,
                    suggestions: Vec::new(),
                    validation: None,
                    render_strategy: "shellArg".to_owned(),
                    sensitive: false,
                }],
                context_bindings: Vec::new(),
                derived_from: None,
            },
        )
        .expect_err("reject invalid metadata");
    assert!(matches!(error, FileStoreError::TomlEncode(_)));
}

#[test]
fn delete_receipt_restores_same_id_without_losing_source() {
    let home = tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("dirs");
    let path = paths.snippets.join("sample.toml");
    fs::write(&path, source()).expect("fixture");
    let store = ConfigFileStore::new(paths.root);
    let receipt = store
        .delete_snippet_with_receipt("sample")
        .expect("delete receipt");
    assert!(!path.exists());
    let restored = store
        .restore_deleted_snippet(&receipt)
        .expect("restore receipt");
    assert_eq!(restored.id, "sample");
    assert_eq!(fs::read_to_string(path).expect("source"), source());
}
