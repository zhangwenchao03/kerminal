<!-- @author kongweiguang -->

# AI Removal Inventory 2026-06-23

## Scope

This inventory supports `lane-ai-sidebar-external-agent-launcher`.

Sources:

- `src/features/tool-panel/**`
- `src/features/settings/**`
- `src/lib/*Api.ts`
- `src-tauri/src/commands/**`
- `src-tauri/src/services/**`
- `src-tauri/src/models/**`
- `src-tauri/src/storage/**`
- `src-tauri/tests/**`

The target product boundary is: keep Kerminal as a local workbench and MCP server, remove the built-in AI runtime, and launch mature external CLIs inside the right panel.

## Delete

Frontend:

- `src/features/tool-panel/AiToolContent.tsx` and `src/features/tool-panel/ai-tool-content/**` after Agent Launcher is fully wired and old performance-lane edits are no longer needed.
- `src/features/settings/settings-tool-content/ai-section.tsx`.
- `src/features/settings/LlmProviderSettingsSection.tsx`.
- `src/features/settings/llmProviderModel.ts`.
- `src/lib/llmProviderApi.ts`.
- `src/features/settings/settings-tool-content/mcp-custom.tsx`.
- Old AI/custom MCP tests that only cover provider settings, custom MCP servers, custom skills, AI chat persistence, pending approval, or built-in AI audit.

Rust commands and services:

- `src-tauri/src/commands/ai.rs`.
- `src-tauri/src/commands/ai_conversation.rs`.
- `src-tauri/src/commands/llm_provider.rs`.
- AI command registrations in `src-tauri/src/commands/registry.rs`.
- `src-tauri/src/services/ai_agent_service.rs`.
- `src-tauri/src/services/ai_agent_run_service.rs`.
- `src-tauri/src/services/ai_conversation_service.rs`.
- `src-tauri/src/services/ai_context_service.rs`.
- `src-tauri/src/services/rig_provider_service.rs`.
- Built-in custom MCP client/discovery paths if they only exist to let Kerminal call user-defined MCP servers.

Rust models and storage:

- `src-tauri/src/models/ai_agent*.rs`.
- `src-tauri/src/models/ai_conversation.rs`.
- `src-tauri/src/models/ai_context.rs`.
- `src-tauri/src/models/llm_provider.rs`.
- `src-tauri/src/storage/llm_providers.rs`.
- `src-tauri/src/storage/ai_tool_audits.rs`.
- `src-tauri/src/storage/ai_conversations.rs`.
- `src-tauri/src/storage/ai_context_snapshots.rs`.
- `src-tauri/src/storage/ai_tool_pending.rs`.
- Fresh schema creation for `llm_providers`, `ai_tool_audits`, `ai_conversations`, `ai_messages`, `ai_attachments`, `ai_conversation_slots`, `ai_context_snapshots`, and `ai_tool_pending_invocations`.

## Replace

- `ToolPanel` `ai` content is replaced by `AgentLauncherToolContent`, not by another chat UI.
- `settings.ai` should be deleted from TypeScript and Rust settings models. If MCP tool execution still needs policy, introduce a neutral `ToolExecutionSettings`, not an AI settings subtree.
- `AiToolInvocationService` contains real tool execution dispatch for terminal, SSH, SFTP, diagnostics, settings, snippets, workflows, and host operations. Extract or rename the reusable dispatch into a neutral MCP/tool execution service before deleting AI-specific audit, pending, and approval storage.
- MCP resources such as `kerminal://ai/audit-summary`, `kerminal://settings/ai-policy`, and `kerminal://settings/custom-mcp` should be removed or replaced with neutral Kerminal MCP server resources.
- Tool registry categories and catalog entries named `LlmProvider` or `settings.update_ai_security` should be removed; any remaining tool should be named by the actual capability.
- README and settings copy should shift from built-in Agent Run/provider setup to Kerminal MCP Server plus external Codex/Claude/custom CLI launch.

## Keep For MCP

- `src-tauri/src/services/mcp_streamable_http_server.rs`.
- `src-tauri/src/services/mcp_tool_gateway.rs`, after removing AI policy/custom MCP resource coupling.
- Tool registry and execution modules for real Kerminal capabilities: terminal, SSH, SFTP, server info, port forwarding, diagnostics, snippets, workflows, profiles, remote hosts, and settings that remain product-owned.
- `src-tauri/src/commands/tool_registry.rs` MCP HTTP start/status/stop and list/read/render operations that expose Kerminal's own MCP server.
- `src-tauri/src/services/external_agent_workspace.rs` and `src-tauri/src/commands/external_agent_workspace.rs`.
- New right-panel `AgentLauncherToolContent` and `agentLauncherModel` as the replacement UI.

## Defer / Confirm Later

- `TerminalInlineSuggestionProviderSettings.ai`: decide whether terminal inline AI suggestions are deleted with the built-in AI runtime or kept as a historical provider enum until settings cleanup.
- Historical `ai` enum values in command history, suggestions, audit sources, or `PortForwardOrigin::AiTool`: rename only when a neutral execution/audit path is ready, to avoid breaking old parsed records mid-slice.
- Old AI conversation attachment directories: remove only when P5/P6 deletion owns user data cleanup wording.
- Existing active plan `2026-06-21-ai-assistant-terminal-context.md`: superseded and deleted during the 2026-06-24 Updeng docs cleanup after ADR-0017 became the active product direction.

## Current Implemented Slice

- Right sidebar `ai` content now lazy-loads `AgentLauncherToolContent`.
- The default launcher screen is three icon entries only: Codex, Claude, and `自定义`.
- Codex/Claude prepare `AGENTS.md`, `CLAUDE.md`, `.codex/config.toml`, and `.mcp.json` under the Kerminal workspace root.
- Default bootstrap initializes only Codex and Claude files.
- Custom Agent accepts an explicit command and does not generate default custom config files.
- Clicking an entry swaps the right panel into an embedded local-terminal view via `XtermPane`; browser preview shows the non-Tauri placeholder, while the Tauri app uses the real local PTY path.

## Verification Recorded In This Slice

- `npm run test:frontend -- src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace`
- `npm run typecheck`
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- `npm run build`
- Dev server `http://127.0.0.1:5184/` screenshot smoke:
  - `.updeng/docs/verification/agent-launcher-right-panel-light.png`
  - `.updeng/docs/verification/agent-launcher-right-panel-dark.png`
  - `.updeng/docs/verification/agent-launcher-right-panel-system-dark.png`
  - `.updeng/docs/verification/agent-launcher-custom-terminal-smoke.png`

## Remaining High-Risk Deletion Order

1. Settings UI cleanup: delete AI provider/security/custom MCP/custom skills visible settings.
2. MCP server decoupling: remove `settings.ai.mcp` from manifest/resources/tool list generation.
3. Neutral tool execution extraction from AI invocation service.
4. Rust/TS settings model `ai` field deletion.
5. LLM provider command/service/storage deletion.
6. AI conversation/context/pending/audit command/service/storage deletion.
7. Fresh schema cleanup and old AI table removal policy.
