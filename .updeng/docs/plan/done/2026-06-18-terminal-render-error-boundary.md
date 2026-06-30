---
id: PLAN-20260618-000041-terminal-render-error-boundary
status: done
created_at: 2026-06-18T00:00:41+08:00
started_at: 2026-06-18T00:00:41+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 终端渲染错误边界

## 目标

- 为每个终端分屏增加独立错误边界，避免单个 xterm 或预览分屏渲染异常导致整个工作台崩溃。
- 错误状态使用中文提示，提供“重新挂载”和“打开日志”入口，帮助用户继续工作和定位问题。
- 使用第三方 `react-error-boundary` 处理 React 错误边界，符合当前 React 19 技术栈。

## 非目标

- 本次不做 Rust 崩溃捕获、前端错误上报服务或长期错误事件数据库。
- 本次不做 xterm 吞吐压测；该项仍留在 slice 21 的后续性能专项。
- 本次不改变终端会话生命周期或 PTY/SSH 后端协议。

## 影响范围

- 前端依赖：`react-error-boundary`。
- 前端组件：`src/features/terminal/TerminalPaneErrorBoundary.tsx`、`TerminalPaneLayout.tsx`。
- 测试：`src/features/terminal/TerminalWorkspace.test.tsx`。
- 文档：本计划、`.updeng/docs/in-progress.md`、总计划 slice 21 状态。

## 执行步骤

- [x] 安装并锁定 `react-error-boundary`。
- [x] 新增终端分屏错误边界组件。
- [x] 在 `TerminalPaneLayout` 的 pane 叶子节点接入错误边界。
- [x] 补齐组件测试，覆盖异常 fallback、打开日志和重新挂载。
- [x] 运行相关前端测试、`npm run check` 和 `http://127.0.0.1:1425/` 浏览器 smoke。
- [x] 更新总计划和本计划状态。

## 验证

- `npm run test:frontend -- TerminalWorkspace`：通过，`TerminalWorkspace.test.tsx` 共 13 个用例。
- `npm run check`：通过，覆盖前端 31 个测试文件 / 208 个用例、Rust fmt、clippy、test 和生产构建。
- 浏览器打开 `http://127.0.0.1:1425/`：通过，Kerminal 工作台可加载，右侧“日志”工具可打开，页面无 `Next Terminal` 文案，浏览器控制台无 error 日志。
- 安全审计补充：`npm audit --omit=dev --json` 仍报告 Vite 传递依赖 `esbuild` 的 1 个 low severity advisory，`npm audit fix` 未能自动消除；未在本切片强制升级 Vite。

## 风险

- 错误边界只能捕获 React 渲染/生命周期错误，不能捕获异步 Promise、原生 WebView 或 Rust 进程崩溃。
- 如果异常发生在 Xterm 初始化副作用外部，重新挂载只能重试前端组件，不保证后端会话仍可复用。


