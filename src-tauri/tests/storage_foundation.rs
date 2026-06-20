//! Kerminal 数据目录和 SQLite 基础集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    paths::{KerminalPaths, DATABASE_FILE_NAME, KERMINAL_DIR_NAME},
    state::AppState,
    storage::migrations::{migrate, CURRENT_SCHEMA_VERSION},
};
use rusqlite::Connection;
use tempfile::tempdir;

#[test]
fn resolves_kerminal_paths_under_home_directory() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    assert_eq!(paths.root, home.path().join(KERMINAL_DIR_NAME));
    assert_eq!(paths.database_file, paths.root.join(DATABASE_FILE_NAME));
    assert_eq!(paths.logs, paths.root.join("logs"));
    assert_eq!(paths.cache, paths.root.join("cache"));
    assert_eq!(paths.themes, paths.root.join("themes"));
    assert_eq!(paths.skills, paths.root.join("skills"));
    assert_eq!(paths.snippets, paths.root.join("snippets"));
    assert_eq!(paths.exports, paths.root.join("exports"));
    assert_eq!(paths.temp, paths.root.join("temp"));
    assert_eq!(paths.diagnostics, paths.root.join("diagnostics"));
}

#[test]
fn ensure_directories_creates_managed_directory_tree() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    paths.ensure_directories().expect("create managed dirs");

    for directory in paths.managed_directories() {
        assert!(
            directory.is_dir(),
            "expected managed directory to exist: {}",
            directory.display()
        );
    }
}

#[test]
fn app_state_initialization_creates_database_and_schema() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");

    assert_eq!(state.paths(), &paths);
    assert_eq!(
        state.storage().database_file(),
        paths.database_file.as_path()
    );
    assert!(paths.database_file.is_file());
    assert_eq!(
        state
            .storage()
            .schema_version()
            .expect("read schema version"),
        CURRENT_SCHEMA_VERSION
    );
    assert_eq!(
        state
            .storage()
            .metadata_value("schema_version")
            .expect("read schema metadata"),
        Some(CURRENT_SCHEMA_VERSION.to_string())
    );
}

#[test]
fn sqlite_migration_is_idempotent_and_preserves_metadata() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    {
        let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
        state
            .storage()
            .set_metadata("smoke", "ok")
            .expect("write metadata");
    }

    let state = AppState::initialize_with_paths(paths.clone()).expect("reopen app state");

    assert_eq!(
        state
            .storage()
            .schema_version()
            .expect("read schema version"),
        CURRENT_SCHEMA_VERSION
    );
    assert_eq!(
        state
            .storage()
            .metadata_value("smoke")
            .expect("read preserved metadata"),
        Some("ok".to_string())
    );
}

#[test]
fn migration_creates_foundation_tables() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    {
        let _state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    }

    let conn = Connection::open(paths.database_file).expect("open initialized database");
    let table_count: u32 = conn
        .query_row(
            "
            SELECT COUNT(*)
            FROM sqlite_schema
            WHERE type = 'table'
              AND name IN (
                'kerminal_metadata',
                'app_settings',
                'terminal_profiles',
                'remote_host_groups',
                'remote_hosts',
                'llm_providers',
                'ai_tool_audits',
                'command_snippets',
                'command_suggestion_provider_cache',
                'command_suggestion_feedback',
                'command_suggestion_telemetry',
                'command_suggestion_audit_events'
              )
            ",
            [],
            |row| row.get(0),
        )
        .expect("count foundation tables");

    assert_eq!(table_count, 12);
}

