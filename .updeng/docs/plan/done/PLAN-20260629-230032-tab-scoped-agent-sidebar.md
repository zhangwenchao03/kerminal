---
id: PLAN-20260629-230032-tab-scoped-agent-sidebar
status: done
created_at: 2026-06-29T23:00:32+08:00
started_at: 2026-06-29T23:08:42+08:00
completed_at: 2026-06-29T23:46:06+08:00
updated_at: 2026-06-29T23:46:06+08:00
owner: ai
lane: lane-tab-scoped-agent-sidebar-design-20260629
---

# 右栏 AI 助手按 Tab 绑定方案

## 目标

- 右侧 Agent Launcher 的 AI 助手按 workspace tab 隔离：每个终端 tab 拥有自己的右栏 AI 助手槽位。
- 切换中间终端 tab 时，右栏显示对应 tab 的助手；切回旧 tab 时能回到旧 tab 的助手终端。
- 关闭 tab 时，同 tab 的右栏助手也随之结束：前端移除、PTY 关闭、Agent session 标记归档，不再自动恢复到其它 tab。
- 移除右栏 AI 助手顶部的可点击目标绑定入口；目标上下文由 tab 生命周期和当前 focused pane 自动派生，不让用户手工改绑。
- 保持现有真实 xterm/PTY Agent terminal 方向，不恢复旧内置聊天框、composer、prompt queue 或 provider UI。

## 非目标

- 不把一个 tab 做成多个并列 Agent 会话。第一版采用“一个 tab 一个右栏助手槽位”，同一 tab 更换 agent provider 需要明确替换或结束旧助手。
- 不为 SFTP 传输 tab、设置页或未来非终端 workspace tab 承诺完整 Agent 上下文。第一版只保证 `TerminalSessionTab`。
- 不删除 `~/.kerminal/agents/sessions/<agentSessionId>` 的物理文件。tab 关闭后的“会话没了”定义为工作台不可见、不会自动恢复、PTY 已关闭、session 状态已 archived。
- 不改变 Kerminal MCP tools-only 边界；外部 Agent host 仍负责自身确认、权限和审计。

## 当前为什么切 Tab 右侧不变

CodeGraph 追踪到当前行为不是偶发 bug，而是状态模型就是“右栏一个当前助手”：

- `src/app/KerminalShell.workspaceSelectors.ts` 的 `buildToolPanelWorkspaceContext(...)` 已经把 `activeTab` 和 `focusedPane` 从 workspace store 选出来。
- `src/features/tool-panel/ToolPanel.tsx` 已经把 `activeTab`、`focusedPane` 传给 `AgentLauncherToolContent`。
- `src/features/tool-panel/AgentLauncherToolContent.tsx` 内部用 `agentSessions: Record<string, AgentTerminalSession>` 和单个 `activeAgentSessionId` 控制右栏终端。
- `findAgentSessionId(agentId, permissionMode)` 只按 agent 类型和权限模式复用，不看 `activeTab.id`、`target.tabId` 或 `paneId`。
- `createSessionForLaunch(...)` 只在新建时把 `buildAgentSessionTarget(focusedPane, activeTab)` 写进 session target；后续切 tab 不会切换 `activeAgentSessionId`。
- `AgentTerminalView` 顶部的 `Rebind agent target` 按钮会列出所有终端 pane 手工改绑，这与“每个助手绑定一个 tab”的产品模型冲突。
- `closeTerminalTabState(...)` 只移除 workspace tab 和 panes，不知道右栏 Agent session，因此关 tab 不会 archive 对应 Agent session。
- 前端 `src/lib/agentLauncherApi.ts` 暂无 `archiveAgentSession` 封装，但后端已有 `agent_session_archive` command 和 `AgentSessionService::archive_session(...)`。

## 产品契约

### Tab 作用域

- `activeTab.id` 是右栏 AI 助手的唯一主作用域。
- 每个终端 tab 最多有一个 active right-sidebar assistant。
- 同一个 Codex/Claude/custom 在不同 tab 启动时必须创建不同 `agentSessionId`，不能按 agent 类型跨 tab 复用。
- 切 tab 只切可见助手，不自动重启、不自动 resume、不把旧 tab 的助手改绑到新 tab。

