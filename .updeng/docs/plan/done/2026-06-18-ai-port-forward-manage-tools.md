---
id: PLAN-20260618-000010-ai-port-forward-manage-tools
status: done
created_at: 2026-06-18T00:00:10+08:00
started_at: 2026-06-18T00:00:10+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 受控查看与关闭端口转发

## 目标
- 补齐 `port_forward.list`，让 AI 可读取当前端口转发会话摘要，用于理解已打开的 SSH 隧道。
- 补齐 `port_forward.close`，让 AI 可在用户批准后关闭指定端口转发会话，并写入审计。
- 在右侧 AI 面板加入中文“查看转发”和“关闭转发”准备入口，浏览器预览保持同等可见行为。

## 非目标
- 本次不自动选择要关闭的真实会话，不做批量关闭。
- 本次不改变 `PortForwardService` 的进程生命周期模型。
- 本次不新增持久化端口转发历史；仍以当前运行时会话为准。

## 影响范围
- Rust 工具目录：`src-tauri/src/services/tool_registry_service.rs`
- Rust AI 受控执行器：`src-tauri/src/services/ai_tool_invocation_service.rs`
- 前端 AI 面板与浏览器预览：`src/features/tool-panel/AiToolContent.tsx`、`src/lib/aiToolInvocationApi.ts`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`、`src/features/tool-panel/AiToolContent.test.tsx`、`src/lib/aiToolInvocationApi.test.ts`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 在 Tool Registry 中登记 `port_forward.list` 和 `port_forward.close`。
- [x] 在 AI 执行器中接入端口转发列表摘要和关闭动作。
- [x] 增加 Rust 测试，覆盖 list 空状态、close 确认策略、未知会话失败和拒绝路径。
- [x] 增加 AI 面板按钮和浏览器预览标题、风险、结果摘要。
- [x] 增加前端组件/API 测试，覆盖准备参数和预览结果。
- [x] 更新产品计划事实与切片 17 验收说明。
- [x] 运行窄测试、`npm run check` 和 `http://127.0.0.1:1425/` 浏览器 smoke。

## 验证
- `cd src-tauri && cargo test --test ai_tool_invocation_service port_forward`
- `npm run test:frontend -- AiToolContent aiToolInvocationApi`
- `npm run check`
- 浏览器 smoke：`http://127.0.0.1:1425/`，确认中文 AI 面板、`查看转发`、`关闭转发`、`MCP 本地清单` 可见，且没有 `Next Terminal`。

结果（2026-06-18）：

- `cargo test --test ai_tool_invocation_service port_forward`：9 passed。
- `npm run test:frontend -- AiToolContent aiToolInvocationApi`：2 files / 61 tests passed。
- `npm run check`：32 frontend test files / 228 tests passed，Rust fmt/clippy/test passed，Vite production build passed。
- 浏览器 smoke `http://127.0.0.1:1425/`：`Agent 控制`、`MCP 本地清单`、`查看转发`、`关闭转发` 可见，`Next Terminal` 不存在，console error 0。

## 风险
- `port_forward.close` 会终止本地 OpenSSH 转发子进程，可能中断用户正在使用的隧道，因此保持 `remote/always/summary` 策略。
- `port_forward.list` 是只读工具，可以自动执行，但摘要不能暴露凭据引用或密钥路径。



