<!-- @author kongweiguang -->

# ADR-0019: 外部 Agent Workspace 指令与配置手册分层

## 状态

Accepted

## 背景

Kerminal 已将配置事实源迁移到文件优先目录 `~/.kerminal`。外部 Codex、Claude 或自定义 Agent 从 Kerminal 右栏启动时，默认 cwd 是 `~/.kerminal/agents/sessions/<agentSessionId>`。用户报告 AI 添加主机后文件存在但功能未生效，暴露出当前入口提示、配置手册和 validator 的分工不够硬。

本决策基于调研报告 `.updeng/docs/reports/external-agent-instruction-research-20260625.md`。

## 决策驱动因素

- Agent 从 cwd 自动加载规则，session cwd 不能假设会读到全局规则。
- 配置字段、关联关系和禁止项比入口提示复杂，需要详细手册。
- 文件型配置必须可审查、可 diff、可 validator 拦截。
- Kerminal MCP server 面向外部 MCP host 时只应暴露运行态工具，避免重复实现配置 CRUD 和审批队列。
- 运行时可为了兼容旧文件保留默认值，但 Agent 新写配置必须严格、显式、可校验。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| A. 全部规则写入 `AGENTS.md` / `CLAUDE.md` | Agent 入口一次读完 | 文件过长，字段变化导致入口频繁改，session 仍可能漏读全局入口 | Agent 忽略长提示或过期字段 | 入口文件长度和生成测试 |
| B. 为 settings/profile/host/snippet/workflow 增加 MCP CRUD | Agent 不直接碰 TOML | 复制一套 schema、错误处理和审批；违背文件事实源；MCP host 和 Kerminal 审批边界混乱 | 工具目录膨胀，配置和文件漂移 | MCP tools/list 不出现 CRUD |
| C. 三层指令 + 文件直改 + validator | 入口短、手册详、硬校验；符合 Codex/Claude/Copilot 等实践 | 需要维护生成手册和 validator 一致 | 手册/validator 仍可能落后运行时模型 | 生成测试、validator 自测、真实 `~/.kerminal` 校验 |

## 决策

采用方案 C。

Kerminal 外部 Agent workspace 分为三层：

1. 全局 `~/.kerminal/AGENTS.md` / `CLAUDE.md`：短入口，说明 runtime workspace、MCP tools-only、配置文件直改、禁止区域和 validator。
2. 会话 `~/.kerminal/agents/sessions/<id>/AGENTS.md` / `CLAUDE.md`：自包含 runtime 入口，写入 session id、workspace root、session root、session-scoped MCP endpoint、target binding 和 `terminal.write` generation 规则。
3. `~/.kerminal/kerminal-config.md`：详细配置手册，覆盖 settings/profile/groups/hosts/snippets/workflows 的字段、示例、创建流程、关系、禁止项、失败模式和 validator。

Validator 是确定性门禁：

- 拦截普通配置 TOML 的 schema、id、引用、secret-like key、字段类型和 workflow 顺序错误。
- 对 Agent 新写 host 要求显式 `production = true|false`。
- 即使运行时 serde 对旧文件保留兼容默认，validator 仍要求 Agent-authored 配置写全安全相关字段。

## 影响

- 需要更新 `src-tauri/src/services/external_agent_workspace.rs` 的生成模板。
- 需要更新 `.updeng/docs/config/external-agent-workspace.md` 和 `.updeng/docs/config/kerminal-config-files.md`。
- 需要更新 `.codex/skills/bwy-kerminal-config-files/SKILL.md` 和 validator 脚本。
- 需要更新 `src-tauri/tests/external_agent_workspace.rs` 和 validator self-test。
- 不新增 settings/profile/host/snippet/workflow MCP CRUD。

## 回滚或替代

如果三层结构过重，可以保留 validator 和文件直改，缩短 `kerminal-config.md` 的叙述，但不能回滚到 MCP CRUD。若某类配置确实需要 live app 状态才能安全修改，应新增专门运行态工具，而不是通用 CRUD。

## 验证

- `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --self-test`
- 外部 Agent 运行态默认调用 MCP 工具 `kerminal.config.validate`，例如 `scope = "all"` 或 `scope = "hosts"`。
- 源码维护时可用 `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --root ~/.kerminal --json` 做补充检查，但它不是分发用户路径的默认要求。
- `cargo test --manifest-path src-tauri/Cargo.toml --test external_agent_workspace`
- `cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server generated_codex_and_claude_configs_connect_to_tools_list`
- 搜索确认外部 MCP tools 不包含 settings/profile/host/snippet/workflow CRUD。
- 人工检查 `kerminal-config.md` 覆盖 host 新增 checklist、`production` 必填、secret 禁止项和 validator。
