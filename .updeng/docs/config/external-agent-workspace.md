# Kerminal 外部 Agent 工作目录方案

## 目标

`~/.kerminal` 是 Kerminal 默认本地根目录，承担全局配置 workspace 职责。右栏启动的 Codex/Claude/custom Agent 默认进入 `~/.kerminal/agents/sessions/<agent-session-id>` 会话目录；会话目录写入自己的 `AGENTS.md`、`CLAUDE.md`、`.codex/config.toml`、`.mcp.json` 和 `context/*.json`，连接 session-scoped Kerminal MCP Server、操作 live app 能力、修改文件化配置并运行校验。全局 `~/.kerminal` 仍保存配置事实源和通用规则；自定义 agent 只在用户输入命令并选择运行时使用会话 workspace，Kerminal 不默认为它初始化 provider 专属配置。

路径口径必须跨平台：`~/.kerminal` 表示当前用户 home 下的 Kerminal 根目录，适用于 Windows、macOS 和 Linux。生成模板、配置手册和示例不要写成分发者机器上的固定目录。`~/.ssh/id_ed25519` 可作为 SSH/SFTP 私钥路径示例，Kerminal 会在本地私钥路径中展开 `~`、`~/...` 和 `~\...`；不支持 `~otheruser/...`。

## 推荐目录

```text
~/.kerminal/
  AGENTS.md
  CLAUDE.md
  kerminal-config.md
  .codex/
    config.toml
  .mcp.json
  agents/
    sessions/<agent-session-id>/
      AGENTS.md
      CLAUDE.md
      context/mcp-endpoint.json
      context/target-binding.json
      context/terminal-snapshot.json
      .codex/config.toml
      .mcp.json
  settings.toml
  profiles/
  hosts/
    groups.toml
  snippets/
  workflows/
  data/
    command.sqlite
    port-forwards/
  logs/
    local-file-operations/
  cache/
  exports/
  temp/
  secrets/
    vault-key.toml
    vault.toml
```

规则：

