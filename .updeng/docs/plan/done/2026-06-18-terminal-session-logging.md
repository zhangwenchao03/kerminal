---
id: PLAN-20260618-000043-terminal-session-logging
status: done
created_at: 2026-06-18T00:00:43+08:00
started_at: 2026-06-18T00:00:43+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 终端会话日志落盘

## 目标

- 为当前终端分屏提供显式“开始记录日志 / 停止记录日志”能力。
- 日志文件由 Rust 写入 `~/.kerminal/logs/sessions/`，前端不直接操作任意文件路径。
- 右键菜单展示日志记录状态，启动后显示文件路径提示，停止后回到可再次开始状态。
- 本地终端和 SSH 终端共用同一套 session 日志能力。

## 非目标

- 不默认记录所有终端内容。
- 不把会话日志自动加入 AI 上下文或上传给 LLM。
- 不实现日志浏览器、搜索、清理策略或日志文件打开器。
- 不改变 PTY/SSH 会话创建、关闭和输出协议。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 后端接口 | 是 | `commands/terminal.rs`、`services/terminal_manager.rs`、`models/terminal.rs` | Rust 测试、clippy |
| 文件系统 | 是 | `~/.kerminal/logs/sessions/` | 临时目录集成测试 |
| 前端页面 | 是 | `terminalApi.ts`、`XtermPane.tsx`、`TerminalContextMenu.tsx` | Vitest、浏览器 smoke |
| 文档 | 是 | 产品计划、in-progress | 收口更新 |

## 执行步骤

- [x] 增加终端日志状态模型和 Tauri Commands：开始、停止、查询。
- [x] 在 `TerminalManager` 中按 session 管理日志 writer，并在 reader thread 收到输出时追加写入。
- [x] 前端 API 封装日志 commands，浏览器预览使用本地模拟状态。
- [x] 右键菜单增加“开始记录日志 / 停止记录日志”，`XtermPane` 展示记录状态和错误提示。
- [x] 补充 Rust、API、组件测试，覆盖启停、缺失会话、关闭会话清理和前端交互。
- [x] 运行 `npm run check` 和 1425 浏览器 smoke。
- [x] 更新长期产品计划并从 in-progress 收口。

## 验证

- `npm run test:frontend -- terminalApi XtermPane TerminalContextMenu`：通过，3 个测试文件、23 个用例通过。
- `cd src-tauri && cargo test --test terminal_manager`：通过，6 个集成用例通过，包含日志写入文件验证。
- `npm run check`：通过，包含 28 个前端测试文件、184 个前端用例、Rust fmt/clippy/test 和生产构建。
- 浏览器 smoke：`http://127.0.0.1:1425/` 通过；右键菜单可开始记录日志，显示“记录中”和日志提示，再次右键可停止记录并显示停止提示，控制台错误为 `[]`。
- 命名回归：`rg "Next Terminal|next terminal|NextTerminal" .` 无匹配。

## 风险

- 终端输出可能包含敏感内容；本能力必须由用户显式开启，并且长期策略里继续保留默认不记录终端内容。
- 日志写入错误不会阻塞终端输出；本轮先保证启停和文件落盘路径，后续可增加更细的运行时写入错误事件提示、日志浏览器和清理策略。


