---
id: PLAN-20260623-221108-ai-sidebar-external-agent-launcher
status: done
created_at: 2026-06-23T22:11:08+08:00
started_at: 2026-06-23T22:25:26+08:00
completed_at: 2026-06-24T16:06:30+08:00
updated_at: 2026-06-24T16:06:30+08:00
owner: ai
---

# 右栏 AI 退场与外部 Agent Launcher 生产级实施计划

## 目标

- 删除当前右边栏内置 AI 功能和相关设置。
- 删除 LLM Provider、AI 配置、AI conversation、AI audit、pending invocation、context snapshot、自定义 MCP server 和自定义 skills 主链路。
- 保留 Kerminal 自己的 Streamable HTTP MCP Server。
- 右栏 `AI` 工具变成 Apple-inspired 外部 Agent Launcher，提供 Codex、Claude、自定义 agent 三类入口。
- 点击 Codex/Claude 时，在 Kerminal 中以 `~/.kerminal` 为工作目录打开对应 CLI，并确保该目录已有 MCP 配置和 agent 指令文件。
- 与 [ADR-0016](../../decisions/ADR-0016-file-first-storage-and-external-codex-workdir.md) 对齐：配置逐步从 SQLite 迁移到文件，AI 可以通过文件和 MCP 操作 Kerminal。

## 非目标

- 不接 Codex app-server。
- 不在 Kerminal 内重建 Codex/Claude chat UI。
- 不保存外部 agent thread、turn、message、approval 或 event mirror。
- 不继续维护 Kerminal 自定义 MCP server/client 配置器。
- 不在本计划里完成全部文件化存储实现；文件化存储仍按 ADR-0016 分阶段推进。
- 不保留旧 AI 对话、附件、provider 和 pending invocation 的兼容读取路径。

## 产品判断

这个方向是合理的。Kerminal 的核心价值不是再造一个 AI agent host，而是把本地终端、多主机、SFTP、端口转发、系统信息和配置变成一个可被 agent 操作的工作台。内置 AI 越完整，Kerminal 越容易被迫维护模型供应商、上下文窗口、会话恢复、审批、图片附件、工具调用和插件生态。Codex/Claude 已经成熟，Kerminal 应该把能力以 MCP 和文件配置暴露出去。

推荐边界：

- Kerminal 是 capability server 和 workspace manager。
- Codex/Claude 是 agent runtime。
- `~/.kerminal` 是 agent-facing workspace。
- MCP 是运行时操作协议。
- TOML/JSON/JSONL 是配置和状态事实源。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 右栏 UI | 是 | `src/features/tool-panel/ToolPanel.tsx`、`AiToolContent.tsx` | 前端测试、三主题截图、dev server |
| 设置页 | 是 | `SettingsToolContent.tsx`、`settingsModel.ts`、`settingsDefaults.ts` | 设置导航测试、build |
| Rust state | 是 | `src-tauri/src/state.rs` | Rust compile/tests |
| SQLite schema | 是 | `src-tauri/src/storage/**` | fresh schema test、grep |
| MCP Server | 是 | `mcp_streamable_http_server.rs`、`McpToolGateway` | MCP tools/list/resources smoke |
| 外部 agent workspace | 是 | `~/.kerminal/AGENTS.md`、`.codex/config.toml`、`.mcp.json` | 文件生成测试、CLI detection |
| 文件化存储 | 关联 | ADR-0016 对应计划 | 分阶段验证 |
| 文档/截图 | 是 | README、`.updeng/docs/config/` | 文档检查、截图更新 |

## Apple-inspired UI 设计

### 信息架构

右栏继续保留工具栏图标位，但 `AI` 的内容收敛为极简 Agent Launcher。初始态只显示三个入口图标：

```text
Agent Launcher
├─ Codex
├─ Claude
└─ 自定义

点击任一入口后，右栏内容切换为内嵌本地终端视图，cwd 为 `~/.kerminal`。低频操作放到 `Kerminal MCP Server` 设置页，不塞进右栏初始态。
```

### 视觉原则

- 整体是安静的工具面板，不做聊天界面，不显示气泡、输入框和消息历史。
- 主区域居中放三个轻量图标入口：Codex、Claude、`自定义`。
- 不显示聊天记录、状态卡片、provider 设置、模型配置或自定义 MCP/Skills 配置。
- MCP status、复制配置、打开目录等低频操作放到设置页。
- 未安装状态用灰色/琥珀色提示和“复制配置/打开目录”替代报错弹窗。
- 所有按钮使用图标 + 文本；右上更多操作用 icon-only + tooltip。
- 支持浅色、深色和跟随系统主题；portal/popover 复用全局主题。

### 交互

- `Open Codex`：
  1. 确保 Kerminal MCP Server running。
  2. 写入或更新 `~/.kerminal/AGENTS.md`。
  3. 写入或更新 `~/.kerminal/.codex/config.toml` 的 `[mcp_servers.kerminal]`。
  4. 在右栏内嵌本地终端中，cwd 为 `~/.kerminal`，运行 `codex` 或 `codex --cd ~/.kerminal`。
- `Open Claude`：
  1. 确保 Kerminal MCP Server running。
  2. 写入或更新 `~/.kerminal/AGENTS.md` 和 `~/.kerminal/CLAUDE.md`。
  3. 写入或更新 `~/.kerminal/.mcp.json`。
  4. 在右栏内嵌本地终端中，cwd 为 `~/.kerminal`，运行 `claude`。
- `Open Custom`：
  - 用户临时输入命令，例如 `kimi` 或 `qwen --model ...`。
  - 同样在右栏内嵌本地终端中以 `~/.kerminal` 为 cwd 运行。
  - 默认不初始化 custom agent 专属配置，不写入 shell profile，不保存 token。

## 外部配置方案

### Codex

`~/.kerminal/.codex/config.toml`：

```toml
[mcp_servers.kerminal]
url = "http://127.0.0.1:37657/mcp"
default_tools_approval_mode = "prompt"
tool_timeout_sec = 60
enabled = true
```

Codex 官方资料确认：项目级 `.codex/config.toml` 会在 trusted project 下加载，MCP server 使用 `[mcp_servers.*]` 表配置。

### Claude

`~/.kerminal/.mcp.json`：

```json
{
  "mcpServers": {
    "kerminal": {
      "type": "http",
      "url": "http://127.0.0.1:37657/mcp",
      "timeout": 60000
    }
  }
}
```

`~/.kerminal/CLAUDE.md`：

```md
@AGENTS.md

## Claude Code

- Treat this directory as the Kerminal configuration workspace.
- Use Kerminal MCP tools for runtime actions.
- Do not edit `secrets/` unless the user explicitly asks.
```

Claude Code 官方资料确认：project-scoped MCP 使用项目根 `.mcp.json`，Claude Code 读 `CLAUDE.md` 而不是 `AGENTS.md`，可用 `CLAUDE.md` 导入 `AGENTS.md`。

## 实施切片

### P0：冻结新边界和 inventory

- [x] TASK-001：生成 AI removal inventory。
  - 盘点 `AiToolContent`、`ai-tool-content/**`、LLM provider API、AI commands、AI services、AI storage、settings.ai、自定义 MCP/skills、tests。
  - 输出移除矩阵：delete / replace / keep-for-MCP / defer。
  - 验收：inventory 文档可复核，列出每个旧 AI 表和调用方。

