use kerminal_lib::services::snippet_catalog_registry;

#[test]
fn runtime_registry_reads_compiled_catalog_without_source_files() {
    let catalog = snippet_catalog_registry::all();
    assert!(!catalog.is_empty());
    let item = snippet_catalog_registry::by_id("snippet.builtin.core.system_overview")
        .expect("bootstrap catalog item");
    assert_eq!(item.risk, "inspect");
    assert_eq!(item.default_action, "insert");
    assert_eq!(item.command_spec, "ps");
    assert!(item.variables.is_empty());
}

#[test]
fn missing_catalog_id_returns_none() {
    assert!(snippet_catalog_registry::by_id("missing").is_none());
}
