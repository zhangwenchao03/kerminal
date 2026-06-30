---
id: PLAN-20260623-190929-kerminal-performance-optimization
status: done
created_at: 2026-06-23T19:09:29+08:00
started_at: 2026-06-23T19:33:06+08:00
completed_at: 2026-06-23T23:58:53+08:00
updated_at: 2026-06-23T23:58:53+08:00
owner: ai
---

<!-- @author kongweiguang -->

# Kerminal 性能优化生产级实施计划

## 目标

把 Kerminal 的下一轮性能优化做成可量测、可回滚、可分阶段执行的生产级计划。重点不是和 Otty/Ghostty 这类 native terminal 在纯渲染器层面硬拼，而是优先降低 Kerminal 真实工作台场景里的卡顿来源：

- 终端大输出时主线程附带处理过多。
- workspace store 高频字段导致大范围 React 更新。
- workspace session 持久化在高频变更下反复构建 snapshot。
- AI 流式输出逐 delta 更新 React state 并触发本地持久化。
- SFTP、本地目录、主机侧栏等大列表未做虚拟化。
- SFTP 队列、ServerInfo 等后台轮询在可见性和事件通道健康时不够克制。
- 性能基线、bundle baseline 和 Rust release profile 仍需统一到当前 `.updeng/docs/verification` 体系。

最终结果必须能回答两个问题：

1. 用户体感是否更稳：终端连续输出、AI streaming、SFTP 大目录、多个 pane 并行时是否更少掉帧。
2. 数据是否可证明：每个切片都有前后对比、验证命令、失败回滚口径，而不是凭肉眼说“更快”。

## 非目标

- 不自研终端渲染器，不替换 `@xterm/xterm`。
- 不引入 Metal/WebGPU/Canvas 渲染重写。
- 不一次性重写 `workspaceStore`、`KerminalShell`、`AiToolContent` 或 SFTP 工作台。
- 不为了追求行数下降做无语义 `utils` 拆分。
- 不把性能优化和当前 Apple-inspired UI lane 混合提交。
- 不在没有 profiling 或基线数据时宣称性能提升。

## 当前约束

- 当前 worktree 有 active lane：`lane-apple-inspired-ui-production-plan`。
- 该 lane 正在修改 `src/features/terminal/TerminalWorkspace.tsx`、`src/features/workspace/workspaceStore.ts`、`src/features/workspace/workspaceTerminalState.ts` 等终端/工作区共享文件。
- 本性能计划保持 `next` 状态；开始实现前必须登记新的 lane，优先使用独立 worktree/branch。
- 若必须和当前 UI lane 共用主 worktree，执行前先读取 `.updeng/docs/coordination/status.md`、`lanes.json`、对方计划、最新 diff，并把共享文件列入 `sharedPaths`。

## 已有性能基础

Kerminal 已经有一批性能保护，下一轮优化必须复用而不是推倒重来：

- `src/features/terminal/terminalOutputWriter.ts` 已有终端输出帧级批处理，默认每帧最多写入 `64 * 1024` 字符，并保证 `writeNow()` 先 flush 队列。
- `src/features/terminal/terminalOutputHistoryBuffer.ts` 已有 100ms 延迟 flush，避免每个 output event 都同步写 workspace store。
- `src/features/tool-panel/ToolPanel.tsx` 已对 SFTP、ServerInfo、Ports、Snippets、Logs、AI 等重面板做 lazy load。
- `src/app/KerminalShell.workspaceSelectors.ts` 已经在 ToolPanel snapshot 中剔除 `lines/outputHistory`，说明“高频字段不进入大范围订阅”是现有可复用模式。
- `package.json` 已有 `perf:frontend-bundle`、`perf:rust-timings`、`check:terminal-ghost`、`verify:command-suggestion-latency` 等基础验证入口。
- `.updeng/docs/plan/done/2026-06-18-terminal-output-throughput.md` 已记录终端输出吞吐保护，不重复实现该切片。
- `.updeng/docs/reports/2026-06-20-code-quality-architecture-performance-research.md` 已识别 React re-render、大列表、xterm 吞吐、SFTP transfer events、SQLite Mutex、bundle 和 Rust release profile 等候选。

## 当前证据

| 方向 | 当前代码证据 | 风险判断 |
| --- | --- | --- |
| xterm 写入 | `terminalOutputWriter.ts` 已帧级批量写入，`XtermPane.runtime.ts` 使用 `outputWriter.write(event.data)` | xterm 写入不是唯一瓶颈，不能只继续调大 batch |
| 输出附带处理 | `XtermPane.runtime.ts` 的 `handleOutput` 同步做 cwd OSC 解析、command block append、output history append、remote suggestion prewarm | 大输出时附带逻辑可能比写入本身更影响主线程 |
| workspace 高频更新 | `updatePaneOutputHistoryState` 每次 history 变化都会 map `terminalPanes` 并替换目标 pane | `TerminalWorkspace`/store 订阅可能被 output history 间接触发 |
| session 持久化 | `useWorkspaceSessionPersistence` 订阅整个 workspace store，每次变更都构建完整 session snapshot | 高频 output/currentCwd 变化会带来不必要 snapshot 构建 |
| AI streaming | `AiToolContent.tsx` 的 `onDelta` 每个 delta 都 `setConversationState`，随后 `persistConversationState` 监听整个 state 写 localStorage | streaming 时可能产生大量 React render 和 localStorage 序列化 |
| SFTP/本地列表 | `SftpBrowserView.tsx`、`LocalTransferPane.tsx` 直接 map `visibleEntries` | 大目录上千项时会卡 UI |
| 主机侧栏 | `MachineSidebar.tsx` 直接 map `visibleGroups` 和 `group.machines` | 大量主机/容器时需要 windowing 或分组虚拟化 |
| 后台刷新 | `useSftpTransferQueueSync.ts` 事件通道和 900ms polling 并存；`useServerInfoSnapshot.ts` 默认 3s force refresh | 后台/不可见时应降频或暂停 |
| Rust 终端后端 | `terminal_manager.rs` 每 session reader thread、8KB read buffer、64KB context buffer、write 每次 flush | 当前可接受；只有压测证明后才优化 |
| 基线路径 | `scripts/report-frontend-bundle.mjs` 默认写 `.updeng/data/verification`，当前文档体系要求 `.updeng/docs/verification` | 性能基线位置不统一，影响复用 |
| release profile | `src-tauri/Cargo.toml` 无 `[profile.release]` | 可做体积/启动优化，但必须单独验证 updater/打包 |

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 终端输出 | 是 | `src/features/terminal/XtermPane.runtime.ts`、`terminalOutputWriter.ts`、`terminalOutputHistoryBuffer.ts` | terminal output harness、`npm run check:terminal-ghost`、Tauri 大输出 smoke |
| Workspace store | 是 | `src/features/workspace/workspaceStore.ts`、`workspaceTerminalState.ts`、`src/app/KerminalShell.workspaceBridge.tsx` | workspace store tests、TerminalWorkspace tests、React profiler |
| 会话持久化 | 是 | `src/app/useWorkspaceSessionPersistence.ts`、`workspaceSession.ts` | persistence tests、restore/session snapshot tests |
| AI 面板 | 是 | `src/features/tool-panel/AiToolContent.tsx`、`aiToolContentModel.ts` | AI streaming fake tests、AI panel UI smoke |
| SFTP/本地文件 | 是 | `SftpBrowserView.tsx`、`LocalTransferPane.tsx`、SFTP transfer queue sync | SFTP component tests、大目录 smoke |
| 主机侧栏 | 是 | `MachineSidebar.tsx`、`MachineSidebar.parts.tsx` | sidebar tests、大量 host fixture |
| 后台轮询 | 是 | `useSftpTransferQueueSync.ts`、`useServerInfoSnapshot.ts` | fake timer tests、visibility tests |
| Rust 后端 | 可能 | `terminal_manager.rs`、`ssh_terminal_service.rs`、`sqlite.rs`、`Cargo.toml` | Rust tests、cargo timings、Tauri smoke |
| 文档/验证 | 是 | `.updeng/docs/verification`、`scripts/report-frontend-bundle.mjs` | report path check、bundle baseline diff |

## 执行总原则

- 每个优化先定义不变量，再改代码。
- 性能优化不得牺牲使用体验：用户可见的手动刷新、点击、拖拽、选择、打开目录、恢复可见后的状态追赶必须优先；后台降频只能减少无感负载，不能让前台状态长期 stale 或交互变迟钝。
- 每个切片都要有 baseline、改动、验证、回滚。
- 高频路径优先用小模型、facade、adapter 和可注入 scheduler 测试，不把逻辑继续堆到 React 组件里。
- 对 React 性能，优先减少订阅和状态传播范围，其次才使用 `memo/useMemo/useCallback`。
- 对终端输出，不能破坏输出顺序、状态提示顺序、cwd 同步可见性、command block marker、ghost suggestion、close/reconnect 语义。
- 对 session 持久化，不能丢失用户工作区恢复所需字段。
- 对 AI streaming，不能丢 delta、不能错乱 pending invocation、不能把最终消息持久化成半截。
- 对 SFTP/文件列表，不能破坏选择、拖拽、右键菜单、键盘可达性和 light/dark/system 主题。

## 生产验收指标

### 必须量测

| 指标 | 目标 | 采集方式 |
| --- | --- | --- |
| Terminal 大输出 main-thread long task | 明显减少，且无输出乱序 | Chrome DevTools Performance / 自定义 harness |
| Terminal output history store update 次数 | 从每 100ms 高频传播收敛到只影响必要订阅 | store instrumentation / test spy |
| Workspace session snapshot 构建次数 | 高频 output 下不随每次 store 变更构建完整 snapshot | unit test fake store + profiler |
| AI streaming render 次数 | delta burst 下从每 delta 更新降到帧/时间窗级更新 | fake stream test + React Profiler |
| SFTP 1000/5000 entry 列表交互 | 滚动和选择不卡顿，无超量 DOM nodes | Playwright/Chrome Performance |
| Bundle baseline | 输出到 `.updeng/docs/verification`，可比较 largest assets | `npm run perf:frontend-bundle` |
| Rust build timings | 生成 cargo timings，记录 release profile 前后 | `npm run perf:rust-timings` |

### 不可退化

- `npm run build` 必须通过。
- 涉及终端路径时 `npm run check:terminal-ghost` 必须通过。
- 涉及 Rust/Tauri/session/open terminal 时 `npm run tauri:dev` 必须真实启动或记录不可运行原因。
- 涉及 UI/list/portal 时必须有 light/dark/system 截图或明确说明非 UI 切片。
- 不允许把 `src-tauri/tauri.conf.json` 的 `app.security.freezePrototype` 改回 `true`。

## 分阶段实施

### P0：建立性能基线和压测 harness

目标：

- 先建立可重复反馈回路，后续所有优化都用同一组指标对比。
- 修正 bundle baseline 输出位置，统一到 `.updeng/docs/verification`。

任务：

- 修改 `scripts/report-frontend-bundle.mjs` 默认输出到 `.updeng/docs/verification/frontend-bundle-baseline.json`。
- 新增或整理 `scripts/perf-terminal-output.mjs`，用于在 dev/Tauri 环境模拟大输出、分块输出、长行输出、OSC cwd 输出。
- 为 AI streaming 增加 fake stream profiling harness：可配置 delta count、delta size、step event count。
- 为 SFTP/本地列表增加大目录 fixture：200、1000、5000 entries。
- 在 `.updeng/docs/verification/performance-baseline-YYYYMMDD.json` 记录初始基线。

