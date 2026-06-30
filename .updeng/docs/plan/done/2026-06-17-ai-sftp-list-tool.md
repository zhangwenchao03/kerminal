---
id: PLAN-20260617-000006-ai-sftp-list-tool
status: done
created_at: 2026-06-17T00:00:06+08:00
started_at: 2026-06-17T00:00:06+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI sftp.list 受控读取远程目录

## 状态
- Done

## 目标
- 让 AI 通过 Tool Registry 中的 `sftp.list` 在用户批准后读取已保存 SSH 主机的远程目录列表。
- 复用现有 `SftpService::list_directory` 和系统 OpenSSH `sftp` 链路，不新增并行 SFTP 实现。
- Rust confirm 阶段校验 `hostId`、`path`，执行只读目录读取，生成中文摘要并写入 SQLite 审计。
- 前端 AI 面板提供中文“读取目录”演示入口，默认使用当前 SSH 主机或默认远程主机。
- 浏览器预览可模拟 `sftp.list` 的远程风险、确认策略和审计结果。
- 浏览器验收端口使用 `http://127.0.0.1:1425/`。

## 非目标
- 本切片不实现 SFTP 上传、下载、删除、重命名、移动或预览文件内容的 AI dispatch。
- 不实现远程命令执行、批量 SSH 命令或端口转发的 AI dispatch。
- 不新增右侧 SFTP 文件管理 UI，只补齐 AI 面板受控调用入口。
- 不在自动化测试中连接真实 SSH/SFTP 主机。

## 影响范围
- Rust AI 工具调用执行器：`src-tauri/src/services/ai_tool_invocation_service.rs`
- AI command 参数透传：`src-tauri/src/commands/ai.rs`
- 前端 AI API 与浏览器预览：`src/lib/aiToolInvocationApi.ts`
- 前端 AI 面板：`src/features/tool-panel/AiToolContent.tsx`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src/lib/aiToolInvocationApi.test.ts`、`src/features/tool-panel/AiToolContent.test.tsx`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] Rust `AiToolExecutionContext` 增加 `SftpService`，`ai_tool_confirm` 透传 `state.sftp()`。
- [x] `execute_tool` 接入 `sftp.list`，调用 `SftpService::list_directory`。
- [x] 校验 `hostId` 和 `path` 类型，未知主机或 SFTP 执行失败落入 failed audit。
- [x] 增加目录列表中文摘要函数，统计目录、文件、链接和最多 5 个示例条目，避免包含凭据或完整原始输出。
- [x] 前端浏览器预览支持 `sftp.list` 的标题、远程风险、每次确认和成功摘要。
- [x] AI 面板新增“读取目录”入口，默认读取当前 SSH 主机的 `/var/log`。
- [x] 补齐 Rust/React/API 测试。
- [x] 更新产品总计划和本计划验证结果。

## 验证
- `cd src-tauri && cargo fmt`
- `cd src-tauri && cargo test --test ai_tool_invocation_service --test sftp_service --test tool_registry_service`
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/lib/toolRegistryApi.test.ts`
- `npm run check`
- 使用 in-app browser 打开 `http://127.0.0.1:1425/`，确认中文 AI 面板存在“读取目录”，批准后出现远程目录审计摘要，页面无 “Next Terminal” 文案且控制台无 error。

验证结果（2026-06-17）：

- `cd src-tauri && cargo fmt` 通过。
- `cd src-tauri && cargo test --test ai_tool_invocation_service --test sftp_service --test tool_registry_service` 通过，AI 工具 36 tests，SFTP 1 test，Tool Registry 4 tests。
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/lib/toolRegistryApi.test.ts` 通过，3 files / 30 tests。
- `npm run check` 通过，前端 23 files / 120 tests，Rust fmt/clippy/test 通过，生产构建通过；Vite 仅提示 chunk size warning。
- in-app browser `http://127.0.0.1:1425/` 冒烟通过：中文 AI 面板存在“读取目录”；点击后 pending 显示 `sftp.list · 远程` 和当前 SSH 主机的 `/var/log` 参数；批准后最近审计显示“远程目录已读取”；右侧面板 `scrollLeft` 为 0；页面无 “Next Terminal” 文案；console error 为空。

## 风险
- `sftp.list` 是只读工具，但会连接远程 SSH 主机并执行 SFTP 批处理命令，默认保持 `remote/always` 确认策略。
- 真实 SFTP 成功依赖用户本机 OpenSSH、网络、凭据和远端权限；本切片负责将失败转换为审计记录。
- 摘要只能展示目录结构概览，不能把远端完整原始 `ls -la` 输出或敏感路径批量写入审计。



