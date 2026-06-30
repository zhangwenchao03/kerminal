---
id: PLAN-20260622-180157-ai-agent-runtime-framework
status: done
created_at: 2026-06-22T18:01:57+08:00
started_at: 2026-06-22T18:22:00+08:00
completed_at: 2026-06-22T21:17:55+08:00
updated_at: 2026-06-22T21:17:55+08:00
owner: ai
---

# AI Agent Runtime 与成熟框架选型实施计划

## 目标

- 让 Kerminal AI 助手具备接近 Codex 的 ReAct agent 能力：理解目标、规划步骤、调用工具、读取 observation、不满足时继续换工具或补参数，直到完成、等待审批或明确阻塞。
- 解决当前“工具很多但不丝滑”的核心问题：模型拿不到真实工具结果继续推理、工具参数过于底层、审批后不能自动续跑、错误结果缺少恢复提示。
- 在不破坏现有 Rust/Tauri 安全边界的前提下，评估成熟 agent 框架，并确定可落地架构。

## 非目标

- 不允许 AI 绕过 Kerminal Tool Registry、风险策略、审批、审计、凭据服务和终端 target capability。
- 不在首轮把整个 AI 子系统迁移到 Python/Node sidecar。
- 不把生产主机、破坏性命令、文件删除、远程写操作改成默认自动执行。
- 不替换当前已接受的 [ADR-0003: AI Agent 框架采用 Rig 与 rmcp](../../decisions/ADR-0003-ai-agent-framework-rig-rmcp.md)；本计划是在其上补 agent run loop 和外部协议扩展。

## 当前问题诊断

当前实现的核心链路是：

```text
LLM tool call
  -> KerminalApprovalTool.prepare_with_ai_policy
  -> pending invocation
  -> 前端 confirm/auto-confirm
  -> audit record
  -> 结束
```

这不是完整 ReAct loop。关键缺口：

- `auto_approved` 只代表不需要人工确认，不代表工具已在同一个 agent turn 内执行完成。
- 工具真实执行结果只进入 audit，不会作为 structured observation 自动回灌给模型。
- `result_summary` 偏人读文本，缺少稳定机器字段，例如 `groupId`、`hostId`、`sessionId`、`transferId`。
- 很多工具只暴露底层 id：`groupId`、`hostId`、`sessionId`、container id、remote path；用户自然语言中的“bwy 分组”“当前主机”“这个 pane”需要额外 resolver。
- 缺少任务级 facade tool，例如 `remote_host.ensure`、`ssh.ensure_connected`、`sftp.plan_transfer`，导致模型要自己拼多个原子工具。
- 用户批准 pending 后，run 不会恢复执行下一步。
- 错误没有统一分类：缺参数、目标不存在、凭据缺失、权限不足、远程失败、可重试失败都只是字符串。

## 成熟框架调研

| 框架/协议 | 成熟能力 | 主要语言/形态 | 对 Kerminal 的价值 | 不直接采用为主 runtime 的原因 |
| --- | --- | --- | --- | --- |
| OpenAI Agents SDK | Agent、tools、handoffs、guardrails、state、approvals、tracing；官方建议在应用拥有 orchestration/tool execution/approvals/state 时使用 SDK | Python / TypeScript SDK | 模式最贴近当前诉求，可作为 ReAct loop、guardrail、trace/eval 的设计参考 | Kerminal 后端是 Rust/Tauri，当前已采用 Rig/rmcp；直接引入 TS/Python runtime 会增加 sidecar、安全和打包复杂度 |
| LangGraph | 状态图、memory、human-in-the-loop、streaming、可自定义 single/multi-agent/hierarchical flow | Python / JS | 非常适合抽象 `Plan -> Act -> Observe -> Decide` 状态机 | 作为外部 runtime 需要跨进程桥接 Kerminal privileged tools；首轮更适合借鉴状态图模型 |
| Microsoft Agent Framework | AutoGen + Semantic Kernel 后继，强调 session state、type safety、middleware、telemetry、graph workflow、long-running HITL | .NET / Python | 企业级 session、middleware、telemetry 参考价值高 | 引入 .NET/Python runtime 与当前 Rust 桌面栈不一致；仍需重做 Kerminal 审批/审计 adapter |
| AutoGen | 多 agent 对话和人机协同历史影响大 | Python | 多 agent 协作模式可参考 | 官方 GitHub 显示 AutoGen 已进入 maintenance mode，Microsoft 正迁移到 Agent Framework；不应新项目重押 |
| CrewAI | Crews/Flows、guardrails、callbacks、HITL、持久执行、恢复长任务 | Python | 适合业务自动化和多角色 agent 任务 | Kerminal 主要是本地/远程机器操作控制面，不是云端业务 automation；sidecar 成本偏高 |
| LlamaIndex Workflows/Agents | workflow events、HITL、structured generation、RAG/knowledge 强 | Python / TypeScript | 适合未来知识库、文档、运行手册 agent | 当前最痛的是工具 loop 和本地控制面，不是 RAG |
| Mastra | TypeScript agent/workflow/memory/tools/MCP/observability，agent 可内部迭代到 final answer 或 stop condition | TypeScript/Node | 如果未来前端/Node sidecar 承载 agent，很适合作为候选 | 当前 Kerminal privileged services 在 Rust；直接让 Node 持有工具执行会扩大信任边界 |
| ACP Agent Client Protocol | 标准化 client 与 coding agent 通信；支持 session、prompt、image/context、streaming、permission request、cancel/lifecycle | 协议，多语言库含 Rust/TS | 中长期最适合让 Kerminal 接入 Copilot CLI、Claude Code、Codex-like 外部 agent | ACP 面向 coding agent/client 协议，不替代 Kerminal 内置远程主机/SFTP/终端工具 runtime |

## 推荐决策

采用 **混合方案**：

1. **短期保留 Rig + rmcp + Kerminal Tool Registry。**
   - 这是当前 ADR-0003 已接受方向，和 Rust/Tauri 安全边界一致。
   - 不引入 Python/Node agent sidecar 作为本地机器操作的主控制面。

2. **新增 Kerminal 原生 Agent Run Runtime。**
   - 在 Rust 后端实现 `AiAgentRunService`，补齐 ReAct run loop、structured observation、approval pause/resume、run step trace。
   - 让 Rig 继续负责模型/provider/tool-call primitive；Kerminal 自己拥有 state、approval、tool execution、target resolver 和审计。

3. **借鉴 LangGraph/Microsoft Agent Framework 的状态机和 HITL 思路。**
   - 内部状态显式建模为 `plan -> act -> observe -> decide -> completed/waitingApproval/blocked`。
   - 每一步落 SQLite，可恢复、可取消、可审计。