验收：

- `npm run perf:frontend-bundle` 写入 `.updeng/docs/verification/frontend-bundle-baseline.json`。
- `npm run perf:rust-timings` 成功生成 cargo timings。
- 至少记录 terminal output、AI streaming、SFTP list 三类 baseline。
- 本切片不宣称性能提升，只交付量测能力。

回滚：

- 保留旧 `--output` 参数兼容；默认路径回滚不影响用户功能。

### P1：终端输出附带处理 profiling 和节流

目标：

- 保留现有 output writer 顺序语义，降低每个 output event 上的同步附带处理成本。

任务：

- 给 `handleOutput` 的子步骤加可开关 instrumentation：
  - `collectCurrentDirOscSequences`
  - `appendCommandBlockOutput`
  - `outputWriter.write`
  - `outputHistoryBuffer.append`
  - `remoteSuggestionPrewarm.scheduleGit`
  - `remoteSuggestionPrewarm.scheduleRemotePath`
- 基于数据决定优化点：
  - cwd OSC 只在匹配 OSC 序列时解析，普通输出走快路径。
  - command block output append 按帧或按 chunk 合并，但必须保持 marker 范围正确。
  - remote suggestion prewarm 对 cwd 变化做 debounce/coalesce。
  - output history buffer 从“每 append 拼接完整字符串”改为 pending chunks + flush 时合并，但必须保持 `outputHistoryRef.current` 的同步可见性要求；如果无法证明，先不落地。

验收：

- `terminalOutputWriter.test.ts`、`terminalOutputHistoryBuffer.test.ts`、`XtermPane` 相关测试通过。
- `npm run check:terminal-ghost` 通过。
- Tauri 大输出 smoke：`yes`/`seq 1 100000`/长日志输出不乱序、不丢关闭提示。
- 性能报告记录优化前后 long task 和 dropped frame 对比。

回滚：

- instrumentation 用 feature flag 或 dev-only logger 包住，可单独关闭。
- 每个子优化单独提交，失败时回滚该子模块，不影响 output writer。

### P2：Workspace 高频字段隔离

目标：

- 把 `outputHistory`、`lines`、部分 `currentCwd` 这类高频字段从主 `TerminalWorkspace` 大范围订阅中拆出。

任务：

- 复用 `buildToolPanelWorkspaceSnapshot` 的模式，设计 `buildTerminalWorkspaceSnapshot`：
  - 只包含 active tab layout、pane stable metadata、focused pane id、broadcast draft、tab group preferences。
  - 不包含 `outputHistory` 和 `lines`。
  - `currentCwd` 只在 UI 实际展示需要时进入局部订阅。
- `WorkspaceTerminalSurface` 使用 `useSyncExternalStore` 或 Zustand selector + equality 订阅稳定 snapshot。
- `TerminalPaneCard`/`XtermPane` 需要 history/cwd 时通过 pane-scoped callback 或局部 store selector 读取。
- 更新 `updatePaneOutputHistoryState` 的调用链，确保 history flush 不触发整个 workspace shell 无意义重渲染。

验收：

- `workspaceStore.terminalTabs.test.ts`、`TerminalWorkspace.test.tsx`、`TerminalWorkspace.broadcast.test.tsx` 通过。
- React Profiler 证明 output burst 时 `KerminalShell`、`TerminalWorkspace` render 次数下降。
- Terminal close、split、broadcast、target selector、session restore 行为不变。

回滚：

- 保留原 `WorkspaceTerminalSurface` props 接口一轮，必要时切回完整 `terminalPanes` 传递。

### P3：Workspace session persistence 降频和字段分层

目标：

- 让 workspace session 持久化只保存恢复所需的稳定字段，不在每次高频 store 变更时构建完整 snapshot。

任务：

- 拆分 session snapshot 字段：
  - stable：tabs、pane metadata、layout、selectedMachine、settings-like preferences。
  - volatile：outputHistory、currentCwd、latency、connection state。
- 修改 `useWorkspaceSessionPersistence` 订阅逻辑：
  - 用 stable snapshot key 判断是否需要重新构建。
  - 高频 volatile 字段用独立 debounce 或只在 pagehide/关闭时 flush。
  - outputHistory 可单独限制为 active/recent panes，避免保存所有 pane 长历史。
- 补齐测试：
  - outputHistory burst 不重复构建完整 session。
  - close/pagehide 仍能保存最终必要字段。
  - restore 后 pane target、cwd、tab layout 保持兼容。

验收：

- `useWorkspaceSessionPersistence.test.ts` 和 `workspaceSession.test.ts` 通过。
- 大输出期间 localStorage/session storage 写入次数明显下降。
- 手动关闭/刷新后 workspace 可恢复。

回滚：

- 保留旧 snapshot builder 作为兼容 fallback；若 restore 出现回归，先回滚订阅策略。

### P4：AI streaming batching 和持久化 debounce

目标：

- 避免 AI token streaming 每个 delta 都触发 React tree 更新和 localStorage 序列化。

任务：

- 新增 `aiStreamingMessageBuffer` 或等价 model：
  - 收集 delta。
  - 每 animation frame 或 32-50ms 合并一次写入 state。
  - final response 到达时强制 flush。
  - error/cancel 时强制 flush 并保持状态一致。
- `persistConversationState` 改为 debounced persistence：
  - streaming 中只定期保存或只保存 final。
  - pending invocation、tool step、error 等关键事件立即或短 debounce 保存。
- `AiToolContent.tsx` 只接线 buffer，复杂逻辑下沉到 model/hook。
- 同步检查 `AiThreadViewport` 的 message lookup，必要时用 id map 避免 render 中重复 find。

验收：

- fake stream 测试覆盖 1000 delta burst，不丢内容、最终内容一致。
- tool step 和 pending invocation 顺序不变。
- `AiToolContent` 相关测试通过。
- AI panel dev smoke：streaming 时 UI 连续更新但不明显卡顿。

回滚：

- buffer 层可通过 flag 切回逐 delta 更新。
- persistence debounce 可单独回滚，不影响 UI streaming。

### P5：SFTP、本地文件和主机侧栏虚拟化

目标：

- 大目录、大主机树场景下减少 DOM 节点数量和 render 压力。

任务：

- 优先选定虚拟化方案：
  - 轻量自研 fixed-row windowing；或
  - 引入成熟库前先评估 bundle 成本。
- `SftpBrowserView` 和 `LocalTransferPane` 先做统一 `VirtualEntryList`：
  - 保持 row height 稳定。
  - 选择、右键、拖拽、预览、双击打开行为不变。
  - 空态、loading、error header 不被虚拟化影响。
- `MachineSidebar` 后续按组虚拟化：
  - 常规主机数量小于阈值时保持当前直接渲染。
  - 超过阈值启用 windowing。
  - collapsed sidebar 和拖拽状态兼容。

验收：

- SFTP 1000/5000 entries fixture 滚动无明显卡顿。
- DOM node count 随 viewport 而不是 entry count 增长。
- SFTP/right-click/drag/drop/selection tests 通过。
- light/dark/system 截图检查虚拟列表 hover/selected/focus 状态。

回滚：

- 虚拟列表按 feature flag 或阈值启用；出问题可提高阈值到无限，恢复直接 map。

### P6：后台刷新和事件同步降噪

目标：

- 让后台轮询按可见性、active tool、事件通道健康状态动态降频。

任务：

- `useSftpTransferQueueSync`：
  - 初始 load 保留。
  - Tauri event channel 可用且最近收到事件时，polling 降频或暂停。
  - event channel 不可用或长时间无事件时恢复 polling。
  - app hidden 时降低频率。
- `useServerInfoSnapshot`：
  - 默认 refresh interval 从 3s 评估为 5s/10s 或手动优先。
  - panel 不可见时暂停。
  - document hidden 时暂停或降频。
  - force refresh 仍可手动触发。
- 增加 fake timer 和 visibility tests。

验收：

- SFTP 传输进行中时事件更新仍及时。
- event channel 失败后 polling fallback 可用。
- ServerInfo 面板关闭/隐藏时不继续 3s force refresh。
- 不破坏用户手动刷新。

回滚：

- 保留 polling fallback 常开配置；如果事件通道异常，恢复原 900ms polling。

### P7：Rust 后端和发布 profile 定点优化

目标：

- 只在数据证明需要时优化 Rust 终端/SQLite/发布 profile，避免无意义地改底层稳定代码。

任务：

- 终端后端：
  - 压测 `terminal_manager.rs` reader thread、8KB buffer、Channel event 发射开销。
  - 如瓶颈明显，再评估增大 read buffer 或批量 Channel event。
  - `write()` 当前每次 flush，只有 bulk write 场景数据证明后才改。
- SQLite：
  - 记录 AI audit/history、workspace persistence、高频写入的锁等待。
  - 如出现 contention，再评估 write queue、`spawn_blocking`、读写连接拆分。
- release profile：
  - 建立 baseline：installer size、app startup smoke、updater 验证。
  - 评估 `[profile.release]`：`lto`、`strip`、`panic = "abort"`、`codegen-units`、`opt-level`。
  - 每个 profile 改动都必须跑 Tauri build 或至少 debug/no-bundle 替代验证，并记录 updater 兼容性。

验收：

- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test -j 1`
- `npm run tauri:dev`
- 如改 release profile：`npm run tauri:build` 或明确不可运行原因。

回滚：

- Rust profile 改动单独提交；发现打包/updater 异常直接回滚 profile。
- TerminalManager 底层读写改动必须保持旧实现可恢复。

## 推荐执行顺序

1. P0 性能基线和 harness。
2. P2 workspace 高频字段隔离。
3. P3 session persistence 降频。
4. P4 AI streaming batching。
5. P1 terminal 附带处理 profiling 后的定点节流。
6. P5 SFTP/本地列表虚拟化。
7. P6 后台刷新降噪。
8. P7 Rust/release profile。

说明：

- P2/P3/P4 是最可能改善日常体感的前端高频路径。
- P1 涉及终端运行时语义，必须在 P0 有数据后再动。
- P5/P6 可以和 P2/P3 分 lane 并行，但必须避开当前 UI lane 的共享文件。
- P7 放最后，除非 P0 明确 Rust 后端是主瓶颈。

## 计划任务清单

- [x] TASK-001：创建性能基线与 benchmark harness，修正 bundle baseline 输出目录。
- [x] TASK-002：建立终端大输出 profiling 报告，不改行为。
- [x] TASK-003：拆出 terminal workspace stable snapshot，隔离 outputHistory/lines 高频字段。
- [x] TASK-004：重构 workspace session persistence 订阅和 snapshot 分层。
- [x] TASK-005：实现 AI streaming delta buffer 和 conversation persistence debounce。
- [x] TASK-006：根据 profiling 结果优化终端 output 附带处理。
- [x] TASK-007：实现 SFTP/LocalTransferPane 虚拟列表第一版。
- [x] TASK-008：实现 SFTP queue 与 ServerInfo refresh 可见性/事件健康 gating。
- [x] TASK-009：评估 MachineSidebar 大量主机虚拟化。
- [x] TASK-010：评估 Rust terminal/SQLite/release profile 优化。
- [x] TASK-011：全链路性能回归、真实启动、截图和收口报告。

## 每轮 Round Log 要求

每个任务完成时必须追加：

- 实际修改文件。
- 保持不变的行为契约。
- 新增或更新测试。
- 验证命令和结果。
- 性能前后对比数据。
- 未落地候选和原因。
- checkpoint 或 commit SHA。
- 若写入 shared path，同步了哪个 lane 的哪个 checkpoint/diff。

## 启动条件

- 当前 Apple-inspired UI active lane 收口，或为本性能计划创建独立 worktree/branch。
- 开始实现前登记 `lane-kerminal-performance-optimization` 或等价 lane。
- 首个实现任务只做 TASK-001，不直接改高频运行时代码。

## Round Log

### 2026-06-23 Round 1：TASK-001 并行基线启动

状态：已完成；本轮只落地 TASK-001，不进入终端、Workspace、AI、SFTP 运行时代码优化。

输入：

- 用户要求采用 subagent 并行开发落地本性能优化生产级计划。
- 当前同 worktree 已有 `lane-apple-inspired-ui-production-plan`，其 owned/shared paths 覆盖终端和 workspace 热点文件。

本轮约束：

- 新增 `lane-kerminal-performance-optimization`，首轮 owned paths 限定在计划文档、协作台账、性能报告脚本和 verification 输出。
- 与 Apple UI lane 共享 `.updeng/docs/coordination/lanes.json`、`.updeng/docs/plan/INDEX.md`、`.updeng/docs/in-progress.md`，只做追加式同步。
- TASK-001 只修正 bundle baseline 默认输出目录，并收集 terminal output、AI streaming、SFTP list baseline harness 设计；不宣称性能提升。

并行任务：

- Worker：修正 `scripts/report-frontend-bundle.mjs` 默认输出目录并做最窄脚本验证。
- Explorer：调研 terminal output baseline harness 设计和后续 TASK-002 边界。
- Explorer：调研 AI streaming 与 SFTP/Local 大列表 baseline fixture 设计和后续任务边界。

实际修改文件：

- `scripts/report-frontend-bundle.mjs`：默认输出从 `.updeng/data/verification/frontend-bundle-baseline.json` 切到 `.updeng/docs/verification/frontend-bundle-baseline.json`，保留 `--output` 兼容。
- `scripts/perf-terminal-output.mjs`：新增 headless Chrome + real `@xterm/xterm` 输出基线，覆盖 `plain / osc / long-line / mixed`，记录 write callback、frame gap、long task、heap 和模拟附带处理指标。
- `scripts/perf-ai-streaming.mjs`：新增 AI streaming baseline，模拟当前逐 delta state update 和逐次持久化成本。
- `scripts/perf-directory-list.mjs`：新增 SFTP/Local 大目录 jsdom baseline，生成 200 / 1000 / 5000 entries 并记录直接 DOM 渲染成本。
- `scripts/perf-collect-baseline.mjs`：新增汇总脚本，聚合 bundle、AI、directory、terminal baseline 和最新 cargo timing HTML 路径。
- `package.json`：新增 `perf:terminal-output`、`perf:ai-streaming`、`perf:directory-list`、`perf:collect-baseline`、`perf:baseline`。
- `.updeng/docs/verification/frontend-bundle-baseline.json`
- `.updeng/docs/verification/perf-ai-streaming-baseline.json`
- `.updeng/docs/verification/perf-directory-list-baseline.json`
- `.updeng/docs/verification/terminal-output-baseline.json`
- `.updeng/docs/verification/performance-baseline-20260623.json`

保持不变的行为契约：

- 不修改 `XtermPane.runtime.ts`、workspace store、AI 面板、SFTP/LocalTransferPane 或 MachineSidebar 运行时代码。
- 不改变终端输出顺序、history、cwd、command block、AI streaming、SFTP 选择/拖拽/右键行为。
- `report-frontend-bundle.mjs --output <path>` 仍可覆盖默认输出路径。

验证结果：

- `node scripts/perf-ai-streaming.mjs --deltas 20 --delta-size 8 --steps 2 --output .updeng/docs/verification/perf-ai-streaming-smoke.json`：通过；临时 smoke JSON 已清理。
- `node scripts/perf-directory-list.mjs --counts 10,20 --targets sftp,local --output .updeng/docs/verification/perf-directory-list-smoke.json`：通过；临时 smoke JSON 已清理。
- `node scripts/perf-terminal-output.mjs --scenario plain --chunks 5 --chunk-size 256 --output .updeng/docs/verification/terminal-output-smoke.json`：通过；临时 smoke JSON 已清理。
- `npm run perf:ai-streaming`：通过，1000 deltas / 1020 state updates / 1020 persistence writes / 11.20ms。
- `npm run perf:directory-list`：通过，6 runs，最大 140.71ms，最大 5000 DOM nodes。
- `npm run perf:terminal-output`：通过，4 scenarios，最大 frame gap 16.70ms，最大 long task 0.00ms。
- `npm run perf:frontend-bundle`：通过；`npm run build` 成功，125 assets，15.65 MiB raw，3.86 MiB gzip，报告写入 `.updeng/docs/verification/frontend-bundle-baseline.json`。
- `npm run perf:rust-timings`：未完全通过；Windows 上 `src-tauri/target/debug/kerminal.exe` 被占用导致 cargo 无法替换二进制，错误为 `failed to remove file ... os error 5`，但仍生成 timing report `src-tauri/target/cargo-timings/cargo-timing-20260623T114315588Z-122bdcd98055b800.html`。
- `cd src-tauri; cargo build --timings --lib`：通过，0.86s，生成 `src-tauri/target/cargo-timings/cargo-timing-20260623T114349694Z-122bdcd98055b800.html`。
- `npm run perf:collect-baseline`：通过，汇总报告写入 `.updeng/docs/verification/performance-baseline-20260623.json`。
- `git diff --check`：通过；仅有 Windows CRLF 提示，无 whitespace error。

性能基线摘要：

- Frontend bundle：最大资产仍是 `ts.worker`、`RemoteWorkspaceEditor`、`css.worker`、`bootstrap`、`mermaid`，后续 bundle 优化可单独开切片。
- AI streaming：当前逐 delta 模拟会产生与 delta 数同级的 state updates 和 persistence writes，TASK-005 可用该报告对比 batching 后写入次数下降。
- Directory list：5000 entry 直接 DOM 渲染会产生 5000 rows，TASK-007 可用该报告对比虚拟化后 DOM node count 是否随 viewport 收敛。
- Terminal output：headless xterm baseline 已能覆盖 OSC、长行和 mixed 输出；真实 `handleOutput` 子步骤 instrumentation 留给 TASK-002。

未落地候选和原因：

- 未给 `XtermPane.runtime.ts` 加 instrumentation：该项属于 TASK-002，不能和 TASK-001 基线脚本混在一轮。
- 未改 AI streaming buffer / persistence debounce：属于 TASK-005，需要行为测试锁定 delta、pending invocation、error/cancel 顺序。
- 未改 SFTP/Local 虚拟列表：属于 TASK-007，需要 UI 行为、拖拽、右键、主题截图验证。
- 未强杀占用 `kerminal.exe` 的进程：属于本机运行态外部副作用，当前用 lib-only cargo timings 替代并记录原命令失败原因。

共享 lane 同步：

- 已刷新 `.updeng/docs/coordination/status.md`，当前 `lane-apple-inspired-ui-production-plan` 与本 lane 仅共享 `.updeng/docs/coordination/lanes.json`、`.updeng/docs/plan/INDEX.md`、`.updeng/docs/in-progress.md`。
- 本轮未写入 Apple UI lane 的 terminal/workspace/machine-sidebar owned files；当前工作区里这些文件的新增/修改不归属于本性能切片。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。
- 已生成 checkpoint：
  - `.updeng/docs/coordination/checkpoints/lane-kerminal-performance-optimization.json`
  - `.updeng/docs/coordination/checkpoints/lane-kerminal-performance-optimization.patch`
  - `.updeng/docs/coordination/checkpoints/lane-kerminal-performance-optimization.untracked.json`

### 2026-06-23 Round 2：TASK-002 终端大输出 profiling 报告

状态：已完成；本轮只生成终端大输出 profiling 报告，不修改 `src/` 运行时代码。

输入：

- TASK-001 已生成 `.updeng/docs/verification/terminal-output-baseline.json` 和 `.updeng/docs/verification/performance-baseline-20260623.json`。
- TASK-002 要求“建立终端大输出 profiling 报告，不改行为”。

并行任务：

- Explorer：复核 TASK-002 边界，结论是不做功能性运行时代码修改；如后续必须加 instrumentation，只能默认关闭且不改变 `handleOutput` 当前顺序。
- Worker：新增终端输出 profiling Markdown 报告生成脚本，不触碰 Apple UI lane 的 terminal/workspace/machine-sidebar 文件。

实际修改文件：

- `scripts/perf-terminal-output-report.mjs`：新增报告生成脚本，从 terminal baseline / performance baseline JSON 读取数据，输出 Markdown profiling 报告。
- `package.json`：新增 `perf:terminal-report`。
- `.updeng/docs/reports/terminal-output-profiling-20260623.md`：新增 TASK-002 profiling 报告。

保持不变的行为契约：

- 不修改 `XtermPane.runtime.ts`、`terminalOutputWriter.ts`、`terminalOutputHistoryBuffer.ts` 或任何终端运行时代码。
- 不改变 `handleOutput` 顺序：cwd OSC 解析、command block append、`outputWriter.write`、`outputHistoryBuffer.append`。
- 不改变 terminal output ordering、cwd sync、command block marker、ghost suggestion prewarm、close/reconnect message 和 history visibility。

验证结果：

- `npm run perf:terminal-report`：通过，输出 `.updeng/docs/reports/terminal-output-profiling-20260623.md`。
- `git diff --check`：通过；仅有 Windows CRLF 提示，无 whitespace error。

profiling 报告摘要：

- 场景输入：`plain / osc / long-line / mixed`，每场景 400 chunks，chunk size 4096，`maxCharsPerFlush` 65536，viewport 1280x860。
- 当前 baseline pass：yes。
- 最坏 write callback p95：`plain` 6.70ms；最坏 write callback max：`plain` 11.60ms。
- 最坏 frame gap：16.70ms；long task ceiling：0ms。
- side-effect pressure：cwd OSC paths 440，remote prewarm schedules 440，history flushes 32，command block tail cap 20000 chars。

未落地候选和原因：

- 未加 `handleOutput` runtime instrumentation：TASK-002 本轮报告已经能从现有 baseline 建立第一份 profiling 证据；真实子步骤 instrumentation 应作为 TASK-006 前的受控准备，必须默认关闭且有 no-op 证明。
- 未做 cwd OSC 快路径、prewarm coalesce、command block batching、history pending chunks：这些都属于 TASK-006 行为优化候选，不能提前混入“报告不改行为”切片。
- 未运行 `npm run check:terminal-ghost` / `npm run build`：本轮没有修改运行时代码；上一轮 `perf:frontend-bundle` 已跑过 build。若后续 TASK-006 修改终端路径，必须补 `check:terminal-ghost` 和 build。

共享 lane 同步：

- 本轮未写入 Apple UI lane 的 terminal/workspace/machine-sidebar owned files。
- 本轮只新增性能 lane 文件和报告，后续更新 `.updeng/docs/coordination/lanes.json`、`.updeng/docs/plan/INDEX.md`、`.updeng/docs/in-progress.md` 时继续按 shared path 最小合并。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。

### 2026-06-23 Round 3：TASK-003 terminal workspace stable snapshot

状态：已完成；本轮只落地 TASK-003，不修改 session persistence、AI streaming、终端附带处理或虚拟列表。

输入：

- TASK-003 要求拆出 terminal workspace stable snapshot，隔离 `outputHistory/lines` 高频字段。
- 当前 worktree 仍有 `lane-apple-inspired-ui-production-plan`，其 owned paths 覆盖 `TerminalWorkspace.tsx`、`TerminalWorkspaceContent.tsx`、`KerminalShell.workspaceBridge.tsx`、`workspaceStore.ts`、`workspaceTerminalState.ts` 和 split/drop/broadcast 相关测试。

并行任务：

- Explorer A：只读同步 Apple UI lane checkpoint/diff，确认必须保留 broadcast target selector、split target selector、drag-to-split、`targetMachineId`/`placement`、production target inline warning 等契约。
- Explorer B：只读梳理 workspace/terminal 高频订阅数据流，确认 `updatePaneOutputHistoryState()` 仍会替换 `terminalPanes`，本轮应优先让 `WorkspaceTerminalSurface` 订阅去掉 `lines/outputHistory` 的稳定 snapshot，并把恢复历史通过 pane-scoped resolver 补回运行时。

实际修改文件：

- `src/app/KerminalShell.workspaceSelectors.ts`：新增 `buildTerminalWorkspaceSnapshot()` / `parseTerminalWorkspaceSnapshot()`，terminal workspace snapshot 排除 `lines/outputHistory`，并复用未变化的 pane/tab/preferences 引用，避免 active/focus 切换造成已挂载 terminal 子树抖动。
- `src/app/KerminalShell.workspaceBridge.tsx`：`WorkspaceTerminalSurface` 改为通过 `useSyncExternalStore` 订阅稳定 terminal workspace snapshot；新增 `resolvePaneLines()` / `resolvePaneOutputHistory()` 局部 resolver，保留 Apple lane 的 `machineGroups`、`splitDropIndicator` 和 split/broadcast props。
- `src/features/terminal/TerminalWorkspace.tsx`、`TerminalWorkspaceContent.tsx`、`TerminalPaneLayout.tsx`：透传 resolver，不改变 split/drop/broadcast 行为。
- `src/features/terminal/TerminalPaneCard.tsx`：runtime pane 使用 resolver 为 `XtermPane` 提供初始 `outputHistory`，preview pane 使用 resolver 恢复 stripped `lines`。
- `src/features/terminal/XtermPane.tsx`：新增 `resolveInitialOutputHistory`，仅用于初始化 `outputHistoryRef`；常规 `outputHistory` prop 路径保持原行为。
- `src/app/KerminalShell.workspaceSelectors.test.ts`：新增 terminal workspace snapshot 隔离和引用复用测试。
- `src/features/terminal/TerminalPaneCard.test.tsx`：新增 stripped runtime/preview pane resolver 测试。
- `src/features/terminal/XtermPane.test.tsx`：新增 stable snapshot resolver 历史回放测试。
- `.updeng/docs/verification/performance-task003-dev-smoke.png`：5177 dev server + headless Chrome/CDP smoke 截图。

保持不变的行为契约：

- 不修改 `updatePaneOutputHistoryState()` 的 store 写入语义；`outputHistory` 仍写入 store 并能进入 workspace session，TASK-004 再处理 session persistence 降频。
- 不改变终端输出顺序、历史回放、关闭/重连、command block、ghost suggestion 或 cwd 上报语义。
- 不改变 Apple UI lane 的 split/drop/broadcast 行为：broadcast target 仍来自 active tab layout + broadcastable pane modes；split 仍支持不同主机目标；drag-to-split overlay 和 `splitDropIndicator` 继续透传。
- `currentCwd` 本轮仍保留在 terminal workspace stable pane 中；是否进一步隔离留给后续 profiling/切片，避免一次性扩大 blast radius。

新增/更新测试：

- `KerminalShell.workspaceSelectors.test.ts` 覆盖 `outputHistory/lines` 变化不改变 terminal workspace snapshot，解析后 stripped pane 不含 `outputHistory`，并且 active/focus only 变化复用 pane/tab 引用。
- `TerminalPaneCard.test.tsx` 覆盖 stripped runtime pane 能通过 resolver 恢复初始 history，stripped preview pane 能通过 resolver 恢复 lines。
- `XtermPane.test.tsx` 覆盖 `resolveInitialOutputHistory` 可回放恢复历史并继续 append 新输出。

验证结果：

- `npm run test:frontend -- src/app/KerminalShell.workspaceSelectors.test.ts src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/XtermPane.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/terminal/terminalSplitTargets.test.ts src/features/terminal/terminalSplitDropZones.test.ts src/features/terminal/TerminalWorkspace.dropOverlay.test.tsx src/features/machine-sidebar/MachineSidebar.externalDrag.test.tsx src/features/workspace/workspaceStore.terminalTabs.test.ts src/app/KerminalShell.splitDrop.test.tsx src/app/KerminalShell.test.tsx`：通过，12 files / 132 tests。
- `npm run typecheck`：通过。
- `npm run build`：通过；仍有既有 Vite large chunk warning。
- `npm run perf:terminal-output`：通过，4 scenarios，max frame gap 16.70ms，max long task 0.00ms；本轮不是终端写入优化，baseline 指标预期不变。
- `git diff --check`：通过；仅 Windows CRLF 提示。
- 真实 dev server smoke：`npm run dev -- --host 127.0.0.1 --port 5177 --strictPort` 启动通过；headless Chrome/CDP 打开 `http://127.0.0.1:5177/`，无 error overlay/runtime log，body 出现 `光标还没闪...`，截图写入 `.updeng/docs/verification/performance-task003-dev-smoke.png`。

