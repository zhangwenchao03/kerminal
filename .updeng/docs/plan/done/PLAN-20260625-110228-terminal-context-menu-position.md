---
id: PLAN-20260625-110228-terminal-context-menu-position
status: done
created_at: 2026-06-25T11:02:28+08:00
started_at: 2026-06-25T11:02:28+08:00
completed_at: 2026-06-25T11:20:05+08:00
updated_at: 2026-06-25T11:20:05+08:00
owner: ai
---

# 终端右键菜单坐标修复

## 目标

- 终端区域右键菜单应贴近鼠标打开。
- 当鼠标靠近窗口边缘时，只做必要的贴边调整，不因过大的高度预估把菜单推离鼠标。
- 保持右键菜单浅色、深色和跟随系统主题样式不变。

## 非目标

- 不重做全局右键菜单样式。
- 不修改 SFTP、侧栏、标签页或命令块右键菜单行为。
- 不改变终端复制、粘贴、清屏、搜索、断开、重连和分屏动作。

## 影响范围

- `src/features/terminal/TerminalContextMenu.tsx`
- `src/features/terminal/terminalContextMenuModel.ts`
- `src/features/terminal/XtermPane.tsx`
- `src/features/terminal/XtermPane.contextMenu.test.tsx`
- `src/features/terminal/TerminalContextMenu.test.tsx`

## 执行步骤

- [x] TASK-001：定位终端右键菜单坐标偏移根因。
  - 验收：明确偏移来自打开前硬编码菜单尺寸预估或其它坐标系问题。
- [x] TASK-002：改为基于实际菜单尺寸的定位。
  - 验收：菜单初始坐标使用鼠标 viewport 坐标，渲染后按实际宽高贴边。
- [x] TASK-003：补充相邻测试并运行验证。
  - 验证：相邻前端测试、`npm run build`、真实 dev server smoke；如无法做 UI 截图说明原因。

## 风险

- 坐标逻辑若放在全局样式层，可能影响其它菜单；本轮只改终端菜单组件和模型。
- 当前工作区存在大量其它 lane 未提交改动，本轮只追加目标文件的最小修改。

## Round Log

- 2026-06-25T11:02:28+08:00：创建 active 计划。已读取 AGENTS、README、Updeng 文档、active 计划、coordination status/lanes 和目标文件 diff；CodeGraph 定位 `XtermPane.openContextMenu`、`TerminalContextMenu` 和 `clampMenuPosition`。初步根因是 `clampMenuPosition` 使用固定 `menuHeight = 386`，菜单实际高度变化后，窗口下半部右击会被过度上移。
- 2026-06-25T11:20:05+08:00：完成修复。`XtermPane` 改为记录右键事件的原始 viewport 坐标，`TerminalContextMenu` 在 `useLayoutEffect` 中按实际 DOM 尺寸和 viewport 贴边，删除旧 `clampMenuPosition` 的固定宽高预估；新增 `resolveTerminalContextMenuPosition` 纯函数和 XtermPane 级坐标回归测试。验证通过：`npm run test:frontend -- src/features/terminal/terminalContextMenuModel.test.ts src/features/terminal/TerminalContextMenu.test.tsx src/features/terminal/XtermPane.contextMenu.test.tsx`（3 files / 28 tests）、`npm run typecheck`、`npm run build`（仅既有 chunk size warning）、`npm run dev -- --host 127.0.0.1 --port 5202 --strictPort` + HTTP smoke `status=200 length=644`。浏览器截图保存到 `.updeng/docs/verification/terminal-context-menu-position-20260625.png`；受浏览器预览无 Tauri workspace session/无终端 pane 限制，截图只覆盖页面启动，右键菜单位置由组件测试验证。
