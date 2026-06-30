---
id: PLAN-20260618-000037-terminal-buffer-search
status: done
created_at: 2026-06-18T00:00:37+08:00
started_at: 2026-06-18T00:00:37+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 终端缓冲区搜索

## 目标

- 为本地和 SSH xterm 分屏增加当前缓冲区搜索能力。
- 搜索能力使用官方 `@xterm/addon-search`，不手写终端缓冲扫描。
- 右键菜单提供“搜索”，终端内显示中文搜索浮层，支持上一个、下一个、大小写匹配和关闭。

## 非目标

- 不实现全局跨 tab 搜索。
- 不实现命令块级 Shell integration 搜索。
- 不实现会话日志落盘、重连或断开能力。
- 不改变 PTY/SSH 后端协议。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 后端接口 | 否 | 无 | 不需要 Rust 行为变更 |
| 前端页面 | 是 | `src/features/terminal/*` | Vitest、浏览器 smoke |
| 依赖 | 是 | `package.json`、`package-lock.json` | `npm run check` |
| 文档 | 是 | 产品计划、in-progress | 收口更新 |

## 执行步骤

- [x] 安装 `@xterm/addon-search@0.16.0` 并同步 lockfile。
- [x] 新增独立终端搜索浮层组件，保持中文 UI、键盘可用和紧凑工作台风格。
- [x] 在 `XtermPane` 中加载 SearchAddon，接入搜索浮层和右键菜单“搜索”动作。
- [x] 更新前端测试，覆盖右键打开搜索、关键词搜索、上/下一个、大小写选项和关闭。
- [x] 运行 `npm run test:frontend -- XtermPane TerminalContextMenu`、`npm run check` 和 1425 浏览器 smoke。
- [x] 更新产品计划并从 in-progress 收口。

## 验证

- `npm run test:frontend -- XtermPane TerminalContextMenu`：通过，2 个测试文件、15 个用例通过。
- `npm run check`：通过，包含 28 个前端测试文件、180 个前端用例、Rust fmt/clippy/test 和生产构建。
- 浏览器 smoke：`http://127.0.0.1:1425/` 通过；右键菜单可打开“搜索 Ctrl+F”，搜索浮层中文输入框可聚焦输入，关闭后焦点回到终端输入，控制台错误为 `[]`。
- 命名回归：`rg "Next Terminal|next terminal|NextTerminal" .` 无匹配。

## 风险

- 搜索只作用于当前 xterm 缓冲区，不跨远程文件或历史日志。
- 浏览器预览的搜索结果计数依赖 xterm SearchAddon 事件；自动化测试已覆盖结果事件更新，真实 Tauri 窗口需在后续人工验收中继续检查大输出搜索体验。


