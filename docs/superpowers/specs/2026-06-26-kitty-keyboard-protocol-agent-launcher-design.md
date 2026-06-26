# Agent Launcher 启用 kitty keyboard protocol

## 背景

Kerminal 的 Agent Launcher（快捷键 `Alt+2`，右侧工具面板）启动外部 AI CLI（codex、claude code、kimi、qwen 等），把它们跑在嵌入右栏的 xterm.js 终端里。

当前问题：在 Agent Launcher 跑 codex / claude TUI 时按 `Shift+Enter` 不会换行，而是被当成 Enter 提交。原因是 xterm.js 默认把所有 Enter（含 Shift+Enter）编码为 `\r` 发给 PTY；TUI 端无法区分。

**对照**：在系统终端（如 Windows Terminal、macOS Terminal）跑同样 CLI 时，Shift+Enter 能换行——因为这些终端默认启用了 kitty keyboard protocol 或 modifyOtherKeys。

## 目标

让 Agent Launcher 右侧终端里的 `Shift+Enter` 能真正换行，行为与系统终端一致。

**非目标**：解决 shell 终端里的快捷键问题；解决远程主机终端的同样问题；为不支持 kitty 的旧 TUI 做降级兼容。

## 范围

**In-scope**：
- 在 `inputCompatibilityMode === "agentTui"` 的终端里启用 kitty keyboard protocol
- `Shift+Enter` 在 agentTui 模式下编码为 kitty 标准序列 `\x1b[13;2u`
- `Enter`（无修饰键）编码为 `\x1b[13u`（kitty 协议下裸 Enter 的标准编码），对 TUI 的行为与原 `\r` 等价
- 其他修饰键组合（Ctrl+J、Alt+Enter 等）继续走现有 `TERMINAL_KEYBOARD_COMPATIBILITY_CASES` 兼容逻辑

**Out-of-scope**：
- 不改 Rust 后端 PTY 层
- 不改 shell 模式终端行为
- 不加 UI 切换或设置项
- 不做协议探测 / 降级 / 旧 TUI 兜底
- 不动 `terminalInputModel.ts`

## 决策记录

1. **激进方案**：只发 kitty 协议序列，不做降级。用户用了不支持 kitty 的 CLI 自己负责。
2. **触发时机**：Agent 启动时（`terminal.open()` 之后）立即启用，不做 TUI 探测。
3. **范围边界**：仅 `inputCompatibilityMode === "agentTui"` 的终端启用；shell 模式终端完全不受影响。AgentTerminalView 是唯一传 `inputCompatibilityMode="agentTui"` 的调用方。

## 架构

涉及 3 个文件，都在前端，集中在 `src/features/terminal/`：

```
src/features/terminal/
├── XtermPane.tsx                          # 改：管 terminal.options 的 useEffect 加 modifyOtherKeys
├── XtermPane.runtime.ts                   # 改：installXtermPaneRuntime 内追加启用序列
└── terminalKeyboardPolicy.ts              # 改：新增 kitty 常量 + helper
```

不动 Rust 后端、不动 `terminalInputModel.ts`、不动 `keybindingUtils.ts`。

## 组件与职责

### `terminalKeyboardPolicy.ts`

新增导出：

- `KITTY_KEYBOARD_PROTOCOL_ENABLE: string` — 值固定为 `"\x1b[>1u"`（启用推送模式）
- `shouldEnableKittyKeyboardProtocol(mode: TerminalInputCompatibilityMode): boolean` — 仅当 `mode === "agentTui"` 返回 `true`，否则 `false`

文件已存在的 `TERMINAL_KEYBOARD_COMPATIBILITY_CASES` 中 `shiftEnter` 这一条**保留**（不删除）——它是防御性兼容层，未来 xterm.js 版本行为变化时仍能兜底。

### `XtermPane.runtime.ts`

在 `installXtermPaneRuntime` 内、`terminal.open(container)` 之后，追加：

```ts
if (shouldEnableKittyKeyboardProtocol(inputCompatibilityMode)) {
  terminal.write(KITTY_KEYBOARD_PROTOCOL_ENABLE);
}
```

`inputCompatibilityMode` 已经在文件第 46-47 行解构出来了。

### `XtermPane.tsx`

第 489-510 行的 useEffect（同步 `terminalAppearance` 到 `terminal.options`）：

