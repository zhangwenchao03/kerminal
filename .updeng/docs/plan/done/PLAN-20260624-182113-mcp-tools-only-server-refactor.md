---
id: PLAN-20260624-182113-mcp-tools-only-server-refactor
status: done
created_at: 2026-06-24T18:21:13+08:00
started_at: 2026-06-24T18:30:03+08:00
completed_at: 2026-06-24T20:56:06+08:00
updated_at: 2026-06-24T21:32:02+08:00
owner: ai
---

# MCP Tools-only Server Production Refactor

## 背景

- Kerminal 右栏 AI 已退场，当前产品方向是 Codex、Claude 或自定义外部 Agent 通过 Kerminal MCP Server 操作应用能力。
- Codex/Claude 作为 MCP host 已经提供工具确认、权限、hook、审计或会话级策略；Kerminal MCP Server 不应再实现私有 pending/confirm/approval 协议。
- Codex/Claude 已经能在 Kerminal 外部 agent workspace 里直接读写文件型配置；`settings.toml`、`profiles/*.toml`、`hosts/*.toml`、`snippets/*.toml`、`workflows/*.toml` 等不应再通过 MCP CRUD 重复暴露。
- 当前代码仍包含 `ToolRegistryService`、`McpToolGateway`、`McpToolInvocationService`、MCP resources/prompts/manifest、安全策略摘要、pending invocation 和 observation 等旧内置 AI 时代的结构。
- 本次重构不要求兼容旧私有协议，目标是把 Kerminal MCP Server 收敛成标准 Streamable HTTP MCP tools server。

## 目标

- 对外只提供 MCP tools 能力：`initialize` 后只声明 tools capability，支持 `tools/list` 和 `tools/call`。
- 删除外部 MCP server 侧的 Kerminal 私有确认、审批、pending invocation、risk policy、tool audit、agent observation、manifest、resources 和 prompts。
- 保留 Kerminal 必要的本地安全边界：loopback 绑定、Host 校验、工具白名单、参数校验、目标存在性校验、路径/命令边界和敏感值脱敏。
- MCP 工具面只保留运行态能力；文件型配置修改由外部 Agent 直接编辑 workspace 文件，并由生成的 `AGENTS.md` / `CLAUDE.md` 和 validator 约束。
- 工具调用进入 `tools/call` 即视为 MCP host 已批准；Kerminal 直接执行并返回标准 `CallToolResult`。
- 工具结果使用标准 MCP content 和 structured content，不返回 Kerminal 私有 `approval`、`pendingInvocationId`、`requiresConfirmation` 等字段。
- 代码结构要能长期维护：工具规格、参数解析、执行器、错误映射、transport 生命周期和测试分层清晰。

## 非目标

- 不恢复 Kerminal 内置 AI chat、provider、conversation、agent run 或自定义 MCP client 管理。
- 不继续兼容旧 IPC `prepare -> confirm`、`execute_if_allowed`、pending queue、AI/MCP audit UI 或旧 mcp gateway manifest。
- 不通过 MCP 暴露纯前端动作，例如分屏、切换 tab、打开右侧工具面板、需要 Tauri `Channel` 才能建立输出流的新建可视终端。
- 不在 Kerminal MCP Server 内实现 Codex/Claude 的确认 UI、权限策略、hook 或审计复制品。
- 不通过 MCP 提供 settings/profile/host/snippet/workflow 等文件型配置 CRUD；这些能力通过 `~/.kerminal` workspace 的 `AGENTS.md` / `CLAUDE.md` 规则和直接文件编辑完成。
- 不把配置文件读写改回 SQLite；配置仍保持文件优先方向。

## 架构决策

采用“手写 `ServerHandler` + 静态工具规格 + 直接执行器”，不使用 `#[tool]` 宏作为主结构。

选择理由：

