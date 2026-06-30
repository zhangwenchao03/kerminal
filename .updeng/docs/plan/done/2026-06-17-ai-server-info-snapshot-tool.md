---
id: PLAN-20260617-000003-ai-server-info-snapshot-tool
status: done
created_at: 2026-06-17T00:00:03+08:00
started_at: 2026-06-17T00:00:03+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI server_info.snapshot 受控读取服务器信息

## 状态
- Done

## 目标
- 让 AI 通过 Tool Registry 中的 `server_info.snapshot` 在用户批准后读取已保存 SSH 主机的服务器信息快照。
- 复用现有 `ServerInfoService::snapshot` 和系统 OpenSSH 采集链路，不新增并行 SSH 实现。
- Rust 侧 confirm 阶段校验 `hostId`、执行只读采集、生成中文摘要并写入 SQLite 审计。
- 前端 AI 面板提供中文“读取信息”演示入口，浏览器预览可模拟批准结果。
- 浏览器验收端口使用 `http://127.0.0.1:1425/`。

## 非目标
- 本切片不实现远程命令执行、批量 SSH 或 SFTP 文件操作。
- 不新增服务器信息图表 UI，右侧系统工具面板继续使用已有实现。
- 不让 AI 绕过 Tool Registry、确认策略或审计直接执行 SSH 命令。

## 影响范围
- Rust AI 工具调用执行器：`src-tauri/src/services/ai_tool_invocation_service.rs`
- AI command 参数透传：`src-tauri/src/commands/ai.rs`
- 前端 AI API 与浏览器预览：`src/lib/aiToolInvocationApi.ts`
- 前端 AI 面板：`src/features/tool-panel/AiToolContent.tsx`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src/lib/aiToolInvocationApi.test.ts`、`src/features/tool-panel/AiToolContent.test.tsx`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] Rust confirm 接入 `server_info.snapshot`，调用现有 `ServerInfoService::snapshot`。
- [x] 校验 `hostId` 类型，并将未知主机、SSH 采集失败等错误落入 failed audit。
- [x] 结果摘要包含主机名、系统、CPU、内存和磁盘等用户可读信息，避免泄露凭据。
- [x] 前端浏览器预览支持 `server_info.snapshot` 的标题、风险、确认和结果摘要。
- [x] AI 面板新增“读取信息”入口，默认使用当前 SSH 主机或默认远程主机。
- [x] 补齐 Rust/React/API 测试。
- [x] 更新产品计划和本计划验证结果。

## 验证
- `cd src-tauri && cargo fmt`
- `cd src-tauri && cargo test --test ai_tool_invocation_service`
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx`
- `npm run check`
- 使用 in-app browser 打开 `http://127.0.0.1:1425/`，确认中文 AI 面板存在“读取信息”，批准后出现服务器信息审计摘要，页面无 “Next Terminal” 文案且控制台无 error。

验证结果（2026-06-17）：

- `cd src-tauri && cargo fmt` 通过。
- `cd src-tauri && cargo test --test ai_tool_invocation_service --test tool_registry_service` 通过，AI 工具 33 tests，Tool Registry 4 tests。
- `npm run test:frontend -- src/features/tool-panel/AiToolContent.test.tsx src/lib/aiToolInvocationApi.test.ts src/lib/toolRegistryApi.test.ts` 通过，3 files / 28 tests。
- `npm run check` 通过，前端 23 files / 118 tests，Rust fmt/clippy/test 通过，生产构建通过；Vite 仅提示 chunk size warning。
- in-app browser `http://127.0.0.1:1425/` 冒烟通过：中文 AI 面板存在“读取信息”；批准后最近审计显示“服务器信息已读取”；右侧面板 `scrollLeft` 保持 0；页面无 “Next Terminal” 文案；console error 为空。

## 风险
- 虽然是只读工具，但会连接远程 SSH 主机并执行采集脚本，默认保持确认策略。
- 审计摘要不能包含凭据、密钥路径或完整远端输出。
- 真实 SSH 失败取决于用户本机 OpenSSH、网络和凭据配置；本切片负责把失败转换为审计记录。