#[test]
fn migration_v10_maps_legacy_openai_compatible_provider_to_openai_chat() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch(
        "
        CREATE TABLE llm_providers (
            id                     TEXT PRIMARY KEY NOT NULL,
            name                   TEXT NOT NULL,
            kind                   TEXT NOT NULL CHECK (kind IN ('openai_compatible')),
            base_url               TEXT NOT NULL,
            model                  TEXT NOT NULL,
            temperature            REAL NOT NULL DEFAULT 0.2 CHECK (temperature >= 0 AND temperature <= 2),
            context_strategy       TEXT NOT NULL CHECK (context_strategy IN ('minimal', 'current_terminal', 'current_workspace')),
            enabled                INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
            is_default             INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
            api_key_credential_ref TEXT,
            created_at             TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
            model_list_json        TEXT NOT NULL DEFAULT '[]',
            context_window_tokens  INTEGER NOT NULL DEFAULT 128000 CHECK (context_window_tokens >= 1024 AND context_window_tokens <= 2000000),
            reasoning_effort       TEXT NOT NULL DEFAULT 'model_default' CHECK (reasoning_effort IN ('model_default', 'minimal', 'low', 'medium', 'high')),
            max_retries            INTEGER NOT NULL DEFAULT 3 CHECK (max_retries >= 0 AND max_retries <= 10),
            user_agent             TEXT,
            http_proxy             TEXT
        );

        INSERT INTO llm_providers (
            id, name, kind, base_url, model, temperature, context_strategy,
            enabled, is_default, api_key_credential_ref, model_list_json,
            context_window_tokens, reasoning_effort, max_retries, user_agent, http_proxy
        )
        VALUES (
            'llm-legacy', 'Legacy Provider', 'openai_compatible',
            'https://api.example.com/v1', 'gpt-test', 0.2, 'current_terminal',
            1, 1, 'credential:llm/legacy/api-key', '[\"gpt-test\"]',
            128000, 'model_default', 3, NULL, NULL
        );
        ",
    )
    .expect("seed legacy llm_providers");
    conn.pragma_update(None, "user_version", 9)
        .expect("set v9 schema");

    migrate(&mut conn).expect("migrate to current schema");

    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read user_version");
    let migrated_kind: String = conn
        .query_row(
            "SELECT kind FROM llm_providers WHERE id = 'llm-legacy'",
            [],
            |row| row.get(0),
        )
        .expect("read migrated kind");

    assert_eq!(version, CURRENT_SCHEMA_VERSION);
    assert_eq!(migrated_kind, "openai_chat");
    conn.execute(
        "
        INSERT INTO llm_providers (
            id, name, kind, base_url, model, temperature, context_strategy,
            enabled, is_default, model_list_json, context_window_tokens,
            reasoning_effort, max_retries
        )
        VALUES (
            'llm-anthropic', 'Anthropic', 'anthropic',
            'https://api.anthropic.com', 'claude-sonnet-4-6', 0.2,
            'current_terminal', 1, 0, '[\"claude-sonnet-4-6\"]',
            200000, 'model_default', 3
        )
        ",
        [],
    )
    .expect("new provider kind passes v10 check");
}

#[test]
fn migration_v11_allows_remote_hosts_without_group() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE remote_host_groups (
            id         TEXT PRIMARY KEY NOT NULL,
            name       TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE remote_hosts (
            id             TEXT PRIMARY KEY NOT NULL,
            group_id       TEXT NOT NULL,
            name           TEXT NOT NULL,
            host           TEXT NOT NULL,
            port           INTEGER NOT NULL DEFAULT 22 CHECK (port >= 1 AND port <= 65535),
            username       TEXT NOT NULL,
            auth_type      TEXT NOT NULL CHECK (auth_type IN ('password', 'key', 'agent')),
            credential_ref TEXT,
            tags_json      TEXT NOT NULL DEFAULT '[]',
            production     INTEGER NOT NULL DEFAULT 0 CHECK (production IN (0, 1)),
            sort_order     INTEGER NOT NULL DEFAULT 0,
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(group_id) REFERENCES remote_host_groups(id) ON DELETE RESTRICT
        );

        INSERT INTO remote_host_groups (id, name, sort_order)
        VALUES ('group-dev', '开发主机', 10);

        INSERT INTO remote_hosts (
            id, group_id, name, host, port, username, auth_type,
            credential_ref, tags_json, production, sort_order
        )
        VALUES (
            'host-dev', 'group-dev', 'dev', 'dev.internal', 22, 'deploy',
            'agent', NULL, '[\"ssh\"]', 0, 10
        );
        ",
    )
    .expect("seed v10 remote host schema");
    conn.pragma_update(None, "user_version", 10)
        .expect("set v10 schema");

    migrate(&mut conn).expect("migrate to current schema");

    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read user_version");
    let group_id_not_null: i64 = conn
        .query_row(
            "SELECT \"notnull\" FROM pragma_table_info('remote_hosts') WHERE name = 'group_id'",
            [],
            |row| row.get(0),
        )
        .expect("read group_id nullability");

    assert_eq!(version, CURRENT_SCHEMA_VERSION);
    assert_eq!(group_id_not_null, 0);

    conn.execute("DELETE FROM remote_host_groups WHERE id = 'group-dev'", [])
        .expect("delete migrated group");
    let group_id: Option<String> = conn
        .query_row(
            "SELECT group_id FROM remote_hosts WHERE id = 'host-dev'",
            [],
            |row| row.get(0),
        )
        .expect("read migrated host group");
    assert_eq!(group_id, None);
}

