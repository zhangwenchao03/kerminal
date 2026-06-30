# ADR-0017: 右栏内置 AI 退场，保留 Kerminal MCP Server 与外部 Agent 启动器

## 状态

Proposed

## 修订关系

- Supersedes 部分：[ADR-0002: AI Agent 控制平面与工具调用架构](ADR-0002-ai-agent-control-plane.md)
- Supersedes 部分：[ADR-0003: AI Agent 框架采用 Rig 与 rmcp](ADR-0003-ai-agent-framework-rig-rmcp.md)
- Supersedes 部分：[ADR-0005: 右侧 AI 对话采用 assistant-ui 外部状态 Runtime](ADR-0005-assistant-ui-chat-runtime.md)
- Preserves：[ADR-0012: Standard Streamable HTTP MCP Server](ADR-0012-standard-streamable-http-mcp-server.md)
- Builds on：[ADR-0016: 文件优先存储与外部 Codex 工作目录协作边界](ADR-0016-file-first-storage-and-external-codex-workdir.md)

## 背景

- Kerminal 当前内置 AI 路线已经包含右栏聊天、assistant-ui runtime、LLM Provider、Rig/rmcp harness、Agent Run、AI tool approval、AI conversation persistence、AI attachments、context snapshots、AI audit 和自定义 MCP/skills 设置。
- 用户明确要求删除右边栏相关所有 AI 功能，包括设置中的自定义 MCP 和 skills、AI 配置页面和功能；只保留 Kerminal 自己的 MCP Server。
- 用户后续希望右栏 AI 助手变成 Codex、Claude、自定义 AI 的启动入口，点击后直接让成熟 agent CLI 打开 Kerminal 工作目录，外部 agent 通过 MCP 和文件配置操作 Kerminal。
- 用户另有存储调整计划：配置从 SQLite 拿出来转成文件，以便 AI 直接操作；相关操作规则写到工作目录 `AGENTS.md`。

## 决策驱动因素

- 职责收敛：Kerminal 不再同时承担 agent runtime、LLM provider 管理、conversation host 和审批系统。
- 复用成熟 agent：Codex/Claude 已有 CLI/TUI、会话、权限、MCP、记忆/指令和模型能力。
- 协议清晰：Kerminal 只通过标准 MCP 暴露应用能力。
- AI 可操作性：配置文件和 workspace 指令比 SQLite 表更适合外部 agent 检索、修改和验证。
- 启动可靠性：删除内置 AI 可以减少 right sidebar、settings、SQLite schema 和 provider 依赖导致的启动风险。
- 渐进退场：先替换 UI 入口，再删除后端 AI 主链路，避免一次性大删除造成白屏。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| 继续内置 AI runtime | 体验闭环在一个应用内 | 复杂度继续膨胀，重复造成熟 agent 能力 | provider、审批、会话、存储长期维护成本高 | 继续 AI live smoke 和 UI 回归 |
| 接 Codex app-server 做深度嵌入 | 可获得 Codex thread/turn/event primitives | 重新引入 rich-client 协议、认证、事件、审批复杂度 | 与“删除内置 AI”方向冲突 | app-server schema 和端到端协议测试 |
| 只保留 Kerminal MCP Server + 外部 agent 启动器 | 边界最清晰，删除内置 AI 面积最大 | 右栏不再是聊天体验，依赖用户安装 Codex/Claude | 外部 CLI 不存在或配置失败时体验要降级 | 启动器 smoke、MCP config 验证、应用启动验证 |
| 完全删除右栏 AI 入口 | 最小代码 | 失去外部 agent 发现入口和配置引导 | 用户不知道如何连接 Kerminal MCP | 文档可用性差，不采用 |

## 决策

采用“保留 Kerminal MCP Server + 外部 Agent Launcher”的方案。

具体决策：

- 删除 Kerminal 内置 AI chat、Agent Run、LLM Provider、AI policy settings、AI conversation persistence、AI attachments、AI context snapshots、AI pending invocations 和 AI tool audit 主链路。
- 删除设置页中的“AI 与模型”和“用户自定义 MCP / Skills”配置能力。
- 保留 Kerminal 自己的 Streamable HTTP MCP Server，默认 loopback，只声明 tools capability，只暴露运行态 Kerminal tools 和必要的 server instructions。
- Kerminal 不再作为 MCP client 管理用户自定义 MCP server；外部 MCP 配置交给 Codex/Claude。
- 右栏 `ai` 工具位保留，但内容改为 Agent Launcher：
  - Codex：启动 `codex` CLI，工作目录为 `~/.kerminal`。
  - Claude：启动 `claude` CLI，工作目录为 `~/.kerminal`。
  - Custom：用户自定义命令模板，工作目录默认为 `~/.kerminal`。
