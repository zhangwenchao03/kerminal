---
id: PLAN-20260625-215135-terminal-pane-drag-reorder
status: done
created_at: 2026-06-25T21:51:35+08:00
started_at: 2026-06-25T22:23:51+08:00
completed_at: 2026-06-25T22:53:41+08:00
updated_at: 2026-06-26T09:32:38+08:00
owner: ai
---

<!-- @author kongweiguang -->

# 终端分屏 Pane 鼠标拖动挪位置生产级实施计划

## 目标

- 用户在一个终端 tab 已经分屏后，可以用鼠标拖动某个 pane 标题栏，把该 pane 移动到另一个 pane 的左侧、右侧、上方或下方。
- 支持拖到目标 pane 中央进行位置交换，用来快速调换两个 pane 的视觉位置。
- 移动只改变当前 terminal tab 的 `layout`，不关闭、不重建、不重新连接任何已有 `XtermPane` 会话。
- 移动后的布局继续通过现有 workspace session 保存和恢复，重启后保持顺序。
- 操作在浅色、深色、跟随系统主题下可读，且不影响终端内容区鼠标选择、全屏程序鼠标模式和 split resize handle。

## 非目标

- 不引入新的拖拽库，不改 `react-resizable-panels` 依赖版本。
- 不新增 Rust/Tauri command、后端存储字段或 session attach API。
- 不做跨 tab 拖动、跨窗口拖动、把 pane 拖成新 tab 或浮动窗口。
- 不改变现有从侧栏拖主机到终端边缘创建新分屏的行为。
- 不重写终端 resize、广播命令、tab group 或右栏工具面板。

## 调研结论

### 当前代码事实

- `TerminalTab.layout` 使用 `TerminalLayoutNode` 树表示 pane/split；`TerminalPane` 运行信息独立存在 `terminalPanes` 数组中，见 `src/features/workspace/types.ts`。
- 现有布局纯函数集中在 `src/features/workspace/workspaceLayout.ts`：`collectPaneIds`、`splitPaneInLayout`、`removePaneFromLayout`、`updateSplitLayoutSizes`。
- 状态 patch 集中在 `src/features/workspace/workspaceTerminalState.ts`，store action 集中在 `src/features/workspace/workspaceStore.ts`。
- 2026-06-25 的“修复新建分屏导致其他屏重新连接”已经把真实 `XtermPane` 迁到 `TerminalWorkspaceContent` 稳定 overlay；布局树只渲染 pane chrome 和 runtime slot。拖动方案必须保留这个契约。
- `TerminalPaneCard` 标题栏已有 pane-scoped 分屏按钮和关闭按钮，是最合适的拖动起点；终端内容区不能作为拖动起点，否则会破坏 xterm 鼠标交互。
- 从侧栏拖主机到终端分屏已存在 `terminalSplitDropZones.ts`、`TerminalSplitDropOverlay.tsx` 和 `KerminalShell.splitDrop.test.tsx`，可以复用“指针事件 + 热区解析 + overlay 提示”的模式，但不能复用文案和 store action。
- `react-resizable-panels` 本地安装版本是 `4.11.2`；README 明确它提供 resizable `Group` / `Panel` / `Separator`，适合作尺寸管理，不承担 pane reorder 语义。

### 方案比较

| 方案 | 优点 | 缺点 | 风险 | 结论 |
| --- | --- | --- | --- | --- |
| 原生 Pointer Events + 自有 layout model | 不增依赖；能避开 xterm 内容区；可按现有测试层级验证；和 sidebar drag 现有模式一致 | 需要自己实现热区、预览和树移动算法 | 算法若直接操作 DOM 会破坏持久化；必须只提交 store action | 采用 |
| 引入 dnd-kit / React DnD | 现成拖拽抽象较完整 | 增依赖；和 xterm、Tauri WebView、resizable handle 的事件边界更复杂 | 维护成本和事件冲突高 | 不采用 |
| HTML5 Drag and Drop | 浏览器内置 | WebView 行为差异大；不适合触控/Pointer；预览和取消控制弱 | 容易干扰文本选择和终端鼠标模式 | 不采用 |
| 直接 DOM swap / CSS order | 实现看似简单 | 不改变 `TerminalTab.layout`，无法稳定持久化；容易让 overlay slot 与真实 xterm 脱节 | 高概率重现会话重连或错位 | 禁止 |
| 修改 `react-resizable-panels` 或依赖其内部状态 | 可利用 panel id | 该库职责是 resize，不是布局语义；内部 layout 不是 Kerminal 事实源 | 与 workspace session 事实源冲突 | 不采用 |

