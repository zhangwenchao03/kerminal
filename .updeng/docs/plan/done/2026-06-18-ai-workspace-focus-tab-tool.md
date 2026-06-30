---
id: PLAN-20260618-000016-ai-workspace-focus-tab-tool
status: done
created_at: 2026-06-18T00:00:16+08:00
started_at: 2026-06-18T00:00:16+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 受控切换终端 Tab

## 目标
- 新增 `workspace.focus_tab` 工具，让 AI 可在用户批准后把工作区焦点切换到指定终端 tab。
- 复用现有 AI Tool Invocation Gateway 的 `prepare -> confirm -> clientAction -> audit` 链路，不新增无约束前端操作入口。
- 在右侧 AI 面板提供中文“切换 tab”演示入口，并确保无效 tab id 不会污染工作区状态。

## 非目标
- 本次不实现 tab 重命名、排序、关闭或跨窗口移动。
- 本次不让 Rust 感知前端所有 tab 列表；Rust 只负责参数白名单化、确认策略和审计摘要。
- 本次不开放自动切换生产远程 tab，仍保持写入类工作区操作需确认。

## 影响范围
- Rust 工具目录：`src-tauri/src/services/tool_registry_service.rs`
- Rust AI 受控执行器与客户端动作模型：`src-tauri/src/services/ai_tool_invocation_service.rs`、`src-tauri/src/models/ai_tool_invocation.rs`
- 前端 AI 面板与浏览器预览：`src/features/tool-panel/AiToolContent.tsx`、`src/features/tool-panel/ToolPanel.tsx`、`src/lib/aiToolInvocationApi.ts`
- 前端 workspace 状态防护：`src/features/workspace/workspaceStore.ts`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src-tauri/tests/tool_registry_service.rs`、`src/features/tool-panel/AiToolContent.test.tsx`、`src/features/workspace/workspaceStore.test.ts`、`src/lib/aiToolInvocationApi.test.ts`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 登记 `workspace.focus_tab` 工具 schema、风险和确认策略。
- [x] 扩展 `AiToolClientAction`，新增 `workspaceFocusTab` 和 `tabId`。
- [x] 在 AI 执行器中白名单化 `tabId` 并生成审计摘要。
- [x] 在前端 AI 面板批准后调用 `onFocusTab(tabId)`，并提供中文“切换 tab”入口。
- [x] 修复 workspace store 对不存在 tab id 的防护。
- [x] 补充 Rust、前端 API、组件和 store 测试。
- [x] 运行窄测试、`npm run check` 和 `http://127.0.0.1:1425/` 浏览器 smoke。

## 验证
- `cd src-tauri && cargo test --test ai_tool_invocation_service workspace_focus_tab`：通过，3 tests。
- `cd src-tauri && cargo test --test tool_registry_service workspace_focus_tab`：通过，1 test。
- `npm run test:frontend -- AiToolContent aiToolInvocationApi workspaceStore`：通过，3 files / 82 tests。
- `npm run check`：通过；前端 32 files / 233 tests、Rust fmt/clippy/test、Vite build 均通过；保留既有 Vite chunk size warning。
- 浏览器 smoke：`http://127.0.0.1:1425/` 通过；点击“切换 tab”生成待确认调用，批准后 active tab 切到“远程预览”，页面无 `Next Terminal`，控制台 error 为 0。

## 风险
- AI 传入不存在的 tab id 不能让工作区进入无效 active tab 状态；前端 `selectTab` 和 AI action handler 都需要保守处理。
- 切换 tab 会改变用户当前焦点，因此保持 `write/contextual/summary`，需要用户确认。



