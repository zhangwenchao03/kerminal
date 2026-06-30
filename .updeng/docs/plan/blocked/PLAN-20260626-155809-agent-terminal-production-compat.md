---
id: PLAN-20260626-155809-agent-terminal-production-compat
status: blocked
created_at: 2026-06-26T15:58:09+08:00
started_at: 2026-06-26T16:12:36+08:00
completed_at:
updated_at: 2026-06-29T19:00:00+08:00
owner: ai
lane: lane-agent-terminal-production-compat
---

# 右栏 Agent 终端生产级兼容计划

## 目标

- 右栏 Agent Launcher 打开的 Codex、Claude 和自定义 Agent CLI，必须像在系统终端、Ghostty、iTerm2、Windows Terminal 或普通 Kerminal 中间终端里启动一样可用。
- Shift+Enter 在 Codex/Claude prompt 中默认可换行；Ctrl+J 保持可用；Enter 仍发送消息；Ctrl+C、Esc、Tab、Shift+Tab、方向键、Alt/Meta、复制粘贴、鼠标、IME、alternate screen 和 resize 都不被 Kerminal 周边 UI 破坏。
- Agent 继续运行在真实 PTY 中。Kerminal 只提供终端、session workspace、MCP tools-only endpoint 和必要的会话管理；默认打开后必须像在 PowerShell/cmd/Windows Terminal/macOS Terminal 里直接运行 Agent CLI，不显示第二套 prompt 输入框、发送按钮或队列工具条。
- 形成可自动化和可人工复验的兼容矩阵，后续每次改 xterm、快捷键、右栏布局、Agent Launcher 或 Tauri shell 启动链路都能回归。

## 非目标

- 不重新实现原生 GPU 终端渲染器；当前仍以 React `@xterm/xterm` + Rust `portable-pty` 为基础。
- 不恢复旧内置 AI conversation、provider、approval、audit、custom MCP CRUD 或 skills 配置 UI。
- 不把 Agent TUI 改成 Kerminal 自己的聊天框；外部 composer / prompt queue 不能出现在默认 Agent 终端主界面。若后续保留，只能作为显式打开的高级/命令面板能力，并且只能 paste/send 到真实终端，不能替代真实终端输入。
- 不在第一阶段承诺自动执行 destructive prompt queue；涉及运行命令仍由外部 Agent host 和用户确认策略承担。

## 当前事实

- 右栏 Agent 终端由 `src/features/tool-panel/AgentLauncherToolContent.tsx` 内的 `AgentTerminalView` 嵌入 `XtermPane` 实现，传入 `shellAssistEnabled={false}`。
- `XtermPane.runtime.ts` 当前通过 `terminal.onData` 把 xterm 产生的数据原样 `writeTerminal(sessionId, data)`，只在 `attachCustomKeyEventHandler` 中特殊处理粘贴快捷键。
- `@xterm/xterm` 当前版本为 `6.0.0`。本地 `node_modules/@xterm/xterm/src/common/input/Keyboard.ts` 中 `keyCode === 13` 不区分 `shiftKey`，Shift+Enter 默认仍变成 `CR`，所以 Codex/Claude 无法靠现状收到“多行换行”信号。
- `KerminalShell.tsx` 在 capture 阶段注册全局 `keydown` 快捷键。即使 xterm 聚焦，应用级快捷键仍可能先匹配并 `preventDefault`，需要建立“终端焦点优先”的让渡策略。
- Agent 启动链路已按 `PLAN-20260625-231610-agent-launch-pwsh` 完成 Windows `pwsh.exe` 优先、`powershell.exe`/`cmd.exe` fallback、session-scoped env 和权限参数插入。
- `ADR-0017` 决定外部 Agent Launcher + Kerminal MCP tools-only；`ADR-0018` 决定每 Agent session 独立工作区、session-scoped MCP 和 stale/rebind 恢复边界。
- 当前存在 active lane `lane-current-agent-sidebar-terminal-polish` 和 `lane-terminal-pane-drag-reconnect-diagnosis`，涉及 `AgentLauncherToolContent.tsx`、`XtermPane.tsx`、`XtermPane.runtime.ts`。正式实现前必须先同步这些 lane 的最新 diff 和 checkpoint。

## 外部调研结论

### Claude Code

