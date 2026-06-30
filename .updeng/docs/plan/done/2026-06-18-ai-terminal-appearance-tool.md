---
id: PLAN-20260618-000013-ai-terminal-appearance-tool
status: done
created_at: 2026-06-18T00:00:13+08:00
started_at: 2026-06-18T00:00:13+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 受控更新终端外观

## 目标
- 新增 `settings.update_terminal_appearance` 工具，让 AI 可在用户批准后调整终端字体、字号、行高、光标闪烁和滚屏缓冲。
- 复用现有 `SettingsService`、SQLite-backed `AppSettings` 校验和 AI Tool Invocation Gateway 审计链。
- 在右侧 AI 面板提供中文“准备外观”入口，浏览器预览和自动化测试保持一致。

## 非目标
- 本次不开放快捷键编辑、主题切换以外的完整设置对象覆盖。
- 本次不允许 AI 修改 LLM Provider/API key 或凭据引用。
- 本次不绕过现有设置校验范围；字号、行高和滚屏缓冲仍由 `AppSettings::validated` 统一约束。

## 影响范围
- Rust 工具目录：`src-tauri/src/services/tool_registry_service.rs`
- Rust AI 受控执行器：`src-tauri/src/services/ai_tool_invocation_service.rs`
- 前端 AI 面板与浏览器预览：`src/features/tool-panel/AiToolContent.tsx`、`src/lib/aiToolInvocationApi.ts`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src-tauri/tests/tool_registry_service.rs`、`src/features/tool-panel/AiToolContent.test.tsx`、`src/lib/aiToolInvocationApi.test.ts`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 登记 `settings.update_terminal_appearance` 工具 schema、风险和确认策略。
- [x] 在 AI 执行器中实现局部外观字段合并、校验、持久化和结果摘要。
- [x] 增加 Rust 测试，覆盖成功更新、保留其他设置、非法值失败、拒绝无副作用和 registry/MCP 暴露。
- [x] 增加前端按钮、浏览器预览标题、风险、结果摘要和 API/组件测试。
- [x] 更新产品计划 slice 16 事实。
- [x] 运行窄测试、`npm run check` 和 `http://127.0.0.1:1425/` 浏览器 smoke。

## 验证
- 通过：`cd src-tauri && cargo test --test ai_tool_invocation_service terminal_appearance`
- 通过：`cd src-tauri && cargo test --test tool_registry_service terminal_appearance`
- 通过：`npm run test:frontend -- AiToolContent aiToolInvocationApi`
- 通过：`npm run check`
- 通过：浏览器 smoke `http://127.0.0.1:1425/`，确认中文 AI 面板、`Agent 控制`、`MCP 本地清单`、`准备外观` 可见；点击后出现 `settings.update_terminal_appearance` 待确认卡片；控制台 error 为 0；页面不包含 `Next Terminal`。

## 风险
- 外观设置会立即影响终端可读性，因此保持 `write/contextual/summary`，需要用户确认。
- AI 传入过大字号、过小行高或异常滚屏缓冲必须由现有设置校验拒绝，并写入失败审计。



