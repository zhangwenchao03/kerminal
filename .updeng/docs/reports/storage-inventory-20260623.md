<!-- @author kongweiguang -->

# Storage Inventory 2026-06-23

## Scope

Sources:

- `src-tauri/src/storage/migrations.rs`
- `src-tauri/src/storage/migrations_ai_conversations.rs`

Current SQLite schema version is `30`. This report is inventory only. It does not migrate, export, delete, or rewrite real user data.

## Table Matrix

| Table | Current module | Current callers | Target ownership | First change |
| --- | --- | --- | --- | --- |
| `kerminal_metadata` | `storage::sqlite`, `storage::migrations` | `SqliteStore::set_metadata`, `SqliteStore::metadata_value`, startup smoke/metadata users | `JSON` / manifest state | Move file-storage schema metadata to `storage-manifest.toml`; keep command DB metadata local to `command.sqlite`. |
| `app_settings` | `storage::settings` | `SettingsService`, settings commands, diagnostics, AI context, command suggestion inline settings, SFTP runtime settings | `TOML` | P2 after FileStore: `settings.toml` with `schema_version = 1`. |
| `terminal_profiles` | `storage::profiles` | `ProfileService`, profile commands, terminal creation flows, AI profile tools | `TOML` | P2 after settings: `profiles/*.toml`; generate defaults on fresh install. |
| `remote_host_groups` | `storage::remote_hosts` | `RemoteHostService`, remote host commands, SSH/SFTP/Docker/port-forward/server-info services, MCP and AI remote tools | `TOML` | P3: `hosts/groups.toml`; no old DB compatibility. |
| `remote_hosts` | `storage::remote_hosts` | `RemoteHostService`, `commands::remote_host`, SSH terminal, SFTP, Docker/container, port forward, server info, command suggestions, MCP, AI remote/SSH tools | `TOML` + secrets scope | P3: `hosts/<id>.toml` for non-secret config, `secrets/hosts/<id>.toml` for secret material. |
| `llm_providers` | `storage::llm_providers` | `RigProviderService`, AI provider tools, `AiAgentService` provider selection | `delete` | P6 deletion lane: remove from fresh schema and old AI provider state; no file or JSONL target. |
| `ai_tool_audits` | `storage::ai_tool_audits` | `AiToolInvocationService` list/clear and in-memory audit state | `delete` | P6 deletion lane; do not mirror to JSONL. |
| `command_snippets` | `storage::snippets` | `SnippetService`, snippet commands, command/workflow UI callers | `TOML` | P4: `snippets/*.toml`. |
| `command_history` | `storage::command_history` | `CommandHistoryService`, command history commands, command suggestion service, terminal/SSH tool history, MCP server | `command.sqlite` | P5: keep in command DB; later move from generic `SqliteStore` to `CommandSqliteStore`. |
| `command_workflows` | `storage::workflows` | `WorkflowService`, workflow commands, workflow execution UI | `TOML` | P4: merge workflow metadata and steps into `workflows/<id>.toml`. |
| `command_workflow_steps` | `storage::workflows` | `WorkflowService`, workflow execution UI | `TOML` | P4: embedded `[[steps]]` in each workflow TOML file. |
| `command_suggestion_provider_cache` | `storage::command_suggestion_cache` | command suggestion providers/cache utilities and cleanup | `command.sqlite` | P5: keep TTL/cache workload in command DB. |
| `command_suggestion_feedback` | `storage::command_suggestion_feedback` | command suggestion feedback/ranking and cleanup | `command.sqlite` | P5: keep ranking feedback in command DB. |
| `command_suggestion_telemetry` | `storage::command_suggestion_telemetry` | telemetry persistence/export and cleanup | `command.sqlite` | P5: keep counters/statistics in command DB. |
| `command_suggestion_audit_events` | `storage::command_suggestion_audit` | command suggestion export and retention cleanup | `command.sqlite` | P5: keep with command suggestion domain until a later retention-only split is justified. |
| `ai_conversations` | `storage::ai_conversations` | `AiConversationService`, `commands::ai_conversation`, old panel persistence | `delete` | P6 deletion lane; no file target. |
| `ai_messages` | `storage::ai_conversations` | `AiConversationService`, old message persistence and streaming persistence | `delete` | P6 deletion lane; no file target. |
| `ai_attachments` | `storage::ai_conversations`, `paths.ai_attachments` | AI conversation attachment service, vision adapter | `delete` | P6 deletion lane; managed attachment directory cleanup is separate from this worker. |
| `ai_conversation_slots` | `storage::ai_conversations` | `AiConversationService`, old slot routing | `delete` | P6 deletion lane; no replacement slot store. |
| `ai_context_snapshots` | `storage::ai_context_snapshots` | `AiConversationService`, AI context snapshot linking | `delete` | P6 deletion lane; no JSON/JSONL mirror. |
| `ai_tool_pending_invocations` | `storage::ai_tool_pending` | `AiToolInvocationService` pending approval/resume path | `delete` | P6 deletion lane; external agents own their own approval state. |
| `local_file_operation_audits` | `storage::local_file_operations` | local file operation audit commands/service path | `JSONL` | P7: `logs/local-file-operations/YYYY-MM-DD.jsonl`; tolerate bad lines while reading. |
| `port_forward_sessions` | `storage::port_forwards` | `PortForwardService` session persistence/list/cleanup | `JSON` | P7: `state/port-forwards/sessions.json`; do not block forwarding on heavy writes. |