- Kerminal 工具数量多，且已有稳定 dotted id，例如 `ssh.command`、`sftp.list`、`remote_host.create`；静态规格表更适合做契约快照和分组维护。
- 多数工具依赖 `AppState` 中不同服务，手写 runtime context 比把大量业务逻辑塞进宏方法更清楚。
- 本次要删除旧确认/审计层，手写 `tools/list` 和 `tools/call` 能直接表达“host 已批准，server 只执行”的契约。
- `rmcp` 仍作为标准协议和 transport 实现使用；只是不采用宏糖生成工具目录。

## 目标模块结构

```text
src-tauri/src/services/mcp_server/
  mod.rs
  transport.rs        # Streamable HTTP 生命周期、bind/status/shutdown
  server.rs           # KerminalMcpServer，实现 ServerHandler
  tool_catalog.rs     # 静态 ToolSpec 列表，转换 rmcp::model::Tool
  tool_schema.rs      # JSON schema helper 和参数基础校验
  tool_executor.rs    # tool id -> category executor 分派
  tool_result.rs      # AppResult/ToolExecutionResult -> CallToolResult
  tool_error.rs       # AppError -> rmcp ErrorData / tool error content
  runtime.rs          # 从 AppState 构造只读执行上下文
  tools/
    terminal.rs
    ssh.rs
    sftp.rs
    container.rs
    port_forward.rs
    server_info.rs
    history.rs
    diagnostics.rs
```

旧模块处理：

- 删除 `src-tauri/src/services/mcp_tool_gateway.rs` 和 `mcp_tool_gateway/**`。
- 删除 `src-tauri/src/services/mcp_tool_invocation_service.rs` 和 `mcp_tool_invocation_service/**`。
- 删除 `src-tauri/src/models/mcp_tool_invocation.rs`。
- 删除或重写 `src-tauri/src/services/tool_registry_service.rs` 和 `tool_registry_service/**`；若前端不再展示工具目录，则完全删除。
- 重写 `src-tauri/src/services/mcp_streamable_http_server.rs`，或把其生命周期迁移到 `services/mcp_server/transport.rs` 后删除旧文件。
- 删除 Tauri commands 中旧 MCP tool prepare/confirm/execute-if-allowed 入口，只保留 MCP server start/stop/status 和外部 agent workspace 配置生成入口。
- 从 `AppState` 移除 `mcp_tool_invocations`、`mcp_tools`、`tools` 这三类旧状态字段。
- 从 settings UI 移除旧工具目录、审批策略、pending/audit 相关展示；设置页只显示 MCP server 状态、端口、endpoint 和 Codex/Claude 配置写入状态。

## 工具暴露原则

只暴露“必须依赖 Kerminal 运行态或远程连接能力”的工具。凡是外部 Agent 可以通过工作目录直接读写文件完成的能力，默认不做 MCP tool。

外部 Agent 默认工作模式：

- Codex/Claude 在 Kerminal 外部 agent workspace 中运行，读取生成的 `AGENTS.md` / `CLAUDE.md`。
- `settings.toml`、`profiles/*.toml`、`hosts/groups.toml`、`hosts/*.toml`、`snippets/*.toml`、`workflows/*.toml` 由 Agent 直接编辑。
- 修改文件型配置后运行 workspace validator；不要通过 MCP 工具重复实现 settings/profile/host/snippet/workflow CRUD。
- `data/`、`logs/`、`cache/`、`temp/`、`exports/` 和 `secrets/` 仍按生成规则限制访问，必要时才走 MCP runtime 工具或等待用户授权。

保留候选：

- `ssh.command`、`ssh.command_on_resolved_host`：非交互 SSH 命令。
- `sftp.*`：远程文件读写、预览、传输队列。
- `container.*`：容器列表和容器文件读取。
- `server_info.snapshot`：远程系统信息。
- `port_forward.*`：端口转发创建、列表、关闭。
- `diagnostics.*`：本地运行态诊断能力。
- `history.search`：只读命令历史查询；`history.record/delete/clear` 默认不暴露。
- `terminal.list`、`terminal.write`、`terminal.resize`、`terminal.close`、`terminal.log.*`：仅保留不需要前端 Channel 的既有会话操作，并要求参数显式提供 `sessionId`。

