# ADR-0002: AI Agent 控制平面与工具调用架构

## 状态

Superseded by [ADR-0017: 外部 Agent Launcher 与 MCP-only 边界](ADR-0017-external-agent-launcher-and-mcp-only.md)，并由 [ADR-0018: Agent session 工作目录与终端恢复](ADR-0018-agent-session-workspace-and-terminal-restore.md) 补充运行态协作事实。历史上的 Rig/rmcp 实现框架修订见 [ADR-0003](ADR-0003-ai-agent-framework-rig-rmcp.md)。

## 当前事实提示

- Kerminal 不再内置 AI Agent runtime、LLM Provider、conversation、pending invocation、AI tool audit 主链路或 custom MCP 配置器。
- Kerminal MCP Server 只提供 tools-only runtime 能力；工具确认、审批、权限、hook 和审计由 Codex、Claude 或其它 MCP host 负责。
- 文件型配置由外部 agent 直接编辑 `~/.kerminal` 工作区文件并运行 validator；不要按本文旧 Tool Registry / pending-confirm 控制面新增功能。

## 背景

用户确认 AI 是 Kerminal 第一版核心能力。AI 不只是解释命令或生成建议，还需要能看到当前 terminal 信息，并能操作 terminal、SSH、SFTP、服务器信息、脚本片段、主题、配置、分屏、工作区和应用内所有能力。

这类能力如果直接暴露为“让模型执行命令行”会造成权限、审计、误操作和密钥泄露风险。因此需要一个统一的 AI 控制平面，既能让 AI 操作完整应用，又不绕过 Kerminal 的权限和安全策略。

## 决策驱动因素

- AI 必须能操作全应用能力，而不是只聊天。
- 终端和 SSH/SFTP 操作有高风险，必须可确认、可审计、可禁用。
- LLM Provider 要可配置：base URL、API key、model 等由用户在设置中管理。
- API key、SSH 凭据和终端敏感输出不能明文进入日志、SQLite 或 AI 上下文。
- 后续可能需要 MCP Server/Client，但第一版不能被协议选型绑死。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| 内置 Tool Registry，AI 只能调用注册工具 | 权限统一；UI/快捷键/AI 可复用；可审计 | 初期需要设计工具 schema 和策略 | 工具层设计不当会拖慢实现 | AI 创建终端、执行命令、修改配置、操作 SFTP 均走审计 |
| AI 直接写入终端或执行系统命令 | 实现快 | 绕过权限和业务模型；难审计 | 误删文件、泄露密钥、批量 SSH 风险高 | 不采用 |
| 只做 MCP Server，把应用能力交给外部 Agent | 协议标准化 | 第一版依赖外部 agent；用户体验不可控 | 本地核心 AI 能力不足 | 作为 P2 暴露能力，不作为第一入口 |
| 只做命令行 wrapper | 简单 | 无法操作 UI 状态、配置、SFTP、工作区 | 能力不完整 | 不采用 |

## 决策

采用“内置 AI Agent + Tool Registry + LLM Provider 配置 + 风险策略 + 审计”的架构。

具体决策：

- Tool Registry 是所有 AI 可操作能力的唯一入口。
- UI action、command palette、快捷键和 AI tool 尽量复用同一 action/tool 定义。
- 每个 tool 必须声明 name、description、input schema、risk level、confirmation policy、audit policy。
- AI 可读取当前终端上下文，但上下文收集必须可见、可配置、可脱敏。
- LLM Provider 在设置中配置，默认兼容 OpenAI-style HTTP API：base URL、API key、model。
- API key 使用 OS keychain 或本地加密存储；SQLite 只保存 credential ref。
- AI 可操作 SSH/SFTP/批量命令，但 remote、batch、destructive 工具默认需要用户确认。
- MCP Server/Client 作为 P2：内部 Tool Registry 稳定后再映射到 MCP tools/resources。

## 工具风险等级

| 等级 | 含义 | 默认策略 |
| --- | --- | --- |
| `read` | 读取状态、配置、终端上下文、服务器信息 | 可自动执行，需审计 |
| `write` | 修改设置、创建 profile、创建 snippet、写入终端 | 需要上下文提示，部分可自动 |
| `remote` | 连接 SSH、读取远程信息、操作 SFTP | 默认确认 |
| `batch` | 对多个 pane/host 执行命令 | 默认确认 |
| `destructive` | 删除文件、断开连接、kill 进程、格式化、危险 shell 命令 | 必须确认 |

## 影响

正向影响：

- AI 能覆盖完整产品能力，同时保持可控。
- Tool Registry 可以被 UI、快捷键、命令面板、AI 和未来 MCP 复用。
- 审计记录能回答“AI 做了什么、对哪里做的、结果如何”。
- 后续接入 MCP 时，不需要重写业务能力。

负向影响：

- 第一版需要比普通 chat UI 多实现工具 schema、确认弹窗、审计和上下文管理。
- 所有新能力都要考虑是否注册为 tool，以及风险等级。
- AI 自动化越强，测试和安全策略越重要。

需要同步修改：

- 新增 `tool_registry`、`ai_agent_service`、`llm_service`、`ai_policy`、`audit` 模块。
- SQLite 新增 LLM provider、AI conversation、tool definition、tool call audit 相关表。
- 设置页新增 LLM Provider、AI 权限、上下文策略。
- 右侧工具区新增 AI panel，展示上下文、计划、工具调用、确认和结果。

## 回滚或替代

- 如果第一版 AI tool scope 过大，可先只启用 read、terminal write、profile/snippet 创建，SSH/SFTP 工具保持关闭但保留 schema。
- 如果 OpenAI-style provider 不满足用户模型供应商，增加 provider adapter，不改变 Tool Registry。
- 如果后续决定采用 MCP 为主要协议，将 Tool Registry 映射为 MCP tools/resources，而不是绕过它。

## 验证

- AI 能读取当前 terminal buffer、cwd、profile、选中文本和最近命令。
- AI 能通过工具创建终端、分屏、写入命令、切换 tab。
- AI 能创建或修改 profile、remote host、snippet、theme。
- AI 能连接测试 SSH 主机并执行确认后的命令。
- AI 能在 SFTP 中列目录、上传、下载、删除文件；删除必须确认。
- 每次工具调用都有 audit 记录。
- API key、SSH 密码、私钥 passphrase 不出现在 SQLite 明文字段、日志或 AI 上下文中。

## 资料来源

- [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro)
- [Tauri Calling Rust / Channels](https://v2.tauri.app/develop/calling-rust/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
