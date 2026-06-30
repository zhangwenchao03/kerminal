---
id: PLAN-20260617-000007-ai-sftp-move-tool
status: done
created_at: 2026-06-17T00:00:07+08:00
started_at: 2026-06-17T00:00:07+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI SFTP Move Tool

## 状态
- Done，2026-06-17。

## 目标
- 新增 `sftp.move` 工具，让 AI 能在用户确认后移动当前 SSH 主机上的远程文件或目录路径。
- 复用现有 `SftpService::rename` 的远程路径校验与系统 `sftp rename` 执行能力，避免新增另一条不一致的底层移动实现。
- 在右侧 AI 工具面板提供中文预览按钮，并让浏览器非 Tauri 预览环境能展示同等确认、风险和审计行为。

## 非目标
- 本次不做远程文件预览、远程命令 dispatch 或批量 move。
- 本次不新增递归删除、覆盖策略或跨主机移动语义。
- 本次不改变现有 `sftp.rename` 行为。

## 影响范围
- Rust 工具目录：`src-tauri/src/services/tool_registry_service.rs`
- Rust AI 执行器：`src-tauri/src/services/ai_tool_invocation_service.rs`
- 前端预览 API：`src/lib/toolRegistryApi.ts`、`src/lib/aiToolInvocationApi.ts`
- 前端 AI 工具面板：`src/features/tool-panel/AiToolContent.tsx`
- 自动化测试：Rust service tests、前端 API 和组件 tests
- 长期计划文档：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 在 Tool Registry 登记 `sftp.move`，schema 为 `hostId/fromPath/toPath`，策略为 `remote/always/summary`。
- [x] 在 AI 执行器 dispatch 中接入 `sftp.move`，复用 `SftpRenameRequest` 与 `SftpService::rename`。
- [x] 在浏览器预览 API 中补齐 title、risk、audit、确认策略和模拟执行摘要。
- [x] 在 AI 工具面板新增“移动路径”按钮，使用当前 SSH 主机或默认远程主机生成安全预览参数。
- [x] 补 Rust 和 React 测试，覆盖 schema、MCP 导出、prepare、确认失败路径、浏览器预览和组件交互。
- [x] 更新长期产品计划中 SFTP AI dispatch 的完成状态和剩余缺口。

## 验证
- `cd src-tauri && cargo fmt`
- `cd src-tauri && cargo test --test ai_tool_invocation_service --test sftp_service --test tool_registry_service`：通过，63 tests。
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/lib/toolRegistryApi.test.ts`：通过，3 files / 40 tests。
- 浏览器访问 `http://127.0.0.1:1425/`，在 AI 面板点击“移动路径”，pending 显示 `sftp.move · 远程`，点击“拒绝”后审计显示“用户已拒绝执行。”。
- `npm run check`：通过，前端 23 files / 130 tests，Rust fmt/clippy/test，通过生产构建；Vite chunk size warning 仍为现有体积提示。
- `rg -n "Next Terminal|next terminal|NextTerminal" .`：无匹配。

## 风险
- `sftp.move` 与 `sftp.rename` 底层行为相同，命名差异必须通过标题、摘要和文档说明清楚。
- 远程路径 move 可能覆盖或失败，具体语义由系统 `sftp rename` 决定；本切片不新增覆盖检测。
- 浏览器 smoke 只走拒绝路径，不执行真实远程写操作。