移除或不暴露：

- `terminal.create`：需要前端输出 Channel，不能作为独立 MCP tool。
- `terminal.resolve_current`：依赖前端焦点或 pane 绑定，外部 Agent 必须显式传 `sessionId`。
- `workspace.split_pane`、`workspace.focus_tab`、`workspace.open_tool`：纯 UI 动作。
- `ssh.connect`、`ssh.ensure_connected`：当前语义是打开可视 SSH 终端，属于 UI/会话编排；外部 agent 应使用 `ssh.command` 或已有 terminal session 工具。
- `connection.rdp_open`：启动外部 UI/process，且参数可能包含敏感连接信息。
- `settings.*`、`profile.*`、`remote_host.*`、`snippet.*`、`workflow.*`：文件型配置能力，默认由外部 Agent 直接编辑 workspace 文件并运行 validator。
- `history.record`、`history.delete`、`history.clear`：写入/清空历史属于 Kerminal 内部运行态维护，不作为外部 agent 默认工具。
- `workflow.run`：当前 registry 已禁用，且执行语义不属于 tools-only server 的第一阶段。
- 任何只服务旧内置 AI 面板、pending approval 或 manifest/resource/prompt 的工具。

最终暴露列表以 TASK-001 盘点结果为准；所有工具必须在契约测试里快照固定。

## 标准 MCP 行为

- `initialize`：
  - server name: `kerminal`
  - capabilities: only `tools`
  - instructions: 简短说明 Kerminal tools 只覆盖运行态动作，例如既有终端会话、SSH/SFTP、容器、端口转发和诊断；文件型配置请按 workspace `AGENTS.md` / `CLAUDE.md` 直接编辑，确认由 MCP host 负责。
- `tools/list`：
  - 返回 `Tool` 列表、title、description、inputSchema 和行为 annotations。
  - annotations 只表达 MCP 语义：readOnly、destructive、idempotent、openWorld；不再映射 Kerminal confirmation policy。
- `tools/call`：
  - 校验工具存在、启用、参数 object、必填参数和枚举。
  - 直接执行工具，不生成 pending id，不等待二次确认。
  - 成功：返回 `CallToolResult::structured(...)`，同时提供一段短 text summary。
  - 失败：参数错误映射 `invalid_params`；执行失败返回 tool-level error content 或 `structured_error`，避免把可恢复远程错误变成 transport 崩溃。
- `resources/list`、`resources/read`、`resources/templates/list`、`prompts/list`、`prompts/get`：
  - 不声明 capability。
  - 不实现业务内容；若 rmcp 默认需要 handler，返回空列表或 method unsupported，但不得在 initialize 中公布。

## 结果结构

统一内部执行结果：

```rust
pub struct McpToolExecutionOutput {
    pub summary: String,
    pub data: serde_json::Value,
    pub entities: Vec<serde_json::Value>,
}
```

对外 structured content：

```json
{
  "summary": "...",
  "data": {},
  "entities": []
}
```

约束：

- 不包含 `risk`、`confirmation`、`approvedBy`、`invocationId`、`pendingInvocationId`。
- 密码、私钥、token、代理凭据和环境变量中的敏感值必须脱敏或不返回。
- 远程命令输出继续遵守已有 `maxOutputBytes` 或服务级默认上限。

## 实施切片

### TASK-001：MCP 外部工具契约盘点

涉及文件：

- `src-tauri/src/services/tool_registry_service/catalog/*.rs`
- `src-tauri/src/services/mcp_tool_invocation_service/execution.rs`
- `src-tauri/tests/tool_registry_service/contract.rs`
- `src/lib/toolRegistryContract.fixture.json`

产出：