4. **中长期预留 ACP adapter。**
   - Kerminal 作为 ACP client 接入外部 coding agent，例如 Copilot CLI ACP mode。
   - ACP agent 不直接拿 Kerminal privileged service；它仍通过 Kerminal permission/tool bridge 请求执行。

### 设计修订：极简 Harness Agent 优先

用户补充参考 [shareAI-lab/learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) 后，本计划实现口径收窄：

- 不把 Kerminal 内置助手做成多智能体系统，也不优先引入 LangGraph/CrewAI/AutoGen 这类外部编排框架。
- 主体采用极简 harness loop：`model response -> detect tool_use -> executeIfAllowed -> append ToolObservation -> next model call`。
- 模型负责判断“要不要继续、调哪个工具、什么时候最终回复”；Kerminal harness 只负责工具定义、权限、执行、observation、审批暂停/恢复、错误恢复和上限。
- `AiAgentRunService` 只记录 run/step/observation 和 lifecycle，不把业务决策写成复杂流程图。
- 多 agent、ACP、团队协作只作为长期扩展，不进入首轮 runtime。

极简循环伪代码：

```text
messages = [user goal + context]
for turn in 1..max_turns:
  response = model(messages, tools)
  append assistant response
  if no tool_use:
    return final response

  observations = []
  for tool_use in response.tool_uses:
    obs = executeIfAllowed(tool_use)
    observations.push(obs)
    if obs.status == needsApproval:
      persist run as waitingApproval
      return waiting approval
    if obs.status == blocked:
      return blocked with reason

  append observations as tool_result/user message

return blocked: max turns reached
```

这和 `learn-claude-code` 的结论一致：agent harness 的核心是循环，权限、错误恢复、上下文、任务系统都只是叠加在循环上的保护机制。

## 目标架构

```text
React AI Panel
  -> ai_agent_run_start / ai_agent_run_resume / ai_agent_run_cancel
  -> AiAgentRunService
      -> Context Gateway / Target Resolver
      -> Rig model call
      -> ToolExecutionFacade
          -> Tool Registry policy
          -> executeIfAllowed for read/auto tools
          -> prepare pending for approval tools
          -> ToolObservation
      -> run step trace + SQLite state
      -> final answer / waiting approval / blocked
```

### 新增核心模型

```rust
AiAgentRun {
  run_id,
  conversation_id,
  user_message_id,
  status,
  goal,
  target_ref_json,
  iteration,
  max_iterations,
  max_tool_calls,
  created_at,
  updated_at,
}

AiAgentRunStep {
  step_id,
  run_id,
  kind, // plan | model | toolCall | observation | approval | final | error
  status,
  tool_id,
  input_json,
  observation_json,
  summary,
  created_at,
}

ToolObservation {
  status, // succeeded | failed | needsApproval | blocked
  summary,
  data,
  entities,
  recoverable,
  error_kind,
  next_hints,
}
```

### 策略边界

- Read / Auto 工具：可在 run loop 内立即执行并回灌 observation。
- Remote / Write 工具：按现有 AI security policy 判断；relaxed 时可自动执行，默认仍 pending。
- Destructive / production / credential / external publish：必须 HITL。
- 用户批准一个 pending 后，run 可以继续执行低风险后续步骤；如果下一步仍是高风险，再次暂停。

## 工具体验改造矩阵

| 能力域 | 当前不丝滑点 | 计划新增 facade/resolver | 验收例子 |
| --- | --- | --- | --- |
| Remote Host | 要 `groupId`、创建/查找/刷新分散 | `remote_host.ensure`、`remote_host.resolve_group`、`remote_host.resolve_host` | “把 172.16.40.104 加到 bwy 分组”能自动查/建分组并只在写入前确认 |
| SSH | `ssh.connect/command` 要 `hostId` | `ssh.ensure_connected`、`ssh.resolve_target` | “连接刚才创建的主机”能自动拿 hostId 并打开终端 |
| Terminal | `terminal.write` 要 sessionId | `terminal.resolve_current`、run target binding | “在当前终端执行 ls”能定位当前 pane，写入前按风险确认 |
| SFTP | 路径、冲突、跨主机传输太原子 | `sftp.plan_transfer`、`sftp.preview_then_act` | “把当前目录日志下载到本机桌面”能先解析路径和冲突策略 |
| Container | container id/name 解析弱 | `container.resolve`、`container.ensure_files` | “打开 redis 容器文件”能先 list 容器再定位目标 |
| Diagnostics | server info/runtime health/ssh command 分散 | `diagnostics.investigate_target` | “看看这台机器为什么慢”能自动收集只读诊断 |
| Settings/Provider | provider 配置问题只报错 | `ai_provider.preflight` | “为什么视觉模型不能看图”能给出缺 key/模型不支持/图片不可读 |

## 实施切片

### TASK-001: ToolObservation 契约

- 状态：已完成首个后端切片。
- 修改 `ToolExecutionResult`，新增 `structured_result` / `error_kind` / `recoverable` / `next_hints`。
- 先覆盖 `remote_host.group_list/tree/create`、`terminal.list`、`ssh.connect`、`sftp.list`。
- 验证：
  - Rust 单测断言 observation 包含稳定 ids。
  - 旧 `result_summary` 仍保留，兼容 audit UI。

### TASK-002: executeIfAllowed

- 状态：已完成首个后端切片。
- 在 `AiToolInvocationService` 增加受策略控制的直接执行入口。
- read/auto 工具可直接执行并返回 observation。
- high-risk 工具仍只创建 pending。
- 验证：
  - auto 工具真实执行后返回 observation，而不是只返回 `auto_approved`。
  - destructive 工具仍 pending。

### TASK-003: AiAgentRunService Tracer Bullet

- 状态：已完成 run/step 状态模型、in-memory service、可注入 harness loop、start/get/cancel Tauri command API、Rig-backed 真实 LLM 决策解析和 OpenAI live harness smoke。
- 新增 run loop，最多 5 轮、最多 5 次工具调用。
- 首版只支持 text prompt + read/auto tools + pending pause。
- 验收：
  - “列出远程主机分组并告诉我 bwy 的 id”能自动调用 `remote_host.group_list` 并回答。
  - 不需要用户复制工具返回。

### TASK-004: remote_host.ensure

- 状态：已完成最小 facade；新增 `remote_host.ensure` 工具，支持 `groupName` 解析/自动建组、按同组 `host/port/username` 或名称复用已有主机，必要时创建主机，并在 observation 中稳定返回 `hostId/groupId/created/host`。同时增强 `remote_host.create` 的 structured observation，避免模型创建后拿不到 host id。
- 封装 groupName -> groupId、host 查重、创建 host、结果回传。
- 写操作仍按 Remote 风险策略确认。
- 验收：
  - “把 172.16.40.104 / root 加到 bwy 分组”不再要求用户填 groupId。
  - 如果 bwy 不存在，工具自动创建分组或在审批摘要里说明会创建。