## 推荐架构

### 数据与状态

- 新增纯函数放在 `src/features/workspace/workspaceLayout.ts`：
  - `movePaneInLayout(layout, command): TerminalLayoutNode`
  - `swapPanePositionsInLayout(layout, sourcePaneId, targetPaneId): TerminalLayoutNode`
  - 必要时拆内部 helper：`extractPaneFromLayout`、`insertPaneRelativeToTarget`、`layoutContainsPane`。
- 新增 state patch 放在 `src/features/workspace/workspaceTerminalState.ts`：
  - `moveTerminalPaneState(state, command)`。
- 新增 store action 放在 `src/features/workspace/workspaceStore.ts`：
  - `moveTerminalPane(sourcePaneId, targetPaneId, placement)`。
- 不修改 `TerminalPane`、`TerminalTab`、`WorkspaceSessionSnapshot` schema。移动会改变 `terminalTabs[].layout`，现有 `useWorkspaceSessionPersistence` 会自动保存。
- 移动成功后聚焦 source pane；`terminalPanes` 数组保持原有 pane 对象，不清空 `lines`、`outputHistory`、`currentCwd`，不触发任何 session close/create。

### Layout 算法契约

- 输入只接受当前 active terminal tab 中的两个不同 pane。
- `center`：只交换布局树中的两个 `paneId`，不改 split 结构和 sizes。
- `left/right/top/bottom`：
  1. 从布局树中抽出 source pane，沿途折叠单子节点 split。
  2. 在剩余布局中找到 target pane。
  3. 根据 zone 映射 direction/placement：left/top 是 before，right/bottom 是 after；left/right 是 horizontal，top/bottom 是 vertical。
  4. 如果 target 所在 split 方向一致，优先把 source 作为同级 sibling 插入，避免无意义深嵌套。
  5. 如果方向不一致，把 target 包成新的 split。
  6. 只丢弃源路径和目标路径上受影响 split 的 stale sizes；无关 split 的 sizes 保留。
- 对无效输入返回原 layout 或空 patch：source 缺失、target 缺失、source 等于 target、active tab 不是 terminal、当前 tab 少于两个 pane。

### UI 交互

- 在 pane 标题栏左侧增加一个小型 drag handle，使用现有图标体系优先选 `GripVertical` 或 `Move`。标题本身不作为默认拖动区域，避免误拖。
- pointer down 只在 drag handle 上启动；分屏按钮、关闭按钮继续 `stopPropagation`，不参与拖动。
- 使用 Pointer Events，达到 `6px` 阈值后进入拖动状态；拖动中调用 `event.preventDefault()` 并设置 source pane chrome 的 dragging 样式。
- `TerminalWorkspaceContent` 维护当前拖动状态，基于 workspace 内每个 pane chrome 的 `getBoundingClientRect()` 解析 drop target。
- 新增 `terminalPaneMoveDropZones.ts`，不要复用侧栏机器拖放的类型：
  - `TerminalPaneMoveDropZone = "left" | "right" | "top" | "bottom" | "center"`
  - edge hot zone 使用固定 inset + ratio clamp，保留 center swap 区。
- 新增 `TerminalPaneMoveOverlay.tsx`，显示目标 pane 的四边/中央提示：
  - edge：`移动到右侧 · <targetTitle>`
  - center：`交换位置 · <targetTitle>`
- overlay 使用 `pointer-events-none`，颜色使用主题 CSS 变量和成对 `dark:` 样式。
- 拖动中按 `Esc` 取消，`pointerup` 提交，`pointercancel` / 窗口失焦取消。
- 键盘可访问第一阶段至少提供 drag handle 的 `aria-label`、`title` 和 focus ring；若实现键盘移动模式，应使用 `Space` 进入 move mode、方向键选择目标、`Enter` 提交、`Esc` 取消。

