# ADR-0001: 终端产品技术栈与架构边界

## 状态

Accepted，部分事实已被 [ADR-0016](ADR-0016-file-first-storage-and-external-codex-workdir.md)、[ADR-0017](ADR-0017-external-agent-launcher-and-mcp-only.md) 和 [ADR-0018](ADR-0018-agent-session-workspace-and-terminal-restore.md) supersede。

## 当前事实提示

- 存储事实源已经从早期单一 `~/.kerminal/kerminal.db` 改为文件优先配置目录 + 命令域 SQLite；当前有效 SQLite 是 `~/.kerminal/data/command.sqlite`，旧 `kerminal.db` 不再作为运行时事实源。
- AI 方向已经从内置 AI provider / conversation / Tool Registry 收敛为外部 Agent Launcher + Kerminal MCP tools-only server；不要按本文早期 “AI Tool Registry” 描述新增代码。
- SSH 密码和内联私钥当前按产品口径随主机记录明文保存和展示；不要按本文早期 keychain/credential-ref 方案恢复兼容层。

## 背景

Kerminal 当前是 Tauri 2 + React 19 + Vite + TypeScript 模板项目。用户确认产品目标是多平台可用的日常开发终端，同时具备 AI、SSH、SFTP、端口转发、分屏、批量命令、配置管理和工具面板能力。所有持久化内容统一放在 `~/.kerminal`，配置和业务数据使用 SQLite。

终端产品涉及高频输入输出、系统进程、伪终端、远程连接、凭据、安全权限、主题和 AI 工具调用，必须明确 Rust/React 分工和核心依赖。

## 决策驱动因素

- 多平台：Windows、macOS、Linux 都是产品目标。
- 终端正确性：需要支持交互式 shell、全屏程序、ANSI/VT 控制、resize、Ctrl+C、鼠标模式。
- 远程能力：SSH、SFTP、端口转发进入第一大版本范围。
- AI 控制：AI 能操作终端、SSH/SFTP、设置、主题、片段、工作区和应用工具；Agent 编排采用 Rig，功能调用采用 rmcp，但必须经过 Kerminal 统一工具层、权限和审计。
- 安全：shell、SSH、凭据、LLM API key、AI 上下文都属于高风险边界。
- 可维护性：不能在 React 中直接管理系统进程，也不应自研终端渲染器。
- 性能：终端输出是高频流，IPC 和 React rerender 必须克制。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| React 使用 `@xterm/xterm`，Rust 使用 `portable-pty` | 生态成熟；实现速度快；适合 Tauri；可扩展 SSH/AI | 渲染性能受 WebView 和 xterm 限制 | 大输出性能需要实测 | 本地 shell、vim/less、resize、大输出 smoke test |
| Rust 自研原生 GPU 终端渲染 | 性能上限高；更接近 Ghostty/Alacritty | 成本极高；需要实现 ANSI/VT、字体、输入法、平台窗口 | 长期维护风险大 | 需要长期原型，不适合当前阶段 |
| 只用 `tauri-plugin-shell` 执行命令 | 简单；适合一次性命令 | 不是真交互式 PTY，无法完整支持 vim/tmux/top | 产品能力被限制 | 运行全屏程序会暴露问题 |
| 前端伪终端模拟，不启动真实 shell | 可做 demo | 不是终端产品 | 无法满足用户目标 | 不采用 |

## 决策

采用“React xterm 渲染 + Rust portable-pty 会话管理 + Tauri Command/Channel IPC + SQLite 本地存储 + AI Tool Registry”的架构。

具体决策：

