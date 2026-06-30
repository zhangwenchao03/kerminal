---
id: PLAN-20260625-185344-terminal-split-reconnect-fix
status: done
created_at: 2026-06-25T18:53:44+08:00
started_at: 2026-06-25T18:53:44+08:00
completed_at: 2026-06-25T20:16:15+08:00
updated_at: 2026-06-25T20:16:15+08:00
owner: ai
lane: lane-current-terminal-split-reconnect-fix
---

# 修复新建分屏导致其他屏重新连接

## 目标
- 新建左右/上下分屏时，已有终端 pane 不因为布局树重排而关闭原 SSH/local/container/telnet/serial session。
- 保持原有分屏标题栏、关闭、分屏按钮、右键菜单、日志状态和命令块交互可用。

## 非目标
- 不重写 `react-resizable-panels` 拖拽模型。
- 不新增后端 terminal attach/restore API。
- 不处理无关终端样式、tmux、Compose 容器和侧栏布局问题。

## 根因
- `splitPaneInLayout` 在交叉方向分屏时会把目标 pane 包进新的 split 节点。
- 目标 pane 在 React 树里跨父节点移动后会卸载 `XtermPane`。
- `XtermPane.runtime` 的 cleanup 会 `unregisterTerminalPaneSession` 并 `closeTerminal(sessionId)`；随后新 `XtermPane` 挂载又创建 SSH session，因此旧屏显示重新连接。

## 影响范围
- 前端终端布局：`src/features/terminal/TerminalWorkspaceContent.tsx`
- pane chrome/slot：`src/features/terminal/TerminalPaneLayout.tsx`、`src/features/terminal/TerminalPaneCard.tsx`
- 回归测试：`src/features/terminal/TerminalWorkspace.test.tsx`
- 启动门禁：`vite.config.ts`

## 执行步骤
- [x] TASK-001 补交叉分屏回归测试：已有 pane 从直接子节点变为嵌套 split 子节点时，不应卸载对应 `XtermPane`。
- [x] TASK-002 将 runtime 挂载迁到 `TerminalWorkspaceContent` 的稳定 overlay：布局树只渲染 pane chrome 和 runtime slot，`XtermPane` 以 `paneId` 为 key 在稳定父节点下保持挂载。
- [x] TASK-003 保持交互桥接：overlay 中的 `XtermPane` 继续接收 focus、cwd/output history 更新、右键分屏和日志入口。
- [x] TASK-004 运行相邻测试、build、真实 dev server 冒烟；若涉及 Tauri 运行链路，补 `npm run tauri:dev` 或记录无法运行原因。

## 验证
- `npm test -- src/features/terminal/TerminalWorkspace.test.tsx`
- `npm run build`
- 启动 Vite dev server，打开真实界面做分屏冒烟，至少检查深色主题；主题未改但仍按项目规则观察浅色/跟随系统不出现不可读状态。
- 视环境执行 `npm run tauri:dev` 启动冒烟。

## 风险
- overlay 定位需要跟随 resize、tab 切换和 split layout 更新；若测量失败，终端可能隐藏或覆盖 pane header。
- 当前工作区有多个 active lane 和大量未归因改动，本计划只触碰终端分屏相关文件。

## Round Log

### 2026-06-25T18:53:44+08:00
- 已读 `AGENTS.md`、`README.md`、`.updeng/docs/README.md`、`in-progress.md`、`BLOCKERS.md`、`plan/INDEX.md`、`coordination/lanes.json` 和 `status.md`。
- CodeGraph 定位到 `splitPaneInLayout`、`TerminalPaneLayout`、`TerminalPaneCard`、`XtermPane`、`XtermPane.runtime`。
- 诊断结论：交叉分屏导致旧 pane 跨父节点移动，触发 `XtermPane` cleanup 关闭 session。

