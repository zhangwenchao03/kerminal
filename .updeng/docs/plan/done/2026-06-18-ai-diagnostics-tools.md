---
id: PLAN-20260618-000008-ai-diagnostics-tools
status: done
created_at: 2026-06-18T00:00:08+08:00
started_at: 2026-06-18T00:00:08+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 受控诊断工具

## 目标
- 新增 `diagnostics.runtime_health` 工具，让 AI 可读取当前应用运行体检摘要，用于判断 CPU、内存、磁盘和数据目录状态。
- 新增 `diagnostics.create_bundle` 工具，让 AI 可在用户批准后生成本地脱敏诊断包，用于后续排查和交付问题证据。
- 复用现有 `DiagnosticsService`、Tool Registry、rmcp Gateway 和 AI Tool Invocation Gateway，不绕过确认、审计和脱敏边界。

## 非目标
- 本次不上传诊断包、不打开外部分享或提交 issue。
- 本次不读取诊断包原始 JSON 内容给 LLM，只返回摘要、路径和脱敏标记。
- 本次不新增诊断包清理、压缩或历史列表。

## 影响范围
- Rust 工具目录与 AI 执行器：`src-tauri/src/services/tool_registry_service.rs`、`src-tauri/src/services/ai_tool_invocation_service.rs`
- Rust 状态依赖：`src-tauri/src/state.rs`
- 前端 AI 面板与浏览器预览：`src/features/tool-panel/AiToolContent.tsx`、`src/lib/aiToolInvocationApi.ts`、`src/lib/toolRegistryApi.ts`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src-tauri/tests/tool_registry_service.rs`、`src/features/tool-panel/AiToolContent.test.tsx`、`src/lib/aiToolInvocationApi.test.ts`、`src/lib/toolRegistryApi.test.ts`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 登记 `diagnostics.runtime_health` 和 `diagnostics.create_bundle` 工具 schema、风险和确认策略。
- [x] 扩展 AI 执行器，复用 `DiagnosticsService` 生成运行体检摘要和诊断包摘要。
- [x] 在前端 AI 面板提供中文演示入口，并在浏览器预览中模拟两类诊断工具结果。
- [x] 同步浏览器预览 Tool Registry/MCP tools。
- [x] 补充 Rust、前端 API 和组件测试。
- [x] 运行窄测试、`npm run check` 和 `http://127.0.0.1:1425/` 浏览器 smoke。

## 验证
- `cd src-tauri && cargo test --test ai_tool_invocation_service diagnostics_`
- `cd src-tauri && cargo test --test tool_registry_service diagnostics_`
- `npm run test:frontend -- AiToolContent aiToolInvocationApi toolRegistryApi aiAgentApi`
- `npm run check`
- 浏览器 smoke：`http://127.0.0.1:1425/`，确认中文 AI 面板可准备诊断工具、运行体检为自动/只读或生成诊断包需确认，审计摘要正常，控制台无 error。

## 验证结果
- 2026-06-18：`cargo test --test ai_tool_invocation_service diagnostics_` 通过，2 个诊断工具执行器用例全部通过。
- 2026-06-18：`cargo test --test tool_registry_service diagnostics_` 通过，诊断工具注册策略用例通过。
- 2026-06-18：`npm run test:frontend -- AiToolContent aiToolInvocationApi toolRegistryApi aiAgentApi` 通过，4 个测试文件 81 个用例通过。
- 2026-06-18：`npm run check` 通过，32 个前端测试文件 240 个用例、Rust fmt/clippy/全测试和 Vite build 全部通过；Vite 仍提示单个 chunk 超过 500 kB。
- 2026-06-18：浏览器 smoke 使用 `http://127.0.0.1:1425/` 通过，中文 AI 面板可准备并批准 `运行体检` 与 `诊断包`，审计出现“运行体检已读取”和“诊断包已生成”，控制台无 error，页面不含 `Next Terminal` 文案。

## 风险
- 诊断包会落本地文件，保持 `write/contextual/summary`，批准后只返回文件名、路径、大小、分区和脱敏标记。
- 运行体检是只读能力，但摘要可能包含本机资源和数据目录路径；只返回面向排查的有限摘要，不返回终端原始输出或命令历史明细。



