---
id: PLAN-20260617-000022-rig-ai-terminal-context
status: done
created_at: 2026-06-17T00:00:22+08:00
started_at: 2026-06-17T00:00:22+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Rig AI 面板和 terminal context 基础切片

## 当前状态

- Done：当前终端上下文快照、AI 面板上下文预览、自动化验证和 1425 浏览器 smoke 均已完成。

## 目标

- 建立 AI 可读取的 terminal context 边界：当前 session 摘要、shell、cwd、rows/cols、运行状态和最近输出片段。
- 在 Rust 侧保留受控的终端输出 ring buffer，支持按 session 读取截断后的上下文快照。
- 新增 AI context service 和 Tauri Command，为后续 Rig Agent chat 统一提供上下文输入，不让前端直接拼接底层输出。
- 在右侧 AI 面板展示当前上下文、可用工具和上下文策略，让用户知道 AI 会看到哪些信息。

## 非目标

- 不实现真实 LLM chat/completion，不调用任何 LLM HTTP API。
- 不实现工具 dispatch、命令执行、SSH/SFTP 自动操作、审计落库或确认弹窗。
- 不把完整终端历史、环境变量、密钥或远程文件内容默认提供给 AI。

## 影响范围

- Rust 模型：新增 terminal context / AI context request、snapshot、source metadata 类型。
- Rust 服务：新增 terminal context service；扩展 terminal manager 输出缓冲与 snapshot 查询。
- Rust Command：新增 AI terminal context snapshot command。
- React API：新增 AI context API，浏览器预览模式提供中文示例上下文。
- React UI：扩展 AI 工具面板，显示当前 pane/session 上下文、最近输出、上下文限制和错误/刷新状态。
- 测试：新增 Rust service/manager 测试、前端 API 测试和 AI 面板上下文展示测试。

## 执行步骤

- [x] 扩展 terminal manager，保存 session 最近输出并支持快照读取。
- [x] 新增 AI context 模型、服务和 Tauri Command。
- [x] 前端传入当前 tab/pane/machine/session metadata，AI 面板读取并展示上下文。
- [x] 补 Rust 与 React 测试，覆盖截断、缺失 session、浏览器预览和 UI 状态。
- [x] 运行 `npm run check`，再做浏览器 smoke。

## 验证

- `cd src-tauri; cargo test --test terminal_manager --test ai_context_service`
- `npm run test:frontend -- src/lib/aiContextApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx`
- `npm run check`
- 浏览器 smoke：`http://127.0.0.1:1425/` AI 面板能看到“当前上下文”、当前 pane、最近输出预览、上下文限制和工具指标。

已执行：

- `cd src-tauri; cargo test --test terminal_manager --test ai_context_service`：8 个 Rust 目标测试通过。
- `npm run test:frontend -- src/lib/aiContextApi.test.ts src/features/tool-panel/AiToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx src/lib/terminalApi.test.ts`：4 个测试文件、21 个测试通过。
- `npm run check`：前端 22 个测试文件、96 个测试通过；Rust `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test` 通过；生产构建通过，仅保留既有 Vite chunk-size warning。
- 浏览器 smoke `http://127.0.0.1:1425/`：页面标题为 `Kerminal`；`当前上下文`、`最近输出`、`密钥脱敏开启`、`已注册`、`MCP tools`、工具风险分布可见；浏览器预览模式显示上下文说明；未出现 `Next Terminal` 文案；控制台 error 为空。

## 风险

- 终端输出可能包含敏感信息；本切片只保留有限大小 buffer，并对常见 secret/token/password 片段做基础脱敏，完整安全策略留给后续安全/审计切片。
- Rust reader thread 高频写入 buffer 不能阻塞终端输出；只做内存内截断字符串追加，不引入数据库写入。
- 前端浏览器预览没有真实 PTY；需要保留中文预览上下文，避免本地开发页面空白。


