---
id: PLAN-20260619-000006-streamable-http-mcp-server
status: done
created_at: 2026-06-19T00:00:06+08:00
started_at: 2026-06-19T00:00:06+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Streamable HTTP MCP Server

## 目标

把 Kerminal 的 MCP 暴露面从应用内 manifest/prototype 推进到标准 Streamable HTTP MCP server，使外部 agent 能按标准 MCP 协议连接并使用 Kerminal 的工具、resources、prompts 和 skills。

## 范围

- 新增本地 Streamable HTTP MCP Server 生命周期服务。
- 新增 Tauri Commands：
  - `tool_registry_mcp_http_start`
  - `tool_registry_mcp_http_stop`
  - `tool_registry_mcp_http_status`
- MCP handler 覆盖：
  - `initialize`
  - `tools/list`
  - `tools/call`
  - `resources/list`
  - `resources/templates/list`
  - `resources/read`
  - `prompts/list`
  - `prompts/get`
- 只绑定 loopback，默认系统分配端口。
- 外部 tool confirmation 交给 MCP host hooks/permission 系统；Kerminal 不暴露私有 pending/confirm 协议。
- Kerminal 仍执行工具白名单、参数校验、本地安全设置和审计。

## 非目标

- 不开放公网监听。
- 不实现自定义 HTTP JSON-RPC transport。
- 不实现 Kerminal 专属外部 approval protocol。
- 不把纯前端客户端动作工具暴露给外部 MCP client。

## 实现记录

- `src-tauri/src/services/mcp_streamable_http_server.rs`
  - rmcp `StreamableHttpService` + axum `/mcp` endpoint。
  - 基于 AppHandle 在请求时访问同一个 `AppState`。
  - 过滤 `terminal.create`、`workspace.*`、`ssh.connect` 等客户端动作工具。
  - 暴露 `kerminal://agent/skills/{skillId}` resource template，供外部 MCP client 按 id 渐进读取自定义 skill。
- `src-tauri/src/services/mcp_tool_gateway.rs`
  - 公开 `tool_definition_to_rmcp_tool`。
  - manifest transport 更新为 `streamable-http`。
  - security policy 改为 host hooks 负责确认、Kerminal 负责 allowlist/audit。
  - tool annotations 改为按工具真实风险设置幂等提示：只读工具才标 `idempotentHint=true`。
  - `kerminal://agent/skills/{skillId}` 返回标准 `SKILL.md` 正文、目录路径和 scripts/references/assets 摘要。
- `src-tauri/src/commands/tool_registry.rs`
  - 增加 HTTP MCP server 启停状态命令。
- `src-tauri/Cargo.toml`
  - 启用 rmcp `transport-streamable-http-server` feature。
  - 增加 `axum` 和 `tokio-util`。

## 验证

- `cargo fmt --check`
- `cargo check --tests`
- `cargo test --lib`
- `cargo test --test tool_registry_service`
- `cargo test --test skills_repository`
- `cargo test --test mcp_tool_gateway`
- `cargo test --lib mcp_streamable_http_server`
- `cargo test --test ai_agent_service --test command_suggestion_service --test mcp_tool_gateway`
- `cargo test --test ai_tool_invocation_service --test skills_repository --test mcp_tool_gateway`

2026-06-19 复验说明：当前本地正在运行 `target/debug/kerminal.exe`，完整 `cargo test --tests` 会尝试覆盖该 app 二进制并在 Windows 上触发 `os error 5`；因此本轮使用不覆盖 app 二进制的 lib 测试和相关集成测试组合验证变更面。

## 剩余风险

- 尚未新增前端按钮展示 endpoint。
- 尚未把 stdio transport 复用到同一 handler。
- 外部 host 必须配置自身 hooks/permission/audit；Kerminal 不替 host 弹确认 UI。
- Skill 详情资源只返回 `SKILL.md` 正文和目录存在性摘要；`scripts/`、`references/`、`assets/` 的进一步读取需要后续受控文件读取能力。