- Claude 官方终端配置文档明确：Claude Code 有全屏 TUI、通知、换行、自动更新、主题、鼠标、paste 和 Vim mode 等终端依赖项。
- 对多行输入，官方建议先使用 `\` + Enter；若终端支持则 Shift+Enter 可用；Ctrl+J 在应用内设置为换行；iTerm2/VS Code 可配置 Shift+Enter；tmux 需要 `set -s extended-keys on` 和 xterm-keys 支持。
- 对 Kerminal 的结论：P0 不能只修 Shift+Enter。必须同时提供 Ctrl+J fallback、tmux/extended-key 说明、真实 CLI smoke，以及应用级快捷键让渡。

### Codex CLI

- Codex 官方 CLI 文档确认 `codex` 是交互式 TUI，支持 `--cd` 指定工作目录、`--full-auto` / `--dangerously-bypass-approvals-and-sandbox` 等权限模式，并可通过项目配置连接 MCP。
- Codex 社区讨论中，多行输入常见 workaround 是把 keymap 绑定到 `ctrl-j`，说明不同终端对 Shift+Enter 的编码存在差异。
- 对 Kerminal 的结论：Codex 也应优先支持 Ctrl+J 和 Shift+Enter；Shift+Enter 在 Kerminal agent 模式下可先映射为 LF，后续再按真实 CLI 行为评估 CSI-u / Kitty keyboard protocol。

### Otty

- Otty 的 Agent 方向不是把 Agent 做成内置聊天，而是让 Claude Code、Codex、OpenCode 等继续跑在终端里，同时增加 Agent composer、prompt queue、history、fork/branch、send to chat、tab badge 和任务状态。
- Otty 的 terminal docs 强调 input、selection、copy/paste、cursor/mouse、read-only、progress state、shell integration、TERM value、unicode/text styles 等完整终端特性。
- 对 Kerminal 的结论：Agent workflow 要建立在“真实终端兼容”之上。P0 修终端协议和快捷键；P1 再做 composer/queue/history/send-to-agent。

### cmux

- cmux GitHub 项目定位是面向 coding agents 的 tmux-like 多 pane 工作台，使用 libghostty 终端内核，并把 Claude Code、Codex、Gemini、Amp、OpenCode 等作为终端 Agent 进程运行。
- cmux 借助 hooks/OSC/CLI 捕获通知、completion 和 session restore，而不是自己替代 Agent TUI。
- 对 Kerminal 的结论：长期方向应把 Agent terminal、session metadata、通知和恢复分层。Kerminal 当前 WebView/xterm 栈仍可推进，但必须用真实 PTY 和协议测试证明兼容性。

参考来源：

- Claude Code terminal setup: <https://code.claude.com/docs/en/terminal-config>
- Codex CLI reference: <https://developers.openai.com/codex/cli/reference>
- Codex CLI discussion on multiline keymap: <https://github.com/openai/codex/discussions/3024>
- Otty agents overview: <https://docs.otty.sh/agents/agents-overview>
- Otty composer: <https://docs.otty.sh/agents/composer>
- Otty prompt queue: <https://docs.otty.sh/agents/prompt-queue>
- Otty send to chat: <https://docs.otty.sh/agents/send-to-chat>
- Otty custom keybindings: <https://docs.otty.sh/customization/custom-keybindings>
- cmux GitHub: <https://github.com/manaflow-ai/cmux>

## 生产级验收标准

- Shift+Enter 在右栏 Codex 与 Claude prompt 中产生换行，不发送消息；Enter 发送当前 prompt；Ctrl+J 也产生换行。
- 当右栏 Agent xterm 聚焦时，Kerminal 全局 keybinding 不抢走 Agent TUI 常用按键；只有明确的 OS/window 级保留快捷键继续按平台规则处理。
- 普通中间终端行为不回退：Enter/Shift+Enter、Ctrl+C、Ctrl+V、Shift+Insert、方向键、命令块、ghost suggestion、搜索和右键菜单仍按现有设置工作。
- 右栏 Agent 终端支持 bracketed paste、长文本 paste、中文输入法组合、鼠标选择、鼠标 reporting、alternate screen、resize、scrollback、clear screen、Ctrl+C interrupt 和 Ctrl+D EOF。
- Agent terminal 在右栏宽度不足时给出可操作路径：扩大右栏、promote 到中间 workspace tab 或打开独立窗口；至少 80x24 的可用 size 有自动检测和提示。
- Codex/Claude/custom CLI 的 cwd、env、session-scoped MCP endpoint、权限模式、resume/new session、stale target rebind 继续符合 ADR-0018。
- 完成后更新 README 或 `.updeng/docs/config/external-agent-workspace.md` 中的 Agent terminal 兼容说明和快捷键口径。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 终端输入协议 | 是 | `src/features/terminal/XtermPane.runtime.ts`、新增 `terminalKeyboardPolicy` | unit tests、真实 xterm smoke |
| 全局快捷键 | 是 | `src/app/KerminalShell.tsx`、`src/features/settings/keybindingUtils.ts` | keybinding tests、Agent focus smoke |
| Agent Launcher UI | 是 | `src/features/tool-panel/AgentLauncherToolContent.tsx` | component tests、三主题截图 |
| Agent session/workspace | 是 | `src/lib/agentLauncherApi.ts`、`src-tauri/src/services/external_agent_workspace.rs` | existing Rust/FE tests |
| PTY/终端后端 | 可能 | `src-tauri/src/services/terminal_manager.rs`、terminal commands | cargo tests、tauri:dev |
| 设置/文档 | 是 | settings keybindings、README/config docs | docs review、build |
| 并行协作 | 是 | `coordination/lanes.json` | lane refresh/checkpoint |

## 执行步骤

- [x] TASK-001 终端兼容基线与可观测 harness
  - 新增最小 terminal input harness，用假 PTY/真实 xterm 记录按键产生的 raw bytes，覆盖 Enter、Shift+Enter、Ctrl+J、Tab、Shift+Tab、Esc、Ctrl+C、Alt+Enter、Ctrl+V、Shift+Insert。
  - 固化当前问题：`@xterm/xterm 6.0.0` Shift+Enter 默认输出 CR；Kerminal 全局 capture keybinding 可抢占 xterm 聚焦事件。
  - 验证：新增 policy/harness unit tests，`npm run test -- --run <new tests>`。

- [x] TASK-002 应用级快捷键让渡
  - 在 `KerminalShell` 抽出 `shouldAppHandleKeybinding(event)` 或等价纯模型。
  - 当事件来自 `.xterm` textarea/screen 或带 `data-kerminal-terminal-input` 的终端节点时，默认让终端优先；设置输入框、dialog、菜单、SFTP tree 等非终端元素仍按各自逻辑处理。
  - 保留可配置 app 快捷键，但不得抢 Agent TUI 的 Shift+Enter、Ctrl+J、Ctrl+C、Esc、Tab、方向键等高频输入。
  - 验证：`KerminalShell.test.tsx` 增加 xterm 聚焦不触发全局 action；settings keybinding tests 保持通过。

- [x] TASK-003 Agent TUI 键盘兼容模式
  - 给 `XtermPane` 增加窄接口，例如 `inputCompatibilityMode?: "shell" | "agentTui"`，普通终端默认 `shell`，右栏 Agent 传 `agentTui`。
  - 在 agentTui 模式下，Shift+Enter 默认发送 LF (`\x0a`) 到 PTY，不走 xterm 默认 CR；Ctrl+J 保持 LF；Enter 保持 CR。
  - 保留后续扩展点：如真实 Codex/Claude 版本需要 CSI-u，则通过 `agentEnterKeyMode: "lf" | "csiu"` 小范围切换，不把实验协议扩散到普通终端。
  - 对输入模型和 shell assist 做隔离：Agent terminal 不记录命令块、不触发 ghost suggestion；普通终端行为不变。
  - 验证：`XtermPane.test.tsx` 或 runtime 测试覆盖 raw bytes；`AgentLauncherToolContent.test.tsx` 确认 Agent terminal 使用 agentTui。

- [x] TASK-004 粘贴、IME、鼠标与 alternate screen 兼容
  - 复查 `terminal.paste(text)` 与 bracketed paste 行为，确保右键粘贴、Ctrl+V、Shift+Insert、系统剪贴板路径一致。
  - 覆盖长文本 paste：Claude 官方文档提到大 paste 的确认/直接 pipe 场景；Kerminal 需要保证不截断、不乱改 CR/LF、不触发 app 快捷键。
  - 验证中文 IME composition 不被 capture keydown 或 custom key handler 打断。
  - 验证 mouse reporting、selection copy、alternate screen、resize 和 scrollback 不受右栏 card/header 影响。
  - 验证：browser/xterm harness + `npm run tauri:dev` 人工 smoke。

- [x] TASK-005 右栏 Agent 终端尺寸与焦点体验
  - 检测 Agent terminal 实际 cols/rows；低于 80x24 时提示用户扩大右栏，或提供“移到中间终端 tab / 独立窗口”操作。
  - 保证返回 launcher、切换工具、恢复 Agent terminal 不卸载真实 PTY；与当前 `lane-current-agent-sidebar-terminal-polish` 的错层修复同步。
  - Header/rebind menu 不抢焦点；点击终端区域后立即回到 xterm textarea。
  - 验证：三主题截图、窄宽度截图、component tests、真实 dev server smoke。

- [ ] TASK-006 Codex/Claude 真实 CLI smoke
  - 使用本机已安装 CLI 时执行真实 smoke：启动 Codex、Claude，进入 prompt 后输入 `line1`、Shift+Enter、`line2`、Ctrl+J、`line3`，确认可见为多行 prompt，Enter 才发送。
  - 若缺少账号或网络，至少用 CLI 离线/帮助页进入 TUI 前状态和 raw-byte harness 验证；把缺失凭据记为 HITL。
  - 覆盖 Ctrl+C interrupt、Esc cancel/back、Tab/Shift+Tab 导航、paste 多行、窗口 resize。
  - 验证：`npm run build`、真实 dev server、`npm run tauri:dev`、smoke 记录写入 `.updeng/docs/verification/agent-terminal-compat/`。

- [x] TASK-007 Agent workflow 增强层默认收口
  - 用户纠偏后确认：默认 Agent terminal 主界面不采用 Otty 风格 composer/queue 工具条；打开 Agent 后主体必须是原生 xterm/PTY，输入、快捷键、粘贴都交给真实终端和 Agent TUI。
  - 已移除默认底部 composer、prompt queue、waiting-for-user 状态按钮、send selection/output/command block/branch 工具条和 history 面板；相关增强层后续只能作为显式打开的高级入口候选，不能阻塞原生终端体验。
  - 默认保留的 Kerminal 壳层能力仅限：返回启动器、标题/命令展示、目标绑定、终端尺寸提示、焦点恢复、session resume/new、权限模式和真实 `XtermPane`。
  - 验证：AgentLauncher component tests、终端输入兼容测试、typecheck、build。

## AFK / HITL 切片

| 顺序 | 标题 | 类型 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| 1 | 基线 harness 和当前问题固化 | AFK | None | 自动测试能复现 Shift+Enter 被折叠为 Enter |
| 2 | App 快捷键让渡 | AFK | 1 | xterm 聚焦时全局快捷键不抢 Agent TUI |
| 3 | Agent TUI Shift+Enter/Ctrl+J | AFK | 1,2 | raw bytes 和组件测试通过，普通终端不回退 |
| 4 | 粘贴/IME/mouse/alternate screen | AFK | 2,3 | 自动与人工 smoke 覆盖核心输入 |
| 5 | 尺寸/焦点/恢复体验 | AFK | 2,3 | 右栏不足 80x24 有提示或可迁移路径 |
| 6 | Codex/Claude 真实 CLI 验收 | HITL | 1-5 | 需要本机 CLI、账号/网络或用户确认可用环境 |
| 7 | Prompt queue / send-to-agent | AFK | 6 | 在真实终端兼容稳定后实现 |

## 验证门禁

- 自动化：
  - `npm run test -- --run src/features/terminal/<new-keyboard-tests> src/app/KerminalShell.test.tsx src/features/tool-panel/AgentLauncherToolContent.test.tsx`
  - `npm run test -- --run src/features/settings/keybindingUtils.test.ts`
  - `npm run build`
  - 涉及 Rust/Tauri 启动或 PTY 后端时运行相邻 cargo tests。
- 运行态：
  - 启动真实 dev server，采集浅色、深色、跟随系统截图。
  - 涉及 Agent terminal、PTY、clipboard、native shell 或窗口时必须运行 `npm run tauri:dev`；若默认 target 被现有 `kerminal.exe` 锁定，使用隔离 target 或记录无法重启原因。
  - Windows 本机至少验证 PowerShell 7 wrapper；后续 macOS/Linux 需要补平台 smoke。
- 真实 Agent：
  - Codex：新会话、resume、skip permissions 模式、Shift+Enter/Ctrl+J、Ctrl+C、paste。
  - Claude：新会话、resume、`/terminal-setup` 建议口径、Shift+Enter/Ctrl+J、tmux extended keys 文档提示。
  - Custom：用 raw-byte recorder CLI 或简单 Node/Rust TUI 作为无账号可重复 fallback。

## 风险与回滚

- 风险：Shift+Enter 映射 LF 可能不适合所有 TUI。回滚：仅在 `agentTui` 模式启用，并保留 `csiu`/disabled 配置点；普通终端不受影响。
- 风险：全局快捷键让渡可能让用户觉得 app 快捷键失效。回滚：只在 xterm textarea/screen 聚焦时让渡；设置页保留可编辑 keybindings。
- 风险：xterm 6 与未来 xterm keyboard protocol 行为变化。回滚：policy tests 固定 Kerminal 期望；升级 xterm 时先跑兼容矩阵。
- 风险：右栏宽度天然不适合复杂 TUI。缓解：提供 promote 到中间 workspace tab 或独立窗口的路径。
- 风险：真实 Codex/Claude 版本差异。缓解：记录 CLI 版本、平台、shell、TERM、COLORTERM、tmux 状态和 key mode。

## 并行协作要求

- 正式实现前先刷新并读取 `.updeng/docs/coordination/status.md`。
- 写入 `AgentLauncherToolContent.tsx`、`XtermPane.tsx`、`XtermPane.runtime.ts` 前，必须同步：
  - `lane-current-agent-sidebar-terminal-polish`
  - `lane-terminal-pane-drag-reconnect-diagnosis`
  - `lane-tauri-desktop-plugin-hardening`
- 共享热点文件只做最小兼容改动，不做格式化重排。
- 每完成一个切片，运行 lane checkpoint 或提交具体文件，并在本计划 Round Log 记录 touched paths、验证命令、截图/日志位置和剩余风险。

## Round Log

### 2026-06-26T15:58:09+08:00

- 根据用户反馈建立计划：右栏 Agent 终端必须达到正常终端运行 Codex/Claude 的完整能力，首个明确缺陷是 Shift+Enter 不能换行。
- 回读 AGENTS、README、Updeng 真相源、ADR-0017/0018、Otty 调研计划和现有 Agent launch pwsh 计划。
- 用 CodeGraph 查明当前右栏 Agent terminal 由 `AgentLauncherToolContent` 嵌入 `XtermPane`，输入经 `XtermPane.runtime.ts` 的 xterm `onData` 写入 PTY；全局 keybindings 在 `KerminalShell.tsx` capture 阶段监听；xterm 6 源码中 Shift+Enter 默认折叠为 Enter。
- 调研 Claude Code、Codex CLI、Otty 和 cmux。结论：先做真实终端兼容和快捷键协议，再做 prompt queue / composer / task monitor。

### 2026-06-26T16:18:42+08:00

- 激活本计划到 `plan/active/`，同步 `plan/INDEX.md`、`in-progress.md` 和 `coordination/lanes.json`；按用户要求采用不限制 active lane 数量的并行策略。
- 完成 TASK-001：新增 `src/features/terminal/terminalKeyboardPolicy.ts` 和 `src/features/terminal/terminalKeyboardPolicy.test.ts`，建立 Agent terminal 键盘兼容矩阵与真实 xterm/fake PTY raw bytes harness。
- 固化当前事实：`@xterm/xterm 6.0.0` 下 Enter 与 Shift+Enter 都输出 `CR`，Ctrl+J 输出 `LF`；Agent TUI 目标是 Shift+Enter/Ctrl+J 输出 `LF`，Enter 保持 `CR`。
- 固化 app capture 风险边界：Enter、Shift+Enter、Ctrl+J、Tab、Shift+Tab、Esc、Ctrl+C、Alt+Enter、Ctrl+V、Shift+Insert 在终端聚焦时都应让渡给终端；Ctrl+V 和 Shift+Insert 归入 native paste 意图。
- 本切片未修改 `XtermPane.runtime.ts`、`XtermPane.tsx`、`AgentLauncherToolContent.tsx` 等当前共享热点文件。
- 验证通过：`npm run test -- --run src/features/terminal/terminalKeyboardPolicy.test.ts`。

### 2026-06-26T16:28:48+08:00

- 完成 TASK-002：新增 `src/app/appKeybindingPolicy.ts` 和 `src/app/appKeybindingPolicy.test.ts`，`KerminalShell` capture-phase keydown 先调用 `shouldAppHandleKeybinding`；事件目标在 `.xterm`、`.xterm-helper-textarea`、`.xterm-screen` 或 `[data-kerminal-terminal-input]` 内时让渡给终端。
- 为 TASK-002 补 `KerminalShell.test.tsx` 聚焦回归：从 `.xterm` textarea 触发 `Ctrl+Shift+T` 不再执行 app 新建终端快捷键；非终端常规快捷键用例保持通过。
- 完成 TASK-003：`XtermPane` 新增 `inputCompatibilityMode?: "shell" | "agentTui"`，普通终端默认 `shell`；右栏 Agent Launcher 传 `agentTui`；runtime 在 `agentTui` 模式下把 Shift+Enter 直接写入 `LF`，Enter/Ctrl+J 和普通终端路径保持原有 xterm 行为。
- 为 TASK-003 补 `src/features/terminal/XtermPane.inputCompatibility.test.tsx`，覆盖 Agent TUI Shift+Enter 写 `LF`、shell 模式不拦截 Shift+Enter、Ctrl+V/Shift+Insert 走 native `terminal.paste()` 而不是裸 `\x16`。
- TASK-004 已做自动化子集：paste 快捷键回归已覆盖；IME、mouse reporting、alternate screen、resize、scrollback 和真实右栏视觉/交互仍需后续真实 UI/Tauri smoke。
- 验证通过：
  - `npm run test -- --run src/features/terminal/terminalKeyboardPolicy.test.ts src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/tool-panel/AgentLauncherToolContent.test.tsx`
  - `npm run test -- --run src/app/appKeybindingPolicy.test.ts src/features/settings/keybindingUtils.test.ts`
  - `npm run test -- --run src/app/KerminalShell.test.tsx -t "runs IDEA-style settings and terminal shortcuts|does not run app keybindings for keydown events from focused xterm DOM"`
  - `npm run typecheck`
  - `npm run build`
  - Vite dev server HTTP smoke: `npm run dev -- --host 127.0.0.1 --port 1436` 后 `http://127.0.0.1:1436/` 返回 200，进程已停止。
