---
id: PLAN-20260619-000005-standard-mcp-tool-calls
status: done
created_at: 2026-06-19T00:00:05+08:00
started_at: 2026-06-19T00:00:05+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 标准工具调用与审批链路

## 目标

- 用 Rig 标准 tool-call 流程替换 `kerminal-tool` fenced JSON 文本协议。
- 模型调用工具时先进入 Kerminal approval broker，由现有 `ai_tool_prepare -> ai_tool_confirm -> audit` 链路负责审批、执行和审计。
- Chat 响应直接返回待审批 invocation，不再返回“工具建议”。
- Rig tool-call 暴露内置 Tool Registry 工具和已发现、已启用的自定义 MCP Server 工具。

## 非目标

- 不保留 `kerminal-tool`、`toolSuggestions` 或解析兼容路径。
- 不允许未发现、未启用或不在 Tool Registry / custom MCP 设置中的工具绕过审批直接执行。
- 不绕过现有风险策略、确认策略和审计策略。

## 影响范围

| 影响域 | 文件/入口 | 验证 |
| --- | --- | --- |
| 后端 AI 对话 | `src-tauri/src/services/ai_agent_service.rs`、`src-tauri/src/models/ai_agent.rs` | `cargo test --test ai_agent_service` |
| 工具审批 broker | `src-tauri/src/services/ai_tool_invocation_service.rs`、`src-tauri/src/commands/ai.rs` | `cargo test --test ai_tool_invocation_service` |
| MCP/Rig 工具暴露 | `src-tauri/src/services/mcp_tool_gateway.rs` | 旧协议关键词审计 |
| 前端 AI 面板 | `src/lib/aiAgentApi.ts`、`src/features/tool-panel/AiToolContent.tsx` | `npm run test:frontend -- aiAgentApi AiToolContent` |
| 测试与清理 | Rust/frontend tests、删除旧 parser/UI | 全量窄测试 |

## 执行步骤

- [x] 确认现有 AI/MCP 调用链和旧协议入口。
- [x] 设计 Rig tool-call adapter：工具 schema 来自 Tool Registry/custom MCP discovery，call 阶段进入 approval broker。
- [x] 后端响应模型从 `toolSuggestions` 改为 `pendingInvocations`。
- [x] 删除 `ai_tool_suggestion_parser` 和相关测试。
- [x] 前端删除 `AiToolSuggestionList`，直接展示 chat 返回的 pending invocation。
- [x] 更新测试，验证标准工具调用创建的 pending invocation 会传到 chat 响应和确认面板。
- [x] 运行 Rust/frontend 验证并审计旧关键词。

## 实现结果

- `AiAgentService` 使用 Rig `ToolDyn` adapter 注册内置工具和 custom MCP 工具；provider tool-call 进入 `KerminalApprovalTool::call` 后只创建 pending invocation，不执行业务动作。
- `AiToolInvocationService` 改为可 clone 的共享状态句柄，chat executor 创建的 pending 与前端 `ai_tool_confirm` 使用同一 pending map。
- `AiChatResponse` 改为 `pendingInvocations`，前端 AI 面板把返回的 pending invocation 放入确认队列。
- 旧 `ai_tool_suggestion_parser`、`AiToolSuggestionList`、`toolSuggestions` 类型和 `kerminal-tool` prompt 指令已从源码和测试中移除。
- custom MCP 工具仍通过已发现/启用的设置生成 `ToolDefinition`，确认后由 `execute_custom_mcp_tool -> call_mcp_server_tool` 执行标准 `tools/call`。

## 验证

- `cargo test --test ai_agent_service`：8 passed。
- `cargo test --test ai_tool_invocation_service`：107 passed；保留该测试文件既有 unused import warning。
- `npm run test:frontend -- aiAgentApi AiToolContent SettingsToolContent`：21 passed。
- `npm run typecheck`：passed。
- `npm run build`：passed；保留既有 Vite chunk size warning。
- `rustfmt --edition 2021 --check` 针对本次 touched Rust 文件：passed。
- 旧协议关键词审计：`rg -n "kerminal-tool|kerminal_tool|toolSuggestions|tool_suggestions|AiToolSuggestion|AiToolSuggestionList|extract_tool_suggestions|ai_tool_suggestion_parser" src src-tauri` 无匹配。

## 未覆盖的全局门禁

- `cargo clippy --lib --all-features -- -D warnings` 和 `cargo clippy --test ai_agent_service --all-features -- -D warnings` 被未触及文件拦截：`src/commands/tool_registry.rs` 的 `field_reassign_with_default`、`src/services/sftp_service.rs` 的 `too_many_arguments`。
- `cargo fmt --check` 全局仍会检查另一个会话正在修改的未触及文件；本次只格式化和检查了本切片 touched Rust 文件，避免覆盖并发改动。

## 风险与回滚

- 审批链路必须保持 host-side：任何工具执行都必须经过 `AiToolInvocationService`，不能让 LLM 或外部 server 直接触达业务服务。
- 回滚点是恢复上一切片的 fenced JSON parser 与 `toolSuggestions` UI，但本任务按用户要求不提交兼容代码。