### TASK-005: Approval Resume

- 状态：已完成最小闭环；批准/拒绝 run-bound pending 后，后端会把 audit observation 写回同一个 run，继续调用真实 `RigHarnessModel` 驱动后续 harness loop；前端确认 run-bound pending 后会自动调用 `resumeAiAgentRun`，若续跑产生新的 pending invocation，会重新进入当前会话/slot 的 pending 队列。
- pending invocation 关联 `runId/stepId`。
- 用户批准后，audit observation 写回 run，run 继续下一步。
- 验收：
  - 用户要求“添加主机并打开终端”，批准创建主机后自动继续 `ssh.ensure_connected`。

### TASK-006: TargetResolver

- 状态：已完成首个 SSH facade、run 内 last remote host resolver、外部可见 `remote_host.last_used` resolver、`terminal.resolve_current` resolver 和 `ssh.command_on_resolved_host` facade；新增 `ssh.ensure_connected`，可用 `hostId` 直连，也可用 `groupName/groupId/name/host/username/port` 组合解析已保存主机，唯一命中后返回 `sshConnect` client action 所需的 `hostId/cols/rows`，歧义或未命中时返回结构化 candidates 和可恢复错误。`AiAgentHarnessModelInput.resolvedTargets.lastRemoteHost` 现在会从最近成功的 remoteHost observation/audit observation 中提取 typed `hostId/groupId/host/username/sourceToolId/sourceStepId`，下一轮模型可直接用它填 `ssh.ensure_connected.hostId`。新增 `remote_host.last_used` 作为 Read/Auto resolver，从 SSH 命令历史中查找最近仍存在的远程主机，返回 `hostId/groupId/host` 和 `remoteHost` entity，供模型在不知道 `groupId/hostId` 时先自动补齐目标。新增 `terminal.resolve_current` 作为 Read/Auto resolver，要求调用方传入当前 focused `paneId`，后端用 `TerminalSessionBindingService` 解析 active binding，再用 `TerminalManager::session_summary` 复验真实 session，返回 `sessionId/paneId/tabId/target metadata` 给 `terminal.write/resize/log` 继续使用；缺 `paneId`、pane/session 不匹配、binding stale 都返回 recoverable observation，不猜当前终端。新增 `ssh.command_on_resolved_host` 可按 `hostId` 或 `groupName/groupId/name/host/username/port` 解析已保存主机后执行非交互 SSH 命令，普通远程命令仍按 Remote/Always 审批，危险命令沿用 `ssh.command` 的 Destructive/Full audit 升级。
- 统一 current pane/current host/groupName/hostName/containerName/path resolver。
- resolver 均是 read/auto 工具。
- 验收：
  - “当前主机”“刚才创建的主机”“bwy 分组”“redis 容器”都有稳定解析或明确 not found。

### TASK-007: Run UI

- 状态：已完成前端最小闭环；新增 `AiRunTimeline`，能显示真实 run snapshot 的模型判断、工具调用、工具结果、final/error 等 timeline，以及 run 状态、final message、cancel 和 retry 入口。
- 前端在 run-bound pending 出现时会用 `getAiAgentRun` 补当前 run snapshot；批准/拒绝后复用 `resumeAiAgentRun` 返回的 `AiAgentHarnessRunResult` 更新 timeline/final，并把新的 pending invocation 继续放回当前 conversation/slot 队列。
- `cancel` 会调用 `cancelAiAgentRun({ runId })`，更新 cancelled snapshot，并移除该 run 的 pending invocation，避免取消后仍能批准旧工具调用。
- `retry` 已升级为真正的 last-step retry：前端调用 `retryAiAgentRunLastStep({ runId })`，后端在同一个 run 内回滚最后一个失败/阻塞/取消/等待审批 step；失败 observation 会连同匹配的 tool call 一起回滚，再复用 `continue_harness` 继续同一个 run。
- 面板展示 step timeline：Plan、Tool、Observation、Waiting approval、Done。
- 审批卡显示 run、目标、工具、风险、批准后是否继续自动执行。
- 支持 cancel 和 last-step retry；cancel 会移除旧 pending，retry 会保留 run id 并从回滚点继续执行。
- 验证：
  - 前端三主题可读，并有真实 Chrome 截图验证。
  - pending 不再跨会话/跨 pane 漂移。

### TASK-008: ACP Adapter Spike

- 状态：降级为长期候选；首轮不做。
- 只做只读 spike，不接 privileged tools。
- 评估 Rust ACP library、Copilot CLI `--acp`、session lifecycle、permission request 映射。
- 输出是否新增 ADR-0015。
- 验收：
  - 能启动一个外部 ACP session 或明确记录阻塞。
  - 不影响内置 agent runtime。

## 验证门禁