- [x] TASK-002：新增目标 ADR/计划并同步 active lane 约束。
  - 当前文档即 P0 输入。
  - 开始编码前登记独立 lane：`lane-ai-sidebar-external-agent-launcher`。

### P1：Agent Launcher UI 替换右栏 AI

- [x] TASK-003：把右栏 `ai` 内容替换为 `AgentLauncherToolContent`。
  - 不再加载 assistant-ui runtime。
  - 不调用 `streamAiChatMessage`、LLM provider、conversation persistence。
  - 保留工具栏位置和快捷键，但文案改为打开 Agent。
  - 验收：打开右栏不触发任何 AI API；空工作区也能打开 launcher。

- [x] TASK-004：实现 CLI detection 和启动 action model。
  - 纯模型处理 installed/missing/config-ready/running/error 状态。
  - Tauri command 执行 `which/where codex`、`which/where claude` 或等价检测。
  - 启动时在右栏内嵌本地终端中运行对应 CLI，而不是后台静默 spawn。
  - 验收：检测缺失、检测存在、启动命令参数测试通过。

### P2：Kerminal MCP Server 设置页收缩

- [x] TASK-005：删除“AI 与模型”设置分类。
  - 删除 `LlmProviderSettingsSection` 可见入口和 `settings-ai` section。
  - 删除 AI 安全策略、上下文预算、自定义提示词 UI。
  - 验收：设置导航无 AI 分类。

- [x] TASK-006：把“MCP / Skills”改为“Kerminal MCP Server”。
  - 保留系统 MCP 服务状态、endpoint、tools/resources/prompts 浏览。
  - 删除用户自定义 MCP Servers 添加/发现/工具缓存 UI。
  - 删除用户自定义 Skills 文件夹 UI。
  - 增加复制 Codex/Claude 配置片段和打开 `~/.kerminal`。
  - 验收：设置页不再修改 `settings.ai.mcp`。

### P3：Agent workspace 文件生成

- [x] TASK-007：新增 `ExternalAgentWorkspaceService`。
  - 确保 `~/.kerminal/AGENTS.md`、`CLAUDE.md`、`.codex/config.toml`、`.mcp.json`。
  - 支持 dry-run diff、overwrite policy、backup。
  - 不写真实 token。
  - 验收：文件生成单测覆盖 Windows path、端口变化、已有用户内容保护。

- [x] TASK-008：新增 config runbook 和 validator 入口。
  - 文档来源：[external-agent-workspace.md](../../config/external-agent-workspace.md)。
  - validator 可先是 no-op scaffold，但命令和输出格式固定。
  - 验收：launcher 能显示 validator 状态。

### P4：前端/Rust settings model 删除 AI 嵌套字段

- [x] TASK-009：TypeScript `AppSettings` 删除 `ai` 字段。
  - 删除 `AiSecuritySettings`、`AiMcpSettings`、`CustomMcpServerSetting`、`CustomMcpSkillDirectorySetting` 等主链路类型。
  - 如 terminal inline suggestion provider 仍有 `ai` 枚举，另行评估删除或保留历史兼容值。
  - 验收：`rg "settings.ai|AiSecuritySettings|AiMcpSettings" src` 无主链路命中。

- [x] TASK-010：Rust `AppSettings` 删除 `ai` 字段。
  - 删除 AI policy validation。
  - MCP Server 改用系统工具 manifest，不再读取 `settings.ai.mcp`。
  - 验收：Rust compile，MCP manifest tests 通过。

### P5：删除内置 AI command/service/storage

- [x] TASK-011：删除 LLM Provider 主链路。
  - 删除 provider 设置 API、RigProviderService、provider table migration。
  - 保留必要依赖只服务 MCP 时另行说明，否则删除。
  - 验收：`rg "llm_providers|LlmProvider|rig_providers" src src-tauri/src` 无主链路命中。

- [x] TASK-012：删除 AI conversation / agent run / context snapshot / pending invocation 主链路。
  - 删除 `AiConversationService`、`AiAgentRunService`、AI attachment persistence。
  - 删除相关 Tauri commands 和 frontend API。
  - 验收：fresh schema 不创建 `ai_*` 表；frontend build 不引用旧 API。

- [x] TASK-013：删除 AI tool audit 主链路。
  - 外部 MCP tool 调用审计如果仍需要，应重命名为 `mcp_tool_audit` 或普通 runtime audit，不能继续叫 AI audit。
  - Logs UI 文案从 AI 审计改为 MCP/操作审计。
  - 验收：日志页无 AI 审计文案。

### P6：MCP Server 保留和净化

- [x] TASK-014：MCP Server 从自定义 MCP/Skills 解耦。
  - 删除 `custom_mcp_tool_definitions(&settings.ai.mcp)`。
  - 删除 `kerminal://settings/custom-mcp` resource。
  - 删除 user skill directories resource template，除非它代表 Kerminal 系统内置 skill。
  - 增加 MCP server instructions：说明外部 agent 应先读 workspace instructions 和 validator。
  - 验收：MCP `tools/list` 只返回系统可执行工具，client-action tools 仍过滤。

- [x] TASK-015：Codex/Claude MCP config smoke。
  - 启动 Kerminal MCP Server。
  - 生成 `.codex/config.toml` 和 `.mcp.json` fixture。
  - 用轻量 MCP client 或 Codex/Claude dry-run 检查 `tools/list`。
  - 验收：Kerminal endpoint 可连接，配置片段正确。

### P7：文件优先存储衔接

- [x] TASK-016：与 ADR-0016 的 TASK-001 storage inventory 合并。
  - AI 表删除不迁移。
  - settings/profile/hosts/snippets/workflows 继续按文件化计划执行。
  - 验收：两个计划不重复写同一个 schema 迁移切片。

- [x] TASK-017：`~/.kerminal/AGENTS.md` 写入配置操作规则。
  - 明确 config/secrets/logs/cache/state 边界。
  - 明确 validator 命令。
  - 明确需要运行时动作时使用 MCP。
  - 验收：Codex 从 `~/.kerminal` 启动能读取规则。

### P8：文档、截图和发布收口

- [x] TASK-018：更新 README 和截图。
  - README 去掉内置 AI provider/Agent Run 叙述。
  - 改为 Kerminal MCP Server + external agent workspace。
  - 设置截图更新。

- [x] TASK-019：全量验证和归档。
  - 前端测试。
  - Rust tests。
  - `npm run typecheck`。
  - `npm run build`。
  - dev server 三主题截图。
  - `npm run tauri:dev` 或记录本机阻断原因。

## 并行和 lane 策略

- 当前计划是 `next`，不登记 active lane。
- 开始编码前必须创建独立 lane/worktree，建议：
  - lane id：`lane-ai-sidebar-external-agent-launcher`
  - branch：`kong/ai-sidebar-external-agent-launcher`
- 当前工作区已有 active performance lane，且已触碰 `src/features/tool-panel/AiToolContent.tsx`；实现本计划前必须刷新 coordination status 并读取该 lane 最新 checkpoint/diff。
- 高风险 shared paths：
  - `src/features/tool-panel/AiToolContent.tsx`
  - `src/features/tool-panel/ToolPanel.tsx`
  - `src/features/settings/**`
  - `src-tauri/src/state.rs`
  - `src-tauri/src/models/settings.rs`
  - `src-tauri/src/storage/**`
  - `src-tauri/src/services/mcp_streamable_http_server.rs`
  - `.updeng/docs/plan/INDEX.md`
  - `.updeng/docs/in-progress.md`
  - `.updeng/docs/coordination/lanes.json`

