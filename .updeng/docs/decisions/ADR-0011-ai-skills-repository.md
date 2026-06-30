# ADR-0011: AI Skills Repository

## 状态

Superseded by [ADR-0017](ADR-0017-external-agent-launcher-and-mcp-only.md)

当前整理说明：本 ADR 记录的是旧内置 Kerminal Agent 的自定义 Skills Repository 方向。2026-06-24 后，Kerminal 不再维护用户自定义 MCP / Skills 设置入口；系统 skills catalog 只作为 Kerminal MCP Server 内部能力路由保留，外部 Codex/Claude 的 skills 由各自工作目录和配置管理。

## 背景
- Kerminal 已按 ADR-0003 采用 Rig + rmcp：Rig 负责模型与标准 tool-call，rmcp/MCP 负责工具、资源、提示词的协议形状。
- 用户希望 Kerminal Agent 也具备标准 skills 能力：用户只需要把标准 skill 文件夹放入约定目录，应用即可发现并用于 Agent 路由。
- 现有实现已有自定义 skills 扫描雏形，但解析逻辑散在 MCP 网关中，缺少独立 Repository、目录扫描摘要和可测试边界。

## 决策驱动因素
- 对齐行业主流：MCP 是互操作协议，skills 是文件系统指令包和能力路由，两者不应混成一个概念。
- 用户体验：安装 skill 应该是放入文件夹，不要求数据库注册或重新编译。
- 安全：skill 内容视为指令，不是自动执行插件；脚本和工具执行必须继续走 Kerminal Tool Registry、确认和审计。
- 上下文成本：只把元数据和预算化说明摘要注入 Agent，上下文不足时说明缺口。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| 独立 `SkillsRepository` 扫描标准 `SKILL.md` 文件夹 | 对齐 OpenAI/Claude skills 形状；易测试；不替换 Rig/rmcp | 需要维护少量 frontmatter 解析逻辑 | 摘要截断可能不足以完整执行复杂 skill | Repository、MCP resource、AI context 测试 |
| 等 Rig 原生支持 skills | 依赖更少 | 当前不可用；交付受上游节奏影响 | 用户无法立即使用本地 skills | 不采用 |
| 把 skills 做成 MCP tools | 外部 agent 可调用 | 概念混淆；可能绕过工具审批 | skill 脚本被误认为可自动执行 | 不采用 |
| 引入 Node/Python agent 框架处理 skills | 生态成熟 | Tauri Rust 后端多一套 runtime 和安全边界 | 包体、权限和调试成本上升 | 不采用 |

## 决策
采用独立 `SkillsRepository`：

- 扫描 `AiMcpSettings.skill_directories` 中启用的目录。
- 支持目录本身含 `SKILL.md`，也支持根目录下多个子目录各含 `SKILL.md`。
- 读取标准 YAML frontmatter 的 `name` 与 `description`，正文用于生成预算化说明摘要。
- 转换为现有 `McpSkillDefinition`，继续进入 Agent context、MCP manifest 和 `kerminal://agent/skills` resource。
- MCP resource 额外暴露目录扫描摘要、`SKILL.md` 路径、说明预览、是否包含 `scripts/`、`references/`、`assets/`。
- Streamable HTTP MCP server 通过 `resources/templates/list` 暴露 `kerminal://agent/skills/{skillId}`，外部 MCP client 可在 catalog 命中后按 id 读取标准 `SKILL.md` 正文，实现渐进披露。
- 不自动执行 skill 中的脚本；任何操作仍只能通过已启用 MCP 工具目录，并受 Kerminal 确认和审计约束。

## 影响
- 正向影响：用户放入标准 skill 文件夹即可被发现；解析逻辑集中、可测试；外部 MCP agent 可先读轻量 catalog，再读取单个 skill 的完整正文。
- 负向影响：复杂 skill 的脚本、references 和 assets 仍只是文件夹存在性摘要；实际读取/执行必须走宿主允许的文件能力或 Kerminal 已暴露工具。
- 需要同步修改：`skills_repository` 服务、MCP gateway、AI Agent 上下文测试、MCP resource 测试。

## 回滚或替代
- 如果摘要注入带来上下文压力，可只在 manifest/resource 暴露 metadata，并新增受控 `skill.read` 工具做显式加载。
- 如果未来 Rig 或 rmcp 提供成熟 skills 抽象，保留 `SkillsRepository` 作为文件系统 adapter，再映射到上游抽象。

## 验证
- `cargo test --test skills_repository`
- `cargo test --test mcp_tool_gateway`
- `cargo test --test tool_registry_service`
- `cargo test --lib`
- `cargo test --test ai_agent_service`
- `cargo test --test command_suggestion_service`
- `cargo fmt --check`

## 资料来源
- MCP Specification 2025-06-18：https://modelcontextprotocol.io/specification/2025-06-18
- MCP Tools：https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP Transports：https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- OpenAI Codex Skills：https://developers.openai.com/codex/skills
- OpenAI Skills API Guide：https://developers.openai.com/api/docs/guides/tools-skills
- Claude Agent SDK Skills：https://code.claude.com/docs/en/agent-sdk/skills
- Rig docs：https://docs.rig.rs/
- Pydantic AI overview：https://pydantic.dev/docs/ai/overview/
- LangChain MCP docs：https://docs.langchain.com/oss/python/langchain/mcp
- AgentScope overview：https://github.com/agentscope-ai/agentscope