### Target 绑定

- Agent session 的 `target.tabId` 是硬边界。
- `target.paneId` 只表示该 tab 内的默认或最近上下文 pane，不再作为用户可见绑定对象。
- 生成上下文 prompt 时，只允许读取同一 `target.tabId` 下的 `focusedPane`；若当前 focused pane 不属于该 tab，则回退到 session target 元数据，不跨 tab 取输出。
- 顶部不再显示可点击的绑定 chip 和 rebind menu。可保留不可点击的诊断 tooltip 或调试信息，但默认 UI 不出现“绑定”入口。

### 生命周期

- 启动助手：在当前 `activeTab.id` 下创建或恢复本 tab 的 agent session，并写入 `target.tabId`。
- 切换 tab：右栏根据新 `activeTab.id` 查找对应助手槽位；存在则显示对应 xterm，不存在则显示 launcher。
- 切回 tab：原助手 xterm 仍在内存中，继续显示原输出和 PTY 状态。
- 关闭 tab：清理该 tab 下的 agent xterm，触发现有 `XtermPane` cleanup 关闭 terminal session，再调用 `agent_session_archive`，最后删除本地 tab mapping。
- App 重启：不自动启动所有旧 Agent。若有 `status=Active` 且 `target.tabId` 匹配当前恢复 tab 的 session，可显示“恢复此 tab 助手”的选择；`Archived` 和无 `tabId` 的旧 session 不自动挂到当前 tab。

## 技术设计

### 1. 抽纯模型

新增 `src/features/tool-panel/agent-launcher/agentTabSessionModel.ts`，把状态派生从 React 组件里拿出来，先用单测锁定行为。

建议模型：

```ts
export interface AgentSidebarTabSession {
  agentId: ExternalAgentId;
  agentSessionId: string;
  customCommand?: string;
  permissionMode: AgentLaunchPermissionMode;
  status: ExternalAgentSessionStatus;
  tabId: string;
  target?: AgentSessionTargetRequest;
}

export interface AgentSidebarSessionState {
  activeSessionIdByTabId: Record<string, string | undefined>;
  sessionsById: Record<string, AgentSidebarTabSession>;
  viewByTabId: Record<string, "launcher" | "terminal">;
}
```

核心函数：

- `agentSessionTabId(session)`：从 `session.target.tabId` 或 registry 字段取作用域。
- `visibleAgentSessionForTab(state, tabId)`：只返回当前 tab 的 session。
- `findRunningSessionForTabAgent(state, tabId, agentId, permissionMode, customCommand?)`：替代当前跨 tab 的 `findAgentSessionId(...)`。
- `tabRemovedCleanupPlan(previousTabIds, nextTabIds, state)`：返回需要关闭/归档的 session ids。
- `restorableSessionsForTab(records, tabId)`：只返回 `status=Active` 且 `target.tabId === tabId` 的持久 session。

### 2. 状态提升到工作区级 Registry

不要继续把 tab-scoped registry 全部放在 `AgentLauncherToolContent` 的局部 state。右栏工具被收起、切换工具、隐藏 drawer 时，局部组件生命周期容易和 Agent PTY 生命周期混在一起。

建议新增轻量 hook 或 store slice：

- 位置可选：`src/features/tool-panel/agent-launcher/useAgentSidebarSessions.ts` 或 workspace store 的独立 slice。
- 由 `ToolPanelStoreBridge` 或 `ToolPanel` 传入 `activeTab`、`terminalTabs`、`focusedPane`。
- registry 维护 `tabId -> agentSessionId` 映射、agent sessions 元数据和 view 状态。
- Agent xterm 渲染池按 session id 保持挂载，只有当前 tab 的 session 可见且 `focused=true`；非当前 tab session `focused=false` 但不卸载。

这样可以保证切 tab 不杀旧助手，关 tab 才杀。

### 3. 改造 AgentLauncherToolContent

`AgentLauncherToolContent` 从“拥有全部 session 状态”改成“渲染当前 tab 的 launcher/terminal，并调 registry actions”：