- Rust：
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_service`
  - 新增 `ai_agent_run_service` integration tests。
- Frontend：
  - `npm run test:frontend -- src/features/tool-panel/AiToolContent.test.tsx`
  - 新增 run timeline、approval resume、pending queue tests。
- 构建与启动：
  - `npm run build`
  - Vite dev server smoke。
  - 涉及 Tauri command/Rust service 时跑 `npm run tauri:dev` 或记录无法运行原因。
- 安全：
  - destructive/production/credential 工具必须有 regression tests，证明不会被 run loop 自动绕过。
  - 所有 run step 不记录明文密码、API key、私钥、完整敏感环境变量。

## 风险与回滚

- 风险：run loop 可能让 AI 看起来“更自动”，但也可能放大错误工具调用。
  - 缓解：默认 iteration/tool call 上限、风险策略前置、HITL、审计、cancel。
- 风险：引入外部框架 sidecar 会扩大打包和安全面。
  - 缓解：首轮不引入 sidecar；只实现 Rust 原生 runtime；ACP 作为隔离 spike。
- 风险：工具 observation 结构化改造影响既有 audit。
  - 缓解：保留 `result_summary`，新增字段向后兼容。
- 回滚：
  - run loop 通过 feature flag 或设置项关闭，回到当前单次 tool suggestion/pending 模式。
  - facade tools 可逐个禁用，不影响原子工具。

## 资料来源

- OpenAI Agents SDK：<https://developers.openai.com/api/docs/guides/agents>
- LangGraph：<https://www.langchain.com/langgraph>
- Microsoft Agent Framework：<https://learn.microsoft.com/en-us/agent-framework/overview/>
- Mastra Agents：<https://mastra.ai/docs/agents/overview>
- CrewAI Docs：<https://docs.crewai.com/>
- Agent Client Protocol：<https://agentclientprotocol.com/get-started/introduction>
- GitHub Copilot CLI ACP public preview：<https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/>
- shareAI-lab learn-claude-code：<https://github.com/shareAI-lab/learn-claude-code>
- learn-claude-code s01 Agent Loop：<https://github.com/shareAI-lab/learn-claude-code/tree/main/s01_agent_loop>
- learn-claude-code s03 Permission：<https://github.com/shareAI-lab/learn-claude-code/tree/main/s03_permission>
- learn-claude-code s11 Error Recovery：<https://github.com/shareAI-lab/learn-claude-code/tree/main/s11_error_recovery>
- Kerminal 既有决策：[ADR-0003: AI Agent 框架采用 Rig 与 rmcp](../../decisions/ADR-0003-ai-agent-framework-rig-rmcp.md)

## Round Log

### 2026-06-22T18:34:00+08:00

- 按用户反馈把实现口径从“成熟 agent 框架/多 agent 借鉴”收敛为“极简 harness agent loop”。
- 已落地 TASK-001/TASK-002：
  - 新增 `AiToolObservation`、`AiToolExecuteIfAllowedRequest`、`AiToolExecuteIfAllowedResponse`。
  - `AiToolInvocationService::execute_if_allowed` 复用 `prepare_with_settings` 和现有风险策略；auto/read 工具真实执行并写 audit，高风险工具只返回 `needsApproval` pending observation。
  - 结构化 observation 首批覆盖 `terminal.list`、`remote_host.group_list/tree/group_create`、`ssh.connect`、`sftp.list`，其他工具保留兼容摘要。
- 已落地 TASK-003 tracer bullet：
  - 新增 `AiAgentRunService` in-memory run/step 状态骨架。
  - 支持 start、append step、waiting approval、completed、blocked、cancel。
- 已完成 TASK-007 前端接入调研：
  - 最小接线点是 `AiToolContent.tsx` 的 `resolvePendingInvocation`；批准成功后可按 `runId/stepId` 调 `resumeRun`。
  - run timeline 推荐新增到 `src/features/tool-panel/ai-tool-content/AiRunTimeline.tsx`，审批准入仍复用 `PendingInvocationPanel`。
- 验证：
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service execute_if_allowed -- --nocapture` 通过，4 passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service` 通过，119 passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_run_service` 通过，4 passed。
  - `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
  - `npm run build` 通过，保留既有 Vite large chunk warning。
  - `npm run tauri:dev` 因固定 dev port `1425` 被现有进程 `72728` 占用未走通；改用 `cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always --` 复用现有 dev server，应用编译并启动到运行态，随后定向停止本轮拉起的 `kerminal.exe` 进程 `84800`。

### 2026-06-22T19:05:00+08:00

- 补齐审批恢复所需的 agent run 契约：
  - `AiToolPrepareRequest`、`AiToolExecuteIfAllowedRequest`、`AiToolPendingInvocation`、`AiToolAuditContext` 增加 `runId/stepId` 对应字段。
  - `ai_tool_pending` SQLite 持久化、恢复读取和 v27 migration 增加 `run_id/step_id`。
  - 前端 `aiToolInvocationApi` 和 browser preview pending 同步透传 `runId/stepId`。
- pending 恢复测试已断言 `run_id/step_id` 在 `list_pending` 和 `ai_tool_pending_state` 中不丢失。
- 工具调用链调研结论：
  - 直接给 Rig `Tool` wrapper 传 borrowed `AiToolExecutionContext<'_>` 会被 `.tools(...)` 的 `'static` 要求挡住，不适合作为生产方案。
  - 后续真实 loop 应采用 owned runtime handle 或外层 Rust harness 驱动 `model -> tool_use -> execute_if_allowed -> observation -> model`，不要把整个 `AiChatExecutionRequest` lifetime 化。
- 验证：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service pending_recovery` 通过，1 passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service execute_if_allowed` 通过，4 passed。
  - `npm run build` 通过，保留既有 Vite large chunk warning。

### 2026-06-22T19:32:00+08:00

- 已落地 TASK-003 的真实 harness loop tracer bullet：
  - 新增 `AiAgentHarnessRunRequest`、`AiAgentHarnessModelInput`、`AiAgentHarnessDecision`、`AiAgentHarnessRunResult` 等可序列化模型。
  - `AiAgentRunService::run_harness` 按极简 ReAct 流程驱动：`model -> toolCall -> executeTool -> observation -> model`。
  - 每轮写入 `Model`、`ToolCall`、`Observation`、`Final/Error` step；遇到 `NeedsApproval` 标记 `WaitingApproval` 并返回 pending invocation；达到 `maxToolCalls` 或不可恢复失败时标记 `Blocked`。
  - loop 通过 `AiAgentHarnessModel` 和 `AiAgentHarnessToolExecutor` 两个窄 trait 注入模型与工具执行边界，生产后续可接真实 LLM，测试使用脚本化 fake。
- 只读 subagent 复核结论：
  - 下一切片应继续保留在 `ai_agent_run_service` 和 `ai_agent_run` 模型内，不把 loop 混入普通 `AiAgentService`。
  - `AiAgentService` 现有 Rig wrapper 只创建 pending，不适合作为真实执行 loop 的主路径。
- 验证：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_run_service` 通过，7 passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service execute_if_allowed` 通过，4 passed。

### 2026-06-22T19:58:00+08:00

- 已接出 Agent Run command/API 最小闭环：
  - `AppState` 新增 `AiAgentRunService` 运行态和 `ai_agent_runs()` 访问器。
  - 新增并注册 `ai_agent_run_start`、`ai_agent_run_get`、`ai_agent_run_cancel`、`ai_agent_run_resume` Tauri commands。
  - 新增前端 `src/lib/aiAgentRunApi.ts`，提供 `startAiAgentRun`、`getAiAgentRun`、`cancelAiAgentRun`、`resumeAiAgentRun` typed invoke wrapper。
- 已补 TASK-005 后端最小 resume 语义：
  - `AiAgentRunService::resume_after_approval` 会把确认后的 `AiToolAuditRecord` 转成 observation step 写回 run。
  - audit 成功时 run 从 `WaitingApproval` 回到 `Running`；audit 拒绝或失败时 run 进入 `Blocked`。
  - 当前 resume 只完成状态与 observation 写回；批准后继续调用真实模型待真实 LLM 输出解析切片接入。
- 用户确认当前配置的 OpenAI provider 可用于后续真实测试；下一切片接真实 LLM 决策解析后，优先跑受控 live smoke。
- 验证：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_run_service` 通过，9 passed。
  - `npm run test:frontend -- src/lib/aiAgentRunApi.test.ts` 通过，4 passed。
  - `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service execute_if_allowed` 通过，4 passed。
  - `npm run build` 通过，保留既有 Vite large chunk warning。
  - `npm run tauri:dev` 未直接运行，因为固定 dev server 端口 `1425` 已由进程 `72728` 占用；改用 `cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always --` 复用现有 dev server，Tauri 壳编译并启动到运行态，随后定向停止本轮新增 `kerminal.exe` 进程 `73464`。

