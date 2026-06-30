# ADR-0014: AI Pane-Session Context Tracer

日期：2026-06-22

## 状态

Accepted

## 背景

P0 已把 Rust `ai_chat` 请求通过 `AiContextService` gateway 绑定 terminal snapshot，并用 `DisabledByProvider` / `Strict` / `BestEffort` 固定了 terminal context gateway 行为。但 P0 仍只校验 `sessionId` 是否存在，不能证明前端传入的 `paneId`、`tabId`、`machineId` 和 `sessionId` 是同一个可信绑定。

当前前端 `terminalSessionRegistry.ts` 能记录 pane 到 terminal session 的关系，Rust `TerminalManager` 能读取 PTY session summary 和 output buffer，但后端缺少生产级 pane-session registry/tracer，因此无法回答这些排障和审计问题：

- 某条 AI 消息读取的 terminal snapshot 当时属于哪个 pane、tab、host/container/profile。
- session 是正常绑定、尚未就绪、已经关闭、重连后替换，还是前端传入了过期/不匹配元数据。
- pending tool invocation 恢复并确认时，原始 pane/session 是否仍然有效。
- 用户报告“AI 看错终端”时，审计链能否还原绑定变化、失效原因和 gateway 选择。

## 决策

P1 不直接扩大 AI 可执行能力，先把 pane-session registry tracer 作为后端可信上下文边界生产化。目标不是替代 TerminalManager，而是在 TerminalManager、workspace pane runtime、AI context gateway 和审计之间建立一层可追踪的绑定事实。

核心决策：

1. Rust 侧新增或扩展一个 `TerminalSessionBindingService`，作为 pane/session 绑定的可信 registry。
2. registry 以 `paneId` 和 `sessionId` 双索引维护当前绑定，同时保留有限事件日志用于审计和故障排查。
3. 前端仍可以上报 pane/session/target/cwd 变化，但后端必须把这些上报转成带来源、序列号和时间戳的 binding event；AI gateway 消费的是 registry 解析结果，不直接信任 chat request 里的主机元数据。
4. `AiContextService` 在 `CurrentTerminal` / `lockedPane` 语义下通过 `paneId` 或绑定 token 解析 session，并校验 request `sessionId` 与 registry 当前绑定一致；不一致时返回结构化 stale/mismatch 原因。
5. `CurrentWorkspace` / best-effort 语义可以在绑定缺失时降级为无 terminal snapshot，但必须在 response metadata / audit 中记录 `snapshot_unavailable` 原因。
6. registry 事件进入 AI context audit，和 conversation/message/context snapshot/tool invocation 用 id 关联；不记录完整终端输出、密钥、环境变量或未脱敏文件内容。

## 数据模型

### 当前绑定

建议的后端内存模型字段：

| 字段 | 说明 |
| --- | --- |
| `bindingId` | 后端生成的稳定绑定 id，pane/session 每次重新绑定都会变化 |
| `paneId` | UI pane id |
| `tabId` | pane 所属 tab，可为空但应尽量上报 |
| `sessionId` | TerminalManager session id |
| `targetRef` | 规范化目标引用，例如 `local:<profileId>`、`ssh:<hostId>`、`container:<id>`、`serial:<port>` |
| `machineId` / `remoteHostId` | 兼容现有前端字段，作为 targetRef 的输入而不是唯一事实 |
| `cwd` | 最近可信 cwd，允许为空 |
| `state` | `binding_pending`、`active`、`stale`、`disconnected`、`closed`、`replaced` |
| `generation` | pane 内绑定递增序号，用于识别重连和竞态 |
| `createdAt` / `updatedAt` / `lastSeenAt` | 生命周期时间戳 |
| `source` | `frontend_registry`、`terminal_create`、`terminal_close`、`cwd_update`、`reconnect` 等 |

### 事件

事件只记录元数据和脱敏摘要：

| 事件 | 触发 | 审计价值 |
| --- | --- | --- |
| `binding.registered` | pane 首次绑定 session | 建立 AI 可读终端的起点 |
| `binding.ready` | session 可读取 snapshot | 区分 UI pane 已存在但 PTY 尚未就绪 |
| `binding.cwd_updated` | cwd 变化 | 解释 AI snapshot 的目录来源 |
| `binding.target_updated` | host/container/profile 元数据变化 | 发现 target 漂移或前端推断差异 |
| `binding.disconnected` | SSH/container/serial 断开但 pane 仍在 | 允许提示用户重连或使用最后快照 |
| `binding.reconnected` | 同 pane 新 session 替换旧 session | 防止旧 pending approval 写入新目标 |
| `binding.closed` | pane 或 session 正常关闭 | 后续请求应 stale 或 best-effort 降级 |
| `binding.mismatch_detected` | request/session/target 与 registry 不一致 | 审计潜在伪造、竞态或前端 bug |
| `snapshot.resolved` | gateway 成功解析并读取 snapshot | 追踪 AI 实际看到的上下文 |
| `snapshot.rejected` | strict gateway 拒绝 stale/mismatch | 解释 chat 失败或 pending tool 拒绝原因 |
| `snapshot.degraded` | best-effort 无 terminal snapshot 继续 | 解释 AI 只拿到 application context |

## AI Context Gateway 使用方式

`AiContextService` 的请求解析顺序：

