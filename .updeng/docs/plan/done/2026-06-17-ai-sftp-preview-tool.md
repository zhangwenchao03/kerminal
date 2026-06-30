---
id: PLAN-20260617-000008-ai-sftp-preview-tool
status: done
created_at: 2026-06-17T00:00:08+08:00
started_at: 2026-06-17T00:00:08+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI SFTP Preview Tool

## 状态
- Done，完成于 2026-06-17。
- 2026-06-18 后由 [ADR-0006: Native SFTP Backend](../decisions/ADR-0006-native-sftp-backend.md) 接管实现口径：文件预览走原生 `russh` + `bssh-russh-sftp` backend。

## 目标
- 新增 `sftp.preview` 工具，让 AI 能在用户确认后读取当前 SSH 主机上的远程文本文件预览。
- 在 SFTP 工具面板为普通用户提供“预览”入口，文件内容以只读摘要形式展示。
- 当前最终实现复用 Rust `SftpService` 的原生 SFTP backend 读取远程文本文件前段内容，不依赖外部文件传输命令或预览临时文件。

## 非目标
- 本次不实现远程文件编辑、保存、覆盖、二进制渲染或大文件完整读取。
- 本次不做远程命令 dispatch。
- 本次不新增外部 LLM API 调用；AI 仍走 Tool Registry、Rig/rmcp 预留的受控工具链路。

## 影响范围
- Rust 模型：`src-tauri/src/models/sftp.rs`
- Rust 服务：`src-tauri/src/services/sftp_service.rs`
- Rust Commands：`src-tauri/src/commands/sftp.rs`、`src-tauri/src/lib.rs`
- AI 工具：`src-tauri/src/services/tool_registry_service.rs`、`src-tauri/src/services/ai_tool_invocation_service.rs`
- 前端 API：`src/lib/sftpApi.ts`、`src/lib/toolRegistryApi.ts`、`src/lib/aiToolInvocationApi.ts`
- 前端 UI：`src/features/tool-panel/ToolPanel.tsx`、`src/features/tool-panel/AiToolContent.tsx`
- 测试：Rust service / AI tool / registry tests，前端 API / AI 面板 / SFTP 面板 tests
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 定义 `SftpPreviewRequest` 和 `SftpFilePreview`，包含 `hostId/path/maxBytes/content/bytesRead/truncated` 等字段。
- [x] 在 `SftpService` 实现远程文件预览，限制 `maxBytes`，拒绝根路径；2026-06-18 原生化后由 native backend 直接读取并返回预览内容。
- [x] 增加 `sftp_preview_file` Tauri Command 和前端 `previewSftpFile` API。
- [x] 注册 `sftp.preview` 到 Tool Registry，策略为 `remote/always/summary`，并接入 AI 执行器。
- [x] 在右侧 SFTP 面板添加文件“预览”按钮和只读内容展示；在 AI 面板添加“预览文件”按钮。
- [x] 补 Rust 与 React 测试，覆盖 schema、调用链、浏览器预览、UI 交互、未知主机和非法参数。
- [x] 更新长期产品计划，说明 SFTP 文件预览已接入，剩余远程命令 dispatch。

## 验证
- [x] `cd src-tauri && cargo fmt`
- [x] `cd src-tauri && cargo test --test ai_tool_invocation_service --test sftp_service --test tool_registry_service`
- [x] `npm run test:frontend -- src/lib/sftpApi.test.ts src/lib/aiToolInvocationApi.test.ts src/lib/toolRegistryApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx`
- [x] 浏览器访问 `http://127.0.0.1:1425/`，在 AI 面板点击“预览文件”，确认 pending 显示 `sftp.preview · 远程`，点击“拒绝”后审计显示“用户已拒绝执行。”
- [x] 浏览器访问 `http://127.0.0.1:1425/`，切到 SFTP 工具，选择 SSH 主机后点击文件“预览”，确认预览卡片出现 `/var/log/app.log` 和日志内容。
- [x] `npm run check`：前端 23 个测试文件 / 135 个测试通过，Rust fmt/clippy/test 通过，生产构建通过；Vite 保留 chunk size warning。
- [x] `rg -n "Next Terminal|next terminal|NextTerminal" .`：无匹配。

## 风险
- 远程文件内容可能包含敏感信息；工具按 `remote/always` 确认，审计只记录摘要，不记录完整文件内容。
- 当前最终实现已被 ADR-0006 原生 SFTP backend 取代；真实外部服务器差异仍建议用用户常用主机做手工 smoke。
- 二进制文件按 UTF-8 lossless fallback 显示可能不可读；本切片只保证文本预览路径，后续再做 MIME/二进制策略。



