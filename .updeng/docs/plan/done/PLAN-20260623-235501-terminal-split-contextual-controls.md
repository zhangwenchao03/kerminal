---
id: PLAN-20260623-235501-terminal-split-contextual-controls
status: done
created_at: 2026-06-23T23:55:01+08:00
started_at: 2026-06-23T23:55:01+08:00
completed_at: 2026-06-24T11:35:10+08:00
updated_at: 2026-06-24T11:35:10+08:00
owner: ai
---

<!-- @author kongweiguang -->

# 终端分屏控件上下文化调整

## 目标

- 单 pane 终端不再常驻显示批量/分屏命令栏，降低主工作区噪声。
- 分屏入口移动到每个终端 pane 标题栏的关闭 X 附近，操作语义跟随当前 pane。
- 已进入多 pane 分屏后，再显示批量发送栏和目标选择。

## 非目标

- 不改分屏布局算法、拖拽分屏热区或 workspace store 数据模型。
- 不改终端关闭语义。
- 不重做终端标题栏整体视觉系统。

## 影响范围

- `src/features/terminal/TerminalBroadcastBar.tsx`
- `src/features/terminal/TerminalSplitTargetSelector.tsx`
- `src/features/terminal/TerminalPaneCard.tsx`
- `src/features/terminal/TerminalPaneLayout.tsx`
- `src/features/terminal/TerminalWorkspaceContent.tsx`
- `src/features/terminal/TerminalWorkspace.tsx`
- 相邻终端测试

## 执行步骤

- [x] TASK-001：把分屏入口下沉到 pane 标题栏，批量发送栏仅在多分屏时显示。
- [x] TASK-002：更新终端相邻测试，覆盖 pane-scoped split、单 pane 隐藏批量栏、多分屏保留目标发送。
- [x] TASK-003：运行前端验证、构建和真实 dev server 视觉 smoke；记录不能运行项。

## 验证

- `npm run test:frontend -- src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx`
- `npm run typecheck`
- `npm run build`
- 真实 dev server light/dark/system 截图或说明阻断原因

## 风险

- `TerminalPaneCard` / `TerminalPaneLayout` 是 performance lane owned path，本轮只做控件透传和标题栏按钮小改，已同步读取 performance plan/checkpoint。
- 单 pane 下批量发送栏隐藏是有意行为变更；用户若需要批量发送，必须先形成分屏上下文。

## Round Log

### 2026-06-24T11:35:10+08:00

- 文档收口：本计划全部 TASK 已完成并有相邻测试、typecheck、build、dev server smoke 证据，状态从 `active` 移到 `done`。
- 剩余非本计划阻断：`tauri:dev` 仍受本机既有 1425 端口占用影响，已在前序 Round Log 记录；不再把该计划保留为 active。

### 2026-06-24T00:16:14+08:00

- 设计取向：按 Apple-inspired 工作台低噪声原则，固定批量/分屏栏不再常驻；分屏属于 pane-scoped 上下文动作，放到每个终端 pane 标题栏关闭 X 附近。批量发送栏只在 `activePaneIds.length > 1` 的多分屏上下文显示。
- 修改文件：`src/features/terminal/TerminalBroadcastBar.tsx`、`src/features/terminal/TerminalSplitTargetSelector.tsx`、`src/features/terminal/TerminalPaneCard.tsx`、`src/features/terminal/TerminalPaneLayout.tsx`、`src/features/terminal/TerminalWorkspaceContent.tsx`、`src/features/terminal/TerminalWorkspace.tsx` 及相邻终端测试。
- 验证通过：`npm run test:frontend -- src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx`，3 files / 44 tests；`git diff --check -- <本 lane 终端文件与验证 JSON>`；dev server `http://127.0.0.1:5187/` HTTP 200。
- 真实浏览器视觉 smoke：临时脚本 `.updeng/tmp/sdd/terminal-split-contextual-smoke.mjs` 通过系统 Chrome + CDP 验证 light/dark/system；结果 JSON 为 `.updeng/docs/verification/terminal-split-contextual-controls.json`；截图包括 `terminal-split-context-single-light.png`、`terminal-split-context-split-light.png`、`terminal-split-context-single-dark.png`、`terminal-split-context-split-dark.png`、`terminal-split-context-single-system.png`、`terminal-split-context-split-system.png`。
- 全仓门禁阻断：`npm run typecheck` 和 `npm run build` 当前失败在并行 AI/settings lane，错误集中于 `src/features/settings/settings-tool-content/options.ts`、`src/features/settings/settingsModel.test.ts`、`src/features/settings/settingsModel.ts`、`src/features/settings/SettingsToolContent.mcp.test.tsx`、`src/lib/settingsApi.test.ts` 的旧 `ai` settings 类型残留；本轮未修改这些文件，未跨 lane 修复。

### 2026-06-24T00:30:12+08:00

