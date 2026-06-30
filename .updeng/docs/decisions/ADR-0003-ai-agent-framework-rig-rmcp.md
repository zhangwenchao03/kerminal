# ADR-0003: AI Agent 框架采用 Rig 与 rmcp

## 状态

Superseded by [ADR-0017](ADR-0017-external-agent-launcher-and-mcp-only.md)

## 当前事实提示

- `rig-core` / 内置 LLM provider / 内置 AI conversation runtime 已退场；不要按本文恢复 Rig Agent 主链路。
- `rmcp` 仅作为 Kerminal MCP Streamable HTTP tools-only server 的实现依赖继续保留，当前 MCP 边界见 [ADR-0012](ADR-0012-standard-streamable-http-mcp-server.md) 和 [ADR-0017](ADR-0017-external-agent-launcher-and-mcp-only.md)。
- 旧 AI provider、conversation、pending invocation 和 provider 设置不再兼容读取；存储事实见 [ADR-0016](ADR-0016-file-first-storage-and-external-codex-workdir.md)。

## 修订关系

- 修订：[ADR-0002: AI Agent 控制平面与工具调用架构](ADR-0002-ai-agent-control-plane.md)

## 背景

ADR-0002 已经确定 AI 只能通过 Kerminal 的受控工具层操作终端、SSH、SFTP、设置、主题、片段和工作区。用户进一步确认：AI 部分要采用第三方框架，不要在业务代码里手写 LLM API 调用；LLM Agent 使用 Rig，功能调用使用 rmcp。

本决策只调整 AI 框架实现方式，不改变 ADR-0002 的安全边界：Kerminal 仍然必须保留工具风险分级、确认策略、审计、脱敏和凭据引用。

## 决策驱动因素

- AI 是第一版核心能力，不能只做命令解释。
- 避免手写 OpenAI-style HTTP client、工具调用协议和模型适配细节。
- 工具调用需要尽早对齐 MCP，方便后续暴露 MCP Server 和接入外部 MCP Server。
- 终端、SSH、SFTP 和批量命令具有高风险，不能因为引入框架而绕过 Kerminal policy/audit。
- Rust 侧需要和 Tauri、SQLite、凭据、PTY/SSH service 保持同一安全边界。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| Rig + rmcp + Kerminal policy/audit | 复用 Rust LLM Agent 框架；工具调用对齐 MCP；后续外部 MCP 扩展顺滑 | 需要设计 Rig tool 与 Kerminal tool registry/rmcp 的适配层 | 框架 API 变化、能力边界不清会影响实现 | 本地 Agent 调用 terminal/settings/mock SFTP tool，确认和审计都生效 |
| 手写 reqwest 调 LLM API + 内置 Tool Registry | 可控、依赖少 | 重复造 provider、tool call、stream、retry 和 schema 轮子 | 后续模型/MCP 适配成本高 | 不采用 |
| 只用 Rig 内置 tool，不引入 rmcp | Agent 实现更简单 | 与 MCP Server/Client 目标脱节，工具协议后续再迁移 | 后续外部 agent 集成成本上升 | 不采用 |
| 只做 MCP Server，让外部 Agent 调用 | 标准化程度高 | 第一版内置 AI 体验不足，依赖外部客户端 | 用户无法在 Kerminal 内完成闭环 | 作为后续扩展，不作为第一入口 |

## 决策

采用 Rig + rmcp + Kerminal policy/audit 的 AI 架构：

- `rig-core` 作为 Rust 侧 LLM Agent 编排框架，负责 provider abstraction、agent runtime、tool 调用编排和后续流式对话能力。
- `rmcp` 作为 Kerminal 功能调用的 MCP SDK，负责工具定义、工具调用协议、未来 MCP Server/Client transport 和 schema 边界。
- Kerminal Tool Registry 仍然存在，但定位从“模型直接调用的内部工具表”收敛为“业务工具目录 + 风险策略 + 审计元数据 + service adapter”。
- AI 调用链改为：`React AI Panel -> Tauri Command -> Rust ai_agent_service -> Rig Agent -> rmcp/Kerminal Tool Gateway -> policy/audit -> domain services`。
- LLM Provider 设置仍然保留 base URL、API key credential ref、model、上下文策略，但 provider 连接由 Rig provider/client 承担；业务代码不直接手写 LLM HTTP 请求。
- rmcp 不替代安全策略。任何 remote、batch、destructive 工具在进入 service 前必须先通过 Kerminal policy 和用户确认。