## 验证矩阵

| 阶段 | 自动验证 | 手工/运行验证 |
| --- | --- | --- |
| P1 Launcher UI | Agent launcher model tests、ToolPanel tests | light/dark/system 截图 |
| P2 Settings | Settings nav tests、typecheck | 设置页打开无 AI/custom MCP 配置 |
| P3 Workspace | Rust file generation tests | 打开 `~/.kerminal` 检查文件 |
| P4 Settings model | Rust/TS compile、grep | 保存设置不写 AI 字段 |
| P5 AI deletion | fresh schema tests、dead-code grep | 应用启动无白屏 |
| P6 MCP server | MCP handler tests、tools/list smoke | Codex/Claude 连接 Kerminal MCP |
| P7 File storage | ADR-0016 对应验证 | Codex 修改配置并 validator 通过 |
| P8 收口 | build、tauri:dev | README/截图与产品一致 |

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 一次性删除 AI 导致右栏白屏 | 启动阻断 | 先替换 UI，再删后端 |
| MCP Server 仍依赖 `settings.ai.mcp` | 编译或运行失败 | P6 单独解耦 MCP manifest/resource |
| Codex/Claude CLI 不存在 | CLI 启动失败 | 三个入口仍保持可点击，右栏内嵌终端承接 command-not-found 或启动错误反馈 |
| `.codex/config.toml` / `.mcp.json` 覆盖用户内容 | 用户配置丢失 | 只 patch kerminal block，写前备份/diff |
| secrets 暴露给外部 agent | 凭据风险 | AGENTS/CLAUDE 明确禁止，validator 检查，后续考虑 secrets 移出默认 workspace |
| 删除 AI 表影响历史用户 | 旧历史不可见 | 用户已要求不保留内置 AI；实现前提示可手工备份旧 DB |
| 与性能 lane 冲突 | 覆盖并行改动 | 独立 worktree/lane，写 shared path 前同步 checkpoint |

## 完成标准

- 右栏 AI 打开的是 Agent Launcher，不是 chat。
- 设置页没有 AI provider、安全策略、自定义 MCP server 或 custom skills 配置。
- Kerminal MCP Server 仍能启动、复制 endpoint、供外部 MCP client 连接。
- Codex launcher 能生成 `.codex/config.toml` 并在 `~/.kerminal` 运行 Codex CLI。
- Claude launcher 能生成 `.mcp.json` / `CLAUDE.md` 并在 `~/.kerminal` 运行 Claude CLI。
- Fresh schema 不创建 `llm_providers` 或 `ai_*` 表。
- README 和 `.updeng/docs/config/external-agent-workspace.md` 说明新边界。
- 构建、真实 dev server smoke、必要 Tauri smoke 通过或记录明确阻断。

## Round Log

### 2026-06-23 Round 1：方案和计划落档

状态：完成设计方案、ADR、发现记录、config runbook 和 next plan 写入；当前不开始编码。

证据：

- 已读取 `AGENTS.md`、`README.md`、`.updeng/docs/README.md`、`.updeng/docs/in-progress.md`、`.updeng/docs/BLOCKERS.md`、`.updeng/docs/plan/INDEX.md`、`.updeng/docs/coordination/lanes.json`。
- 已读取项目技能：`bwy-updeng-workflow`、`bwy-development-governance`、`bwy-tech-decision`、`bwy-requirement-discovery`、`bwy-issue-planning`、`apple-inspired-ui-style`、`architecture-design`、`file-storage`、`database-ops`。
- 已用 CodeGraph 核对右栏 AI、settings.ai、自定义 MCP/skills、Kerminal MCP Server、SQLite AI 表和 `KerminalPaths`。
- 已用 OpenAI Codex manual 确认 `.codex/config.toml`、`[mcp_servers.*]`、`codex --cd`、`AGENTS.md` 和 app-server 边界。
- 已用 Claude Code 官方文档确认 `.mcp.json` project scope 和 `CLAUDE.md` / `AGENTS.md` 关系。

本轮修改：

- 新增 `.updeng/docs/discovery/2026-06-23-ai-sidebar-external-agent-launcher.md`。
- 新增 `.updeng/docs/decisions/ADR-0017-external-agent-launcher-and-mcp-only.md`。
- 新增 `.updeng/docs/config/external-agent-workspace.md`。
- 新增本计划。

验证：

- 本轮只改文档；未运行应用构建。
- 后续编码开始前必须登记 active lane/worktree，并从 TASK-001 inventory 开始。

### 2026-06-23 Round 2：右栏三图标 Agent Launcher 与外部 workspace 薄层

状态：完成 `TASK-001`、`TASK-003`、`TASK-004` 的可验证切片；`TASK-007` 完成 bootstrap/prepare 薄层但保留 dry-run diff/overwrite policy 的后续实现。

用户最新约束：

- 右栏 AI 助手初始界面只保留三个入口图标：Codex、Claude、`自定义`。
- 点击 Codex/Claude 后在右栏内部切换为本地终端视图，不在中间工作区新增 tab。
- `自定义` 由用户输入 CLI 命令，例如 `kimi` 或 `qwen --model ...`，随后同样在右栏内嵌终端运行。
- 默认初始化只生成 Codex/Claude 相关 `AGENTS.md`、`CLAUDE.md`、`.codex/config.toml`、`.mcp.json`，不初始化其它 agent。
- 用户目录写入由程序 bootstrap/repair 完成，Tauri resource 最多作为模板来源，不作为安装期直接拷贝主流程。

本轮修改：

- 新增 `.updeng/docs/reports/ai-removal-inventory-20260623.md`。
- 新增 `src/features/tool-panel/AgentLauncherToolContent.tsx`，初始态只有 Codex、Claude、`自定义` 三个入口；点击后渲染内嵌 `XtermPane`。
- 新增 `src/features/tool-panel/agent-launcher/agentLauncherModel.ts` 和测试，覆盖三入口排序、MCP 状态、custom command parsing、custom 不依赖默认配置文件。
- 新增 `src/lib/agentLauncherApi.ts`。
- `src/features/tool-panel/ToolPanel.tsx` 的 `ai` 内容改为懒加载 `AgentLauncherToolContent`，不再加载旧 `AiToolContent`。
- `src/app/KerminalShell.tsx` 与 `src/app/KerminalShell.workspaceBridge.tsx` 透传 `resolvedTheme` 和 `terminalAppearance`，供右栏内嵌终端继承当前主题和终端外观。
- 新增 `src-tauri/src/services/external_agent_workspace.rs` 与 `src-tauri/src/commands/external_agent_workspace.rs`。
- `src-tauri/src/state.rs` 在初始化时执行默认外部 agent workspace bootstrap，只写 Codex/Claude 文件。
- `src-tauri/src/commands/mod.rs`、`src-tauri/src/commands/registry.rs`、`src-tauri/src/services/mod.rs` 注册外部 agent workspace command/service。
- `src/features/tool-panel/ToolPanel.test.tsx` 相邻端口转发测试 mock 从旧 `closePortForward` 断言修正为当前组件实际调用的 `stopPortForward`。

验证：