- 宽验证现状：完整 `npm run test -- --run src/app/KerminalShell.test.tsx` 仍有 4 个失败，分别是空工作区文案/右栏宽度历史断言和 profile duplicate 期望缺少 `sidebarGroupId`；这些失败不在本轮 keybinding/Agent TUI 输入路径。
- `npm run tauri:dev` 未完成：Tauri `beforeDevCommand` 启动 Vite 时端口 1425 已被占用，报 `Error: Port 1425 is already in use`；未强行关闭用户现有进程。

### 2026-06-26T17:04:00+08:00

- 完成 TASK-004：`terminalKeyboardPolicy` 增加 IME composition guard，`XtermPane.runtime.ts` 监听 `compositionstart` / `compositionend` 并同步 input model，避免 Agent TUI 的 Shift+Enter override 打断中文输入法组合；长文本 paste 继续走 xterm `terminal.paste()`，bracketed paste 保持精确内容与 xterm 的 `\n -> \r` 归一化。
- 为 TASK-004 增加真实 xterm 兼容 harness：`src/features/terminal/XtermPane.realXtermCompatibility.test.ts` 覆盖 bracketed paste、alternate screen enter/exit、resize event、scrollback cap 和 SGR mouse down/up reporting；`XtermPane.inputCompatibility.test.tsx` 覆盖 Agent 长文本 paste 不截断、不改写、不触发 app keybinding。
- 完成 TASK-005：`XtermPane` 新增 `onTerminalDimensionsChange` 和 `focusRequestToken`，fit 后用真实 `terminal.cols/rows` 回传并 resize PTY；右栏 Agent terminal 记录当前 cols/rows，低于 80x24 时展示 `终端 {currentLabel}，建议至少 {minLabel}；拖宽右栏获得完整 TUI。`；header 点击、rebind 成功和终端区域 pointer down 都会把焦点还给 xterm。
- 为 TASK-005 增加纯模型 `src/features/tool-panel/agent-launcher/agentTerminalViewportModel.ts` 与测试，稳定 80x24 阈值和文案；`AgentLauncherToolContent.test.tsx` 覆盖 agentTui 模式、尺寸提示、header/rebind 焦点请求；`XtermPane.inputCompatibility.test.tsx` 覆盖尺寸回调、focus token 和 pointer focus。
- 运行态视觉验证通过：启动 `npm run dev -- --host 127.0.0.1 --port 1437`，Playwright/Chrome 采集浅色、深色、跟随系统浅色和跟随系统深色窄屏截图；证据位于 `.updeng/docs/verification/agent-terminal-compat/agent-terminal-light-explicit.png`、`agent-terminal-dark-explicit.png`、`agent-terminal-system-light.png`、`agent-terminal-system-dark-narrow.png`，JSON 记录为 `dev-server-themed-visual-smoke.json`。检查结论：右栏尺寸提示可见，未发现文字遮挡或主题不可读。
- Tauri 启动 smoke：默认 1425 端口仍被现有用户进程占用，改用隔离命令 `CARGO_TARGET_DIR=src-tauri/target-agent-smoke npm run tauri:dev -- --config '{"build":{"devUrl":"http://127.0.0.1:1438","beforeDevCommand":"npm run dev -- --host 127.0.0.1 --port 1438"}}'`；Rust 编译完成并运行 `target-agent-smoke\debug\kerminal.exe`，未出现 WebView、动态导入或 `freezePrototype` 类启动错误。single-instance 仍可能把窗口交给已有 `target\debug\kerminal.exe`，未强杀用户现有进程。
- 本机真实 CLI 可用性已记录：`codex` 来自 `C:\dev\js\nodejs\codex.ps1`，版本 `codex-cli 0.142.2`；`claude` 来自 `C:\dev\js\nodejs\claude.ps1`，版本 `2.1.185 (Claude Code)`。真实 Codex/Claude prompt 内多行输入、Ctrl+C、Esc、Tab/Shift+Tab 和真实账号/网络交互仍属于 TASK-006 HITL，不在本轮自动完成口径内。
- 验证通过：
  - `npm run test -- --run src/features/terminal/XtermPane.realXtermCompatibility.test.ts`
  - `npm run test -- --run src/features/terminal/terminalKeyboardPolicy.test.ts src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/terminal/XtermPane.realXtermCompatibility.test.ts src/features/tool-panel/agent-launcher/agentTerminalViewportModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/appKeybindingPolicy.test.ts src/features/settings/keybindingUtils.test.ts`
  - `npm run typecheck`
  - `npm run build`
