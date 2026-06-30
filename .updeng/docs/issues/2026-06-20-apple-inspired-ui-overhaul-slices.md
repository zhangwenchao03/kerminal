---
id: ISSUES-20260620-apple-inspired-ui-overhaul
status: next
created_at: 2026-06-20T13:49:40+08:00
updated_at: 2026-06-20T13:49:40+08:00
owner: ai
---

# Apple-inspired UI 全面调整 Issue 切片

本文件把 Apple-inspired UI 方向拆成可执行 vertical slices。对应实施计划已完成并归档到 `.updeng/docs/plan/done/2026-06-20-apple-inspired-ui-overhaul.md`；每个切片都必须能独立验证，不允许一次性全局改完再看。

## 切片总览

| 顺序 | Issue | 模式 | 依赖 | 目标 | 验收重点 |
| --- | --- | --- | --- | --- | --- |
| UI-00 | 视觉基线与截图矩阵 | AFK + HITL | 无 | 固化当前状态和对比场景 | 截图覆盖默认、设置、终端、AI、SFTP、窄屏 |
| UI-01 | Design tokens 与 material foundation | AFK | UI-00 | 统一 surface/text/border/radius/shadow/motion | 不改行为，light/dark/system 可读 |
| UI-02 | Button、Modal、Floating Surface 基础控件 | AFK | UI-01 | 统一按钮、弹层、菜单、focus、press | 所有 portal 继承主题，reduced motion 有效 |
| UI-03 | Shell、Titlebar、Sidebar、Right Rail | AFK + HITL | UI-01/UI-02 | 建立 glass navigation 层和小窗口收起规则 | 小宽度不再挤出终端竖条 |
| UI-04 | Terminal workspace、tab、pane card | AFK + HITL | UI-03 | 终端内容 solid，tab/pane 层级清楚 | xterm 可读，分屏/active/focus 明确 |
| UI-05 | Settings 信息架构和卡片收敛 | AFK + HITL | UI-01/UI-02 | 从卡片堆叠改为 native settings rows | 字体、说明、控件顺序清晰 |
| UI-06 | AI panel 视觉与风险确认 | AFK + HITL | UI-01/UI-02 | context signal、composer dock、pending sheet | 工具风险和批准/拒绝明确 |
| UI-07 | SFTP / remote workspace Finder-like 改造 | AFK + HITL | UI-01/UI-02 | 文件列表、toolbar、path、drop、transfer queue | 排序、拖拽、队列状态清楚 |
| UI-08 | Server info / logs / snippets / MCP 工具统一 | AFK | UI-01/UI-02 | 统一 metric、status、empty、error 语言 | 不再每个工具一套视觉 |
| UI-09 | Motion library spike 与 micro-interaction pass | AFK + HITL | UI-03-UI-08 | 明确 CSS vs `motion` 边界，统一 panel/menu/dialog/drag/focus 动效 | 短、自然、reduced motion 关闭位移；不乱加依赖 |
| UI-10 | Command palette / Action search | HITL 后 AFK | UI-03-UI-09 | 搜索主机、tab、工具、设置、动作 | 键盘优先，不绕过权限 |
| UI-11 | 最终视觉 QA 与验收收口 | AFK + HITL | UI-01-UI-10 | 截图矩阵、主题矩阵、启动验证 | build/dev/Tauri smoke 证据齐全 |

## UI-00：视觉基线与截图矩阵

任务：

- 补齐截图场景：有主机、有 terminal tab、2-pane split、AI、SFTP 文件列表、context menu。
- 记录每张截图的 viewport、theme、状态前置条件。
- 确认视觉验收口径：Apple-inspired、developer cockpit、glass 强度、默认主题。

验证：

- `npm run dev` 或复用当前 1425 dev server。
- Playwright/Chrome 截图保存到 `.updeng/data/ui-audit/<date>/`。

HITL：

- 用户确认方向和默认主题策略。

## UI-01：Design tokens 与 material foundation

任务：

- 在 `src/App.css` 增加 surface/text/border/shadow/radius/motion token。
- 定义 `material-nav`、`material-floating`、`surface-solid`、`surface-terminal`、`focus-ring`、`motion-pressable`。
- 保留旧变量兼容，逐步迁移。

验收：

- 没有业务行为变化。
- light/dark/system 下基础 token 都有值。
- `prefers-reduced-motion` 覆盖 motion utilities。

验证：

- `npm run typecheck`
- `npm run test:frontend`
- `npm run build`
- dev server 截图 smoke。

## UI-02：Button、Modal、Floating Surface 基础控件

任务：

- 改造 `Button` variants：primary、secondary、ghost、danger、toolbar、icon。
- 改造 `ModalShell`：glass dialog、entry motion、focus ring、theme inheritance。
- 抽出 menu/popover/floating surface class，供 SFTP/AI/context menu 迁移。

验收：

- Button 尺寸稳定，文字不溢出。
- Modal light/dark/system 清晰。
- Portal 继承主题。
- reduced motion 下无 scale/translate。

验证：

- 组件测试。
- `npm run build`
- settings dialog 截图。

## UI-03：Shell、Titlebar、Sidebar、Right Rail

任务：

- `KerminalShell` 建立响应式收起优先级。
- `AppTitleBar` 改为 nav glass，窗口按钮 hover/press 更细。
- `MachineSidebar` source-list 化，增加空状态动作。
- `ToolPanel` rail 使用统一 icon button 和 selected pill。

验收：

- 390px/780px/1024px/1440px 都不出现重叠。
- 右 rail 不再把 terminal 挤成不可用窄条。
- 主机排序和状态 badge 清晰。

验证：