- `npm run test:frontend -- src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx` 通过，3 files / 27 tests；Vitest 打印既有 jsdom canvas getContext 未实现提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace` 通过，5 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::file_store` 通过，2 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::audit_log_store` 通过，1 test。
- `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --self-test` 通过。
- `npm run typecheck` 通过。
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml` 通过。
- `npm run build` 通过；保留既有 Vite chunk size warning。
- `git diff --check` 无 whitespace error；仅输出当前工作区 LF/CRLF warning。
- `npm run tauri:dev` 未能进入窗口：Tauri beforeDevCommand 启动 Vite 时失败，`Port 1425 is already in use`。

运行态 UI 证据：

- 使用系统 Edge + Vite dev server `http://127.0.0.1:5184/` 验证右栏。
- 浅色截图：`.updeng/docs/verification/agent-launcher-right-panel-light.png`。
- 深色截图：`.updeng/docs/verification/agent-launcher-right-panel-dark.png`。
- 跟随系统深色截图：`.updeng/docs/verification/agent-launcher-right-panel-system-dark.png`。
- 自定义命令切换内嵌终端截图：`.updeng/docs/verification/agent-launcher-custom-terminal-smoke.png`。
- 5184 dev server 已按端口停止，PID 30008。

剩余：

- P2 settings 页面仍需删除 AI provider、安全策略、自定义 MCP、自定义 skills 可见入口。
- P4/P5/P6 后端旧 AI runtime、settings.ai、SQLite AI 表和 MCP custom resource 仍未删除。
- `tauri:dev` 需要释放 1425 端口后复验真实桌面窗口。

### 2026-06-23 Round 3：设置页 AI/custom MCP/custom skills 可见入口退场

状态：完成 `TASK-005`、`TASK-006` 的可验证切片；本轮只做 settings 可见入口和测试收缩，不删除旧 AI TypeScript/Rust 模型与后端主链路。

本轮修改：

- `src/features/settings/SettingsToolContent.tsx` 移除 `settings-ai` 可见分支，不再渲染 `AiSettingsSection`，也不再把 `settings.ai.mcp` 传给 MCP 设置页编辑。
- `src/features/settings/settings-tool-content/types.ts` 保留 legacy `settings-ai` 入参用于旧调用方编译，但映射到 `settings-mcp`；`settings-ai` 不再属于可见 section。
- `src/features/settings/settings-tool-content/options.ts` 删除“AI 与模型”导航项，把“MCP / Skills”改名为“Kerminal MCP Server”。
- `src/features/settings/settings-tool-content/mcp-section.tsx` 收缩为 Kerminal MCP Server 只读/操作页：保留本机 Streamable HTTP MCP Server、系统 tools、resources、prompts；删除用户自定义 MCP Servers、custom tool discovery、用户自定义 Skills 文件夹 UI；新增外部 Agent 工作目录卡片，支持打开 `~/.kerminal`、复制 Codex TOML 和 Claude JSON MCP 配置。
- `src/features/settings/SettingsDialog.tsx` 去掉设置弹窗描述里的“AI 与模型”。
- 更新 settings 测试 harness 和相关测试，覆盖 AI 导航消失、legacy `settings-ai` 跳到 Kerminal MCP Server、custom MCP/Skills 不可见、Codex/Claude 配置复制和打开工作目录。

验证：

- `npm run test:frontend -- src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsToolContent.controls.test.tsx src/features/settings/SettingsToolContent.mcp.test.tsx src/features/settings/SettingsDialog.test.tsx` 通过，4 files / 12 tests。
- `npm run test:frontend -- src/features/settings` 通过，9 files / 37 tests。
- `npm run typecheck` 通过。
- `npm run build` 通过；保留既有 Vite chunk size warning。
- `git diff --check -- <本轮 settings 文件>` 无 whitespace error；仅输出当前工作区 LF/CRLF warning。
- `Get-NetTCPConnection -LocalPort 1425` 显示 PID `105544` 仍在 listen/established，本轮未杀用户进程，未运行 `npm run tauri:dev`。

运行态 UI 证据：

- 使用 Edge + Vite dev server `http://127.0.0.1:5186/` 打开设置页并切到 `Kerminal MCP Server`。
- 浅色截图：`.updeng/docs/verification/settings-kerminal-mcp-light.png`。
- 深色截图：`.updeng/docs/verification/settings-kerminal-mcp-dark.png`。
- 跟随系统深色截图：`.updeng/docs/verification/settings-kerminal-mcp-system-dark.png`。
- Playwright 文案检查确认 `AI 与模型=false`、`用户自定义 MCP/Skills=false`、`Kerminal MCP Server=true`。
- 5186 dev server 已停止。

剩余：

- P4/P5/P6 后端旧 AI runtime、settings.ai、SQLite AI 表和 MCP custom resource/prompt 仍未删除。
- `LlmProviderSettingsSection`、`ai-section.tsx` 等旧文件仍保留到后续删除切片，当前不再通过 settings 可见入口访问。

### 2026-06-23 Round 4：右栏极简三图标与 custom CLI 路径边界修正

状态：完成用户最新“就三个图标，点击后右栏变成本地 CLI 终端”的 UI 收敛；完成 subagent 只读复核后发现的 custom command Windows path parser 修正。

本轮修改：

- `src/features/tool-panel/AgentLauncherToolContent.tsx` 初始态进一步收敛为三个轻量图标按钮，不再显示状态点和卡片化状态信息；`自定义` 命令输入改为紧凑命令条。
- `src/features/tool-panel/agent-launcher/agentLauncherModel.ts` 修正 custom command parser，普通 Windows 路径中的 `\` 不再被当作转义吞掉。
- `src-tauri/src/services/external_agent_workspace.rs` 让 custom launch spec 也返回拆分后的 `shell` 和 `args`，避免 API 合约与前端实际执行不一致。
- `src/features/workspace/workspaceData.ts` 删除工具描述中的旧 AI/LLM/AI 审计口径，改为外部 Agent、Kerminal MCP Server 和操作审计。

验证：

- subagent 只读复核确认主路径符合：右栏初始态只有 Codex、Claude、`自定义` 三入口；点击后在右栏内嵌 `XtermPane`；cwd 来自 `KerminalPaths.root`，即 `~/.kerminal`；默认初始化只写 Codex/Claude 文件，不初始化 custom agent 配置。
- `npm run test:frontend -- src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx` 通过，3 files / 27 tests；Vitest 仍打印既有 jsdom canvas getContext 未实现提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace` 通过，6 tests。
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml` 通过。
- `npm run typecheck` 通过。
- `npm run build` 通过；保留既有 Vite chunk size warning。
- `git diff --check -- <本轮文件>` 无 whitespace error；仅 `workspaceData.ts` 输出 LF/CRLF warning。

运行态 UI 证据：

- 使用 Edge + Vite dev server `http://127.0.0.1:5187/` 验证右栏极简三图标。
- 浅色截图：`.updeng/docs/verification/agent-launcher-minimal-light.png`。
- 深色截图：`.updeng/docs/verification/agent-launcher-minimal-dark.png`。
- 跟随系统深色截图：`.updeng/docs/verification/agent-launcher-minimal-system-dark.png`。
- 自定义命令切换内嵌终端截图：`.updeng/docs/verification/agent-launcher-custom-terminal-minimal.png`。
- `Get-NetTCPConnection -LocalPort 1425 -State Listen` 仍显示 PID `105544` 占用，未杀用户进程，未运行 `npm run tauri:dev`。