- `AGENTS.md` / `CLAUDE.md` 是入口规则；它们必须说明这是 Kerminal runtime workspace，不是源码仓库，并说明何时用 MCP 操作 live app、何时直接改配置文件。
- `kerminal-config.md` 是配置文件详细手册，包含用途、关联关系、字段含义、示例、禁止项和校验入口。Agent 修改配置前必须先读 `kerminal-config.md`。
- `agents/sessions/<agent-session-id>/AGENTS.md` 是从右栏某个 Agent session 打开时的会话级规则；`context/mcp-endpoint.json` 提供 session-scoped MCP endpoint 和环境变量，`context/target-binding.json` 提供初始化时的目标绑定 seed，`context/terminal-snapshot.json` 提供空快照 seed。live 目标解析和终端读取由 `kerminal.agent.target_context` / `terminal.snapshot` 刷新这些 context 文件。
- `settings.toml`、`profiles/`、`hosts/`、`snippets/`、`workflows/` 是默认允许外部 agent 修改的主区域。
- Kerminal 运行中会监听这些文件型配置变更并自动刷新界面；刷新成功时显示简洁自动关闭提示，例如 `cfg: +1 host "staging-api"`。坏 TOML 会保留 last-known-good UI，并提示 invalid。自动刷新不替代 `kerminal.config.validate`。
- `profiles/*.toml` 的 `cwd` 示例使用 `~/.kerminal`；shell 示例要同时覆盖 macOS/Linux 的 `zsh`/`bash` 和 Windows 的 `pwsh`，不要只保留 Windows-only 口径。
- `hosts/*.toml` 的私钥路径示例使用 `credential_ref = "~/.ssh/id_ed25519"`；这是当前用户 home 相对路径，不能改成某台电脑的绝对 home 路径。
- `terminal.*`、`kerminal.agent.*`、`ssh.command*`、`sftp.*`、`tmux.*`、`container.*`（包含 `container.files.list`、`container.files.preview`、`container.files.write_text`、`container.files.upload`、`container.files.download`、`container.files.create_directory`、`container.files.rename`、`container.files.chmod`、`container.files.delete`）、`port_forward.*`、`server_info.snapshot`、`history.search`、`diagnostics.*`、`kerminal.app_guide`、`kerminal.config_guide`、`kerminal.capabilities`、`kerminal.tool_help`、`kerminal.operation_guide`、`kerminal.runtime_snapshot`、`kerminal.host.upsert_with_credential` 和 `kerminal.vault.encrypt_secret` 是外部 agent 操作 live Kerminal、读取同源配置规则与授权保存凭据的主要 MCP tools。
- `kerminal.app_guide` 是外部 agent 的应用导航入口，用于读取 Kerminal 左栏、终端工作区、右栏工具、Agent 会话和配置 workspace 与 MCP 工具族的对应关系；它不执行 UI 编排。
- `kerminal.config_guide` 是配置规则入口，返回与生成的 `kerminal-config.md` 同源的文件型配置手册；它只读，不执行 settings/profile/host/snippet/workflow CRUD。
- `kerminal.capabilities` 是外部 agent 的 MCP 自发现入口，用于读取当前工具地图、推荐起步调用、会话 context 文件、文件型配置边界和故意不提供的 MCP CRUD/UI 编排工具族。
- `kerminal.tool_help` 是外部 agent 的具体工具帮助入口，按 `toolId`、`family` 或 `query` 返回当前暴露 MCP tool 的 input schema、示例参数、安全标注和缺席工具族替代路径；它只读，不执行被引用工具。
- `kerminal.operation_guide` 是外部 agent 的任务意图操作指南，用于按 `terminal`、`session-terminal`、`ssh-command`、`config`、`sftp`、`tmux`、`container`、`port-forward`、`server-info`、`history`、`credentials`、`diagnostics` 等 intent 获取推荐工具调用顺序、安全停顿条件和 fallback。
- `kerminal.runtime_snapshot` 是外部 agent 的运行态概览入口，用于一次读取当前终端、Agent session、端口转发、本机代理入口和下一步建议；它不读取 secrets，不替代 `terminal.list`、`terminal.snapshot`、`kerminal.agent.target_context` 等细节工具。
- `settings.*`、`profile.*`、`remote_host.*`、`snippet.*`、`workflow.*` 这类配置 CRUD 不进入 Kerminal MCP tools；agent 应直接改文件。
- `workspace.*`、`terminal.create`、`terminal.resolve_current` 等 UI 编排或前端焦点动作不进入 Kerminal MCP tools。
- `history.record`、`history.delete`、`history.clear` 不进入外部 MCP tools；命令历史查询只通过 `history.search` 读取。
- `secrets/` 默认禁止读取和修改，除非用户明确要求处理凭据。新增/修改主机凭据走 encrypted vault：用户通过 UI 保存或 AI 助手调用 `kerminal.host.upsert_with_credential` / `kerminal.vault.encrypt_secret` 工具，公开 `hosts/*.toml` 只写 `secret_ref` / `key_passphrase_ref` 等 vault 引用。`secrets/vault-key.toml` 必须保留在 `.gitignore` 中（已默认忽略），不能提交；`secrets/vault.toml` 可随 workspace 提交。
- `logs/`、`cache/`、`temp/` 默认只读或忽略。
- `data/command.sqlite` 只由 Kerminal 管理；agent 需要命令历史时优先通过 MCP tool，不手写 SQL。

## Codex 配置

Codex 支持项目级 `.codex/config.toml`。Kerminal 应生成或更新：

```toml
[mcp_servers.kerminal]
url = "http://127.0.0.1:37657/mcp"
default_tools_approval_mode = "prompt"
tool_timeout_sec = 60
enabled = true
```

实际端口以 Kerminal MCP Server 运行态返回的 endpoint 为准；如果默认端口被占用，Kerminal 会选择可用端口并更新 Codex/Claude 配置中的 Kerminal 管理片段。

启动策略：

- 默认在右栏 Agent Launcher 的内嵌本地终端中，cwd 为 `~/.kerminal/agents/sessions/<agentSessionId>`，运行 `codex`。Windows 通过本地命令包装器启动 CLI；macOS/Linux 直接按用户 PATH 中的 CLI 启动。
- 如果要强制工作目录，应使用当前会话目录；全局 `~/.kerminal` 只作为配置根，不作为右栏 Agent 默认 cwd。
- 如果 Codex CLI 不存在，展示安装/检测失败状态，并提供复制配置和打开目录按钮。

## Claude Code 配置

Claude Code 的项目级 MCP 配置使用项目根 `.mcp.json`。Kerminal 应生成或更新：