- 接收 `activeTab`、`focusedPane`、`terminalTabs`。
- 若没有 `activeTab` 或不是 `TerminalSessionTab`，显示不可启动状态或空 launcher，不创建 targetless session。
- 启动 Codex/Claude/custom 时，先按当前 `tabId` 查找已有 session；不存在才调用 `createAgentSession(...)`。
- 继续上次会话时，只展示当前 tab 的候选，不再展示其它 tab 或无 `tabId` 的旧会话。
- 移除 `rebindAgentTarget(...)` 主路径、`openRebindTargets(...)`、`AgentTerminalView` 顶部绑定按钮和 rebind menu。
- `AgentTerminalView` 标题区域保留返回按钮、agent 图标、agent 名称、命令和 workspace path；不再出现右侧绑定 chip。

### 4. 补 Agent Session API

前端 API 补齐后端已有命令：

```ts
export function archiveAgentSession(agentSessionId: string): Promise<AgentSessionRecord> {
  if (!isTauri()) {
    return Promise.resolve(previewArchivedAgentSessionRecord(agentSessionId));
  }
  return invoke<AgentSessionRecord>("agent_session_archive", { agentSessionId });
}
```

同时补全 `AgentSessionRecord.session.status` 的 TS 类型映射，避免前端 restore 时无法过滤 `Archived`。

后端需要确认：

- `agent_session_archive` 已在 Tauri command registry 中注册；若未注册，补注册。
- `AgentSessionFileStore::list_sessions()` 当前会列出所有状态，前端必须过滤 `Archived`；如果后续服务层改成默认只列 active，需要同步测试和文档。

### 5. Tab 关闭清理

不要把异步 archive 塞进 `workspaceStore.closeTerminalTabState(...)` 这种纯状态更新函数。

推荐流程：

- registry 持有上一帧 `terminalTabs` ids。
- 当 `terminalTabs` 变化时，用 `tabRemovedCleanupPlan(...)` 找到被关闭 tab。
- 对每个 removed tab：
  - 将对应 session 从可见 registry 标记为 `closing`。
  - 让对应 `AgentTerminalView`/`XtermPane` 卸载，复用现有 cleanup 关闭 terminal PTY。
  - 调用 `archiveAgentSession(agentSessionId)`。
  - 成功或失败都从 `activeSessionIdByTabId` 移除；失败记录 inline error 或 diagnostics，但不把 session 挂到其它 tab。

### 6. Context Prompt 约束

`agentTerminalContextModel.ts` 现有 `resolveBoundTarget(...)` 只比对 `paneId`。后续要升级为 tab-aware：

- session 有 `target.tabId` 时，`focusedPane` 必须属于当前 `activeTab.id === target.tabId` 才能作为上下文 pane。
- runtime selection/command block prompt 必须同时匹配 `runtimeContext.paneId` 和 session tab boundary。
- header 继续输出 `Tab: <title> (<id>)`，但来源优先使用 session `target.tabId` 对应的 tab，而不是当前任意 active tab。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 前端状态模型 | 是 | `src/features/tool-panel/agent-launcher/agentTabSessionModel.ts` | Vitest model tests |
| Agent Launcher UI | 是 | `src/features/tool-panel/AgentLauncherToolContent.tsx` | component tests、三主题截图 |
| 工具面板上下文 | 是 | `src/features/tool-panel/ToolPanel.tsx`、`src/app/KerminalShell.workspaceBridge.tsx` | ToolPanel tests |
| Agent API | 是 | `src/lib/agentLauncherApi.ts` | API preview tests |
| Tauri agent session | 可能 | `src-tauri/src/commands/agent_session.rs`、registry | cargo tests、command smoke |
| 终端 PTY 生命周期 | 是 | `src/features/terminal/XtermPane.tsx`、runtime cleanup 现有行为 | existing XtermPane tests、真实 smoke |
| Workspace tab 生命周期 | 是 | `src/features/workspace/workspaceTerminalState.ts` 只读依赖 | workspace tab tests |
| 文档/协作 | 是 | 本计划、`coordination/lanes.json` | JSON 校验、文档检查 |

## 执行切片

- [x] TASK-001 纯模型与 API 类型
  - 新增 `agentTabSessionModel.ts` 和测试。
  - `AgentSessionRecord` 增加 `status` TS 映射。
  - 新增 `archiveAgentSession(...)` 前端 API 和 preview fallback。
  - 验证：`npm run test -- --run src/features/tool-panel/agent-launcher/agentTabSessionModel.test.ts src/lib/agentLauncherApi.test.ts`。