### 2026-06-24 Round 5：旧 AI runtime/settings/schema 主链路清理

状态：完成 P4/P5/P6 中 settings model、LLM Provider、AI conversation/agent/context runtime 和 custom MCP/Skills 主链路清理；保留 `AiToolInvocationService` 与 `ai_tool_audits` / `ai_tool_pending_invocations` 作为 Kerminal MCP `tools/call` 的执行、审批和审计兼容层，后续可单独重命名为 MCP 口径。

本轮修改：

- 新增 `src-tauri/src/models/agent_context.rs`，把 MCP application context 请求模型从旧 `ai_agent` 模块中剥离。
- 删除旧内置 AI runtime / provider / conversation 主链路文件，包括 `src-tauri/src/commands/ai.rs`、`ai_conversation.rs`、`llm_provider.rs`、`src-tauri/src/models/ai_agent*.rs`、`ai_conversation.rs`、`llm_provider.rs`、`src-tauri/src/services/ai_agent_*`、`ai_conversation_service*`、`rig_provider_service.rs`、`skills_repository.rs`、`mcp_discovery_service.rs`、`src-tauri/src/storage/ai_context_snapshots.rs`、`ai_conversations.rs`、`llm_providers.rs` 和相关旧测试。
- `src-tauri/src/models/settings.rs` 删除旧 `settings.ai` / custom MCP / custom skills / AI security policy 类型，改为固定 `McpToolExecutionPolicy`。
- `src-tauri/src/storage/migrations.rs` 升级到 schema v31：fresh DB 不再创建 `llm_providers`、AI conversation、message、attachment、context snapshot、agent run 表；v31 会清理旧库残留的这些表。
- 新增 `src-tauri/src/storage/migrations_tool_invocations.rs`，只保留 MCP tool pending invocation 兼容迁移。
- `src-tauri/src/paths.rs` 删除旧 `ai-attachments` 受管目录。
- `src-tauri/src/error.rs` 删除无调用方的 `LlmProvider` / `AiAgent` 错误变体。
- `src/features/settings/SettingsToolContent.testSupport.ts` 删除 custom MCP fixture；`tool_registry.rs` 注释改为系统 MCP + 协议兼容口径。

验证：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation` 通过，20 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service` 通过，138 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --test settings_service` 通过，5 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --test tool_registry_service` 通过，20 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --test mcp_tool_gateway` 通过，1 test。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace` 通过，6 tests。
- `npm run test:frontend -- src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsToolContent.controls.test.tsx src/features/settings/SettingsToolContent.mcp.test.tsx src/features/settings/SettingsDialog.test.tsx` 通过，7 files / 39 tests；保留既有 jsdom canvas `getContext` 提示。
- `npm run typecheck` 通过。
- `npm run build` 通过；保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5191` 启动成功，`Invoke-WebRequest http://127.0.0.1:5191/` 返回 200，临时 dev server 已停止。

搜索证据：

- `rg` 确认旧 `llmProvider`、`LlmProvider`、`RigProvider`、`mcp_discovery`、`skills_repository`、`AiToolContent`、`streamAiChatMessage` 无主链路命中。
- `settings-ai` 仅保留为 legacy deep-link 到 `Kerminal MCP Server` 的兼容 id；`AI 与模型` 只出现在不可见断言测试中。
- `llm_providers` / `ai_conversation%` / `ai_messages` / `ai_attachments` / `ai_agent_runs` 只剩 storage negative test 和 v31 drop 语句。

剩余：

- `TASK-015` 仍未跑真实 Codex/Claude MCP client smoke。
- `npm run tauri:dev` 仍受本机 1425 端口监听占用阻断，本轮未杀用户进程。

### 2026-06-24 Round 6：MCP tool audit/pending 命名迁移与回归收口

状态：完成 `TASK-012`/`TASK-013` 剩余的 MCP `tools/call` 命名迁移。旧 `AiToolInvocationService`、`ai_tool_audits` 和 `ai_tool_pending_invocations` 已改为 MCP 口径；旧表名只保留在 v32 兼容迁移和迁移测试中，用于老库升级复制后删除。

本轮修改：

- `src-tauri/src/models/ai_tool_invocation.rs` 重命名为 `mcp_tool_invocation.rs`，类型改为 `McpTool*`。
- `src-tauri/src/services/ai_tool_invocation_service.rs` 和子模块重命名为 `mcp_tool_invocation_service`，入口改为 `McpToolInvocationService` 与 `prepare_with_execution_policy`。
- `src-tauri/src/storage/ai_tool_audits.rs` / `ai_tool_pending.rs` 重命名为 `mcp_tool_audits.rs` / `mcp_tool_pending.rs`，fresh schema 创建 `mcp_tool_audits` 与 `mcp_tool_pending_invocations`。
- SQLite schema 升到 v32，迁移会从 legacy `ai_tool_audits` / `ai_tool_pending_invocations` 复制数据到 MCP 表后删除 legacy 表和索引。
- `PortForwardOrigin` 前端枚举从 `aiTool` 改为 `mcpTool`，端口转发列表文案改为 `MCP 工具`。
- 清理残留内部命名 `onOpenAiTool` 为 `onOpenAgentTool`，并把 MCP gateway/model 注释里的 `AI 面板` / `ai-panel` 改为外部 Agent/MCP client 口径。

验证：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation` 通过，22 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --test mcp_tool_invocation_service` 通过，138 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --test mcp_tool_gateway` 通过，1 test。
- `cargo test --manifest-path src-tauri/Cargo.toml --test tool_registry_service` 通过，20 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --test settings_service` 通过，5 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace` 通过，6 tests。
- `npm run test:frontend -- src/features/terminal/TerminalEmptyState.test.tsx src/features/terminal/terminalEmptyStateModel.test.ts src/features/terminal/TerminalWorkspace.test.tsx src/app/KerminalShell.test.tsx src/features/tool-panel/ToolPanel.test.tsx src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/PortForwardToolContent.test.tsx src/lib/portForwardApi.test.ts src/features/settings/SettingsToolContent.mcp.test.tsx src/features/settings/SettingsToolContent.test.tsx` 通过，11 files / 113 tests；保留既有 jsdom canvas `getContext` 提示。
- `npm run typecheck` 通过。
- `npm run build` 通过；保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5193 --strictPort` 启动成功，`Invoke-WebRequest http://127.0.0.1:5193/` 返回 200，临时 dev server 已停止。

运行态 UI 证据：

- 使用系统 Edge + Vite dev server `http://127.0.0.1:5193/` 打开右栏 Agent Launcher，最终截图：`.updeng/docs/verification/agent-launcher-final-5193-light.png`。
- 截图确认右栏初始态仍是 Codex、Claude、`自定义` 三个极简入口。

搜索证据：

- `rg "onOpenAiTool|openAiTool|ai-panel|AI 面板|AiTool|ai_tool|aiTool|prepare_with_ai_policy|AI 工具|AI 审计" src-tauri/src src-tauri/tests src` 只剩 legacy migration/test 中的 `ai_tool_audits` / `ai_tool_pending_invocations`。
- `rg "AI 与模型|LlmProvider|llmProvider|RigProvider|AiToolContent|streamAiChatMessage|settings\\.ai" src src-tauri/src src-tauri/tests` 只剩设置测试里断言 `AI 与模型` 不可见。