- 列出保留、移除、需要改名或需要重写参数的 tool id。
- 明确每个工具是否属于运行态能力、是否需要 sessionId/hostId、是否可能返回敏感数据；文件型配置 CRUD 默认移出 MCP 工具面。
- 写入计划 Round Log。

验收：

- 有一份最终 `tools/list` 快照草案。
- 纯 UI / client action 工具不进入保留列表。
- settings/profile/host/snippet/workflow 等文件型配置 CRUD 不进入保留列表。

### TASK-002：建立 tools-only MCP server 骨架

涉及文件：

- `src-tauri/src/services/mcp_server/**`
- `src-tauri/src/services/mod.rs`
- `src-tauri/src/state.rs`
- `src-tauri/src/lib.rs`

实现：

- 新增 `mcp_server` 模块。
- 迁移 Streamable HTTP start/stop/status 到 `transport.rs`。
- `KerminalMcpServer` 只声明 tools capability。
- 加入 Host/loopback 校验和端口扫描行为，不扩大网络暴露面。

验收：

- `initialize` capabilities 只有 tools。
- server 可启动、停止、重复启动状态稳定。

### TASK-003：静态 ToolSpec 与 schema 契约

涉及文件：

- `src-tauri/src/services/mcp_server/tool_catalog.rs`
- `src-tauri/src/services/mcp_server/tool_schema.rs`
- `src-tauri/tests/mcp_server_contract.rs`

实现：

- 定义 `ToolSpec { name, title, description, input_schema, annotations }`。
- 从 TASK-001 保留列表生成静态工具目录。
- 删除 `ToolRiskLevel` / `ToolConfirmationPolicy` 对外 MCP contract 依赖。
- 加工具契约快照测试，固定工具名、schema required、enum 和 annotations。

验收：

- `tools/list` 快照稳定。
- annotations 不再来源于 Kerminal 确认策略。

### TASK-004：直接执行器与结果映射

涉及文件：

- `src-tauri/src/services/mcp_server/tool_executor.rs`
- `src-tauri/src/services/mcp_server/tool_result.rs`
- `src-tauri/src/services/mcp_server/tools/*.rs`
- 现有业务 service 相关测试。

实现：

- 把旧 `mcp_tool_invocation_service/*_tools.rs` 中可复用的业务调用迁移到 `mcp_server/tools/*`。
- 删除 pending state、approval policy、client action、observation 和 invocation result 包装。
- 参数解析优先用 typed request struct；无法一次性 typed 的复杂工具先保留集中 JSON parser，但必须有参数边界测试。
- `AppError::InvalidInput` 映射 invalid params；远程连接失败、命令失败、文件不存在等映射 tool error content。

验收：

- 代表性工具可通过 `tools/call` 直接执行：`diagnostics.runtime_health`、`history.search`、`terminal.list`。
- 参数缺失、未知工具、错误枚举、目标不存在都有明确错误。

### TASK-005：删除旧 MCP gateway / invocation / registry 链路

涉及文件：

- `src-tauri/src/models/mod.rs`
- `src-tauri/src/models/mcp_tool_invocation.rs`
- `src-tauri/src/services/mcp_tool_gateway*`
- `src-tauri/src/services/mcp_tool_invocation_service*`
- `src-tauri/src/services/tool_registry_service*`
- `src-tauri/src/commands/tool_registry.rs`
- `src-tauri/src/storage/mod.rs`
- `src-tauri/src/storage/migrations.rs`

实现：

- 删除旧模型、服务、Tauri command 和测试。
- fresh schema 不再创建 MCP tool pending/audit 表。
- 如果 runtime SQLite 里已有旧表，新增一次幂等迁移删除或忽略；本次不保留旧数据兼容读取。

验收：

- `rg "McpToolInvocation|McpToolGateway|ToolRegistryService|ToolConfirmationPolicy|McpToolExecutionPolicy|pending_invocation"` 不再命中生产代码。
- storage fresh 初始化和 migration 测试通过。

