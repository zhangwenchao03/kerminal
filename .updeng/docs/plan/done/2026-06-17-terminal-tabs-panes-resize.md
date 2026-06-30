---
id: PLAN-20260617-000029-terminal-tabs-panes-resize
status: done
created_at: 2026-06-17T00:00:29+08:00
started_at: 2026-06-17T00:00:29+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Terminal Tab、Pane 与可调整分屏切片

## 目标

- 完成产品计划第 4 切片：终端 tab 可切换/新增/关闭，pane 可左右/上下分屏、聚焦、关闭，并通过第三方库支持拖拽调整尺寸。
- 使用 `react-resizable-panels` 实现分屏布局，不手写拖拽尺寸算法。
- 把分屏状态抽成可测试的 layout tree，后续 workspace 持久化、AI 工具调用和命令面板动作复用同一套结构。

## 非目标

- 本切片不做布局持久化到 SQLite。
- 本切片不做任意拖拽排序、跨 tab 移动 pane 或 tmux/mux 级会话恢复。
- 本切片不做 SSH/SFTP 真实连接，只保留远程 preview pane。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 前端状态 | 是 | `src/features/workspace/workspaceStore.ts`、`workspaceLayout.ts` | Vitest |
| 前端 UI | 是 | `src/features/terminal/TerminalWorkspace.tsx`、`components/ui/resizable.tsx` | Vitest、浏览器验证 |
| 左侧/右侧功能 | 间接 | `MachineSidebar`、`ToolPanel` 测试保持 | Vitest |
| 后端接口 | 否 | 不改 Rust command | `npm run check` 保持 Rust 通过 |
| 文档 | 是 | 本文件、总计划、`in-progress.md` | 完成时更新 |

## 执行步骤

- [x] 安装并使用 `react-resizable-panels`。
- [x] 定义 `TerminalLayoutNode` 和 `TerminalSplitDirection`，让 tab 持有 layout tree。
- [x] 新增 `workspaceLayout.ts`，实现 split、remove、pane id 遍历、首个 pane 查找等纯函数。
- [x] 改造 `workspaceStore`，支持 active tab、tab 新增/切换/关闭、pane 左右/上下分屏和关闭。
- [x] 改造 `TerminalWorkspace`，递归渲染 resizable panels，显示 tab 新增/关闭、左右/上下分屏、关闭 pane 控件。
- [x] 保留本地 xterm pane 和远程 preview pane，不让工作台测试启动真实 xterm。
- [x] 补充 `workspaceLayout`、`workspaceStore`、`TerminalWorkspace` 测试，左侧/右侧测试保持通过。
- [x] 运行 `npm run check`，并做浏览器验证。

## 验证

- `npm run test:frontend`
- `npm run check`
- 浏览器验证：当前页面显示 tab、分屏按钮、可调整分隔条、本地终端区域、左侧主机树和右侧工具区，无控制台错误。
- 2026-06-17：`npm run check` 通过；浏览器刷新后标题为 `Kerminal`，工作区已渲染，无刷新后的 console error，历史占位品牌文案无命中。

## 风险

- 多个本地 xterm pane 会启动多个 PTY，会增加资源占用；关闭 pane 必须卸载组件以触发 session close。
- 嵌套 layout tree 若处理不当会留下空 split；纯函数测试必须覆盖删除和聚合。
- `react-resizable-panels` 增加构建体积；后续可和 xterm 一起做动态加载或 chunk 拆分。