- [x] TASK-002 Tab-scoped registry
  - 把 `activeAgentSessionId` 改为 `activeSessionIdByTabId`。
  - `findAgentSessionId(...)` 增加 `tabId` 边界，禁止跨 tab 复用。
  - `persistedAgentSessions` restore 只看当前 tab。
  - 验证：`AgentLauncherToolContent.test.tsx` 覆盖 tab A/B 启动不同 Codex、切换可见 session 不串台。

- [x] TASK-003 UI 移除顶部绑定
  - 移除 `Rebind agent target` 按钮、`Link2` chip、rebind menu 和主路径 rebind action。
  - Header 改为 agent identity + command/workspace path；不出现“绑定/未绑定/已失效”主控件。
  - 验证：component test 确认 `agent-target-chip` 不存在；三主题截图确认右栏顶部无溢出、无不可读颜色。

- [x] TASK-004 Tab close cleanup
  - registry 侦测 removed tab ids，关闭对应 Agent terminal view 并调用 `archiveAgentSession`。
  - archive 失败不阻断 tab 关闭，但记录错误状态并从当前 tab mapping 移除。
  - 验证：tab close 后旧 session 不再可见；mock `archiveAgentSession` 被调用；XtermPane unmount cleanup 仍关闭 terminal。

- [x] TASK-005 Context prompt tab boundary
  - `agentTerminalContextModel.ts` 增加 tab-aware resolve。
  - selection、command block、output tail 只能来自同一 tab 内匹配 pane。
  - 验证：模型测试覆盖 active tab 不匹配时不泄露其它 tab 输出。

- [x] TASK-006 真实运行与回归
  - `npm run build`。
  - 启动真实 dev server，浅色、深色、跟随系统截图。
  - 涉及 Agent xterm/PTY 后运行 `npm run tauri:dev` 或记录无法运行原因。
  - 手工 smoke：打开 tab A 启动 Codex，打开 tab B 启动 Claude/Custom，切回 A 仍是 A 的 Codex；关闭 A 后 A 助手结束且不出现在 B。

## 验收标准

- 同一 agent provider 在两个不同 tab 启动时生成两个不同 `agentSessionId`。
- 切 tab 后右栏立即切换到该 tab 的助手或 launcher，不显示其它 tab 的 terminal。
- 关闭 tab 后对应 helper PTY 被关闭，`agent_session_archive` 被调用，对应 session 不再自动恢复。
- 顶部没有可点击绑定 chip 或 rebind menu。
- 无 `tabId` 的 legacy session 不会自动挂到当前 tab。
- 普通中间终端、SFTP、tmux、snippet、logs、settings 工具不回退。
- 三主题下右栏顶部、launcher、terminal header 都可读且无文字重叠。

## 风险与回滚

- 风险：隐藏挂载多个 Agent xterm 会增加资源占用。缓解：只保留已有 tab 的一个 session，tab close 必须清理；后续可加“后台暂停/结束”入口。
- 风险：旧无 `tabId` session 不再自动恢复，用户可能找不到历史。缓解：不删除文件，未来可做显式历史入口；第一版先避免串台。
- 风险：关闭 tab archive 失败。缓解：前端仍关闭 PTY 和移除可见 mapping，错误写 diagnostics，不阻断 tab 关闭。
- 风险：当前 blocked 的 Agent terminal 兼容计划也涉及 `AgentLauncherToolContent.tsx`、`XtermPane.tsx`、`XtermPane.runtime.ts`。实现前必须先读 `.updeng/docs/plan/blocked/PLAN-20260626-155809-agent-terminal-production-compat.md` 和最新 diff，保持真实 xterm/PTY 默认体验。
- 回滚：恢复单一 `activeAgentSessionId`、恢复 rebind chip、取消 tab close archive effect。因为本方案以新增 model/registry 为主，回滚可限制在 Agent Launcher 前端与 API 封装层。

## 并行协作要求

