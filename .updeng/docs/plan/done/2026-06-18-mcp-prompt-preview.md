---
id: PLAN-20260618-000021-mcp-prompt-preview
status: done
created_at: 2026-06-18T00:00:21+08:00
started_at: 2026-06-18T00:00:21+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# MCP Prompt 渲染预览原型

## 目标
- 在现有 MCP 本地清单基础上，补齐 `prompts/get` 风格的本地 prompt 渲染能力。
- 右侧 AI 面板可以查看 prompt 列表，并用当前终端上下文预览渲染后的消息内容。
- 本切片只渲染 prompt，不调用 LLM，不执行工具，不开放外部 MCP transport。

## 非目标
- 不启动 stdio/http MCP Server。
- 不让 AI 自动根据 prompt 执行命令或调用工具。
- 不做完整 prompt 参数编辑器；先提供安全默认参数和可验证的协议闭环。

## 影响范围
- Rust IPC 模型：`src-tauri/src/models/tool_registry.rs`
- Rust 服务：`src-tauri/src/services/mcp_tool_gateway.rs`
- Tauri Command：`src-tauri/src/commands/tool_registry.rs`、`src-tauri/src/lib.rs`
- 前端类型/API：`src/features/tool-panel/toolRegistryModel.ts`、`src/lib/toolRegistryApi.ts`
- 前端 UI：`src/features/tool-panel/AiToolContent.tsx` 和新增的 prompt 预览组件
- 测试：`src-tauri/tests/tool_registry_service.rs`、`src/lib/toolRegistryApi.test.ts`、`src/features/tool-panel/AiToolContent.test.tsx`

## 执行步骤
- [x] 定义 prompt render request/result，复用 rmcp prompt message/get result 类型组装消息。
- [x] 实现 `McpToolGateway::render_prompt`，覆盖已登记的 explain/suggest/remote safe ops prompts。
- [x] 新增 `tool_registry_mcp_prompt_render` Tauri command，并按需注入当前终端上下文快照。
- [x] 前端封装 `renderMcpPrompt`，浏览器预览模式返回本地模拟 prompt 结果。
- [x] AI 面板展示“可预览 Prompts”，支持一键渲染并查看消息内容、错误和加载态。
- [x] 补 Rust 服务测试、前端 API 测试和组件交互测试。
- [x] 更新总计划中 slice 23 的完成事实和后续边界。

## 验证
- `cd src-tauri && cargo test --test tool_registry_service`：通过，8 tests。
- `npm run test:frontend -- toolRegistryApi AiToolContent`：通过，2 files / 35 tests。
- `npm run check`：通过，前端 32 files / 218 tests，Rust fmt/clippy/test 通过，生产构建通过；仍有既有 Vite chunk size warning。
- 在 `http://127.0.0.1:1425/` 进行浏览器 smoke：通过；AI 面板显示“可预览 Prompts”，点击“建议下一步命令”后出现 `kerminal-mcp/prompts/get` 渲染结果；页面没有 `Next Terminal` 文案，控制台错误数 0。

## 风险
- Prompt 内容可能把上下文注入规则散落在前端；本切片把渲染放在 Rust 服务层，前端只展示结果。
- 当前没有真实外部 MCP transport，prompt render 只作为本地协议预演；后续开放 transport 时仍必须沿用 Kerminal 权限、确认和审计边界。


