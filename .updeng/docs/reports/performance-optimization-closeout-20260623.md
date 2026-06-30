<!-- @author kongweiguang -->

# Kerminal 性能优化收口报告

收口时间：2026-06-23T23:58:53+08:00

关联计划：[Kerminal 性能优化生产级实施计划](../plan/done/PLAN-20260623-190929-kerminal-performance-optimization.md)

## 总结

本轮性能计划完成 TASK-001 到 TASK-011。核心方向是降低 Kerminal 工作台真实场景中的主线程和 React 状态压力，而不是牺牲交互体验去追求单点指标。

已落地的主要优化：

- workspace terminal stable snapshot 隔离 `outputHistory/lines` 高频字段。
- workspace session persistence 拆分 stable / volatile，降低高频输出期间完整 snapshot 构建。
- AI streaming delta buffer 和 conversation persistence debounce。
- 终端 output 附带处理的默认关闭 instrumentation、cwd OSC 快路径和 command block tail-aware append。
- SFTP / LocalTransferPane fixed-row 虚拟列表。
- SFTP queue 和 ServerInfo 可见性 / event health gating，隐藏态降频，恢复可见立即刷新。
- MachineSidebar 按体验优先不做虚拟化，只抽取搜索可见性纯模型并缓存派生数据。
- Rust terminal / SQLite / release profile 完成评估，不在缺少瓶颈证据时改底层。

## 性能结果

- Terminal output：`npm run perf:terminal-output` 通过，4 scenarios，最大 frame gap 16.80ms，最大 long task 0.00ms。
- AI streaming：1000 deltas 下基线为 1020 state updates / 1020 persistence writes；buffered 后为 354 state updates / 1 persistence write，内容一致。
- Directory list：SFTP / local 的 200、1000、5000 entry 场景均通过，最大 15.55ms，最大 32 DOM nodes。
- Baseline summary：`npm run perf:collect-baseline` 通过，报告写入 `.updeng/docs/verification/performance-baseline-20260623.json`。
- Rust timing：`npm run perf:rust-timings` 通过，dev profile 增量构建 1.31s；`cargo build --release --lib --timings` 通过，release lib baseline 1m37s。

## 验证结果

通过项：

- 性能核心前端回归：33 files / 260 tests。
- `npm run typecheck`。
- `npm run build`，仍有既有 Vite large chunk warning。
- `npm run check:terminal-ghost`，包含 frame / visual / xterm / real app smoke。
- `cd src-tauri; cargo fmt --check`。
- `cd src-tauri; cargo test --test terminal_manager -- --nocapture`，16 tests。
- `cd src-tauri; cargo test --test storage_foundation sqlite_connection_enables_wal_and_foreign_keys -- --exact --nocapture`。
- `npm run verify:command-suggestion-latency`。
- `npm run dev -- --host 127.0.0.1 --port 5188 --strictPort`，Vite ready in 680ms，HTTP 200，临时 server 已停止。

截图 / 视觉证据：

- `.updeng/data/verification/terminal-ghost-visual.png`
- `.updeng/data/verification/terminal-ghost-real-xterm.png`
- `.updeng/data/verification/terminal-ghost-app.png`
- TASK-007 SFTP / local light-dark-system 截图仍保留在 `.updeng/docs/verification/performance-task007-*.png`。

## 已知非性能阻断

以下失败来自当前并行 AI Launcher / UI lane 的行为变化，不归因于性能优化本身：

- `AiToolContent.shell.test.tsx` 仍查找旧的“AI 对话输入”，但当前右栏 AI 初始态已被 Agent Launcher lane 改为外部 Agent launcher。
- `ToolPanel.test.tsx` 的 `renders the active AI tool as the external agent launcher` 在本轮组合回归中停在 lazy loading `Kerminal Agent`，属于 Agent Launcher lane 的右栏替换测试边界。
- `MachineSidebar.test.tsx` 的旧断言仍假设初始分组展开；当前 UI 渲染初始分组折叠，性能 lane 不为 DOM node count 改变该 UX。

启动限制：

- `npm run tauri:dev` 未直接运行。`src-tauri/tauri.conf.json` 固定 devUrl 使用 1425，当前 1425 被 `node` PID 105544 占用；为避免中断其他 active lane 的 dev server，本轮不强杀该进程。前端真实 dev server 和 `check:terminal-ghost` real app smoke 已覆盖本轮性能路径启动验证。

## 2026-06-24 复查补丁

- 发现并修复一个 session persistence 边界回归：性能优化后终端输出历史会延迟 flush，`pagehide` 路径已正确保存 pending 输出，但组件 unmount 清理时可能先取消 workspace store 订阅，再 flush terminal output buffer，导致最后一小段 pending 输出没有进入保存快照。
- 修复点：`useWorkspaceSessionPersistence.flushWorkspaceSession()` 在 flush pending terminal buffers 后直接读取 `useWorkspaceStore.getState()` 生成最终 snapshot，不再依赖可能已经过期的订阅缓存。
- 新增回归测试：`useWorkspaceSessionPersistence.test.ts` 覆盖 unmount 前 pending terminal output buffer 会被保存。
- 复查验证：`useWorkspaceSessionPersistence.test.ts` 6 tests、性能核心回归 9 files / 59 tests、终端相邻回归 5 files / 57 tests、SFTP/ServerInfo 相邻回归 56 files / 390 tests、`npm run typecheck`、`npm run perf:terminal-output`、`npm run perf:directory-list`、`npm run perf:ai-streaming`、`npm run check:terminal-ghost`、`npm run build` 和 5194 dev server HTTP 200 均通过。

## 后续建议

- AI Launcher lane 应清理旧 `AiToolContent.shell.test.tsx` 和 `ToolPanel.test.tsx` 中与旧内置 AI 对话入口冲突的断言。
- 若未来要继续 Rust/storage/release-size 性能优化，先新增默认关闭 instrumentation 和单独 release-size 计划，再逐项验证 installer size、startup smoke、updater install/relaunch。
- MachineSidebar 只有在真实数千主机场景和 profiler 证据出现后，才考虑 dynamic row / group-level virtualization。