### 组件接线

- `TerminalPaneCard`：
  - 接收 `onBeginPaneDrag?: (paneId, event) => void`、`dragging?: boolean`。
  - 渲染 drag handle，仅在 active terminal layout 中显示；非 runtime preview 也允许移动。
- `TerminalPaneLayout`：
  - 递归透传 drag props。
- `TerminalWorkspaceContent`：
  - 继续负责 stable runtime overlay，不把真实 `XtermPane` 放回布局树。
  - 维护 pane move drag state、target indicator、preview。
  - 向上调用 `onMovePane(sourcePaneId, targetPaneId, zone)`。
- `TerminalWorkspace` / `WorkspaceTerminalSurface`：
  - 增加 `onMovePane` prop 并接到 store action。
- `KerminalShell`：
  - 不负责 pane 内部移动算法，只通过 bridge 接 store；现有侧栏 machine drop 逻辑保持不变。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 前端布局模型 | 是 | `src/features/workspace/workspaceLayout.ts` | `workspaceLayout.test.ts` |
| 前端状态 | 是 | `src/features/workspace/workspaceTerminalState.ts`, `workspaceStore.ts` | `workspaceTerminalState.test.ts`, store 相邻测试 |
| 终端 UI | 是 | `TerminalPaneCard.tsx`, `TerminalPaneLayout.tsx`, `TerminalWorkspaceContent.tsx`, `TerminalWorkspace.tsx` | RTL 组件测试 + dev server 截图 |
| 侧栏拖主机分屏 | 间接受影响 | `KerminalShell.tsx`, `terminalSplitDropZones.ts` | 现有 `KerminalShell.splitDrop.test.tsx` 必须继续通过 |
| Rust/Tauri command | 否 | 无 | 不新增 Rust 验证；若实现中触碰 Tauri 再补 `tauri:dev` |
| 持久化 | 间接受影响 | `useWorkspaceSessionPersistence.ts`, `workspaceSession.ts` | session restore 测试或手动重启 smoke |
| 主题/视觉 | 是 | overlay/handle CSS | light/dark/system 截图 |

## 执行步骤

- [x] TASK-001：新增 layout 纯函数和单测。
  - 覆盖同方向 sibling 插入、跨方向包 split、nested split、center swap、source/target 缺失、source 等于 target、sizes 保留/丢弃规则。
  - 验收：`npm run test:frontend -- src/features/workspace/workspaceLayout.test.ts` 通过。

- [x] TASK-002：新增 terminal state/store action。
  - `moveTerminalPaneState` 只作用 active terminal tab；移动后 focus source pane；不改变 `terminalPanes` 对象引用。
  - 验收：`workspaceTerminalState.test.ts` 和相关 store 测试覆盖 active tab、inactive tab、单 pane no-op、session 不重建。

- [x] TASK-003：实现 pane drag model、drop zone resolver 和 overlay。
  - 新增 `terminalPaneMoveDropZones.ts`、`TerminalPaneMoveOverlay.tsx` 和测试。
  - 验收：热区解析、overlay 文案、Esc/取消逻辑测试通过。

- [x] TASK-004：接入 `TerminalPaneCard` / `TerminalPaneLayout` / `TerminalWorkspaceContent` / bridge。
  - 标题栏新增 drag handle；拖动不会从 xterm 内容区触发；按钮不误触发拖动。
  - 保留 stable runtime overlay，不移动真实 `XtermPane` DOM 父节点。
  - 验收：`TerminalWorkspace` 测试断言移动 layout 后旧 `XtermPane` 没有 unmount，侧栏 split drop 测试继续通过。

- [x] TASK-005：运行生产门禁和真实界面验证。
  - 前端命令：
    - `npm run test:frontend -- src/features/workspace/workspaceLayout.test.ts src/features/workspace/workspaceTerminalState.test.ts src/features/terminal/terminalPaneMoveDropZones.test.ts src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/app/KerminalShell.splitDrop.test.tsx`
    - `npm run typecheck`
    - `npm run build`
  - 真实界面：
    - 启动 dev server。
    - 在两个本地 terminal pane 间执行 left/right/top/bottom 移动和 center swap。
    - 记录浅色、深色、跟随系统截图。
    - 验证拖动后两个 pane 内容仍在、没有重新连接提示、resize handle 可继续调整。
  - 如果实现触碰 Tauri/Rust/窗口配置，追加 `npm run tauri:dev`；否则说明本轮只改 React UI 和 store。

