---
id: PLAN-20260617-000015-ai-tool-invocation-gateway
status: done
created_at: 2026-06-17T00:00:15+08:00
started_at: 2026-06-17T00:00:15+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI Tool Invocation Gateway 受控基础切片

## 当前状态

- Done：AI 工具调用准备、确认、执行白名单和内存审计基础已完成。

## 目标

- 为第 16 切片建立安全执行链路：AI 只能通过 Tool Registry 提交工具调用意图，不能绕过策略直接调用 terminal/settings。
- 新增 `ai_tool_prepare`：校验工具存在、启用、schema 基本字段和风险策略，返回待确认调用摘要。
- 新增 `ai_tool_confirm`：只允许确认后执行第一批本地白名单工具，并记录审计结果。
- 新增 `ai_tool_audit_list`：前端可查看最近工具调用审计，用户能理解 AI 试图做什么、是否执行、结果如何。
- 在 AI 面板展示“待确认工具调用”和“最近审计”，先用安全示例验证链路。

## 非目标

- 不实现真实 Rig chat/completion，不让 LLM 自动决定下一步。
- 不实现 SSH/SFTP/远程/破坏性工具执行；这些进入第 17 和安全审计切片。
- 不把审计落入 SQLite；本切片先做进程内审计，SQLite audit trail 留给第 20 安全策略切片。
- 不让任何工具在没有确认记录的情况下执行。

## 影响范围

- Rust 模型：新增 AI tool invocation request、pending invocation、confirmation、audit record。
- Rust 服务：新增 `ai_tool_invocation_service`，复用 Tool Registry、TerminalManager、SettingsService 和 SQLite 设置存储。
- Rust Command：新增 `ai_tool_prepare`、`ai_tool_confirm`、`ai_tool_audit_list`。
- React API：新增 `src/lib/aiToolInvocationApi.ts`，浏览器预览提供安全示例。
- React UI：AI 面板新增受控工具调用区域，展示待确认调用、风险、参数摘要、执行结果和审计记录。
- 测试：新增 Rust service 测试、前端 API 测试和 AI 面板交互测试。

## 执行步骤

- [x] 定义 AI 工具调用模型和内存审计结构。
- [x] 实现 prepare/confirm/audit 服务，第一批执行白名单为 `settings.update_theme`、`terminal.resize`、`terminal.write`。
- [x] 注册 Tauri Commands 并补 Rust 测试，覆盖未知工具、禁用工具、未确认拒绝、确认后执行和审计记录。
- [x] 新增前端 API 和 AI 面板受控工具调用 UI，补 API/组件测试。
- [x] 运行 `npm run check`，再做 1425 浏览器 smoke。

## 验证

- `cd src-tauri; cargo test --test ai_tool_invocation_service`：8 passed。
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx`：2 files / 9 tests passed。
- `npm run check`：23 frontend test files / 101 tests passed；Rust fmt、clippy、cargo test passed；Vite build passed。
- 浏览器 smoke：`http://127.0.0.1:1425/` 通过；AI 面板显示“受控工具调用”，准备示例后拒绝可生成“用户已拒绝执行。”审计；console error 为 0；未出现 `Next Terminal`。

## 风险

- AI 工具执行会修改本地状态或写入终端；本切片默认所有可执行工具都需要 pending id 和用户确认，且只开放本地低边界白名单。
- `terminal.write` 可能执行用户命令；后续需要危险命令检测和更细确认。本切片仅提供确认链路和参数摘要，不让模型自动执行。
- 内存审计在应用重启后丢失；后续安全策略切片必须迁移到 SQLite 审计表。