剩余：

- `TASK-015` 仍未跑真实 Codex/Claude MCP client smoke。
- `TASK-018` README 和截图仍待按新产品边界收口。
- `npm run tauri:dev` 仍受本机 1425 端口 PID `105544` 监听占用阻断，本轮未杀用户进程。

### 2026-06-24 Round 7：README、设置截图与 MCP Server 口径收口

状态：完成 `TASK-018`。README、外部 Agent workspace 文档、计划交互章节、右栏工具名称、设置页 MCP manifest/profile 文案和 README 设置截图已统一到“右栏 Agent Launcher + Kerminal MCP Server + `~/.kerminal` 外部 Agent 工作目录”口径；不再把 Kerminal 描述为内置 AI Agent runtime/provider。

用户最新口径：

- 右栏 AI 助手初始态只保留 Codex、Claude、`自定义` 三个极简图标。
- 点击后右栏自身切换为该 agent 的本地 CLI 终端，cwd 为 `~/.kerminal`。
- `自定义` 由用户输入 `kimi`、`qwen --model ...` 等 CLI 命令，Kerminal 不默认初始化其它 agent 配置。
- 安装/初始化只写 Codex/Claude 相关 `AGENTS.md`、`CLAUDE.md`、`.codex/config.toml`、`.mcp.json`。

本轮修改：

- `README.md` 去掉旧 `Agent Run`、AI provider/model、自定义 MCP/Skills 和 AI 审计叙述，改为外部 Agent Launcher 与 Kerminal MCP Server 边界。
- `docs/assets/kerminal-settings.png` 替换为新的 `Kerminal MCP Server` 设置页截图。
- `.updeng/docs/config/external-agent-workspace.md` 改为右栏内嵌本地终端启动策略，并明确 custom agent 不默认初始化配置。
- 本计划的信息架构/交互章节改为初始态三图标、低频 MCP 状态放设置页、点击后右栏内嵌终端。
- `src/features/workspace/workspaceData.ts`、前后端默认快捷键和相关测试把右栏工具展示名改为 `Agent Launcher`。
- `src-tauri/src/services/mcp_tool_gateway/**`、`src/lib/toolRegistryPreview.ts`、`toolRegistryModel.ts` 和测试 fixture 把用户可见 MCP profile 名称从 `Kerminal Agent` 改为 `Kerminal MCP Server`，描述为面向外部 Agent 的本地 MCP 能力服务。
- `src-tauri/src/services/external_agent_workspace.rs` 的默认 `AGENTS.md` 标题改为 `Kerminal External Agent Workspace`。

验证：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `npm run test:frontend -- src/features/settings/SettingsToolContent.mcp.test.tsx src/features/settings/SettingsToolContent.controls.test.tsx src/features/tool-panel/ToolPanel.test.tsx src/lib/toolRegistryApi.test.ts` 通过，4 files / 26 tests；保留既有 jsdom canvas `getContext` 提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --test tool_registry_service` 通过，20 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace` 通过，6 tests。
- `npm run typecheck` 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- `npm run build` 通过；保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5194 --strictPort` 启动成功，HTTP 200；临时 dev server 已停止。
- Chrome DevTools 自动化打开设置页并切到 `Kerminal MCP Server`，三主题截图通过文本断言：存在 `Kerminal MCP Server` 和 `外部 Agent 工作目录`，不存在 `Kerminal Agent`、`AI 与模型`、旧 `MCP / Skills`。

运行态 UI 证据：

- 浅色：`.updeng/docs/verification/settings-kerminal-mcp-5194-light.png`。
- 深色：`.updeng/docs/verification/settings-kerminal-mcp-5194-dark.png`。
- 跟随系统：`.updeng/docs/verification/settings-kerminal-mcp-5194-system.png`，本机系统解析为 dark。
- README 设置截图已更新为 `docs/assets/kerminal-settings.png`。

搜索证据：

- `rg "Kerminal Agent|Agent Run|AI 与模型|AI 模型|AI 审计|AI remote|MCP / Skills|MCP/Skills|本地 AI 操作代理|AI 操作代理|Agent 身份|Agent 系统 Prompt|选择 Agent Skill" README.md src src-tauri/src/services src-tauri/src/models src-tauri/src/commands src-tauri/tests .updeng/docs/config/external-agent-workspace.md .updeng/docs/plan/active/PLAN-20260623-221108-ai-sidebar-external-agent-launcher.md` 只剩本计划历史 Round Log / checklist 中用于说明旧功能删除的记录，以及 `SettingsToolContent.controls.test.tsx` 里断言 `AI 与模型` 不可见的负向测试。

剩余：

- 文件优先存储主计划仍只完成基础设施和配置 skill 骨架，settings/profile/hosts/snippets/workflows 业务配置文件化仍需后续切片。
- `TASK-019` 全量验证和归档仍待最后统一收口。
- `npm run tauri:dev` 仍受本机 1425 端口 PID `105544` 监听占用阻断，本轮未杀用户进程。

### 2026-06-24 Round 8：Codex/Claude MCP 配置与 HTTP MCP client smoke

状态：完成 `TASK-015`。新增真实 Streamable HTTP MCP Server smoke：测试启动本地 Kerminal MCP endpoint，使用实际 `ExternalAgentWorkspaceService` 生成 Codex `.codex/config.toml` 与 Claude `.mcp.json`，再通过 `rmcp` Streamable HTTP client 执行 `tools/list`。

本轮修改：

- 新增 `src-tauri/tests/mcp_streamable_http_server.rs`，覆盖临时 home 初始化、Codex/Claude 配置生成、endpoint 写入、rmcp client 连接和 `tools/list`。
- `src-tauri/src/services/mcp_streamable_http_server.rs` 的内部 `KerminalMcpServer` 与 `start` 放宽为 `R: tauri::Runtime` 泛型，生产 Wry runtime 行为不变，测试可使用 Tauri `MockRuntime` 避免真实窗口和 Windows event loop 主线程限制。
- `src-tauri/Cargo.toml` 增加 dev-only `tauri` `test` feature；主依赖不启用该 feature，普通构建不携带测试模块。

验证：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server` 首次通过，1 test；随后改为 dev-only Tauri test feature 后，默认 `target/debug/kerminal.exe` 被既有进程占用，复验改用独立 target 目录。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-mcp-smoke --test mcp_streamable_http_server` 通过，1 test。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace` 通过，6 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --test tool_registry_service` 通过，20 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --test mcp_tool_gateway` 通过，1 test。
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。

剩余：

- `TASK-019` 全量验证和计划归档仍待执行。
- 文件优先存储主计划仍未完成 settings/profile/hosts/snippets/workflows 业务配置文件化。
- `npm run tauri:dev` 仍受本机 1425 端口 PID `105544` 监听占用阻断，本轮未杀用户进程。

### 2026-06-24 Round 9：缺 CLI 仍可点击与三入口行为补测

状态：按用户“就三个图标，点击后右栏变成 CLI 界面”的最新口径，Codex/Claude 不再因为 CLI 未探测到而禁用；如果 CLI 不在 PATH，内嵌终端负责显示启动失败或 command-not-found，避免入口变成不可点击状态。

本轮修改：

