//! SQLite schema migration。
//!
//! @author kongweiguang

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

#[path = "migrations_ai_conversations.rs"]
mod migrations_ai_conversations;

/// 当前 SQLite schema 版本。
pub const CURRENT_SCHEMA_VERSION: u32 = 30;

/// 执行所有待应用 migration。
pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    let version = schema_version(conn)?;

    if version > CURRENT_SCHEMA_VERSION {
        return Err(AppError::UnsupportedSchemaVersion {
            database_version: version,
            supported_version: CURRENT_SCHEMA_VERSION,
        });
    }

    if version < 1 {
        migrate_to_v1(conn)?;
    }

    if version < 2 {
        migrate_to_v2(conn)?;
    }

    if version < 3 {
        migrate_to_v3(conn)?;
    }

    if version < 4 {
        migrate_to_v4(conn)?;
    }

    if version < 5 {
        migrate_to_v5(conn)?;
    }

    if version < 6 {
        migrate_to_v6(conn)?;
    }

    if version < 7 {
        migrate_to_v7(conn)?;
    }

    if version < 8 {
        migrate_to_v8(conn)?;
    }

    if version < 9 {
        migrate_to_v9(conn)?;
    }

    if version < 10 {
        migrate_to_v10(conn)?;
    }

    if version < 11 {
        migrate_to_v11(conn)?;
    }

    if version < 12 {
        migrate_to_v12(conn)?;
    }

    if version < 13 {
        migrate_to_v13(conn)?;
    }

    if version < 14 {
        migrate_to_v14(conn)?;
    }

    if version < 15 {
        migrate_to_v15(conn)?;
    }

    if version < 16 {
        migrate_to_v16(conn)?;
    }

    if version < 17 {
        migrate_to_v17(conn)?;
    }

    if version < 18 {
        migrate_to_v18(conn)?;
    }

    if version < 19 {
        migrate_to_v19(conn)?;
    }

    if version < 20 {
        migrations_ai_conversations::migrate_to_v20(conn)?;
    }

    if version < 21 {
        migrations_ai_conversations::migrate_to_v21(conn)?;
    }

    if version < 22 {
        migrate_to_v22(conn)?;
    }

    if version < 23 {
        migrations_ai_conversations::migrate_to_v23(conn)?;
    }

    if version < 24 {
        migrations_ai_conversations::migrate_to_v24(conn)?;
    }

    if version < 25 {
        migrations_ai_conversations::migrate_to_v25(conn)?;
    }

    if version < 26 {
        migrate_to_v26(conn)?;
    }

    if version < 27 {
        migrations_ai_conversations::migrate_to_v27(conn)?;
    }

    if version < 28 {
        migrate_to_v28(conn)?;
    }

    if version < 29 {
        migrate_to_v29(conn)?;
    }

    if version < 30 {
        migrate_to_v30(conn)?;
    }

    ensure_port_forward_sessions_schema(conn)?;

    Ok(())
}

/// 读取 SQLite `PRAGMA user_version`。
pub fn schema_version(conn: &Connection) -> AppResult<u32> {
    Ok(conn.pragma_query_value(None, "user_version", |row| row.get(0))?)
}

fn table_exists(conn: &Connection, table_name: &str) -> AppResult<bool> {
    let exists: i64 = conn.query_row(
        "
        SELECT EXISTS(
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name = ?1
        )
        ",
        [table_name],
        |row| row.get(0),
    )?;
    Ok(exists != 0)
}