#[test]
fn migration_v12_allows_container_command_history_target() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch(
        "
        CREATE TABLE command_history (
            id             TEXT PRIMARY KEY NOT NULL,
            command        TEXT NOT NULL,
            source         TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai', 'snippet', 'workflow', 'broadcast', 'tool')),
            target         TEXT NOT NULL DEFAULT 'local' CHECK (target IN ('local', 'ssh')),
            session_id     TEXT,
            pane_id        TEXT,
            tab_id         TEXT,
            profile_id     TEXT,
            remote_host_id TEXT,
            cwd            TEXT,
            shell          TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO command_history (id, command, source, target)
        VALUES ('history-ssh', 'uptime', 'user', 'ssh');
        ",
    )
    .expect("seed v11 command history schema");
    conn.pragma_update(None, "user_version", 11)
        .expect("set v11 schema");

    migrate(&mut conn).expect("migrate to current schema");

    conn.execute(
        "
        INSERT INTO command_history (id, command, source, target)
        VALUES ('history-container', 'ls /app', 'user', 'dockerContainer')
        ",
        [],
    )
    .expect("container command history target passes v12 check");
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read user_version");
    let count: u32 = conn
        .query_row("SELECT COUNT(*) FROM command_history", [], |row| row.get(0))
        .expect("count migrated history");

    assert_eq!(version, CURRENT_SCHEMA_VERSION);
    assert_eq!(count, 2);
}

#[test]
fn migration_v13_creates_command_suggestion_provider_cache() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.pragma_update(None, "user_version", 12)
        .expect("set v12 schema");

    migrate(&mut conn).expect("migrate to current schema");

    conn.execute(
        "
        INSERT INTO command_suggestion_provider_cache (
            provider, host_id, scope_key, payload_json,
            cached_at_unix_ms, expires_at_unix_ms, ttl_seconds
        )
        VALUES ('remoteCommand', 'host-prod', '', '[\"git\"]', 1, 2, 1)
        ",
        [],
    )
    .expect("remote command provider cache insert passes v13 schema");
    conn.execute(
        "
        INSERT INTO command_suggestion_provider_cache (
            provider, host_id, scope_key, payload_json,
            cached_at_unix_ms, expires_at_unix_ms, ttl_seconds
        )
        VALUES ('history', 'host-prod', 'remoteHistory', '[\"git status\"]', 1, 2, 1)
        ",
        [],
    )
    .expect("remote shell history provider cache insert passes current schema");
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read user_version");
    let count: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM command_suggestion_provider_cache",
            [],
            |row| row.get(0),
        )
        .expect("count provider cache");

    assert_eq!(version, CURRENT_SCHEMA_VERSION);
    assert_eq!(count, 2);
}

#[test]
fn migration_v14_creates_command_suggestion_feedback() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.pragma_update(None, "user_version", 13)
        .expect("set v13 schema");

    migrate(&mut conn).expect("migrate to current schema");

    conn.execute(
        "
        INSERT INTO command_suggestion_feedback (
            id, action, provider, target, replacement_text, input, created_at_unix_ms
        )
        VALUES ('feedback-1', 'accepted', 'history', 'ssh', 'git status', 'git', 1)
        ",
        [],
    )
    .expect("suggestion feedback insert passes v14 schema");
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read user_version");
    let count: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM command_suggestion_feedback",
            [],
            |row| row.get(0),
        )
        .expect("count suggestion feedback");

    assert_eq!(version, CURRENT_SCHEMA_VERSION);
    assert_eq!(count, 1);
}

#[test]
fn migration_v15_creates_command_suggestion_telemetry() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.pragma_update(None, "user_version", 14)
        .expect("set v14 schema");

    migrate(&mut conn).expect("migrate to current schema");

    conn.execute(
        "
        INSERT INTO command_suggestion_telemetry (
            provider, query_count, candidate_count, total_elapsed_ms,
            first_event_unix_ms, last_event_unix_ms
        )
        VALUES ('history', 1, 2, 3, 4, 5)
        ",
        [],
    )
    .expect("suggestion telemetry insert passes v15 schema");
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read user_version");
    let count: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM command_suggestion_telemetry",
            [],
            |row| row.get(0),
        )
        .expect("count suggestion telemetry");

    assert_eq!(version, CURRENT_SCHEMA_VERSION);
    assert_eq!(count, 1);
}