- `src/features/tool-panel/agent-launcher/agentLauncherModel.ts` 移除 Codex/Claude `installed=false` 时的 disabled 分支；保留 terminal launcher 不可用和 launch command 缺失的保护。
- 同文件保留 missing CLI 的 warning tone，避免把“未安装”误报成 ready。
- `src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts` 更新缺 CLI 行为断言。
- `src/features/tool-panel/AgentLauncherToolContent.test.tsx` 增加初始态精确三按钮断言，并补齐 Claude 点击后进入同一右栏 `XtermPane` 的测试。

验证：

- 只读 subagent 复核确认主路径符合最新口径：右栏初始态三入口、点击后右栏内嵌终端、Codex/Claude cwd 为 `~/.kerminal`、custom 使用用户命令且不初始化 custom 配置。
- `npm test -- --run src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx` 通过，2 files / 13 tests。
- `npm run typecheck` 通过。
- `npm run build` 通过；保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5201` 启动成功，`Invoke-WebRequest http://127.0.0.1:5201/` 返回 200，临时 dev server 已停止。
- `git diff --check -- src/features/tool-panel/agent-launcher/agentLauncherModel.ts src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx` 无 whitespace error。

运行态 UI 备注：

- 本轮尝试使用 Edge/Chrome headless 截取 `http://127.0.0.1:5201/`，但 Edge 输出为空白截图，Chrome 未生成可用截图；没有把该截图作为有效视觉证据。
- 本轮只改变 missing CLI 时是否 disabled 的行为，默认 installed=true 的三入口视觉未发生变化；此前 Round 4 / Round 6 / Round 7 已保留有效 Agent Launcher 与设置页截图证据。

剩余：

- `TASK-019` 全量验证和计划归档仍待执行。
- `npm run tauri:dev` 仍受本机 1425 端口 PID `105544` 监听占用阻断，本轮未杀用户进程。

### 2026-06-24 Round 10：加载态三入口稳定与 custom launch spec 收敛

状态：按用户“右边栏 AI 助手初始就三个图标，点击后右栏变成该 agent CLI 界面”的口径做最后一处交互收敛。加载 workspace status 时不再显示占位块或空面板，而是立即显示 Codex、Claude、`自定义` 三个真实入口；custom 启动后前端统一使用后端/preview 返回的 launch spec `shell` / `args`，不再前后端各自解析后再分叉。

本轮修改：

- `src/features/tool-panel/AgentLauncherToolContent.tsx` 增加固定 initial view model，status 加载前仍只渲染 Codex、Claude、`自定义` 三个按钮；删除三块 skeleton 占位。
- `src/features/tool-panel/AgentLauncherToolContent.tsx` 的 custom 启动路径改为使用 `prepareExternalAgentWorkspace` 返回的 `shell` / `args` / `cwd` / `env`，右栏 `XtermPane` 参数只有一个来源。
- 新增 `src/lib/agentCommandLine.ts`，承载 custom CLI executable + args 解析逻辑。
- `src/features/tool-panel/agent-launcher/agentLauncherModel.ts` 只 re-export command parser，保留既有 model 测试入口。
- `src/lib/agentLauncherApi.ts` 的浏览器 preview launch spec 也按同一 parser 拆分 custom command，避免 preview 与 Tauri 行为不一致。
- `src/features/tool-panel/AgentLauncherToolContent.test.tsx` 增加 workspace status 一直 loading 时仍是三个 launcher 的断言，并更新 custom launch spec mock。
- `src/features/terminal/terminalContextMenuModel.ts` 和 `TerminalContextMenu.tsx` 增加 `canSplit` 开关；`XtermPane` 仅在宿主传入 `onSplitPane` 时显示右键菜单分屏组，避免右栏 agent 终端出现无效“左右分屏/上下分屏”菜单。

验证：

- subagent 只读复核确认主路径符合最新口径，并指出 custom 前后端重复解析和右栏 agent 终端右键菜单分屏项无效风险；本轮已处理这两个风险。另一个“完整 shell 语法”风险当前按产品边界接受：自定义入口定义为 CLI 可执行文件及参数，例如 `kimi`、`qwen --model ...`，不是 shell 管道/重定向/alias 解释器。
- `npm test -- --run src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx` 通过，2 files / 14 tests。
- `npm test -- --run src/features/terminal/terminalContextMenuModel.test.ts src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx` 通过，3 files / 19 tests。
- `npm run typecheck` 通过。
- `npm run build` 通过；保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5202` 启动成功，`Invoke-WebRequest http://127.0.0.1:5202/` 返回 200。
- 生成默认工作台真实截图 `.updeng/docs/verification/agent-launcher-5202-chrome-isolated.png`，但默认页面未自动打开 AI 工具，只能证明应用真实渲染成功；CDP 自动点击右侧 AI 图标因当前 Node REPL 缺少 WebSocket 客户端未能产出目标右栏截图。未把失败截图作为目标视觉证据。

剩余：

- `TASK-019` 全量验证和计划归档仍待执行。
- `npm run tauri:dev` 仍受本机 1425 端口 PID `105544` 监听占用阻断，本轮未杀用户进程。

### 2026-06-24 Round 11：按“不兼容旧代码”清理旧入口残留

状态：按用户最新口径删除旧兼容入口，不再保留旧 `settings-ai` deep-link、自定义 Agent skills 目录、LLM API key helper 或 README 截图脚本里的旧 AI command mock。Kerminal MCP Server 的系统 skills catalog 继续保留，它属于 MCP Server 内部路由能力，不是用户自定义 skills 设置入口。

本轮修改：

- `src/features/settings/settings-tool-content/types.ts` 删除 `settings-ai` section id 和映射到 `settings-mcp` 的 legacy 逻辑。
- `src-tauri/src/paths.rs` 删除 `~/.kerminal/skills` 管理目录字段，启动目录初始化不再创建用户自定义 Agent skills 目录。
- `src-tauri/tests/storage_foundation.rs` 同步删除 `paths.skills` 断言。
- `src-tauri/src/services/credential_service.rs` 删除旧 `llm_api_key_ref()`。
- `scripts/capture-readme-screenshots.mjs` 删除旧 `llm_provider_list`、`ai_conversation_*`、`ai_tool_*` 和 `file_dialog_get_app_skills_directory` mock。
- `src/features/settings/SettingsToolContent.controls.test.tsx` 删除旧 `AI 与模型` 不可见负向断言。

验证：

- `npm run typecheck` 通过。
- `npm run test:frontend -- src/features/settings/SettingsToolContent.controls.test.tsx src/features/settings/SettingsToolContent.test.tsx src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts` 通过，4 files / 23 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test storage_foundation` 通过，23 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --lib external_agent_workspace` 通过，6 tests。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- `npm run build` 通过；保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 5204 --strictPort` 启动成功，`Invoke-WebRequest http://127.0.0.1:5204/` 返回 200，临时 dev server 已停止。
- `rg "settings-ai|AI 与模型|file_dialog_get_app_skills_directory|llm_api_key_ref|paths\\.skills|skills: root\\.join\\(|llm_provider_list|ai_conversation_list|ai_tool_pending_list|ai_tool_audit_list|ai_conversation_slot_get" src-tauri/src src-tauri/tests src scripts package.json README.md .updeng/docs/config/external-agent-workspace.md` 无命中。
- `git diff --check` 对本轮触碰文件无 whitespace error；仅保留当前工作区既有 LF/CRLF warning。
- `Get-NetTCPConnection -LocalPort 1425` 显示 `127.0.0.1:1425` 仍由 PID `105544` listen/established，占用未由本轮创建。