```json
{
  "mcpServers": {
    "kerminal": {
      "type": "http",
      "url": "http://127.0.0.1:37657/mcp",
      "timeout": 60000
    }
  }
}
```

`CLAUDE.md` 默认内容：

```md
@AGENTS.md

## Claude Code

- Treat this directory as the Kerminal runtime workspace, not a source-code repository.
- Follow `AGENTS.md` first.
- Operate Kerminal through MCP for live terminal, SSH/SFTP, tmux, container, port forwarding, server info, history, diagnostics, runtime snapshot, and authorized credential saving work.
- Call `kerminal.app_guide` when you need the product/UI structure map; call `kerminal.capabilities` when you need the current tool map or config/tool boundary; call `kerminal.tool_help` with `toolId`, `family`, or `query` when you need exact schemas, examples, and safety annotations; call `kerminal.config_guide` when you need the generated configuration rules through MCP; call `kerminal.operation_guide` with an intent such as `terminal`, `session-terminal`, `ssh-command`, `config`, `sftp`, `tmux`, `container`, `port-forward`, `server-info`, `history`, `credentials`, or `diagnostics` when you need a concrete tool sequence; call `kerminal.runtime_snapshot` when you need the current running terminals, Agent sessions, port forwards, and next actions.
- MCP host policy owns confirmation, approval, permissions, hooks, and audit; Kerminal does not provide a second pending/confirm queue.
- In a session workspace, read `context/mcp-endpoint.json`, `context/target-binding.json`, and `context/terminal-snapshot.json`, then use `kerminal.agent.target_context` before `terminal.write`.
- When writing to the bound terminal, pass `agentSessionId`, the returned `bindingGeneration`, and `data`.
- Before editing Kerminal configuration files, read `kerminal-config.md`.
- After editing Kerminal configuration files, call MCP tool `kerminal.config.validate` with `scope = "all"` or the narrowest matching scope. If MCP validation is unavailable, manually check `kerminal-config.md` and say validation was manual only.
- Prefer direct file edits for file-backed Kerminal configuration.
- Use the Kerminal MCP server only for runtime actions that require the live app, an existing terminal session, saved connection credentials, SSH/SFTP, tmux, containers, port forwarding, server info, history, diagnostics, runtime snapshot, or authorized credential saving.
- Useful runtime tool families include `terminal.*`, `kerminal.agent.*`, `ssh.command`, `ssh.command_on_resolved_host`, `sftp.*`, `tmux.*`, `container.*` including `container.files.*` (`container.files.list`, `container.files.preview`, `container.files.write_text`, `container.files.upload`, `container.files.download`, `container.files.create_directory`, `container.files.rename`, `container.files.chmod`, `container.files.delete`), `port_forward.*`, `server_info.snapshot`, `history.search`, `diagnostics.*`, `kerminal.app_guide`, `kerminal.config_guide`, `kerminal.capabilities`, `kerminal.tool_help`, `kerminal.operation_guide`, `kerminal.runtime_snapshot`, `kerminal.host.upsert_with_credential`, and `kerminal.vault.encrypt_secret`.
- Do not use Kerminal MCP tools for settings, profile, host, snippet, or workflow CRUD when direct file edits can express the change.
- Do not expect MCP tools for config CRUD or UI choreography such as `settings.*`, `profile.*`, `remote_host.*`, `snippet.*`, `workflow.*`, `workspace.*`, `terminal.create`, `terminal.resolve_current`, or history write/delete/clear operations.
- Do not edit `data/command.sqlite` directly; use `history.search` when command history is needed.
- Do not edit `secrets/` unless the user explicitly asks; when authorized, follow `kerminal-config.md` and use the UI save flow, `kerminal.host.upsert_with_credential`, or `kerminal.vault.encrypt_secret` so ordinary host files only keep `secret_ref` / `key_passphrase_ref`; never write `password`, `credential_secret`, or `inline_private_key` into ordinary config files.
```

启动策略：

- 默认在右栏 Agent Launcher 的内嵌本地终端中，cwd 为 `~/.kerminal/agents/sessions/<agentSessionId>`，运行 `claude`。Windows 通过本地命令包装器启动 CLI；macOS/Linux 直接按用户 PATH 中的 CLI 启动。
- 让 Claude Code 自己加载 `.mcp.json` 和 `CLAUDE.md`。