#[test]
fn migration_v16_creates_command_history_prefix_indexes() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch(
        "
        CREATE TABLE command_history (
            id             TEXT PRIMARY KEY NOT NULL,
            command        TEXT NOT NULL,
            source         TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai', 'snippet', 'workflow', 'broadcast', 'tool')),
            target         TEXT NOT NULL DEFAULT 'local' CHECK (target IN ('local', 'ssh', 'dockerContainer')),
            session_id     TEXT,
            pane_id        TEXT,
            tab_id         TEXT,
            profile_id     TEXT,
            remote_host_id TEXT,
            cwd            TEXT,
            shell          TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ",
    )
    .expect("seed command_history table");
    conn.pragma_update(None, "user_version", 15)
        .expect("set v15 schema");

    migrate(&mut conn).expect("migrate to current schema");

    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read user_version");
    let index_count: u32 = conn
        .query_row(
            "
            SELECT COUNT(*)
            FROM sqlite_schema
            WHERE type = 'index'
              AND name IN (
                'idx_command_history_target_command_created',
                'idx_command_history_target_host_command_created',
                'idx_command_history_target_recent',
                'idx_command_history_target_host_recent'
              )
            ",
            [],
            |row| row.get(0),
        )
        .expect("count v16 indexes");

    assert_eq!(version, CURRENT_SCHEMA_VERSION);
    assert_eq!(index_count, 4);
}

#[test]
fn migration_v17_creates_command_suggestion_audit_events() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.pragma_update(None, "user_version", 16)
        .expect("set v16 schema");

    migrate(&mut conn).expect("migrate to current schema");

    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read user_version");
    let table_count: u32 = conn
        .query_row(
            "
            SELECT COUNT(*)
            FROM sqlite_schema
            WHERE type = 'table'
              AND name = 'command_suggestion_audit_events'
            ",
            [],
            |row| row.get(0),
        )
        .expect("count audit table");
    let index_count: u32 = conn
        .query_row(
            "
            SELECT COUNT(*)
            FROM sqlite_schema
            WHERE type = 'index'
              AND name IN (
                'idx_command_suggestion_audit_created',
                'idx_command_suggestion_audit_remote_host',
                'idx_command_suggestion_audit_kind_provider'
              )
            ",
            [],
            |row| row.get(0),
        )
        .expect("count audit indexes");

    conn.execute(
        "
        INSERT INTO command_suggestion_audit_events (
            id, event_kind, provider, target, decision, reason,
            remote_host_id, metadata_json, created_at_unix_ms
        )
        VALUES (
            'audit-1', 'remoteProbeSchedule', 'remoteCommand', 'ssh',
            'skipped', 'production-host-restricted', 'host-prod',
            '{\"productionHost\":\"true\"}', 42
        )
        ",
        [],
    )
    .expect("audit event insert passes v17 schema");

    assert_eq!(version, CURRENT_SCHEMA_VERSION);
    assert_eq!(table_count, 1);
    assert_eq!(index_count, 3);
}

#[test]
fn migration_v18_allows_history_provider_cache() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch(
        "
        CREATE TABLE command_suggestion_provider_cache (
            provider           TEXT NOT NULL CHECK (provider IN ('remotePath', 'remoteCommand', 'git')),
            host_id            TEXT NOT NULL,
            scope_key          TEXT NOT NULL,
            repo_root          TEXT,
            payload_json       TEXT NOT NULL,
            cached_at_unix_ms  INTEGER NOT NULL,
            expires_at_unix_ms INTEGER NOT NULL,
            ttl_seconds        INTEGER NOT NULL CHECK (ttl_seconds >= 1),
            updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (provider, host_id, scope_key)
        );

        INSERT INTO command_suggestion_provider_cache (
            provider, host_id, scope_key, payload_json,
            cached_at_unix_ms, expires_at_unix_ms, ttl_seconds
        )
        VALUES ('remoteCommand', 'host-prod', '', '[\"git\"]', 1, 2, 1);
        ",
    )
    .expect("create legacy provider cache table");
    conn.pragma_update(None, "user_version", 17)
        .expect("set v17 schema");

    migrate(&mut conn).expect("migrate to current schema");

    conn.execute(
        "
        INSERT INTO command_suggestion_provider_cache (
            provider, host_id, scope_key, payload_json,
            cached_at_unix_ms, expires_at_unix_ms, ttl_seconds
        )
        VALUES ('history', 'host-prod', 'remoteHistory', '[\"git status\"]', 3, 4, 1)
        ",
        [],
    )
    .expect("history provider cache insert passes v18 schema");

    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read user_version");
    let count: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM command_suggestion_provider_cache",
            [],
            |row| row.get(0),
        )
        .expect("count provider cache rows");

    assert_eq!(version, CURRENT_SCHEMA_VERSION);
    assert_eq!(count, 2);
}

