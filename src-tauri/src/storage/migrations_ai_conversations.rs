//! AI conversation SQLite migrations.
//!
//! @author kongweiguang

use rusqlite::Connection;

use crate::error::AppResult;

pub(super) fn migrate_to_v20(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ai_conversations (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            scope_kind TEXT NOT NULL,
            scope_ref_json TEXT NOT NULL DEFAULT '{}',
            target_key TEXT,
            host_id TEXT,
            tab_id TEXT,
            pane_id TEXT,
            provider_id TEXT,
            model TEXT,
            status TEXT NOT NULL DEFAULT 'idle',
            summary TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_message_at INTEGER,
            archived_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_target_updated ON ai_conversations(target_key, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_host_updated ON ai_conversations(host_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_status_updated ON ai_conversations(status, updated_at DESC);
        CREATE TABLE IF NOT EXISTS ai_messages (
            id TEXT PRIMARY KEY NOT NULL,
            conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
            content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('draft', 'streaming', 'complete', 'error')),
            provider_id TEXT,
            model TEXT,
            token_estimate INTEGER CHECK (token_estimate IS NULL OR token_estimate >= 0),
            context_snapshot_id TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created ON ai_messages(conversation_id, created_at ASC);
        CREATE TABLE IF NOT EXISTS ai_attachments (
            id TEXT PRIMARY KEY NOT NULL,
            conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
            message_id TEXT REFERENCES ai_messages(id) ON DELETE SET NULL,
            kind TEXT NOT NULL CHECK (kind IN ('image', 'file', 'diagnostic')),
            storage_mode TEXT NOT NULL CHECK (storage_mode IN ('managedCopy', 'linkedFile')),
            source_kind TEXT NOT NULL DEFAULT 'picker' CHECK (source_kind IN ('drag', 'paste', 'picker', 'screenshot', 'terminalSelection', 'toolOutput')),
            mime_type TEXT NOT NULL,
            original_name TEXT NOT NULL,
            original_path TEXT,
            asset_path TEXT,
            thumbnail_path TEXT,
            sha256 TEXT,
            width INTEGER,
            height INTEGER,
            size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
            ocr_text TEXT,
            status TEXT NOT NULL CHECK (status IN ('available', 'missing', 'redacted', 'unsupported')),
            missing_reason TEXT CHECK (missing_reason IS NULL OR missing_reason IN ('deleted', 'moved', 'permissionDenied', 'outsideScope', 'unknown')),
            vision_usage TEXT CHECK (vision_usage IS NULL OR vision_usage IN ('visionInput', 'ocrOnly', 'metadataOnly', 'blocked', 'notSent')),
            redaction_summary TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            CHECK ((storage_mode = 'managedCopy' AND asset_path IS NOT NULL) OR (storage_mode = 'linkedFile' AND original_path IS NOT NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_ai_attachments_conversation ON ai_attachments(conversation_id, created_at ASC);
        CREATE INDEX IF NOT EXISTS idx_ai_attachments_message ON ai_attachments(message_id);
        CREATE TABLE IF NOT EXISTS ai_conversation_slots (
            slot_key TEXT PRIMARY KEY NOT NULL,
            route_mode TEXT NOT NULL,
            target_ref_json TEXT NOT NULL,
            active_conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE SET NULL,
            draft_text TEXT,
            last_active_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        ",
    )?;
    tx.pragma_update(None, "user_version", 20)?;
    tx.commit()?;
    Ok(())
}

pub(super) fn migrate_to_v21(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ai_context_snapshots (
            id TEXT PRIMARY KEY NOT NULL,
            conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
            message_id TEXT REFERENCES ai_messages(id) ON DELETE SET NULL,
            generated_at INTEGER NOT NULL,
            scope_kind TEXT NOT NULL,
            scope_ref_json TEXT NOT NULL DEFAULT '{}',
            route_mode TEXT,
            target_ref_json TEXT,
            terminal_context_json TEXT,
            application_context_json TEXT,
            attachment_refs_json TEXT NOT NULL DEFAULT '[]',
            policy_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_context_snapshots_conversation_created
            ON ai_context_snapshots(conversation_id, created_at ASC);
        CREATE INDEX IF NOT EXISTS idx_ai_context_snapshots_message
            ON ai_context_snapshots(message_id);
        ",
    )?;
    tx.pragma_update(None, "user_version", 21)?;
    tx.commit()?;
    Ok(())
}

pub(super) fn migrate_to_v23(conn: &mut Connection) -> AppResult<()> {
    let has_ai_messages = table_exists(conn, "ai_messages")?;
    let has_metadata_json = has_ai_messages && column_exists(conn, "ai_messages", "metadata_json")?;
    let tx = conn.transaction()?;

    if has_ai_messages && !has_metadata_json {
        tx.execute_batch(
            "
            ALTER TABLE ai_messages
                ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
            ",
        )?;
    }

    tx.pragma_update(None, "user_version", 23)?;
    tx.commit()?;
    Ok(())
}

pub(super) fn migrate_to_v24(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ai_tool_pending_invocations (
            id TEXT PRIMARY KEY NOT NULL,
            tool_id TEXT NOT NULL,
            tool_title TEXT NOT NULL,
            risk TEXT NOT NULL CHECK (risk IN ('read', 'write', 'remote', 'batch', 'destructive')),
            confirmation TEXT NOT NULL CHECK (confirmation IN ('auto', 'contextual', 'always')),
            audit TEXT NOT NULL CHECK (audit IN ('summary', 'full')),
            arguments_summary TEXT NOT NULL,
            risk_summary TEXT,
            client_action_json TEXT,
            reason TEXT,
            requested_by TEXT,
            requires_confirmation INTEGER NOT NULL CHECK (requires_confirmation IN (0, 1)),
            status TEXT NOT NULL CHECK (status = 'pending'),
            created_at TEXT NOT NULL,
            arguments_json TEXT NOT NULL,
            conversation_id TEXT,
            conversation_slot_json TEXT,
            run_id TEXT,
            step_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ai_tool_pending_created
            ON ai_tool_pending_invocations(CAST(created_at AS INTEGER) DESC);
        ",
    )?;
    tx.pragma_update(None, "user_version", 24)?;
    tx.commit()?;
    Ok(())
}

pub(super) fn migrate_to_v25(conn: &mut Connection) -> AppResult<()> {
    let has_pending = table_exists(conn, "ai_tool_pending_invocations")?;
    let has_conversation_id =
        has_pending && column_exists(conn, "ai_tool_pending_invocations", "conversation_id")?;
    let has_conversation_slot_json = has_pending
        && column_exists(
            conn,
            "ai_tool_pending_invocations",
            "conversation_slot_json",
        )?;
    let tx = conn.transaction()?;

    if has_pending && !has_conversation_id {
        tx.execute_batch(
            "
            ALTER TABLE ai_tool_pending_invocations
                ADD COLUMN conversation_id TEXT;
            ",
        )?;
    }
    if has_pending && !has_conversation_slot_json {
        tx.execute_batch(
            "
            ALTER TABLE ai_tool_pending_invocations
                ADD COLUMN conversation_slot_json TEXT;
            ",
        )?;
    }

    tx.pragma_update(None, "user_version", 25)?;
    tx.commit()?;
    Ok(())
}

pub(super) fn migrate_to_v27(conn: &mut Connection) -> AppResult<()> {
    let has_pending = table_exists(conn, "ai_tool_pending_invocations")?;
    let has_run_id = has_pending && column_exists(conn, "ai_tool_pending_invocations", "run_id")?;
    let has_step_id = has_pending && column_exists(conn, "ai_tool_pending_invocations", "step_id")?;
    let tx = conn.transaction()?;

    if has_pending && !has_run_id {
        tx.execute_batch(
            "
            ALTER TABLE ai_tool_pending_invocations
                ADD COLUMN run_id TEXT;
            ",
        )?;
    }
    if has_pending && !has_step_id {
        tx.execute_batch(
            "
            ALTER TABLE ai_tool_pending_invocations
                ADD COLUMN step_id TEXT;
            ",
        )?;
    }

    tx.pragma_update(None, "user_version", 27)?;
    tx.commit()?;
    Ok(())
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

fn column_exists(conn: &Connection, table_name: &str, column_name: &str) -> AppResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column_name {
            return Ok(true);
        }
    }
    Ok(false)
}
