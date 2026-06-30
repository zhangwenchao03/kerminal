---
id: PLAN-20260617-000030-tool-registry-rmcp-gateway
status: done
created_at: 2026-06-17T00:00:30+08:00
started_at: 2026-06-17T00:00:30+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Tool Registry 与 rmcp Gateway 基础切片

## 当前状态

- Done：工具注册、rmcp tool adapter、Tauri Commands、AI 工具面板、自动化验证和 1425 浏览器 smoke 均已完成。

## 目标
- 建立 Kerminal Tool Registry，集中声明 AI/UI/rmcp 可发现的应用能力、风险等级、确认策略、审计策略、输入 schema 和执行状态。
- 新增 rmcp Gateway 基础服务，把内部工具定义转换为 MCP-compatible tool 描述，为后续 Rig Agent 和 MCP Server/Client transport 复用。
- 提供 `tool_registry_list` 和 `tool_registry_mcp_list` Tauri Commands，并在前端 AI 工具面板展示工具目录、风险和确认要求。
- 保持本切片只做工具目录与 schema 发现，不执行真实工具调用，不绕过现有 UI/Command 安全边界。

## 非目标
- 不实现 Rig AI 聊天流、terminal context 注入或工具 dispatch。
- 不启动外部 MCP server/client transport。
- 不写入 tool call audit 表；审计落库进入后续安全/审计切片。

## 影响范围
- Rust 模型：新增 tool registry、risk level、confirmation policy、audit policy、tool parameter schema、rmcp tool view 类型。
- Rust 服务：新增 `tool_registry_service` 和 `mcp_tool_gateway`，注册第一批核心工具定义并转换 MCP-compatible schema。
- Rust Command：新增 `tool_registry_list`、`tool_registry_mcp_list`。
- React API：新增 `src/lib/toolRegistryApi.ts`，包含浏览器预览降级数据。
- React UI：扩展 AI 工具面板，展示工具目录、风险分布、确认策略和 MCP schema 状态。
- 测试：新增 Rust service 测试、前端 API 测试和 AI 面板展示测试。

## 执行步骤
- [x] 定义 tool registry/rmcp gateway 模型，覆盖风险、确认、审计、schema 和工具状态。
- [x] 实现 Rust registry 服务和 MCP-compatible adapter，注册 terminal/settings/profile/remote/sftp/server-info 等第一批工具。
- [x] 注册 Tauri Commands 并补 Rust 测试，验证工具数量、风险策略、schema 转换和禁用工具不会进入 MCP 可执行列表。
- [x] 新增前端 API 和浏览器预览数据，补 API 测试。
- [x] 扩展 AI 工具面板，补组件测试，保证中文 UI 能展示工具目录和确认策略。
- [x] 运行 `npm run check`，再做浏览器 smoke。

## 验证
- `npm run test:frontend`
- `npm run check:rust`
- `npm run build`
- `npm run check`
- 浏览器 smoke：`http://127.0.0.1:1425/` AI 工具面板能看到工具目录、风险等级、确认策略和 MCP schema 状态。

已执行：

- `cd src-tauri; cargo test --test tool_registry_service`：4 个 Rust service 测试通过。
- `npm run test:frontend -- src/lib/toolRegistryApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx`：3 个测试文件、16 个测试通过。
- `npm run check`：前端 21 个测试文件、92 个测试通过；Rust `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test` 通过；生产构建通过，仅保留既有 Vite chunk-size warning。
- 浏览器 smoke `http://127.0.0.1:1425/`：页面标题为 `Kerminal`；中文工作台、`AI 助手`、`Agent 控制`、`已注册`、`MCP tools`、`需确认`、`工具风险分布`、`需要确认的工具` 和 `写入终端` 可见；未出现 `Next Terminal` 文案；控制台 error 为空。

## 风险
- rmcp crate 的 transport/server API 后续接入可能变化；本切片只把转换边界隔离在 `mcp_tool_gateway`，避免 UI 和业务 service 依赖第三方细节。
- 工具 schema 如果过早覆盖执行参数，后续 dispatch 可能需要调整；本切片先保证工具发现、风险策略和参数大类稳定。
- 不能为了演示直接执行 terminal/SSH/SFTP 工具；执行必须等 policy/audit/confirmation 链路完成。


