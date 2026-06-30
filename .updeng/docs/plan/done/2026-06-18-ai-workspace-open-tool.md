---
id: PLAN-20260618-000017-ai-workspace-open-tool
status: done
created_at: 2026-06-18T00:00:17+08:00
started_at: 2026-06-18T00:00:17+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 受控打开右侧工具面板

## 目标
- 新增 `workspace.open_tool` 工具，让 AI 可在用户批准后打开右侧指定工具面板，例如 AI、系统、SFTP、端口、主机、片段、日志或设置。
- 复用现有 AI Tool Invocation Gateway 的 `prepare -> confirm -> clientAction -> audit` 链路，不开放任意 DOM/UI 自动化。
- 前端只允许切换到现有 `ToolId` 白名单中的工具，避免未知工具 id 污染工作台状态。

## 非目标
- 本次不实现工具面板内部具体操作，例如自动点击 SFTP 上传、修改设置表单或清空日志。
- 本次不改变右侧工具面板的信息架构和视觉样式。
- 本次不引入外部 MCP transport；仍使用应用内 rmcp/tool registry 和现有审计链。

## 影响范围
- Rust 工具目录：`src-tauri/src/services/tool_registry_service.rs`
- Rust AI 受控执行器与客户端动作模型：`src-tauri/src/services/ai_tool_invocation_service.rs`、`src-tauri/src/models/ai_tool_invocation.rs`
- 前端 AI 面板与浏览器预览：`src/features/tool-panel/AiToolContent.tsx`、`src/features/tool-panel/ToolPanel.tsx`、`src/lib/aiToolInvocationApi.ts`、`src/lib/toolRegistryApi.ts`
- 前端 workspace 状态防护：`src/features/workspace/workspaceStore.ts`、`src/features/workspace/types.ts`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src-tauri/tests/tool_registry_service.rs`、`src/features/tool-panel/AiToolContent.test.tsx`、`src/features/workspace/workspaceStore.test.ts`、`src/lib/aiToolInvocationApi.test.ts`、`src/lib/toolRegistryApi.test.ts`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 登记 `workspace.open_tool` 工具 schema、风险和确认策略。
- [x] 扩展 `AiToolClientAction`，新增 `workspaceOpenTool` 和 `toolId`。
- [x] 在 AI 执行器中白名单化工具 id 并生成审计摘要。
- [x] 在前端 AI 面板批准后调用 `onOpenTool(toolId)`，并提供中文“打开工具”演示入口。
- [x] 修复 workspace store 对未知工具 id 的防护。
- [x] 补齐浏览器预览 Tool Registry/MCP tools 中的 `workspace.open_tool` 和相邻 workspace 客户端动作。
- [x] 补充 Rust、前端 API、组件和 store 测试。
- [x] 运行窄测试、`npm run check` 和 `http://127.0.0.1:1425/` 浏览器 smoke。

## 验证
- 已通过：`cd src-tauri && cargo test --test ai_tool_invocation_service workspace_open_tool`，3 个用例通过。
- 已通过：`cd src-tauri && cargo test --test tool_registry_service workspace_open_tool`，1 个用例通过。
- 已通过：`npm run test:frontend -- AiToolContent aiToolInvocationApi workspaceStore`，3 个测试文件、85 个用例通过。
- 已通过：`npm run test:frontend -- toolRegistryApi aiToolInvocationApi AiToolContent workspaceStore`，4 个测试文件、91 个用例通过。
- 已通过：`npm run check`，前端 32 个测试文件、236 个用例通过，Rust fmt/clippy/test 通过，生产构建通过；保留既有 Vite chunk size warning。
- 已通过浏览器 smoke：`http://127.0.0.1:1425/`，中文 AI 面板正常，页面无 `Next Terminal`，点击“打开工具”后出现 `workspace.open_tool` 待确认卡片和 `toolId=sftp`，批准后右侧面板切换到 SFTP，切回 AI 面板可看到“工具面板切换已批准，浏览器预览已执行。”审计摘要，刷新后浏览器预览工具目录可见 `workspace.open_tool` 和“打开工具面板”，控制台无 error。

## 风险
- AI 传入未知工具 id 时不能改变 `activeTool`；Rust 和前端都需要白名单防护。
- 打开工具面板会改变用户当前关注区域，因此保持 `write/contextual/summary`，需要用户确认。