- 已停止本轮启动的 1437 dev server；1438 未留下监听端口。检测到已有 `C:\dev\rust\kerminal\src-tauri\target\debug\kerminal.exe` 进程，判定为用户/既有默认调试窗口，未停止。

### 2026-06-26T17:38:12+08:00

- 推进 TASK-007 的首个 AFK 子切片，但不标记整项完成：新增 `src/features/tool-panel/agent-launcher/agentPromptQueueModel.ts` 和测试，`AgentTerminalView` 增加底部 composer、手动队列、粘贴/发送/排队/下一个按钮；`XtermPane` 新增 `inputRequest?: XtermPaneInputRequest | null`，外部 composer 只通过 xterm `terminal.paste()` 和可选 `CR` 写入当前真实 PTY session，不替代外部 Agent TUI。
- 修复本轮视觉验证暴露的布局问题：移除 Agent terminal 内层圆角卡片壳，保持终端和 composer 为右栏直接分区；第一次 v2 截图发现窄屏 `.xterm` DOM 延伸到 composer 后方，随后把中间 wrapper 改为 flex 容器，v3 DOM 指标确认 `terminalOverlapsComposerPanel: false`。
- 运行态视觉验证：使用本机 Chrome 打开 `http://127.0.0.1:1439/`，通过设置界面真实切换主题，采集显式浅色、显式深色、跟随系统浅色窄屏、跟随系统深色窄屏截图；证据为 `.updeng/docs/verification/agent-terminal-compat/agent-terminal-composer-light-explicit-v3.png`、`agent-terminal-composer-dark-explicit-v3.png`、`agent-terminal-composer-system-light-narrow-v3.png`、`agent-terminal-composer-system-dark-narrow-v3.png`，JSON 为 `composer-visual-smoke-20260626-v3.json`。确认 `data-theme` 分别为 `light/dark`，队列计数可见，composer 与终端不重叠。
- 验证通过：
  - `npm run test -- --run src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/agent-launcher/agentPromptQueueModel.test.ts src/features/terminal/XtermPane.inputCompatibility.test.tsx`
  - `npm run test -- --run src/features/terminal/terminalKeyboardPolicy.test.ts src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/terminal/XtermPane.realXtermCompatibility.test.ts src/features/tool-panel/agent-launcher/agentTerminalViewportModel.test.ts src/features/tool-panel/agent-launcher/agentPromptQueueModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/appKeybindingPolicy.test.ts src/features/settings/keybindingUtils.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - dev server HTTP smoke: `http://127.0.0.1:1439/` 返回 200。
