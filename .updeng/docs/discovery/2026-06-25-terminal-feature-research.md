# Kerminal 终端后续功能调研

整理时间：2026-06-25T13:08:00+08:00

## 结论

Kerminal 当前已经不是普通终端外壳，而是机器优先的远程操作工作台：Local、SSH、Docker、RDP、Telnet、Serial、分屏、命令块、SFTP、端口转发、系统观测、外部 Agent Launcher 和 MCP tools-only 边界已经形成主线。

下一阶段不建议优先继续堆连接协议或视觉皮肤。更值得补的是“上下文层”和“复盘/自动化层”：让终端知道当前 pane 在哪台机器、哪个目录、刚跑了什么、结果如何、输出里有哪些文件/URL/端口/错误，并把这些对象交给右栏、搜索、命令面板、SFTP、Agent 和 workflow。

## 本地现状证据

- `README.md` 已列出当前能力：多协议主机、分屏终端、命令块、智能输入、SFTP、隧道、机器观测、容器、外部 Agent、设置个性化。
- `src/features/workspace/workspaceData.ts` 的右栏工具仍是固定列表：`agentLauncher`、`system`、`sftp`、`ports`、`snippets`、`logs`、`settings`，没有随焦点 pane 自动汇总的 `context` 工具。
- `src/features/workspace/types.ts` 的 `TerminalPane` 有 `currentCwd`、`lines`、`outputHistory`，但没有 artifacts、exit code、duration、last command status 等复盘字段。
- `src/features/terminal/terminalCommandBlocks.ts` 的命令块记录 `command`、`output`、`collapsed`、marker 等，适合导航和复制，但还没有结构化状态。
- CodeGraph 搜索未发现 `CommandPalette` 或 `OpenQuickly`，说明统一对象搜索和统一动作入口尚未落地。
- `.updeng/docs/reports/otty-ui-research-kerminal-implementation-20260625.md` 已形成 Otty-inspired Context Workspace 方向，和本次结论一致。

## 外部观察

| 产品/方向 | 可借鉴点 | 对 Kerminal 的启发 |
| --- | --- | --- |
| Warp | Blocks、AI、team/workflows、command-oriented terminal | Kerminal 已有命令块，但还应补 exit status、duration、rerun、send-to-agent、artifact 汇总 |
| Wave Terminal | 工作区、AI、web/widgets、文件/预览对象化 | 右栏不要只是工具抽屉，应变成当前 pane 的上下文 inspector |
| WezTerm | tabs/panes、mux、SSH domains、可配置命令面板 | Kerminal 可以补真 session resilience 和统一 command palette，但保持机器优先 |
| iTerm2 / VS Code terminal | Shell integration、marks、command decorations、CWD/command 状态 | 通过 shell integration 让命令块从启发式走向可复盘数据 |
| Windows Terminal | Command Palette、actions、profiles | 用 action registry 收敛右键菜单、工具栏、快捷键和命令面板 |
| MobaXterm / Tabby / Termius | SSH/SFTP/tunnel/session profiles | Kerminal 已覆盖远程工具箱主干，差异点应转向上下文联动和 agent 协作 |

参考来源：

- Warp Docs: https://docs.warp.dev/
- Wave Terminal Docs: https://docs.waveterm.dev/
- WezTerm Docs: https://wezterm.org/
- iTerm2 Shell Integration: https://iterm2.com/documentation-shell-integration.html
- VS Code Terminal Shell Integration: https://code.visualstudio.com/docs/terminal/shell-integration
- Windows Terminal Command Palette: https://learn.microsoft.com/windows/terminal/command-palette
- MobaXterm Features: https://mobaxterm.mobatek.net/features.html
- Tabby: https://github.com/Eugeny/tabby
- Termius Features: https://termius.com/features

## 推荐优先级

### P0：Context Inspector

新增右栏 `Context` 工具，默认跟随 focused pane，聚合：

- 当前目标：host/container/local、连接状态、production 标记、cwd、profile、shell。
- 最近命令：命令、耗时、退出码、输出摘要。
- 输出对象：文件路径、URL、端口、日志路径、git diff、错误关键词。
- 快速动作：打开 SFTP 到 cwd、复制目标信息、发送选区/命令块到 Agent、打开端口工具、生成诊断包。

价值：用户不再先想“我要打开哪个工具”，而是先看“当前终端上下文里有什么可操作对象”。

最小切片：先做纯 `workspaceContextModel`，只读 active tab、focused pane、selected machine、cwd、output history 和 command blocks。

### P0：Shell Integration 版命令块

当前命令块主要来自输入捕获和 marker，已能导航长输出。下一步应引入可选 shell integration：

