---
id: PLAN-20260618-000009-ai-port-forward-create-tool
status: done
created_at: 2026-06-18T00:00:09+08:00
started_at: 2026-06-18T00:00:09+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 受控创建端口转发

## 目标
- 将 `port_forward.create` 从“仅登记工具目录”补齐为 AI Tool Invocation Gateway 可受控执行的远程工具。
- 复用现有 `PortForwardService::create`，批准后创建 local、remote 或 dynamic SSH 端口转发，并写入 AI 工具审计。
- 在右侧 AI 面板加入中文“准备转发”入口，浏览器预览也能展示正确的工具标题、风险和结果摘要。

## 非目标
- 本次不实现 AI 关闭端口转发、批量创建转发或自动选择端口。
- 本次不绕过现有端口转发服务，不新增另一套 SSH 进程管理。
- 自动化测试不批准真实可启动的端口转发，避免测试环境启动外部 SSH 长进程。

## 影响范围
- Rust 工具目录：`src-tauri/src/services/tool_registry_service.rs`
- Rust AI 受控执行器：`src-tauri/src/services/ai_tool_invocation_service.rs`
- Tauri AI command 执行上下文：`src-tauri/src/commands/ai.rs`
- 前端 AI 面板与浏览器预览：`src/features/tool-panel/AiToolContent.tsx`、`src/lib/aiToolInvocationApi.ts`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src/features/tool-panel/AiToolContent.test.tsx`、`src/lib/aiToolInvocationApi.test.ts`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 修正 `port_forward.create` schema，使字段与 `PortForwardCreateRequest` 对齐：`hostId`、`kind`、`sourcePort`、可选 `name`、`bindHost`、`targetHost`、`targetPort`。
- [x] 将 `PortForwardService` 注入 AI 工具执行上下文。
- [x] 在 AI 受控执行器中解析 `port_forward.create` 参数、调用 `PortForwardService::create`、生成不含凭据的中文审计摘要。
- [x] 增加 Rust 回归测试，覆盖 prepare 策略、未知主机失败、无效参数失败和用户拒绝不创建会话。
- [x] 增加 AI 面板“准备转发”按钮和浏览器预览标题、风险、结果摘要。
- [x] 增加前端组件/API 测试，覆盖准备参数、远程风险和浏览器预览摘要。
- [x] 更新产品计划中的当前事实和切片状态。
- [x] 运行窄测试和 `npm run check`，最后用 `http://127.0.0.1:1425/` 做浏览器 smoke。

## 验证
- `cd src-tauri && cargo test --test ai_tool_invocation_service port_forward`：4 passed。
- `npm run test:frontend -- AiToolContent aiToolInvocationApi`：2 files passed，57 tests passed。
- `npm run check`：通过，覆盖 32 个前端测试文件、Rust fmt/clippy/test 和生产构建；Vite 大 chunk 警告仍为非阻塞。
- 浏览器 smoke：`http://127.0.0.1:1425/`，标题 `Kerminal`，中文 AI 面板、`MCP 本地清单`、`准备转发` 可见，`Next Terminal` 不存在，console error 0。

## 风险
- `PortForwardService::create` 会启动真实 OpenSSH 子进程；测试只覆盖失败前置校验和拒绝路径，真实主机成功路径留给人工验收。
- 端口转发属于远程网络能力，仍保持 `remote/always/summary` 策略，后续若支持 auto remote 必须受 AI 安全设置控制。
- 审计摘要必须只包含主机名、转发方向、端口和目标，不记录 credential ref、密码或密钥路径。



