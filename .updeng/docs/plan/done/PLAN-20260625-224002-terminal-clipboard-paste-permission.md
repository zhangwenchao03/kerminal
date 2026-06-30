---
id: PLAN-20260625-224002-terminal-clipboard-paste-permission
status: done
created_at: 2026-06-25T22:40:02+08:00
started_at: 2026-06-25T22:40:02+08:00
completed_at: 2026-06-25T22:50:00+08:00
updated_at: 2026-06-25T22:50:00+08:00
owner: ai
flow_depth: planned
---

# 终端右键粘贴剪贴板权限弹框修复

## 目标

- 终端右键菜单 `粘贴` 和 `rightClickBehavior: paste` 不再在 Tauri 桌面窗口里触发 `localhost:1425` 的浏览器剪贴板读取权限弹框。
- `Ctrl+V` / xterm 原生 paste 事件路径保持不变。

## 非目标

- 不调整终端右键菜单视觉、分屏 runtime、命令块、Agent Launcher 或 Docker/Compose 相关能力。
- 不引入新的全局剪贴板插件或跨平台依赖；本轮优先复用当前 Windows `clipboard-win` 依赖。

## 影响范围

- `src-tauri/src/commands/terminal.rs`
- `src-tauri/src/commands/registry.rs`
- `src/lib/terminalApi.ts`
- `src/lib/terminalApi.test.ts`
- `src/features/terminal/XtermPane.helpers.ts`
- `src/features/terminal/XtermPane.contextMenu.test.tsx`
- `src/features/terminal/__tests__/support/XtermPane.testSupport.tsx`

## 执行步骤

- [ ] 增加只读系统文本剪贴板的 Tauri command，并注册到 command registry。
- [ ] 前端 terminal API 增加 `readTerminalClipboardText`，Tauri 桌面优先走 command，浏览器预览才走 Clipboard API。
- [ ] `pasteIntoTerminal` 改用 terminal API，避免右键菜单直接调用 `navigator.clipboard.readText()`。
- [ ] 补聚焦测试覆盖 Tauri command 调用和右键粘贴不读浏览器 Clipboard API。

## 验证

- `npm test -- --run src/lib/terminalApi.test.ts src/features/terminal/XtermPane.contextMenu.test.tsx`
- `npm run build`
- dev server 启动冒烟；如涉及 Tauri command 编译，再至少运行 `cargo check` 或说明 `npm run tauri:dev` 无法执行原因。

## 风险

- `src-tauri/src/commands/registry.rs` 正被 Compose/container lane 共享；本轮只追加 terminal command 注册，不重排 existing entries。
- 非 Windows Tauri 桌面暂不提供 native text clipboard fallback；本轮 Windows 复用既有依赖解决当前用户问题。

## Round Log

### 2026-06-25T22:50:00+08:00 实现与验证

- 根因：终端右键菜单 `粘贴` 和 `rightClickBehavior: paste` 通过 `pasteIntoTerminal` 直接调用 `navigator.clipboard.readText()`，Tauri dev window 的 WebView 会以 `http://localhost:1425` 站点身份弹出浏览器剪贴板读取权限。
- 改动：
  - `terminal_read_clipboard_text`：新增 Tauri command，Windows 复用 `clipboard-win` 读取 Unicode 文本剪贴板。
  - `readTerminalClipboardText`：新增前端 terminal API；Tauri 桌面走 command，浏览器预览才回退 `navigator.clipboard.readText()`。
  - `pasteIntoTerminal`：改为调用 terminal API，避免右键菜单直接触发浏览器 Clipboard API。
  - 测试：右键直接粘贴和菜单粘贴断言走 `readTerminalClipboardText`，并断言不调用浏览器 `clipboard.readText`。
- 验证：
  - `npm test -- --run src/lib/terminalApi.test.ts src/features/terminal/XtermPane.contextMenu.test.tsx`：2 files / 26 tests passed。
  - `cargo check`：通过。
  - `npm run build`：通过；仅保留既有 Vite large chunk warning。
  - dev server smoke：`npm run dev -- --host 127.0.0.1 --port 5197` 启动成功，`Invoke-WebRequest http://127.0.0.1:5197/` 返回 200，随后已停止临时 server。
  - `npm run tauri:dev`：未通过，原因是默认 Vite 端口 `1425` 已被当前运行窗口占用，`beforeDevCommand` 因 `Port 1425 is already in use` 退出；未强停用户当前窗口。
- 并行同步：
  - 写入共享 `src-tauri/src/commands/registry.rs` 前已读取 coordination status、Compose lane 计划、registry diff 和 checkpoint；本轮只追加 terminal command 注册，不重排已有 command。
