---
id: PLAN-20260624-203124-agent-session-file-restore
status: done
created_at: 2026-06-24T20:31:24+08:00
started_at: 2026-06-24T20:56:25+08:00
completed_at: 2026-06-25T02:45:46+08:00
updated_at: 2026-06-25T02:45:46+08:00
owner: ai
---

# Agent 会话文件化与终端恢复生产级实施计划

## 结论

采用“文件优先会话状态 + 每个 Agent 独立工作目录 + Kerminal 自有 `agentSessionId` + session-scoped MCP tools”的方案。

Kerminal 不恢复内置 AI，不恢复旧 LLM provider、AI 对话、custom MCP、skills 设置，也不把 Codex/Claude 的内部会话 id 当主键。Kerminal 只负责：

- 为右栏 Agent Launcher 创建和恢复本地终端容器。
- 为每个 Agent 会话创建独立 workspace，让 Codex/Claude/自定义 CLI 能读到自己的会话、目标绑定、最近终端快照和 MCP 配置。
- 通过 Kerminal MCP Server 暴露 tools-only runtime 能力，让外部 Agent 操作 live app、既有终端、SSH/SFTP、容器、端口转发、server info 和诊断。
- 在重启后准确标注 live target 是否还存在，支持继续 provider transcript、查看最后快照、手动或自动重绑当前终端，但不伪装成 OS PTY 进程已经复活。

长期架构决策见 `.updeng/docs/decisions/ADR-0018-agent-session-workspace-and-terminal-restore.md`。

## 用户问题回答

### AI 能不能拿到当前终端上下文

可以，但不能靠“当前 UI 焦点”的隐式猜测。必须由 Kerminal 建立显式绑定：

- 用户从某个终端 pane 打开右栏 Agent 时，创建 `agentSessionId`，记录 `targetTerminalSessionId`、`paneId`、`tabId`、`targetRef`、`cwd`、shell、最近输出快照和绑定 generation。
- Agent 运行在 `~/.kerminal/agents/sessions/<agentSessionId>/`，启动后先读 `AGENTS.md` / `CLAUDE.md` 和 `context/target-binding.json`。
- Agent 需要 live 信息时调用 session-scoped MCP tool，例如 `kerminal.agent.target_context`，由 Kerminal 用 `agentSessionId` 解析绑定，而不是让 Agent 自己猜终端。

### 多个终端后 AI 能不能分清任务

可以，前提是把“Agent 会话”和“目标终端”拆成不同 id：

| ID | 归属 | 生命周期 | 用途 |
| --- | --- | --- | --- |
| `agentSessionId` | Kerminal | 持久 | Agent 会话主键，目录名、MCP scope、UI 恢复都用它 |
| `agentTerminalSessionId` | TerminalManager | 运行态 | 右栏里运行 Codex/Claude/custom CLI 的 PTY session |
| `targetTerminalSessionId` | TerminalManager | 运行态 | 中间工作区被 Agent 处理的目标终端 |
| `targetBindingId` / `generation` | Kerminal | 可持久 | 防止旧绑定写入新终端，重连/重绑时递增 |
| `providerSessionId` | Codex/Claude | 可选 | Codex/Claude 自己的 resume id，只做辅助恢复 |

`agentSessionId` 是主键。Codex/Claude 的 resume id 只能存到 `provider.toml`，不能反过来主导 Kerminal 绑定。

### 每个 AI 对话是否应该有自己的文件夹

应该。不要让所有 Agent 都在全局 `~/.kerminal` 跑。全局目录负责 Kerminal 配置；每个 Agent 会话目录负责本次 Agent 的上下文。

推荐目录：

```text
~/.kerminal/
  AGENTS.md
  CLAUDE.md
  .codex/config.toml
  .mcp.json
  settings.toml
  profiles/
  hosts/
  snippets/
  workflows/
  data/
    command.sqlite
  agents/
    sessions/
      ags_20260624_203124_ab12/
        session.toml
        provider.toml
        AGENTS.md
        CLAUDE.md
        .codex/
          config.toml
        .mcp.json
        context/
          target-binding.json
          terminal-snapshot.json
          workspace-snapshot.json
          mcp-endpoint.json
        logs/
          agent-terminal.jsonl
          mcp-calls.jsonl
```

全局 `~/.kerminal/AGENTS.md` 写通用规则；会话目录 `AGENTS.md` 写“本次 Agent 会话是谁、绑定哪个目标、哪些文件可改、怎么通过 MCP 找 live target”。这样 Codex 默认会读当前 cwd 下的 `AGENTS.md`，Claude 默认读 `CLAUDE.md`，二者都能拿到会话范围。

### 在会话文件夹启动后能不能改 MCP 和环境工作空间内容

能，但要分区：

- 会话目录里的 `.codex/config.toml` / `.mcp.json` 是 Kerminal 生成的 session-scoped MCP 配置，可以由 Kerminal 更新管理块，Agent 默认不改。
- `~/.kerminal/settings.toml`、`profiles/`、`hosts/`、`snippets/`、`workflows/` 是配置事实源，Agent 可以按规则直接修改。
- `secrets/` 默认禁止，除非用户明确要求。
- `data/command.sqlite` 不直接改，命令历史通过 MCP 查询。
- MCP tools 不提供 config CRUD，仍遵循 ADR-0012/0016/0017 的 tools-only 和 file-first 边界。

## 调研摘要

### Warp

