---
id: PLAN-20260618-000006-ai-chat-stream-markdown
status: done
created_at: 2026-06-18T00:00:06+08:00
started_at: 2026-06-18T00:00:06+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 右侧 AI 对话流式与 Markdown 升级

## 目标
- 右侧 AI 对话在发送后展示可见过程，而不是只显示“正在思考”。
- assistant 回复以渐进方式进入消息气泡，并支持 Markdown 渲染。
- 复用开源组件处理流式 Markdown，不在项目内手写 Markdown parser。
- 保留现有终端上下文、Provider 选择、本地历史和工具建议审批链。

## 非目标
- 本切片不替换现有 Rig Provider、凭据和工具审批契约。
- 不引入整套外部 chat runtime 重写本地历史和 Tauri 调用边界。
- 不在本切片完成 Rig provider token 级事件桥接；先保留可替换的前端流式接口。

## 影响范围
- 前端页面：`src/features/tool-panel/AiToolContent.tsx`
- 前端 API：`src/lib/aiAgentApi.ts`
- 全局样式：`src/App.css`
- 依赖：`package.json`、`package-lock.json`
- 测试：`src/features/tool-panel/AiToolContent.test.tsx`、`src/lib/aiAgentApi.test.ts`
- 决策：`.updeng/docs/decisions/ADR-0004-ai-chat-stream-markdown-ui.md`

## 执行步骤
- [x] 引入 Streamdown 并接入 Tailwind source 与样式。
- [x] 给 AI API 增加渐进输出包装，保持旧 `sendAiChatMessage` 兼容。
- [x] 将发送流程改为插入 assistant 草稿、更新过程步骤、追加流式内容、完成后挂接工具建议。
- [x] 使用 Streamdown 渲染 assistant Markdown，用户消息仍保持纯文本。
- [x] 补充测试覆盖流式过程、Markdown 内容和旧接口兼容。

## 验证
- `npm run test:frontend -- AiToolContent aiAgentApi`
- `npm run typecheck`
- `npm run build`

## 风险
- 当前后端 `ai_chat` 仍是一次性返回；本切片实现的是 UI 渐进渲染和可替换前端流式接口。真实 provider token stream 需后续把 Rig `StreamingPrompt` 通过 Tauri event 接到同一接口。
- Streamdown 带来较多渲染相关依赖，需通过构建验证包体和 Tauri WebView 兼容性。


