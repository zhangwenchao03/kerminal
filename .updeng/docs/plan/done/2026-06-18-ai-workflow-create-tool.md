---
id: PLAN-20260618-000015-ai-workflow-create-tool
status: done
created_at: 2026-06-18T00:00:15+08:00
started_at: 2026-06-18T00:00:15+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 受控创建命令工作流

## 目标
- 在 Tool Registry 中启用 `workflow.create`，让 AI 可以提出并准备“创建命令工作流”的受控工具调用。
- 在 Rust `AiToolInvocationService` 中接入 `WorkflowService::create_workflow`，复用现有 `prepare -> confirm -> audit` 边界。
- 前端 AI 面板提供中文示例入口，浏览器预览环境能展示待确认调用与确认结果。
- 计划和长期产品文档同步记录该能力，后续可按计划继续实现 AI 运行工作流。

## 非目标
- 本次不让 AI 自动运行工作流。
- 本次不接入外部 MCP Server transport。
- 本次不改变工作流 UI 的手动创建、执行和删除交互。

## 影响范围
- Rust 工具目录：`src-tauri/src/services/tool_registry_service.rs`
- Rust AI 工具执行器：`src-tauri/src/services/ai_tool_invocation_service.rs`
- Rust AI Command 上下文：`src-tauri/src/commands/ai.rs`
- 前端 AI 工具 API 预览：`src/lib/aiToolInvocationApi.ts`
- 前端 AI 面板：`src/features/tool-panel/AiToolContent.tsx`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src/features/tool-panel/AiToolContent.test.tsx`、`src/lib/aiToolInvocationApi.test.ts`
- 计划文档：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 新增 `workflow.create` 工具定义，schema 与 `WorkflowCreateRequest` 对齐。
- [x] 给 `AiToolExecutionContext` 注入 `WorkflowService`。
- [x] 实现 `workflow.create` 执行分支，创建后只保存工作流，不执行任何步骤。
- [x] 补 Rust 测试覆盖准备、批准持久化、非法步骤失败审计、拒绝不持久化。
- [x] 补前端浏览器预览标题/结果摘要和 AI 面板示例入口。
- [x] 更新长期计划和 in-progress 状态。

## 验证
- `cd src-tauri && cargo test --test ai_tool_invocation_service workflow`（通过：4 passed）
- `npm run test:frontend -- AiToolContent aiToolInvocationApi`（通过：2 files / 55 tests）
- `npm run check`（通过：前端 32 files / 222 tests，Rust fmt/clippy/test，生产构建；保留既有 Vite chunk-size warning）
- 浏览器 smoke：`http://127.0.0.1:1425/`（通过：Kerminal 标题、中文 AI 面板、MCP 本地清单、准备工作流、无 `Next Terminal`、console error 0）

## 风险
- 工作流步骤可能包含敏感命令；待确认参数摘要和审计摘要必须复用脱敏逻辑。
- `workflow.create` 是写操作，必须保留用户确认和审计，不进入自动执行。
- 浏览器预览只能模拟受控调用，真实 SQLite 持久化以 Tauri 端测试为准。



