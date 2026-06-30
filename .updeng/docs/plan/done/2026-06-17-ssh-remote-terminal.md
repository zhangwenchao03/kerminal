---
id: PLAN-20260617-000027-ssh-remote-terminal
status: done
created_at: 2026-06-17T00:00:27+08:00
started_at: 2026-06-17T00:00:27+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# SSH 远程终端切片

## 目标

- 完成产品计划第 7 切片：从已保存的 SSH 主机配置创建真实远程终端会话。
- 复用现有 xterm、Tauri Channel、输入写入、resize 和关闭链路，让远程 SSH pane 与本地终端 pane 行为一致。
- 左侧选择 SSH 主机后，右侧“主机”工具面板提供“打开 SSH”入口；打开后在中间工作区新增 SSH tab/pane。

## 非目标

- 本切片不实现 SFTP、端口转发、跳板机、主机密钥管理 UI 或凭据编辑器。
- 本切片不把密码、私钥内容或 passphrase 写入 SQLite；OpenSSH 可在终端内交互提示密码或使用系统 agent / `~/.ssh/config`。
- 本切片不做生产主机危险命令拦截；生产主机连接只展示风险标记，命令策略留给后续 AI/tool policy 与批量命令切片。

## 技术选择

- 首片采用系统 OpenSSH 客户端作为第三方成熟实现，由 Rust 构造受控 `ssh` 命令并通过 `portable-pty` 启动。
- 原因：真实交互终端、远端 PTY、密码提示、agent、OpenSSH config、known_hosts 和 resize 语义可以立即复用成熟行为。
- 边界：Rust 只拼接受控参数，不经 shell 字符串执行；不会把 credential ref 解释为明文密钥。后续 SFTP/端口转发可继续评估 `russh`、libssh2 或系统工具。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| Rust SSH 服务 | 是 | `services/ssh_terminal_service.rs` | Rust 单元/集成测试 |
| Tauri Command | 是 | `commands/ssh.rs`、`lib.rs` | Rust 编译、前端 API 测试 |
| 终端模型 | 是 | `models/terminal.rs` | Rust/TS 类型检查 |
| 前端 API | 是 | `src/lib/terminalApi.ts` | Vitest |
| 工作区状态 | 是 | `workspaceStore`、`TerminalPaneCard`、`XtermPane` | Vitest |
| 左右面板 | 是 | `MachineSidebar`、`ToolPanel`、`KerminalShell` | Vitest |

## 执行步骤

- [x] 新增 SSH 终端创建请求模型，包含 `hostId`、`rows`、`cols`。
- [x] 新增 Rust SSH terminal service：读取 host、定位 `ssh`/`ssh.exe`、构造安全参数并复用 `TerminalManager` 创建 PTY。
- [x] 注册 `ssh_create_session` Tauri Command，write/resize/close 复用现有 terminal commands。
- [x] 补 Rust 测试：命令构造、未知 host、生产/普通主机参数不泄露 credential ref。
- [x] 扩展前端 terminal API，支持 `createSshTerminalSession` 和浏览器预览 mock。
- [x] 扩展 workspace store：选中 SSH 主机后可创建 SSH tab/pane，pane 记录 `remoteHostId`。
- [x] 扩展 XtermPane/TerminalPaneCard：本地和 SSH 使用同一 xterm UI，不同启动函数和中文状态文案。
- [x] 改造 ToolPanel：选中 SSH 主机时提供打开 SSH 按钮，并保持右侧工具测试。
- [x] 补充 API、store、XtermPane、ToolPanel、KerminalShell 测试，保持左侧和右侧功能测试通过。
- [x] 运行 `npm run check`，并做本地页面可达验证。

## 验证

- `npm run test:frontend`
- `cargo test`
- `npm run check`
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:1420/`
- 搜索确认不引入历史占位品牌文案。

## 风险

- 当前主机可能没有 OpenSSH 客户端；Rust 命令必须返回清晰错误，前端终端 pane 要显示失败状态。
- OpenSSH 交互密码提示在终端内发生，后续仍需要 credential store 管理密码/私钥引用。
- 远程连接是网络能力，自动化测试不连接真实主机，只验证命令构造和前端调用路径。


