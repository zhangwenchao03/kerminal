---
id: PLAN-20260617-000016-ai-workspace-split-tool
status: done
created_at: 2026-06-17T00:00:16+08:00
started_at: 2026-06-17T00:00:16+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 工作区分屏工具接入

## 状态

- Done，2026-06-17

## 目标

- 将 Tool Registry 中已有的 `workspace.split_pane` 接入 AI Tool Invocation Gateway。
- 用户在 AI 面板中批准该工具后，当前工作区立刻执行左右/上下分屏，且保留 SQLite 审计记录。
- 前端只接收 Rust 白名单化的 `clientAction`，不读取完整原始工具参数。

## 非目标

- 不实现真实 Rig Agent 聊天和自动决策。
- 不接入 `terminal.create`、`ssh.connect`、SFTP 或服务器信息工具 dispatch。
- 不持久化 workspace layout，不实现切 tab 或多窗口控制。

## 影响范围

- Rust model/service：为待确认工具调用增加安全的客户端动作描述，执行器支持 `workspace.split_pane`。
- React API/UI：AI 面板展示“准备分屏”动作，批准后调用工作区分屏回调。
- 测试：补充 Rust 工具调用测试、前端 API 类型/预览测试和 AI 面板交互测试。
- 文档：更新产品计划 slice 16 进展。

## 执行步骤

- [x] 新增 `AiToolClientAction` 数据模型，并在 `workspace.split_pane` prepare 阶段生成安全动作。
- [x] 后端确认执行器校验 direction，写入成功/失败审计。
- [x] 前端 API 类型和浏览器预览支持 `workspaceSplitPane` clientAction。
- [x] AI 面板新增“准备分屏”入口，批准成功后执行 `onSplitPane`。
- [x] 补充自动化测试。
- [x] 更新产品计划和本计划状态。

## 验证

- `cd src-tauri; cargo fmt`
- `cd src-tauri; cargo test --test ai_tool_invocation_service`：14 passed。
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/features/workspace/workspaceStore.test.ts`：3 files / 30 tests passed。
- `npm run check`：前端 23 files / 107 tests passed；Rust fmt、clippy、cargo test 和 Vite build passed。
- 浏览器 smoke：`http://127.0.0.1:1425/` 标题为 Kerminal，AI 面板和“准备分屏”可见，无 `Next Terminal`，console error 为空。
- 浏览器交互：点击“准备分屏”并批准后，浏览器预览工作区新增右侧分屏；console error 为空。

## 风险

- 客户端动作不能携带敏感原始参数，只能由后端白名单生成有限字段。
- 审计写入和前端执行之间存在极短时序差；当前以“Rust 批准 + 前端立即执行”作为本切片边界，后续可升级为事件驱动或事务化 client action。