- 正式实现前刷新 `.updeng/docs/coordination/status.md`。
- 写入共享文件前读取 `lane-agent-terminal-production-compat` 的 blocked plan 和 checkpoint。
- 只修改本方案列出的 Agent/tab/session 文件，不顺手重排右栏工具面板或终端 runtime。
- 每个切片完成后在本计划 Round Log 记录 touched paths、验证命令、截图路径和剩余风险。

## Round Log

### 2026-06-29T23:00:32+08:00

- 根据用户反馈建立 next 方案：右栏 AI 助手应按 tab 隔离，移除顶部绑定入口，tab 关闭时助手随之结束。
- 回读 `AGENTS.md`、`README.md`、Updeng 文档入口、当前计划索引、blocked Agent terminal 兼容计划和 coordination lanes。
- 用 CodeGraph 查明当前问题根因：`AgentLauncherToolContent` 是面板级 `activeAgentSessionId`，`findAgentSessionId(...)` 不含 tab 边界，`AgentTerminalView` 提供手工 rebind，`closeTerminalTabState(...)` 不处理 Agent session。
- 本轮只写方案文档和计划索引，不改生产代码，不运行 UI/build 验证。

### 2026-06-29T23:13:58+08:00

- 激活计划到 `plan/active/`，同步 `plan/INDEX.md`、`in-progress.md` 和 `coordination/lanes.json`；读取 blocked Agent terminal 兼容计划尾部和最新 lane status，确认当前 188 个既有改动均为 unclaimed，未命中本 lane 共享冲突。
- 完成 TASK-001：新增 `src/features/tool-panel/agent-launcher/agentTabSessionModel.ts` 和测试，锁定 tab 作用域、同 tab 可见 session、禁止跨 tab 复用、tab close cleanup plan、只恢复 `status=active` 且 `target.tabId` 匹配的持久 session。
- 补 `src/lib/agentLauncherApi.ts`：新增 `AgentSessionRecordStatus`、`AgentSessionRecord.session.status` 类型、`agentSessionRecordStatus(...)`、`archiveAgentSession(...)` 和 browser preview archived fallback；新增 `src/lib/agentLauncherApi.test.ts` 覆盖 Tauri invoke、preview fallback 和 legacy missing status 视为 active。
- 验证通过：`npm run test -- --run src/features/tool-panel/agent-launcher/agentTabSessionModel.test.ts src/lib/agentLauncherApi.test.ts`，2 files / 10 tests passed。

### 2026-06-29T23:23:26+08:00

- 完成 TASK-002：`AgentLauncherToolContent` 从单个 `activeAgentSessionId/view` 改为 `activeSessionIdByTabId` 与 `viewByTabId`，当前 tab 的可见 session 由 `visibleAgentSessionForTab(...)` 派生；provider/custom 启动、返回 launcher 和持久恢复都显式绑定当前 terminal tab。
- `findAgentSessionId(...)` 改为调用 `findRunningSessionForTabAgent(...)`，同一 provider 在不同 tab 不再复用；`findPersistedAgentSession(...)` 只从 `restorableSessionsForTab(records, tabId)` 里选择，legacy 无 `target.tabId` 或 `archived/stale` record 不自动恢复到当前 tab。
- 更新 `AgentLauncherToolContent.test.tsx`：默认测试 helper 传入 terminal active tab；新增 tab A/B Codex 测试，确认两个 tab 生成两个不同 agentSessionId，切回 tab A 时重新聚焦 tab A 的 xterm。
- 验证通过：`npm run test -- --run src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/agent-launcher/agentTabSessionModel.test.ts src/lib/agentLauncherApi.test.ts`，3 files / 29 tests passed。

### 2026-06-29T23:26:12+08:00

- 完成 TASK-003：移除 `AgentTerminalView` 顶部 `Rebind agent target` 按钮、`Link2` chip、rebind dropdown、`onRebindTarget` prop 和主路径 `rebindAgentSessionTarget(...)` 调用；保留 restore choice panel 中不可点击的历史 target 状态提示。
- 清理与 rebind dropdown 专用的 `PaneSessionListRecord`、`listTerminalPaneSessionRecords`、`buildAgentSessionTargetFromPaneRecord(...)`、`buildPaneRecordTargetRef(...)` 和 `formatPaneRecordTitle(...)`，避免残留无入口逻辑。
- 更新 `AgentLauncherToolContent.test.tsx`：删除旧 rebind 行为用例；focused pane 绑定用例改为确认 terminal 顶部不出现 `agent-target-chip` 和 `Rebind agent target` 按钮；stale restore 后也不显示 terminal 顶部 target chip。
- 验证通过：`npm run test -- --run src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/agent-launcher/agentTabSessionModel.test.ts src/lib/agentLauncherApi.test.ts`，3 files / 28 tests passed。

