---
id: PLAN-20260626-233645-terminal-command-rail-tui-fix
status: done
created_at: 2026-06-26T23:36:45+08:00
started_at: 2026-06-26T23:36:45+08:00
completed_at: 2026-06-29T19:00:00+08:00
updated_at: 2026-06-29T19:00:00+08:00
owner: ai
lane: lane-current-terminal-command-rail-tui-fix
---

# 进入 TUI 时命令块色条回归修复

## 目标

- 修复进入 `codex` / `claude` 等 TUI 或 alternate screen 后，左侧命令块色条重新出现的问题。
- 保留普通 shell 下的命令块数据与退出 TUI 后的正常恢复。

## 非目标

- 不重做命令块生命周期。
- 不修改 Agent Launcher、XtermPane 布局或其它终端共享热点行为。

## 影响范围

- `src/features/terminal/terminalCommandBlocks.ts`
- `src/features/terminal/terminalCommandBlocks.test.ts`

## 执行步骤

- [x] TASK-001 在 alternate screen 下隐藏命令块 rail 视图，并补回归测试。

## 验证

- `npm run test -- --run src/features/terminal/terminalCommandBlocks.test.ts`
- `npm run build`

## 风险

- 需要确认只隐藏视图、不清空命令块数据，避免退出 TUI 后普通 shell rail 丢失。

## Round Log

### 2026-06-26T23:36:45+08:00

- 回读 AGENTS、README、Updeng 真相源、并行 lanes 与 active plan。
- 用 CodeGraph 定位问题：`XtermPane.tsx` 在 `terminal.buffer.active.type !== "normal"` 时停止新增 prompt block，但仍调用 `buildTerminalCommandBlockViews(...)`；`terminalCommandBlocks.ts` 会在 `alternate` buffer 下继续返回 muted 视图，因此旧命令块 rail 会在 TUI 中被重新渲染。
- 修复策略：把 alternate screen 下的 command block rail 视图直接收敛为空，只保留内存中的 command block 数据；退出 TUI 回到 normal buffer 后再自然恢复。

### 2026-06-29T19:00:00+08:00

- 文档清理时复核磁盘代码，`buildTerminalCommandBlockViews(...)` 已在 `activeBufferType === "alternate"` 时返回空视图，符合本计划修复策略。
- 验证通过：`npm run test -- --run src/features/terminal/terminalCommandBlocks.test.ts`，1 file / 28 tests passed。
- 后续全仓 `npm run build` 随 Updeng 文档清理收口统一执行。