Rust 模块命名建议：

```text
src-tauri/src/services/
├── ai_agent_service.rs      # Rig agent lifecycle, conversation and streaming
├── rig_provider_service.rs  # LLM provider config -> Rig client/agent factory
├── mcp_tool_gateway.rs      # rmcp tool definitions, dispatch and future MCP transport
└── tool_registry.rs         # Kerminal business tools, risk, audit policy metadata
```

## 影响

正向影响：

- 业务代码不维护底层 LLM API 细节，模型/provider 扩展更可控。
- Kerminal 的工具体系从第一版开始向 MCP 对齐，后续开放 MCP Server/Client 不需要重写能力层。
- Rig 与 rmcp 都是 Rust 生态依赖，和 Tauri/Rust 后端边界一致。

负向影响：

- 第一版需要多一层 Rig/rmcp adapter，不能把工具调用直接写成 service 函数。
- 测试需要覆盖框架 adapter、policy 拦截、审计写入和工具执行结果，不只测 service。
- 框架版本升级可能带来 API 调整，需要把依赖隔离在 service 层。

当前整理说明：

- 本 ADR 记录的是旧内置 AI runtime 方向；2026-06-24 后当前产品方向以 ADR-0017 为准：右栏保留外部 Agent Launcher，Kerminal 暴露自己的 MCP Server，不继续维护内置 AI provider/conversation/runtime 主链路。
- 早期 `.updeng/docs/plan/next/terminal-product-plan.md` 已删除；新的 AI/Agent 相关实施只从 ADR-0017 和当前 active 计划进入。
- `rmcp` 仍作为 Kerminal MCP Server 相关实现依赖保留；Rig/内置 provider 方向不再作为当前新增功能的依据。

## 回滚或替代

- 如果 Rig 的 provider/tool API 在关键场景不满足需求，保留 `ai_agent_service` 接口，替换为其他 Rust Agent 框架，但不改变 React 和 Tool Gateway 契约。
- 如果 rmcp 在内嵌调用上成本过高，第一版可以先通过 Kerminal Tool Gateway 内部适配 Rig tool，保留 rmcp schema/transport 模块作为外部 MCP Server/Client 层，但不得回退到 AI 直接调用 service。
- 如果某个模型供应商 Rig 暂不支持，优先写 Rig provider adapter；只有非 AI 普通 HTTP 功能才直接使用 `reqwest`。

## 验证

- `cargo test` 覆盖 Rig provider config 转换、缺失 API key credential ref、模型配置错误。
- `cargo test` 覆盖 rmcp tool schema、tool dispatch、policy 拦截和 audit 写入。
- AI 能读取当前 terminal context，但脱敏后的上下文预览必须可见。
- AI 调用 `terminal.write`、`settings.update` 等低风险/写入工具时进入审计。
- AI 调用 SSH、SFTP、批量命令或 destructive tool 时必须先进入确认状态。
- 不允许在 Rust 业务服务中出现绕过 Rig 的手写 LLM chat/completions HTTP 调用。

## 资料来源

- `cargo info rig-core`：`rig-core 0.38.2`，说明为 LLM powered applications 框架，features 包含 `rmcp`。
- `cargo info rmcp`：`rmcp 1.7.0`，说明为 Rust SDK for Model Context Protocol，features 包含 client/server 和多种 transport。
- [rig-core docs.rs](https://docs.rs/rig-core/0.38.2)
- [rmcp docs.rs](https://docs.rs/rmcp)

