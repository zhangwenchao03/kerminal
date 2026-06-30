# ADR-0012: Standard Streamable HTTP MCP Server

## 状态

Accepted

## 背景

Kerminal 之前只有应用内 rmcp 网关和 MCP-compatible manifest/resource/prompt 视图，外部 agent 无法通过标准 MCP transport 连接。旧工具执行还依赖 Kerminal 私有的 `prepare -> confirm` 确认协议，这不适合暴露给 Codex、Claude、AgentScope 或其它标准 MCP client。

MCP 当前标准 transport 包含 stdio 和 Streamable HTTP；Streamable HTTP 通过单个 HTTP endpoint 承载 JSON-RPC 请求。Kerminal 的对外职责只需要提供 live app/runtime tools；Codex、Claude 等 MCP host 已经拥有工具确认、权限、hook、审计和会话策略，因此 Kerminal 不重复实现一套 pending/confirm/approval/audit 协议。

参考：

- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP tools and safety guidance](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [Codex MCP support](https://developers.openai.com/codex/mcp)
- [Codex hooks for MCP tools](https://developers.openai.com/codex/hooks)

## 决策

Kerminal 作为对外 server 时采用标准 Streamable HTTP MCP transport，默认只绑定 loopback，并复用 rmcp 的 Host 校验能力。`initialize` 只声明 `tools` capability，不声明 resources、resource templates 或 prompts。

外部 MCP tool confirmation 不再使用 Kerminal 私有 pending/confirm 协议。进入 `tools/call` 的请求视为已经由 MCP host 的 hooks/permission 系统批准；Kerminal 侧只做：

- 工具白名单和参数 schema 校验。
- loopback/Host、本地路径、目标存在性、命令输出上限和敏感值脱敏等运行态边界。
- 后端实际能力执行。

工具目录只保留必须依赖 Kerminal live app 或保存连接上下文的运行态能力，例如既有终端 session、非交互 SSH 命令、SFTP、容器、端口转发、服务器信息、命令历史查询和诊断。

文件型配置不通过 MCP CRUD 暴露：

- `settings.toml`、`profiles/*.toml`、`hosts/groups.toml`、`hosts/*.toml`、`snippets/*.toml`、`workflows/*.toml` 由外部 agent 按 `AGENTS.md` / `CLAUDE.md` 直接编辑。
- 修改文件型配置后运行 workspace validator。
- MCP server 不提供 settings/profile/host/snippet/workflow CRUD，不提供 UI client action，不提供历史写入/清空。

Tool annotations 必须是行为语义提示，不得把 Kerminal 确认策略误当成幂等语义；只读工具才标记 `idempotentHint=true`。

## 影响

- 外部 agent 只需要连接 `http://127.0.0.1:<port>/mcp`，使用标准 MCP `initialize/tools/list/tools/call`。
- 外部 agent 通过 `AGENTS.md` / `CLAUDE.md` 获取配置文件直改规则，不通过 resources/prompts 获取 Kerminal 私有上下文。
- Codex 等 host 可以用自身 hooks/permission/audit 能力确认 `mcp__server__tool` 调用，无需理解 Kerminal 的 IPC 确认模型。
- Kerminal 不把纯客户端动作类工具暴露到 HTTP MCP，例如创建本地 tab、分屏、焦点切换、打开工具面板和 RDP 打开；这些工具没有后端可独立完成的稳定 tools-only 副作用。
- HTTP server 是按需启动，不默认开放公网监听。

## 后续

- 前端可增加按钮显示和复制当前 endpoint。
- 如需让外部 host 显式传入审批元数据，可在标准 MCP `_meta` 中记录，但不得要求二次确认请求。
- stdio server 可作为后续 transport，但必须复用同一套 tools-only catalog 和 executor。
