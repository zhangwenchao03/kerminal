# 右栏 AI 收缩为外部 Agent 启动器发现记录

## 目标

- 删除 Kerminal 当前右边栏内置 AI 聊天、Agent Run、LLM Provider、AI 审批、AI 会话持久化和 AI 配置主链路。
- 保留 Kerminal 自己的 Streamable HTTP MCP Server，作为外部成熟 agent 操作 Kerminal 的唯一标准入口。
- 右边栏保留一个轻量 Apple-inspired Agent Launcher：Codex、Claude、自定义 agent 三类入口。
- 配置数据后续按文件优先方案从 SQLite 迁出，方便外部 agent 直接阅读、修改和校验。
- 在 `~/.kerminal` 工作目录生成 `AGENTS.md`、`.codex/config.toml`、`.mcp.json`、配置 schema 和 validator，让 Codex/Claude 能按规则工作。

## 当前判断

我支持这个方向。原因是 Kerminal 现在已经把大量复杂度放进内置 AI：provider、会话、附件、pending invocation、tool audit、context snapshot、settings.ai、自定义 MCP/skills 等都在应用内维护。继续加深这条路会让 Kerminal 同时承担终端工作台、AI host、agent runtime、模型配置器、审批系统和配置数据库的职责。

更清晰的产品边界是：

- Kerminal：本地终端工作台、主机/SFTP/端口/系统信息能力、MCP Server、文件化配置和启动器。
- Codex/Claude：成熟 agent 会话、模型、上下文窗口、权限、审批、CLI/TUI 交互和代码/配置操作。
- MCP：两者之间的能力协议。
- 文件配置：agent 可直接读写的事实源。

## 更好的建议

1. 不要把 `~/.kerminal` 只当普通数据目录，要把它升级为 agent-facing workspace。
   - Kerminal 启动时创建 `~/.kerminal/AGENTS.md`。
   - Codex 使用 `~/.kerminal/.codex/config.toml`。
   - Claude Code 使用 `~/.kerminal/.mcp.json` 和 `~/.kerminal/CLAUDE.md`。
   - 配置、状态、日志、secrets 必须分目录并写清规则。

2. 不要在 Kerminal 里继续维护“用户自定义 MCP / Skills”设置。
   - 外部 MCP server 应该交给 Codex/Claude 自己配置。
   - Kerminal 只暴露自己的 MCP server。
   - Kerminal 的 settings 里只保留 MCP endpoint、连接状态、复制配置片段和重生成 workspace 文件。

3. 不要接 Codex app-server 作为第一阶段。
   - Codex app-server适合深度嵌入 rich client，但会重新引入 conversation/thread/approval/event 集成复杂度。
   - 当前目标是删掉 Kerminal 内置 AI runtime，直接启动 CLI/TUI 更符合方向。

4. 先替换右栏体验，再删除后端 AI。
   - 第一切片把右栏 `ai` 工具替换成 Agent Launcher，确保 UI 和启动不白屏。
   - 后续再分批删除 AI settings、provider、conversation、storage、commands、tests。

5. 文件化存储先做配置域，不要把命令历史强行文件化。
   - settings/profile/hosts/snippets/workflows 用 TOML。
   - command history/suggestion 继续 SQLite。
   - AI 表全部删除，不迁移到 JSONL。

## 官方资料依据

- Codex 支持项目级 `.codex/config.toml`，并可在其中配置 MCP servers：<https://developers.openai.com/codex/config-basic>、<https://developers.openai.com/codex/mcp>
- Codex CLI 支持用 `--cd` 指定工作目录，`codex` 命令启动交互式 TUI：<https://developers.openai.com/codex/cli/reference>
- Codex 会按全局和项目 `AGENTS.md` 读取持久指令：<https://developers.openai.com/codex/guides/agents-md>
- Claude Code project-scoped MCP 使用项目根 `.mcp.json`，HTTP transport 推荐用于远程/本地 HTTP MCP server：<https://code.claude.com/docs/en/mcp>
- Claude Code 读取 `CLAUDE.md` 而不是 `AGENTS.md`；可用 `CLAUDE.md` 导入 `AGENTS.md`：<https://code.claude.com/docs/en/memory>

## 后续入口

- 架构决策：[ADR-0017](../decisions/ADR-0017-external-agent-launcher-and-mcp-only.md)
- 实施计划：[PLAN-20260623-221108](../plan/active/PLAN-20260623-221108-ai-sidebar-external-agent-launcher.md)