性能前后对比数据：

- Selector 级证明：`outputHistory/lines` only 变化时，`buildTerminalWorkspaceSnapshot()` 输出保持不变，`WorkspaceTerminalSurface` 的 `useSyncExternalStore` 不会因 terminal history flush 收到新 snapshot。
- UI 级回归：`KerminalShell.test.tsx` 的 shell 隔离用例仍通过，`updatePaneOutputHistory()` 后 titlebar render count 不增加；恢复两个 terminal tab 后切换 tab 不重新创建 terminal session。
- 终端输出 baseline：`perf:terminal-output` 保持 max frame gap 16.70ms / max long task 0.00ms；真实 terminal 附带处理优化留到 TASK-006。

未落地候选和原因：

- 未改 `useWorkspaceSessionPersistence`：属于 TASK-004，需要 stable/volatile session snapshot 分层和 restore/pagehide 测试。
- 未隔离 `currentCwd`：该字段仍影响 terminal workspace snapshot；本轮先锁定 `lines/outputHistory` 两个大字段，避免影响工具面板 cwd、terminal chrome 和 session 恢复语义。
- 未修改 `updatePaneOutputHistoryState()` 数据结构：该函数仍 map/replace `terminalPanes`，但主 workspace surface 已不再订阅大字段变化；更深的 store 分层需要单独设计。

共享 lane 同步：

- 开始前已读取 `lane-apple-inspired-ui-production-plan` checkpoint 和 `lanes.json`，并由 Explorer A 复核 Apple lane 行为契约。
- 本轮写入了 Apple lane owned/hot paths：`src/app/KerminalShell.workspaceBridge.tsx`、`src/features/terminal/TerminalWorkspace.tsx`、`src/features/terminal/TerminalWorkspaceContent.tsx`、`src/features/terminal/TerminalPaneLayout.tsx`；仅做 resolver/snapshot 兼容接线，未回滚或重写 Apple lane split/drop/broadcast 改动。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。
- checkpoint 将在本 Round Log 和 lane 台账更新后重新生成。

### 2026-06-23 Round 4：TASK-004 workspace session persistence 降频

状态：已完成；本轮只落地 TASK-004，不修改 AI streaming、终端写入器、SFTP 虚拟列表或后台轮询。

输入：

- TASK-004 要求重构 workspace session persistence 订阅和 snapshot 分层，避免高频 store 变更反复构建完整 session。
- Explorer C 只读探查指出一个关键竞态：真实终端输出会先进入 `outputHistoryRef`，100ms 后才经 `terminalOutputHistoryBuffer` 写入 workspace store；如果 `pagehide` 发生在这 100ms 内，直接从 store 构建 session 会漏掉最后一段输出。

实际修改文件：

- `src/app/useWorkspaceSessionPersistence.ts`：新增 stable key 分层，stable key 排除 `currentCwd/latencyMs/lines/outputHistory/status`；stable 变化立即构建完整 snapshot，volatile-only 变化只标 dirty，并在 debounce 保存或 pagehide/cleanup flush 时重建完整 session。
- `src/features/terminal/terminalOutputHistoryBuffer.ts`：新增 active buffer registry 和 `flushPendingTerminalOutputHistoryBuffers()`，只同步 flush 仍有 pending timer 的 terminal output history buffer；buffer dispose 时从 registry 移除。
- `src/app/useWorkspaceSessionPersistence.ts`：`flushWorkspaceSession()` 在从 store 构建 session 前先调用 pending terminal output history flush，保证 pagehide/cleanup 保存包含最新 terminal output history。
- `src/app/useWorkspaceSessionPersistence.test.ts`：新增 volatile-only debounce 写入节奏测试，以及 pagehide 早于 terminal buffer timer 时仍保存最后输出的回归测试。
- `src/features/terminal/terminalOutputHistoryBuffer.test.ts`：新增全局 pending buffer flush 与 disposed buffer unregister 测试。
- `src/features/workspace/workspaceSession.test.ts`：锁定 session restore 保留 `currentCwd/outputHistory/target/runtime config`，并明确 `lines` 归一为空数组。
- `.updeng/docs/verification/performance-baseline-20260623.json`：重新运行 `perf:collect-baseline` 后刷新汇总报告。

保持不变的行为契约：

- 不修改 `saveWorkspaceSession()` storage schema，不做 localStorage 迁移。
- `outputHistory`、`currentCwd` 仍会进入完整 session，刷新/关闭后可恢复。
- `lines` 仍不是 session restore 字段，normalize 后为空数组。
- `terminalOutputHistoryBuffer` 的 100ms coalesce 行为不变；新增的全局 flush 只在 pagehide/cleanup 等强制保存路径调用。
- 不改变 `XtermPane.runtime.ts` 的输出顺序、xterm write、command block、cwd OSC、ghost suggestion prewarm 或 close/reconnect 语义。

新增/更新测试：

- `useWorkspaceSessionPersistence.test.ts` 覆盖 stable key 不受 volatile 字段影响、volatile-only output burst 在 debounce 前不写 localStorage、debounce 后只保存最后值、pagehide 会先 flush pending terminal history buffer 再保存 session。
- `terminalOutputHistoryBuffer.test.ts` 覆盖 active pending buffers 的全局 flush、非 pending buffer 不被多余 flush、disposed buffer 不再被全局 flush。
- `workspaceSession.test.ts` 覆盖恢复字段保留和 `lines` 丢弃契约。

