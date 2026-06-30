---
id: PLAN-20260618-000022-mcp-resource-read
status: done
created_at: 2026-06-18T00:00:22+08:00
started_at: 2026-06-18T00:00:22+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# MCP 本地资源读取原型

## 目标

- 在现有 MCP manifest 基础上，新增本地只读资源读取能力，让前端和后续 rmcp transport 能通过同一份 URI 读取 Kerminal 内部资源。
- 支持读取 `kerminal://tool-registry`、`kerminal://terminal-context/current`、`kerminal://ai/audit-summary` 和 `kerminal://settings/ai-policy`。
- 在右侧 AI 面板提供中文资源预览，让用户能看到 MCP resources 实际会暴露哪些脱敏信息。
- 补 Rust 和前端独立测试，并继续由 `npm run check` 作为一键质量门禁。

## 非目标

- 本次不启动外部 MCP stdio/http Server，不新增监听端口。
- 本次不实现外部 MCP Client 导入或第三方 server 调用。
- 本次不让 AI 自动读取任意文件、环境变量或完整终端输出。
- 本次不扩展工具执行能力，只做 resources 的只读预览和本地 command。

## 影响范围

- Rust 模型：`src-tauri/src/models/tool_registry.rs`。
- Rust 服务：`src-tauri/src/services/mcp_tool_gateway.rs`。
- Rust Command：`src-tauri/src/commands/tool_registry.rs`、`src-tauri/src/lib.rs`。
- Rust 测试：`src-tauri/tests/tool_registry_service.rs`。
- 前端模型/API：`src/features/tool-panel/toolRegistryModel.ts`、`src/lib/toolRegistryApi.ts`。
- 前端 UI/测试：`src/features/tool-panel/AiToolContent.tsx`、`src/lib/toolRegistryApi.test.ts`、`src/features/tool-panel/AiToolContent.test.tsx`。
- 文档：本计划、`.updeng/docs/in-progress.md`、总产品计划 slice 23。

## 执行步骤

- [x] 设计 `McpResourceReadRequest` / `McpResourceReadResult` 数据结构，保持 URI 白名单和 JSON 内容边界。
- [x] 在 `McpToolGateway` 中实现 resource read 纯服务方法，复用现有 tool list、AI policy、audit 和 terminal context 的摘要数据。
- [x] 新增 `tool_registry_mcp_resource_read` Tauri Command 并注册。
- [x] 前端 `toolRegistryApi` 新增 resource read API 和浏览器预览数据。
- [x] AI 面板在 MCP 本地清单卡片中提供资源选择、加载、错误和 JSON 预览状态。
- [x] 增加 Rust 和前端测试。
- [x] 运行窄测试、`npm run check` 和 `http://127.0.0.1:1425/` 浏览器 smoke。
- [x] 更新总计划和本计划状态。

## 验证

- `cd src-tauri && cargo test --test tool_registry_service`：6 个测试通过，覆盖 manifest、allowlisted resource 读取、无活动终端空状态、AI policy resource 和未知 URI 拒绝。
- `npm run test:frontend -- toolRegistryApi AiToolContent`：2 个测试文件 / 33 个测试通过，覆盖 Tauri command 参数、浏览器预览 fallback 和 AI 面板资源预览交互。
- `npm run check`：前端 32 个测试文件 / 216 个测试通过，Rust fmt、clippy、全量测试和生产构建通过；Vite 仍只有既有 chunk size warning。
- 浏览器打开 `http://127.0.0.1:1425/`：AI 面板显示“MCP 本地清单”和“可读取资源”，资源按钮包含工具目录、当前终端上下文、AI 工具审计摘要和 AI 安全策略；点击 AI 安全策略后显示 `kerminal-mcp/resource/ai-policy` 与 `requireRemoteApproval`，页面无 `Next Terminal` 文案且控制台 error 为 0。

## 结果

- `tool_registry_mcp_resource_read` 已提供本地 MCP resource 读取入口，当前只允许 manifest 中声明的四个 `kerminal://` URI。
- `kerminal://tool-registry` 返回 MCP tools 摘要，`kerminal://terminal-context/current` 返回当前终端脱敏上下文或可解释空状态，`kerminal://ai/audit-summary` 返回最近脱敏审计摘要，`kerminal://settings/ai-policy` 返回 AI 安全策略摘要。
- 右侧 AI 面板的“MCP 本地清单”卡片现在可直接查看资源 JSON，浏览器预览模式也提供同结构 fallback。
- 本次仍未启动外部 MCP Server/Client，也未开放任何外部执行面；后续真实 transport 必须继续复用同一 URI 白名单、脱敏和确认/审计边界。

## 风险

- 资源内容可能泄露过多上下文；本切片默认只输出脱敏摘要和受限字段，不输出完整终端缓冲区或凭据。
- `terminal-context/current` 需要前端传入当前 pane/session 上下文；如果没有活动终端，应返回可解释的空状态。
- 后续外部 MCP transport 开启前必须复用同一套白名单和脱敏逻辑，不能另起一套绕过安全策略。