### TASK-006：前端设置页与 Agent workspace 对齐

涉及文件：

- `src/features/settings/settings-tool-content/mcp-section.tsx`
- `src/features/settings/settings-tool-content/mcp-catalog.tsx`
- `src/features/settings/SettingsToolContent*.test.tsx`
- `src/lib/toolRegistryApi.ts`
- `src/lib/toolRegistryContract.fixture.json`
- `src-tauri/src/services/external_agent_workspace.rs`
- `.updeng/docs/config/external-agent-workspace.md`

实现：

- 设置页 MCP 区域只显示 server 开关、endpoint、端口、状态、复制配置和写入 Codex/Claude 配置。
- 删除工具目录、审批策略、pending/audit 相关 UI 和 API。
- 生成的 `AGENTS.md` / `CLAUDE.md` 明确：文件型配置直接编辑并运行 validator；MCP 只用于 live app / 远程连接 / 既有终端会话 / SFTP / 容器 / 端口转发 / 诊断。
- `.codex/config.toml` 与 `.mcp.json` 只指向 Kerminal MCP endpoint，不注入 Kerminal 私有协议说明。

验收：

- Settings 测试更新。
- 写入外部 agent workspace 后，Codex/Claude 配置只包含标准 MCP server，`AGENTS.md` / `CLAUDE.md` 包含文件直改优先规则。

### TASK-007：端到端 MCP smoke

涉及文件：

- `src-tauri/tests/mcp_streamable_http_server.rs`
- `src-tauri/tests/mcp_server_contract.rs`
- 可新增 `scripts/smoke-mcp-tools-only.mjs`

实现：

- 启动 Kerminal MCP server。
- 用标准 MCP client 执行 initialize、tools/list、tools/call。
- 验证 resources/prompts 不在 capabilities。
- 验证 unknown tool、invalid args、正常 read tool、正常 write/config tool。

验收：

- Rust MCP server tests 通过。
- Node 或 Rust smoke 能连接本地 endpoint 并调用至少 3 个代表工具。

### TASK-008：生产启动验证与文档收口

验证命令：

- `cargo test --manifest-path src-tauri/Cargo.toml mcp`
- `cargo test --manifest-path src-tauri/Cargo.toml storage_foundation`
- `npm run test:frontend -- src/features/settings/SettingsToolContent.mcp.test.tsx`
- `npm run build`
- 真实 dev server 启动冒烟。
- 涉及 Tauri/Rust server 后运行 `npm run tauri:dev`，或记录无法运行的具体环境原因。

文档：

- 更新 README 的 Kerminal MCP Server 描述。
- 更新 `.updeng/docs/decisions/ADR-0012-standard-streamable-http-mcp-server.md` 或新增 ADR，记录 tools-only 取代 resources/prompts 的最终决策。
- 完成后把本计划移入 `plan/done/`，Round Log 记录验证结果和残余风险。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| Rust MCP server | 是 | `src-tauri/src/services/mcp_streamable_http_server.rs`, `src-tauri/src/services/mcp_server/**` | MCP contract tests, streamable HTTP smoke |
| Tool execution | 是 | `src-tauri/src/services/mcp_server/tools/**`, existing domain services | targeted Rust tests, representative tools/call |
| Settings UI | 是 | `src/features/settings/**`, `src/lib/toolRegistryApi.ts` | frontend tests, build, theme smoke if UI changed |
| Storage | 是 | `src-tauri/src/storage/**` | storage foundation tests |
| External agent workspace | 是 | `src-tauri/src/services/external_agent_workspace.rs` | config generation tests |
| Public MCP contract | 是 | tools/list, tools/call | snapshot and smoke tests |
| Database compatibility | 否 | no old pending/audit compatibility | fresh schema and optional drop migration |
| Production network exposure | 是 | bind/Host validation | loopback and invalid Host tests |

## 风险与约束