- 未重跑 Tauri 隔离启动：本轮新增为前端 composer/queue 和 `XtermPane` 外部输入桥接，未改 Rust/Tauri/窗口/权限；Tauri 启动证据沿用 17:04 本计划 Round Log。TASK-006 真实 Codex/Claude prompt 内多行输入、Ctrl+C、Esc、Tab/Shift+Tab、paste 和 resize 仍是 HITL，不自动关闭。
- 并行协作：已运行 `node .codex/hooks/lane-coordination.cjs checkpoint lane-agent-terminal-production-compat C:\dev\rust\kerminal` 和 `node .codex/hooks/lane-coordination.cjs refresh C:\dev\rust\kerminal`；checkpoint 位于 `.updeng/docs/coordination/checkpoints/lane-agent-terminal-production-compat.json`。

### 2026-06-26T17:59:34+08:00

- 继续推进 TASK-007 的 AFK 子切片，但不标记整项完成：`agentPromptQueueModel.ts` 增加 `AgentWorkflowStatus`、prompt history model 和 view resolver；`AgentTerminalView` 增加显式 `运行中` / `等待人工` 状态按钮，以及 session-local prompt history 列表，支持记录 composer paste/send/queue/run-next 并恢复历史项到 composer。状态只由用户按钮切换，不猜测外部 Agent 运行状态。
- 补充测试：`agentPromptQueueModel.test.ts` 覆盖 history cap、动作标签和 workflow status view；`AgentLauncherToolContent.test.tsx` 覆盖等待状态按钮不发送 terminal input，以及排队 prompt 进入历史并可恢复到 composer。
- 初始 v4/v5 视觉脚本验证了背后的 Agent DOM 度量，但后续人工截图检查发现设置弹窗仍遮挡前景；这些截图不作为最终视觉证据，已被 18:14 的 v6 视觉 smoke 取代。
- v4/v5 脚本问题：首轮误用页面第一个 `.xterm` 导致假阳性 overlap；后续又发现切换主题后未关闭设置弹窗。临时脚本已修正为只测 `[aria-label="Codex xterm 终端"]`，并在进入 Agent Launcher 前关闭设置弹窗。
- 验证通过：
  - `npm run test -- --run src/features/terminal/terminalKeyboardPolicy.test.ts src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/terminal/XtermPane.realXtermCompatibility.test.ts src/features/tool-panel/agent-launcher/agentTerminalViewportModel.test.ts src/features/tool-panel/agent-launcher/agentPromptQueueModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/appKeybindingPolicy.test.ts src/features/settings/keybindingUtils.test.ts`，8 files / 57 tests passed。
  - `npm run typecheck`
  - `npm run build`，仅有既有 Vite dynamic import/chunk-size warnings。
  - dev server HTTP/visual smoke 使用 `http://127.0.0.1:1440/`，本轮 1440 dev server 已停止并确认不再响应。