- 用户反馈修复：分屏按钮现在显式携带被点击 pane 的 `sourcePaneId`，不再依赖全局 focused pane 的时序；从非当前 focus 的 pane 标题栏或右键菜单分屏时，会以该 pane 为源插入新分屏。
- 目录继承：`splitFocusedPaneState` 新建 pane 的 `cwd/currentCwd` 优先继承源 pane 的 `currentCwd ?? cwd`，即使选择 SSH/Telnet/Serial/Container 等目标机器，也会按源 pane 当前目录作为启动目录候选。
- 刷新回归：新增 store 回归断言，分屏后源 pane 对象保持同一引用，新 pane 插入到源 pane 旁边，避免把已打开终端替换成新实例导致刷新/重连。
- 修改文件：`src/features/workspace/workspaceStore.ts`、`src/features/workspace/workspaceTerminalState.ts`、`src/features/workspace/workspaceStore.terminalTabs.test.ts`、`src/features/terminal/TerminalPaneCard.tsx`、`src/features/terminal/TerminalPaneCard.test.tsx`、`src/features/terminal/TerminalWorkspace.test.tsx`，并延续 `src/features/terminal/terminalSplitTargets.ts` 的 pane-scoped option 类型。
- 验证通过：`npm run test:frontend -- src/features/workspace/workspaceStore.terminalTabs.test.ts src/features/workspace/workspaceLayout.test.ts src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/terminal/XtermPane.test.tsx src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/terminal/terminalSplitTargets.test.ts src/features/terminal/terminalSplitDropZones.test.ts`，9 files / 109 tests；`git diff --check -- <本轮分屏修复文件>`；`npm run typecheck`；`npm run build`；dev server `http://127.0.0.1:5188/` HTTP 200，并通过内置浏览器截图确认 Kerminal 主界面渲染。
- 并行交接：已运行 `node .codex/hooks/lane-coordination.cjs checkpoint lane-terminal-split-contextual-controls C:/dev/rust/kerminal`，checkpoint 写入 `.updeng/docs/coordination/checkpoints/lane-terminal-split-contextual-controls.json`。

### 2026-06-24T08:18:44+08:00

- 用户复现反馈：分屏后源 SSH pane 会重新显示“正在连接 SSH 主机...”，新分屏登录后停在 `~`，没有进入源 pane 的 `/dev` 等当前目录。
- 修复一：`XtermPane` 启动 effect 不再依赖 `args/env/target` 对象引用，改用内容稳定 key，避免 workspace snapshot 在分屏时重建等价对象后触发源 pane close/re-create。
- 修复二：SSH 创建请求新增可选 `cwd`，前端用 `currentCwd ?? cwd` 传入；Rust SSH 服务在普通直连和 jump route 的 OpenSSH 参数末尾追加安全引用的远端命令，例如 `cd -- '/dev' && exec "${SHELL:-/bin/sh}" -l`，使新 SSH 分屏进入源 pane 当前目录。
- 回归测试：新增 `XtermPane` 测试覆盖等价启动参数重建不重连、布局变成 split 时源 pane session 不被 close；新增 `XtermPane.sessionTargets` 测试覆盖 SSH 创建请求携带 cwd；新增 Rust 集成/单元测试覆盖 SSH cwd 命令和 jump route cwd 命令。
- 验证通过：`npm run test:frontend -- src/features/terminal/XtermPane.test.tsx src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/workspace/workspaceStore.terminalTabs.test.ts src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/TerminalWorkspace.test.tsx`，5 files / 89 tests；`cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service`，10 tests；`cargo test --manifest-path src-tauri/Cargo.toml --lib services::ssh_terminal_service -j 1`，8 tests；`cargo fmt --manifest-path src-tauri/Cargo.toml`；`git diff --check -- <本轮文件>`；`npm run typecheck`；`npm run build`；`cargo check --manifest-path src-tauri/Cargo.toml -j 1`；dev server `http://127.0.0.1:5188/` HTTP 200 且内置浏览器 DOM 冒烟显示 title `Kerminal`、无 console error。
- 验证阻断：`npm run tauri:dev` 仍因固定 Vite 端口 `1425` 被已有 `node` 进程 PID `105544` 占用而失败，未擅自结束该进程；已用 Rust 编译/测试和前端真实 dev server 冒烟替代覆盖本轮改动。

### 2026-06-24T08:28:11+08:00