fn migrate_to_v1(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS kerminal_metadata (
            key        TEXT PRIMARY KEY NOT NULL,
            value      TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key        TEXT PRIMARY KEY NOT NULL,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ",
    )?;

    tx.pragma_update(None, "user_version", 1)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v2(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS terminal_profiles (
            id         TEXT PRIMARY KEY NOT NULL,
            name       TEXT NOT NULL,
            shell      TEXT NOT NULL,
            args_json  TEXT NOT NULL DEFAULT '[]',
            cwd        TEXT,
            env_json   TEXT NOT NULL DEFAULT '{}',
            is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_profiles_default
            ON terminal_profiles(is_default)
            WHERE is_default = 1;

        CREATE INDEX IF NOT EXISTS idx_terminal_profiles_sort
            ON terminal_profiles(sort_order, name);
        ",
    )?;

    tx.pragma_update(None, "user_version", 2)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v3(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS remote_host_groups (
            id         TEXT PRIMARY KEY NOT NULL,
            name       TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS remote_hosts (
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

        CREATE INDEX IF NOT EXISTS idx_remote_host_groups_sort
            ON remote_host_groups(sort_order, name);

        CREATE INDEX IF NOT EXISTS idx_remote_hosts_group_sort
            ON remote_hosts(group_id, sort_order, name);

        CREATE INDEX IF NOT EXISTS idx_remote_hosts_host
            ON remote_hosts(host, port, username);
        ",
    )?;

    tx.pragma_update(None, "user_version", 3)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v4(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS llm_providers (
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
            updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_providers_default
            ON llm_providers(is_default)
            WHERE is_default = 1;

        CREATE INDEX IF NOT EXISTS idx_llm_providers_enabled
            ON llm_providers(enabled, name);
        ",
    )?;

    tx.pragma_update(None, "user_version", 4)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v5(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ai_tool_audits (
            id                TEXT PRIMARY KEY NOT NULL,
            invocation_id     TEXT NOT NULL,
            tool_id           TEXT NOT NULL,
            tool_title        TEXT NOT NULL,
            risk              TEXT NOT NULL CHECK (risk IN ('read', 'write', 'remote', 'batch', 'destructive')),
            confirmation      TEXT NOT NULL CHECK (confirmation IN ('auto', 'contextual', 'always')),
            arguments_summary TEXT NOT NULL,
            risk_summary      TEXT,
            status            TEXT NOT NULL CHECK (status IN ('pending', 'rejected', 'succeeded', 'failed')),
            result_summary    TEXT,
            error             TEXT,
            created_at        TEXT NOT NULL,
            completed_at      TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ai_tool_audits_completed_at
            ON ai_tool_audits(completed_at DESC);

        CREATE INDEX IF NOT EXISTS idx_ai_tool_audits_tool_status
            ON ai_tool_audits(tool_id, status);
        ",
    )?;

    tx.pragma_update(None, "user_version", 5)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v6(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS command_snippets (
            id          TEXT PRIMARY KEY NOT NULL,
            title       TEXT NOT NULL,
            description TEXT,
            command     TEXT NOT NULL,
            tags_json   TEXT NOT NULL DEFAULT '[]',
            scope       TEXT NOT NULL DEFAULT 'any' CHECK (scope IN ('any', 'local', 'ssh')),
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_command_snippets_scope_sort
            ON command_snippets(scope, sort_order, title);

        CREATE INDEX IF NOT EXISTS idx_command_snippets_sort
            ON command_snippets(sort_order, title);
        ",
    )?;

    tx.pragma_update(None, "user_version", 6)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v7(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS command_history (
            id             TEXT PRIMARY KEY NOT NULL,
            command        TEXT NOT NULL,
            source         TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'ai', 'snippet', 'broadcast', 'tool')),
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

        CREATE INDEX IF NOT EXISTS idx_command_history_created_at
            ON command_history(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_command_history_target_created_at
            ON command_history(target, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_command_history_remote_host
            ON command_history(remote_host_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_command_history_session
            ON command_history(session_id, created_at DESC);
        ",
    )?;

    tx.pragma_update(None, "user_version", 7)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v8(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        ALTER TABLE command_history RENAME TO command_history_v7;

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

        INSERT INTO command_history (
            id, command, source, target, session_id, pane_id, tab_id,
            profile_id, remote_host_id, cwd, shell, created_at
        )
        SELECT
            id, command, source, target, session_id, pane_id, tab_id,
            profile_id, remote_host_id, cwd, shell, created_at
        FROM command_history_v7;

        DROP TABLE command_history_v7;

        CREATE INDEX IF NOT EXISTS idx_command_history_created_at
            ON command_history(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_command_history_target_created_at
            ON command_history(target, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_command_history_remote_host
            ON command_history(remote_host_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_command_history_session
            ON command_history(session_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS command_workflows (
            id          TEXT PRIMARY KEY NOT NULL,
            title       TEXT NOT NULL,
            description TEXT,
            tags_json   TEXT NOT NULL DEFAULT '[]',
            scope       TEXT NOT NULL DEFAULT 'any' CHECK (scope IN ('any', 'local', 'ssh')),
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS command_workflow_steps (
            id                    TEXT PRIMARY KEY NOT NULL,
            workflow_id           TEXT NOT NULL,
            title                 TEXT NOT NULL,
            description           TEXT,
            command               TEXT NOT NULL,
            scope                 TEXT CHECK (scope IS NULL OR scope IN ('any', 'local', 'ssh')),
            requires_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (requires_confirmation IN (0, 1)),
            sort_order            INTEGER NOT NULL DEFAULT 0,
            created_at            TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(workflow_id) REFERENCES command_workflows(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_command_workflows_scope_sort
            ON command_workflows(scope, sort_order, title);

        CREATE INDEX IF NOT EXISTS idx_command_workflows_sort
            ON command_workflows(sort_order, title);

        CREATE INDEX IF NOT EXISTS idx_command_workflow_steps_workflow_sort
            ON command_workflow_steps(workflow_id, sort_order, title);
        ",
    )?;

    tx.pragma_update(None, "user_version", 8)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v9(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        ALTER TABLE llm_providers ADD COLUMN model_list_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE llm_providers ADD COLUMN context_window_tokens INTEGER NOT NULL DEFAULT 128000 CHECK (context_window_tokens >= 1024 AND context_window_tokens <= 2000000);
        ALTER TABLE llm_providers ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'model_default' CHECK (reasoning_effort IN ('model_default', 'minimal', 'low', 'medium', 'high'));
        ALTER TABLE llm_providers ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries >= 0 AND max_retries <= 10);
        ALTER TABLE llm_providers ADD COLUMN user_agent TEXT;
        ALTER TABLE llm_providers ADD COLUMN http_proxy TEXT;
        ",
    )?;

    tx.pragma_update(None, "user_version", 9)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v10(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        ALTER TABLE llm_providers RENAME TO llm_providers_v9;

        CREATE TABLE llm_providers (
            id                     TEXT PRIMARY KEY NOT NULL,
            name                   TEXT NOT NULL,
            kind                   TEXT NOT NULL CHECK (kind IN ('openai_responses', 'openai_chat', 'anthropic')),
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
            id, name, kind, base_url, model, temperature,
            context_strategy, enabled, is_default, api_key_credential_ref,
            created_at, updated_at, model_list_json, context_window_tokens,
            reasoning_effort, max_retries, user_agent, http_proxy
        )
        SELECT
            id,
            name,
            CASE kind
                WHEN 'openai_responses' THEN 'openai_responses'
                WHEN 'anthropic' THEN 'anthropic'
                ELSE 'openai_chat'
            END,
            base_url,
            model,
            temperature,
            context_strategy,
            enabled,
            is_default,
            api_key_credential_ref,
            created_at,
            updated_at,
            model_list_json,
            context_window_tokens,
            reasoning_effort,
            max_retries,
            user_agent,
            http_proxy
        FROM llm_providers_v9;

        DROP TABLE llm_providers_v9;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_providers_default
            ON llm_providers(is_default)
            WHERE is_default = 1;

        CREATE INDEX IF NOT EXISTS idx_llm_providers_enabled
            ON llm_providers(enabled, name);
        ",
    )?;

    tx.pragma_update(None, "user_version", 10)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v11(conn: &mut Connection) -> AppResult<()> {
    let has_remote_hosts = table_exists(conn, "remote_hosts")?;
    let tx = conn.transaction()?;

    if !has_remote_hosts {
        tx.pragma_update(None, "user_version", 11)?;
        tx.commit()?;
        return Ok(());
    }

    tx.execute_batch(
        "
        ALTER TABLE remote_hosts RENAME TO remote_hosts_v10;

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
            credential_ref, tags_json, production, sort_order, created_at, updated_at
        )
        SELECT
            id, group_id, name, host, port, username, auth_type,
            credential_ref, tags_json, production, sort_order, created_at, updated_at
        FROM remote_hosts_v10;

        DROP TABLE remote_hosts_v10;

        CREATE INDEX IF NOT EXISTS idx_remote_hosts_group_sort
            ON remote_hosts(group_id, sort_order, name);

        CREATE INDEX IF NOT EXISTS idx_remote_hosts_host
            ON remote_hosts(host, port, username);
        ",
    )?;

    tx.pragma_update(None, "user_version", 11)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v12(conn: &mut Connection) -> AppResult<()> {
    let has_command_history = table_exists(conn, "command_history")?;
    let tx = conn.transaction()?;

    if !has_command_history {
        tx.pragma_update(None, "user_version", 12)?;
        tx.commit()?;
        return Ok(());
    }

    tx.execute_batch(
        "
        ALTER TABLE command_history RENAME TO command_history_v11;

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

        INSERT INTO command_history (
            id, command, source, target, session_id, pane_id, tab_id,
            profile_id, remote_host_id, cwd, shell, created_at
        )
        SELECT
            id, command, source, target, session_id, pane_id, tab_id,
            profile_id, remote_host_id, cwd, shell, created_at
        FROM command_history_v11;

        DROP TABLE command_history_v11;

        CREATE INDEX IF NOT EXISTS idx_command_history_created_at
            ON command_history(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_command_history_target_created_at
            ON command_history(target, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_command_history_remote_host
            ON command_history(remote_host_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_command_history_session
            ON command_history(session_id, created_at DESC);
        ",
    )?;

    tx.pragma_update(None, "user_version", 12)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v13(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS command_suggestion_provider_cache (
            provider           TEXT NOT NULL CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git')),
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

        CREATE INDEX IF NOT EXISTS idx_command_suggestion_provider_cache_expires
            ON command_suggestion_provider_cache(provider, expires_at_unix_ms);

        CREATE INDEX IF NOT EXISTS idx_command_suggestion_provider_cache_host
            ON command_suggestion_provider_cache(host_id, provider);
        ",
    )?;

    tx.pragma_update(None, "user_version", 13)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v14(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS command_suggestion_feedback (
            id                TEXT PRIMARY KEY NOT NULL,
            action            TEXT NOT NULL CHECK (action IN ('accepted', 'dismissed')),
            provider          TEXT NOT NULL CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git', 'spec', 'ai')),
            target            TEXT NOT NULL DEFAULT 'local' CHECK (target IN ('local', 'ssh', 'dockerContainer')),
            replacement_text  TEXT NOT NULL,
            input             TEXT NOT NULL,
            source_id         TEXT,
            session_id        TEXT,
            pane_id           TEXT,
            profile_id        TEXT,
            remote_host_id    TEXT,
            cwd               TEXT,
            shell             TEXT,
            created_at_unix_ms INTEGER NOT NULL,
            created_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_command_suggestion_feedback_replacement
            ON command_suggestion_feedback(provider, replacement_text, created_at_unix_ms DESC);

        CREATE INDEX IF NOT EXISTS idx_command_suggestion_feedback_remote_host
            ON command_suggestion_feedback(remote_host_id, provider, created_at_unix_ms DESC);
        ",
    )?;

    tx.pragma_update(None, "user_version", 14)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v15(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS command_suggestion_telemetry (
            provider                 TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git', 'spec', 'ai')),
            query_count              INTEGER NOT NULL DEFAULT 0 CHECK (query_count >= 0),
            candidate_count          INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
            total_elapsed_ms         INTEGER NOT NULL DEFAULT 0 CHECK (total_elapsed_ms >= 0),
            cache_hit_count          INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit_count >= 0),
            cache_miss_count         INTEGER NOT NULL DEFAULT 0 CHECK (cache_miss_count >= 0),
            refresh_success_count    INTEGER NOT NULL DEFAULT 0 CHECK (refresh_success_count >= 0),
            refresh_failure_count    INTEGER NOT NULL DEFAULT 0 CHECK (refresh_failure_count >= 0),
            feedback_accepted_count  INTEGER NOT NULL DEFAULT 0 CHECK (feedback_accepted_count >= 0),
            feedback_dismissed_count INTEGER NOT NULL DEFAULT 0 CHECK (feedback_dismissed_count >= 0),
            feedback_skipped_count   INTEGER NOT NULL DEFAULT 0 CHECK (feedback_skipped_count >= 0),
            first_event_unix_ms      INTEGER NOT NULL,
            last_event_unix_ms       INTEGER NOT NULL,
            last_error               TEXT,
            updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_command_suggestion_telemetry_last_event
            ON command_suggestion_telemetry(last_event_unix_ms DESC);
        ",
    )?;

    tx.pragma_update(None, "user_version", 15)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v16(conn: &mut Connection) -> AppResult<()> {
    let has_command_history = table_exists(conn, "command_history")?;
    let tx = conn.transaction()?;

    if has_command_history {
        tx.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_command_history_target_command_created
                ON command_history(target, command, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_command_history_target_host_command_created
                ON command_history(target, remote_host_id, command, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_command_history_target_recent
                ON command_history(target, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_command_history_target_host_recent
                ON command_history(target, remote_host_id, created_at DESC);
            ",
        )?;
    }

    tx.pragma_update(None, "user_version", 16)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v17(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS command_suggestion_audit_events (
            id                 TEXT PRIMARY KEY NOT NULL,
            event_kind         TEXT NOT NULL CHECK (event_kind IN ('remoteProbeSchedule', 'remoteProbeRefresh', 'feedback')),
            provider           TEXT CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git', 'spec', 'ai')),
            target             TEXT NOT NULL DEFAULT 'local' CHECK (target IN ('local', 'ssh', 'dockerContainer')),
            decision           TEXT NOT NULL CHECK (decision IN ('allowed', 'skipped', 'succeeded', 'failed', 'recorded')),
            reason             TEXT,
            remote_host_id     TEXT,
            cwd                TEXT,
            path               TEXT,
            pane_id            TEXT,
            session_id         TEXT,
            metadata_json      TEXT NOT NULL DEFAULT '{}',
            created_at_unix_ms INTEGER NOT NULL,
            created_at         TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_command_suggestion_audit_created
            ON command_suggestion_audit_events(created_at_unix_ms DESC);

        CREATE INDEX IF NOT EXISTS idx_command_suggestion_audit_remote_host
            ON command_suggestion_audit_events(remote_host_id, created_at_unix_ms DESC);

        CREATE INDEX IF NOT EXISTS idx_command_suggestion_audit_kind_provider
            ON command_suggestion_audit_events(event_kind, provider, created_at_unix_ms DESC);
        ",
    )?;

    tx.pragma_update(None, "user_version", 17)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v18(conn: &mut Connection) -> AppResult<()> {
    let has_provider_cache = table_exists(conn, "command_suggestion_provider_cache")?;
    let tx = conn.transaction()?;

    if has_provider_cache {
        tx.execute_batch(
            "
            CREATE TABLE command_suggestion_provider_cache_v18 (
                provider           TEXT NOT NULL CHECK (provider IN ('history', 'remotePath', 'remoteCommand', 'git')),
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

            INSERT INTO command_suggestion_provider_cache_v18 (
                provider, host_id, scope_key, repo_root, payload_json,
                cached_at_unix_ms, expires_at_unix_ms, ttl_seconds, updated_at
            )
            SELECT provider, host_id, scope_key, repo_root, payload_json,
                   cached_at_unix_ms, expires_at_unix_ms, ttl_seconds, updated_at
            FROM command_suggestion_provider_cache;

            DROP TABLE command_suggestion_provider_cache;
            ALTER TABLE command_suggestion_provider_cache_v18
                RENAME TO command_suggestion_provider_cache;

            CREATE INDEX IF NOT EXISTS idx_command_suggestion_provider_cache_expires
                ON command_suggestion_provider_cache(provider, expires_at_unix_ms);

            CREATE INDEX IF NOT EXISTS idx_command_suggestion_provider_cache_host
                ON command_suggestion_provider_cache(host_id, provider);
            ",
        )?;
    }

    tx.pragma_update(None, "user_version", 18)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v19(conn: &mut Connection) -> AppResult<()> {
    let has_remote_hosts = table_exists(conn, "remote_hosts")?;
    let tx = conn.transaction()?;

    if has_remote_hosts {
        tx.execute_batch(
            "
            ALTER TABLE remote_hosts
                ADD COLUMN ssh_options_json TEXT NOT NULL DEFAULT '{}';
            ",
        )?;
    }

    tx.pragma_update(None, "user_version", 19)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v22(conn: &mut Connection) -> AppResult<()> {
    let has_ai_tool_audits = table_exists(conn, "ai_tool_audits")?;
    let tx = conn.transaction()?;

    if has_ai_tool_audits {
        tx.execute_batch(
            "
            ALTER TABLE ai_tool_audits
                ADD COLUMN audit_context_json TEXT;
            ",
        )?;
    }

    tx.pragma_update(None, "user_version", 22)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v26(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS local_file_operation_audits (
            id                   TEXT PRIMARY KEY NOT NULL,
            operation            TEXT NOT NULL CHECK (operation IN ('delete')),
            path                 TEXT NOT NULL,
            kind                 TEXT NOT NULL CHECK (kind IN ('file', 'directory')),
            root_path            TEXT,
            parent_path          TEXT,
            recursive            INTEGER NOT NULL DEFAULT 0 CHECK (recursive IN (0, 1)),
            confirmation_matched INTEGER NOT NULL DEFAULT 1 CHECK (confirmation_matched IN (0, 1)),
            status               TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
            error                TEXT,
            created_at_unix_ms   INTEGER NOT NULL,
            created_at           TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_local_file_operation_audits_created
            ON local_file_operation_audits(created_at_unix_ms DESC);

        CREATE INDEX IF NOT EXISTS idx_local_file_operation_audits_operation_status
            ON local_file_operation_audits(operation, status, created_at_unix_ms DESC);
        ",
    )?;

    tx.pragma_update(None, "user_version", 26)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v28(conn: &mut Connection) -> AppResult<()> {
    let has_ai_tool_audits = table_exists(conn, "ai_tool_audits")?;
    let tx = conn.transaction()?;

    if has_ai_tool_audits {
        tx.execute_batch(
            "
            ALTER TABLE ai_tool_audits
                ADD COLUMN observation_json TEXT;
            ",
        )?;
    }

    tx.pragma_update(None, "user_version", 28)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v29(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;

    tx.execute_batch(PORT_FORWARD_SESSIONS_SCHEMA)?;

    tx.pragma_update(None, "user_version", 29)?;
    tx.commit()?;

    Ok(())
}

fn migrate_to_v30(conn: &mut Connection) -> AppResult<()> {
    let has_remote_hosts = table_exists(conn, "remote_hosts")?;
    let tx = conn.transaction()?;

    if has_remote_hosts {
        tx.execute_batch(
            "
            ALTER TABLE remote_hosts
                ADD COLUMN credential_secret TEXT;
            ",
        )?;
    }

    tx.pragma_update(None, "user_version", 30)?;
    tx.commit()?;

    Ok(())
}

fn ensure_port_forward_sessions_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(PORT_FORWARD_SESSIONS_SCHEMA)?;
    Ok(())
}

const PORT_FORWARD_SESSIONS_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS port_forward_sessions (
    id              TEXT PRIMARY KEY NOT NULL,
    host_id         TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('running', 'exited')),
    summary_json    TEXT NOT NULL,
    created_at_unix TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(host_id) REFERENCES remote_hosts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_port_forward_sessions_host
    ON port_forward_sessions(host_id, status, CAST(created_at_unix AS INTEGER));

CREATE INDEX IF NOT EXISTS idx_port_forward_sessions_created
    ON port_forward_sessions(CAST(created_at_unix AS INTEGER));
";
