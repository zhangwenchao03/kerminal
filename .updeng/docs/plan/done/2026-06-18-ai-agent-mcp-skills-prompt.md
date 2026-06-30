---
id: PLAN-20260618-000001-ai-agent-mcp-skills-prompt
status: done
created_at: 2026-06-18T00:00:01+08:00
started_at: 2026-06-18T00:00:01+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI Agent MCP Skills 与 Prompt 落地

## 目标
- 把 Kerminal Agent 的名称、职责、能力边界和工具调用规则落到系统 prompt。
- 在 MCP manifest 中一等暴露 Agent profile、skills catalog 和 prompt/resource 入口。
- 让 AI 对话上下文同时包含终端快照、MCP 工具目录、Agent profile 和 skills 路由。
- 在设置页提供可发现的 MCP / Skills 入口，让用户能直接看到系统 MCP 服务、resources、prompts、tools、skills 路由和外部集成配置模板。
- 支持用户在设置中声明自定义 MCP Servers、Tools 和 Skills，并进入 MCP manifest、resource 和 AI Agent 上下文。
- 同步前端预览模型和测试，确保浏览器预览与 Tauri 清单契约一致。

## 非目标
- 不新增真实工具执行能力；本次复用现有 Tool Registry 和 AI 工具确认链路。
- 不启动外部 stdio/HTTP MCP Server 进程；本次展示系统 transport 状态和配置模板，真实外部执行层后续单独接入。
- 不改 LLM Provider 配置和凭据存储方式。

## 影响范围
- 后端模型：`src-tauri/src/models/tool_registry.rs`
- 设置模型：`src-tauri/src/models/settings.rs`
- MCP 网关：`src-tauri/src/services/mcp_tool_gateway.rs`
- AI Agent：`src-tauri/src/services/ai_agent_service.rs`
- 前端契约与预览：`src/features/tool-panel/toolRegistryModel.ts`、`src/lib/toolRegistryApi.ts`
- AI 面板与设置入口：`src/features/tool-panel/AiToolContent.tsx`、`src/features/settings/SettingsToolContent.tsx`、`src/features/settings/settingsModel.ts`
- 测试与文档：相关 Rust/前端测试、`.updeng/docs/`

## 执行步骤
- [x] 补齐 Agent profile、capabilities、skills 的结构化模型。
- [x] 在 MCP manifest、resource 和 prompt 中暴露 Agent 与 skills 能力。
- [x] 让 AI Agent 实际使用新的系统 prompt、skills 和应用上下文。
- [x] 同步前端类型、浏览器预览 manifest/resource/prompt。
- [x] 在设置页增加 `MCP / Skills` 分类和能力清单面板。
- [x] 在设置页展示系统 MCP transports 和 Claude/Codex 等外部工具可参考的配置模板。
- [x] 支持用户维护自定义 MCP Servers、Tools 和 Skills，并在 manifest/resource/AI context 中合并展示。
- [x] 修复 AI 面板底部下拉向下溢出问题，底部选择器改为向上展开。
- [x] 更新测试覆盖资源读取、prompt 渲染、上下文注入和 UI 名称。

## 验证
- `npm run typecheck`：通过。
- `npx vitest run src/components/ui/select.test.tsx src/lib/aiAgentApi.test.ts src/lib/toolRegistryApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx`：通过。
- `cd src-tauri && cargo test --test tool_registry_service --test ai_agent_service`：通过。
- `npx vitest run src/features/settings/SettingsToolContent.test.tsx src/lib/toolRegistryApi.test.ts`：14 个测试通过，覆盖设置页系统 MCP 集成展示、自定义 MCP 配置和前端 manifest 预览。
- `cd src-tauri && cargo test --test tool_registry_service --test settings_service --test ai_agent_service`：28 个测试通过，覆盖自定义 MCP 设置归一化、manifest/resource 合并、AI 上下文注入。
- `npm run test:frontend`：46 个测试文件、349 个测试通过。
- `npm run test:rust`：通过。
- `npm run build`：通过，保留 Vite 大 chunk 警告。

## 风险
- Manifest 契约新增字段需要前后端同步，否则预览或 Tauri 调用会类型不一致。
- Skills 工具覆盖要与 Tool Registry 同源校验，避免新增工具后忘记进入 Agent 路由。
- 页面当前展示外部 MCP 集成配置模板和状态；如果要让 Claude/Codex 真实连接，需要实现并验证 stdio/HTTP MCP Server 进程入口、生命周期、鉴权和审计。