剩余：

- `TASK-019` 仍需跑全量验证和归档。
- `npm run tauri:dev` 仍需在 1425 端口空闲后复验；本轮未杀用户进程。

### 2026-06-24 Round 12：最终验证与旧 SQLite 兼容分支删除

状态：完成 `TASK-019`。按用户“不兼容之前代码，旧代码删除”的最新口径，删除 runtime SQLite 对旧 app-wide schema 的自动识别、归档和重置分支；旧 AI/LLM/custom MCP/custom skills 关键字在源码、测试、脚本和用户文档范围内无命中。右栏 Agent Launcher 运行态验证通过，初始态只有 Codex、Claude、`自定义` 三个入口。

本轮修改：

- `src-tauri/src/storage/migrations.rs` 删除旧 app-wide SQLite 表名单和 `is_old_app_wide_schema`。
- `src-tauri/src/storage/sqlite.rs` 删除旧库自动 `VACUUM ... INTO` 归档、drop tables 和重新迁移分支；unsupported runtime schema 直接返回 `UnsupportedSchemaVersion`。
- `src-tauri/tests/storage_foundation.rs` 删除旧库归档兼容测试，新增代表早期 `user_version = 30` runtime DB 直接拒绝的测试，保留 fresh schema 和 unsupported schema 拒绝测试。
- `src/features/machine-sidebar/MachineSidebar.tsx` 默认展开主机分组，异步加载的新分组也默认展开，只保留仍存在的手动折叠状态。
- `src/features/machine-sidebar/machineSidebarMenuDomain.test.tsx` 同步默认展开行为和右键菜单测试。
- `README.md` 的本地边界补充：文件优先版本不自动读取或迁移早期一体化 SQLite 数据库，升级前需要用户自行备份旧数据目录。

验证：

- `npm test -- --run src/features/machine-sidebar/machineSidebarMenuDomain.test.tsx` 通过，1 file / 7 tests。
- `npm run test:frontend` 通过，158 files / 1114 tests；保留既有 jsdom canvas `getContext` 提示。
- `npm run typecheck` 通过。
- `npm run build` 通过；保留既有 Vite large chunk warning。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --test storage_foundation` 通过，11 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --no-run -j 1` 通过，所有 Rust test targets 编译成功。
- `npm run dev -- --host 127.0.0.1 --port 5206 --strictPort` 启动成功，HTTP 200；运行态截图：`.updeng/docs/verification/final-agent-launcher-5206-msedge.png`。
- `npm run tauri:dev` 使用临时 `KERM_SMOKE_HOME=.updeng/tmp/tauri-smoke-home-2` 启动成功，Vite 1425 可用，Rust dev build 完成并运行 `target\debug\kerminal.exe`，进程保持 15 秒无启动崩溃；本轮 smoke 进程已停止，1425 已释放。

搜索证据：

- `rg "settings-ai|AI 与模型|LlmProvider|llmProvider|RigProvider|AiToolContent|streamAiChatMessage|llm_providers|ai_conversations|ai_messages|ai_attachments|ai_agent_runs|ai_context_snapshots|ai_tool_audits|ai_tool_pending_invocations|custom MCP|CustomMcp|mcp_discovery|skills_repository|file_dialog_get_app_skills_directory|paths\\.skills|llm_api_key_ref|old_app_wide|old-v" src src-tauri/src src-tauri/tests scripts README.md .updeng/docs/config/external-agent-workspace.md` 无命中。

剩余：

- `ExternalAgentWorkspaceService` 的 dry-run diff / overwrite policy / backup 仍未做成完整用户可见能力；当前主路径已能初始化 Codex/Claude 文件并启动右栏内嵌 CLI。

### 2026-06-24 Round 13：ExternalAgentWorkspace dry-run / backup / validator 收口

状态：完成 `TASK-007`、`TASK-008`、`TASK-016`、`TASK-017` 并归档本计划。`ExternalAgentWorkspaceService` 现在支持 dry-run diff、overwrite policy、backup reporting、validator status；`~/.kerminal/AGENTS.md` 的 Kerminal 管理片段写入配置边界、secret/log/cache/data 边界、MCP-first 运行时动作规则和 validator 状态。

本轮修改：

- `src-tauri/src/services/external_agent_workspace.rs`：新增 `dryRun`、`overwritePolicy`、文件 operation report、diff、backup path、validator status；Codex/Claude 只 patch Kerminal managed block/table；invalid `.mcp.json` 默认备份后修复，`preserveUserContent` 策略拒绝覆盖。
- `src-tauri/src/commands/external_agent_workspace.rs`：`dryRun=true` 只读取 MCP status，不启动 Streamable HTTP MCP Server；实际 launch 才启动 server。
- `src/lib/agentLauncherApi.ts`：同步 TS API 类型和 preview validator 状态。
- `src/features/settings/settings-tool-content/mcp-section.tsx`：在 `Kerminal MCP Server` 设置页外部 Agent 工作目录卡片显示 validator status/command。
- `src/features/settings/SettingsToolContent.mcp.test.tsx`、`SettingsToolContent.testHarness.tsx`、Agent Launcher 相邻测试：补 validator 和默认 endpoint 断言。
- `.updeng/docs/config/external-agent-workspace.md`：更新默认 MCP endpoint 为 `37657`，说明实际 endpoint 以运行态为准；validator 由 runtime status/AGENTS 写入，不再建议不存在的 `~/.kerminal/bin`。

验证：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --lib external_agent_workspace` 通过，11 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --test mcp_streamable_http_server` 通过，1 test。
- `npm run test:frontend -- src/features/settings/SettingsToolContent.mcp.test.tsx src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx` 通过，3 files / 15 tests。
- `npm run typecheck` 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- `npm run build` 通过；保留既有 Vite large chunk warning。
- `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --self-test` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --no-run -j 1` 通过，所有 Rust test targets 编译成功。
- `npm run dev -- --host 127.0.0.1 --port 5208 --strictPort` 启动成功并已停止；截图：
  - `.updeng/docs/verification/settings-mcp-validator-5208-chrome.png`
  - `.updeng/docs/verification/agent-launcher-5208-chrome.png`
- `npm run tauri:dev` 的 beforeDevCommand 仍因本机已有 `node.exe` PID `83728` 占用 `127.0.0.1:1425` 而无法直接启动；未杀用户进程。已确认 `http://127.0.0.1:1425/` 是 Vite 页面，并改用 `cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always --` 连接现有 devUrl，`target/debug/kerminal.exe` 启动并保持 15 秒无崩溃；Ctrl-C 停止时退出码为预期中断。

运行态 UI 证据：

- 设置页截图确认存在 `Kerminal MCP Server`、`外部 Agent 工作目录`、`validator`，不存在旧 `AI 与模型` / `MCP / Skills`。
- 右栏截图确认 Agent Launcher 初始态仍只有 Codex、Claude、`自定义` 三个入口。

收口：

- 文件优先存储主计划已 done；本计划与 ADR-0016 不再重复拆 schema 迁移切片。
- 旧内置 AI/provider/custom MCP/custom skills 主链路仍保持删除口径。
- 当前计划完成，移动到 `plan/done/`，同步 `INDEX.md`、`in-progress.md` 和 `coordination/lanes.json`。
