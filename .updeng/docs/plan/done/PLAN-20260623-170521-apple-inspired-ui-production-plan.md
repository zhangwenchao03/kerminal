---
id: PLAN-20260623-170521-apple-inspired-ui-production-plan
status: done
created_at: 2026-06-23T17:05:21+08:00
started_at: 2026-06-23T17:05:21+08:00
completed_at: 2026-06-23T20:30:41+08:00
updated_at: 2026-06-23T20:30:41+08:00
owner: ai
---

# Kerminal Apple-inspired 生产级 UI 与多主机工作台方案

## 目标

本方案面向下一轮可落地实现，不是重新做一次泛泛的视觉美化。Kerminal 已经在 2026-06-20 完成过 Apple-inspired UI overhaul，当前代码也已经具备 `--surface-*`、`--motion-*`、`kerminal-*` 基础材质类、`useDocumentTheme` 主题传播和终端/主机/工具面板的主要产品能力。下一轮目标是把这些基础收敛成生产级工作台体验：

- 用 Apple 设计理念里的清晰、克制、层级、系统感和直接反馈，服务终端、远程主机、SFTP、AI、日志和设置这些高密度生产场景。
- 把“分屏到不同主机”和“发送命令到不同主机”做成 Kerminal 的核心工作流，而不是隐藏在右键菜单里的功能。
- 分屏、发送、关闭、切换等高频动作优先使用图标按钮；按钮用 accessible label、tooltip、稳定命中区补足可用性，不在工具栏塞长文字。
- 普通多目标发送不再弹确认框，按下发送即执行；风险提示放在输入栏、目标条和审计记录里，不用阻断式弹窗打断高频操作。
- 继续坚持 light、dark、system 三主题和 portal/独立窗口主题继承；任何 UI 改动都要有真实启动和截图证据。

## 非目标

- 不复制 Apple 品牌资产、图标、文案或系统 UI 细节。
- 不把终端正文、日志、文件列表、设置表单做成玻璃层，正文区域必须稳定、清晰、可读。
- 不引入大面积渐变、发光、装饰背景、营销 hero 或通用后台 dashboard 风格。
- 不一次性重写所有组件；所有改动按可验证切片推进。
- 不改变已有 SSH/SFTP/AI 安全策略的底层边界；本方案只定义 UI 和工作流落点，涉及后端策略时另开实现切片。

## 调研更新