## 右栏 Agent 终端兼容口径

右栏 Agent Launcher 继续启动真实 Codex、Claude 或自定义 CLI 进程，并运行在真实 PTY 里的 xterm 终端中。Kerminal 不把 Agent TUI 替换成内置聊天框，也不接管模型 provider、审批、权限、hook 或审计；这些仍由外部 Agent host 负责。

Agent 终端使用专门的 `agentTui` 输入兼容模式：

- `Enter` 发送回车，用于提交当前 prompt。
- `Shift+Enter` 发送 LF，用于 Codex/Claude prompt 多行换行。
- `Ctrl+J` 保持发送 LF，作为多行输入 fallback。
- 终端 DOM 聚焦时，Kerminal 应用级快捷键让渡给终端，避免抢走 `Shift+Enter`、`Ctrl+J`、`Ctrl+C`、`Esc`、`Tab`、`Shift+Tab`、方向键、Alt/Meta 和粘贴类输入。
- 粘贴走 xterm paste 路径，支持 bracketed paste；IME composition 期间不做键盘 override，避免打断中文输入法组合。
- xterm mouse reporting、selection、alternate screen、resize、scrollback 和 clear screen 属于终端兼容矩阵，修改 xterm、右栏布局或 Agent Launcher 时必须回归。

右栏空间不足会影响全屏 TUI。Kerminal 按实际 fit 后的 `cols x rows` 检测 Agent terminal 尺寸，低于 `80x24` 时提示用户拖宽右栏获得完整 TUI。后续若实现“移到中间 workspace tab”或独立窗口，也必须保持同一 PTY/session，不应重启 Agent 进程。

右栏 Agent workflow 辅助层只做真实终端输入辅助，不替代 Codex/Claude/custom CLI TUI，也不绕过 host 自己的确认/审批策略：

- Composer、prompt queue 和 history 通过 `XtermPane.inputRequest` paste/send 到真实 Agent xterm；只有用户点击发送/下一个时才提交。
- `目标输出`、`选区` 和 `命令块` 从绑定目标终端提取上下文后 paste 到 Agent TUI，不自动提交；selection/command block 只来自运行态内存快照，不写入 workspace session 持久化。
- `分支` 只生成安全 branch/fork request prompt，要求 Agent 先检查 `git status`，在安全时创建或切换 feature branch/worktree 并回报结果；Kerminal 不直接执行本地 `git`，破坏性 git 操作仍需用户显式授权。

真实 Codex/Claude 行为仍可能受 CLI 版本、账号状态、网络、shell、TERM、tmux extended keys 和 host keymap 影响。自动化验证可覆盖 raw bytes、xterm 协议、尺寸、焦点和主题；真实 prompt 内多行输入、Ctrl+C interrupt、Esc cancel、Tab/Shift+Tab 导航和大 paste 仍需要在有账号/网络的本机环境做 HITL smoke。

## AGENTS.md 内容职责

`~/.kerminal/AGENTS.md` 应保持短小、可验证，覆盖：