## Current Storage Modules

- Generic SQLite entry: `storage::sqlite::SqliteStore`.
- Config-like SQLite modules: `settings`, `profiles`, `remote_hosts`, `snippets`, `workflows`.
- Command SQLite modules: `command_history`, `command_suggestion_cache`, `command_suggestion_feedback`, `command_suggestion_telemetry`, `command_suggestion_audit`, `command_suggestion_cleanup`.
- AI SQLite modules: `llm_providers`, `ai_tool_audits`, `ai_conversations`, `ai_context_snapshots`, `ai_tool_pending`.
- Non-AI audit/runtime modules: `local_file_operations`, `port_forwards`.

## First Batch Order

1. Freeze inventory and source-of-truth docs. Output: this report.
2. Add isolated file-storage primitives: `file_store`, `storage_manifest`, `audit_log_store`. No business service wiring.
3. Add config operation skill and validator skeleton for external Codex/config-directory workflows.
4. Migrate `app_settings` and `terminal_profiles` first because they are low-volume config and have clearer fresh-install defaults.
5. Migrate `remote_host_groups` and `remote_hosts` after secrets scope is designed; keep secret material out of ordinary `config/`.
6. Migrate `command_snippets`, `command_workflows`, and `command_workflow_steps` into searchable TOML assets.
7. Split command-domain SQLite into `command.sqlite` and keep history/suggestion/cache/feedback/telemetry there.
8. Move non-AI `local_file_operation_audits` and `port_forward_sessions` to JSONL/JSON.
9. Delete AI storage tables and old AI persistence paths in a separate coordinated slice; this worker does not touch that deletion lane.

## Guardrails

- Do not edit `migrations.rs` or `migrations_ai_conversations.rs` in this slice.
- Do not claim compatibility with old SQLite data.
- Do not assign a new file target to AI tables.
- Do not place password, API key, private key, or token fields in ordinary TOML config.
- If a later bootstrap/repair slice creates external agent workspace files, default initialization is limited to Codex and Claude files: `AGENTS.md`, `CLAUDE.md`, `.codex/config.toml`, and `.mcp.json`.
- Do not initialize Custom Agent configuration by default.
- Treat Tauri resources only as template source candidates; real user-directory writes belong to program bootstrap/repair logic.
