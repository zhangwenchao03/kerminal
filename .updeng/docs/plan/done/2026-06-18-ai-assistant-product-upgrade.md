---
id: PLAN-20260618-000003-ai-assistant-product-upgrade
status: done
created_at: 2026-06-18T00:00:03+08:00
started_at: 2026-06-18T00:00:03+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 助手产品化体验升级

## 目标
- 让右侧 AI 助手历史会话可检索，空白会话不会无限堆积，也不会污染历史记录。
- 统一右侧 AI 面板消息区、历史弹层和审计弹层的滚动条风格。
- 移除明显的白色割裂面，保持浅色/深色主题下都像生产级工具面板。

## 非目标
- 不改 LLM Provider、MCP 工具注册、后端工具执行或审计持久化契约。
- 不引入新的全局状态库或重做 AI 对话协议。

## 影响范围
- `src/features/tool-panel/AiToolContent.tsx`
- `src/App.css`
- 相关前端测试文件

## 执行步骤
- [x] 审计当前历史、空会话、滚动和白框来源。
- [x] 实现历史搜索和空会话治理。
- [x] 统一 AI 面板滚动条与弹层视觉。
- [x] 补充自动化测试。
- [x] 运行 typecheck、frontend tests 和 build。

## 验证
- `npm run typecheck` 通过。
- `npx vitest run src/features/tool-panel/AiToolContent.test.tsx` 通过，8 个用例覆盖 AI 助手对话、历史、搜索和工具调用。
- `npm run test:frontend` 通过，45 个测试文件、328 个用例。
- `npm run build` 通过。
- `http://127.0.0.1:5173` Vite 页面可访问，HTTP 200。

## 风险
- 历史存在于 `localStorage`，需要兼容旧数据并清理旧空会话。
- UI 改动集中在 AI 面板，需确认不破坏右侧工具区尺寸和输入区布局。


