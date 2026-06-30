---
id: PLAN-20260624-230807-macos-agent-workspace-paths
status: done
created_at: 2026-06-24T23:08:07+08:00
started_at: 2026-06-24T23:08:07+08:00
completed_at: 2026-06-24T23:24:26+08:00
updated_at: 2026-06-25T00:18:00+08:00
owner: ai
---

# macOS 外部 Agent 工作目录说明补强

## 目标

- 让生成给外部 AI 的 `~/.kerminal/AGENTS.md`、`CLAUDE.md` 和 `Kerminal-config.md` 同时适合 Windows、macOS 和 Linux 用户。
- 避免把 Windows-only shell、路径或命令写成唯一推荐。
- 保持默认配置根统一为 `~/.kerminal`。

## 非目标

- 不改 MCP tool catalog 或 runtime executor。
- 不改真实 workspace/env 中传递给程序的绝对路径，只调整给 AI 阅读的说明和示例。
- 不引入平台专属配置 CRUD 工具。

## 影响范围

- `src-tauri/src/services/external_agent_workspace.rs`
- `src-tauri/src/paths.rs`
- `src-tauri/src/services/ssh_identity_file.rs`
- SSH/SFTP identity path 使用点：`ssh_command_service.rs`、`ssh_terminal_service.rs`、`ssh_command_plan.rs`、`ssh_route_plan.rs`、`sftp_service/backend.rs`、`sftp_service/native_ssh.rs`
- `.updeng/docs/config/kerminal-config-files.md`
- `.updeng/docs/config/external-agent-workspace.md`

## 执行步骤

- [x] 补充 macOS/Linux shell 示例与 Windows shell 示例的等价口径。
- [x] 补充 `~/.kerminal` 和 `~/.ssh` 在 Windows/macOS/Linux 上由 shell/agent 解析，不写成某台机器固定目录。
- [x] 验证生成模板、配置文档和单测。

## 验证

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace -j 1`
- `cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation home_relative -j 1`
- `cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation home_notation -j 1`
- `cargo test --manifest-path src-tauri/Cargo.toml --test ssh_command_service build_plan_expands_home_relative_identity_file -j 1`
- `cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service resolve_terminal_request_expands_home_relative_identity_file -j 1`
- `cargo test --manifest-path src-tauri/Cargo.toml --test ssh_route_plan expands_home_relative_key_paths_in_route_plan -j 1`
- 固定路径扫描：面向生成内容和 docs 的 Windows/macOS/Linux 绝对 home 路径不能残留为推荐示例。

## 风险

- `src-tauri/src/services/external_agent_workspace.rs` 是 `lane-agent-session-file-restore` shared path；本轮只改说明文本、示例和相邻断言。

## Round Log

- 2026-06-24T23:08:07+08:00：用户补充还要考虑 macOS 用户。回读并行状态后登记本计划；当前范围限定为跨平台说明和示例路径，不改运行态执行链路。
- 2026-06-24T23:24:26+08:00：收口完成。生成的 `Kerminal-config.md`、外部配置文档和 workspace 方案已明确 `~/.kerminal` 是 Windows/macOS/Linux 当前用户 home 语义，并同时给出 macOS/Linux `zsh` 与 Windows `pwsh` profile 示例。实现层新增 `ssh_identity_file` helper，统一展开 `~`、`~/...`、`~\...` 到当前用户 home，并拒绝 SSH 私钥路径控制字符；SSH command、SSH terminal、SSH route plan、SFTP target/jump 均切到该 helper，避免文档写 `~/.ssh/id_ed25519` 但运行态不识别。验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace -j 1`、storage/SSH command/SSH terminal/SSH route plan 的新增定向测试、旧私钥路径写法扫描和 `git diff --check`。
- 2026-06-24T23:55:00+08:00：按用户要求复查真实当前用户工作目录并补齐 macOS/分发口径。修正生成的 `AGENTS.md` validator 文案，不再把本机 repo 或用户 home 绝对路径写成外部 agent 规则，只保留 `~/.kerminal` 和源码 checkout 下的相对 validator 示例；新增断言防止 `AGENTS.md` 生成 `C:/Users`、`C:\Users`、`C:/dev`、`C:\dev`。通过一次性 Rust integration test 调用生产 `ExternalAgentWorkspaceService::ensure_default_agent_files()` 实际修复当前 `~/.kerminal`，随后删除临时测试文件。真实 `~/.kerminal` 已生成 `Kerminal-config.md`，`AGENTS.md` / `CLAUDE.md` / `Kerminal-config.md` 中未发现当前机器用户名或 repo 绝对路径；`node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --root "$HOME/.kerminal" --json` 检查 10 个真实配置文件且 findings 为空。CRUD 验证通过：`settings_service`、`profile_service`、`remote_host_service`、`snippet_service`、`workflow_service`、`config_file_store` 定向测试全绿；MCP tools-only 验证通过：`mcp_streamable_http_server::generated_codex_and_claude_configs_connect_to_tools_list` 通过真实 Streamable HTTP client 调用 `tools/list`，确认保留 `terminal.write`、`ssh.command`、`history.search`、`diagnostics.runtime_health` 并排除 `settings.get`、`profile.list`、`snippet.create`、`workflow.run`、`workspace.focus_tab`、`history.clear`。
- 2026-06-25T00:18:00+08:00：补齐完成审计要求的强证据。新增后删除一次性 `current_workspace_config_crud_smoke` integration test，使用生产 `SettingsService`、`ProfileService`、`RemoteHostService`、`SnippetService`、`WorkflowService` 和当前用户 `KerminalPaths::from_current_home()` 在真实 `~/.kerminal` 执行 settings update/restore、profile create/update/delete、host group create/update/delete、host create/update/delete、snippet create/update/delete、workflow create/update/delete；测试通过后 `rg "kerminal-crud-smoke-" "$HOME/.kerminal/..."` 无命中，validator 再次返回 findings 为空。新增后删除一次性 `current_mcp_tool_call_smoke` integration test，启动真实 Streamable HTTP MCP Server，通过 rmcp client 调用 `tools/list` 并执行安全只读 `diagnostics.runtime_health` `tools/call`，返回 `is_error = false` 和 structured content。临时测试文件均已删除，未作为仓库改动保留。
