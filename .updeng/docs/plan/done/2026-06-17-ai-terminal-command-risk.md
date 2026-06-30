---
id: PLAN-20260617-000012-ai-terminal-command-risk
status: done
created_at: 2026-06-17T00:00:12+08:00
started_at: 2026-06-17T00:00:12+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 终端命令风险识别切片

## 当前状态

- Done：AI `terminal.write` 调用已补充命令内容级风险识别、风险摘要和前端展示。

## 目标

- 在 `ai_tool_prepare` 阶段识别 `terminal.write` 的危险命令片段，把高风险写入从 `write/contextual` 升级为 `destructive/always`。
- 待确认调用和审计记录都携带风险摘要，让用户能在批准前看到 AI 准备写入终端的风险原因。
- 前端 AI 面板展示风险摘要，浏览器预览示例覆盖安全命令和危险命令摘要。

## 非目标

- 不实现真实 Rig Agent 自动发起工具调用。
- 不阻止用户手动批准执行；本切片先做识别、升级、展示和审计。
- 不覆盖 SSH/SFTP/批量远程命令的专用策略；这些进入后续 slice 17/20。
- 不实现 SQLite 审计持久化。

## 影响范围

- Rust 模型：`AiToolPendingInvocation`、`AiToolAuditRecord` 增加风险摘要字段。
- Rust 服务：`ai_tool_invocation_service` 在 prepare 阶段对 `terminal.write` 参数做命令风险识别。
- React API：同步 AI tool invocation DTO 类型和浏览器预览。
- React UI：AI 面板 pending/audit 展示风险摘要。
- 测试：补 Rust service 测试、前端 API/组件测试。

## 执行步骤

- [x] 定义风险摘要字段和命令风险分类规则。
- [x] 在 `terminal.write` prepare 阶段提升有效风险和确认策略。
- [x] 前端展示 pending/audit 风险摘要。
- [x] 补 Rust/前端测试并运行 `npm run check`。
- [x] 使用 `http://127.0.0.1:1425/` 做浏览器 smoke。

## 验证

- `cd src-tauri; cargo test --test ai_tool_invocation_service`：10 passed。
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx`：2 files / 12 tests passed。
- `npm run check`：23 frontend test files / 104 tests passed；Rust fmt、clippy、cargo test passed；Vite build passed。
- 浏览器 smoke：`http://127.0.0.1:1425/` 通过；AI 面板“风险预览”可显示 `terminal.write · 破坏性` 和“终端写入命令风险：包含权限提升命令...”；console error 为 0；页面仍无 `Next Terminal`。

## 风险

- 规则误报会让正常命令显示更高风险；本切片只升级确认和展示，不直接拦截执行。
- 规则漏报不可避免；后续需要按生产主机、远程、批量、sudo、删除、格式化等场景继续细化。


