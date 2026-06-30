---
id: PLAN-20260617-000004-ai-sftp-delete-tool
status: done
created_at: 2026-06-17T00:00:04+08:00
started_at: 2026-06-17T00:00:04+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI sftp.delete 受控删除远程路径

## 状态
- Done

## 目标
- 让 AI 通过 Tool Registry 中的 `sftp.delete` 在用户批准后删除已保存 SSH 主机上的远程文件或空目录。
- 复用现有 `SftpService::delete` 和系统 OpenSSH `sftp` 链路，不新增并行 SFTP 实现。
- 将 Tool Registry 的 `sftp.delete` schema 对齐真实能力：`hostId`、`path`、可选 `directory`，不宣称递归删除。
- Rust confirm 阶段校验 `hostId`、`path`、`directory`，执行删除后写入中文审计摘要；未知主机、根目录、SFTP 失败和非法参数都落入 failed audit。
- 前端 AI 面板提供中文“删除文件”演示入口，浏览器预览可模拟破坏性确认和审计结果。
- 浏览器验收端口使用 `http://127.0.0.1:1425/`。

## 非目标
- 本切片不实现递归删除目录。
- 本切片不实现 SFTP 上传、下载、重命名、移动或文件预览的 AI dispatch。
- 不在自动化测试中连接真实 SSH/SFTP 主机或删除真实远程文件。
- 不新增右侧 SFTP 文件管理 UI，只补齐 AI 面板受控调用入口。

## 影响范围
- Rust AI 工具调用执行器：`src-tauri/src/services/ai_tool_invocation_service.rs`
- Tool Registry schema：`src-tauri/src/services/tool_registry_service.rs`
- 前端 AI API 与浏览器预览：`src/lib/aiToolInvocationApi.ts`
- 前端 AI 面板：`src/features/tool-panel/AiToolContent.tsx`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src-tauri/tests/tool_registry_service.rs`、`src/lib/aiToolInvocationApi.test.ts`、`src/features/tool-panel/AiToolContent.test.tsx`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] Tool Registry 将 `sftp.delete` 的可选参数从 `recursive` 改为 `directory`，说明为按空目录删除。
- [x] Rust `execute_tool` 接入 `sftp.delete`，调用 `SftpService::delete`。
- [x] 校验 `hostId`、`path` 和 `directory` 类型，失败转为 failed audit。
- [x] 删除成功摘要区分文件与空目录，避免泄露凭据或远端原始输出。
- [x] 前端浏览器预览支持 `sftp.delete` 的标题、破坏性风险、每次确认、full audit 和成功摘要。
- [x] AI 面板新增“删除文件”入口，默认目标当前 SSH 主机的 `/tmp/kerminal-ai-preview.tmp`。
- [x] 补齐 Rust/React/API 测试。
- [x] 更新产品总计划和本计划验证结果。

## 验证
- 已通过：`cd src-tauri && cargo fmt`
- 已通过：`cd src-tauri && cargo test --test ai_tool_invocation_service --test sftp_service --test tool_registry_service`
- 已通过：`npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/lib/toolRegistryApi.test.ts`
- 已通过：`npm run check`
- 已通过：使用 in-app browser 打开 `http://127.0.0.1:1425/`，中文 AI 面板存在“删除文件”；点击后 pending 标记为 `sftp.delete · 破坏性`，参数包含 `directory=false` 和 `/tmp/kerminal-ai-preview.tmp`；点击“拒绝”后最近审计显示“用户已拒绝执行。”；页面无 “Next Terminal” 文案且控制台无 error。

## 风险
- `sftp.delete` 是破坏性远程操作，必须保持 `destructive/always/full` 策略。
- 真实执行依赖用户本机 OpenSSH、网络、凭据和远端权限；本切片只负责受控调用、确认和审计。
- 示例入口只能用于演示受控确认流程，用户批准真实 Tauri 调用时会删除目标路径，因此文案和审计必须清楚。