- `ToolPanel.test.tsx` 等相关测试。
- `npm run build`
- `npm run dev` 多 viewport 截图。
- 若窗口拖拽/控制按钮受影响：`npm run tauri:dev`。

## UI-04：Terminal workspace、tab、pane card

任务：

- `terminalTabChrome` muted group indicator。
- `TerminalPaneCard` focus/header/status chip。
- `TerminalWorkspace` empty state、tab overview、broadcast risk sheet。
- `XtermPane` 状态 HUD 和 terminal surface token。

验收：

- 终端正文高对比、可读，不受 glass 干扰。
- Active tab、active pane、broadcast target 一眼可辨。
- 空状态有新建本地终端、连接 SSH、最近会话、AI 帮助。

验证：

- 终端相关测试。
- `npm run build`
- `npm run dev` 有 terminal/split 截图。
- `npm run tauri:dev` 验证 xterm 输入、分屏、右键。

## UI-05：Settings 信息架构和卡片收敛

任务：

- 右侧设置内容改 section + setting row。
- Theme/density/cursor 选择控件保留视觉 preview，但不套多层大卡。
- 长说明迁移到 helper、tooltip 或 disclosure。
- 统一 Settings 字体层级和 row height。

验收：

- 第一屏能快速理解主题、密度、背景、终端外观。
- 深浅色都可读，卡片不拥挤。
- 控件顺序符合用户决策路径。

验证：

- settings 测试。
- `npm run build`
- settings dark/light/system 截图。

## UI-06：AI panel 视觉与风险确认

任务：

- AI header 加 context signal strip。
- Composer 改 bottom glass dock。
- Pending invocation 改风险确认 sheet。
- History/audit 使用 command-list 风格。

验收：

- provider、policy、active terminal、context size 清晰。
- AI 工具调用的影响范围、风险级别、批准/拒绝明确。
- 错误和空状态都有下一步。

验证：

- AI panel 测试。
- `npm run build`
- `npm run dev` AI 截图。
- 真实工具确认涉及 Tauri invoke 时跑 `npm run tauri:dev`。

## UI-07：SFTP / remote workspace Finder-like 改造

任务：

- 文件列表目录优先/natural sort/列宽稳定。
- Toolbar 按导航、视图、创建、传输、危险动作分组。
- Path input 非 focus 时 breadcrumb，focus 时完整路径编辑。
- Drop overlay 和 transfer queue 视觉统一。

验收：

- 文件/目录/隐藏文件/选中/拖拽状态明确。
- 传输队列 active first，失败可重试，完成可清理。
- 危险动作不和上传下载主动作混在一起。

验证：

- SFTP 组件测试。
- `npm run build`
- `npm run dev` SFTP 截图。
- 真实 SFTP 交互可用时跑 `npm run tauri:dev` smoke。

## UI-08：Server info / logs / snippets / MCP 工具统一

任务：

- 统一工具 header、metric card、status chip、empty/error。
- 运行体检、诊断包、审计、MCP resource/prompt preview 使用相同信息结构。
- 长说明改 disclosure，不在首屏堆叠。

验收：

- 工具区像同一个产品，不像多个独立页面拼接。
- 技术状态用真实 metric，而不是装饰。
- Error 有复制/重试/打开日志/生成诊断包动作。

验证：

- 相关工具测试。
- `npm run build`
- dev server 截图。

## UI-09：Motion library spike 与 micro-interaction pass

任务：

- 先不直接新增依赖，做 CSS token + data-state 版本：button press、menu/popover、modal、sidebar/tool panel collapse。
- 用一个隔离原型验证 `motion`：tab overview、command palette、AI pending sheet、pane layout 任选 2 个高价值场景。
- 评估 `motion` 是否明显降低复杂度并改善 exit/layout 动效；如果没有，保留 CSS-only。
- 明确不引入 Vaul、React Transition Group；AutoAnimate 只可试简单 list，不可套 SFTP 表格和 terminal panes。
- panel collapse、menu/popover、modal、tab overview、drag/drop、button press 统一 motion。
- 键盘 focus 和 pointer hover/active 都有清晰状态。
- `prefers-reduced-motion` 关闭位移和 scale。

验收：

- 动效短、自然、解释空间关系。
- 没有布局跳动。
- 高速重复操作不累赘。
- 若新增 `motion`，必须集中封装 presets，不能在业务组件散落 spring 参数。
- package/lockfile 变化必须说明依赖理由和替代方案。

验证：

- reduced motion 模拟。
- dev server 手动/截图。
- `npm run build`。
- 如果新增依赖：`npm run typecheck`、`npm run test:frontend`、bundle/build smoke。

## UI-10：Command palette / Action search

任务：

- 用户确认后实现 action registry + palette UI。
- 首版覆盖主机、tab、工具、设置 section、主题/密度、诊断/日志动作。
- 动作执行必须复用现有业务 API 和权限边界。

验收：

- `Ctrl+K`/`Cmd+K` 或用户确认的快捷键打开。
- 可搜索中文和英文关键字。
- 菜单显示快捷键和动作上下文。
- 不绕过 AI/远程/危险操作确认。

验证：

- palette 组件测试。
- keyboard smoke。
- `npm run build`。

## UI-11：最终视觉 QA 与验收收口

任务：

- 跑完整主题/viewport/场景截图矩阵。
- 对照本调研报告和计划验收标准逐项检查。
- 修复启动阻断、白屏、动态导入失败、Outdated Optimize Dep 等问题。
- 整理最终实施记录和剩余风险。

验证：

- `npm run typecheck`
- `npm run test:frontend`
- `npm run build`
- `npm run dev` screenshot smoke
- `npm run tauri:dev` smoke，或记录无法运行原因

HITL：

- 用户确认最终视觉方向和剩余可接受差异。