### 2026-06-29T23:28:18+08:00

- 完成 TASK-004：`ToolPanel` 将 `terminalTabs` 传给 `AgentLauncherToolContent`；Agent Launcher 记录上一帧 terminal tab ids，用 `tabRemovedCleanupPlan(...)` 侦测被关闭的 tab。
- 关闭 tab 时立即从 `agentSessions`、`activeSessionIdByTabId` 和 `viewByTabId` 移除对应 session/tab，使 `AgentTerminalView`/`XtermPane` 卸载；随后调用 `archiveAgentSession(agentSessionId)`，失败时只写入 inline action error，不把 session 挂到其它 tab。
- 更新 `AgentLauncherToolContent.test.tsx`：新增 tab close 用例，确认关闭 tab A 后 `archiveAgentSession("ags-codex")` 被调用，旧 Agent xterm 不再可见，tab B 保持 launcher。
- 验证通过：`npm run test -- --run src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/agent-launcher/agentTabSessionModel.test.ts src/lib/agentLauncherApi.test.ts`，3 files / 29 tests passed。

### 2026-06-29T23:30:42+08:00

- 完成 TASK-005：`agentTerminalContextModel.ts` 的 `resolveBoundTarget(...)` 增加 active tab 约束；只有 `activeTab.id === session.target.tabId` 时才允许 focused pane 参与 output tail、selection 和 command block prompt。
- context header 的 `Tab:` 优先使用 `session.target.tabId`；active tab 不匹配时不会把其它 tab 的 title/id 写入目标上下文，也不会读取其它 tab 的 output/selection/command block。
- 更新 `agentTerminalContextModel.test.ts`：新增同 paneId 但 active tab 不匹配时不带 output 的测试，以及 runtime selection 在 tab 不匹配时返回 null 的测试。
- 验证通过：`npm run test -- --run src/features/tool-panel/agent-launcher/agentTerminalContextModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/tool-panel/agent-launcher/agentTabSessionModel.test.ts src/lib/agentLauncherApi.test.ts`，4 files / 37 tests passed。

### 2026-06-29T23:46:06+08:00

- 完成 TASK-006：`npm run build` 通过，仅保留既有 Vite 动态导入和 chunk size 警告。
- 真实 dev server 验证：`http://127.0.0.1:1450/` 启动成功，已采集浅色、深色、跟随系统截图：`.updeng/docs/verification/tab-scoped-agent-sidebar/agent-launcher-wide-light.png`、`agent-launcher-wide-dark.png`、`agent-launcher-wide-system.png`；DOM metrics 确认 `hasTargetChip: false`。
- 额外浏览器 smoke：复用当前 `http://127.0.0.1:1425/`，系统 Chrome 打开页面并点击 `打开 Agent Launcher`，确认 Codex/Claude/自定义入口可见，`[data-testid="agent-target-chip"]` 数量为 0。
- Tauri smoke：直接 `npm run tauri:dev -- --no-dev-server` 因固定 `beforeDevCommand` 仍尝试启动 Vite 且 1425 已占用而失败；覆盖 `beforeDevCommand` 后默认 target 又因已有 `src-tauri/target/debug/kerminal.exe` 进程锁文件失败。最终使用 `KERMINAL_CONFIG_ROOT=.updeng/tmp/tauri-smoke-tab-scoped-agent-sidebar` 和 `CARGO_TARGET_DIR=.updeng/tmp/tauri-target-tab-scoped-agent-sidebar`，执行 `npm run tauri -- dev --config {"build":{"beforeDevCommand":""}} --no-dev-server-wait`，编译通过并运行隔离 target 的 `kerminal.exe`，命令 exit code 0。
- 清理：停止本轮截图用 `1450` dev server；保留既有 `1425` dev server 和更早启动的默认 target `kerminal.exe`，避免影响其它会话。