### 2026-06-25T19:36:30+08:00
- 收到 coordination refresh 后重读 `coordination/status.md` 和 `coordination/lanes.json`；确认本 lane 继续只拥有 `TerminalWorkspaceContent.tsx`、`TerminalPaneLayout.tsx`、`TerminalPaneCard.tsx`、`TerminalWorkspace.test.tsx` 和本计划文件，`XtermPane.tsx` / `XtermPane.runtime.ts` 由 AI sidebar terminal lane 拥有，本轮不再触碰。
- 实施结果：`TerminalPaneCard` 支持 `runtimeMount="slot"` 并渲染 `data-terminal-pane-runtime-slot`；`TerminalPaneLayout` 递归透传 slot/runtime、machineGroups、split sizes 和 pane history 解析；`TerminalWorkspaceContent` 在稳定 overlay 中按 `pane.id` 挂载 `XtermPane`，通过 slot rect 定位，布局树重排只移动 slot，不卸载 runtime。
- 回归测试：`TerminalWorkspace.test.tsx` 新增 nested split 用例，断言把既有 pane 移入嵌套 split 后不会触发对应 `XtermPane` unmount。
- 验证通过：`npm test -- src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/XtermPane.test.tsx src/features/terminal/XtermPane.contextMenu.test.tsx`，4 files / 71 tests passed。
- 验证通过：`npm run typecheck`。
- 验证通过：`npm run build`，`tsc && vite build` 完成，只有 Vite chunk size warning。
- 验证通过：`git diff --check -- src/features/terminal/TerminalWorkspaceContent.tsx src/features/terminal/TerminalPaneCard.tsx src/features/terminal/TerminalPaneLayout.tsx src/features/terminal/TerminalWorkspace.test.tsx`，仅 LF/CRLF 提示。
- dev server 结果：`npm run dev -- --host 127.0.0.1 --port 5177 --force` 可启动并返回 `curl -I http://127.0.0.1:5177/` 的 `200 OK`。
- dev server 剩余风险：普通启动/首次请求和后续 JS 入口请求会在 Vite/esbuild 依赖转换阶段卡住，停止进程时出现 `fatal error: all goroutines are asleep - deadlock`；headless Chrome 只得到空白深色截图 `C:\dev\rust\kerminal\.updeng\docs\verification\terminal-split-reconnect-dev-smoke-20260625.png`，不计为视觉通过。该问题未定位到本次 terminal split 改动，保留为独立启动/工具链阻断。
- Tauri dev：本次只改 React 终端布局挂载关系，未触碰 Rust/Tauri 窗口或权限链路；因 dev server JS smoke 仍有 Vite/esbuild 阻断，未继续执行 `npm run tauri:dev`。
- 已生成 checkpoint：`.updeng/docs/coordination/checkpoints/lane-current-terminal-split-reconnect-fix.json`。checkpoint 会列出当前 lane 关联的共享脏路径（含 `XtermPane*` 和 workspace layout/store），供其它 lane 同步；本轮实际新增/修改范围仍限制在 terminal layout/card/workspace content/test 和本计划文件。

### 2026-06-25T20:16:15+08:00
- 收到 delegation refresh 后再次读取 `coordination/status.md` 和 `lanes.json`；确认 layout restore lane 与本 lane 共享 `TerminalPaneLayout.tsx` / `TerminalWorkspaceContent.tsx` / `TerminalWorkspace.test.tsx`，AI sidebar terminal lane 拥有 `XtermPane.tsx` / `XtermPane.runtime.ts`，本轮没有修改 `XtermPane*`。
- 补充启动门禁修复：正式 `vite.config.ts` 采用上一轮临时 smoke 已验证的 `optimizeDeps.noDiscovery: true`，并显式 include React、Tauri API、xterm、lucide、zustand、clsx、tailwind-merge 等运行期核心依赖；保留 xterm optimizeDeps esbuild patch。目的只是绕开 Vite 7 依赖 discovery 对完整 Monaco-heavy app graph 的卡死，不改变生产 build 行为。
- 为恢复全局验证，按 Compose lane 计划做了最小兼容接线：`HostContainersDialog.tsx` 透传 `HostContainerList` 的 `onOpenProjectYaml` / `onRefreshProject`，并把 `ComposeProjectInspector` 的 `tab` / `onTabChange` 接到本地 state；未实现新的 Compose 远程写入或生命周期逻辑。
- 验证通过：`npm run typecheck`。
- 验证通过：`npm test -- --run src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/XtermPane.test.tsx src/features/terminal/XtermPane.contextMenu.test.tsx`，4 files / 71 tests passed。
- 验证通过：`npm test -- --run src/features/machine-sidebar/HostContainersDialog.test.tsx`，1 file / 9 tests passed。
- 验证通过：`npm run build`，`tsc && vite build` 完成，只有既有 Vite chunk size warning。
- 真实 dev server 通过：`npm run dev -- --host 127.0.0.1 --port 5207 --strictPort --force`，Vite ready in 1122 ms；`curl -I` 验证 `/`、`/@vite/client`、`/src/main.tsx` 均快速返回 `200 OK`，没有复现上一轮 esbuild deadlock。
- 运行态截图通过：`.updeng/docs/verification/terminal-split-reconnect-dev-smoke-dark-20260625.png`、`.updeng/docs/verification/terminal-split-reconnect-dev-smoke-light-20260625.png`、`.updeng/docs/verification/terminal-split-reconnect-dev-smoke-system-light-20260625.png`；CDP 记录 `data-theme` 分别为 `dark`、`light`、`light`（跟随系统使用 emulated light preference），页面非空且可读。
- 验证通过：`git diff --check -- vite.config.ts .updeng/docs/coordination/lanes.json .updeng/docs/plan/active/PLAN-20260625-185344-terminal-split-reconnect-fix.md src/features/terminal/TerminalWorkspaceContent.tsx src/features/terminal/TerminalPaneCard.tsx src/features/terminal/TerminalPaneLayout.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/machine-sidebar/HostContainersDialog.tsx`，仅 LF/CRLF 提示。
- Tauri dev：本轮未修改 Rust、Tauri command、窗口配置或权限链路，按项目门禁执行了前端 build 与真实 dev server 冒烟；未额外运行 `npm run tauri:dev`。