- 当前主工作区已有大量未归因改动，正式实现前必须新建或登记独立 active lane，避免覆盖现有 UI 样式 lane。
- 删除旧 pending/audit/manifest/resources/prompts 会破坏旧 Kerminal 私有 MCP/AI 调用方；本计划接受该破坏性变更。
- 外部 agent 的确认策略不在 Kerminal 控制内，Kerminal 只能保证工具边界、参数校验和本地安全约束。
- 远程命令、SFTP、端口转发仍有真实副作用；文档和 tool description 必须清楚说明副作用，由 Codex/Claude host 决定确认。
- 如果 `rmcp` 对未声明 resources/prompts 的默认行为不符合预期，优先通过能力声明和空实现控制，而不是恢复资源/Prompt 功能。

## 回滚口径

- 每个 TASK 独立提交或 checkpoint。
- TASK-002 到 TASK-004 期间允许新旧代码短暂并存，但不对外承诺兼容；切换点必须由测试证明 `tools/list` 和 `tools/call` 可用。
- TASK-005 删除旧链路前必须已有 tools-only smoke 通过。
- 如 Tauri 启动或 MCP endpoint 不可用，回滚到上一提交，保留计划文档和失败验证记录。

## 完成标准

- `initialize` 只声明 tools capability。
- `tools/list` 返回最终保留工具列表，且 contract snapshot 通过。
- `tools/call` 不经过 pending/confirm/approval/audit 私有链路。
- 生产代码不再引用旧 `McpToolInvocationService`、`McpToolGateway`、`ToolRegistryService`。
- Settings 和外部 agent workspace 不再展示或生成旧 Kerminal 私有 MCP 协议。
- Rust tests、frontend tests、`npm run build`、真实 dev server smoke、`npm run tauri:dev` 或明确无法运行原因完成记录。

## Round Log

