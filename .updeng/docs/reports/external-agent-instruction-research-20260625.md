<!-- @author kongweiguang -->

# 外部 Agent 指令与配置实践调研

## 摘要

本报告调研 Codex、Claude Code、Cursor、GitHub Copilot、Gemini CLI 和 MCP 的外部 Agent 指令、配置和工具边界实践，用来指导 Kerminal 重新设计外部 Agent workspace。

结论：

- 外部 Agent 的入口文件要短、稳定、可快速扫描；详细规则应放到可按需读取的专门手册或规则文件。
- 工具连接、权限、审批、MCP server 地址等运行时设置应放到结构化配置，而不是混进自然语言提示词。
- 对需要经常被 Agent 修改的业务配置，最可靠的方式是“文件直改 + 详细 schema 手册 + validator”，而不是提供宽泛的 MCP CRUD。
- 入口提示必须明确当前目录语义、可编辑区域、禁止区域、验证命令和何时使用 MCP。
- 会话级 Agent 需要自包含上下文，因为外部 CLI 通常只会从当前 cwd 开始加载规则。

Kerminal 推荐采用三层结构：

1. `AGENTS.md` / `CLAUDE.md`：短入口，声明这是 Kerminal runtime workspace，给出 MCP/file-first 的分流规则。
2. `agents/sessions/<id>/AGENTS.md` / `CLAUDE.md`：会话入口，额外写入 session id、scoped MCP endpoint、target binding、terminal write generation 规则。
3. `kerminal-config.md`：详细配置手册，覆盖文件布局、字段、必填项、关系、示例、失败模式和 validator。

## 调研范围

访问日期：2026-06-25。

来源优先级：

- 官方文档优先。
- 官方文档无法完整抓取时，只采用可核验的公开链接作为参考，并将具体细节降级为“观察”，不作为 Kerminal 强约束唯一依据。
- Kerminal 最终设计以本地运行时、现有代码模型和用户报告的失败案例为准。

## 关键来源