#[test]
fn migration_v19_adds_remote_host_ssh_options_json() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch(
        "
        CREATE TABLE remote_host_groups (
            id         TEXT PRIMARY KEY NOT NULL,
            name       TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE remote_hosts (
            id             TEXT PRIMARY KEY NOT NULL,
            group_id       TEXT,
            name           TEXT NOT NULL,
            host           TEXT NOT NULL,
            port           INTEGER NOT NULL DEFAULT 22 CHECK (port >= 1 AND port <= 65535),
            username       TEXT NOT NULL,
            auth_type      TEXT NOT NULL CHECK (auth_type IN ('password', 'key', 'agent')),
            credential_ref TEXT,
            tags_json      TEXT NOT NULL DEFAULT '[]',
            production     INTEGER NOT NULL DEFAULT 0 CHECK (production IN (0, 1)),
            sort_order     INTEGER NOT NULL DEFAULT 0,
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(group_id) REFERENCES remote_host_groups(id) ON DELETE SET NULL
        );

        INSERT INTO remote_hosts (
            id, group_id, name, host, port, username, auth_type,
            credential_ref, tags_json, production, sort_order
        )
        VALUES (
            'host-dev', NULL, 'dev', 'dev.internal', 22, 'deploy',
            'agent', NULL, '[\"ssh\"]', 0, 10
        );
        ",
    )
    .expect("seed v18 remote_hosts table");
    conn.pragma_update(None, "user_version", 18)
        .expect("set v18 schema");

    migrate(&mut conn).expect("migrate to current schema");

    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("read user_version");
    let ssh_options_not_null: i64 = conn
        .query_row(
            "SELECT \"notnull\" FROM pragma_table_info('remote_hosts') WHERE name = 'ssh_options_json'",
            [],
            |row| row.get(0),
        )
        .expect("read ssh_options_json nullability");
    let ssh_options_json: String = conn
        .query_row(
            "SELECT ssh_options_json FROM remote_hosts WHERE id = 'host-dev'",
            [],
            |row| row.get(0),
        )
        .expect("read migrated ssh options");

    assert_eq!(version, CURRENT_SCHEMA_VERSION);
    assert_eq!(ssh_options_not_null, 1);
    assert_eq!(ssh_options_json, "{}");
}

#[test]
fn sqlite_connection_enables_wal_and_foreign_keys() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");

    let conn =
        Connection::open(state.storage().database_file()).expect("open initialized database");
    let journal_mode: String = conn
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .expect("read journal mode");
    let foreign_keys: u32 = conn
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .expect("read foreign keys pragma");

    assert_eq!(journal_mode.to_lowercase(), "wal");
    assert_eq!(foreign_keys, 1);
}

#[test]
fn migration_rejects_database_from_newer_application_version() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    paths.ensure_directories().expect("create managed dirs");

    let conn = Connection::open(&paths.database_file).expect("create future database");
    conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION + 1)
        .expect("set future schema version");
    drop(conn);

    let error = AppState::initialize_with_paths(paths).expect_err("reject future schema");

    assert!(matches!(
        error,
        AppError::UnsupportedSchemaVersion {
            database_version,
            supported_version
        } if database_version == CURRENT_SCHEMA_VERSION + 1
            && supported_version == CURRENT_SCHEMA_VERSION
    ));
}

#[test]
fn initialization_fails_when_root_path_is_an_existing_file() {
    let file = tempfile::NamedTempFile::new().expect("create temp file");
    let paths = KerminalPaths::from_root(file.path());
    let error = AppState::initialize_with_paths(paths).expect_err("reject file as root dir");

    assert!(matches!(error, AppError::Io(_)));
}