- 新增一行：`terminal.options.modifyOtherKeys = inputCompatibilityMode === "agentTui" ? 2 : 0`
- useEffect 的依赖数组加入 `inputCompatibilityMode`（当前依赖只有 `terminalAppearance` / `terminalFontWeight` / `terminalTheme`）

为什么需要这个：xterm.js 在 `terminal.open()` 时读一次 options，但后续 pane 配置变化时会重新同步。如果不更新 `modifyOtherKeys`，TUI 收到的 Enter 编码方式会与 xterm.js 内部缓冲不一致。

## 数据流：Shift+Enter 的完整路径

```
用户按 Shift+Enter
  ↓
xterm.js 内部 keyboard handler
  ↓
xterm.js 检查：modifyOtherKeys=2 + kitty 协议已通过 \x1b[>1u 启用
  ↓
xterm.js 编码为 \x1b[13;2u（kitty 协议下 Shift+Enter 的标准编码）
  ↓
触发 onData("\x1b[13;2u")
  ↓
writeTerminal(sessionId, "\x1b[13;2u") 写入 PTY
  ↓
PTY → 远程/本地 shell → codex/claude TUI
  ↓
TUI 用 inquire 或自家 kitty 解析器识别 CSI 13;2u → 插入换行
```

注意：此路径**绕过** `attachCustomKeyEventHandler` 和 `resolveTerminalInputCompatibilityOverride`——xterm.js 自己处理键盘编码，前端代码不需再干预 `Shift+Enter`。policy 表里的 `shiftEnter` case 保留作为防御层。

## 错误处理

1. **PTY 关闭 / 重连**：kitty 协议状态可能丢。但 XtermPane 每次 pane 重建都重新 `terminal.open()` 并重新发启用序列——OK。
2. **`terminal.write` 失败**：xterm.js 6 的 `terminal.write` 不会 reject，会静默丢失。按不可恢复处理，不抛错、不打断用户流程。
3. **后端 `writeTerminal` 失败**：不在本任务范围（`writeTerminal` 已有重试/错误日志机制）。

## 测试

### 单元测试：`src/features/terminal/terminalKeyboardPolicy.test.ts`

新增 cases：

- `shouldEnableKittyKeyboardProtocol("agentTui")` 返回 `true`
- `shouldEnableKittyKeyboardProtocol("shell")` 返回 `false`
- `KITTY_KEYBOARD_PROTOCOL_ENABLE` 等于 `"\x1b[>1u"`

### 集成测试：`src/features/terminal/XtermPane.inputCompatibility.test.tsx`

新增 cases（利用现有的 mock xterm）：

- `agentTui` 模式下创建 XtermPane，断言 `terminal.write` 被以 `"\x1b[>1u"` 调用
- `shell` 模式下创建 XtermPane，断言 `terminal.write` **未被**以 `"\x1b[>1u"` 调用
- `agentTui` 模式下，`terminal.options.modifyOtherKeys` 为 `2`
- `shell` 模式下，`terminal.options.modifyOtherKeys` 为 `0`

### 手工验证脚本（可选）

`scripts/verify-agent-launcher-kitty.mjs`：用 Playwright 启动应用，打开 AgentLauncher 跑 codex，模拟按 Shift+Enter，断言 TUI 收到 `\x1b[13;2u`。

> 该脚本作为本任务的 **stretch goal**——如果时间不够可以跳过，但记录在 README/测试清单里供后续补齐。

## 风险与回滚

- **风险 1：启用 kitty 协议后，Agent Launcher 跑旧 TUI（不支持 kitty）会收到带前缀的 ESC 序列，可能显示乱码**。激进方案已确认接受此风险。
- **风险 2：`modifyOtherKeys=2` 在某些 xterm.js 6.x 小版本下有 bug**。回滚方案：把 `modifyOtherKeys` 改为 `1`（level 1 不编码普通 Enter，只编码带修饰键的）。
- **回滚路径**：本任务只改 3 个文件，每个改动都是独立的——通过 `git revert` 可一键回退。

## 不做的事

- 不加配置开关（激进方案）
- 不做协议探测（激进方案）
- 不为旧 TUI 做降级（激进方案）
- 不改 Rust 后端
- 不改 shell 终端行为
- 不动 `terminalInputModel.ts`