### 2026-06-22T19:18:41+08:00

- 已接入 TASK-003 真实 LLM 决策解析：
  - 新增 `RigHarnessModel`，复用现有 Rig OpenAI Responses/OpenAI Chat/Anthropic provider client，按文本 JSON 协议驱动 `AiAgentHarnessModel`。
  - harness prompt 明确要求模型在 `toolCall/final/blocked` 三种 decision 中选择；工具执行仍由 Kerminal `execute_if_allowed` 控制，不把 privileged tools 交给 provider SDK 内部执行。
  - 新增 parser 支持标准 `decision` JSON、顶层 `kind` 兼容格式和 fenced JSON；非法 JSON、未知 kind 均返回明确 `AiAgent` 错误。
  - `ai_agent_run_start` 从“只创建 run”升级为“选择默认 provider -> 运行 bounded harness loop -> 返回 `AiAgentHarnessRunResult`”，前端 `startAiAgentRun` wrapper 同步返回 run result。
  - 增加默认跳过的 live harness smoke：`KERMINAL_LIVE_LLM_HARNESS_SMOKE=1` 时使用当前配置 provider，只让真实模型决策，工具执行使用安全 fake `terminal.list` observation。
- 保持后续边界：
  - 现有 `ai_chat` 主流程没有接入 run loop，避免影响成熟聊天路径。
  - 审批 `resume_after_approval` 当前仍只把 audit 写回 observation 并恢复 Running；批准后自动继续下一轮真实模型调用留给 TASK-005 后续切片。
- 验证：
  - `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_run_service` 通过，9 passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml ai_agent_harness_rig_model` 通过，5 passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service execute_if_allowed` 通过，4 passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_live_provider_smoke live_provider_preflight_reports_configuration_without_external_call` 通过，1 passed。
  - `$env:KERMINAL_LIVE_LLM_HARNESS_SMOKE='1'; cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_live_provider_smoke live_configured_provider_drives_minimal_harness_loop_when_enabled -- --nocapture` 通过，1 passed，真实调用当前配置 OpenAI provider。
  - `npm run test:frontend -- src/lib/aiAgentRunApi.test.ts` 通过，4 passed。
  - `npm run build` 通过，保留既有 Vite large chunk warning。
  - `npm run tauri:dev` 未直接运行，因为固定 dev server 端口 `1425` 仍由进程 `72728` 占用；改用 `cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always --` 复用现有 dev server，Tauri 壳编译并启动到运行态，随后只停止本轮新增 `kerminal.exe` 进程 `89256`，保留先前已存在进程 `66944`。

### 2026-06-22T19:27:19+08:00

- 已补齐 TASK-005 的后端/API 审批续跑闭环：
  - `AiAgentRun` 增加 `conversationId/conversationSlotJson`，run 创建时保存会话归属，resume 后后续工具调用继续带原会话上下文。
  - `AiAgentRunService::run_harness` 仍只负责创建新 run；新增 `continue_harness(run_id, model, tools)` 从已有 run 继续同一个极简 loop。
  - `resume_after_approval` 保持纯状态写回：成功 audit 写成 observation 并恢复 Running，拒绝/失败进入 Blocked，不直接持有 model/tool executor。
  - `ai_agent_run_resume` 改为 async，返回 `AiAgentHarnessRunResult`；audit 成功后 command 层构造当前默认 provider 的 `RigHarnessModel` 和 `StateToolExecutor`，继续真实 harness loop。
  - resume 后工具调用次数从已有 `ToolCall` steps 计数，不会重置绕过 `maxToolCalls`。
  - 默认 `maxIterations` 从 5 调整为 20，避免 step-based iteration 在常规“model -> tool -> approval -> audit observation -> final”路径中提前卡死；`maxToolCalls` 仍保持 5。
  - 前端 `resumeAiAgentRun` wrapper 同步返回 `AiAgentHarnessRunResult`。
- subagent 复核：
  - 只读 explorer 确认正确边界是保留 `run_harness` start 语义、新增 continue/drive loop、command 层组合 resume +真实模型，不把 model/tool executor 塞进 `resume_after_approval`。
  - explorer 同时确认 UI 层 `AiToolContent` 审批后自动调用 `resumeAiAgentRun` 仍未接入，应归入 TASK-007/run UI 后续切片。
- 验证：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_run_service` 通过，12 passed。
  - `npm run test:frontend -- src/lib/aiAgentRunApi.test.ts` 通过，4 passed。
  - `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service execute_if_allowed` 通过，4 passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_live_provider_smoke live_provider_preflight_reports_configuration_without_external_call` 通过，1 passed。
  - `$env:KERMINAL_LIVE_LLM_HARNESS_SMOKE='1'; cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_live_provider_smoke live_configured_provider_drives_minimal_harness_loop_when_enabled -- --nocapture` 通过，1 passed，真实调用当前配置 OpenAI provider。
  - `npm run build` 通过，保留既有 Vite large chunk warning。
  - `npm run tauri:dev` 未直接运行，因为固定 dev server 端口 `1425` 仍由进程 `72728` 占用；改用 `cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always --` 复用现有 dev server，Tauri 壳编译并启动到运行态，随后只停止本轮新增 `kerminal.exe` 进程 `83364`，保留先前已存在进程 `41632`。

### 2026-06-22T19:32:14+08:00

- 已补齐 TASK-005 的前端自动 resume 最小闭环：
  - `AiToolContent` 在确认 run-bound pending invocation 后调用 `resumeAiAgentRun({ runId, audit })`。
  - 普通非 run pending 仍保持原有确认路径，不触发 agent run 续跑。
  - 若 resume 结果返回新的 pending invocation，会按原 conversation/slot 重新加入 pending 队列，继续复用现有审批卡。
  - 新增前端回归覆盖：批准 run-bound `remote_host.create` 后调用 resume，续跑返回 `ssh.connect` pending 并显示在当前会话。
- 后续边界：
  - TASK-007 仍需补完整 run timeline、最终结果展示、cancel/retry 和三主题视觉验证。
  - TASK-004/TASK-006 仍需补 `remote_host.ensure`、TargetResolver 与 facade tools，彻底消除用户手填 `groupId/hostId/sessionId`。
- 验证：
  - `npm run test:frontend -- src/features/tool-panel/AiToolContent.test.tsx` 通过，16 passed。
  - `npm run test:frontend -- src/lib/aiAgentRunApi.test.ts` 通过，4 passed。
  - `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_agent_run_service` 通过，12 passed。
  - `npm run build` 通过，保留既有 Vite large chunk warning。
  - `npm run tauri:dev` 未直接运行，因为固定 dev server 端口 `1425` 仍由进程 `72728` 占用；改用 `cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always --` 复用现有 dev server，Tauri 壳编译并启动到运行态，随后只停止本轮新增 `kerminal.exe` 进程 `84500`，保留先前已存在进程 `41632`。

### 2026-06-22T19:50:29+08:00

- 已补齐 TASK-004 的 `remote_host.ensure` 最小 facade：
  - 新增 registry 工具 `remote_host.ensure`，风险仍为 `Remote`，默认继续走现有审批策略。
  - 工具参数支持 `groupName`，执行时会匹配已有分组，不存在时创建分组。
  - 同一分组内若已有同 `host/port/username` 或同名主机，直接复用并返回 `created=false`；否则创建主机并返回 `created=true`。
  - observation 稳定返回 `hostId`、`groupId`、`host` 和 `created`，并写入 `remoteHost` entity，供后续 `ssh.connect` 等工具直接使用。
  - 兼容增强 `remote_host.create`：创建成功后也返回 structured `hostId/groupId/host` 和 entity，降低模型漏选 facade 时的卡顿。
- 后续边界：
  - `ssh.ensure_connected`、current/last target resolver、`terminal.resolve_current` 仍待 TASK-006/TASK-007 后续切片。
  - 真实用户口令仍不写入工具参数或文档；后续凭据输入应继续走受控凭据/审批链路。
- 验证：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service remote_host_ensure -- --nocapture` 通过，2 passed；因共享 target 被并行 lane 占锁，本轮改用临时 `CARGO_TARGET_DIR=target-agent-runtime-check` 执行，完成后已删除该目录。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test tool_registry_service registry_covers_user_visible_kerminal_capability_domains` 通过，1 passed，同上使用临时 target。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service registry_contract` 通过，1 passed，同上使用临时 target。
  - `cargo check --manifest-path src-tauri/Cargo.toml` 通过，同上使用临时 target。