验证结果：

- `npm run test:frontend -- src/features/terminal/terminalOutputHistoryBuffer.test.ts src/app/useWorkspaceSessionPersistence.test.ts src/features/workspace/workspaceSession.test.ts`：通过，3 files / 22 tests。
- `npm run test:frontend -- src/app/KerminalShell.workspaceSelectors.test.ts src/app/useWorkspaceSessionPersistence.test.ts src/features/workspace/workspaceSession.test.ts src/features/workspace/workspaceStore.terminalTabs.test.ts src/features/terminal/terminalOutputHistoryBuffer.test.ts src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/XtermPane.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/app/KerminalShell.test.tsx`：通过，10 files / 139 tests。
- `npm run typecheck`：通过。
- `npm run perf:collect-baseline`：通过，报告写入 `.updeng/docs/verification/performance-baseline-20260623.json`。
- `git diff --check`：通过；仅 Windows CRLF 提示。
- `npm run build`：通过；仍有既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 5181 --strictPort`：Vite ready in 425ms；`Invoke-WebRequest http://127.0.0.1:5181/` 返回 HTTP 200；临时 dev server 已停止。

性能前后对比数据：

- 行为级证明：volatile-only `outputHistory` burst 下，`localStorage.setItem` 在 `WORKSPACE_SESSION_SAVE_DELAY_MS - 1` 前为 0 次，debounce 到点后为 1 次，且保存最终 `outputHistory`。
- 竞态修复证明：pending terminal buffer 未到 100ms timer 时触发 `pagehide`，保存的 session 已包含 `pending terminal output`。
- `perf:collect-baseline` 仍为 pass；本轮优化 persistence 写入和 pagehide 正确性，不改变 terminal output writer baseline。

未落地候选和原因：

- 未把 workspace store 拆成 session slice：当前 stable key + volatile dirty 已能减少完整 snapshot 构建；更深拆分会扩大 store 公共契约，留到后续 profiling 证明后再做。
- 未限制只保存 active/recent panes 的 `outputHistory`：该策略可能改变用户恢复历史范围，本轮保留完整兼容语义。
- 未进一步隔离 `currentCwd` 的 store 高频更新：需要结合 TASK-006 terminal output profiling 和 UI 展示语义另行评估。

共享 lane 同步：

- 本轮新增写入 `src/app/useWorkspaceSessionPersistence.ts`、`src/app/useWorkspaceSessionPersistence.test.ts`、`src/features/workspace/workspaceSession.test.ts`、`src/features/terminal/terminalOutputHistoryBuffer.ts` 和 `src/features/terminal/terminalOutputHistoryBuffer.test.ts`，这些将登记到性能 lane owned paths。
- 未写入 Apple UI lane 的 split/drop/broadcast shared runtime 文件；保留 TASK-003 已同步的 Apple UI 行为契约。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。
- 已重新生成 checkpoint：`.updeng/docs/coordination/checkpoints/lane-kerminal-performance-optimization.json`，覆盖 75 paths / 40 tracked patch paths。

### 2026-06-23 Round 5：TASK-005 AI streaming batching 和持久化 debounce

状态：已完成；本轮只落地 TASK-005，不修改终端输出、SFTP 虚拟列表、后台轮询或 Rust profile。

输入：

- TASK-005 要求降低 AI streaming 每个 delta 触发 React state 更新和 localStorage 序列化的压力。
- Rawls 只读复核指出旧路径中 `AiToolContent.tsx` 的 `onDelta` 每个 delta 都 `setConversationState`，随后整个 `conversationState` effect 会调用 `persistConversationState()`。
- Handoff 时已有半成品实现，但 broader AI regression 发现部分测试 mock 缺少新导出的 `listAiToolPendingInvocations()`，以及 shell 集成测试仍假设侧栏分组默认展开。

实际修改文件：

- `src/features/tool-panel/ai-tool-content/aiStreamingMessageBuffer.ts`：新增 AI streaming delta buffer，默认 32ms flush；`applyStep()` 会先 flush pending delta，final/error/cancel 路径可强制 flush，`dispose()` 会清理 timer 并忽略后续 delta。
- `src/features/tool-panel/ai-tool-content/aiStreamingMessageBuffer.test.ts`：覆盖 1000 delta coalesce、step 前 flush 顺序、dispose flush 后忽略输入。
- `src/features/tool-panel/ai-tool-content/useDebouncedConversationPersistence.ts`：新增 conversation persistence debounce，默认 250ms；`pagehide` 和 cleanup 会 flush 最新 state，final/error 可传入 explicit state 立即保存。
- `src/features/tool-panel/ai-tool-content/useDebouncedConversationPersistence.test.tsx`：覆盖 rapid state changes 只写一次 localStorage，以及 pagehide flush 最新 state。
- `src/features/tool-panel/AiToolContent.tsx`：`onDelta` 改为写入 streaming buffer，`onStep` 经 buffer 保证顺序；final/error 路径先 flush buffer，再用 immediate persistence 保存最终 state；移除逐 state change 的直接 `persistConversationState()` effect。
- `scripts/perf-ai-streaming.mjs`：保留旧 baseline，并新增 buffered AI streaming 场景，报告 state update / persistence write reduction。
- `src/features/tool-panel/AiToolContent.test.tsx`：本地持久化断言改为等待 debounce flush。
- `src/features/tool-panel/AiToolContent.persistence.test.tsx`、`src/features/tool-panel/AiToolContent.shell.test.tsx`、`src/features/tool-panel/AiToolContent.autoApproval.test.tsx`、`src/features/tool-panel/AiToolContent.pendingQueue.test.tsx`、`src/features/tool-panel/AiToolContent.imageOnly.test.tsx`：测试 mock 补齐 `listAiToolPendingInvocations()`，默认返回空数组。
- `src/features/tool-panel/AiToolContent.shell.test.tsx`：适配 Apple UI lane 的侧栏分组默认折叠行为，先展开 `bwy` 分组再断言初始 SSH 主机按钮。
- `.updeng/docs/verification/perf-ai-streaming-baseline.json`、`.updeng/docs/verification/performance-baseline-20260623.json`：重新运行性能脚本后刷新。

保持不变的行为契约：

- 不丢 streaming delta；final response 到达前先 flush pending delta。
- tool step / pending invocation 顺序不变；step 前先把已收到内容落到 assistant draft。
- error 路径保留已收到 delta，空内容时仍显示失败文案并保存 error 状态。
- pending invocation recovery 继续从后端恢复 pending 队列；测试 mock 只补齐生产 API 契约。
- 不改变 stored conversation schema，不做历史迁移。
- 不改变 shell 侧栏刷新逻辑；shell 测试只适配已有默认折叠交互。

新增/更新测试：

- `aiStreamingMessageBuffer.test.ts` 覆盖 1000 delta burst、step ordering、dispose flush。
- `useDebouncedConversationPersistence.test.tsx` 覆盖 debounce 写入和 pagehide flush。
- AI 面板 broader regression 覆盖 model、pending queue、history backend、persistence、auto approval、shell、image-only。

验证结果：

- `npm run test:frontend -- src/features/tool-panel/AiToolContent.persistence.test.tsx src/features/tool-panel/AiToolContent.shell.test.tsx`：通过，2 files / 12 tests。
- `npm run test:frontend -- src/features/tool-panel/ai-tool-content/aiStreamingMessageBuffer.test.ts src/features/tool-panel/ai-tool-content/useDebouncedConversationPersistence.test.tsx src/features/tool-panel/ai-tool-content/aiToolContentModel.test.ts src/features/tool-panel/ai-tool-content/aiPendingInvocationQueue.test.ts src/features/tool-panel/ai-tool-content/aiConversationPersistence.test.ts src/features/tool-panel/AiToolContent.test.tsx src/features/tool-panel/AiToolContent.persistence.test.tsx src/features/tool-panel/AiToolContent.pendingQueue.test.tsx src/features/tool-panel/AiToolContent.historyBackend.test.tsx src/features/tool-panel/AiToolContent.autoApproval.test.tsx src/features/tool-panel/AiToolContent.shell.test.tsx src/features/tool-panel/AiToolContent.imageOnly.test.tsx`：通过，12 files / 76 tests。
- `npm run typecheck`：通过。
- `npm run perf:ai-streaming`：通过，baseline 1000 deltas / 1020 state updates / 1020 persistence writes / 14.74ms；buffered 1000 deltas / 354 state updates / 1 persistence write / 0.17ms。
- `npm run perf:collect-baseline`：通过，报告写入 `.updeng/docs/verification/performance-baseline-20260623.json`。
- `git diff --check`：通过；仅 Windows CRLF 提示。
- `npm run build`：通过；仍有既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 5182 --strictPort`：Vite ready in 401ms；`Invoke-WebRequest http://127.0.0.1:5182/` 返回 HTTP 200；临时 dev server 已停止。

性能前后对比数据：

- `perf:ai-streaming` 中 1000 delta 场景从 1020 次 state updates 降到 354 次，约减少 65.3%。
- persistence writes 从 1020 次降到 1 次，约减少 99.9%。
- harness elapsed 从 14.74ms 降到 0.17ms；该数据是 Node harness 指标，不等同真实 UI frame time，但能证明 state/localStorage 写入压力已收敛。

未落地候选和原因：

- 未引入 `requestAnimationFrame` scheduler：32ms timer 已可测并可注入测试，后续如需要更贴近渲染帧再单独评估。
- 未重写 `AiThreadViewport` message lookup：当前 TASK-005 的主要瓶颈是 streaming state/persistence；render 内 lookup 优化需要单独 profiler 证明。
- 未改后端 AI runtime 或 pending invocation schema：本轮只处理前端 streaming 和 localStorage pressure。

共享 lane 同步：

- 本轮写入 AI 面板和 AI 测试文件，未写入 Apple UI lane 的 terminal/workspace/machine-sidebar owned runtime 文件。
- `AiToolContent.shell.test.tsx` 因 Apple UI lane 已改变侧栏默认折叠交互，测试仅做最小兼容更新。
- Fermat subagent 已完成 TASK-006 只读预研：下一轮最小安全切片建议只做默认关闭的 `handleOutput` 子步骤 instrumentation、`collectCurrentDirOscSequences()` 普通输出无 ESC 快路径、`appendCommandBlockOutput()` tail-aware 同步追加；remote prewarm debounce、history pending chunks、writer 策略调整和 currentCwd store 隔离均延后。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。
- checkpoint 将在本 Round Log、lane 台账和索引更新后重新生成。

### 2026-06-23 Round 11：TASK-011 全链路性能回归、真实启动、截图和收口报告

状态：已完成；本轮完成全链路性能回归、真实 dev server 启动、截图证据和收口报告。计划从 `plan/active/` 移入 `plan/done/`。

实际修改文件：

- `.updeng/docs/reports/performance-optimization-closeout-20260623.md`：新增性能计划收口报告。
- `.updeng/docs/plan/done/PLAN-20260623-190929-kerminal-performance-optimization.md`：勾选 TASK-011，更新 frontmatter 为 done。
- `.updeng/docs/plan/INDEX.md`、`.updeng/docs/in-progress.md`、`.updeng/docs/coordination/lanes.json`：同步计划归档和 lane 状态。

保持不变的行为契约：

