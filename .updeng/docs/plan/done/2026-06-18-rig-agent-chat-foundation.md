---
id: PLAN-20260618-000026-rig-agent-chat-foundation
status: done
created_at: 2026-06-18T00:00:26+08:00
started_at: 2026-06-18T00:00:26+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Rig Agent 对话基础

## 状态

- Done：代码、自动化验证和 `http://127.0.0.1:1425/` 浏览器 smoke 均已通过。

## 目标

- 在右侧 AI 面板接入真实 `ai_chat` 调用，让用户可以用中文向 Rig Agent 提问。
- Rust 侧通过 `rig-core` 构造 OpenAI-compatible Agent，不手写 LLM HTTP 调用。
- 对话请求携带当前终端上下文和 rmcp 工具目录摘要，让模型知道当前 terminal 信息与可用工具边界。
- 前端浏览器预览、Tauri command、服务层和测试形成完整闭环。

## 非目标

- 本次不做 Rig Agent 自动选择和执行工具。
- 本次不绕过既有 `prepare -> confirm -> audit` 工具确认链。
- 本次不新增云同步、长会话存储或流式 token UI。

## 影响范围

- Rust 模型：`src-tauri/src/models/ai_agent.rs`
- Rust 服务：`src-tauri/src/services/ai_agent_service.rs`
- Tauri command：`src-tauri/src/commands/ai.rs`、`src-tauri/src/lib.rs`
- 应用状态：`src-tauri/src/state.rs`
- 前端 API：`src/lib/aiAgentApi.ts`
- 右侧 AI 面板：`src/features/tool-panel/AiToolContent.tsx`
- 测试：Rust service 测试、前端 API 测试、AI 面板交互测试
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤

- [x] 定义 AI chat IPC 请求/响应类型，字段使用 camelCase，响应不包含密钥和原始 provider 凭据。
- [x] 新增 `AiAgentService`，支持 provider 选择、输入校验、终端上下文采集、rmcp 工具目录摘要和 Rig Agent 调用。
- [x] 通过可注入 executor 覆盖测试路径，单元测试不访问真实 LLM 网络。
- [x] 注册 `ai_chat` command 并接入 `AppState`。
- [x] 新增前端 `aiAgentApi`，Tauri 下调用 `ai_chat`，浏览器预览返回中文模拟回复。
- [x] 在 AI 面板加入中文输入、发送状态、错误态和回复展示，并复用当前 context request。
- [x] 补齐 Rust 与前端测试，确保 `npm run check` 继续作为一键验证入口。
- [x] 更新总计划和 in-progress，记录 1425 浏览器 smoke 口径。

## 验证

- 已通过：`cd src-tauri && cargo test --test ai_agent_service`
- 已通过：`npm run test:frontend -- aiAgentApi AiToolContent`
- 已通过：`npm run check`
- 已通过：`rg "Next Terminal|next terminal|NextTerminal" .`
- 已通过：浏览器 smoke `http://127.0.0.1:1425/`
  - 页面标题为 `Kerminal`。
  - 页面显示中文工作台和 `AI 对话`。
  - 未检测到 `Next Terminal`、`next terminal` 或 `NextTerminal`。
  - AI 对话输入 `请根据当前终端上下文给出下一步建议` 后，浏览器预览返回中文响应并清空输入框。

## 风险

- 真实 LLM 请求依赖用户已配置启用 provider 和 API key；测试必须使用 mock executor，不能把网络作为自动化前提。
- Prompt 会包含终端最近输出，必须复用已有 AI context 脱敏逻辑。
- 工具目录只进入提示和响应元数据，本次不能让 Agent 自动执行任何工具，避免权限边界提前扩大。



