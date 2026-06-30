---
id: PLAN-20260618-000007-ai-chat-tool-suggestion
status: done
created_at: 2026-06-18T00:00:07+08:00
started_at: 2026-06-18T00:00:07+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 对话产出可确认工具调用建议

## 目标

- 让 Rig AI 对话响应可以携带结构化工具调用建议，右侧 AI 面板展示候选动作。
- 候选动作只进入“准备工具调用”阶段，点击后复用现有 `ai_tool_prepare -> ai_tool_confirm -> audit` 链路。
- 工具建议必须包含工具 id、参数、中文原因和风险/确认预览，保持用户可见、可拒绝、可审计。

## 非目标

- 本切片不让 Rig Agent 自动执行工具。
- 本切片不开放外部 MCP transport，也不实现 rmcp server/client 进程。
- 本切片不实现多轮长记忆或自动修复失败工具参数。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 后端接口 | 是 | `src-tauri/src/models/ai_agent.rs`、`src-tauri/src/services/ai_agent_service.rs` | `cargo test --test ai_agent_service` |
| 前端页面 | 是 | `src/lib/aiAgentApi.ts`、`src/features/tool-panel/AiToolContent.tsx` | `npm run test:frontend -- aiAgentApi AiToolContent`、浏览器 smoke |
| 数据库 | 否 | 无 schema 变更 | 不需要 migration |
| 权限/审计 | 是 | 复用现有 `prepare -> confirm -> audit` | 工具建议不直接执行，prepare 仍由后端校验 |
| 文档/计划 | 是 | `.updeng/docs/plan/`、`.updeng/docs/in-progress.md`、长期计划 | 文档检查 |

## 执行步骤

- [x] 新增 AI 工具建议 DTO，并在 chat 响应中返回 `toolSuggestions`。
- [x] 新增 Rust 工具建议解析模块，解析 AI 回复中的 fenced JSON，并过滤未知或未启用工具。
- [x] 更新 Rig Agent preamble，让模型用稳定格式输出候选工具动作。
- [x] 前端 API 同步类型和浏览器预览 fallback。
- [x] AI 面板展示“AI 建议的工具调用”，点击后调用 `prepareAiToolInvocation`。
- [x] 补充 Rust service 测试、前端 API 测试和 AI 面板交互测试。
- [x] 运行窄测试、`npm run check` 和 `http://127.0.0.1:1425/` smoke。
- [x] 更新总计划并从 `in-progress` 移除本切片。

## 实现结果

- 后端新增 `AiToolSuggestion` 响应模型和 `ai_tool_suggestion_parser`，只解析 `kerminal-tool` fenced JSON。
- `ai_chat` 会移除机器可读工具块，保留中文回复，并返回已通过 Tool Registry 校验的候选工具建议。
- 前端 `aiAgentApi` 已同步 `toolSuggestions`，浏览器预览在测试类请求中生成 `terminal.write` 候选动作。
- AI 面板新增“AI 建议的工具调用”卡片，点击“准备工具调用”后复用 `prepareAiToolInvocation`，不自动执行。

## 建议 JSON 格式

AI 回复中如需建议工具调用，追加独立 fenced block：

```kerminal-tool
{
  "toolId": "terminal.write",
  "arguments": {
    "sessionId": "session-1",
    "data": "cargo test\r"
  },
  "reason": "运行项目测试确认当前修改。",
  "confidence": "medium"
}
```

约束：

- `arguments` 必须是 JSON object。
- `toolId` 必须来自当前 Tool Registry 且处于 enabled。
- 解析失败、未知工具或参数不是 object 时丢弃建议，保留 AI 文本回复。
- 真正准备和执行仍交给 `ai_tool_prepare` 校验 schema、风险升级和审计。

## 验证

- `cd src-tauri && cargo test --test ai_tool_suggestion_parser`：3 passed。
- `cd src-tauri && cargo test --test ai_agent_service`：7 passed。
- `npm run test:frontend -- aiAgentApi AiToolContent`：34 passed。
- `npm run check`：前端 32 files / 220 tests passed，Rust fmt/clippy/test passed，生产构建 passed；保留既有 Vite chunk size warning。
- Browser smoke：`http://127.0.0.1:1425/` 标题 `Kerminal`，AI 面板中文、`MCP 本地清单` 可见，无 `Next Terminal`，console error 0；受浏览器自动化虚拟剪贴板限制，AI 输入交互由组件测试覆盖。

## 风险

- LLM 输出 JSON 可能不稳定：本切片只接受 fenced JSON object，解析失败时静默忽略候选动作，不影响正常回复。
- 候选参数可能缺必填项：`prepareAiToolInvocation` 会再次校验并显示错误，不直接执行。
- 工具建议可能含敏感内容：建议仅展示参数摘要前的原始参数会进入 prepare；后端 prepare 仍会按现有摘要脱敏和审计策略处理。