- 2026-06-24T18:21:13+08:00：根据用户要求建立 tools-only MCP server 生产级重构实施文档；本轮只登记 next 计划，不开始 Rust 代码改动。
- 2026-06-24T18:30:03+08:00：用户要求并行落地实现；计划从 next 激活为 active，准备按 TASK-001/TASK-002 并行推进。当前主工作区存在大量未归因改动，先保持 lane 可见，不覆盖其它 active UI lane。
- 2026-06-24T18:41:23+08:00：根据用户补充意见收窄工具暴露原则：settings/profile/host/snippet/workflow 等文件型配置不再作为 MCP CRUD 候选，外部 Agent 通过生成的 `AGENTS.md` / `CLAUDE.md` 规则直接编辑 workspace 文件并运行 validator；MCP tools 只保留必须依赖 live app、既有终端会话、保存凭据、SSH/SFTP、容器、端口转发、server info 和诊断的运行态能力。本轮同步修改 `src-tauri/src/services/external_agent_workspace.rs` 模板和断言。
- 2026-06-24T18:47:48+08:00：补充 lane owned path `src-tauri/src/services/external_agent_workspace.rs`，验证通过：`cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace`，13 个相关测试通过。首次 120 秒超时仅因编译等待，300 秒重跑通过。
- 2026-06-24T18:58:11+08:00：完成 HTTP MCP 直接执行桥切片：`initialize` 只声明 tools capability，resources/prompts handler 改为空列表或 unsupported；`tools/call` 改为 `McpToolInvocationService::execute_direct`，不再生成 pending invocation、不走 confirm_async、不返回 `approvedBy`、`invocationId`、`risk` 或 `confirmation`；外部 tools/list 过滤掉文件型配置 CRUD、前端 UI/client action、RDP 打开、SSH 可视连接和 history 写操作。验证通过：`cargo test --manifest-path src-tauri/Cargo.toml mcp_streamable_http_server`，4 个相关测试通过；`cargo test --manifest-path src-tauri/Cargo.toml mcp_tool_invocation_service`，service 单测和 131 个相关集成测试通过。
- 2026-06-24T18:59:54+08:00：补跑更宽 MCP 过滤验证通过：`cargo test --manifest-path src-tauri/Cargo.toml mcp`，覆盖 HTTP server、external agent workspace、旧 invocation/gateway 相关测试；说明本切片未破坏尚未删除的旧 gateway/invocation 测试。
- 2026-06-24T19:55:15+08:00：按用户要求清理残留扫描命中：删除 runtime 迁移和 storage foundation 测试里的旧 MCP 工具审计/待确认表兼容残留，去掉专用清理块；同时把本机文件操作局部参数和命令建议存储引用调整为不再误中 MCP 审计扫描。为解除当前脏工作区编译阻断，补齐 `ToolCategory::Snippet` label 分支。残留扫描通过：旧 MCP 工具审计/待确认表关键字无命中，`audit:|auditEnabled|...` 无命中。验证通过：`cargo test --test storage_foundation`，`cargo test --test command_suggestion_service`；临时 `target-mcp-residual-cleanup*` 已清理。
- 2026-06-24T20:31:01+08:00：根据用户补充“很多工具可以不需要，规则写入 AGENTS.md 和 CLAUDE.md 即可”继续收窄外部 MCP 边界：仓库入口 `AGENTS.md` 新增 Kerminal MCP 与外部 Agent 边界，新增 `CLAUDE.md` 导入 `AGENTS.md`；`ExternalAgentWorkspaceService` 生成的 `AGENTS.md` / `CLAUDE.md` 明确禁止期待 `settings.*`、`profile.*`、`remote_host.*`、`snippet.*`、`workflow.*`、`workspace.*`、`terminal.create`、`terminal.resolve_current` 和 history 写入/删除/清空类 MCP tools，并要求 `data/command.sqlite` 只通过 `history.search` 读取；`mcp_streamable_http_server` 集成 smoke 改为正向断言 `terminal.write`、`ssh.command`、`history.search`、`diagnostics.runtime_health`，负向断言配置 CRUD/UI/history mutation 工具不在 `tools/list`。验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml`，`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`，`cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace`，`cargo test --manifest-path src-tauri/Cargo.toml mcp`，`cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation`，`npm run test:frontend -- src/features/settings/SettingsToolContent.mcp.test.tsx src/features/settings/SettingsToolContent.test.tsx src/lib/toolRegistryApi.test.ts`，`npm run build`，真实 Vite dev server smoke（HTTP 200 且包含 React root）。`npm run tauri:dev` 已执行到 Rust dev profile 完成并启动 `target\debug\kerminal.exe`，但本机真实 `~/.kerminal/kerminal.db` 为 schema 30，当前代码支持 schema 3，应用启动 panic：`UnsupportedSchemaVersion { database_version: 30, supported_version: 3 }`；尝试临时覆盖 `USERPROFILE/HOME` 在 Windows `dirs::home_dir()` 下仍解析到真实 home，故本轮未能完成完整 Tauri 窗口 smoke。残余风险记录为本地数据目录版本/隔离启动问题，不属于 MCP tools-only catalog 或模板改动。
- 2026-06-24T20:56:06+08:00：完成命名收口切片：Tauri command 模块从 `commands/tool_registry.rs` 改为 `commands/mcp_http_server.rs`，公开 IPC 从 `tool_registry_mcp_http_{start,status,stop}` 改为 `mcp_http_server_{start,status,stop}`；前端 API 从 `src/lib/toolRegistryApi.ts` / `toolRegistryPreview.ts` 改为 `src/lib/mcpServerApi.ts` / `mcpServerPreview.ts`，settings 测试 mock 同步改名；Rust 模型模块从 `models/tool_registry.rs` 改为 `models/mcp_server.rs`。残留扫描通过：`ToolRegistryService|ToolConfirmationPolicy|McpToolExecutionPolicy|McpToolInvocation|McpToolGateway|pending_invocation|tool_registry|toolRegistryApi|toolRegistryPreview|tool_registry_mcp_http` 在 `src`、`src-tauri/src`、`src-tauri/tests` 无命中；配置 CRUD/UI/history mutation 只保留在 MCP smoke 负向断言或内部运行态 history 记录路径中。验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml`，`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`，`npm run test:frontend -- src/features/settings/SettingsToolContent.mcp.test.tsx src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsToolContent.appearance-theme.test.tsx src/lib/mcpServerApi.test.ts`，`cargo test --manifest-path src-tauri/Cargo.toml mcp`，`cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace`，`cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation`，`npm run build`，临时 Vite dev server smoke（`http://127.0.0.1:5175` 返回 200 且包含 React root）。`npm run tauri:dev` 再次完成 Rust dev 编译并启动 exe，但仍因本机真实 `~/.kerminal/kerminal.db` schema 30 高于当前支持 schema 3 而 panic；未删除或迁移用户真实数据，完整窗口 smoke 仍以该本地数据目录版本问题为剩余环境阻塞。
- 2026-06-24T21:32:02+08:00：按 goal completion audit 复核当前工作树。当前 `mcp_streamable_http_server.rs` 仍为手写 `ServerHandler`，`initialize/get_info` 只声明 tools capability；resources/resource templates/prompts list 返回空，read/get 返回 unsupported/invalid params；`tools/call` 直接调用 `McpToolExecutorService::execute`，不创建 pending/confirm/approval/audit 状态。当前 catalog 只包含 runtime tools：terminal existing-session、SSH command、SFTP、container、port forwarding、server info、history.search 和 diagnostics；配置 CRUD、UI choreography、`terminal.create`、`terminal.resolve_current` 和 history mutation 仅出现在文档或 smoke 负向断言。残留扫描确认旧 `ToolRegistryService|McpToolGateway|McpToolInvocation|ToolConfirmationPolicy|McpToolExecutionPolicy|pending_invocation|tool_registry_mcp_http|toolRegistryApi|toolRegistryPreview` 未在 `src`、`src-tauri/src`、`src-tauri/tests` 回流；`requiresConfirmation` 命中仅属于终端广播/workflow UI 的本地用户确认，不属于 MCP 私有协议。当前验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`，`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`，`cargo test --manifest-path src-tauri/Cargo.toml mcp`，`cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace`，`cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation`，`npm run test:frontend -- src/features/settings/SettingsToolContent.mcp.test.tsx src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsToolContent.appearance-theme.test.tsx src/lib/mcpServerApi.test.ts`，`npm run build`，Vite dev server HTTP smoke。`npm run tauri:dev` 仍完成 Rust dev 编译后在真实用户 `~/.kerminal/kerminal.db` schema 30 > supported 3 处 panic；未修改用户数据，1425 端口未残留监听。
- 2026-06-24T21:36:15+08:00：最终收尾发现 `scripts/capture-readme-screenshots.mjs` 的 README 截图 mock 仍兼容旧 `tool_registry_mcp_http_*` 和 `tool_registry_mcp_*` 命令；已改为新 `mcp_http_server_{status,start,stop}` 状态形状，并删除旧 registry mock 分支。验证通过：`rg "ToolRegistryService|McpToolGateway|McpToolInvocation|ToolConfirmationPolicy|McpToolExecutionPolicy|pending_invocation|tool_registry_mcp_http|toolRegistryApi|toolRegistryPreview" src src-tauri/src src-tauri/tests scripts README.md CLAUDE.md AGENTS.md -g "!**/target*/**"` 无命中；`rg -n "tool_registry_|toolRegistry|ToolRegistry" src src-tauri/src src-tauri/tests scripts README.md CLAUDE.md AGENTS.md -g "!**/target*/**"` 仅剩 `src/lib/mcpServerApi.test.ts` 中验证 `listToolRegistry` 不存在的断言；`git diff --check` 通过，仅有 Windows CRLF 提示；`npm run test:frontend -- src/lib/mcpServerApi.test.ts` 通过。