### 2026-06-22T20:04:54+08:00

- 已补齐 TASK-006 的首个 SSH facade：
  - 新增 registry 工具 `ssh.ensure_connected`，风险仍为 `Remote`，默认继续走现有审批策略。
  - 工具支持 `hostId` 精确定位，也支持 `groupId/groupName/name/host/username/port` 组合解析已保存主机。
  - 唯一命中时返回结构化 `hostId`、`host`、`clientAction=sshConnect`、`cols/rows` 和 `remoteHost` entity；前端确认后使用既有 `sshConnect` client action 打开终端。
  - 未传目标、未命中或多命中时返回 `missingTarget/targetNotFound/ambiguousTarget`，带 `recoverable=true`、候选主机和下一步提示，agent 可继续调用 `remote_host.tree`、`remote_host.ensure` 或补 `hostId`。
- 同步修复审批恢复的结构化 observation 缺口：
  - `AiToolAuditRecord` 新增 `observationJson`，SQLite `ai_tool_audits` 增加 v28 `observation_json` 字段。
  - `confirm_async` 和 `execute_if_allowed` 会把完整 `AiToolObservation` 写入 audit，审批 resume 优先使用该结构化 observation，而不是从 `result_summary` 重新猜。
  - 新增回归证明 `resume_after_approval` 能保留 `hostId` entity，并把 stale `auditId` 纠正为持久化 audit id。
- 前端最小兼容：
  - `AiToolAuditRecord` 类型增加 `observationJson`。
  - run-bound `remote_host.ensure`/`remote_host.create` 确认成功后会刷新远程主机树，保证后续 UI 和 agent 看到新主机。
- 后续边界：
  - “刚才创建的主机”这类跨 step last-entity resolver 仍需继续完善；当前可通过 `remote_host.ensure` 返回的 structured `hostId` 直接驱动下一步。
  - TASK-007 仍需补完整 run timeline、final display、cancel/retry 和真实界面三主题截图验证。
- 验证：
  - `cargo fmt --manifest-path src-tauri\Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_agent_run_service resume_after_approval -- --nocapture` 通过，2 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_tool_invocation_service ssh_ensure_connected -- --nocapture` 通过，2 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test storage_foundation` 通过，20 passed。
  - `cargo check --manifest-path src-tauri\Cargo.toml` 通过。
  - `npm run build` 通过，保留既有 Vite large chunk warning。
  - `Invoke-WebRequest http://127.0.0.1:1425/` 通过，现有 dev server 返回 200。

### 2026-06-22T20:16:52+08:00

- 已补齐 TASK-006 的 run 内 last remote host resolver：
  - `AiAgentHarnessModelInput` 新增强类型 `resolvedTargets`。
  - 新增 `AiAgentResolvedTargets` / `AiAgentRemoteHostTarget`，稳定承载最近成功 remote host 的 `hostId/groupId/name/host/port/username/production/sourceToolId/sourceStepId`。
  - `AiAgentRunService::continue_harness` 每次调用模型前从已有 Observation steps 反向扫描最近成功 `remoteHost` entity 或 `data.hostId`，写入 `resolvedTargets.lastRemoteHost`。
  - `RigHarnessModel` prompt 输出 `resolvedTargets`，提示模型在“刚才创建的主机/last remote host”场景直接使用 `resolvedTargets.lastRemoteHost.hostId` 调 SSH、SFTP、server info、diagnostics 等工具。
  - extractor 默认忽略 failed/blocked/needsApproval observation，避免把 `ssh.ensure_connected` 歧义候选误当成可执行目标。
- subagent 并行复核结论：
  - Boyle 确认最佳实现点是 `ai_agent_run_service.rs` 的 run step helper；建议强类型 `AiAgentRemoteHostTarget` 并过滤非 succeeded observation，本轮已采纳。
  - Avicenna 建议后续外部可见 resolver/facade 顺序为 `terminal.resolve_current`、`remote_host.last_used`、`ssh.command_on_resolved_host`；这些进入下一切片，不混入本轮。
