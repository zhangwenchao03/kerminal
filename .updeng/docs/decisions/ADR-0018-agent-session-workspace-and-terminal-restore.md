# ADR-0018: 外部 Agent 会话工作区与终端恢复边界

## 状态

Accepted

## 背景

ADR-0017 已决定删除 Kerminal 内置 AI runtime，只保留右栏 Agent Launcher、Kerminal MCP Server 和文件优先配置工作区。落地后出现新的产品与架构问题：

- 右栏 Codex/Claude/custom CLI 已能在本地终端中启动，但当前只有一个前端 `activeTerminal`，没有 Kerminal 自有的持久 Agent 会话主键。
- 多个中间终端同时打开时，外部 Agent 不能稳定知道自己处理的是哪个终端。
- 当前 workspace session 主要在前端 `localStorage`，外部 Agent 不能通过文件读取 UI 会话、启动会话和目标绑定信息。
- Rust `TerminalManager` 的 PTY session 是进程内 `HashMap`，应用重启后不能复活原 OS 子进程；只能恢复 layout、cwd、最近输出和绑定意图。
- 旧内置 AI 的 context snapshot / pending approval / conversation 存储不再保留，不能用回旧 AI 兼容方案。

## 决策驱动因素

- 清晰边界：Kerminal 继续做 capability server 和 workspace manager，不做第二套 Codex/Claude。
- 多终端正确性：Agent 的目标终端必须显式绑定，不能依赖“当前焦点”这种易变 UI 状态。
- 可恢复性：重启后要恢复用户能理解的状态，但不能谎称已死 PTY 仍 live。
- 文件可见性：Agent 必须能通过 cwd 中的 `AGENTS.md`、`CLAUDE.md` 和 context 文件读到自己的 session 信息。
- MCP tools-only：保持 ADR-0012，不恢复 resources/prompts/config CRUD 或 Kerminal 私有 pending/confirm。
- 安全：写终端类工具必须校验 session binding generation，避免旧会话写入新终端。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| 继续全局 `~/.kerminal` cwd + 单 active terminal | 改动小 | 多 Agent 串上下文，重启不可恢复，Agent 看不到绑定 | 写错终端、resume 串会话 | 多终端手工测试会失败 |
| 使用 Codex/Claude provider session id 做主键 | 复用 provider resume | 自定义 Agent 无统一 id，Kerminal target 依赖外部实现 | provider 升级或行为变化导致绑定失效 | provider CLI 版本矩阵测试成本高 |
| Kerminal 自有 `agentSessionId` + 每会话工作区 | 绑定清晰，可文件化，可跨 provider，可重启恢复 stale | 需要新增 store、MCP scope 和 UI 恢复 | 文件 store 与 active MCP lane 有集成成本 | Rust/前端/MCP contract 测试 |
| 尝试自动复活 PTY 进程 | 体验看似连续 | 本地 OS 子进程通常不可复活，安全和正确性不可控 | 用户误以为命令仍在跑 | 不采用 |

## 决策

采用“Kerminal 自有 `agentSessionId` + 每 Agent 会话独立工作区 + session-scoped MCP tools + stale/rebind 恢复”的方案。

核心规则：

- `agentSessionId` 是 Kerminal 持久主键，目录名、UI 恢复、MCP session scope、日志和绑定都使用它。
- `agentTerminalSessionId` 只表示右栏里运行 Codex/Claude/custom CLI 的 PTY。
- `targetTerminalSessionId` 只表示中间工作区被 Agent 操作的目标终端 PTY。
- `providerSessionId` 是 Codex/Claude 的可选 resume metadata，不能作为 Kerminal 主键。
- Agent Launcher 默认在 `~/.kerminal/agents/sessions/<agentSessionId>/` 启动 CLI，而不是直接在全局 `~/.kerminal` 启动。
- 会话目录包含 `session.toml`、`provider.toml`、`AGENTS.md`、`CLAUDE.md`、`.codex/config.toml`、`.mcp.json`、`context/target-binding.json`、`context/terminal-snapshot.json` 和 bounded logs。
- Kerminal MCP Server 保持 tools-only，但新增 session-scoped endpoint 或等价 session scope 注入，让 tools 能根据 `agentSessionId` 解析默认 target。
- 应用重启后，如果 `TerminalManager` 中没有原 `targetTerminalSessionId`，绑定状态必须变成 `stale`；只读 tools 可以返回最后快照，写入类 tools 必须拒绝并要求重绑。
- P0 不自动重跑命令，不实现 OSC-88；未来如支持命令重跑，必须使用 whitelist、进程身份验证、用户可见和可撤销策略。

## 影响

- 正向影响：
  - 外部 Agent 可以通过文件直接知道自己的会话、目标绑定和 MCP endpoint。
  - 多个 Agent 和多个目标终端可以并行，不依赖易变焦点。
  - 重启恢复语义明确：layout/snapshot/resume metadata 可以恢复，live PTY 必须重新验证。
  - Codex、Claude、自定义 CLI 共享同一 Kerminal 会话模型。
- 负向影响：
  - 需要新增 Agent session file store、workspace session file store 和 MCP session resolver。
  - 右栏 Agent Launcher 要从单 `activeTerminal` 改成 session map。
  - MCP tools-only active lane 需要协调，避免同时改同一 server 文件造成冲突。
- 需要同步修改：
  - `ExternalAgentWorkspaceService`
  - `AgentLauncherToolContent`
  - `TerminalSessionBindingService`
  - MCP execution context 和 tools catalog/executor
  - workspace session persistence
  - `.updeng/docs/config/*` 和 README 相关说明

## 回滚或替代

- 如果 session-scoped MCP endpoint 影响当前全局 MCP 行为，保留 `/mcp` 全局 endpoint，Agent Launcher 只在生成的 session config 中使用 scoped endpoint。
- 如果 provider resume 不稳定，只启动普通 provider CLI，并保留 Kerminal session/context 文件；不影响 target binding。
- 如果 file-backed workspace session 引入启动问题，可短期回退到 localStorage，但 Agent session 文件模型仍保留。
- 不通过恢复旧内置 AI runtime、conversation storage 或 pending/confirm 作为回滚方案。

## 验证

- Agent session file store：create/list/update/archive、坏 TOML/JSON、atomic write。
- Agent Launcher：Codex、Claude、自定义可并行打开；返回 launcher 再进入不关闭 terminal。
- Binding：重启模拟后 target stale；generation mismatch 拒绝写入。
- MCP：`initialize` 只声明 tools；resources/prompts 不恢复；session-scoped tools 能解析 target；stale target 写入拒绝。
- Workspace：文件化 workspace session 能恢复 layout、cwd、最近输出，不声称 PTY 复活。
- UI：浅色、深色、跟随系统主题下右栏三图标和 Agent terminal header 可读、紧凑、不溢出。
- 启动：`npm run build`、真实 dev server smoke；涉及 Tauri lifecycle 时跑 `npm run tauri:dev` 或记录阻断原因。
