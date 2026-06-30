---
id: PLAN-20260618-000020-mcp-manifest-prototype
status: done
created_at: 2026-06-18T00:00:20+08:00
started_at: 2026-06-18T00:00:20+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# MCP 本地清单原型

## 目标

- 在现有 `Tool Registry -> rmcp Gateway` 基础上，提供一个本地 MCP 清单视图，明确 Kerminal 当前可暴露的 tools、resources、prompts、transport 状态和安全边界。
- 新增 Tauri Command，让前端和后续 MCP Server/Client 原型能读取同一份 manifest。
- 在右侧 AI 工具面板展示 MCP server 准备状态、resources/prompts 数量和本地安全策略，帮助用户理解 AI 可见能力。
- 补 Rust 和前端独立测试，继续由 `npm run check` 作为一键质量门禁。

## 非目标

- 本次不启动对外可连的 MCP 网络/stdio server，不新增监听端口。
- 本次不允许外部 Agent 直接绕过 Kerminal 的 `prepare -> confirm -> audit` 策略执行工具。
- 本次不接入第三方 MCP Client，也不实现外部 MCP Server 导入。
- 本次不扩展 AI 自动调用工具的执行策略。

## 影响范围

- Rust 模型：`src-tauri/src/models/tool_registry.rs`。
- Rust 服务：`src-tauri/src/services/mcp_tool_gateway.rs`。
- Rust Command：`src-tauri/src/commands/tool_registry.rs`、`src-tauri/src/lib.rs`。
- Rust 测试：`src-tauri/tests/tool_registry_service.rs`。
- 前端模型/API：`src/features/tool-panel/toolRegistryModel.ts`、`src/lib/toolRegistryApi.ts`。
- 前端 UI/测试：`src/features/tool-panel/AiToolContent.tsx`、`src/lib/toolRegistryApi.test.ts`、`src/features/tool-panel/AiToolContent.test.tsx`。
- 文档：本计划、`.updeng/docs/in-progress.md`、总产品计划 slice 23。

## 执行步骤

- [x] 设计 `McpGatewayManifest` 数据结构，包含 server、tools、resources、prompts、transports 和 security。
- [x] 在 `McpToolGateway` 中生成稳定本地 manifest，复用现有 rmcp tool list，不复制工具定义逻辑。
- [x] 新增 `tool_registry_mcp_manifest` Tauri Command 并注册。
- [x] 前端 `toolRegistryApi` 新增 manifest 读取与浏览器预览数据。
- [x] AI 面板展示 MCP 本地清单状态、资源/提示数量和安全策略。
- [x] 增加 Rust 和前端测试。
- [x] 运行窄测试、`npm run check` 和 `http://127.0.0.1:1425/` 浏览器 smoke。
- [x] 更新总计划和本计划状态。

## 验证

- `cd src-tauri && cargo test --test tool_registry_service`：5 个测试通过，覆盖 manifest 的 server、tools、resources、prompts、transport 和 security。
- `npm run test:frontend -- toolRegistryApi AiToolContent`：2 个测试文件 / 31 个测试通过。
- `npm run check`：前端 32 个测试文件 / 214 个测试通过，Rust fmt、clippy、全量测试和生产构建通过。
- 浏览器打开 `http://127.0.0.1:1425/`：AI 工具面板加载 MCP 本地清单，显示 Resources、Prompts、Transports、`本地 stdio MCP Server · 已预留`，页面无 `Next Terminal` 文案且控制台 error 为 0。

## 结果

- `tool_registry_mcp_manifest` 已提供本地 MCP manifest，包含 Kerminal server 信息、现有 MCP tools、规划中的 resources/prompts、应用内与外部预留 transport 状态，以及安全策略摘要。
- 右侧 AI 面板新增“MCP 本地清单”卡片，展示应用内 rmcp 已启用、外部 stdio transport 已预留、确认/审计/脱敏策略保留。
- 本次仍未启动外部 MCP Server，也未开放任何外部执行面；后续真实 transport 必须继续经过 Kerminal policy/audit 边界。

## 风险

- 如果 manifest 命名过早绑定外部协议细节，后续真正 MCP Server 可能需要迁移；本次用 Kerminal 自有 manifest 包装 rmcp tool list，降低协议耦合。
- 外部执行面不能提前打开；本次 transport 只标记为 `planned/disabled`，避免扩大权限面。