- Kerminal 在 `~/.kerminal` 生成并维护 agent-facing workspace 文件：
  - `AGENTS.md`：Codex 和其它 AGENTS.md 兼容 agent 的通用规则。
  - `CLAUDE.md`：默认导入 `AGENTS.md`，并放 Claude Code 特定说明。
  - `.codex/config.toml`：项目级 Codex MCP 配置。
  - `.mcp.json`：Claude Code project-scoped MCP 配置。
  - `config/README.md` 和 schema/validator：解释文件化配置布局与校验方式。
- 外部 agent 操作 Kerminal 的主要路径：
  1. 读 `AGENTS.md` / `CLAUDE.md`。
  2. 通过 `.codex/config.toml` 或 `.mcp.json` 连接 Kerminal MCP server。
  3. 通过 TOML/JSON/JSONL 文件修改文件型配置；settings/profile/host/snippet/workflow CRUD 不通过 MCP tools。
  4. 运行 Kerminal validator。
  5. 需要 live app、既有终端会话、保存凭据、SSH/SFTP、容器、端口转发、服务器信息或诊断时调用 Kerminal MCP tools。

## 影响

- 正向影响：
  - Kerminal AI 相关代码和设置面积大幅下降。
  - 用户不需要在 Kerminal 里重复配置模型、API key、custom MCP 和 skills。
  - Codex/Claude 可以直接用自己的 MCP、记忆、权限和会话能力操作 Kerminal。
  - 文件优先存储和外部 agent 协作形成一致架构。
- 负向影响：
  - Kerminal 内不会再显示历史 AI 对话、图片附件、Agent Run 时间线和 AI 审批记录。
  - 没安装 Codex/Claude CLI 的用户需要看到清晰的未安装状态和配置入口。
  - 右栏不再提供“即输即聊”的内置体验。
- 需要同步修改：
  - `src/features/tool-panel/AiToolContent.tsx` 及 `ai-tool-content/**` 退场或替换。
  - `src/features/settings/settingsModel.ts`、`settingsDefaults.ts`、`SettingsToolContent.tsx`、`ai-section.tsx`、`mcp-section.tsx` 删除 AI/custom MCP/skills 设置。
  - Rust `AppSettings` 删除 `ai` 字段或迁移为 MCP-only settings。
  - Rust `AppState` 移除 `ai_agent`、`ai_agent_runs`、`ai_conversations`、`rig_providers` 等内置 AI state。
  - SQLite fresh schema 删除 `llm_providers` 与所有 `ai_*` 表。
  - MCP server 从 `settings.ai.mcp` 解耦，只消费 tools-only catalog 和 MCP HTTP lifecycle 配置。
  - README、本地数据边界、settings 截图和 Updeng 计划更新。

## 回滚或替代

- 如果外部 Agent Launcher 体验不达标，短期可保留旧 `ai` 工具位 behind feature flag，但不得继续写入 AI storage 主链路。
- 如果 Codex/Claude CLI 启动失败，launcher 降级为复制配置片段、打开工作目录和显示安装检测，不恢复内置 AI。
- 如果后续重新需要深度内嵌 Codex app-server，必须新增 ADR，不能把本决策回滚成半内置 AI。

## 验证

- UI：右栏 `ai` 工具打开 Agent Launcher，不加载 assistant-ui chat、不请求 LLM provider、不显示旧会话。
- Settings：设置分类不再包含“AI 与模型”和“用户自定义 MCP / Skills”；MCP 页面只显示 Kerminal MCP Server 状态和外部 agent 配置。
- Storage：fresh install 不创建 `llm_providers` 或任何 `ai_*` 表。
- Rust：`AppState` 无内置 AI conversation/provider/run service 主链路。
- MCP：Kerminal MCP Server 仍能 `initialize`、`tools/list`、`tools/call`，不声明 resources/prompts，且只绑定 loopback。
- Agent workspace：`~/.kerminal/AGENTS.md`、`.codex/config.toml`、`.mcp.json` 生成正确；Codex/Claude 可连接 Kerminal MCP endpoint。
- 启动：`npm run build`、真实 dev server smoke、涉及 Tauri 后运行 `npm run tauri:dev` 或记录阻断原因。

## 官方资料依据

- Codex 项目级配置和 MCP server 配置：<https://developers.openai.com/codex/config-basic>、<https://developers.openai.com/codex/mcp>
- Codex CLI `--cd` 和 `codex` 交互式 TUI：<https://developers.openai.com/codex/cli/reference>
- Codex `AGENTS.md` 发现规则：<https://developers.openai.com/codex/guides/agents-md>
- Codex app-server 定位为深度 rich-client 集成，本决策不采用：<https://developers.openai.com/codex/app-server>
- Claude Code MCP project scope `.mcp.json`：<https://code.claude.com/docs/en/mcp>
- Claude Code `CLAUDE.md` 与 `AGENTS.md` 关系：<https://code.claude.com/docs/en/memory>