- 并行协作：已运行 `node .codex/hooks/lane-coordination.cjs checkpoint lane-agent-terminal-production-compat C:\dev\rust\kerminal` 和 `node .codex/hooks/lane-coordination.cjs refresh C:\dev\rust\kerminal`；checkpoint 覆盖 25 paths / 9 tracked patch paths。
- 仍未关闭 TASK-006：真实 Codex/Claude prompt 内 `line1`、Shift+Enter、`line2`、Ctrl+J、`line3`、Enter，以及 Ctrl+C、Esc、Tab/Shift+Tab、paste、resize 仍需要 HITL 或真实账号/网络/TUI 证据。

### 2026-06-26T18:14:13+08:00

- 继续推进 TASK-007 的 send-to-agent AFK 子切片，但不标记整项完成：新增 `src/features/tool-panel/agent-launcher/agentTerminalContextModel.ts` 和测试，把绑定目标 pane 的 target metadata、cwd、shell、tab/pane id 和 `outputHistory` tail 组装成可 paste 的 Agent context prompt。
- `AgentTerminalView` 新增 `目标输出` 按钮；点击后通过现有 `inputRequest` paste 到真实 Agent xterm，不自动提交，并以 `上下文` 动作写入 session-local prompt history。为避免泄露错误 pane 输出，只有 `focusedPane.id` 匹配 Agent session target `paneId` 时才附带 outputHistory；不匹配时只发送 target metadata 和 `<not captured>`。
- 运行态视觉验证 v6：启动 `npm run dev -- --host 127.0.0.1 --port 1440`，用 `.updeng/tmp/agent-terminal-workflow-visual-smoke.mjs` 真实切换主题、关闭设置弹窗、打开 Agent Launcher、启动 mock Codex terminal、点击 queue/send/目标输出/等待人工/history 后截图。最终证据为 `.updeng/docs/verification/agent-terminal-compat/agent-terminal-workflow-light-explicit-v6.png`、`agent-terminal-workflow-dark-explicit-v6.png`、`agent-terminal-workflow-system-light-narrow-v6.png`、`agent-terminal-workflow-system-dark-narrow-v6.png`，JSON 为 `workflow-history-visual-smoke-20260626-v6.json`。
- v6 度量和人工截图检查结论：`目标输出`、`等待人工`、`历史 3`、`队列 1` 均可见；composer/history 与右栏 `Codex xterm 终端` 不重叠；无 document 横向溢出；所有 composer toolbar 按钮文字无溢出；浅色、深色和跟随系统窄屏截图未被设置弹窗遮挡。
- 验证通过：
  - `npm run test -- --run src/features/tool-panel/agent-launcher/agentTerminalContextModel.test.ts src/features/tool-panel/agent-launcher/agentPromptQueueModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx`，3 files / 33 tests passed。
  - `npm run test -- --run src/features/terminal/terminalKeyboardPolicy.test.ts src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/terminal/XtermPane.realXtermCompatibility.test.ts src/features/tool-panel/agent-launcher/agentTerminalViewportModel.test.ts src/features/tool-panel/agent-launcher/agentPromptQueueModel.test.ts src/features/tool-panel/agent-launcher/agentTerminalContextModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/appKeybindingPolicy.test.ts src/features/settings/keybindingUtils.test.ts`，9 files / 61 tests passed。
  - `npm run typecheck`
  - `npm run build`，仅有既有 Vite dynamic import/chunk-size warnings。
  - dev server `http://127.0.0.1:1440/` 用于 v6 visual smoke；本轮已停止并确认 1440 不再响应。