- 不为性能指标牺牲交互体验；MachineSidebar 不做虚拟化，Rust terminal / SQLite / release profile 不做无证据底层改动。
- 手动刷新、拖拽、选择、目录打开、恢复可见即时 refresh、终端输入即时性和输出顺序保持优先。

验证结果：

- `npm run perf:terminal-output`：通过，4 scenarios，max frame gap 16.80ms，max long task 0.00ms。
- `npm run perf:ai-streaming`：通过，1000 deltas；baseline 1020 state updates / 1020 persistence writes，buffered 354 state updates / 1 persistence write。
- `npm run perf:directory-list`：通过，6 runs，max 15.55ms，max 32 DOM nodes。
- `npm run perf:collect-baseline`：通过，报告写入 `.updeng/docs/verification/performance-baseline-20260623.json`。
- 性能核心前端回归：通过，33 files / 260 tests。
- `npm run typecheck`：通过。
- `npm run build`：通过；仍有既有 Vite large chunk warning。
- `npm run check:terminal-ghost`：通过，包含 frame / visual / xterm / real app smoke；截图写入 `.updeng/data/verification/terminal-ghost-visual.png`、`.updeng/data/verification/terminal-ghost-real-xterm.png`、`.updeng/data/verification/terminal-ghost-app.png`。
- `cd src-tauri; cargo fmt --check`：通过。
- `cd src-tauri; cargo test --test terminal_manager -- --nocapture`：通过，16 tests。
- `cd src-tauri; cargo test --test storage_foundation sqlite_connection_enables_wal_and_foreign_keys -- --exact --nocapture`：通过，1 test。
- `npm run verify:command-suggestion-latency`：通过，1 test。
- `npm run perf:rust-timings`：通过，dev profile 增量构建 1.31s。
- `cd src-tauri; cargo build --release --lib --timings`：通过，release profile lib baseline 1m37s。
- `npm run dev -- --host 127.0.0.1 --port 5188 --strictPort`：Vite ready in 680ms；HTTP 200；临时 dev server 已停止。

已知非性能阻断：

- 包含旧 AI runtime UI 的组合回归失败：`AiToolContent.shell.test.tsx` 仍查找“AI 对话输入”，但当前 Agent Launcher lane 已将右栏 AI 初始态改为外部 Agent launcher。
- `ToolPanel.test.tsx` 的 Agent Launcher 集成断言在本轮组合回归中停在 lazy loading `Kerminal Agent`，归属 AI Launcher lane 的右栏替换测试边界。
- `MachineSidebar.test.tsx` 旧断言假设初始分组展开；当前 UI 初始分组折叠，性能 lane 不为 DOM node count 改变该 UX。
- `npm run tauri:dev` 未直接运行：1425 被 `node` PID 105544 占用；为避免中断其他 active lane，本轮不强杀该进程。已用 5188 dev server HTTP smoke 和 `check:terminal-ghost` real app smoke 覆盖性能路径启动验证。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。
- checkpoint 将在计划归档、lane 台账和索引更新后重新生成。

### 2026-06-23 Round 6：TASK-006 终端 output 附带处理 instrumentation 和等价优化

状态：已完成；本轮只落地 TASK-006 的最小安全切片，不修改 output writer 帧级写入策略、terminal output history pending chunk 策略、remote prewarm debounce、SFTP 虚拟列表或 AI 文件。

输入：

- TASK-002 profiling 报告指出大输出附带处理压力集中在 cwd OSC 解析、remote prewarm schedule、command block append、history flush。
- Fermat subagent 只读预研建议：下一轮最小安全切片只做默认关闭的 `handleOutput` 子步骤 instrumentation、cwd OSC 普通输出快路径、command block tail-aware append；remote prewarm debounce、history pending chunks、writer 调整均延后。

实际修改文件：

- `src/features/terminal/terminalOutputInstrumentation.ts`：新增默认关闭的终端 output instrumentation；只有 `globalThis.__kerminalTerminalOutputInstrumentation.enabled = true` 时才聚合各步骤 `count/totalChars/totalMs/maxMs`，默认返回 `null` 且不记录日志。
- `src/features/terminal/terminalOutputInstrumentation.test.ts`：覆盖默认关闭 no-op，以及启用后聚合 count/chars/duration。
- `src/features/terminal/XtermPane.runtime.ts`：在 `handleOutput` 的 cwd OSC、remote prewarm git/path、command block、writer、history 五类子步骤周围接入 instrumentation；步骤顺序不变。
- `src/features/terminal/XtermPane.helpers.ts`：`collectCurrentDirOscSequences()` 增加普通输出快路径：`currentBuffer === ""` 且 data 不含 ESC 时直接返回空结果，不进入 prefix/terminator 扫描。
- `src/features/terminal/XtermPane.sessionTargets.test.tsx`：补普通输出不会留下 cwd tracking buffer 的回归断言。
- `src/features/terminal/terminalCommandBlocks.ts`：`appendCommandBlockOutput()` 改为只拼接 `COMMAND_BLOCK_OUTPUT_MAX_CHARS + 1` 的尾窗，再复用原 `trimCommandBlockOutputTail()`，避免每次 `block.output + data` 构建超长字符串。
- `src/features/terminal/terminalCommandBlocks.test.ts`：补超大已有 output 的 tail 等价测试，以及 current/data 边界 surrogate pair 不被切断的回归测试。
- `.updeng/docs/verification/terminal-output-baseline.json`、`.updeng/docs/reports/terminal-output-profiling-20260623.md`、`.updeng/docs/verification/performance-baseline-20260623.json`：重新运行 terminal perf/report 和 baseline 汇总后刷新。

保持不变的行为契约：

- `handleOutput` 数据路径顺序仍为 cwd OSC / prewarm、command block append、`outputWriter.write()`、`outputHistoryBuffer.append()`。
- `closed/error` 路径仍用 `writeNow()`，保持先 flush queued output 再写关闭/错误提示。
- `disposed` / `sessionRun` guard 不变，旧 session output 不会写入新 session。
- cwd OSC 仍只在 SSH 或 Docker container 路径解析；local/Telnet/Serial 不新增 cwd side effect。
- OSC 解析仍支持 BEL/ST 终止符、跨 chunk prefix、绝对路径校验和控制字符拒绝。
- remote prewarm 仍只在 cwd 实际变化时 schedule；本轮只计时，不做 debounce/coalesce。
- command block 仍只追加到最新、open、submitted、非空 command block；closed/unsubmitted/empty block 行为不变。
- command block tail trim 继续避免切断 surrogate pair。
- output history buffer 100ms coalesce、dispose flush、pagehide flush 语义不变。

新增/更新测试：

- `terminalOutputInstrumentation.test.ts` 覆盖默认关闭和启用聚合。
- `terminalCommandBlocks.test.ts` 覆盖大 output tail-aware 等价和 surrogate pair 边界。
- `XtermPane.sessionTargets.test.tsx` 覆盖普通输出 cwd OSC 快路径。

验证结果：

- `npm run test:frontend -- src/features/terminal/terminalOutputInstrumentation.test.ts src/features/terminal/terminalCommandBlocks.test.ts src/features/terminal/XtermPane.sessionTargets.test.tsx`：通过，3 files / 33 tests。
- `npm run test:frontend -- src/features/terminal/terminalCommandBlocks.test.ts src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/terminal/XtermPane.test.tsx src/features/terminal/terminalRemoteSuggestionPrewarm.test.ts src/features/terminal/terminalSuggestionProbeScheduler.test.ts src/features/terminal/terminalOutputWriter.test.ts src/features/terminal/terminalOutputHistoryBuffer.test.ts src/features/terminal/terminalOutputInstrumentation.test.ts`：通过，8 files / 70 tests。
- `npm run perf:terminal-output`：通过，4 scenarios，max frame gap 16.70ms，max long task 0.00ms。
- `npm run perf:terminal-report`：通过，报告写入 `.updeng/docs/reports/terminal-output-profiling-20260623.md`。
- `npm run check:terminal-ghost`：通过，frame/visual/real-xterm/app smoke 全部 pass。
- `npm run typecheck`：通过。
- `npm run perf:collect-baseline`：通过，报告写入 `.updeng/docs/verification/performance-baseline-20260623.json`。
- `git diff --check`：通过；仅 Windows CRLF 提示。
- `npm run build`：通过；仍有既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 5183 --strictPort`：Vite ready in 384ms；`Invoke-WebRequest http://127.0.0.1:5183/` 返回 HTTP 200；临时 dev server 已停止。
- `npm run tauri:dev`：通过启动冒烟；Vite 1425 ready，Cargo dev build 完成并运行 `target\debug\kerminal.exe`，随后手动停止 dev 会话。

性能前后对比数据：

- `perf:terminal-output` 仍保持 max frame gap 16.70ms / max long task 0.00ms；本轮优化主要减少普通输出上 cwd OSC 扫描和 command block 超长字符串拼接，headless xterm writer 指标预期不显著变化。
- instrumentation 默认关闭，生产路径不会产生逐 chunk console log；需要 profiling 时可通过 global 开关聚合子步骤耗时和字符数。

未落地候选和原因：

- 未做 remote prewarm debounce/coalesce：需要 timer lifecycle、dispose 和 session cleanup 测试，单独切片更安全。
- 未改 `terminalOutputHistoryBuffer` pending chunks：TASK-004 刚修 pagehide flush，继续保持 `outputHistoryRef.current` 同步可见性。
- 未改 `terminalOutputWriter` 批处理参数：现有 writer 已有帧级批处理和顺序测试，TASK-006 没有数据证明需要调整。
- 未做 command block 按帧 batching：可能影响命令块 rail 高度、复制内容和 marker 边界。
- 未进一步隔离 `currentCwd` store：涉及 workspace/UI 展示语义，留到后续 profiling 证明。

共享 lane 同步：

- 本轮写入 `XtermPane.runtime.ts`、`XtermPane.helpers.ts`、`terminalCommandBlocks.ts` 和相邻测试，均属于性能 lane 终端输出附带处理范围。
- 未写入 Apple UI lane 的 split/drop/broadcast shared 文件。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。
- checkpoint 将在本 Round Log、lane 台账和索引更新后重新生成。

### 2026-06-23 Round 7：TASK-007 SFTP/LocalTransferPane 虚拟列表第一版

状态：已完成；本轮只落地 SFTP 远端目录和 SFTP Transfer Workbench 本地目录的 fixed-row windowing，不引入新依赖，不做 MachineSidebar 虚拟化，不修改后台轮询 gating。

输入：

- Faraday subagent `019ef4e4-6792-72e1-aa02-7bb2b67af4b3` 的只读结论建议：先做 SFTP/本地两处 fixed-row windowing，不引入新库；MachineSidebar 和后台轮询延后。
- James subagent `019ef4f8-063a-7c60-acbb-8c9a0d934bbc` 的 TASK-007 只读审查结论：未发现 blocking；非阻断建议后续补充滚动后右键、远端拖拽下载、本地目录双击打开等回归断言。

实际修改文件：