- 终端渲染：使用 `@xterm/xterm`。
- xterm 插件：优先引入 `addon-fit`、`addon-search`、`addon-web-links`、`addon-unicode11`；`addon-serialize` 作为缓冲区持久化候选。
- 本地 PTY：使用 `portable-pty`，由 Rust 管理 shell 进程生命周期。
- IPC：前端控制动作使用 Tauri Command；终端输出优先使用 Tauri Channel 或事件流，避免轮询。
- 状态分工：Rust 持有 session/process/credential/storage/tool registry 状态；React 持有 tab/pane/layout/selection/UI 状态。
- 持久化：使用 SQLite，主库位于 `~/.kerminal/kerminal.db`。
- 数据目录：所有可持久化内容统一归入 `~/.kerminal`，包括 db、logs、cache、themes、snippets、exports、diagnostics。
- 凭据：SSH 密码、私钥 passphrase、LLM API key 默认使用 OS keychain 或本地加密存储；SQLite 只存 credential ref。
- SSH/SFTP：SSH terminal、SFTP、端口转发进入第一版；底层库先做 spike，候选包括 `russh`、libssh2 绑定和受控系统 `ssh`。
- AI：AI 操作应用能力通过 Rig Agent、rmcp 工具层和内部 Tool Registry；控制平面见 [ADR-0002](ADR-0002-ai-agent-control-plane.md)，框架实现见 [ADR-0003](ADR-0003-ai-agent-framework-rig-rmcp.md)。

## 影响

正向影响：

- 可以从模板快速进入真实终端工作台能力。
- Rust/React 边界清晰，系统和安全能力集中在 Rust。
- SQLite 和 `~/.kerminal` 给 profile、workspace、history、remote host、AI audit 提供稳定基础。
- SSH/SFTP/AI 都能挂到同一套工具和权限模型上。

负向影响：

- WebView/xterm 的性能上限低于原生 GPU 终端，需要性能预算和大输出测试。
- SSH、SFTP、凭据、SQLite migration 和 AI tool policy 会显著增加测试矩阵。
- 第一大版本范围较完整，需要严格按垂直切片推进。

需要同步修改：

- `package.json` 添加 xterm 及插件、状态管理、图标依赖。
- `src-tauri/Cargo.toml` 添加 portable-pty、tokio、thiserror、uuid、SQLite、日志、keyring、SSH/SFTP、Rig/rmcp 相关依赖。
- `src-tauri/src` 从模板 `greet` 改为 commands/services/storage/models/security 分层。
- `src` 从模板欢迎页改为左主机树、中间终端、右工具面板的工作台布局。
- `tauri.conf.json` 后续收紧 CSP，并配置最小 Capabilities。

## 回滚或替代

- 如果 `portable-pty` 在某个平台关键场景表现不满足要求，评估平台专用 PTY 封装或更底层 Windows ConPTY / Unix PTY 方案。
- 如果 `@xterm/xterm` 性能不满足大输出或 UI 要求，先优化输出缓冲和 React 隔离；仍不满足时再评估原生渲染路线。
- 如果 `russh` 不满足 SSH/SFTP 需求，评估 libssh2 绑定或使用系统 `ssh`/`sftp` 作为受控外部进程，但后者要严格处理凭据和进程控制。
- 如果 SQLite schema 早期变化频繁，通过 migrations 和 repository 层控制，不直接在 UI 中依赖表结构。

## 验证

第一轮验证必须至少覆盖：

- `npm run build`
- `cargo fmt`
- `cargo clippy`
- `cargo test`
- `npm run tauri dev`
- `~/.kerminal` 自动创建和 SQLite migration。
- 本地 PowerShell/cmd/Git Bash/WSL/bash/zsh 交互输入输出。
- `vim`/`less`/等价全屏程序 resize。
- SSH 测试主机连接、断开、重连。
- SFTP 基础文件列表、上传、下载。
- 高频输出不卡死 UI、不丢字。
- 关闭运行中会话有确认和 kill 路径。
- 生产构建前 CSP 和 Capabilities 不保持宽松默认值。

## 资料来源

- [xterm.js](https://xtermjs.org/)
- [portable-pty docs.rs](https://docs.rs/portable-pty/latest/portable_pty/)
- [Tauri Calling Rust / Channels](https://v2.tauri.app/develop/calling-rust/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [WezTerm Features](https://wezterm.org/features.html)
- [kitty Overview](https://sw.kovidgoyal.net/kitty/overview/)
- [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro)
- [rig-core docs.rs](https://docs.rs/rig-core/0.38.2)
- [rmcp docs.rs](https://docs.rs/rmcp)