1. 如果 provider strategy 是 `DisabledByProvider`，不访问 registry，只记录 provider-disabled。
2. 如果请求语义是 `CurrentTerminal` 或 `lockedPane`，优先用 `paneId` / `bindingId` 查 registry，再校验 request `sessionId`。
3. 如果只有 `sessionId`，允许按 session 索引查 registry，但返回结果必须标注 `pane_unverified`，后续应收敛为带 pane/binding 的调用。
4. registry 当前状态是 `active` 且 generation 匹配时，读取 TerminalManager snapshot。
5. registry 状态为 `binding_pending`、`disconnected`、`closed`、`replaced` 或 request mismatch 时：
   - `Strict` 返回结构化错误，不调用模型。
   - `BestEffort` 继续无 terminal snapshot，并记录降级原因。
6. snapshot metadata 写入 `contextSnapshot`，至少包含 `bindingId`、`paneId`、`tabId`、`sessionId`、`targetRef`、`cwd`、`bindingGeneration`、`gatewayBehavior`、`resolutionStatus`。

## 审计与排查

审计记录必须能从任意 AI message 或 tool invocation 反查：

- 发送时绑定的是哪个 `bindingId`、`paneId`、`sessionId`、`targetRef`。
- gateway 是 strict、best-effort 还是 provider-disabled。
- snapshot 是 resolved、rejected 还是 degraded。
- 如果 rejected/degraded，原因是 stale session、pane missing、generation mismatch、target mismatch、provider disabled、session not ready 还是 terminal manager read failed。
- pending approval 确认前再次解析绑定时，原绑定是否仍为 active；若已 replaced/disconnected/closed，必须阻止或要求用户重新生成工具调用。

不进入审计的内容：

- 完整终端输出。
- 未脱敏环境变量、token、密码、私钥、证书。
- 远程文件正文和图片原始内容。

## 失败模式

| 失败模式 | 策略 |
| --- | --- |
| pane 已创建但 session 尚未注册 | `binding_pending`，UI 可显示“终端会话尚未就绪”，strict chat 阻止读取 terminal snapshot |
| request 携带旧 sessionId | registry 返回 `replaced` / `generation_mismatch`，strict 拒绝，best-effort 降级并审计 |
| session 已关闭但 conversation 继续 | 提示“使用最后快照继续 / 重新绑定 / 新建会话”，不伪装为 live terminal |
| SSH/container 断开后同 pane 重连 | 生成新 `bindingId` / generation；旧 pending tool invocation 不可直接写入新 session |
| 前端 target 元数据与后端绑定不一致 | 记录 `binding.mismatch_detected`，AI gateway 使用后端 registry 的 targetRef 或拒绝 |
| TerminalManager snapshot 读取失败 | strict 返回 `snapshot_rejected`，best-effort 返回 `snapshot_degraded` |
| 应用重启后内存 registry 丢失 | 首版允许 registry 从 live terminal runtime 重建；历史审计保留最后事件但不恢复 closed live session |
| 事件日志过大 | 只保留有限窗口和持久化审计摘要，禁止保存完整输出 |

## 验证方式

后续实现切片至少需要这些验证：

- Rust 单元测试：register/update/close/reconnect 后 `paneId` 和 `sessionId` 双索引一致。
- Rust gateway 测试：active binding 可以读取 snapshot；stale session 在 `Strict` 下拒绝；`BestEffort` 下带降级原因继续。
- Rust pending approval 测试：旧 binding 被 `reconnected` 替换后，原 tool invocation 不能确认写入新 session。
- 前端/IPC 契约测试：pane registry 上报包含 `paneId`、`tabId`、`sessionId`、target、cwd、generation。
- 审计测试：`snapshot.resolved` / `snapshot.rejected` / `snapshot.degraded` 能关联 conversation/message/context snapshot。
- 启动 smoke：registry 接入 terminal lifecycle 后继续满足 `npm run build`、真实 dev server smoke；涉及 Tauri lifecycle 时跑通 `npm run tauri:dev` 或记录无法运行原因。

## 回滚方式

实现期必须保留可回滚边界：

- registry/tracer 先作为旁路观察模式接入，只记录事件，不改变 `ai_chat` 行为。
- 观察模式稳定后再让 `AiContextService` strict 路径强依赖 registry。
- 如果 registry 导致启动或 AI chat 阻断，可通过 feature flag 或配置临时退回 P0 行为：按 `sessionId` 直接读取 TerminalManager snapshot，但必须在审计中标注 `registry_disabled`.
- 回滚不得删除已写入的审计事件；只能停止新事件采集或停止 gateway 强校验。

## 本轮不做

本 ADR 是 P1 文档切片，本轮不修改 Rust、Tauri command、前端 runtime、数据库 migration 或 Tool Registry 代码。

本轮也不实现：

- 新的 AI 工具能力。
- Serial/Telnet/Container 写操作。
- pending invocation target validity 代码门禁。
- 会话历史迁移或 UI readiness 提示。
- 外部 MCP/ACP agent adapter。
- 持久化完整 terminal output 或敏感上下文。

## 后续切片

1. 旁路 tracer：新增后端 binding service 和事件模型，只记录当前 pane/session lifecycle。
2. Gateway 消费：让 `AiContextService` 使用 registry 解析 terminal snapshot，并补 strict/best-effort 测试。
3. Pending validity：tool invocation confirm 前重新解析 binding，阻止旧 binding 写入新 session。
4. UI readiness：把 registry/gateway 的结构化原因暴露给 AI 面板状态，而不是静默降级。