本轮重新对齐 Apple 官方设计资料和项目现状。调研来源：

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)：强调平台一致性、清晰层级、可访问性、内容优先和用户可理解的控件语义。
- [Apple Design Resources](https://developer.apple.com/design/resources/)：推荐使用系统字体、SF Symbols 风格的轻量图标、平台模板和统一设计资源。
- [Apple HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)：材质用于表达层级和保留上下文，不是给所有内容层加模糊。
- [WWDC 2025 Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)、[WWDC 2025 Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/) 和 [Apple Liquid Glass 新闻稿](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)：新材质强调动态、亮暗模式适配、界面让位于内容、导航和浮层承担空间层级。
- Kerminal 现有文档：`.updeng/docs/reports/2026-06-20-apple-inspired-ui-research.md`、`.updeng/docs/plan/done/2026-06-20-apple-inspired-ui-overhaul.md`、`.updeng/docs/plan/done/PLAN-20260622-202049-transparent-window-material.md`。
- 当前代码入口：`src/App.css`、`src/lib/useDocumentTheme.ts`、`src/app/KerminalShell.tsx`、`src/features/terminal/TerminalWorkspace.tsx`、`src/features/terminal/TerminalBroadcastBar.tsx`、`src/features/workspace/types.ts`、`src/features/machine-sidebar/MachineSidebar.tsx`、`src/features/tool-panel/ToolPanel.tsx`、`src/features/settings/SettingsDialog.tsx`。

对 Kerminal 的解释：

- Apple-like 不是“更多玻璃”，而是“用户一眼知道当前在哪里、操作会影响哪个主机、哪些内容正在运行、哪些动作有风险”。
- 生产工具的高级感来自真实状态和可预测反馈：连接状态、延迟、生产标记、当前 pane、目标数量、命令发送结果、SFTP 传输速度、AI 上下文来源。
- 终端和文件列表必须是视觉中心，导航、工具栏、浮层、目标选择器和命令面板才使用 glass 或 elevated material。
- 高频操作不应靠长文字解释。分屏、发送、关闭、更多、搜索、刷新、上传、下载、设置等优先图标化，辅以 tooltip、aria-label 和稳定键盘路径。

## 当前基线

### 已有基础

- `src/App.css` 已经定义 `--surface-page`、`--surface-terminal`、`--surface-solid`、`--surface-overlay`、`--surface-floating-glass`、`--surface-hover`、`--surface-selected`、`--border-subtle`、`--shadow-floating`、`--motion-fast`、`--motion-menu`、`--motion-panel` 等 token。
- `useDocumentTheme` 会把 `dark` class、`data-theme`、`data-density`、`data-language` 和 `lang` 写到 `document.documentElement`，portal 主题继承基础正确。
- `Button`、`ModalShell`、`Select` 等基础控件已经接入 `kerminal-focus-ring`、`kerminal-pressable`、`kerminal-floating-surface`、`kerminal-field-surface`。
- `TerminalPane` 已有 `machineId`、`mode`、`target`、`remoteHostId`、`remoteHostProduction`、`latencyMs`，可以承载多主机分屏和多目标发送。
- `TerminalWorkspace` 已经能收集 active tab 的 pane ids，并由 `TerminalBroadcastBar` 发送到目标 pane。
- `MachineSidebar` 已经有分组、拖拽、context menu、collapsed popover、打开会话等能力。

### 主要缺口

- 分屏按钮当前只有“左右分屏”和“上下分屏”，默认行为不清楚地表达“复制当前主机”还是“选择其他主机”。
- 发送栏当前显示“向所有分屏发送命令”和目标数量，但没有清晰的目标选择、目标预览、生产主机提示和按主机分组发送模式。
- 广播发送体验容易走向确认弹窗或阻断式提示，不适合高频运维；需要改成直接发送、内联风险、事后审计。
- 当前 Apple-inspired token 已经存在，但仍需要生产级 contract：哪些地方可玻璃化、哪些必须 solid、哪些 token 不允许绕过。
- 历史 Apple UI overhaul 已完成一次全局迁移，下一轮重点不应是继续扫旧 class，而是建立可长期执行的设计系统和工作流实现边界。

## 设计原则

### 1. 内容和目标优先

用户在 Kerminal 里最关心的是“当前命令会发到哪里”。任何分屏和发送设计都要优先展示：

- 当前 focused pane。
- 每个 pane 的主机名、协议、生产标记、连接状态和延迟。
- 广播目标数量和目标列表。
- 命令输入是否会发送回车。
- 发送成功、失败和缺失 session 的结果。

### 2. 材质只表达层级

材质分为四层：

| 层级 | Token / class | 用途 | 禁止 |
| --- | --- | --- | --- |
| App background | `--surface-page` | 主窗口背景 | 不放主要内容 |
| Navigation glass | `kerminal-material-nav` | titlebar、sidebar、rail、tabbar、目标工具条 | 不叠多层 glass |
| Solid content | `--surface-terminal`、`kerminal-solid-surface` | terminal、日志、文件列表、设置 row、AI 消息列表 | 不加 blur |
| Floating overlay | `kerminal-floating-surface`、`--surface-overlay` | 菜单、popover、目标选择器、dialog、command palette | 不遮挡关键状态 |

### 3. 高频动作用图标，低频风险动作保留文字

- 分屏、发送、关闭、搜索、刷新、更多、设置、上传、下载、复制等高频动作使用图标按钮。
- 图标按钮必须有 `aria-label`、`title` 或 tooltip，命中区 32px 到 36px，不能因为 hover 文案导致布局跳动。
- 危险动作、不可逆动作和首次配置动作可以使用图标加短文本，但不放在高频工具栏中段。
- 当前用户明确反馈：分屏去掉文字，发送按钮保留图标。因此 `TerminalBroadcastBar` 的 split/send 按钮应默认只显示图标。

### 4. 普通发送直接执行，风险内联表达

- 普通命令发送不弹确认框，点击发送图标或按 Enter 直接发送到当前选中的目标集合。
- 输入栏旁边展示目标 chip，例如 `3 targets`、`prod 1`、`ssh 2`，点击可打开目标选择器。
- 如果命令策略判定不能发送，发送按钮禁用并在栏内显示原因，不弹阻断式确认框。
- 如果包含生产主机，目标 chip 使用 restrained warning state，发送仍由配置策略决定；如果策略允许，则不弹框。
- 所有发送结果进入状态条和审计记录：sent pane ids、missing pane ids、command summary、target summary、timestamp。

### 5. 动效解释空间关系

- hover/press：100ms 到 150ms，只改变背景、opacity、轻微 scale。
- menu/popover：120ms 到 180ms，fade + scale + 小位移。
- split layout：180ms 到 280ms，让用户看清 pane 如何出现。
- reduced motion 下关闭 scale/translate，只保留状态变化。
- xterm 输出不做装饰动效。

## 核心产品方案：多主机分屏与多目标发送

### 用户模型

Kerminal 的用户不只是在一个 terminal 里工作，而是在一个 tab 内同时观察和操作多个目标：

- 本地 shell。
- SSH 主机。
- Telnet / Serial。
- Docker / Podman container。
- 未来的 preview 或远程工作区 pane。

因此应把 active tab 理解为“目标矩阵”，把 pane 理解为“可执行目标”，把发送栏理解为“对目标矩阵的命令控制台”。

### 分屏入口

工具栏只保留图标：

- `Columns2`：左右分屏。
- `PanelBottom`：上下分屏。
- `X` 或现有关闭图标：关闭当前分屏。

默认点击行为：

- 在当前 focused pane 旁边新建一个同目标 pane。
- 本地 pane 复制 shell/profile/cwd。
- SSH/Telnet/Serial pane 复制对应 machine target。
- Container pane 复制 container target。

扩展选择行为：

- 长按或右键分屏图标，打开“选择目标分屏”popover。
- 从主机侧边栏拖一台主机到终端区域的左/右/上/下 hot zone，直接以该主机创建 split pane。
- 在目标选择器里选择主机后，点击左右/上下图标创建“不同主机分屏”。

目标 popover 信息结构：

- 顶部搜索主机。
- 最近使用。
- 已打开目标。
- 生产主机单独标记。
- 分组列表。
- 每行显示协议图标、主机名、用户名/host、状态点、生产 badge。

验收标准：

- 用户只点图标时不会被额外选择打断。
- 用户想分屏到别的主机时，不需要先打开新 tab 再拖拽，可以从 split popover 或主机拖拽完成。
- 图标按钮没有可见文字，但 screen reader、tooltip 和测试 role label 都清楚。

### 多目标发送入口

发送栏结构：

```text
[split left icon] [split bottom icon] [close pane icon] [target selector chip] [command input] [send icon]
```

目标 selector chip：

- 默认：`All panes` 或 `3 targets`。
- 有生产主机：`3 targets · prod 1`。
- 仅当前 pane：`Focused`。
- 自定义目标：`Selected 2`。

点击 chip 打开目标选择器：

- `Focused pane`：只发当前 pane。
- `All panes in tab`：发当前 tab 全部分屏。
- `All same host`：发到当前 tab 内同一 host 的 pane。
- `Custom`：勾选具体 pane。
- 未来可扩展 `Host group`：发到某分组已打开的所有 pane。

输入行为：

- Enter 直接发送。
- Shift+Enter 可插入换行或保留未来多行编辑能力。
- 发送后保持输入焦点，方便连续发命令。
- 发送按钮只显示 `Send` 图标，tooltip 显示“发送到 3 个目标”。

发送结果：

- 成功：短状态条 `Sent to 3 targets`，2 秒后淡出。
- 部分失败：状态条展示 `Sent 2, missing 1`，可展开详情。
- 策略阻断：栏内错误 `This command is blocked by policy`，不弹确认框。

验收标准：

- 普通发送无确认弹窗。
- 目标选择器打开后不遮挡输入和 active pane 状态。
- 生产主机风险可见，但不通过弹窗打断高频路径。
- 发送行为可测试：request 包含 `targetPaneIds`、`command`、`data`。

### “矩阵模式”

当一个 tab 内分屏超过 3 个，或者用户打开目标选择器时，提供矩阵预览：

```text
host-a       ssh    online    prod
host-b       ssh    online
local        local  online
container-x  docker online
```

矩阵模式不是默认弹窗，而是目标 selector popover 的高级视图。它只用于选择发送目标和确认当前 tab 的主机结构，不阻断发送。

## 组件与文件落点

### Design tokens

文件：

- `src/App.css`

任务：

- 保持现有 `--surface-*`、`--motion-*`、`kerminal-*` token，新增只能补语义，不再回到组件内硬编码大量 `bg-white/*`、`bg-black/*`。
- 补充目标相关 token：
  - `--surface-target-chip`
  - `--surface-target-chip-warning`
  - `--border-target-warning`
  - `--target-prod-text`
- 保证 light/dark/system 都有值。

验收：

- `rg "bg-white/|bg-black/|border-white/|border-black/"` 对本轮 touched 文件无新增命中，语义状态色例外需在 Round Log 说明。

### Terminal broadcast

文件：

- `src/features/terminal/TerminalBroadcastBar.tsx`
- `src/features/terminal/broadcastCommandPolicy.ts`
- `src/features/terminal/TerminalWorkspace.tsx`
- `src/features/terminal/TerminalWorkspace.broadcast.test.tsx`

任务：

- 分屏按钮和发送按钮保持 icon-only。
- 增加 `targetMode`、`selectedTargetPaneIds` 或等价状态模型。
- 增加 target selector chip 和 popover。
- 普通发送不弹确认框。
- 把 production pane、missing pane、blocked command 的提示放到栏内状态。

验收：

- Enter 发送到目标集合。
- 自定义目标发送只影响勾选 pane。
- 生产主机目标 chip 可见。
- 发送按钮 disabled 只由 policy / empty command / sending 决定。

### Terminal workspace layout

文件：

- `src/features/terminal/TerminalWorkspace.tsx`
- `src/features/terminal/TerminalPaneLayout.tsx`
- `src/features/workspace/workspaceStore.ts`
- `src/features/workspace/workspaceSession.ts`

任务：

- 分屏默认复制 focused pane target。
- 支持传入目标 machine 创建新 split pane。
- 侧边栏拖拽到终端 hot zone 时创建 split pane。
- 记录 pane target metadata，保证恢复 session 后目标选择器能展示正确主机。

验收：

- 当前 pane 是 SSH 时，左右分屏默认打开同 SSH 主机。
- 从 MachineSidebar 拖另一台 SSH 主机到右侧 hot zone，会创建不同主机 pane。
- 恢复 workspace 后，各 pane 的 target chip 仍正确。

### MachineSidebar

文件：

- `src/features/machine-sidebar/MachineSidebar.tsx`
- `src/features/machine-sidebar/MachineSidebar.parts.tsx`

任务：

- 主机行可拖到 terminal split hot zone。
- collapsed sidebar 的 popover 也支持拖拽和右键。
- 主机行保留 source-list 风格：icon、name、description、status、prod badge。
- 不增加大量说明文字。

验收：

- 拖拽 preview 使用 `--surface-overlay`，不遮挡指针。
- hot zone 出现方向提示，但不造成 terminal 内容跳动。
- light/dark/system 下拖拽态可读。

### Floating surfaces and portal

文件：

- `src/components/ui/modal-shell.tsx`
- `src/components/ui/select.tsx`
- 未来新增 `TargetSelectorPopover` 或同等组件。

任务：

- 目标选择器、菜单、dialog 全部继承 document theme，不在 portal 根手动写固定 dark/light。
- Escape 和 outside click 关闭 popover。
- xterm/editor 拦截键盘时，Escape 需要捕获阶段兜底。

验收：

- `MachineSidebar.test.tsx` 现有 portal theme 用例继续通过。
- 新增 target selector theme 测试。
- 目标选择器 z-index 高于 terminal pane，不被 xterm 覆盖。

## 分阶段实施

### P0：设计系统和当前状态审计

目标：

- 固化当前 UI 与多主机发送现状。
- 明确不新增弹窗确认的发送策略。

任务：

- 记录当前 `TerminalBroadcastBar`、`TerminalWorkspace`、`MachineSidebar` 和 `workspace/types` 的行为。
- 对照当前 `App.css` token，列出新增 token 和禁止新增硬编码色。
- 补一张设计说明图或文档截图说明发送栏结构。

验证：

- 文档审查通过。
- 不改代码或只增加测试 skeleton。

### P1：分屏按钮 icon-only 和目标 selector 第一版

目标：

- 保留当前高频分屏操作，同时给“分屏到别的主机”提供入口。

任务：

- `TerminalBroadcastBar` 保持 split icon-only。
- 新增 target selector chip，但第一版只支持 `Focused` / `All panes`。
- 发送按钮 tooltip 根据目标数量变化。

验证：

- `npm run test:frontend -- src/features/terminal/TerminalWorkspace.broadcast.test.tsx`
- `npm run build`
- dev server 截图：dark/light/system 下发送栏无文字溢出。

### P2：自定义发送目标

目标：

- 发送命令到不同主机时可明确选择目标集合。

任务：

- target selector popover 展示 active tab 内所有 pane。
- 支持勾选 pane。
- 显示 host/protocol/status/production。
- 发送 request 只携带勾选 pane ids。

验证：

- 前端测试覆盖 custom target。
- 发送后状态条显示 sent/missing。
- 无确认弹窗。

### P3：分屏到其他主机

目标：

- 用户能直接把当前 tab 分屏到另一台主机。

任务：

- split popover 支持主机搜索和选择。
- `onSplitPane` 扩展为带 target options，或新增 `onSplitPaneWithMachine`，具体命名跟现有 workspace store 风格一致。
- MachineSidebar 拖拽到 terminal hot zone 创建 split pane。

验证：

- 单元测试覆盖 SSH/Telnet/Serial/Container target。
- dev server 截图覆盖拖拽提示和 split popover。
- 如涉及真实 session 创建：`npm run tauri:dev` smoke。

### P4：生产主机风险可见但不弹窗

目标：

- 满足“发送不用确认弹框”，同时生产主机风险不会变成隐形。

任务：

- target chip 显示 production count。
- status bar 显示最后一次发送目标摘要。
- 审计记录写入 target summary。
- policy blocked 仍以内联错误阻断，不弹确认。

验证：

- production pane 目标 chip 可见。
- 普通发送无 dialog。
- blocked command 不发送，栏内显示原因。

### P5：视觉 QA 和真实启动收口

截图矩阵：

- desktop dark：本地 + SSH 双分屏，发送栏 focused。
- desktop light：target selector popover。
- system dark：split host popover。
- narrow：侧栏 collapsed + target selector。
- production host：target chip warning。

命令验证：

- `npm run test:frontend -- src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/machine-sidebar/MachineSidebar.test.tsx`
- `npm run build`
- `npm run dev` 真实截图 smoke。
- 如果改到 Tauri session/open terminal：`npm run tauri:dev`。

## 生产验收门禁

### 行为门禁

- 分屏按钮和发送按钮不显示长文字，只显示图标。
- 所有 icon-only button 都有 accessible name 和 tooltip。
- 普通发送不出现确认弹窗。
- 用户可以发送到 focused、all panes、自定义 pane 集合。
- 用户可以分屏到当前主机，也可以选择或拖拽其他主机创建分屏。
- 生产主机目标清晰可见。
- policy blocked 的命令不会发送，并给出内联原因。

### 视觉门禁

- 终端正文为 solid surface，不能玻璃化。
- 目标选择器为 floating overlay，light/dark/system 可读。
- hover、active、focus、disabled、sending、error、success 状态完整。
- 390px、780px、1024px、1440px 下工具栏不重叠，命令输入不被挤没。
- `prefers-reduced-motion` 下不出现位移和 scale 动效。

### 工程门禁

- 修改前继续优先用 CodeGraph 理解相关符号。
- 每个切片只改必要文件，不宽泛格式化共享热点文件。
- 前端改动至少跑 `npm run build` 和真实 dev server smoke。
- 涉及 Tauri/Rust/session/open terminal 时跑 `npm run tauri:dev`，无法运行时记录原因。
- 只 stage 本轮实际修改文件，禁止 `git add -A`。

## 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
| --- | --- | --- | --- |
| 自定义目标选择状态复杂 | 发送目标错乱 | 先做 focused/all panes，再做 custom；测试锁定 targetPaneIds | 回到 all panes 默认发送 |
| 取消确认弹窗后误发 | 生产风险 | 目标 chip、production badge、policy inline block、审计记录 | 设置项临时恢复 confirmation policy |
| 拖拽 split 与侧栏拖拽排序冲突 | 操作误触 | 明确 drag intent threshold 和 terminal hot zone | 保留 popover 选择，关闭拖拽 split |
| portal 浮层主题丢失 | light/dark 不可读 | 复用 document theme，不局部挂 dark | 回滚新增 portal，保留 inline chip |
| TerminalWorkspace 文件继续膨胀 | 可维护性下降 | 新增 target selector 独立组件和测试文件 | 拆组件，不把状态全塞主文件 |

## 设计评分卡

每个实现切片完成后按 1 到 5 打分，低于 4 不收口：

| 项 | 标准 |
| --- | --- |
| 清晰度 | 用户是否一眼知道命令发到哪些主机 |
| 克制 | 是否避免长文字、重边框、过度 glass |
| 目标可见 | focused/all/custom/prod 状态是否明确 |
| 操作效率 | 高频分屏和发送是否少点击、不弹窗 |
| 可访问性 | icon-only button 是否有 label、tooltip、focus |
| 主题质量 | light/dark/system 是否全部可读 |
| 工程可测 | targetPaneIds、split target、blocked policy 是否可测试 |

## Round Log

### 2026-06-23 Round 1：方案写入

状态：已完成方案写入；后续 Round 进入实现。

输入：

- 用户要求按 Apple 设计理念再调研，并输出生产级完整方案到文档。
- 用户此前明确偏好：分屏按钮去掉文字保留图标；发送按钮保留图标；发送命令不用确认弹框，直接发送。
- 当前代码已存在 Apple-inspired material token、terminal broadcast bar、pane target model 和 portal theme 继承基础。

本轮产出：

- 新增本方案文档。
- 登记 active lane。
- 已同步 `plan/INDEX.md` 和 `.updeng/docs/in-progress.md`。

### 2026-06-23 Round 2：并行实现启动

状态：已完成本轮集成和验证；P1/P2/P3/P4 的基础切片可复核，P3 的拖拽 hot zone 和 split 主机选择 popover 留到后续切片。

本轮目标：

- 先落地 P1/P2/P3 的可验证基础，不把“完整计划”缩小成单个 UI 微调。
- 广播目标选择和 workspace split 状态模型并行推进，主线程负责集成和门禁。

并行任务：

- Worker `019ef414-b798-7893-baf0-3daf0868e548`：负责 `TerminalBroadcastBar` / `TerminalWorkspace` 的 target selector、Focused / All panes / Custom 目标选择、生产主机提示、无确认弹窗发送和 `TerminalWorkspace.broadcast.test.tsx`。
- Worker `019ef414-f7b5-77d1-9715-be816935a72f`：负责 `workspaceTerminalState` / `workspaceStore` / `workspaceSession` / `types` 的 split target 状态模型和测试，确认当前 focused pane target 复制行为，并为“分屏到其他主机”预留最小 public 契约。

同步协议：

- 两个 worker 不互改对方 owned files，不宽泛格式化。
- 主线程在合并前读取最新 diff；如同文件冲突，优先保留行为测试和较小 public 契约。
- 本轮验证优先：`npm run test:frontend -- src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/workspace/workspaceStore.terminalTabs.test.ts`，随后 `npm run build`；UI 变更后还需 dev server screenshot smoke。

本轮集成结果：

- `TerminalBroadcastBar`：分屏、关闭当前分屏和发送按钮改为 icon-only 方形按钮；发送按钮 tooltip / aria-label 按目标数量动态显示；普通发送仍直接执行，不弹确认框。
- `TerminalBroadcastTargetSelector` / `terminalBroadcastTargets`：新增 Focused / All panes / Custom 目标模型，目标 popover 显示 pane title、machine id、协议和 production 状态；用户可从目标 chip 切换当前分屏、全部分屏或自定义勾选。
- `TerminalWorkspace`：按 active tab 真实可发送 pane 推导目标集合，发送 request 只携带当前选择的 `targetPaneIds`；发送结果以内联状态条展示。
- `workspaceTerminalState` / `workspaceStore`：默认分屏复制 focused pane 的 target；`splitFocusedPane(direction, { targetMachineId })` 支持按已有 local / ssh / telnet / serial / container machine 创建不同主机 split pane。
- `TerminalWorkspace.broadcast.test.tsx`：覆盖默认全量发送、当前分屏发送、自定义目标发送、production 目标内联提示、telnet/serial 发送和无真实终端禁用。
- `workspaceStore.terminalTabs.test.ts`：覆盖 SSH/Telnet/Serial/Container focused target 复制，以及显式 `targetMachineId` 分屏到不同主机。

验证：

- `npm run test:frontend -- src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/workspace/workspaceStore.terminalTabs.test.ts`：通过，2 files / 35 tests。
- `npm run typecheck`：通过。
- `npm run build`：通过；保留现有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 5174`：通过，浏览器预览创建本地终端、右键左右分屏、广播栏显示、发送 `echo ok` 后无确认弹框，状态显示 `已发送到 2 个分屏。`。
- 主题截图：
  - `.updeng/docs/verification/apple-production-plan-round2-dark.png`
  - `.updeng/docs/verification/apple-production-plan-round2-light.png`
  - `.updeng/docs/verification/apple-production-plan-round2-system.png`

剩余：

- P3 UI 入口还缺“长按/右键分屏图标选择主机”和 MachineSidebar 拖拽 hot zone；当前已完成 store/model 的 `targetMachineId` 基础契约。
- 本轮未跑 `npm run tauri:dev`，因为没有改 Rust、Tauri 配置、窗口或权限；真实 PTY 行为保留到涉及 Tauri session 创建的后续切片。

### 2026-06-23 Round 3：分屏图标主机选择 popover

状态：已完成 split popover 切片；MachineSidebar 拖拽 hot zone 保留为下一切片，不和本轮 UI 选择器混入同一验证批次。

本轮目标：

- 用户只点左右/上下分屏图标时仍直接复制当前 focused pane，不增加阻断。
- 用户右键分屏图标时可从主机列表选择另一台主机，调用 `onSplitPane(direction, { targetMachineId })`。
- 候选目标只包含可创建终端 pane 的 `local / ssh / telnet / serial / dockerContainer`，过滤 `rdp / group`。

本轮实现：

- 新增 `TerminalSplitTargetSelector`：分屏按钮仍为 icon-only；右键或键盘 `ArrowDown` / `ContextMenu` 打开“选择主机分屏”浮层；浮层支持搜索、分组展示、协议 badge、状态点和生产标记。
- 新增 `terminalSplitTargets` 纯模型：从 `MachineGroup[]` 生成可分屏目标，统一 host label、协议、状态和过滤规则。
- `TerminalBroadcastBar` 改为复用 `TerminalSplitTargetSelector`，并继续保留发送目标选择器、icon-only 发送和无确认弹窗发送路径。
- `TerminalWorkspace` 增加 `machineGroups` 和可选 split options 的传递，主文件行数压回 996 行，避免继续超过 1000 行上限。
- `WorkspaceTerminalSurface` 把真实 `machineGroups` 传入 `TerminalWorkspace`。
- `TerminalWorkspace.test.tsx` 覆盖右键 split 菜单选择 SSH / Serial，验证 RDP 不出现在目标候选中。
- `terminalSplitTargets.test.ts` 覆盖 Telnet 和 Docker Container 可作为 split 目标，RDP 被过滤。

Explorer 复核结论：

- `MachineSidebar` 当前是 pointer-based 分组拖拽，没有原生 HTML drag/drop；拖拽 hot zone 会涉及 `MachineSidebar.shared.ts`、`MachineSidebar.tsx`、`KerminalShell.tsx`、`KerminalShell.workspaceBridge.tsx` 和 `TerminalWorkspace.tsx`。
- 终端区域已有 `data-terminal-workspace-content` 可作为后续 hot zone 定位锚点。
- store 只表达 `horizontal / vertical`，下一切片先把左右映射为 `horizontal`、上下映射为 `vertical`；精确 left/right/top/bottom 插入需要更深 layout 改动。

验证：

- `npm run test:frontend -- src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/terminal/terminalSplitTargets.test.ts src/features/workspace/workspaceStore.terminalTabs.test.ts`：通过，4 files / 65 tests。
- `npm run typecheck`：通过。
- `npm run build`：通过；保留既有 Vite large chunk warning。
- `npm run check:source-size`：失败，当前已有 16 个超限文件；本轮 touched `TerminalWorkspace.tsx` 为 996 行，不在失败列表中。
- `npm run dev -- --host 127.0.0.1 --port 5174`：端口占用；改用 `npm run dev -- --host 127.0.0.1 --port 5175`，通过。
- 真实浏览器 smoke：浏览器预览创建 Local 终端，终端右键左右分屏，保存一个 SSH 主机，右键 toolbar 的左右分屏图标打开 split target popover；候选中显示 Local 和 SSH。
- 主题截图：
  - `.updeng/docs/verification/apple-production-plan-round3-dark.png`
  - `.updeng/docs/verification/apple-production-plan-round3-light.png`
  - `.updeng/docs/verification/apple-production-plan-round3-system.png`

剩余：

- MachineSidebar 拖拽到 terminal hot zone 创建分屏。
- 本轮未跑 `npm run tauri:dev`，因为没有改 Rust、Tauri 配置、窗口权限或真实 session 创建逻辑；后续拖拽 hot zone 若触发真实 session/open terminal 行为，再补 Tauri smoke。

### 2026-06-23 Round 4：MachineSidebar 拖拽到终端热区分屏

状态：已完成拖拽 hot zone 切片；P1-P5 的核心用户路径已可在真实浏览器中复核。计划仍保持 active，等待最终全量审查、checkpoint/提交边界和后续人工验收决定。

本轮目标：

- 从主机侧边栏拖一台可终端化主机到当前终端区域的左/右/上/下热区，直接以该主机创建 split pane。
- 拖拽中只显示方向和目标主机的短反馈，不增加说明文案，不造成终端内容布局跳动。
- 保持侧栏原有分组拖拽排序行为；外部分屏 drop 消费后不再触发 `onMoveMachine`。

本轮实现：

- 新增 `terminalSplitDropZones` 纯模型：根据终端内容 rect 和 pointer 坐标解析 `left / right / top / bottom` 热区，并映射到现有 `horizontal / vertical` split direction。
- `MachineSidebar` 增加外部拖拽生命周期：`onExternalMachineDrag`、`onExternalMachineDragEnd`、`onExternalMachineDrop`；拖拽预览支持显示 `松开分屏到右侧` 这类目标提示。
- 新增 `TerminalSplitDropOverlay` 和 `TerminalWorkspaceContent`，在终端工作区内渲染方向热区 overlay，同时把 `TerminalWorkspace.tsx` 压回 966 行。
- `KerminalShell` 接线：只有 active tab 是 terminal session、存在 focused pane、拖拽机器类型可终端分屏且终端内容 DOM 存在时才显示/消费热区；drop 后调用 `splitFocusedPane(direction, { targetMachineId })`。RDP、group 和非终端 tab 不消费。
- 新增测试覆盖：热区模型、MachineSidebar 外部拖拽消费、TerminalWorkspace overlay 可见性、KerminalShell 从 SSH 主机拖到右热区后创建 SSH split pane 且不移动主机分组。

验证：

- `npm run test:frontend -- src/features/terminal/terminalSplitDropZones.test.ts src/features/machine-sidebar/MachineSidebar.externalDrag.test.tsx src/features/terminal/TerminalWorkspace.dropOverlay.test.tsx src/app/KerminalShell.splitDrop.test.tsx`：通过，4 files / 10 tests。
- `npm run test:frontend -- src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/terminal/terminalSplitTargets.test.ts src/features/terminal/terminalSplitDropZones.test.ts src/features/terminal/TerminalWorkspace.dropOverlay.test.tsx src/features/machine-sidebar/MachineSidebar.externalDrag.test.tsx src/features/workspace/workspaceStore.terminalTabs.test.ts src/app/KerminalShell.splitDrop.test.tsx`：通过，8 files / 75 tests。
- `npm run typecheck`：通过。
- `npm run build`：通过；保留既有 Vite large chunk warning。
- `npm run dev -- --host 127.0.0.1 --port 5176`：通过，真实 dev server 已启动并由 headless Chrome/CDP 打开。
- 真实浏览器 smoke：fake Tauri IPC 载入 `prod-api` 终端和 `staging-api` 主机树，展开主机分组，把 `staging-api` 从 MachineSidebar 拖到终端右侧 hot zone；dark 截图捕获拖拽 overlay，light/system 截图捕获 drop 后 `prod-api + staging-api` 双分屏。JSON 结果 `pass: true`。
- 主题截图：
  - `.updeng/docs/verification/apple-production-plan-round4-dark.png`
  - `.updeng/docs/verification/apple-production-plan-round4-light.png`
  - `.updeng/docs/verification/apple-production-plan-round4-system.png`
  - `.updeng/docs/verification/apple-production-plan-round4-split-drop-smoke.json`
- 当前热点文件行数：`TerminalWorkspace.tsx` 966、`KerminalShell.tsx` 973、`MachineSidebar.tsx` 966、`TerminalWorkspaceContent.tsx` 133。
- `npm run check:source-size`：失败，仍为既有 16 个非本轮超限文件；本轮热点文件未进入 hard limit 列表。
- `npm run tauri:dev`：未跑通，`beforeDevCommand` 的固定 Vite `1425` 端口已被占用，Tauri CLI 返回 `Port 1425 is already in use`。本轮未改 Rust、Tauri 配置、窗口权限或后端 session command，已用真实 browser + fake Tauri IPC 覆盖前端 session 创建接线。
- Checkpoint：`.updeng/docs/coordination/checkpoints/lane-apple-inspired-ui-production-plan.json`，记录 33 个 changed paths、13 个 tracked patch paths 和 untracked snapshot。

剩余：

- 交付前做一次 diff review，确认没有混入性能 lane 文件。
- 如需完整桌面壳验收，需要释放 1425 端口后重跑 `npm run tauri:dev`。

### 2026-06-23 Round 5：最终审查与计划归档

状态：已完成最终审查、回归验证和文档收口；本计划归档为 done。桌面壳 `tauri:dev` 仍受本机既有端口占用阻断，作为环境残余风险记录，不阻断本轮前端/UI 工作台功能归档。

本轮审查输入：

- Subagent review 1 发现：单 pane terminal 因 `hasActiveSplit` 门禁看不到分屏按钮；Custom broadcast 目标在 tab/layout 变化后可能为空。
- Subagent review 2 发现：拖到左/上热区时 layout 仍插到目标后方；pointerup 到热区外会沿用旧 hover zone；RDP/非 terminal tab 缺少负向测试。
- 主线程最终复核发现：`TerminalWorkspace.tsx` 在修复后达到 1006 行，违反项目 source-size 硬上限，需要拆分再收口。

本轮修复：

- `TerminalBroadcastBar` 改为 active terminal session 即可显示，单 pane 仍可继续分屏；关闭当前 pane 在单 pane 下禁用。
- Custom broadcast 目标为空且仍存在可发送目标时自动回退为 `all`。
- `splitPaneInLayout` 增加 `before / after` placement，`left / top` hot zone 映射到 before，`right / bottom` 映射到 after。
- KerminalShell drop 只信任 pointerup 当前 zone，不再 fallback 到旧 hover zone；RDP 和非 terminal tab 不消费外部分屏 drop。
- 新增 `useTerminalBroadcastTargets`，把广播目标选择状态、custom fallback、目标过滤和 production 计数从 `TerminalWorkspace.tsx` 抽离；`TerminalWorkspace.tsx` 从 1006 行降到 913 行。

最终验证：

- `npm run test:frontend -- src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/terminal/terminalSplitTargets.test.ts src/features/terminal/terminalSplitDropZones.test.ts src/features/terminal/TerminalWorkspace.dropOverlay.test.tsx src/features/machine-sidebar/MachineSidebar.externalDrag.test.tsx src/features/workspace/workspaceStore.terminalTabs.test.ts src/features/workspace/workspaceLayout.test.ts src/app/KerminalShell.splitDrop.test.tsx`：通过，9 files / 85 tests。
- `npm run typecheck`：通过。
- `git diff --check`：通过；仅输出工作区已有 LF/CRLF warning。
- `npm run build`：通过；保留既有 Vite large chunk warning。
- `npm run check:source-size`：失败，仍为既有 16 个非本轮超限文件；本轮 Apple lane 文件未进入 hard limit 列表，`TerminalWorkspace.tsx` 最终为 912 行，`useTerminalBroadcastTargets.ts` 为 144 行。
- `npm run dev -- --host 127.0.0.1 --port 5179`：启动成功，HTTP 请求 `http://127.0.0.1:5179/` 返回 200，随后停止本轮启动的 PID 108280。
- `npm run tauri:dev`：失败，固定 Vite 端口 `1425` 已被本机既有 `node.exe` PID 65576 占用，进程路径 `C:\dev\js\nodejs\node.exe`，启动时间 `2026/6/23 17:07:13`。本轮没有擅自停止该进程。

最终结论：

- 设计目标已落地：分屏/发送/关闭高频按钮 icon-only，普通发送无确认弹框，发送目标支持 Focused / All panes / Custom，生产目标内联可见，分屏可复制当前主机或选择/拖拽到另一台可终端化主机。
- 关键交互已覆盖：右键分屏图标选主机、MachineSidebar 拖拽到 left/right/top/bottom 热区、多目标发送、自定义目标回退、RDP/非 terminal tab 负向路径。
- 计划剩余风险只剩环境项：释放 `1425` 端口后可补跑完整 `npm run tauri:dev` 桌面壳 smoke。