- 这是 Kerminal runtime workspace，不是普通源码仓库或只用于配置的目录。
- 外部 AI 的主要职责：通过 Kerminal MCP 操作 live app 功能，并仅在用户要求配置变更时编辑文件化配置。
- MCP host 负责确认、审批、权限、hook 和审计；Kerminal MCP Server 只提供 tools、参数校验、loopback/Host 校验和脱敏，不再实现 pending/confirm 队列。
- live app 能力必须走 MCP：终端 session、SSH 命令、SFTP 文件、tmux 会话、容器、端口转发、服务器信息、命令历史查询和诊断。
- 常用工具族：`terminal.*`、`kerminal.agent.*`、`ssh.command`、`ssh.command_on_resolved_host`、`sftp.*`、`tmux.*`、`container.*`（含 `container.files.list`、`container.files.preview`、`container.files.write_text`、`container.files.upload`、`container.files.download`、`container.files.create_directory`、`container.files.rename`、`container.files.chmod`、`container.files.delete`）、`port_forward.*`、`server_info.snapshot`、`history.search`、`diagnostics.*`、`kerminal.app_guide`、`kerminal.config_guide`、`kerminal.capabilities`、`kerminal.tool_help`、`kerminal.operation_guide`、`kerminal.runtime_snapshot`、`kerminal.host.upsert_with_credential`、`kerminal.vault.encrypt_secret`。
- 应用导航入口：`kerminal.app_guide` 返回 Kerminal 产品结构、主要界面区域、AI 可用 runtime 工具、配置 workspace 边界和任务路由；任务路由包含 `discover-mcp-capabilities`，引导 agent 先用 `kerminal.capabilities` 获取当前工具地图，适合 agent 初次理解应用时使用。
- 配置规则入口：`kerminal.config_guide` 返回与 `kerminal-config.md` 同源的配置手册正文，适合没有直接文件上下文的 MCP host 在改配置前使用。
- MCP 自发现入口：`kerminal.capabilities` 返回当前工具地图、推荐起步调用、会话 context 文件、文件型配置边界、故意缺席的配置 CRUD/UI 编排/历史写入工具族。
- 具体工具帮助入口：`kerminal.tool_help` 按 `toolId`、`family` 或 `query` 返回当前暴露工具的 input schema、示例参数、安全标注和缺席工具族替代路径，适合调用具体 runtime tool 前检查参数。
- 任务意图操作指南：`kerminal.operation_guide` 按 intent 返回建议工具调用顺序、必要上下文文件、配置边界、安全停顿条件和 fallback，适合 agent 不确定先调哪个工具时使用。
- 运行态概览入口：`kerminal.runtime_snapshot` 返回当前终端、Agent session、端口转发、本机代理入口、MCP 工具数量和下一步建议；它只做摘要，不读取 secrets，不替代专门细节工具。
- 全局 `~/.kerminal` 没有隐式目标终端；终端写入前必须让用户指定目标，或先用只读工具列出/读取终端。
- 会话目录 `agents/sessions/<id>/` 有 session-scoped endpoint；先读 `context/mcp-endpoint.json`、`context/target-binding.json` 和 `context/terminal-snapshot.json`，再用 `kerminal.agent.current_session` / `kerminal.agent.target_context` 获取并刷新目标上下文。
- 调用 `terminal.write` 前必须确认目标 live 且 generation 匹配；会话绑定写入传 `agentSessionId`、返回的 `bindingGeneration` 和 `data`，显式终端写入传 `sessionId` 和 `data`。stale、closed、missing 或 generation mismatch 时要求用户在 Kerminal 里 rebind，不猜目标。
- Kerminal 配置目录结构。
- 跨平台路径语义：`~/.kerminal` 是当前用户 Kerminal 根目录；`~/.ssh/id_ed25519` 是当前用户私钥示例；不要生成固定 Windows/macOS/Linux home 绝对路径。
- 修改配置前必须先读 `kerminal-config.md`；不要只根据文件名或字段名猜测。
- 哪些文件可编辑，哪些禁止默认编辑。
- 修改配置后调用 MCP 只读校验工具 `kerminal.config.validate`；该工具是外部 Agent 默认 validator，脚本 validator 只作为源码维护和 self-test 入口。
- 运行中的 Kerminal 会自动感知 settings/profile/host/snippet/workflow 文件变化并刷新；成功提示只展示公开摘要，secrets 不会出现在事件、notice 或诊断明细中。encrypted vault 文件由 Kerminal 内部维护，外部 Agent 不要直接改 `secrets/vault*.toml`。
- `settings.toml`、`profiles/*.toml`、`hosts/groups.toml`、`hosts/*.toml`、`snippets/*.toml`、`workflows/*.toml` 优先直接编辑，不通过 MCP CRUD。
- 主机凭据保存默认走 encrypted vault：`secret_ref` / `key_passphrase_ref` 出现在 `hosts/*.toml`，密码/内联私钥/key passphrase/跳板机 secret 加密进 `secrets/vault.toml`，key 留在 `secrets/vault-key.toml`；外部 Agent 不要写明文 `password` / `credential_secret` / `inline_private_key`。
- 只有需要 live app、既有终端会话、保存凭据、SSH/SFTP、tmux、容器、端口转发、服务器信息、历史查询、诊断、应用导航、配置规则、具体工具帮助、任务意图操作指南或运行态概览时才用 Kerminal MCP tools；`kerminal.app_guide` 是应用导航入口，`kerminal.config_guide` 是配置规则入口，`kerminal.tool_help` 是 schema/示例/安全标注入口，`kerminal.operation_guide` 是按任务类型选择工具序列的入口，`kerminal.runtime_snapshot` 是概览入口，`kerminal.host.upsert_with_credential` / `kerminal.vault.encrypt_secret` 是处理 vault 凭据的首选入口。
- 明确不要期待 `settings.*`、`profile.*`、`remote_host.*`、`snippet.*`、`workflow.*`、`workspace.*`、`terminal.create`、`terminal.resolve_current` 或 history 写入/删除/清空类 MCP tools。
- 不要修改日志、缓存、临时文件和 secrets 中的加密密文。
- 文件写入要求：小范围修改、不要全量格式化、保留注释。

