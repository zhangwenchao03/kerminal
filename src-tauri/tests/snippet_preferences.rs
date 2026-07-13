use kerminal_lib::{
    paths::KerminalPaths,
    storage::{
        snippet_preferences::{SnippetPreferenceOrigin, SnippetUsageAction},
        CommandSqliteStore,
    },
};
use tempfile::tempdir;

#[test]
fn usage_receipt_is_idempotent_and_does_not_store_command_context() {
    let home = tempdir().expect("temp home");
    let store =
        CommandSqliteStore::open(&KerminalPaths::from_home_dir(home.path())).expect("open store");
    assert!(store
        .record_snippet_usage(
            "receipt-1",
            SnippetPreferenceOrigin::Builtin,
            "snippet-1",
            SnippetUsageAction::Insert,
            100,
        )
        .expect("first usage"));
    assert!(!store
        .record_snippet_usage(
            "receipt-1",
            SnippetPreferenceOrigin::Builtin,
            "snippet-1",
            SnippetUsageAction::Insert,
            100,
        )
        .expect("duplicate usage"));
    let preference = store
        .snippet_preference(SnippetPreferenceOrigin::Builtin, "snippet-1")
        .expect("read preference")
        .expect("preference exists");
    assert_eq!(preference.use_count, 1);
    assert_eq!(preference.last_used_at_unix_ms, Some(100));
}

#[test]
fn clear_usage_preserves_favorite() {
    let home = tempdir().expect("temp home");
    let store =
        CommandSqliteStore::open(&KerminalPaths::from_home_dir(home.path())).expect("open store");
    store
        .set_snippet_favorite(SnippetPreferenceOrigin::User, "mine", true)
        .expect("favorite");
    store
        .record_snippet_usage(
            "receipt-2",
            SnippetPreferenceOrigin::User,
            "mine",
            SnippetUsageAction::Run,
            200,
        )
        .expect("usage");
    store.clear_snippet_usage().expect("clear usage");
    let preference = store
        .snippet_preference(SnippetPreferenceOrigin::User, "mine")
        .expect("read")
        .expect("favorite remains");
    assert!(preference.favorite);
    assert_eq!(preference.use_count, 0);
    assert_eq!(preference.last_action, None);
}