- command start/end、exit code、duration、cwd、git branch。
- prompt boundaries 更稳定，减少 vim/less/top/tmux 等 alternate buffer 场景误判。
- 支持命令块状态：running/success/failed/interrupted。
- 支持 rerun、copy command、copy clean output、copy as incident note。

价值：这是 Context Inspector、workflow、agent handoff 和复盘能力的基础数据。

### P0：Open Quickly + Command Palette

拆成两个入口：

- Open Quickly：搜对象，host/tab/pane/cwd/path/history/snippet/workflow/agent session。
- Command Palette：搜动作，split/close/rename/open SFTP/open port/create tunnel/run snippet/open settings/theme/diagnostics。

价值：Kerminal 已有很多能力，但入口分散在左栏、右栏、右键菜单和设置里；统一入口会显著降低复杂度。

约束：危险动作只打开现有确认 UI，不直接执行；provider lazy、可取消，不扫远端大目录。

### P0：Terminal Artifacts

在 output history 和命令块尾部做轻量 detector：

- URL、OSC 8 hyperlink。
- 本地/远端路径、日志文件、压缩包、配置文件。
- `localhost:port`、远端监听端口、常见服务 URL。
- git diff、test failure、stack trace、Rust/TypeScript compile error。

价值：把“终端输出”变成可点击对象，联动 SFTP、编辑器预览、Agent、端口转发和日志工具。

约束：不能阻塞 xterm 写入路径；先做异步/增量检测。

### P1：Agent Task Monitor

围绕现有外部 Agent Launcher 补状态层，而不是恢复内置 AI：

- tab/pane 上的 agent badge。
- prompt queue 和 waiting-for-user 状态。
- send selection / send command block / send context bundle to agent。
- agent session history、fork/branch entry、resume stale binding。

价值：符合 Kerminal MCP tools-only 边界，同时让 Agent 协作从“打开一个外部 CLI”升级为“和当前终端上下文绑定的任务”。

### P1：Recipes / Layout Snapshot

把当前工作台保存成可复用 recipe：

- 机器、tab、pane split layout。
- 每个 pane 的 cwd/profile/shell。
- snippets/workflows 引用。
- 手工命令序列和风险标记。

首版只支持预览和人工触发，不自动回放破坏性命令。

### P1：Session Replay / Incident Note

基于命令块、输出摘要、系统观测和 SFTP/port/agent 操作日志，生成可审阅复盘：

- 按时间线展示命令、退出码、关键输出、文件传输、隧道变化。
- 一键复制 Markdown incident note。
- 支持导出诊断包，但继续脱敏敏感值。

价值：这比单纯“日志列表”更贴近排障、交接和审计。

### P2：Remote Session Resilience

当前有断线重连和 output history，但真实 PTY 仍依赖本机 app 生命周期。后续可以评估：

- tmux/screen aware attach/resume。
- 可选 Kerminal remote helper。
- SSH 连接中断后恢复远端长期任务视图。

价值：适合长任务、训练、构建、生产排障。代价是跨平台和安全边界复杂，建议独立 ADR。

### P2：Kubernetes / Pod Target

Docker 已是一等目标，下一步可考虑 Kubernetes：

- kubeconfig context/namespace/pod/container 目标。
- pod exec terminal、logs、copy file。
- 和现有 host tree、SFTP/文件、系统信息的边界要重新设计。

价值：现代远程/容器运维常见。风险是凭据、RBAC、日志量和集群上下文复杂，不适合作为下一步第一优先级。

### P2：可选安全凭据后端

README 当前明确 SSH 密码和内联私钥明文保存。为了扩大使用场景，可以提供可选 OS keychain / encrypted vault：

- 不改变现有文件优先配置口径。
- 对 production 主机给出明显安全状态提示。
- 导出/迁移时保留可审计边界。

这不是“终端爽感”功能，但会影响真实生产主机采用。

## 不建议现在做

- 恢复旧内置 AI provider、pending approval、custom MCP CRUD：和当前 MCP tools-only 产品边界冲突。
- 大而全的自动化回放：Recipes 未有风险模型前，不应默认自动执行命令。
- 大量主题/皮肤：当前主题系统已足够，优先补能力层。
- 新增更多小协议作为主线：除 Kubernetes 外，当前 Local/SSH/Docker/RDP/Telnet/Serial 覆盖已够宽。
- 远端全量索引：会制造性能和权限问题，应只做 lazy provider 和显式目录范围。

## 建议执行顺序

1. Context Model。
2. Context Inspector UI。
3. Shell Integration 命令块状态。
4. Terminal Artifacts detector。
5. Open Quickly。
6. Command Palette。
7. Agent Task Monitor。
8. Recipes / Layout Snapshot。

如果只能选一个，我建议先做 Context Inspector。它能最快把现有能力串起来，且后续所有搜索、命令面板、artifact 和 agent 功能都能复用这层上下文模型。