Warp 的公开文档入口是 [Session Restoration](https://docs.warp.dev/terminal/sessions/session-restoration/)。本轮直接访问页面遇到 Vercel 安全检查，未把页面细节作为确定依据。它只作为同类产品方向参考：终端产品的 session restoration 应首先恢复窗口、Tab、Pane、cwd、scrollback 和用户可理解的状态，不应默认承诺重启后原进程仍然存在。

### Otty

Otty 的资料更接近 Kerminal 目标：

- [Session Recovery](https://docs.otty.sh/workflows/session-recovery)：强调恢复打开过的窗口、Tab、Pane，崩溃后用最近 snapshot 恢复。
- 其恢复模型区分 layout、scrollback、tmux session、code agent session 和 process re-run。默认恢复 shell 与 cwd，但不自动重跑进程；重跑可用 whitelist 或 all-running policy。
- [OSC 88 Terminal Resume Protocol](https://docs.otty.sh/vt/osc/osc-88)：把“应用告诉终端如何恢复”做成协议草案，并强调安全边界：恢复命令必须经过注入防护、进程身份验证、用户可见且可撤销，不能无条件执行从终端输出里来的 resume 命令。
- Agent 相关文档还提到 Agent history、resume、fork、状态上报和 pane badge。这说明成熟方向是“Agent 会话有自己的历史与状态”，而不是只靠终端文本。

Kerminal 应采用 Otty 的分层思想，但 P0 不做 OSC-88，也不自动重跑未知进程。

### Codex / Claude

官方资料入口：

- Codex MCP：<https://developers.openai.com/codex/mcp>
- Codex config：<https://developers.openai.com/codex/config-basic>
- Codex CLI reference：<https://developers.openai.com/codex/cli/reference>
- Codex `AGENTS.md`：<https://developers.openai.com/codex/guides/agents-md>
- Claude Code MCP：<https://docs.anthropic.com/en/docs/claude-code/mcp>
- Claude Code memory：<https://docs.anthropic.com/en/docs/claude-code/memory>
- Claude Code CLI reference：<https://docs.anthropic.com/en/docs/claude-code/cli-reference>

设计取舍：

- Codex/Claude 的 resume 能力用于恢复它们自己的对话，不用于证明 Kerminal target 仍是 live。
- `AGENTS.md` / `CLAUDE.md` 是启动目录里的主要指令入口，所以右栏启动 cwd 应该是会话目录，而不是全局 `~/.kerminal`。
- MCP config 应写到会话目录，让同一台 Kerminal 同时开多个 Agent 时，每个 Agent 都能携带自己的 `KERMINAL_AGENT_SESSION_ID` 和 endpoint scope。

## 当前 Kerminal 现状

### 已有能力

- 前端工作区恢复：
- `src/app/useWorkspaceSessionPersistence.ts`
  - `src/features/workspace/workspaceSessionStorage.ts`
  - `src/features/workspace/workspaceSession.ts`
  - 现在用 `localStorage` key `kerminal.workspace.session.v1` 保存 `activeTabId`、`focusedPaneId`、sidebar machines、terminal panes/tabs、tab group preferences 和 bounded output history。
  - `TERMINAL_OUTPUT_HISTORY_MAX_CHARS = 128 * 1024`。
  - `pagehide` 时 flush pending output history。
  - `TerminalPane` 快照不保存旧 PTY `sessionId`；恢复后 `XtermPane` 先回放 `outputHistory`，再创建新的 terminal session。
- PTY 管理：
  - `src-tauri/src/services/terminal_manager.rs`
  - `TerminalManager.sessions` 是进程内 `HashMap<String, TerminalSession>`。
  - `create_session` 生成 UUID；能 list/write/resize/close/output_snapshot。
  - 最近上下文 buffer 约 64KiB，重启后不能恢复 OS PTY。
- Pane/session binding：
  - `src-tauri/src/services/terminal_session_binding_service.rs`
  - 有 `paneId <-> sessionId` 双索引、metadata、generation、status 和有限事件。
  - 目前是进程内 registry，没有落盘恢复。
  - 当前 command 只暴露 register/ready/disconnected/closed/events，缺少面向 Agent/MCP 的按 pane/session 查询与 target resolver。
- Agent launcher：
  - `src/features/tool-panel/AgentLauncherToolContent.tsx`
  - 三入口已存在，右栏内嵌 `XtermPane` 启动 CLI。
  - 只有一个 React `activeTerminal`，没有 `agentSessionId`、session map、target binding 或恢复列表。
- 外部 Agent workspace：
  - `src-tauri/src/services/external_agent_workspace.rs`
  - 目前准备全局 `~/.kerminal` 的 `AGENTS.md`、`CLAUDE.md`、`.codex/config.toml`、`.mcp.json`。
  - `PrepareExternalAgentWorkspaceRequest` 只有 `agent_id`、`custom_command`、dry-run、overwrite policy。
- MCP：
  - `src-tauri/src/services/mcp_streamable_http_server.rs`
  - 只声明 tools，resources/prompts 返回空或 unsupported。
  - endpoint 目前是全局 `/mcp`，没有 agent session scope。
- Agent context：
  - `src-tauri/src/services/agent_context_service.rs`
  - 能按 terminal session id 生成脱敏 recent output snapshot，但未接入 session-scoped target resolver。
  - 当前没有生产路径 command，也没有注入 MCP execution context。

### 核心缺口

- 工作区 session 在前端 localStorage，外部 Agent 看不到。
- terminal binding 在 Rust 内存，重启后丢失，Agent 看不到。
- Agent launcher 没有持久 `agentSessionId`，多 Agent/多终端无法稳定区分。
- 所有 Agent 共享全局 `~/.kerminal` cwd，Codex `resume --last` 等按 cwd 过滤的行为容易串会话。
- MCP endpoint 是全局的，tool call 无法天然知道“这个调用来自哪个 Agent 会话”。
- 右栏返回 launcher 时可以保留当前 `activeTerminal`，但重启或切换多个 Agent 没有恢复模型。

## 目标

- 右栏保持极简：三个图标 Codex、Claude、自定义；进入后就是对应 CLI 终端。
- 每个 Agent 会话都有独立文件夹和稳定 id。
- Agent 启动后能通过文件读到：
  - 自己的 `agentSessionId`
  - 绑定的目标 pane/tab/terminal/session/cwd/targetRef
  - 最近终端输出快照
  - MCP endpoint 和可用工具边界
  - 文件优先配置目录和 validator 规则
- Kerminal MCP tools 能根据 `agentSessionId` 解析默认 target，不要求 Agent 每次手动传 target session。
- 多终端、多 Agent 并行时不会串目标。
- 重启后恢复 UI、Agent 会话列表、最近快照和 provider resume 信息；live target 缺失时标注 stale，提供重绑。
- 所有持久化使用文件优先，写入原子化、可校验、可清理。

## 非目标

- 不恢复旧内置 AI 聊天、provider、conversation、attachments、pending invocation、AI audit。
- 不恢复设置里的 AI 配置、自定义 MCP、自定义 skills。
- 不把 Kerminal 做成 MCP client 管理用户其它 MCP server。
- 不用 Kerminal MCP 暴露配置 CRUD。
- P0 不做 OSC-88，不自动执行 resume command，不自动重跑未知进程。
- P0 不承诺应用重启后原本地 PTY 进程仍存活。
- 不把 token、密码、私钥写进 session 文件。

## 架构设计

### 分层

```text
React UI
  AgentLauncherToolContent
  AgentTerminalView
  AgentSessionList / RebindSheet
    |
Tauri Commands
  agent_session_*
  workspace_session_*
  terminal_session_binding_*
    |
Rust Services
  AgentSessionService
  AgentSessionFileStore
  WorkspaceSessionFileStore
  TerminalSessionBindingService
  AgentTargetResolver
  ExternalAgentWorkspaceService
  McpStreamableHttpServerService
    |
Filesystem
  ~/.kerminal/workspace/session.json
  ~/.kerminal/agents/sessions/<agentSessionId>/**
```

### 文件存储原则

- Rust 侧负责所有会话文件写入，前端只通过 command 调用，不直接用 FS plugin 写关键状态。
- 小 JSON/TOML 使用 atomic write：写 temp、flush、rename；失败保留旧文件。
- 高频事件用 JSONL append，定期 rotate。
- 输出快照 bounded，不把完整 scrollback 无限制落盘。
- 文件 schema 带 `schemaVersion` / `schema_version`。
- 每个文件都能单独校验；跨文件索引用 manifest。

### 全局目录与会话目录

全局目录继续是 Kerminal 配置 workspace：

```text
~/.kerminal/
  AGENTS.md
  CLAUDE.md
  .codex/config.toml
  .mcp.json
  settings.toml
  profiles/
  hosts/
  snippets/
  workflows/
  data/
  agents/
```

会话目录是 Agent 启动 cwd：

```text
~/.kerminal/agents/sessions/<agentSessionId>/
  session.toml
  provider.toml
  AGENTS.md
  CLAUDE.md
  .codex/config.toml
  .mcp.json
  context/
    target-binding.json
    terminal-snapshot.json
    workspace-snapshot.json
    mcp-endpoint.json
  logs/
    agent-terminal.jsonl
    mcp-calls.jsonl
```

### 关键文件

`session.toml`：

```toml
schema_version = 1
agent_session_id = "ags_20260624_203124_ab12"
agent_id = "codex"
title = "Codex"
created_at = "2026-06-24T20:31:24+08:00"
updated_at = "2026-06-24T20:31:24+08:00"
status = "active"
workspace_root = "C:/Users/24052/.kerminal"
session_root = "C:/Users/24052/.kerminal/agents/sessions/ags_20260624_203124_ab12"

[launch]
command_label = "codex"
shell = "codex"
args = []
cwd = "C:/Users/24052/.kerminal/agents/sessions/ags_20260624_203124_ab12"

[target]
binding_id = "tb_..."
binding_generation = 3
pane_id = "pane-2"
tab_id = "tab-1"
target_terminal_session_id = "..."
target_ref = "ssh:prod-web-01"
target_kind = "ssh"
cwd = "/var/www/app"
shell = "bash"
live_status = "ready"
last_seen_at = "2026-06-24T20:31:24+08:00"
```

`provider.toml`：

```toml
schema_version = 1
provider = "codex"
provider_session_id = ""
resume_command = "codex resume --last"
resume_supported = true
last_resume_at = ""
```

`context/target-binding.json`：

```json
{
  "schemaVersion": 1,
  "agentSessionId": "ags_20260624_203124_ab12",
  "binding": {
    "bindingId": "tb_...",
    "generation": 3,
    "status": "ready",
    "stale": false,
    "paneId": "pane-2",
    "tabId": "tab-1",
    "targetTerminalSessionId": "...",
    "targetRef": "ssh:prod-web-01",
    "cwd": "/var/www/app",
    "shell": "bash"
  },
  "agentTerminal": {
    "sessionId": "...",
    "status": "running"
  },
  "generatedAt": "2026-06-24T20:31:24+08:00"
}
```

`context/terminal-snapshot.json`：

```json
{
  "schemaVersion": 1,
  "agentSessionId": "ags_20260624_203124_ab12",
  "targetTerminalSessionId": "...",
  "capturedBytes": 24576,
  "truncated": true,
  "redacted": true,
  "output": "...",
  "generatedAt": "2026-06-24T20:31:24+08:00"
}
```

`context/mcp-endpoint.json`：

```json
{
  "schemaVersion": 1,
  "agentSessionId": "ags_20260624_203124_ab12",
  "endpoint": "http://127.0.0.1:37657/mcp/agents/ags_20260624_203124_ab12",
  "transport": "streamable-http",
  "toolsOnly": true
}
```

### `AGENTS.md` / `CLAUDE.md` 读取策略

全局 `AGENTS.md`：

- 描述 Kerminal 文件优先配置布局。
- 明确可改与不可改目录。
- 明确 MCP 只用于 runtime tools，不用于 config CRUD。
- 给出 validator 命令。

会话目录 `AGENTS.md`：

- 第一段说明“你是 Kerminal 右栏启动的外部 Agent，会话 id 是 `<agentSessionId>`”。
- 指向 `context/target-binding.json` 和 `context/terminal-snapshot.json`。
- 指向全局配置目录 `../..` 或绝对路径。
- 指向 session-scoped MCP endpoint。
- 告诉 Agent：写入目标终端前先调用 `kerminal.agent.target_context`，如果 `stale = true` 必须要求用户重绑或确认。

会话目录 `CLAUDE.md`：

```md
@AGENTS.md
```

只初始化 Codex 和 Claude 文件。自定义 Agent 只获得会话目录、context 文件和用户自定义命令，不额外生成 provider 专属配置。

### MCP endpoint 设计

推荐新增 session-scoped endpoint：

```text
http://127.0.0.1:<port>/mcp
http://127.0.0.1:<port>/mcp/agents/<agentSessionId>
```

`/mcp/agents/<agentSessionId>` 的 handler 把 path 中的 session id 注入 execution context。全局 `/mcp` 保留给手动配置和兼容当前全局用法，但 Agent Launcher 默认写 session-scoped endpoint。

MCP 新增或调整 tools：

| Tool | 作用 | 是否默认带 session |
| --- | --- | --- |
| `kerminal.agent.current_session` | 返回当前 Agent 会话、cwd、workspace、provider、target binding | 是 |
| `kerminal.agent.target_context` | 返回 live/stale target、最近输出、cwd、tab/pane 元数据 | 是 |
| `terminal.resolve_agent_target` | 将 `agentSessionId` 映射到 target terminal session | 是 |
| `terminal.snapshot` | 读取指定或默认 target recent output | 默认 target |
| `terminal.write` | 写入指定或默认 target terminal | 默认 target，但 stale 时拒绝 |
| `terminal.list` | 列出 live terminal summaries，供用户重绑 | 否 |

安全规则：

- 所有 session-scoped tools 都必须校验 `agentSessionId` 是否存在。
- `terminal.write` 默认只能写入 `targetBindingId + generation` 仍匹配的 live target。
- `stale`、`closed`、`mismatch` 时，写入类 tools 拒绝；只读 snapshot 可返回最后文件快照并标注 stale。
- MCP host 仍负责审批；Kerminal 不恢复 pending/confirm。
- 不在 MCP resources/prompts 暴露上下文；上下文用 tools 和文件。

### 重启恢复模型

恢复层级：

| 层级 | P0 处理 | 说明 |
| --- | --- | --- |
| UI layout | 恢复 | 从 file-backed workspace session 恢复 tab/pane/sidebar/right-panel |
| Scrollback snapshot | 恢复最近片段 | 继续 bounded output history，不承诺完整历史 |
| Local PTY process | 不复活 | 重启后原 OS 子进程通常不存在 |
| SSH/tmux live session | P1/P2 | 有 tmux/远端 mux 时可重新 attach |
| Agent provider transcript | 尝试恢复 | 用 Codex/Claude 自己的 resume 能力，Kerminal 只保存 provider metadata |
| Target binding | 恢复为 stale 或 live | 如果 `TerminalManager` 还有 session，则 live；否则 stale |
| Command re-run | P2，默认关闭 | 只允许 whitelist + 用户可见可撤销，不自动重跑未知命令 |

启动流程：

1. App 启动读取 `~/.kerminal/workspace/session.json`。
2. 读取 `~/.kerminal/agents/sessions/*/session.toml`。
3. 与 `TerminalManager.list_sessions()` 交叉验证 live terminal。
4. 对不存在的 `targetTerminalSessionId` 标注 `stale`。
5. 右栏打开 AI 助手时显示三图标；如有上次活动 Agent，会在图标下方用极简状态点提示。
6. 用户点 Codex/Claude：
   - 如果该 provider 有 active Agent terminal，直接切到 terminal view。
   - 如果没有，但有可恢复 Agent session，弹出极简恢复选择：`继续上次` / `新会话`。
   - `继续上次` 用会话目录 cwd 启动 provider resume command。
7. 若 target stale，terminal header 显示小型 target chip 和 rebind 按钮，MCP 写入类 tools 拒绝，直到重绑。

### 右栏 UI 方案

保持极简，不做聊天 UI：

- Launcher 空态：居中三个 icon button：Codex、Claude、自定义。
- 不显示大段说明，不做卡片堆叠。
- 每个 icon 支持 tooltip：
  - Codex：打开 Codex
  - Claude：打开 Claude
  - Custom：输入命令
- 自定义点击后出现一行紧凑命令输入，提交后进入终端。
- 进入终端后：
  - 顶部 40-44px compact header。
  - 左侧 back icon，只返回 launcher，不关闭 terminal。
  - 中间 provider icon + title。
  - 右侧 target chip：`prod-web-01 · /var/www/app` 或 `未绑定` / `已失效`。
  - target chip 可点开 rebind sheet。
- 终端内容是 solid surface，避免玻璃影响可读性。
- 支持浅色、深色、跟随系统；portal/sheet 继承全局主题。

视觉约束：

- Apple-inspired workbench：安静、紧凑、系统字体、低噪声、少边框。
- 不做大卡片、不做 hero、不做装饰渐变。
- icon-only 控件必须有 aria-label 和 tooltip。
- Loading 文案用“加载 AI...”或“加载 Codex...”，启动后移除，不保留“正在启动本地终端”。

## 实施切片

### TASK-001：Agent session 数据模型与文件 store

新增 Rust service：

- `AgentSessionService`
- `AgentSessionFileStore`
- `AgentSessionIdGenerator`

能力：

- create/list/get/update/archive agent session。
- 写 `session.toml`、`provider.toml`、`context/*.json`。
- atomic write、schema version、坏文件跳过并返回诊断。

验收：

- Rust 单测覆盖 create、update、坏 TOML、atomic write、list ordering、archive。
- 不触碰 MCP server 主实现。

### TASK-002：workspace session 从 localStorage 迁到文件

新增 file-backed workspace session：

```text
~/.kerminal/workspace/session.json
```

迁移策略：

- 不兼容旧 SQLite。
- 可以短期从现有 `localStorage` 读一次并写入文件，但正式事实源改成 Rust file store。
- 前端 `useWorkspaceSessionPersistence` 改为调用 command，保留 debounce 和 `pagehide` flush。

验收：

- 前端测试覆盖 restore/save/debounce/pagehide。
- 文件坏了不白屏，回退默认 workspace 并给诊断。

### TASK-003：terminal binding 持久化和 stale 判断

扩展 `TerminalSessionBindingService`：

- 当前内存 registry 继续负责 live 双索引。
- 每次 register/ready/disconnected/closed/reconnected 写 bounded binding snapshot。
- App 启动时从文件恢复 metadata，但 live session 必须用 `TerminalManager` 验证。

验收：

- 重启模拟：binding 文件存在但 session 不存在，状态为 `stale`，写入类工具拒绝。
- 绑定 generation mismatch 时拒绝默认 target write。

### TASK-004：Agent Launcher 使用 agent session 而不是单个 activeTerminal

改前端状态：

- `activeTerminal` 改成 `agentSessions` + `activeAgentSessionId`。
- back 只切 view，不 unmount terminal。
- provider 图标点击根据 session 策略进入 existing/resume/new。
- 自定义命令写入 `session.toml`，但不初始化 custom provider config。

验收：

- 返回 launcher 再进来同一 Agent terminal 仍存在。
- Codex 和 Claude 可同时有独立 session。
- 自定义命令空值禁用，错误显示紧凑。

### TASK-005：会话目录 workspace 生成

扩展 `ExternalAgentWorkspaceService`：

- 保留全局 `~/.kerminal` 初始化。
- 新增 `prepare_agent_session_workspace(request)`：
  - 创建 session dir。
  - 生成会话 `AGENTS.md` / `CLAUDE.md`。
  - 生成 session `.codex/config.toml` / `.mcp.json`。
  - 写 env：
    - `KERMINAL_AGENT_SESSION_ID`
    - `KERMINAL_WORKSPACE_ROOT`
    - `KERMINAL_AGENT_SESSION_ROOT`
    - `KERMINAL_MCP_ENDPOINT`

验收：

- Codex/Claude 文件默认初始化。
- Custom 不生成 provider 专属配置。
- 管理块保留用户内容、dry-run/diff/backup 继续可用。

### TASK-006：session-scoped MCP tools

扩展 MCP execution context：

- path scoped agent session resolver。
- tools-only 不变。
- 新增 `kerminal.agent.current_session`、`kerminal.agent.target_context`、`terminal.resolve_agent_target`。
- `terminal.snapshot` / `terminal.write` 支持 default target。

验收：

- `initialize` 只声明 tools。
- `resources/prompts` 仍为空或 unsupported。
- 无 config CRUD。
- stale target 时 `terminal.write` 拒绝并返回可读错误。

### TASK-007：恢复与重绑 UI

新增极简 rebind sheet：

- 列出 live terminals：title、targetRef、cwd、最近活动时间。
- 选择后更新 `targetBindingId` 和 generation。
- stale chip 变 live。

验收：

- 多终端选择不会串。
- 重绑前写入工具拒绝，重绑后只写新绑定。

### TASK-008：Provider resume 策略

Codex：

- 保存 provider session metadata。
- 优先在 session cwd 调用 provider 自身 resume 能力；如果不能确定，就启动普通 `codex` 并让用户在 CLI 里选择。

Claude：

- 保存 provider session metadata。
- 支持用户/CLI 自己恢复 Claude transcript。

验收：

- provider resume 失败不影响 Kerminal session 文件。
- Kerminal target 状态仍由 binding 文件和 MCP resolver 决定。

### TASK-009：性能与清理

策略：

- session 列表只读 metadata，不读大 output。
- terminal snapshot bounded 24KiB/64KiB 可配置。
- workspace session save debounce 1s。
- JSONL log rotate by size/date。
- sessions 可归档。

验收：

- 100 个 agent session list 不卡 UI。
- 大输出不会导致启动读巨大文件。

### TASK-010：文档、验证和发布门禁

更新：

- `.updeng/docs/config/external-agent-workspace.md`
- `.updeng/docs/config/kerminal-config-files.md`
- README 的外部 Agent 描述
- 如需长期架构决策，再新增 ADR-0018。

验证：

- `cargo fmt --check`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_session`
- `cargo test --manifest-path src-tauri/Cargo.toml terminal_session_binding`
- `cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace`
- `cargo test --manifest-path src-tauri/Cargo.toml mcp_streamable_http_server`
- `npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/useWorkspaceSessionPersistence.test.ts`
- `npm run build`
- 真实 dev server smoke。
- 涉及 Tauri/MCP lifecycle 后跑 `npm run tauri:dev`。
- UI 改动必须截浅色、深色、跟随系统。

## 并行 lane 边界

当前 active lane 正在改 MCP tools-only 和测试/生产边界：

- `lane-mcp-tools-only-server-refactor`
- `lane-test-production-boundary-cleanup`

本计划开始实现前必须：

1. 移到 `plan/active/`。
2. 登记 `.updeng/docs/coordination/lanes.json`。
3. 读取上述 active lane 的计划、最新 diff 和 checkpoint。
4. 若触碰 `src-tauri/src/services/mcp_streamable_http_server.rs`、`src-tauri/src/state.rs`、`src-tauri/src/services/mod.rs`、`src/features/settings/**`、`README.md`，必须做最小兼容修改并记录 Round Log。

## 风险与防线

| 风险 | 防线 |
| --- | --- |
| 用户以为重启后原进程还活着 | UI 和 MCP 明确 `live/stale`，不伪装 |
| 多 Agent 写错终端 | `agentSessionId + bindingId + generation` 三重校验 |
| Agent 读不到上下文 | 会话 cwd 下写 `AGENTS.md`、`context/*.json` 和 session MCP config |
| session 文件过大拖慢启动 | metadata 与 snapshot 分离，bounded output，lazy load |
| 自动重跑命令造成破坏 | P0 不自动重跑；P2 也必须 whitelist + user-visible undo |
| 旧 AI 代码回流 | 负向扫描旧 AI/provider/custom MCP/skills 主链路 |
| secrets 泄露 | `secrets/` 默认禁读禁改，snapshot 脱敏 |

## 推荐执行顺序

1. 先做 TASK-001、TASK-005，让会话目录和文件上下文成形。
2. 再做 TASK-004，解决右栏返回和多 Agent session。
3. 再做 TASK-003、TASK-006，让 target binding 和 MCP 可靠。
4. 再做 TASK-002，把 workspace session 从 localStorage 移到文件。
5. 最后做 TASK-007 到 TASK-010。

这样能最快解决用户当前痛点，同时不会一开始就撞进 MCP tools-only active lane 的最大冲突面。

## Round Log

- 2026-06-24T20:31:24+08:00：创建 next 计划。调研了 Otty session recovery / OSC-88、Codex MCP/config/AGENTS、Claude MCP/memory/CLI 入口，复核了当前 Kerminal workspace session、TerminalManager、TerminalSessionBindingService、AgentLauncher、ExternalAgentWorkspace 和 MCP tools-only 实现。计划仅写文档，未改生产代码。
- 2026-06-24T20:56:25+08:00：用户要求继续采用不限制数量的并行策略代码落地；计划从 next 激活为 active。当前主工作区已有 Apple glass、test boundary 等 active lane 和大量未归因改动，本任务采用同工作区最小合并策略，先登记 lane，再把 Rust session store、workspace 生成、前端 launcher、MCP/session resolver 拆给并行 worker。
- 2026-06-24T21:20:28+08:00：完成右栏 AgentLauncher TASK-004 前端切片。`src/features/tool-panel/AgentLauncherToolContent.tsx` 从单 `activeTerminal` 改为 `agentSessions` map + `activeAgentSessionId`，session 持有 `agentSessionId/cwd/env/shell/args/title/status`，back 仅返回 launcher 并保留已启动 terminal；Codex/Claude 独立 session 可并存，自定义空命令禁用且自定义命令不会覆盖 provider session。同步更新 `src/features/tool-panel/AgentLauncherToolContent.test.tsx` 和 `src/lib/agentLauncherApi.ts` 的可选 `agentSessionId/status` 类型。验证：`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts` 通过，`npm run typecheck` 通过；`npm run build` 的 `tsc` 阶段通过后 Vite production transform 长时间无输出，已定点停止；dev server `127.0.0.1:63988` 启动并 HTTP 200，但系统 Chrome 渲染为空白/后续 DOMContentLoaded 超时；`npm run dev:force -- --host 127.0.0.1 --port 59103 --strictPort` 启动后首页请求 10s 超时，停止时输出 `fatal error: all goroutines are asleep - deadlock!`，按当前工作区既有 Vite transform/启动阻断记录为未通过风险。
- 2026-06-24T21:12:46+08:00：完成 terminal binding 的 Agent target resolver 基础切片。`src-tauri/src/services/terminal_session_binding_service.rs` 新增 `agentSessionId -> target binding` 内存模型、显式 `resolve_agent_target`、write guard、live/stale/closed 判定和 rebind generation；`src-tauri/tests/terminal_session_binding_service.rs` 覆盖 live target、stale target 写入拒绝、generation mismatch、rebind generation 递增和 closed 写入错误。验证：`rustfmt --edition 2021 --check src-tauri/src/services/terminal_session_binding_service.rs src-tauri/tests/terminal_session_binding_service.rs` 通过；`cargo test --manifest-path src-tauri/Cargo.toml --test terminal_session_binding_service` 通过 14 tests；`git diff --check -- src-tauri/src/services/terminal_session_binding_service.rs src-tauri/tests/terminal_session_binding_service.rs` 通过。`cargo test --manifest-path src-tauri/Cargo.toml terminal_session_binding` 被当前其它 lane 的 `tests/mcp_streamable_http_server.rs` 缺少 `PrepareExternalAgentWorkspaceRequest.agent_session_id` 编译错误挡住，未改该文件。
- 2026-06-24T21:21:17+08:00：完成 workspace session file-backed 前端边界草案。新增 `src/lib/workspaceSessionApi.ts`，约定 Tauri command `workspace_session_load` / `workspace_session_save`，目标事实源为 `~/.kerminal/workspace/session.json`；`workspaceSessionStorage` 改为优先 file API，file API 不可用或失败时短期 fallback `localStorage`，并支持旧 `localStorage` session 在文件为空时尝试迁移写入文件；`useWorkspaceSessionPersistence` 改为 async restore、file API save fire-and-forget，同时保留 debounce、volatile-only stable key、`pagehide` 和 unmount flush。测试 mock file API，覆盖 file load、file save、debounce、pagehide/unmount flush、file API 失败 localStorage fallback。验证：`npm run test:frontend -- src/app/useWorkspaceSessionPersistence.test.ts` 通过 9 tests；`npm run typecheck` 通过；`npm run build` 通过，首次因并行 build/Vite transform 长时间无输出被终止后重试成功；`npm run dev -- --host 127.0.0.1 --port 5191 --strictPort` 启动，`Invoke-WebRequest http://127.0.0.1:5191/` 返回 200，随后停止该 dev server。未提交，等待 lane 汇总。
- 2026-06-24T21:23:11+08:00：同步 MCP tools-only done lane 和本 active lane 的共享文件状态，复测先前 `PrepareExternalAgentWorkspaceRequest.agent_session_id` 缺字段编译错误已由当前磁盘状态收敛；补充会话级 `AGENTS.md` 模板中的 `Agent title`，删除旧 runtime `SqliteStore::with_connection_mut` 死代码以清理本轮 Rust warning。验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml`，`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`，`cargo test --manifest-path src-tauri/Cargo.toml mcp`，`cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace`，`cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation`，`npm run test:frontend -- src/features/settings/SettingsToolContent.mcp.test.tsx src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsToolContent.appearance-theme.test.tsx src/lib/mcpServerApi.test.ts`，`npm run build`，Vite dev server HTTP smoke。`npm run tauri:dev` 完成 Rust dev 编译并启动 exe，但仍因真实用户 `~/.kerminal/kerminal.db` 为 schema 30、当前支持 schema 3 而 panic，未修改用户数据。
- 2026-06-24T22:05:00+08:00：继续完成 Agent session 与右栏 launcher 的关键接线。`src-tauri/src/services/mcp_tool_executor_service/execution.rs` 接入 `terminal.snapshot`、`terminal.resolve_agent_target`、`kerminal.agent.current_session`、`kerminal.agent.target_context`，并让 `terminal.write` 使用 `TerminalSessionBindingService` 的 agent target generation guard；`src-tauri/src/services/mcp_tool_executor_service.rs` 补齐 executor 子模块需要的 `AgentSessionId`、`AgentSessionService` 和 `AgentTargetBindingSnapshot` imports。前端 `src/lib/agentLauncherApi.ts` 新增 `agent_session_create` API、Agent target request 类型和 snake/camel session id 归一化；`src/features/tool-panel/AgentLauncherToolContent.tsx` 在启动 Codex/Claude/custom 前创建真实 Rust `agentSessionId`，从 `focusedPane + terminalSessionRegistry` 固化 target terminal 绑定，再把 id 传给 `prepare_external_agent_workspace`，移除 `local-*` 伪会话兜底；`src/features/terminal/terminalSessionRegistry.ts` 导出只读 pane session record；`ToolPanel` 透传 `activeTab` / `focusedPane`。验证通过：`npm run typecheck`，`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx`，`cargo test --manifest-path src-tauri/Cargo.toml --test agent_session_service`，`cargo test --manifest-path src-tauri/Cargo.toml --test terminal_session_binding_service`，`cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace`，`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`，`cargo test --manifest-path src-tauri/Cargo.toml mcp`，`cargo fmt --manifest-path src-tauri/Cargo.toml --check`，`cargo check --manifest-path src-tauri/Cargo.toml --lib`，`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/useWorkspaceSessionPersistence.test.ts`，`npm run build`。Vite dev server `http://127.0.0.1:5192/` HTTP smoke 返回 200；尝试用 headless Edge 采集 Agent Launcher 截图时 DOM probe 为空、截图为空白，未作为视觉通过证据，后续仍需真实窗口截图补门禁。
- 2026-06-24T22:09:32+08:00：补齐右栏对已持久化 Agent session 的恢复入口。`src/lib/agentLauncherApi.ts` 新增 `agent_session_list` API 和 `agentSessionRecordAgentId` helper；`AgentLauncherToolContent` mount 时读取 `agent_session_list`，点击 Codex/Claude 时先复用最新 persisted `agentSessionId`，若列表尚未加载完成则点击路径主动补读一次，仍找不到才创建新 session；自定义命令仍按显式命令创建新 session。新增测试覆盖 persisted Codex session 复用，防止回退到误建新会话。验证通过：`npm run typecheck`，`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx`，`npm run build`。
- 2026-06-24T22:55:56+08:00：完成 Agent target stale/rebind P0 切片。后端 `src-tauri/src/commands/agent_session.rs` 新增显式 `agent_session_rebind_target` command，重绑时先校验 `agentSessionId` 存在，再通过 `TerminalSessionBindingService.save_agent_target_binding` 生成新的 binding id/generation，并写回 `session.toml` 与 `context/target-binding.json`；`src-tauri/src/commands/registry.rs` 注册该命令。前端 `src/lib/agentLauncherApi.ts` 新增 `rebindAgentSessionTarget`、`agentSessionRecordTarget` 和 target snake/camel 归一化；`src/features/terminal/terminalSessionRegistry.ts` 新增只读 live pane/session 列表；`src/features/tool-panel/AgentLauncherToolContent.tsx` 让右栏 Agent terminal session 持有 target 元数据，header 显示 compact target chip（`未绑定`/`已失效`/`target · cwd`），点击后列出 live 终端并可重绑，过滤掉 `agent-terminal-*`，避免把右栏 Agent 自己的 PTY 列为目标；重绑成功后刷新 session target 与 persisted session list。`src/features/tool-panel/AgentLauncherToolContent.test.tsx` 覆盖 focused pane 初始绑定、target chip 展示和重绑调用 payload。顺手修复 `src-tauri/src/services/external_agent_workspace.rs` Claude managed block `format!` 参数数量错误，该错误会阻断 Rust 验证。验证通过：`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx`，`npm run typecheck`，`cargo fmt --manifest-path src-tauri/Cargo.toml --check`，`cargo check --manifest-path src-tauri/Cargo.toml --lib`，`cargo test --manifest-path src-tauri/Cargo.toml --test agent_session_service`，`cargo test --manifest-path src-tauri/Cargo.toml --test terminal_session_binding_service`，`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/useWorkspaceSessionPersistence.test.ts`，`npm run build`，`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`，`$env:CARGO_BUILD_JOBS='1'; cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace`，Vite dev server `http://127.0.0.1:5193/` HTTP smoke 返回 200。`cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace` 的宽过滤写法会编译大量无关 integration tests，本机 Windows page file 不足导致 rustc/OOM/metadata/ICE 类失败，已改用单 lib 测试过滤通过。视觉验证：已按前端与 Apple-inspired 技能检查实现；但本机 Playwright 无浏览器、Edge headless 访问 Vite 页面仍超时，未形成可信截图证据；后续仍需真实 WebView/浏览器截图补 UI 门禁。子 agent `019efa1d-70c2-78b0-ad38-17c738553e71` 只读审查尝试启动后无法取回，工具返回 `not_found`，未作为审查证据。
- 2026-06-24T23:15:42+08:00：完成持久 Agent target binding hydration 切片。新增 `src-tauri/src/services/agent_target_hydration_service.rs`，在读取 persisted `session.toml` 后按 `session.target` 恢复 `TerminalSessionBindingService` 的运行态 agent target binding，再用当前 live terminal id 列表解析 ready/stale；hydration 不改变 session 排序时间，只在 binding id/generation/live status 或 `context/target-binding.json` 缺失时写回文件。`src-tauri/src/commands/agent_session.rs` 的 `agent_session_get/list` 接入 hydration，重启后右栏 persisted session 能显示 stale/ready target；`src-tauri/src/services/mcp_tool_executor_service/terminal_tools.rs` 与 `execution.rs` 让 `terminal.snapshot`、`terminal.write`、`terminal.resolve_agent_target`、`kerminal.agent.current_session` 和 `kerminal.agent.target_context` 在默认 `agentSessionId` target 解析前先 hydrate，避免重启后因 runtime map 为空报 `agent target binding not found`。新增 `src-tauri/tests/agent_target_hydration_service.rs` 覆盖从文件恢复 runtime binding、目标不 live 写回 stale 且写入拒绝、closed persisted target 不被复活。验证通过：`cargo test --manifest-path src-tauri/Cargo.toml --test agent_target_hydration_service`，`cargo fmt --manifest-path src-tauri/Cargo.toml --check`，`cargo check --manifest-path src-tauri/Cargo.toml --lib`，`cargo test --manifest-path src-tauri/Cargo.toml --test agent_session_service`，`cargo test --manifest-path src-tauri/Cargo.toml --test terminal_session_binding_service`，`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`，`npm run typecheck`，`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/useWorkspaceSessionPersistence.test.ts`，`npm run build`，Vite dev server `http://127.0.0.1:5194/` HTTP smoke 返回 200 后已按端口停止进程。剩余门禁：本轮未新增 UI 截图；上一轮记录的 Playwright/Edge 截图环境问题仍需后续真实 WebView 或浏览器截图补齐。
- 2026-06-24T23:43:46+08:00：补齐 TASK-008 Provider resume 与 TASK-002 workspace session command 级测试缺口。`src-tauri/src/services/external_agent_workspace.rs` 的 `PrepareExternalAgentWorkspaceRequest` 新增 `resumeProviderSession`，右栏选择“继续上次”时 Codex 会按 `provider.toml` 或默认 provider metadata 启动 `codex resume --last`，Claude 在没有明确 `resume_command` 时回退普通 `claude`，Custom 仍只使用用户显式命令；prepare 会把实际 launch command 同步回已存在的 `session.toml`，但不依赖或修改旧内置 AI 链路。`src/features/tool-panel/AgentLauncherToolContent.tsx` 新增 persisted Codex/Claude 极简恢复选择（继续上次 / 新会话 / 取消），继续上次传 `resumeProviderSession: true`，新会话创建新 `agentSessionId` 后传 `false`；补充 Claude persisted 恢复、新会话分支和 stale chip `已失效` 断言。新增 `src-tauri/tests/workspace_session.rs` 覆盖 `workspace/session.json` 缺失、保存/回读、拒绝非 object、坏 JSON/non-object fallback。验证通过：`cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace`，`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`，`cargo check --manifest-path src-tauri/Cargo.toml --lib`，`cargo fmt --manifest-path src-tauri/Cargo.toml --check`，`cargo test --manifest-path src-tauri/Cargo.toml --test workspace_session`，`npm run typecheck`，`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/useWorkspaceSessionPersistence.test.ts`（23 tests），`npm run build`，Vite dev server `http://127.0.0.1:5196/` HTTP smoke 返回 200 后已停止。补充的 `cargo test --manifest-path src-tauri/Cargo.toml --test agent_session_service --test agent_target_hydration_service --test terminal_session_binding_service` 因 artifact lock 长时间等待被中止，本轮未把它作为新证据；这些测试在上一轮 Round Log 已通过且本轮未修改相关模块。剩余门禁仍是缺真实浅色/深色/跟随系统 UI 截图，以及 `npm run tauri:dev` 仍受真实用户 `~/.kerminal/kerminal.db` schema 30 高于当前支持 schema 3 阻塞，未修改用户数据。
- 2026-06-25T00:06:49+08:00：完成本轮方案收口审计和文档 cwd 纠偏。`README.md`、`.updeng/docs/config/external-agent-workspace.md`、`.updeng/docs/config/kerminal-config-files.md` 已统一为“全局 `~/.kerminal` 是配置根；右栏每个 Agent 默认 cwd 是 `~/.kerminal/agents/sessions/<agentSessionId>`；会话目录持有 session-scoped MCP 配置和目标绑定上下文”。复查 `src-tauri/tests/mcp_streamable_http_server.rs`，确认 `/mcp/agents/<agentSessionId>` 能在无显式参数时注入 session 并让 `kerminal.agent.current_session` 返回对应 session。验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`，`cargo check --manifest-path src-tauri/Cargo.toml --lib`，`npm run typecheck`，`$env:CARGO_BUILD_JOBS='1'; cargo test --manifest-path src-tauri/Cargo.toml --test agent_session_service --test agent_target_hydration_service --test terminal_session_binding_service --test workspace_session --test mcp_streamable_http_server`，`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/useWorkspaceSessionPersistence.test.ts`（23 tests），`npm run build`，Vite dev server `http://127.0.0.1:5197/` HTTP smoke 返回 200 并停止。UI 截图门禁仍未形成可信证据：本机没有 `node_modules/playwright`，Chrome/Edge headless CLI 对当前 dev server 的 `--screenshot` / `--dump-dom` 没有生成有效输出，现有 `agent-launcher-session-ui-20260624.png` 为白屏；需用真实 WebView/浏览器补浅色、深色、跟随系统和右栏 Agent terminal/rebind 截图。`npm run tauri:dev` 本轮未再运行，因为 `AppState::initialize()` 仍使用真实系统 home，上一轮已确认会因用户真实 `~/.kerminal/kerminal.db` schema 30 高于当前支持 schema 3 panic；本轮不修改用户数据。
- 2026-06-25T01:50:00+08:00：补齐本轮生产级边界修正。前端 `src/app/KerminalShell.tsx` 去掉终端工作区对右栏的重复 `contentRightInset`，现在右栏由 shell grid 独立占列，避免打开 Agent Launcher 后中间空态被二次 margin 挤压；`src/app/KerminalShell.test.tsx` 改为断言终端内容不再写入 `margin-right`。后端 `src-tauri/src/commands/agent_session.rs` 在创建和重绑 Agent target 前校验目标 terminal session 必须仍是 live，且拒绝把 `agent-terminal-*` 右栏 Agent 自己的 pane 绑定成目标；新增 `src-tauri/tests/agent_session_command.rs` 覆盖非 live target 不留下半初始化 session、rebind 拒绝缺失目标和 Agent terminal pane。验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml`，`npm run typecheck`，`npm run test:frontend -- src/app/KerminalShell.test.tsx src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/useWorkspaceSessionPersistence.test.ts`（49 tests），`cargo check --manifest-path src-tauri/Cargo.toml --lib`，`$env:CARGO_BUILD_JOBS='1'; cargo test --manifest-path src-tauri/Cargo.toml --test agent_session_command --test agent_session_service --test agent_target_hydration_service --test terminal_session_binding_service --test workspace_session --test mcp_streamable_http_server`，`cargo fmt --manifest-path src-tauri/Cargo.toml --check`，`npm run build`。独立 Vite dev server `http://127.0.0.1:5198/` HTTP smoke 返回 200 后停止。真实 Tauri 使用临时 home、真实 `RUSTUP_HOME/CARGO_HOME` 和 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9334 --disable-gpu'` 启动成功，避开真实用户旧 schema DB；通过 WebView2 CDP 点击右栏 Agent Launcher 并截图 `.updeng/docs/verification/agent-session-tauri-webview-20260625-launcher-layout-fixed.png`，DOM 证据显示打开前后 `[data-terminal-workspace-content]` 的 `style` 均为空，打开后终端工作区宽 688px、右栏 Agent 区宽 511px，`Codex` / `Claude` / `自定义` 均可见。Tauri dev 已 Ctrl-C 退出，`Get-Process kerminal` 未返回残留进程。浅色/跟随系统未单独重新截图；本次布局改动使用主题无关的 grid/margin 逻辑，已有相邻主题测试和深色 WebView 截图作为本轮证据。
- 2026-06-25T02:45:46+08:00：完成最终 current-state 审计并收口为 done。按 TASK-001 至 TASK-010 复核当前代码与证据：`AgentSessionService` / `AgentSessionFileStore` 覆盖 create/get/update/archive、坏 TOML/JSON 诊断、list ordering、100 session metadata-only、snapshot bounded 与 MCP call log rotation；workspace session command 覆盖缺失、坏 JSON、保存/回读和 non-object 拒绝；terminal binding/hydration 覆盖 stale、closed、generation mismatch、rebind generation 和重启后 runtime binding 恢复；右栏 `AgentLauncherToolContent` 覆盖 Codex/Claude/custom、返回不关闭 terminal、persisted resume、新会话、stale chip、rebind 和 custom 空命令禁用；`ExternalAgentWorkspaceService` 已确认 Codex/Claude 生成 provider 配置，Custom 只生成通用 session context 且不生成 provider 专属配置；MCP server 测试确认 tools-only、移除配置/UI/history 写入类 tools、`/mcp/agents/<agentSessionId>` 注入默认 session、拒绝 scoped endpoint 上显式 `sessionId` 绕过。定向旧 AI/provider/custom MCP/custom skills 残留扫描仅剩 `src/lib/mcpServerApi.test.ts` 中 `listToolRegistry` 不存在的断言；未发现旧主链路活代码。当前验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`，`npm run typecheck`，`$env:CARGO_BUILD_JOBS='1'; cargo test --manifest-path src-tauri/Cargo.toml --test agent_session_command --test agent_session_service --test agent_target_hydration_service --test terminal_session_binding_service --test workspace_session --test mcp_streamable_http_server`，`npm run test:frontend -- src/app/KerminalShell.test.tsx src/features/tool-panel/AgentLauncherToolContent.test.tsx src/app/useWorkspaceSessionPersistence.test.ts`（49 tests），`npm run build`，`cargo check --manifest-path src-tauri/Cargo.toml --lib`，独立 Vite dev server `http://127.0.0.1:5199/` HTTP smoke 返回 200 并停止。运行态 UI 证据复核：`.updeng/docs/verification/agent-session-tauri-webview-20260625-launcher-layout-fixed.png` 展示右栏 Codex/Claude/自定义三入口和正常布局，`.updeng/docs/verification/agent-session-tauri-webview-20260625-snapshot-context-cdp.png` 展示当前 WebView 非白屏与右栏/中间布局；本轮未重新跑 `npm run tauri:dev`，采用 2026-06-25T01:50 隔离临时 home 的真实 Tauri/WebView2 smoke 与截图证据作为运行态门禁补充，避免触碰用户真实旧 schema 数据库。