- 验证：
  - `cargo fmt --manifest-path src-tauri\Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_agent_run_service harness_ -- --nocapture` 通过，7 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml ai_agent_harness_rig_model::tests::prompt_includes_observations_and_tools -- --nocapture` 通过，1 passed。
  - `cargo check --manifest-path src-tauri\Cargo.toml` 通过。

### 2026-06-22T20:23:24+08:00

- 已补齐 TASK-006 的外部可见 `remote_host.last_used` resolver：
  - 新增 registry 工具 `remote_host.last_used`，分类 `RemoteHost`、风险 `Read`，当前支持 `target=ssh`。
  - 执行层从 `CommandHistoryService` 读取最近 SSH 历史，再到 `RemoteHostService` 主机树中验证 host 仍存在；成功后返回稳定 `hostId/groupId/host` 和 `remoteHost` entity。
  - 没有历史或历史 host 已删除时返回 `targetNotFound`、`recoverable=true` 和下一步提示，不把失效 target 交给后续 SSH/SFTP 工具。
  - MCP agent catalog 已把 `remote_host.last_used` 暴露到 remote ops/remote access 能力中，避免 registry 有工具但 agent skill 看不到。
- 与 run 内 resolver 的关系：
  - `resolvedTargets.lastRemoteHost` 解决“同一个 run 刚刚创建/解析过的主机”。
  - `remote_host.last_used` 解决“跨 run 或上下文缺 hostId/groupId 时，从最近 SSH 操作历史恢复目标”。
- 验证：
  - `cargo fmt --manifest-path src-tauri\Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_tool_invocation_service remote_host_last_used -- --nocapture` 通过，3 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_tool_invocation_service registry_contract -- --nocapture` 通过，1 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test tool_registry_service registry_covers_user_visible_kerminal_capability_domains -- --nocapture` 通过，1 passed。
  - `cargo check --manifest-path src-tauri\Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_agent_run_service harness_ -- --nocapture` 通过，7 passed。
  - `Invoke-WebRequest http://127.0.0.1:1425/` 通过，现有 dev server 返回 200。

### 2026-06-22T20:33:37+08:00

- 已补齐 TASK-006 的 `terminal.resolve_current` resolver：
  - 新增 registry 工具 `terminal.resolve_current`，分类 `Terminal`、风险 `Read`。
  - 工具要求传入当前 focused `paneId`；`sessionId/tabId/targetRef/targetKind/remoteHostId` 仅用于交叉校验，不作为“当前终端”的唯一真相。
  - 执行层通过 `TerminalSessionBindingService::active_binding_for_pane` 解析 active pane/session binding，并用 `TerminalManager::session_summary` 复验真实 session 仍存在且 running。
  - 成功 observation 返回 `source=terminalSessionBinding`、`paneId/sessionId/tabId/generation/bindingStatus/session/binding`，并输出 `terminalPane`、`terminalSession`、可选 `remoteHost` entities，后续模型可直接把 `sessionId` 用于 `terminal.write`、`terminal.resize`、`terminal.log.*`。
  - 缺 `paneId`、pane/session mismatch、metadata mismatch、stale session 和 exited session 都返回 `recoverable=true` 的结构化失败，避免多 pane/多 tab 场景误写终端。
  - MCP agent catalog 和 browser preview tool registry/skills 已同步；前端 `toolRegistryContract.fixture.json` 由 Rust registry example 重新生成。
- subagent 并行复核结论：
  - Mendel 确认后端没有全局 active pane，必须由前端传 focused paneId，后端以 binding snapshot + session_summary 双校验为准；不应从 `terminal.list` 单 session 猜当前。
  - Wegener 确认需同步 registry、execution、terminal_tools、agent_catalog、browser preview、fixture、tool registry contract 和 sample arguments，本轮已按最小追加完成。
- 验证：
  - `cargo fmt --manifest-path src-tauri\Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_tool_invocation_service terminal_resolve_current -- --nocapture` 通过，4 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_tool_invocation_service registry_contract -- --nocapture` 通过，1 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test tool_registry_service registry_covers_user_visible_kerminal_capability_domains -- --nocapture` 通过，1 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test tool_registry_contract_fixture -- --nocapture` 通过，1 passed。
  - `npm test -- src/lib/toolRegistryApi.test.ts` 通过，8 passed。
  - `cargo check --manifest-path src-tauri\Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test mcp_tool_gateway -- --nocapture` 通过，2 passed；曾误跑不存在的 `mcp_streamable_http_server` test target，已改跑正确目标。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test tool_registry_service -- --nocapture` 通过，19 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_agent_run_service harness_ -- --nocapture` 通过，7 passed。
  - `npm run build` 通过，保留既有 Vite large chunk warning。
  - `Invoke-WebRequest http://127.0.0.1:1425/` 通过，现有 dev server 返回 200。

### 2026-06-22T20:47:12+08:00

- 已补齐 TASK-006 的 `ssh.command_on_resolved_host` facade：
  - 新增 registry 工具 `ssh.command_on_resolved_host`，分类 `Ssh`、风险 `Remote`、确认 `Always`；schema 只要求 `command`，目标选择继续由运行时 resolver 校验。
  - 执行层复用 `resolve_ssh_target_host`，支持 `hostId` 或 `groupName/groupId/name/host/username/port` 组合解析；缺目标返回 `missingTarget`，多命中返回 `ambiguousTarget` 和 candidates，不按第一个结果猜测执行。
  - SSH 命令执行抽出共用 helper，`ssh.command` 和新 facade 共用 command/proxy/timeout/maxOutputBytes 解析、命令历史记录和 structured observation；新 facade 成功或失败都会带 resolved `remoteHost` entity，便于 run loop 后续复用。
  - `invocation_policy_overlay` 和浏览器 preview 已把新工具纳入 `ssh.command` 同级危险命令识别；`sudo/rm/reboot` 等会升级为 `Destructive` + `Full` audit。
  - MCP agent catalog、browser preview skills、tool registry fixture、sample arguments、Rust/前端契约测试已同步。
- subagent 并行复核结论：
  - Bohr 确认 schema 不应硬塞 `oneOf`，目标选择沿用运行时校验；必须同步后端 policy 和前端 preview，避免新 facade 绕过危险命令升级。
  - Hypatia 确认同步面包括 Rust registry、execution dispatch、agent catalog、browser preview、fixture、sample args、tool registry/API tests，本轮已逐项落地。
- 后续边界：
  - TASK-006 当前 resolver/facade 主体完成；剩余重点转入 TASK-007 run timeline、final display、cancel/retry 和三主题真实界面验证。
