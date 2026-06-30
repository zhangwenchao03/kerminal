---
id: PLAN-20260617-000009-ai-sftp-rename-tool
status: done
created_at: 2026-06-17T00:00:09+08:00
started_at: 2026-06-17T00:00:09+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI sftp.rename 受控重命名远程路径

## 状态
- Done

## 目标
- 让 AI 通过 Tool Registry 中的 `sftp.rename` 在用户批准后重命名已保存 SSH 主机上的远程文件或目录路径。
- 复用现有 `SftpService::rename` 和系统 OpenSSH `sftp` 链路，不新增并行 SFTP 实现。
- Tool Registry 暴露 `hostId`、`fromPath`、`toPath` schema，并通过 rmcp gateway 可发现。
- Rust confirm 阶段校验 `hostId`、`fromPath`、`toPath` 类型，执行成功后写入中文审计摘要；未知主机、根路径、非法参数和 SFTP 失败都落入 failed audit。
- 前端 AI 面板提供中文“重命名”演示入口，浏览器预览可模拟远程写操作确认和审计结果。
- 浏览器验收端口使用 `http://127.0.0.1:1425/`。

## 非目标
- 本切片不实现 SFTP 上传、下载、移动语义拆分或文件预览的 AI dispatch。
- 不在自动化测试中连接真实 SSH/SFTP 主机或改动真实远程文件。
- 不新增右侧 SFTP 文件管理 UI，只补齐 AI 面板受控调用入口。
- 不改变已有 `sftp_rename` Tauri command 的底层实现。

## 影响范围
- Rust AI 工具调用执行器：`src-tauri/src/services/ai_tool_invocation_service.rs`
- Tool Registry schema：`src-tauri/src/services/tool_registry_service.rs`
- 前端 AI API 与浏览器预览：`src/lib/aiToolInvocationApi.ts`
- 前端 AI 面板：`src/features/tool-panel/AiToolContent.tsx`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src-tauri/tests/tool_registry_service.rs`、`src/lib/aiToolInvocationApi.test.ts`、`src/features/tool-panel/AiToolContent.test.tsx`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] Tool Registry 新增 `sftp.rename`，分类为 SFTP，风险为 `remote`，确认策略沿用 remote 默认每次确认。
- [x] Rust `execute_tool` 接入 `sftp.rename`，调用 `SftpService::rename`。
- [x] 校验 `hostId`、`fromPath` 和 `toPath` 类型，失败转为 failed audit。
- [x] 成功摘要清楚展示来源路径和目标路径，避免泄露凭据或远端原始输出。
- [x] 前端浏览器预览支持 `sftp.rename` 的标题、远程风险、确认策略和成功摘要。
- [x] AI 面板新增“重命名”入口，默认把当前 SSH 主机的 `/tmp/kerminal-ai-preview.tmp` 重命名为 `/tmp/kerminal-ai-preview.renamed.tmp`。
- [x] 补齐 Rust/React/API 测试。
- [x] 更新产品总计划和本计划验证结果。

## 验证
- 已通过：`cd src-tauri && cargo fmt`
- 已通过：`cd src-tauri && cargo test --test ai_tool_invocation_service --test sftp_service --test tool_registry_service`
- 已通过：`npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/lib/toolRegistryApi.test.ts`
- 已通过：`npm run check`
- 已通过：使用 in-app browser 打开 `http://127.0.0.1:1425/`，中文 AI 面板存在“重命名”；点击后 pending 标记为 `sftp.rename · 远程`，参数包含 `fromPath=/tmp/kerminal-ai-preview.tmp` 和 `toPath=/tmp/kerminal-ai-preview.renamed.tmp`；点击“拒绝”后最近审计显示“用户已拒绝执行。”；页面无 “Next Terminal” 文案且控制台无 error。

## 风险
- `sftp.rename` 会修改远程文件系统路径，必须保持远程操作每次确认。
- 真实执行依赖用户本机 OpenSSH、网络、凭据和远端权限；本切片只负责受控调用、确认和审计。
- 示例入口只能用于演示受控确认流程，用户批准真实 Tauri 调用时会改动目标远程路径。