- 仍未关闭 TASK-006；TASK-007 仍剩 selection/command block 到 Agent、fork/branch entry 和必要的持久化 history。

### 2026-06-26T18:31:25+08:00

- 继续推进 TASK-007 的 send-to-agent AFK 子切片，但不标记整项完成：`terminalSessionRegistry` 新增 transient runtime context，记录目标 pane 的当前 selection 和最新 command block plain text；`XtermPane.runtime.ts` 在 selection change 与 command block sync 时更新该内存快照，session unregister/reset 时清理，不写入 workspace session 持久化。
- `AgentTerminalView` 新增 `选区` 和 `命令块` 按钮；点击时即时读取绑定目标 pane 的 runtime context，生成 `Kerminal target selection` 或 `Kerminal target command block` prompt，经现有 `inputRequest` paste 到真实 Agent xterm，不自动提交，并分别以 `选区` / `命令块` 写入 session-local prompt history。
- 安全边界：runtime context 必须匹配 Agent session target `paneId` 才会生成 prompt；没有选区或命令块时按钮点击 no-op；仍不暴露目标终端私有 ref，也不恢复 Kerminal 自有聊天 runtime。
- 运行态视觉验证 v7：启动 `npm run dev -- --host 127.0.0.1 --port 1441`，用 `.updeng/tmp/agent-terminal-workflow-visual-smoke.mjs` 真实切换主题、关闭设置弹窗、打开 Agent Launcher、启动 mock Codex terminal、操作 queue/send/目标输出/等待人工/history 后截图，并把 `选区` / `命令块` 纳入 toolbar overflow 检查。证据为 `.updeng/docs/verification/agent-terminal-compat/agent-terminal-workflow-light-explicit-v7.png`、`agent-terminal-workflow-dark-explicit-v7.png`、`agent-terminal-workflow-system-light-narrow-v7.png`、`agent-terminal-workflow-system-dark-narrow-v7.png`，JSON 为 `workflow-history-visual-smoke-20260626-v7.json`。
- v7 度量结论：`目标输出`、`选区`、`命令块`、`等待人工`、`历史 3`、`队列 1` 均可见；新增 toolbar controls 无文字溢出；composer/history 与右栏 `Codex xterm 终端` 不重叠；无 document 横向溢出；浅色、深色和跟随系统窄屏截图未被设置弹窗遮挡。dev server `http://127.0.0.1:1441/` 已停止并确认不再响应。
- 验证通过：
  - `npm run test -- --run src/features/terminal/terminalSessionRegistry.test.ts src/features/tool-panel/agent-launcher/agentTerminalContextModel.test.ts src/features/tool-panel/agent-launcher/agentPromptQueueModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/terminal/XtermPane.inputCompatibility.test.tsx`，5 files / 64 tests passed。
  - `npm run test -- --run src/features/terminal/terminalKeyboardPolicy.test.ts src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/terminal/XtermPane.realXtermCompatibility.test.ts src/features/terminal/terminalSessionRegistry.test.ts src/features/tool-panel/agent-launcher/agentTerminalViewportModel.test.ts src/features/tool-panel/agent-launcher/agentPromptQueueModel.test.ts src/features/tool-panel/agent-launcher/agentTerminalContextModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/appKeybindingPolicy.test.ts src/features/settings/keybindingUtils.test.ts`，10 files / 85 tests passed。
  - `npm run typecheck`
  - `npm run build`，仅有既有 Vite dynamic import/chunk-size warnings。
- 仍未关闭 TASK-006；TASK-007 仍剩 fork/branch entry 和必要的持久化 history。

### 2026-06-26T18:50:18+08:00