- `src/features/sftp/virtualFixedListModel.ts`：新增 fixed-row window 纯模型，固定行高 44px、阈值 120、overscan 8，处理空列表、越界滚动和非法输入。
- `src/features/sftp/FixedRowVirtualList.tsx`：新增共享虚拟列表组件；小列表直接渲染，大列表按 viewport + overscan 渲染，并暴露 `data-total-rows` / `data-rendered-rows` / `data-virtualized` 供验证。
- `src/features/sftp/sftp-tool-content/SftpBrowserView.tsx`：远端目录列表接入 `FixedRowVirtualList`，loading/error/empty/header 保持非虚拟化；父级 drop zone 和右键空白区域事件保留。
- `src/features/sftp/LocalTransferPane.tsx`：本地目录列表接入 `FixedRowVirtualList`，保持 filter/header/empty/loading/error 结构。
- `src/features/sftp/sftp-tool-content/SftpEntryRow.tsx`、`src/features/sftp/LocalDirectoryEntryRow.tsx`：行高从 `min-h-11` 收敛为 `h-11`，本地行增加 `data-local-entry-row` 验证标记。
- `src/features/sftp/sftp-tool-content/useSftpTransferActions.ts`：修复 `pasteSftpClipboard()` 在 `sftpClipboard === null` 时过早返回的问题，恢复系统剪贴板 fallback 契约。
- `scripts/perf-directory-list.mjs`：目录列表 perf harness 更新为虚拟化 DOM 节点口径。
- `.updeng/docs/verification/perf-directory-list-baseline.json`、`.updeng/docs/verification/performance-task007-visual-smoke.json` 和 6 张 TASK-007 截图：刷新 SFTP/本地大目录验证证据。

保持不变的行为契约：

- 远端目录单击仍只选择，双击才打开目录；测试里同步把误用单击打开的断言改为双击。
- SFTP 远端选择、shift range selection、右键菜单入口、拖拽下载入口、drop zone 事件和上传菜单语义保持不变。
- LocalTransferPane 本地选择、目录双击打开、本地拖拽 payload、filter 和 transfer target 语义保持不变。
- 空态、loading、error、列表 header 和传输队列状态不进入虚拟列表，不受 windowing 影响。
- 不引入 `@tanstack/react-virtual` 或其它虚拟化依赖，避免扩大 bundle 和升级风险。

新增/更新测试：

- `virtualFixedListModel.test.ts` 覆盖空列表、overscan、越界滚动和非法输入。
- `SftpToolContent.selection.test.tsx` 新增 500 项远端大目录虚拟化和跨未渲染区域 shift 选择测试。
- `LocalTransferPane.virtualList.test.tsx` 新增 500 项本地大目录虚拟化和滚动后 drag payload 测试。
- `SftpToolContent.transfers.test.tsx`、`SftpToolContent.clipboard.test.tsx`、`SftpToolContent.dialogs.test.tsx` 中把目录进入动作修正为双击，贴合当前产品语义。

验证结果：

- `npm run test:frontend -- src/features/sftp/virtualFixedListModel.test.ts src/features/sftp/SftpToolContent.selection.test.tsx src/features/sftp/SftpToolContent.test.tsx src/features/sftp/SftpToolContent.localDrop.test.tsx src/features/sftp/SftpToolContent.remoteBrowser.test.tsx src/features/sftp/SftpToolContent.transfers.test.tsx src/features/sftp/SftpToolContent.clipboard.test.tsx src/features/sftp/SftpToolContent.dialogs.test.tsx src/features/sftp/SftpTransferWorkbench.test.tsx src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/LocalTransferPane.virtualList.test.tsx src/features/sftp/sftp-tool-content/useSftpTransferActions.test.ts`：通过，12 files / 124 tests。
- `npm run perf:directory-list`：通过，6 runs，max 14.10 ms，max 32 DOM nodes，报告写入 `.updeng/docs/verification/perf-directory-list-baseline.json`。
- `git diff --check`：通过；仅 Windows CRLF 提示。
- `npm run build`：通过；仍有既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 5184 --strictPort`：Vite ready in 401ms；`Invoke-WebRequest http://127.0.0.1:5184/` 返回 HTTP 200。
- CDP visual smoke：通过 mock Tauri IPC 在真实 dev server 中渲染 500 项远端 SFTP 和 500 项本地目录，dark/light/system 均完成截图。远端列表 `data-total-rows=500`、`data-rendered-rows=20`；本地列表 `data-total-rows=500`、`data-rendered-rows=13`。截图：
  - `.updeng/docs/verification/performance-task007-sftp-remote-dark.png`
  - `.updeng/docs/verification/performance-task007-sftp-remote-light.png`
  - `.updeng/docs/verification/performance-task007-sftp-remote-system.png`
  - `.updeng/docs/verification/performance-task007-sftp-local-dark.png`
  - `.updeng/docs/verification/performance-task007-sftp-local-light.png`
  - `.updeng/docs/verification/performance-task007-sftp-local-system.png`

性能前后对比数据：

- `perf:directory-list` 从虚拟化前按 entry 数渲染的旧风险口径，收敛到当前最多 32 DOM nodes；SFTP / local 的 200、1000、5000 entry 场景均按 viewport 渲染。
- 真实页面 visual smoke 中 500 项远端只渲染 20 行，500 项本地只渲染 13 行；DOM 节点数量随 viewport 而不是目录项数量增长。

未落地候选和原因：

- 未做 MachineSidebar 大量主机虚拟化：属于 TASK-009，需单独考虑分组折叠、拖拽和搜索状态。
- 未做 SFTP transfer queue / ServerInfo refresh gating：属于 TASK-008，需要事件健康和 visibility fake timer 测试。
- 未引入成熟虚拟化库：当前 fixed row 场景需求窄，自研模型可测、bundle 成本为 0；如果后续需要动态行高再重新评估。
- 未补齐滚动后远端右键、远端拖拽下载、本地目录双击打开测试：James 审查为非阻断，已记录为后续增强候选。
- 未重新运行 `npm run tauri:dev`：本轮未改 Rust、Tauri 配置、窗口或权限；启动门禁由 `npm run build`、5184 dev server HTTP 200 和三主题真实页面截图覆盖，TASK-006 已在同一性能 lane 跑通过 `npm run tauri:dev`。

共享 lane 同步：

- 本轮写入 SFTP/LocalTransferPane 文件和性能验证文件，将登记到 `lane-kerminal-performance-optimization` owned paths。
- 未写入 Agent Launcher / File-first storage lane 的 owned runtime 文件；共享文档只做最小摘要更新。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。
- checkpoint 将在本 Round Log、lane 台账和索引更新后重新生成。

### 2026-06-23 Round 8：TASK-008 SFTP queue 与 ServerInfo refresh 可见性/事件健康 gating

状态：已完成；本轮只落地 SFTP transfer queue 和 ServerInfo snapshot 自动刷新降噪，不改后端事件协议、不改 ServerInfo UI、不改 SFTP 目录同步 hook。

输入：

- Cicero subagent `019ef508-36c6-74d3-92b5-e6e85fe2ef16` 的只读预研结论：现有 SFTP queue active 后固定 900ms polling，Tauri transfer event 只 merge 不降频；ServerInfo 默认 3s force refresh，隐藏页面不降频。建议保留首次 load / 手动 refresh / fallback polling，新增 visibilitychange 重排 timer，event healthy 只做低频 poll 不能永久关闭 polling。

实际修改文件：

- `src/features/sftp/useSftpTransferQueueSync.ts`：把固定 `setInterval` 改为 timeout-based adaptive scheduler；默认 visible fallback 仍为 900ms，最近 30s 内收到 transfer event 时降到 10s health poll，document hidden 时降到 10s；恢复可见时立即补一次 refresh。`viewScope` 或 polling effect 重建时会清空旧 event health，避免旧 scope 事件影响新 scope。
- `src/features/sftp/useSftpTransferQueueSync.test.ts`：新增 event healthy 降频、hidden 降频、恢复可见补刷新、poll delay model 和 event health model 测试。
- `src/features/tool-panel/useServerInfoSnapshot.ts`：ServerInfo 自动刷新改为 timeout-based scheduler；默认 3s visible interval 保持 UI 契约，hidden 时至少 30s；恢复可见时立即 force refresh；手动 refresh 不受 gating 影响。
- `src/features/tool-panel/useServerInfoSnapshot.test.ts`：新增 hook 级测试，覆盖首次 snapshot、hidden refresh delay、手动 refresh、visibility-aware delay model。

保持不变的行为契约：

- SFTP inactive 不请求；active 首次 load 保留。
- `refreshTransfers()` 手动刷新不受 hidden / event health gating 影响。
- 恢复可见后立即补刷新，避免用户回到界面时看到长时间 stale 的队列或服务器信息。
- event update 继续使用 `mergeTransferSnapshot()`，完整拉取继续使用 `replaceTransferQueue()`。
- event channel 失败或没有近期事件时继续用 fallback polling。
- `viewScope` 参数和事件过滤不变；非当前 scope 的事件只证明通道健康，不 merge 到当前队列。
- polling 失败仍只设置 `queueError`，不清空已有 queue。
- ServerInfo cache、in-flight 去重、`requestIdRef` stale response guard 和网络速率缓存不变。
- ServerInfo “手动” interval 仍为 `0`，点击刷新仍 `force: true`。

验证结果：

- `npm run test:frontend -- src/features/sftp/useSftpTransferQueueSync.test.ts src/features/tool-panel/useServerInfoSnapshot.test.ts`：通过，2 files / 12 tests。
- `npm run test:frontend -- src/features/sftp/SftpTransferWorkbench.test.tsx src/features/sftp/useSftpManagedTransferQueue.test.ts src/features/tool-panel/ToolPanel.test.tsx`：通过，3 files / 41 tests；运行中出现既有 jsdom `HTMLCanvasElement.getContext()` not implemented 提示，不影响断言结果。
- `npm run typecheck`：通过。
- `git diff --check`：通过；仅 Windows CRLF 提示。
- `npm run build`：通过；仍有既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 5185 --strictPort`：Vite ready in 404ms；`Invoke-WebRequest http://127.0.0.1:5185/` 返回 HTTP 200；临时 dev server 已停止。

性能/降噪口径：

- SFTP transfer event channel 有近期事件时不会继续每 900ms 拉全量 queue，而是保留 10s health poll。
- SFTP / ServerInfo 在 document hidden 时不继续按前台短间隔刷新。
- 恢复 visible 时会立即补一次 refresh，避免隐藏态长 timer 导致用户回到页面后状态长时间 stale。

未落地候选和原因：

- 未改后端 `sftp-transfer-updated` 事件协议：当前前端 event health + fallback polling 已能降噪，后端 heartbeat 需要单独协议设计。
- 未改 `useSftpTransferSync` 目录完成刷新：TASK-008 指向 queue 与 ServerInfo refresh；目录刷新属于另一个语义路径。
- 未把 ServerInfo 默认 3s 改成 5s/10s：为避免用户可见 UI 契约和 `ToolPanel.test.tsx` 断言变化，本轮只在 hidden 时降频。
- 未运行 `npm run tauri:dev`：本轮未改 Rust、Tauri 配置、窗口或权限；启动门禁由 `npm run build`、5185 dev server HTTP 200 覆盖，TASK-006 已在同一性能 lane 跑通过 `npm run tauri:dev`。

共享 lane 同步：

- 本轮写入 SFTP queue hook 与 ServerInfo hook/test 文件，将登记到 `lane-kerminal-performance-optimization` owned paths。
- 未写入 Agent Launcher / File-first storage lane 的 owned runtime 文件；共享文档只做最小摘要更新。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。
- checkpoint 将在本 Round Log、lane 台账和索引更新后重新生成。

