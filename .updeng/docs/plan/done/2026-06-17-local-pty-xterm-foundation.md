---
id: PLAN-20260617-000018-local-pty-xterm-foundation
status: done
created_at: 2026-06-17T00:00:18+08:00
started_at: 2026-06-17T00:00:18+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 本地 PTY 与 xterm 基础切片

## 状态

- 状态：Completed
- 完成时间：2026-06-17

## 目标

- 用第三方框架建立本地终端的第一条真实链路：Rust `portable-pty` 启动本地 shell，前端 `@xterm/xterm` 渲染和输入，Tauri Channel 推送输出。
- 保持代码模块化：Rust 按 `commands/`、`services/`、`models/` 拆分，React 按 API 层、终端组件和测试拆分。
- 保留现有中文工作台布局、左侧主机列表、右侧工具面板和一键质量入口。

## 非目标

- 本切片不做 SSH、SFTP、端口转发、历史持久化、AI 操作终端或完整 profile 管理。
- 本切片不实现终端分屏拖拽布局和会话恢复，只为后续 tab/pane 接真实 session 留出接口。
- 本切片不实现完整 shell integration、命令块、图片协议或高阶终端菜单。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| Rust 后端接口 | 是 | `src-tauri/src/commands/terminal.rs` | `cargo test`、`cargo clippy` |
| Rust 服务 | 是 | `src-tauri/src/services/terminal_manager.rs` | 独立 Rust 测试 |
| Rust 模型 | 是 | `src-tauri/src/models/terminal.rs` | serde/状态测试 |
| 前端页面 | 是 | `src/features/terminal/*` | Vitest、浏览器验证 |
| 前端 API | 是 | `src/lib/terminalApi.ts` | API mock 测试 |
| 数据库 | 否 | 暂不写入 schema | 已有 storage 测试保持通过 |
| 权限/审计 | 否 | 后续安全切片补齐 | 本切片不扩大 Tauri 插件权限 |
| 文档/计划 | 是 | 本文件、`in-progress.md` | 完成时清理进行中 |

## 执行步骤

- [x] 选择并安装依赖：Rust `portable-pty`、`uuid`；前端 `@xterm/xterm`、`@xterm/addon-fit`。
- [x] Rust 新增 `models/terminal.rs`，定义 session 创建参数、resize 参数、输出事件和状态摘要。
- [x] Rust 新增 `services/terminal_manager.rs`，管理 session 生命周期、writer、child、reader thread 和关闭清理。
- [x] Rust 新增 `commands/terminal.rs`，提供 `terminal_create_session`、`terminal_write`、`terminal_resize`、`terminal_close`、`terminal_list_sessions`。
- [x] `AppState` 持有 `TerminalManager`，`lib.rs` 注册 command handler。
- [x] 前端新增 `src/lib/terminalApi.ts`，封装 Tauri invoke 和 Channel，不在组件里散落 command 名。
- [x] 前端新增 `XtermPane` 或等价组件，负责 xterm 生命周期、输入、resize 和清理。
- [x] `TerminalWorkspace` 接入真实终端 pane，同时保留静态 preview 的降级状态。
- [x] 补充 Rust 测试：参数校验、session registry、写入/关闭错误边界；能稳定运行的 PTY smoke test 只覆盖轻量命令。
- [x] 补充 React 测试：xterm pane 初始化、输入调用 API、输出写入、unmount 清理；现有左/右/工作台测试保持通过。
- [x] 运行 `npm run check`，并在 `http://127.0.0.1:1420/` 做页面验证。

## 验证

- `npm run test:frontend`：通过，7 个测试文件、18 个测试。
- `npm run check:rust`：通过，包含 `cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`、12 个 Rust 测试。
- `npm run build`：通过；Vite 提示主 chunk 超过 500 kB，后续可按终端组件动态加载优化。
- `npm run check`：通过，作为当前一键质量入口。
- 浏览器只读验证：`http://127.0.0.1:1420/` 标题为 Kerminal，可见本地终端和工具区，无旧品牌文案，console error 为空。

## 风险

- `portable-pty` 在 Windows/macOS/Linux 的默认 shell 行为不同，需要统一默认 shell 探测并允许后续 profile 覆盖。
- 终端输出高吞吐可能压垮 React 渲染，组件必须让 xterm 直接写 DOM，避免把每行输出存进 React state。
- PTY reader thread 和 child 生命周期需要可关闭，避免应用退出或关闭 pane 后残留进程。
- 测试环境里真实 PTY 可能受 CI/Windows shell 限制，测试需把纯 registry 逻辑和真实 PTY smoke 分层。


