---
id: PLAN-20260618-000038-terminal-context-menu
status: done
created_at: 2026-06-18T00:00:38+08:00
started_at: 2026-06-18T00:00:38+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 终端右键菜单基础

## 目标

- 在终端分屏内提供中文右键菜单，覆盖常用终端辅助动作。
- 首批动作包含复制、粘贴、全选、清屏、打开日志、打开设置、新建本地终端、左右分屏、上下分屏。
- 菜单交互保持终端优先：右键只打开应用菜单，执行后回到 xterm 焦点。
- 相关 UI 逻辑放在独立组件和测试文件中，不继续膨胀 `XtermPane.tsx`。

## 非目标

- 本次不做终端缓冲区搜索 UI。
- 本次不做会话日志落盘、重新连接和断开连接。
- 本次不做系统级原生菜单或全局快捷键。

## 影响范围

- 前端终端组件：`XtermPane`、`TerminalPaneCard`、`TerminalPaneLayout`、`TerminalWorkspace`。
- 工作区接线：`KerminalShell` 传入工具切换、新建终端和分屏动作。
- 测试：终端右键菜单组件测试、XtermPane 动作回调测试。
- 文档：slice 19 状态和本轮计划。

## 执行步骤

- [x] 增加独立 `TerminalContextMenu` 组件。
- [x] 在 `XtermPane` 中接入右键定位、菜单关闭、xterm clipboard/selection/clear 动作。
- [x] 从工作区上层传入打开日志、打开设置、新建终端和分屏动作。
- [x] 补充 React 测试覆盖菜单渲染、点击动作、禁用态和 xterm 动作调用。
- [x] 运行一键验证，并在 `http://127.0.0.1:1425/` 做 smoke。

## 验证

- `npm run test:frontend -- TerminalContextMenu XtermPane TerminalWorkspace`：通过，3 个测试文件、24 条测试通过。
- `npm run check`：通过，覆盖前端 28 个测试文件/173 条测试、Rust fmt/clippy/test、生产构建。
- 浏览器 smoke：在 `http://127.0.0.1:1425/` 右键终端，确认中文菜单包含复制、粘贴、全选、清屏、打开日志、打开设置、新建本地终端、左右分屏、上下分屏；执行“打开日志”切到日志工具，执行“打开设置”切到设置工具，执行“新建本地终端”新增并切到第三个终端 tab，执行“左右分屏”和“上下分屏”后终端区域从 1 个变为 2 个再变为 3 个；浏览器控制台错误为 `[]`。

## 风险

- 浏览器预览和 Tauri WebView 的 clipboard 权限不同；粘贴失败时要可回退且不阻塞菜单。
- xterm 的选择状态在 JSDOM 中需要 mock，测试只验证动作调用和 UI 状态。
- 搜索/会话日志/重连能力会影响更多状态和后端接口，本次不合并进右键菜单基础。