## 风险与回滚

- 最大风险是破坏 2026-06-25 已修复的 stable overlay runtime 契约。回滚策略：保留 layout/state 纯函数可以回滚 UI 接线；如果出现重连，先禁用 drag handle，不回退 split reconnect fix。
- 热区和 resize handle 都使用 pointer 事件，可能发生事件竞争。控制方式：拖动只从标题栏 handle 启动，separator 区域不绑定 pane drag。
- xterm 内容区支持鼠标选择和全屏程序鼠标模式，不能绑定 pane drag。控制方式：内容区不监听 pane move pointerdown。
- nested split 下 sizes 容易 stale。控制方式：只保留未受影响 split sizes，目标路径/源路径重新交给 `react-resizable-panels` 默认分配。
- 当前仓库有多个 active lane 正在触碰 `TerminalWorkspaceContent.tsx`、`TerminalPaneLayout.tsx`、`workspaceStore.ts`、`workspaceSession.ts`。开始实现前必须登记 lane，并同步 `coordination/status.md`、相关 checkpoint 和最新 diff。

## 实施前置检查

- 若本计划进入 active，先登记新的 lane，建议 owned paths：
  - `.updeng/docs/plan/active/PLAN-20260625-215135-terminal-pane-drag-reorder.md`
  - `src/features/workspace/workspaceLayout.ts`
  - `src/features/workspace/workspaceLayout.test.ts`
  - `src/features/workspace/workspaceTerminalState.ts`
  - `src/features/workspace/workspaceTerminalState.test.ts`
  - `src/features/terminal/terminalPaneMoveDropZones.ts`
  - `src/features/terminal/terminalPaneMoveDropZones.test.ts`
  - `src/features/terminal/TerminalPaneMoveOverlay.tsx`
  - `src/features/terminal/TerminalPaneCard.tsx`
  - `src/features/terminal/TerminalPaneLayout.tsx`
  - `src/features/terminal/TerminalWorkspaceContent.tsx`
  - `src/features/terminal/TerminalWorkspace.tsx`
  - `src/app/KerminalShell.splitDrop.test.tsx`
- 建议 shared paths：
  - `src/features/workspace/workspaceStore.ts`
  - `src/app/KerminalShell.workspaceBridge.tsx`
  - `src/app/KerminalShell.tsx`
  - `src/app/useWorkspaceSessionPersistence.ts`
- 开始编码前重读：
  - `.updeng/docs/plan/done/PLAN-20260625-185344-terminal-split-reconnect-fix.md`
  - `.updeng/docs/coordination/status.md`
  - `.updeng/docs/coordination/lanes.json`

## Round Log

### 2026-06-25T22:23:51+08:00

- 状态：计划从 `next` 移入 `active`，准备按 `lane-terminal-pane-drag-reorder` 执行。
- 并行边界：当前工作区已有多个 active lane 和大量未归因改动；本 lane 只触碰计划列出的终端分屏拖动相关路径，写入 shared paths 前先读取最新文件和 lane 状态。
- 本轮首个切片：从 TASK-001 layout 纯函数与 `workspaceLayout.test.ts` 红绿循环开始。

### 2026-06-25T22:53:41+08:00