- 验证：
  - `cargo fmt --manifest-path src-tauri\Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_tool_invocation_service ssh_command_on_resolved_host -- --nocapture` 通过，3 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_tool_invocation_service resolved_host_ssh_command -- --nocapture` 通过，2 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_tool_invocation_service registry_contract -- --nocapture` 通过，1 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_tool_invocation_service ssh_facade -- --nocapture` 通过，5 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test tool_registry_service -- --nocapture` 通过，19 passed。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test tool_registry_contract_fixture -- --nocapture` 通过，1 passed。
  - `npm test -- src/lib/toolRegistryApi.test.ts src/lib/aiToolInvocationApi.test.ts` 通过，37 passed。
  - `cargo check --manifest-path src-tauri\Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_agent_run_service harness_ -- --nocapture` 通过，7 passed。
  - `npm run build` 通过，保留既有 Vite large chunk warning。
  - `Invoke-WebRequest http://127.0.0.1:1425/` 通过，现有 dev server 返回 200。

### 2026-06-22T21:00:49+08:00

- 已补齐 TASK-007 的前端 run UI 最小闭环：
  - 新增 `AiRunTimeline`，使用真实 `AiAgentRunSnapshot` 渲染 run 状态、step timeline、final message、cancel/retry 操作。
  - 新增纯 view model helper，把 `AiAgentRunStep` 映射为 UI timeline，并集中判定 cancel/retry 可用性。
  - `AiToolContent` 接入 `getAiAgentRun/cancelAiAgentRun/startAiAgentRun/resumeAiAgentRun`：pending 出现时加载 run snapshot，审批 resume 后更新 timeline/final，cancel 后移除该 run 的 pending；当时 retry 仍是重新开始同目标的占位实现，已在 2026-06-22T21:17:55+08:00 升级为 last-step retry。
  - `AiToolContentComposer` 在 pending approval 卡和输入框之间展示 run timeline，继续沿用 `kerminal-muted-surface`、CSS 变量和 paired `dark:` 样式，不新增 portal。
- 实现边界：
  - 当时 retry 仍不是 last-step rollback；该边界已在 2026-06-22T21:17:55+08:00 由后端 step rollback/replay 语义补齐。
  - 主聊天发送路径仍保留 `streamAiChatMessage`，没有直接切到 `startAiAgentRun`，避免丢失现有 history、attachments、terminal context、provider 选择和 execution visibility 能力。
  - 本轮没有新增后端 Rust 行为。
- subagent 并行复核结论：
  - explorer 确认 TASK-007 的关键接线点是 `AiToolContent`、`AiToolContentComposer`、`aiToolContentModel` 和 run API wrapper；不应绕过 `aiPendingInvocationQueue` 的 conversation/slot 匹配。
  - explorer 确认项目没有 Playwright 依赖，现有截图脚本是 CDP 定制脚本，不能直接复用到 AI 面板。
- 验证：
  - `npm run test:frontend -- src/lib/aiAgentRunApi.test.ts src/features/tool-panel/ai-tool-content/aiToolContentModel.test.ts src/features/tool-panel/ai-tool-content/AiToolContentParts.test.tsx src/features/tool-panel/AiToolContent.test.tsx` 通过，4 files / 48 tests。
  - `npm run build` 通过，保留既有 Vite large chunk warning。
  - `npm run dev -- --host 127.0.0.1 --port 1640` 启动成功，`Invoke-WebRequest http://127.0.0.1:1640/` 返回 200。
  - 当时尚未完成真实浏览器截图；该缺口已在 2026-06-22T21:17:55+08:00 通过 Vite + Headless Chrome + CDP 验证脚本补齐。

### 2026-06-22T21:17:55+08:00

- 已补齐 TASK-007 后续缺口，并完成本计划首轮归档条件：
  - 新增 `ai_agent_run_retry_last_step` Tauri command、`AiAgentRunService::retry_last_step` 和前端 `retryAiAgentRunLastStep` wrapper。
  - `AiToolContent` 的重试入口从占位重试改为“重试上一步”，复用同一个 `runId`；失败 observation 会回滚到匹配 tool call，completed run 拒绝 retry。
  - 新增 `scripts/verify-ai-run-timeline-app.mjs` 和 `npm run verify:ai-run-timeline-app`，使用 Vite + Headless Chrome + CDP 打开真实应用，模拟 Tauri invoke，完成 AI 消息发送、pending approval、`ai_tool_confirm`、`ai_agent_run_resume`、timeline/final 渲染和 PNG 截图。
  - ACP Adapter 仍按 TASK-008 作为长期候选，不进入首轮内置 runtime。
- 验证：
  - `cargo fmt --manifest-path src-tauri\Cargo.toml` 通过。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test ai_agent_run_service retry_last_step -- --nocapture` 通过，3 passed。
  - `cargo check --manifest-path src-tauri\Cargo.toml` 通过。
  - `npm run test:frontend -- src/lib/aiAgentRunApi.test.ts src/features/tool-panel/ai-tool-content/aiToolContentModel.test.ts src/features/tool-panel/ai-tool-content/AiToolContentParts.test.tsx src/features/tool-panel/AiToolContent.test.tsx` 通过，4 files / 49 tests。
  - `npm run verify:ai-run-timeline-app -- --theme=dark` 通过，生成 `.updeng/docs/verification/ai-run-timeline-dark.json` 与 `.updeng/docs/verification/ai-run-timeline-dark.png`。
  - `npm run verify:ai-run-timeline-app -- --theme=light` 通过，生成 `.updeng/docs/verification/ai-run-timeline-light.json` 与 `.updeng/docs/verification/ai-run-timeline-light.png`。
  - `npm run verify:ai-run-timeline-app -- --theme=system --system-prefers=dark` 通过，生成 `.updeng/docs/verification/ai-run-timeline-system-dark.json` 与 `.updeng/docs/verification/ai-run-timeline-system-dark.png`。
  - `npm run verify:ai-run-timeline-app -- --theme=system --system-prefers=light` 通过，生成 `.updeng/docs/verification/ai-run-timeline-system-light.json` 与 `.updeng/docs/verification/ai-run-timeline-system-light.png`。
  - `npm run build` 通过，保留既有 Vite large chunk warning。

## 开始条件

- 当前 [AI 助手终端上下文与会话绑定生产级重构计划](../active/2026-06-21-ai-assistant-terminal-context.md) 完成或明确冻结新功能，只保留外部 live smoke blocker。
- 为本计划登记独立 lane，owned paths 至少包含：
  - `src-tauri/src/services/ai_agent_service*`
  - `src-tauri/src/services/ai_tool_invocation_service*`
  - `src-tauri/src/models/ai_*`
  - `src/features/tool-panel/ai-tool-content/*`
  - `src/lib/ai*Api.ts`
- 开始实现前先补 ADR-0015 草案或在本计划 TASK-008 后决定是否需要 ADR。