| 工具/协议 | 来源 | 关键点 |
| --- | --- | --- |
| OpenAI Codex | [AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md) | Codex 约定使用仓库内 `AGENTS.md` 给 Agent 传递项目上下文、命令和约定。 |
| OpenAI Codex | [Codex configuration](https://developers.openai.com/codex/config) / [MCP with Codex](https://developers.openai.com/codex/mcp) | MCP server、approval、sandbox、运行设置属于结构化配置，不应靠提示词表达。 |
| OpenAI Codex | [Codex skills](https://developers.openai.com/codex/skills) | 复杂能力适合拆成可触发、可按需加载的 skill，而不是全部塞入入口提示词。 |
| Claude Code | [Memory](https://docs.anthropic.com/en/docs/claude-code/memory) | `CLAUDE.md` 用作项目记忆，可导入其它文件；适合短入口加分层文档。 |
| Claude Code | [Settings](https://docs.anthropic.com/en/docs/claude-code/settings) | 权限、工具、环境变量等应在 settings 中声明，和记忆文件分离。 |
| Claude Code | [MCP](https://docs.anthropic.com/en/docs/claude-code/mcp) | MCP server 配置属于 CLI/项目配置；工具调用确认由 MCP host 和工具策略负责。 |
| Cursor | [Rules](https://docs.cursor.com/context/rules) | Cursor 将规则分成 User Rules、Project Rules，并支持项目内规则文件；适合分层规则思想。 |
| GitHub Copilot | [Repository custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions) | 仓库级 instructions 适合写编码规范、测试命令和项目上下文，但不适合承载所有细节。 |
| GitHub Copilot | [Copilot customization overview](https://docs.github.com/en/copilot/concepts/about-customizing-github-copilot-chat-responses) | 自定义响应应区分组织/仓库/个人层级，避免把所有规则塞到一个入口。 |
| Gemini CLI | [GEMINI.md documentation](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/configuration.md) | Gemini CLI 使用 `GEMINI.md` 作为上下文文件，说明多 Agent 生态都在收敛到“项目记忆文件”。 |
| MCP | [Model Context Protocol documentation](https://modelcontextprotocol.io/docs/getting-started/intro) | MCP 是工具和上下文协议；不替代本地配置文件 schema 和 validator。 |
| MCP | [Tools](https://modelcontextprotocol.io/docs/concepts/tools)、[Resources](https://modelcontextprotocol.io/docs/concepts/resources)、[Prompts](https://modelcontextprotocol.io/docs/concepts/prompts) | Tools、Resources、Prompts 分工明确：工具是操作，资源是上下文，提示词是模板化意图。 |

## 各工具实践拆解

### Codex

Codex 采用 `AGENTS.md` 作为项目级规则入口。适合写：

- 项目如何构建、测试、运行。
- 代码风格和目录约定。
- Agent 修改前需要读取的文档入口。
- 安全边界和不要触碰的区域。

Codex 的 MCP 和运行设置使用 `.codex/config.toml`，说明工具连接和审批策略应由结构化配置承载。对 Kerminal 来说，`AGENTS.md` 不应该硬编码大量字段表，而应该明确“改 Kerminal 配置前先读 `kerminal-config.md`，改完跑 validator”。

Codex Skills 的模式也有参考价值：能力可以拆成入口描述和详细 skill 文件。Kerminal 不需要在 `AGENTS.md` 里展开完整 TOML schema，而是把 schema 放进 `kerminal-config.md`。

### Claude Code

Claude Code 使用 `CLAUDE.md` 作为 memory 文件，并支持从记忆文件导入其它文件。这说明：

- `CLAUDE.md` 可以很短，主要负责指向 `AGENTS.md` 或配置手册。
- 详细手册可以是独立文件。
- 如果 Agent 从 session cwd 启动，session 目录必须有自己的 `CLAUDE.md` 或 `AGENTS.md`，否则它可能只加载会话目录而不知道全局 workspace 约束。

Claude Code 的 settings/MCP 文档体现了同一个分层：记忆文件写“应该怎么做”，settings/MCP 写“工具怎么连、权限怎么给”。Kerminal 应继续让 `.mcp.json` 管 MCP endpoint，不把 endpoint 或工具权限只写在自然语言里。

### Cursor

Cursor 的规则体系区分用户规则、项目规则和 Agent 可用规则文件。可借鉴点是：

- 长期项目规则应该放在项目内可版本化的位置。
- 规则文件可以按主题拆分，避免入口文件膨胀。
- Agent 需要在合适时机主动读取相关规则。

对 Kerminal 的约束是：全局 `~/.kerminal/AGENTS.md` 是 workspace 入口，但配置细节应由 `kerminal-config.md` 承载；session 规则则只补 runtime/session 信息。

### GitHub Copilot

GitHub Copilot 支持仓库级 custom instructions。它更适合作为“全仓通用规则”入口，而不是任务级完整操作手册。这个实践提示 Kerminal：

- 入口 instructions 要稳定，不应该频繁随着 host/schema 字段变化重写大量内容。
- 它应该写“哪里是权威手册”和“如何验证”，而不是直接复制全部字段。
- 组织/仓库/用户不同层级规则可能叠加，所以 Kerminal 的规则要尽量具体，减少歧义。

### Gemini CLI

Gemini CLI 使用 `GEMINI.md` 作为上下文文件，和 `AGENTS.md`、`CLAUDE.md` 属于同类模式。多工具生态的共同点是：Agent 从 cwd 寻找约定文件，然后按文件内容行动。

Kerminal 因此不能只在全局 `~/.kerminal/AGENTS.md` 里写规则；右栏启动 Agent 的 cwd 是 `~/.kerminal/agents/sessions/<id>`，所以 session 目录也必须生成自包含入口，并指回全局 `kerminal-config.md`。

### MCP

MCP 把能力分成 tools、resources 和 prompts。这个分工直接支持 Kerminal 当前边界：

- tools：适合 live app 操作，例如 terminal、SSH/SFTP、container、port forwarding、server info、history search、diagnostics。
- resources：适合只读上下文，例如 terminal snapshot、target binding、session metadata。
- prompts：适合模板化任务入口，但不适合做配置 CRUD。

Kerminal 文件型配置不应重新用 MCP CRUD 表达，因为那会复制一套 schema、审批、验证和错误处理。文件直改加 validator 更符合本地配置事实源。

## Kerminal 失败案例分析

用户报告“让 AI 助手加了主机，文件写了但没成功”。现场证据显示主机文件已写入：

```text
~/.kerminal/hosts/bwy-172.16.41.60.toml
```

但 validator 当时没有检查 `production` 字段。即使运行时当前可对部分字段做默认兼容，Agent 写出的配置也不应依赖隐式默认；`production` 是主机安全策略字段，必须在手册和 validator 中显式要求布尔值。

根因不是“需要 MCP host CRUD”，而是：

- 入口提示没有强制 Agent 读足够详细的配置手册。
- 配置手册没有把 host 创建流程写成可执行 checklist。
- validator 没有覆盖所有 Agent-authored host 必填字段。
- 错误信息没有告诉 Agent “文件存在但 schema 不完整”。

## 设计原则

### 1. 入口短，手册详

`AGENTS.md` 和 `CLAUDE.md` 应保持短小：

- 说明当前目录是什么。
- 说明何时用 MCP，何时改文件。
- 说明改文件前必须读 `kerminal-config.md`。
- 说明改完必须跑 validator。
- 说明禁止读写 `secrets/`、`data/command.sqlite`、日志和缓存。

`kerminal-config.md` 必须详细：

- 文件用途和关系。
- 每类文件最小有效示例。
- 字段类型、必填/可选、默认行为。
- 新建主机、修改主机、创建分组、创建 profile、创建 snippet、创建 workflow 的操作步骤。
- 常见失败：id 和文件名不一致、group_id 不存在、缺少 `production`、把密码写进普通 TOML、忘记 timestamps、workflow sort_order 乱序。

### 2. Session 规则自包含

会话目录规则必须写清：

- Agent provider、title、session id、workspace root、session root。
- session-scoped MCP endpoint。
- `context/mcp-endpoint.json`、`context/target-binding.json`、`context/terminal-snapshot.json` 的用途。
- 调 `terminal.write` 前必须解析 target 和检查 generation。
- stale/missing/closed/generation mismatch 时要求用户 rebind，不猜 terminal。
- 配置文件仍在 workspace root，不在 session root。

### 3. MCP 只做运行态

Kerminal MCP server 保留：

- terminal/session 操作。
- SSH command、SFTP、container、port forwarding。
- server info、history search、diagnostics。
- session target context。

Kerminal MCP server 不提供：

- settings/profile/host/snippet/workflow CRUD。
- UI 编排。
- history 写入/删除/清空。
- Kerminal 自己的 pending/confirm/approval/audit 队列。

这些由文件操作、前端交互或 MCP host 策略承担。

### 4. Validator 是硬边界

手册可以指导，validator 必须拦住确定性错误：

- 普通 TOML 解析失败。
- 缺 `schema_version = 1`。
- id 与文件名不一致。
- host/group/profile 引用不一致。
- host 必填字段缺失或类型错误，尤其 `production`。
- auth_type、scope、requires_confirmation 类型错误。
- secret-like key/table 出现在普通 config。
- workflow step id 重复或 sort_order 非递增。

### 5. 兼容和严格分离

运行时代码可以为了兼容旧配置保留 serde default；Agent-authored 配置必须按手册和 validator 严格写全。这样既不破坏用户旧文件，又能防止新 Agent 继续产出模糊配置。

## 推荐流程

外部 Agent 收到“新增主机”请求时：

1. 读取当前 cwd 的 `AGENTS.md`。
2. 如果在 session 目录，读取 `context/mcp-endpoint.json` 和 target context；如果只是改配置，不需要 live terminal。
3. 读取 workspace root 的 `kerminal-config.md`。
4. 搜索 `hosts/groups.toml` 和 `hosts/*.toml`，确认 group、id、host 是否已存在。
5. 创建或更新 `hosts/<id>.toml`，显式写入 `schema_version`、`id`、`name`、`host`、`port`、`username`、`auth_type`、`tags`、`production`、`sort_order`、`created_at`、`updated_at`。
6. 不写 `credential_secret`、password、token 或私钥正文。
7. 运行 validator。
8. validator 不通过时先修文件；通过后说明写了哪些文件。

## Kerminal 需要修改的文件

- `.updeng/docs/config/external-agent-workspace.md`：写清三层 prompt/config/validator 分工。
- `.updeng/docs/config/kerminal-config-files.md`：同步详细配置手册和 validator 要求。
- `src-tauri/src/services/external_agent_workspace.rs`：生成更详细的 `kerminal-config.md`，强化全局和 session 入口提示。
- `.codex/skills/bwy-kerminal-config-files/SKILL.md`：同步外部 Agent 操作协议和 validator 口径。
- `src-tauri/src/services/mcp_tool_executor_service/config_tools.rs`：运行态 MCP `kerminal.config.validate` 补充 `production` 等确定性校验。
- `.codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs`：保留源码维护和 self-test 路径，和 MCP validator 的严格字段口径一致。
- `src-tauri/tests/external_agent_workspace.rs`：断言生成手册包含主机 checklist、`production` 必填、session 入口指向 workspace root 的 `kerminal-config.md`。

## 最终建议

采用三层结构并保持 MCP tools-only：

- `AGENTS.md` / `CLAUDE.md`：短入口和硬边界。
- Session `AGENTS.md` / `CLAUDE.md`：runtime 绑定和 target 安全。
- `kerminal-config.md`：详细配置手册。
- Validator：确定性 schema gate。

这比给 MCP 增加 host/settings/snippet/workflow CRUD 更可靠，因为 Kerminal 的配置事实源已经是 TOML 文件；让 Agent 直接修改文件并运行 validator，能保留用户可审查性、减少重复 API，并避免 MCP host 和 Kerminal 内部审批策略互相打架。