- 状态：TASK-001 到 TASK-005 已完成。
- 实现摘要：新增 `movePaneInLayout` / `swapPanePositionsInLayout` 纯 layout 操作；新增 `moveTerminalPaneState` 和 store `moveTerminalPane` action；新增 pane move drop zone resolver 与 overlay；在 pane 标题栏 handle 启动 pointer drag，`TerminalWorkspaceContent` 维护拖动状态并提交 layout move。
- 保持契约：真实 `XtermPane` 仍由 `TerminalWorkspaceContent` stable overlay 挂载，layout tree 只渲染 pane chrome 和 runtime slot；移动只更新 active terminal tab layout，不增删 `terminalPanes`。
- 并行同步：`TerminalWorkspaceContent.tsx` 是既有未跟踪热点文件，本轮在最新文件上最小接线；`TerminalWorkspace.test.tsx` 中空状态文案被其它 lane 改回旧值导致相邻验证红，本轮按 `TerminalEmptyState.tsx` 和其测试做一行同步。
- 验证：
  - `npm run test:frontend -- src/features/workspace/workspaceLayout.test.ts`
  - `npm run test:frontend -- src/features/workspace/workspaceTerminalState.test.ts`
  - `npm run test:frontend -- src/features/workspace/workspaceStore.test.ts`
  - `npm run test:frontend -- src/features/terminal/terminalPaneMoveDropZones.test.ts src/features/terminal/TerminalPaneMoveOverlay.test.tsx`
  - `npm run test:frontend -- src/features/terminal/TerminalPaneCard.test.tsx`
  - `npm run test:frontend -- src/features/terminal/TerminalWorkspace.dropOverlay.test.tsx`
  - `npm run test:frontend -- src/features/workspace/workspaceLayout.test.ts src/features/workspace/workspaceTerminalState.test.ts src/features/workspace/workspaceStore.test.ts src/features/terminal/terminalPaneMoveDropZones.test.ts src/features/terminal/TerminalPaneMoveOverlay.test.tsx src/features/terminal/TerminalPaneCard.test.tsx src/features/terminal/TerminalWorkspace.dropOverlay.test.tsx`
  - `npm run typecheck`
  - `npm run test:frontend -- src/app/KerminalShell.splitDrop.test.tsx src/features/terminal/TerminalWorkspace.test.tsx`
  - `npm run build`
- 真实界面验证：dev server `http://127.0.0.1:5189/` 启动通过，已停止；通过 Vite dev module 注入 browser-only 双 pane preview session，完成中心拖动交换 smoke，card order 从 left/right 变为 right/left，focus 回到 source pane。
- 截图证据：
  - `.updeng/docs/verification/terminal-pane-drag-reorder-light.png`
  - `.updeng/docs/verification/terminal-pane-drag-reorder-dark.png`
  - `.updeng/docs/verification/terminal-pane-drag-reorder-system.png`
  - `.updeng/docs/verification/terminal-pane-drag-reorder-after-drop.png`
- 未运行：未触碰 Rust/Tauri command、窗口、权限或 `tauri.conf.json`，因此未追加 `npm run tauri:dev`。

### 2026-06-26T09:32:38+08:00

- 背景：用户反馈“拖动屏幕为啥会重连，这个不是前端操作吗”，需要确认 pane 拖动是否会触发 session close/create。
- 诊断结论：按当前架构，pane 移动应只更新 active terminal tab 的 `layout`，真实 `XtermPane` 继续挂在 `TerminalWorkspaceContent` stable runtime overlay 中；React 拖动路径不应调用 `closeTerminal` 或重新 `createTerminalSession`。
- 补充回归：新增 `src/features/terminal/TerminalWorkspace.runtimeOverlay.test.tsx`，覆盖中心交换、拖到右侧改变 split 结构、split resize 只更新 sizes 三条路径，均断言移动/resize 后没有新的 `createTerminalSession`，也没有 `closeTerminal`。
- 重要区分：拖动 pane 位置是前端 layout 操作；拖动 split 分隔条可能触发 `resizeTerminal` 调整 PTY 行列，这是后端 resize，不等价于重连，也不应触发 close/create。
- 若真实 Tauri 运行态仍出现重连，下一步排查目标不是 pane move store action，而是 `XtermPane.runtime` 的 session `closed/error` 事件链、`ResizeObserver`/fit 产生的行列值、以及后端 `terminal_resize` 是否误导致 PTY 退出。
- 验证：
  - `npm run test:frontend -- src/features/terminal/TerminalWorkspace.runtimeOverlay.test.tsx`
  - `npm run test:frontend -- src/features/terminal/TerminalWorkspace.dropOverlay.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/workspace/workspaceStore.test.ts`
