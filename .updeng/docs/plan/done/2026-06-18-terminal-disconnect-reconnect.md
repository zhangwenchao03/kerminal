---
id: PLAN-20260618-000039-terminal-disconnect-reconnect
status: done
created_at: 2026-06-18T00:00:39+08:00
started_at: 2026-06-18T00:00:39+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 终端断开与重连

## 目标

- 在终端右键菜单中提供“断开连接”和“重新连接”。
- 用户主动断开当前分屏后，后端会话被关闭、pane 保留在工作台中，并展示中文断开状态。
- 用户可在同一 pane 上重新创建本地或 SSH 会话，复用原本的 shell/cwd/env/profile/remoteHostId 参数。

## 非目标

- 不实现进程保活、tmux/durable session 或应用重启后的会话恢复。
- 不新增 Rust command；优先复用现有 `terminal_close`、本地/SSH session create 链路。
- 不实现原生系统菜单，本切片仅处理 xterm 区域右键菜单。

## 影响范围

- 前端终端 pane：`src/features/terminal/XtermPane.tsx`
- 右键菜单：`src/features/terminal/TerminalContextMenu.tsx`
- 前端测试：`src/features/terminal/XtermPane.test.tsx`、`src/features/terminal/TerminalContextMenu.test.tsx`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤

- [x] 让 `XtermPane` 把会话创建逻辑封装为可重复调用的 start/reconnect 流程。
- [x] 实现断开流程：关闭当前 session、注销 pane registry、清理日志状态、显示“已断开”。
- [x] 实现重连流程：清理旧状态，在同一 xterm 中重新创建本地/SSH session，并重新注册 registry。
- [x] 在 `TerminalContextMenu` 增加中文“断开连接”和“重新连接”动作与图标。
- [x] 补充组件测试，覆盖菜单动作、本地断开/重连、SSH 重连参数。
- [x] 更新产品计划中 slice 19 的完成状态描述。

## 验证

- `npm run test:frontend -- XtermPane TerminalContextMenu`：通过，2 个测试文件、20 个测试通过。
- `npm run check`：通过，28 个前端测试文件、187 个前端测试通过；Rust fmt/clippy/test 通过；生产构建通过。
- 浏览器 smoke：`http://127.0.0.1:1425/` 通过；右键菜单显示“断开连接/重新连接”，断开后状态为“已断开”，重连后回到“已连接”，控制台错误为空。
- `rg "Next Terminal|next terminal|NextTerminal" .`：无匹配。

## 风险

- React effect 重新创建 xterm 或 session 时容易重复关闭会话；实现中需要用 ref 管理当前 session，并确保 cleanup 与用户主动断开不互相覆盖。
- SSH 重连只是重新发起系统 OpenSSH 会话，不保证远端进程恢复；这是本切片明确非目标。