- 完成 TASK-007 的 fork/branch AFK 子切片，并将 TASK-007 标记完成：新增 `buildAgentTerminalBranchPrompt`，在 Agent terminal 工具条加入 `分支` 按钮；点击后生成安全 branch/fork request prompt，经现有 `inputRequest` paste 到真实 Agent xterm，不自动提交，不直接执行本地 `git`，并以 `分支` 动作写入 session-local prompt history。
- 安全口径：branch prompt 要求 Agent 先检查 `git status`，只在安全时创建/切换 feature branch 或 worktree，并回报确切 branch/worktree；破坏性 git 操作仍需显式用户授权。持久化/richer history 未被确认为必须，作为后续产品候选，不阻塞本 AFK 切片。
- 为恢复前端验证，最小同步 SSH 凭据 lane 的前端类型半改状态：`src/lib/remoteHostApi.ts` 的 `RemoteHostCreateRequest` 增加 `credentialStatus?: RemoteHostCredentialStatus`，匹配该 lane 已加入的 normalize 输出；未改运行逻辑。
- 运行态视觉验证 v8：启动 `npm run dev -- --host 127.0.0.1 --port 1443`，更新 `.updeng/tmp/agent-terminal-workflow-visual-smoke.mjs` 点击 `分支` 并纳入 toolbar overflow 检查。最终证据为 `.updeng/docs/verification/agent-terminal-compat/agent-terminal-workflow-light-explicit-v8.png`、`agent-terminal-workflow-dark-explicit-v8.png`、`agent-terminal-workflow-system-light-narrow-v8.png`、`agent-terminal-workflow-system-dark-narrow-v8.png`，JSON 为 `workflow-history-visual-smoke-20260626-v8.json`。v8 度量确认 `分支`、`目标输出`、`选区`、`命令块`、`等待人工`、`历史 4`、`队列 1` 可见，无 toolbar overflow、无 xterm/composer/history overlap、无横向溢出。1443 dev server 已停止。
- 验证通过：
  - `npm run test -- --run src/features/tool-panel/agent-launcher/agentTerminalContextModel.test.ts src/features/tool-panel/agent-launcher/agentPromptQueueModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx`，3 files / 38 tests passed。
  - `npm run test -- --run src/features/terminal/terminalKeyboardPolicy.test.ts src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/terminal/XtermPane.realXtermCompatibility.test.ts src/features/terminal/terminalSessionRegistry.test.ts src/features/tool-panel/agent-launcher/agentTerminalViewportModel.test.ts src/features/tool-panel/agent-launcher/agentPromptQueueModel.test.ts src/features/tool-panel/agent-launcher/agentTerminalContextModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/appKeybindingPolicy.test.ts src/features/settings/keybindingUtils.test.ts`，10 files / 87 tests passed。
  - `npm run test -- --run src/lib/remoteHostApi.test.ts`，1 file / 9 tests passed。
  - `npm run typecheck`
  - `npm run build`，仅有既有 Vite dynamic import/chunk-size warnings。
- Tauri smoke 复查未完成：第一次续跑发现上一轮相对 `CARGO_TARGET_DIR=src-tauri/target-agent-smoke` 实际落到 `src-tauri/src-tauri/target-agent-smoke`，被 Tauri watcher 反复重建；已停止并安全清理 `C:\dev\rust\kerminal\src-tauri\src-tauri`。第二次改用 `%TEMP%\kerminal-tauri-agent-smoke` 绝对 target 和 1442 dev URL，前端 dev server 正常启动，但 Rust 编译被并行 `lane-ssh-credential-vault-auth-runtime-design` 半改状态阻断，错误集中在 `src-tauri/src/commands/connection.rs`、`src-tauri/src/services/ssh_route_plan.rs`、`src-tauri/src/services/remote_host_service.rs`、`src-tauri/src/storage/config_file_store.rs` 的 `secret_ref`、`key_passphrase_ref`、`RemoteHostCredentialStatus` 签名/类型未同步。未修改这些 Rust 文件，未停止用户既有默认 `kerminal.exe`。
- 仍未关闭 TASK-006：真实 Codex/Claude prompt 内 `line1`、Shift+Enter、`line2`、Ctrl+J、`line3`、Enter，以及 Ctrl+C、Esc、Tab/Shift+Tab、paste、resize 仍需要 HITL 或真实账号/网络/TUI 证据。

### 2026-06-26T19:27:40+08:00

- 根据用户明确反馈纠偏 TASK-007：右栏 AI 助手打开 Agent 后不应显示底部输入框、发送/粘贴/排队/目标输出/分支/选区/命令块/等待状态/历史等按钮；默认体验必须像在 PowerShell、cmd、Windows Terminal 或其它平台终端中直接运行 `codex` / `claude`。
- `src/features/tool-panel/AgentLauncherToolContent.tsx` 移除 Agent terminal 默认底部 composer、prompt queue、history 和 workflow 工具条；保留真实 `XtermPane`、返回启动器、标题、目标绑定、尺寸提示和焦点恢复。输入继续走 xterm/PTY；Kerminal 不再在默认界面代理 prompt 输入。
- 为真实 Agent TUI 补终端环境兼容：Agent terminal 传给 `XtermPane` 的 env 会把缺失或 `dumb` 的 `TERM` 修正为 `xterm-256color`，并默认补 `COLORTERM=truecolor`；已有非 `dumb` TERM/COLORTERM 会保留，避免 Codex 报 `TERM is set to "dumb"`。
- `src/features/tool-panel/AgentLauncherToolContent.test.tsx` 更新回归：断言 Agent 默认没有外部 prompt composer/queue/status 控件，Agent `XtermPane` 使用 `inputCompatibilityMode="agentTui"`，并收到 `TERM=xterm-256color` / truecolor 环境；已有非 dumb TERM 会保留。
- 验证通过：
  - `npm run test -- --run src/features/tool-panel/AgentLauncherToolContent.test.tsx`，1 file / 22 tests passed。
  - `npm run test -- --run src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/terminal/terminalKeyboardPolicy.test.ts src/app/appKeybindingPolicy.test.ts`，3 files / 17 tests passed。
  - `npm run typecheck`
  - `npm run build`，仅有既有 Vite dynamic import/chunk-size warnings。
- 运行态截图自动化未完成：项目本地无 `playwright`，bundled runtime 的 `playwright` 缺 `playwright-core`；尝试打开 `http://127.0.0.1:1446/` 前端 dev server 后停止并清理 1446 监听进程。需后续用可用浏览器工具或 Tauri WebView 继续真实 Codex/Claude smoke。
- 图片粘贴口径：默认不通过外部 Agent prompt 输入框处理图片。后续应在终端层能力中实现或验证剪贴板图片/文件 drop/path paste/终端图像协议支持，保持“像原生终端运行 Agent CLI”的行为边界。

### 2026-06-29T19:00:00+08:00

- 文档清理时复核状态：TASK-001~005 和 TASK-007 已完成，剩余 TASK-006 需要真实 Codex/Claude CLI prompt、账号/网络或人工交互环境验证，属于 HITL 阻塞，不应继续占用 active。
- 移动到 `plan/blocked/`，并在 `BLOCKERS.md` 登记 `BLK-20260629-001`。默认 Agent terminal 主界面保持真实 xterm/PTY，外部 prompt composer/queue 不再作为 active 工作。
