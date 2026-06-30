---
id: PLAN-20260618-000002-ai-all-app-capabilities
status: done
created_at: 2026-06-18T00:00:02+08:00
started_at: 2026-06-18T00:00:02+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 助手全应用能力 MCP 化

## 目标

- 让右侧 AI 助手可通过 Kerminal Tool Registry / MCP 暴露当前应用已有功能。
- 每个工具都能走 `ai_tool_prepare -> ai_tool_confirm` 的受控调用、确认策略和审计链路。
- 工具目录、MCP manifest、浏览器预览和自动化测试保持一致。

## 非目标

- 不新增业务功能本身，只把已有 Tauri command / service 能力暴露给 AI。
- 不绕过高风险、远程、删除、凭据相关操作的确认策略。
- 不在仓库中写入真实 API key、SSH 密码、私钥或生产地址。

## 影响范围

- Rust：`src-tauri/src/services/tool_registry_service.rs`、`src-tauri/src/services/ai_tool_invocation_service.rs`、必要模型/状态。
- 前端：AI 工具调用预览、浏览器预览工具目录、相关测试。
- 测试：Rust service 测试、前端 API/工具调用测试、类型检查和构建。

## 执行步骤

- [x] 梳理所有已注册 Tauri command 与现有 Tool Registry 覆盖差距。
- [x] 为缺失功能补齐 `ToolDefinition`、JSON Schema、风险等级、确认策略和审计策略。
- [x] 为缺失功能补齐 `execute_tool` 分发、参数校验、结果摘要和客户端动作。
- [x] 更新浏览器预览/前端工具元数据，避免 web preview 与 Tauri 运行时工具目录不一致。
- [x] 补充自动化测试，覆盖新增工具的 prepare/confirm、MCP list/manifest 和高风险策略。
- [x] 运行 `npm run typecheck`、`npm run test:frontend`、`npm run test:rust`、`npm run build`。

## 验证

- `npm run typecheck`
- `npm run test:frontend`
- `npm run test:rust`
- `npm run build`

## 完成记录

- 2026-06-18：AI Tool Registry / MCP 已覆盖终端、工作区、设置、LLM Provider、Profile、远程主机、SSH、RDP、SFTP、SFTP 传输队列、服务器信息、诊断、端口转发、片段、工作流和命令历史能力。
- 2026-06-18：`ai_tool_prepare -> ai_tool_confirm` 受控执行链已覆盖新增工具，保留远程/破坏性确认和审计策略；浏览器预览工具目录同步更新。
- 2026-06-18 验证：`npm run typecheck`、`npm run test:frontend`、`npm run check:rust`、`npm run build` 均通过。

## 风险

- SFTP、SSH、端口转发和删除类工具必须保留确认与审计，不允许自动静默执行。
- LLM Provider 和远程主机能力不得把明文凭据写入审计记录。
- 部分 UI-only 操作只能通过 `clientAction` 交给前端执行，需要测试 prepare 阶段能生成正确动作。


