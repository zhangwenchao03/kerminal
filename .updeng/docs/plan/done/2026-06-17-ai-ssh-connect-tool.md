---
id: PLAN-20260617-000011-ai-ssh-connect-tool
status: done
created_at: 2026-06-17T00:00:11+08:00
started_at: 2026-06-17T00:00:11+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI ssh.connect 受控打开 SSH 终端

## 状态
- Done

## 目标
- 让 AI 通过 Tool Registry 中的 `ssh.connect` 在用户批准后打开已保存 SSH 主机终端。
- 复用现有工作区 `openSshTerminal(hostId)` 和真实 SSH pane 生命周期，不在 AI 执行器里直接启动 SSH 子进程。
- Rust 侧在 prepare 阶段生成白名单化 `clientAction`，confirm 阶段写入 SQLite 审计。
- 前端 AI 面板提供中文“准备 SSH”演示入口，批准成功后打开 SSH tab。
- 浏览器预览保持可用，验收端口使用 `http://127.0.0.1:1425/`。

## 非目标
- 本切片不实现 AI 自动选择主机的 Rig 对话流。
- 不执行远程命令、不做批量 SSH、不读取服务器状态。
- 不新增 SSH 凭据录入、连接测试或失败重试 UI。

## 影响范围
- Rust AI 工具调用模型与执行器：`src-tauri/src/models/ai_tool_invocation.rs`、`src-tauri/src/services/ai_tool_invocation_service.rs`
- Tool Registry：`src-tauri/src/services/tool_registry_service.rs`
- 前端 AI API 与面板：`src/lib/aiToolInvocationApi.ts`、`src/features/tool-panel/AiToolContent.tsx`
- ToolPanel/Shell 透传：`src/features/tool-panel/ToolPanel.tsx`、`src/app/KerminalShell.tsx`
- 测试：Rust AI 工具集成测试、AI 面板测试、browser preview API 测试、Shell/workspace 行为测试
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 扩展 `AiToolClientActionKind` 和 `AiToolClientAction`，支持 `sshConnect` 与 `hostId`。
- [x] Rust prepare 校验 `ssh.connect` 的 `hostId/cols/rows`，返回安全 clientAction。
- [x] Rust confirm 记录成功审计，说明客户端将打开 SSH 终端。
- [x] 前端批准后调用 `openSshTerminal(hostId)`，并提供“准备 SSH”入口。
- [x] 浏览器预览支持 `ssh.connect` 标题、clientAction、结果摘要。
- [x] 补齐 Rust/React 测试。
- [x] 更新产品计划和本计划验证结果。

## 验证
- `cd src-tauri && cargo fmt`
- `cd src-tauri && cargo test --test ai_tool_invocation_service`
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/features/workspace/workspaceStore.test.ts src/app/KerminalShell.test.tsx`
- `npm run check`
- 使用 in-app browser 打开 `http://127.0.0.1:1425/`，确认中文 AI 面板存在“准备 SSH”，批准后打开 SSH 终端 tab，页面无 “Next Terminal” 文案且控制台无 error。

验证结果（2026-06-17）：

- `cd src-tauri && cargo fmt` 通过。
- `cd src-tauri && cargo test --test ai_tool_invocation_service` 通过，30 tests。
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/features/workspace/workspaceStore.test.ts src/app/KerminalShell.test.tsx` 通过，4 files / 41 tests。
- `npm run check` 通过，前端 23 files / 116 tests，Rust fmt/clippy/test 通过，生产构建通过；Vite 仅提示 chunk size warning。
- in-app browser `http://127.0.0.1:1425/` 冒烟通过：中文 AI 面板存在“准备 SSH”；批准后新增并选中 `armbian x2` SSH tab；最近审计显示“SSH 终端已批准打开，浏览器预览已模拟创建远程 tab。”；页面无 “Next Terminal” 文案；console error 为空。

## 风险
- 这是远程连接动作，默认保持 `remote/always` 确认策略。
- 客户端动作必须只携带已保存 `hostId`，不能接受临时 host/user/password。
- 真实连接失败由现有 SSH pane 生命周期展示，本切片只负责受控打开入口和审计。