- 收口补强：`SshTerminalCreateRequest.cwd` 明确标记 `#[serde(default)]`；新增 Rust 单测覆盖远端 cwd 中含单引号时的 shell quoting，避免 `cd` 命令被路径内容截断。
- 最终验证通过：`npm run test:frontend -- src/features/workspace/workspaceStore.terminalTabs.test.ts src/features/workspace/workspaceLayout.test.ts src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/terminal/XtermPane.test.tsx src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/terminal/terminalSplitTargets.test.ts src/features/terminal/terminalSplitDropZones.test.ts`，9 files / 112 tests；`cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service`，10 tests；`cargo test --manifest-path src-tauri/Cargo.toml --lib services::ssh_terminal_service -j 1`，9 tests；`npm run typecheck`；`cargo check --manifest-path src-tauri/Cargo.toml -j 1`；`npm run build`；`git diff --check -- <本轮文件>`。
- 启动冒烟：`http://127.0.0.1:5188/` 返回 HTTP 200；确认该 Vite 验证进程为 `C:\dev\rust\kerminal` 下的 `vite --host 127.0.0.1 --port 5188` 后已停止。`tauri:dev` 阻断仍是 `1425` 被已有 `node` PID `105544` 占用，本轮未结束该进程。

### 2026-06-24T08:56:56+08:00

- 用户截图补漏：远端主机普通 shell 未必发送 OSC 1337 `CurrentDir`，但截图中 prompt 已显示 `root@pkuai01:/dev#`。`collectCurrentDirOscSequences` 保留 OSC 解析，同时新增保守的 SSH prompt cwd fallback，能从 `user@host:/abs/path#` / `[user@host /abs/path]#` 识别绝对路径，忽略 `~` 和相对路径。
- 回归补强：`XtermPane.sessionTargets` 新增普通 prompt、跨 chunk prompt 和 prompt 驱动 `onCurrentCwdChange("/dev")` 用例；`XtermPane.test` 的 split runtime 用例改为源 SSH pane 已在 `/dev`，断言分屏后旧 `ssh-session-1` 没有 close，新 SSH create request 带 `{ cwd: "/dev" }`。
- 编译阻断同步：当前工作区包含 file-first lane 的未跟踪 `src-tauri/src/storage/config_file_store.rs`，Rust 编译会包含它；本轮只做最小兼容修正，把测试里的旧 `settings.theme` 迁到 `settings.theme_mode` / `themeMode`，不改该 lane 其它实现。
- 验证通过：`npm run test:frontend -- src/features/terminal/XtermPane.sessionTargets.test.tsx`，9 tests；`npm run test:frontend -- src/features/terminal/XtermPane.test.tsx`，17 tests；`npm run test:frontend -- src/features/workspace/workspaceStore.terminalTabs.test.ts src/features/workspace/workspaceLayout.test.ts src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/terminal/XtermPane.test.tsx src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/terminal/terminalSplitTargets.test.ts src/features/terminal/terminalSplitDropZones.test.ts`，9 files / 112 tests；`npm run typecheck`；`cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-split-fix --test ssh_terminal_service`，10 tests；`cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-split-fix --lib services::ssh_terminal_service -j 1`，9 tests；`cargo check --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-split-fix -j 1`；`cargo fmt --manifest-path src-tauri/Cargo.toml`；`npm run build`；`git diff --check -- <本轮文件>`。
- 启动冒烟：`npm run dev -- --host 127.0.0.1 --port 5188` 启动成功，`http://127.0.0.1:5188/` 返回 HTTP 200，验证后已停止，5188 只剩 TimeWait。Playwright 包不在本仓库，未能截图；`tauri:dev` 仍因 1425 被既有 `node` PID `105544` 监听占用而未直接运行。

### 2026-06-24T09:09:39+08:00

- 用户明确边界：分屏出来的是新会话，只继承源 pane 的 `cwd/currentCwd`，不继承旧会话历史记录。`splitFocusedPaneState` 从 source/target pane 模板创建新 pane 时现在显式清空 `outputHistory`，保留 `lines: []`，避免新 xterm mount 时 replay 源 pane 的输出历史。
- 回归补强：`workspaceStore.terminalTabs` 新增用例，覆盖源 SSH pane 已记录 `/dev` 和 `outputHistory` 时，水平分屏后的新 `pane-ssh-2` 仍带 `cwd/currentCwd: "/dev"`，但 `outputHistory` 为 `undefined`，源 pane 历史不被清掉。
- 验证通过：`npm run test:frontend -- src/features/workspace/workspaceStore.terminalTabs.test.ts src/features/terminal/XtermPane.test.tsx src/features/terminal/XtermPane.sessionTargets.test.tsx`，3 files / 55 tests；`npm run test:frontend -- src/features/workspace/workspaceStore.terminalTabs.test.ts src/features/workspace/workspaceLayout.test.ts src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/terminal/XtermPane.test.tsx src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/terminal/terminalSplitTargets.test.ts src/features/terminal/terminalSplitDropZones.test.ts`，9 files / 113 tests；`npm run typecheck`；`npm run build`；`git diff --check -- src/features/workspace/workspaceTerminalState.ts src/features/workspace/workspaceStore.terminalTabs.test.ts`。
- 启动冒烟：`npm run dev -- --host 127.0.0.1 --port 5188` 启动成功，`http://127.0.0.1:5188/` 返回 HTTP 200，验证后已停止。