## kerminal-config.md 内容职责

`~/.kerminal/kerminal-config.md` 是给外部 Agent 使用的配置手册。它应覆盖：

- 文件布局和每类配置的用途，包括 encrypted `secrets/vault-key.toml` / `secrets/vault.toml` 的边界。
- settings、profile、host groups、hosts、snippets、workflows 的字段含义和示例；hosts 必填字段必须包括 `production = true|false`，保存过凭据的 host 同时存在 `secret_ref`（target）、`key_passphrase_ref`（key passphrase，可选）和 `[[ssh_options.jump_hosts]].secret_ref`（jump host，可选）。
- 每类配置的必填字段矩阵，尤其 host 必须显式写出 `production = true|false`，且 `secret_ref` / `key_passphrase_ref` 引用 encrypted vault。
- 新增/修改 host、group、profile、snippet、workflow 的操作 checklist。
- 文件之间的关系：host `group_id` 引用 groups，host secret 走 `secrets/vault.toml` 通过 `secret_ref` / `key_passphrase_ref` 引用，workflow steps 位于 workflow 文件内。
- 禁止项：不直接改 `data/command.sqlite` / `secrets/vault*.toml` / `secrets/vault-key.toml`，不把 password/token/private key 写进普通 TOML。
- 修改流程：先定位、最小编辑、保留未知字段、调用 `kerminal.config.validate`。MCP 不可用时按手册人工校验并说明。
- 运行时反馈：应用运行中会自动刷新有效配置；无效 TOML 保留 last-known-good；成功 notice 使用 `cfg: ...` 风格自动关闭，且不得泄露 secret。
- 跨机器使用：`vault.toml` 可随 workspace 提交，`vault-key.toml` 必须独立导入；不导入匹配 key 时会触发 `vault key missing` 诊断，AI 不应自行覆盖 key。
- 常见失败模式：文件名/id 不一致、缺 `production`、`group_id` 不存在、secret 写进普通 TOML、workflow step 顺序错误、`.gitignore` 缺少 `secrets/vault-key.toml` 规则。

## 配置校验职责

Kerminal 运行时在 `ExternalAgentWorkspaceStatus.validator` 和 `~/.kerminal/AGENTS.md` 中写入当前校验入口。分发用户不需要 Node.js，也不需要源码 checkout；外部 Agent 修改配置后应调用 MCP 只读工具：

```json
{"tool":"kerminal.config.validate","arguments":{"scope":"all"}}
```

`scope` 可为 `all`、`settings`、`profiles`、`hosts`、`snippets`、`workflows`。MCP Server 未运行时，外部 Agent 只能按 `kerminal-config.md` 人工检查，并在交付中说明未执行自动校验。

- 校验 TOML/JSON 格式。
- 校验 schema_version。
- 校验 host id、group id、profile id 引用。
- 校验 host `production` 是否显式为布尔值。
- 校验 workflow step 顺序。
- 校验 secrets 不被普通 config 明文字段引用，并提示用 `kerminal.host.upsert_with_credential` 走 encrypted vault。
- 校验 `.gitignore` 包含 `secrets/vault-key.toml`。
- 输出 agent 可读的错误位置和修复建议；`secrets/vault*.toml` 的内容不在诊断中暴露。

## 来源

- Codex config 和 MCP：<https://developers.openai.com/codex/config-basic>、<https://developers.openai.com/codex/mcp>
- Codex AGENTS.md：<https://developers.openai.com/codex/guides/agents-md>
- Claude Code MCP：<https://code.claude.com/docs/en/mcp>
- Claude Code memory：<https://code.claude.com/docs/en/memory>
