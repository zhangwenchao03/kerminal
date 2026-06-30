---
id: PLAN-20260617-000002-ai-remote-host-create-tool
status: done
created_at: 2026-06-17T00:00:02+08:00
started_at: 2026-06-17T00:00:02+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI remote_host.create 受控创建远程主机

## 状态
- Done：代码实现、自动化验证和 `1425` 浏览器烟测已完成。

## 目标
- 让 AI 通过 Tool Registry 中的 `remote_host.create` 在用户批准后创建 SSH 远程主机配置。
- 复用现有 `RemoteHostService` 写入 SQLite，凭据只接受 `credentialRef`，不接收明文密码、私钥或 passphrase。
- 前端 AI 面板提供中文“准备主机”演示入口，批准成功后刷新左侧主机树并显示审计。
- 浏览器预览和真实 Tauri 环境都保持可用，浏览器验收端口使用 `http://127.0.0.1:1425/`。

## 非目标
- 本切片不建立真实 SSH 连接，不测试凭据是否可用。
- 不新增远程主机编辑、删除、导入 SSH config 或凭据录入 UI。
- 不实现 Rig Agent 自动决策对话流，只接入受控工具执行链路。

## 影响范围
- Rust AI 工具调用服务：`src-tauri/src/services/ai_tool_invocation_service.rs`
- Rust Tool Registry schema：`src-tauri/src/services/tool_registry_service.rs`
- Tauri command wiring：`src-tauri/src/commands/ai.rs`
- 远程主机模型和服务复用：`src-tauri/src/models/remote_host.rs`、`src-tauri/src/services/remote_host_service.rs`
- 前端 AI 面板与浏览器预览：`src/features/tool-panel/AiToolContent.tsx`、`src/lib/aiToolInvocationApi.ts`
- Shell/ToolPanel 刷新链路：`src/app/KerminalShell.tsx`、`src/features/tool-panel/ToolPanel.tsx`
- 测试：Rust AI 工具测试、AI 面板测试、browser preview API 测试、Shell 组合测试
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 扩展 `remote_host.create` schema，覆盖 `authType`、`credentialRef`、`tags`、`production`。
- [x] 在 Rust AI 执行器中解析并校验 `groupId/name/host/port/username/authType/credentialRef/tags/production`。
- [x] 调用 `RemoteHostService::create_host`，批准成功后写入审计；拒绝和失败路径不得写主机。
- [x] 把 `credentialRef` 纳入参数摘要脱敏，避免审计暴露过多凭据定位信息。
- [x] 前端 AI 面板新增“准备主机”入口，批准成功后刷新远程主机树。
- [x] 浏览器预览支持 `remote_host.create` 标题、摘要和结果文本。
- [x] 补齐 Rust/React 单元测试和 Shell 组合测试。
- [x] 更新产品计划当前事实与切片状态。

## 验证
- 已通过：`cd src-tauri && cargo fmt`
- 已通过：`cd src-tauri && cargo test --test ai_tool_invocation_service`
- 已通过：`npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/app/KerminalShell.test.tsx`
- 已通过：`npm run check`
- 已通过：in-app browser `http://127.0.0.1:1425/` 烟测，中文 AI 面板存在“准备主机”，批准后出现远程主机审计摘要，控制台无 error，页面无 “Next Terminal” 文案。

## 风险
- 远程主机配置属于本地 SQLite 写操作，必须保留用户批准和审计。
- 生产主机标记会影响后续远程风险策略，本切片只保存标记，不放宽执行权限。
- `credentialRef` 不能被误当作明文凭据写入 UI 或审计。