### 2026-06-23 Round 9：TASK-009 MachineSidebar 大量主机虚拟化评估

状态：已完成评估；本轮按用户补充的体验约束，不落地 MachineSidebar 虚拟化。只做低风险搜索可见性模型抽取和 memoization，避免改变 DOM 结构、滚动容器、分组 drop target、右键菜单、拖拽和可访问性行为。

输入：

- Bohr subagent `019ef516-0497-7f50-84ee-580b18257b39` 的只读预研结论：MachineSidebar 不是简单 flat list，主视图带 group header、tags、latency 和动态行高；sidebar 内 move 依赖 `elementFromPoint(...).closest("[data-machine-sidebar-group-id]")` 找真实 group drop target。直接套 SFTP fixed-row virtual list 容易破坏滚动定位、文字截断、拖拽落组和 collapsed popover 体验。

评估结论：

- MachineSidebar 当前主机行不是固定高度：tags 可能换行，latency chip、协议图标、状态点和不同文案都会影响实际高度。
- 分组 section 同时承担折叠/展开、右键菜单和 `[data-machine-sidebar-group-id]` drop target；虚拟化后未渲染的分组/主机不能作为拖拽目标，会牺牲交互体验。
- collapsed flyout 与 expanded sidebar 复用 `visibleGroups`，但两者容器、定位和 portal 行为不同；一次性虚拟化两处会扩大风险。
- 因此 TASK-009 不引入 fixed-row windowing，不引入虚拟化依赖，不改变主机树交互。后续若真实用户主机数量达到数千且有 profiler 证据，应先设计 dynamic row / group-level virtualization，并专门覆盖拖拽和右键菜单。

实际修改文件：

- `src/features/machine-sidebar/machineSidebarVisibilityModel.ts`：新增纯模型 `buildVisibleMachineGroups()`，集中处理分组/主机搜索过滤；无搜索时返回原始 groups，避免额外复制。
- `src/features/machine-sidebar/machineSidebarVisibilityModel.test.ts`：覆盖空搜索复用、分组命中保留全组、名称/描述/tag 命中、大量 20 * 100 主机树过滤且不 mutate 源数据。
- `src/features/machine-sidebar/MachineSidebar.tsx`：使用 `useMemo` 缓存 `visibleGroups`、`machineCount` 和 `allGroupsCollapsed` 派生结果，减少大主机树下重复计算；未改渲染结构。

保持不变的行为契约：

- 分组初始折叠/展开语义不在本性能切片中调整。
- 搜索命中分组标题时仍显示该分组全部主机；搜索命中主机名称/描述/tags 时只显示匹配主机。
- search active 时仍强制展开可见分组。
- 分组 drop target、machine pointer drag、external drag/drop、context menu、double click 打开终端、Docker click 行为不变。
- 不减少用户可见主机 DOM；本轮优化只缓存计算，避免为了 DOM node count 牺牲侧栏操作体验。

验证结果：

- `npm run test:frontend -- src/features/machine-sidebar/machineSidebarVisibilityModel.test.ts src/features/machine-sidebar/MachineSidebar.externalDrag.test.tsx src/features/machine-sidebar/machineSidebarMenuDomain.test.tsx`：通过，3 files / 12 tests。
- `npm run test:frontend -- src/features/machine-sidebar/machineSidebarVisibilityModel.test.ts src/features/machine-sidebar/MachineSidebar.test.tsx src/features/machine-sidebar/MachineSidebar.externalDrag.test.tsx src/features/machine-sidebar/machineSidebarMenuDomain.test.tsx`：失败，`MachineSidebar.test.tsx` 17 项找不到主机按钮；当前渲染显示初始分组为折叠状态，只能看到分组按钮。该失败不由本轮纯模型引起，属于当前并行 UI lane / 既有 MachineSidebar 状态，性能 lane 不顺手修改初始折叠 UX。
- `git diff --check`：通过；仅 Windows CRLF 提示。
- `npm run typecheck`：通过；先前 `SettingsToolContent.tsx` 的 `"settings-ai"` 类型阻断已在当前并行 settings 状态中消除，性能 lane 无需修改 settings。
- `npm run build`：通过；仍有既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 5186 --strictPort`：Vite ready in 490ms；`Invoke-WebRequest http://127.0.0.1:5186/` 返回 HTTP 200；临时 dev server 已停止。

未落地候选和原因：

- 未做 MachineSidebar 虚拟列表：当前主机树行高动态且拖拽依赖真实 DOM drop target，风险高于收益。
- 未修 `MachineSidebar.test.tsx` 初始折叠失败：这会改变用户可见侧栏展开体验，需由 UI lane 或专门 UX 决策处理。
- 未改 settings：subagent 只读复核确认 `settings-ai` 残留分支已被移除，`settings-ai` legacy initial section 映射到 `settings-mcp` 符合 Agent Launcher lane 目标。

共享 lane 同步：

- 本轮写入 `MachineSidebar.tsx`，该文件是 Apple/UI 相关历史热点；改动仅限搜索派生计算缓存，不碰 JSX 行结构、拖拽、右键菜单和样式。
- 未写入 Agent Launcher / File-first storage lane 的 owned runtime 文件；共享文档只做最小摘要更新。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。
- checkpoint 将在本 Round Log、lane 台账和索引更新后重新生成。

### 2026-06-23 Round 10：TASK-010 Rust terminal / SQLite / release profile 评估

状态：已完成评估；本轮不修改 Rust terminal 后端、SQLite 存储入口或 Cargo release profile。结论写入 `.updeng/docs/reports/performance-task010-rust-release-profile-evaluation-20260623.md`。

输入：

- Lorentz subagent `019ef524-22ce-7cb1-affa-57e529a6e802` 的只读结论：`TerminalManager` read / write / close、SSH terminal service、SQLite 单连接 Mutex 和 release profile 都只是潜在候选，没有当前性能瓶颈证据；底层改动会影响输出顺序、secret redaction、关闭清理和存储事务语义。
- Epicurus subagent `019ef524-6346-74e3-87d4-bd8e97711e2c` 的只读结论：不建议本轮改 Cargo release profile；默认 release profile 已支撑 v0.1.9 跨平台 CI release 和 updater artifacts，`lto/strip/panic/codegen/opt-level` 需要单独 Tauri build、installer size、updater 安装重启验证。

评估结论：

- `TerminalManager::write()` 每次写入后 flush 是保守实现，但保障用户输入、密码响应和交互式 shell 的即时性；不在没有输入延迟数据时调整。
- `spawn_reader_thread()` 的 read -> secret responder/redaction -> output buffer/log -> event emit 顺序承载终端体验和审计语义；不做批量合并或异步化。
- SQLite 当前是单连接 Mutex，已启用 WAL、foreign keys 和 5s busy timeout；没有 lock wait / 慢查询 / UI 卡顿归因数据前，不改连接池或写队列。
- release profile 属于打包体积、启动和 updater 可靠性议题；当前没有 installer size、startup smoke、updater install/relaunch 的 profile 前后 baseline，不混入本轮 UX 性能切片。

实际修改文件：

- `.updeng/docs/reports/performance-task010-rust-release-profile-evaluation-20260623.md`：新增评估报告。
- `.updeng/docs/plan/active/PLAN-20260623-190929-kerminal-performance-optimization.md`：勾选 TASK-010 并记录 Round 10。

保持不变的行为契约：

- 不改变终端 read buffer、output event 粒度、write flush、关闭清理、secret prompt 响应和 redaction。
- 不改变 SQLite 连接模型、事务边界、WAL/busy timeout/foreign keys 配置。
- 不改变 Cargo release profile、Tauri bundle/updater artifacts 或 CI release 行为。

验证结果：

- `npm run perf:rust-timings`：通过，dev profile 增量构建 1.31s，timing report 写入 `src-tauri/target/cargo-timings/cargo-timing-20260623T154219304Z-122bdcd98055b800.html`。
- `cd src-tauri; cargo test --test terminal_manager -- --nocapture`：通过，16 tests。
- `cd src-tauri; cargo test --test storage_foundation sqlite_connection_enables_wal_and_foreign_keys -- --exact --nocapture`：通过，1 test。
- `npm run verify:command-suggestion-latency`：通过，1 test。
- `cd src-tauri; cargo build --release --lib --timings`：通过，release profile lib baseline 1m37s，timing report 写入 `src-tauri/target/cargo-timings/cargo-timing-20260623T154327108Z-122bdcd98055b800.html`。

未落地候选和原因：

- 未调 `READ_BUFFER_SIZE` 或 output event batching：会影响 prompt 自动响应、关闭/error/data 顺序和前端 streaming 体感，缺少瓶颈数据。
- 未延迟 `TerminalManager::write()` flush：可能牺牲用户输入即时性。
- 未改 SQLite 连接池/写队列：影响面覆盖 60+ 调用点和事务语义，需先加默认关闭 instrumentation。
- 未改 `[profile.release]`：可能影响构建时间、崩溃诊断、运行速度、签名/updater 产物和跨平台 release，需单独 release-size/profile 任务。

共享 lane 同步：

- 本轮未写 Rust runtime code、storage code、Cargo/Tauri 配置；只新增报告并更新性能计划文档。
- `src-tauri/src/state.rs`、`src-tauri/src/storage/mod.rs` 等 storage lane shared paths 未被性能 lane 修改。

提交 / checkpoint：

- 本轮未提交；等待用户确认或后续统一提交。
- checkpoint 将在本 Round Log、lane 台账和索引更新后重新生成。

## 完成标准

- TASK-001 到 TASK-011 全部完成或明确取消，并记录原因。
- 至少三条真实用户体感路径有前后数据：
  - 终端大输出。
  - AI streaming。
  - SFTP/本地大目录。
- `npm run build`、相关前端测试、相关 Rust 测试和真实启动 smoke 均通过。
- 计划移入 `plan/done/`，`plan/INDEX.md` 更新完成摘要。
- 长期稳定结论提炼到 `.updeng/docs/reports/` 或 `.updeng/docs/decisions/`，不要只留在本计划 Round Log。

## 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
| --- | --- | --- | --- |
| 高频字段隔离导致 UI 不更新 | pane 状态、cwd、target chip stale | 先做 snapshot tests 和局部 selector tests | 切回完整 `terminalPanes` props |
| session persistence 降频丢恢复字段 | 重启后 workspace 恢复不完整 | stable/volatile 字段白名单和 restore tests | 恢复旧 full snapshot builder |
| AI streaming batching 丢 delta | 回复内容缺失或顺序错乱 | fake stream burst tests，final 强制 flush | 关闭 buffer，恢复逐 delta setState |
| 终端附带处理节流破坏 command block | 色条、命令块输出范围错误 | command block tests + terminal ghost smoke | 回滚该子优化 |
| 虚拟列表破坏拖拽/右键/选择 | SFTP 操作误触或不可用 | row model tests + Playwright smoke | 阈值关闭 virtualization |
| polling 降频导致状态滞后 | SFTP/ServerInfo 看起来不刷新 | event health fallback + manual refresh | 恢复原 polling interval |
| release profile 影响 updater/打包 | 发布失败或启动异常 | 单独 profile 切片 + Tauri build smoke | 回滚 Cargo profile |
