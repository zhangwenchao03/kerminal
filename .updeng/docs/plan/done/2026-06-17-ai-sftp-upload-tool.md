---
id: PLAN-20260617-000010-ai-sftp-upload-tool
status: done
created_at: 2026-06-17T00:00:10+08:00
started_at: 2026-06-17T00:00:10+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI SFTP 上传工具接入计划

- 状态：Done
- 完成日期：2026-06-17

## 目标
- 将 `sftp.upload` 纳入 Kerminal Tool Registry、rmcp/MCP 工具列表和 AI Tool Invocation Gateway。
- AI 可在用户确认后调用已保存 SSH 主机的 SFTP 上传能力，把本地文件上传到用户指定远程路径。
- 右侧 AI 面板提供中文预览入口，用于验证确认、拒绝和审计链路。

## 非目标
- 不实现文件选择器、拖拽上传、上传进度条、断点续传或冲突覆盖提示 UI。
- 不实现 SFTP 移动、文件预览或远程命令 dispatch。
- 不放宽 `SftpService::upload` 已有本地路径和远程路径校验。
- 不允许浏览器 smoke 批准真实/模拟远程写入流程；浏览器只验证拒绝路径。

## 影响范围
- Rust Tool Registry：新增 `sftp.upload` schema、风险、确认和审计策略。
- Rust AI 执行器：新增参数解析、调用 `SftpService::upload`、结果摘要和失败审计。
- Rust 测试：覆盖准备确认策略、未知主机、参数类型错误、本地路径校验和远程根目录拦截。
- 前端 API 预览：补齐非 Tauri 浏览器预览的标题、风险、确认、审计和结果摘要。
- 前端 AI 面板：新增“上传文件”按钮和交互测试。
- 产品计划：更新 SFTP AI dispatch 完成状态和剩余缺口。

## 执行步骤
- [x] 更新本计划和 `.updeng/docs/in-progress.md`。
- [x] 在 Tool Registry 中登记 `sftp.upload`，schema 包含 `hostId`、`localPath`、`remotePath`。
- [x] 在 AI Tool Invocation Gateway 中接入 `SftpTransferRequest` 和 `SftpService::upload`。
- [x] 补 Rust registry 和 AI invocation 测试。
- [x] 补前端浏览器预览和 AI 面板入口、测试。
- [x] 更新 `.updeng/docs/plan/next/terminal-product-plan.md`。
- [x] 运行 targeted tests、1425 浏览器 smoke 和 `npm run check`。
- [x] 收口本计划并从 in-progress 移除。

## 验证
- `cd src-tauri && cargo fmt`
- `cd src-tauri && cargo test --test ai_tool_invocation_service --test sftp_service --test tool_registry_service`
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/lib/toolRegistryApi.test.ts`
- 浏览器打开 `http://127.0.0.1:1425/`，点击“上传文件”，确认出现 `sftp.upload · 远程`，点击“拒绝”，确认审计显示“用户已拒绝执行。”
- `npm run check`

## 风险
- `sftp.upload` 会写远程文件，必须保持 `remote/always/summary`，用户批准前不能执行。
- 本地路径和远程路径由现有 SFTP 服务校验；本切片不增加目录创建、路径扩展或覆盖确认，避免扩大文件系统和远程写入权限。
- 浏览器预览是模拟链路，真实上传仍只在 Tauri/Rust 执行器内完成。

## 验证结果
- Targeted frontend：`npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/lib/toolRegistryApi.test.ts`，3 files / 38 tests passed。
- Targeted Rust：`cargo test --test ai_tool_invocation_service --test sftp_service --test tool_registry_service`，59 tests passed。
- Browser smoke：`http://127.0.0.1:1425/` 上点击“上传文件”，确认出现 `sftp.upload · 远程` 和路径摘要；点击“拒绝”后审计显示“用户已拒绝执行。”
- Full gate：`npm run check` passed，包含前端 23 files / 128 tests、Rust fmt/clippy/test 和生产构建；仅保留 Vite chunk-size warning。
- 命名检查：`rg -n "Next Terminal|next terminal|NextTerminal" .` 无匹配。



