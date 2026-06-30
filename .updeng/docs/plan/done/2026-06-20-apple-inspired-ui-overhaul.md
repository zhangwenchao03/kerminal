---
id: PLAN-20260620-134940-apple-inspired-ui-overhaul
status: done
created_at: 2026-06-20T13:49:40+08:00
started_at: 2026-06-20T14:10:00+08:00
completed_at: 2026-06-20T18:41:46+08:00
updated_at: 2026-06-20T18:41:46+08:00
owner: ai
---

# Kerminal Apple-inspired UI 全面调整实施计划

## 目标

- 把 Kerminal 的 UI 从“功能完整的深色工具壳”升级为“Apple-inspired、科技、克制、顺手的开发者工作台”。
- 建立统一的 material、surface、typography、radius、shadow、motion、focus 和 control token，减少各组件手写样式。
- 让 glass/translucency 出现在正确层级：titlebar、sidebar、rail、tabbar、popover、modal、command palette；终端、文件列表、日志、设置内容保持稳定可读。
- 优化所有高频 UI 细节：按钮尺寸和 affordance、布局收起优先级、空状态、排序顺序、菜单顺序、快捷键提示、动效、过渡、状态反馈、卡片大小、字体层级、说明文字密度。
- 保证浅色、深色、跟随系统主题都可读；portal、弹窗和独立窗口继承全局主题。

## 非目标

- 不复制 Apple 品牌资产、图标、文案或官网营销页面。
- 不在本轮改终端协议、SSH/SFTP 后端、AI 工具权限或数据库 schema。
- 不为了视觉重构一次性改写所有业务组件。
- 不牺牲终端性能、xterm 可读性、键盘可达性和 reduced motion。
- 不把所有页面都做成大卡片或玻璃卡片。

## 当前证据

- 外部调研报告：`.updeng/docs/reports/2026-06-20-apple-inspired-ui-research.md`
- 当前截图证据：
  - `.updeng/data/ui-audit/2026-06-20/01-desktop-dark-empty.png`
  - `.updeng/data/ui-audit/2026-06-20/02-desktop-dark-right-panel.png`
  - `.updeng/data/ui-audit/2026-06-20/03-desktop-light-settings-modal.png`
  - `.updeng/data/ui-audit/2026-06-20/04-desktop-light-shell.png`
  - `.updeng/data/ui-audit/2026-06-20/05-desktop-system-light-shell.png`
  - `.updeng/data/ui-audit/2026-06-20/06-narrow-dark-host-popover.png`
  - `.updeng/data/ui-audit/2026-06-20/07-mobile-light-shell.png`
  - `.updeng/data/ui-audit/2026-06-20/08-interaction-open-ai-from-empty.png`
  - `.updeng/data/ui-audit/2026-06-20/09-interaction-open-ssh-dialog.png`
  - `.updeng/data/ui-audit/2026-06-20/report.json`
- 当前 1425 Vite 实例浏览器访问返回 200；默认桌面、窄屏和设置截图没有 console error。
- 当前 `package.json` 未引入 Motion、react-spring、AutoAnimate、Floating UI、Vaul 或 React Transition Group；只有 `@radix-ui/react-slot`。动效体系应先 CSS/token 化，再按需引入库。
- 动效库调研结论：
  - `motion@12.40.0` 支持 React 19，MIT，GitHub 32.4k stars，适合复杂 layout/exit/gesture，小范围推荐。
  - `@react-spring/web@10.1.1` 支持 React 19，MIT，GitHub 29.1k stars，适合物理 spring，但当前不优先。
  - `@formkit/auto-animate@0.9.0` MIT，适合简单列表排序，不适合 SFTP 表格、terminal panes 和复杂 layout。
  - Radix animation guide 的 CSS `data-state` 模式适合 Kerminal 基础弹层。
  - Floating UI 解决 popover/menu 定位和 collision，不是 motion 库，可作为菜单定位升级候选。
  - Vaul 已标注 unmaintained，不作为依赖，只参考 drawer/sheet 手感。
  - Animate UI 是 copy-first animated component distribution，只参考，不批量复制。
- CodeGraph 已确认主要 UI 边界：
  - `src/app/KerminalShell.tsx`
  - `src/components/AppTitleBar.tsx`
  - `src/components/ui/button.tsx`
  - `src/components/ui/modal-shell.tsx`
  - `src/features/machines/MachineSidebar.tsx`
  - `src/features/terminal/TerminalWorkspace.tsx`
  - `src/features/terminal/TerminalPaneCard.tsx`
  - `src/features/terminal/XtermPane.tsx`
  - `src/features/tool-panel/ToolPanel.tsx`
  - `src/features/tool-panel/AiToolContent.tsx`
  - `src/features/settings/SettingsDialog.tsx`
  - `src/features/settings/SettingsToolContent.tsx`
  - `src/features/sftp/sftp-tool-content/SftpBrowserView.tsx`

## 约束

- 仓库存在 `.codegraph/`，理解或修改代码前继续优先使用 CodeGraph。
- 前端主题必须覆盖 light/dark/system；颜色优先 CSS variables 或成对 `dark:` 样式。
- 新 portal/独立窗口必须继承 `useDocumentTheme`，不能只在局部容器挂 `.dark`。
- 任何 UI 代码变更后至少运行 `npm run build` 和真实 dev server smoke。
- 涉及 Tauri 窗口、portal、权限、独立窗口时，还要跑 `npm run tauri:dev` 或明确记录无法运行原因。
- `src-tauri/tauri.conf.json` 的 `app.security.freezePrototype` 不要改回 `true`，除非完成兼容验证。

## 总体策略

先做 foundation，再做模块迁移，最后做动效和可访问性 QA。每个阶段都要能单独验证和回滚，避免一次性全局 UI 改动导致启动、主题或 xterm 失效。

## 阶段 0：视觉基线与验收样本

模式：AFK 可执行，HITL 验收。

范围：

- 固化当前截图样本：默认桌面、窄屏、设置深色、设置浅色。
- 补充至少 6 个后续对比场景：有主机列表、有终端 tab、有 2 pane split、AI 面板、SFTP 文件列表、context menu/popover。
- 定义视觉验收清单：层级、对比度、文字不溢出、无重叠、动效不过度、light/dark/system。

交付：

- `.updeng/data/ui-audit/<date>/` 截图。
- 对比清单写入本计划 Round Log 或后续 active 计划。

验收：

- 用户确认整体方向：更像“开发者工作台 / Apple-inspired”，不是营销页。
- 决策默认主题是否从 `dark` 改为 `system`。若用户未确认，先保留现有默认 dark。

## 阶段 1：Design Tokens / Material Foundation

模式：AFK 可执行。

目标：

- 在 `src/App.css` 扩展统一 token。
- 在 `Button`、`ModalShell`、通用 input/select/switch/menu surface 上建立可复用 class。
- 不改业务布局，只把重复色彩和材质归一。

建议 token：

- Surface：`--surface-page`、`--surface-terminal`、`--surface-solid`、`--surface-nav-glass`、`--surface-floating-glass`、`--surface-hover`、`--surface-selected`。
- Text：`--text-primary`、`--text-secondary`、`--text-tertiary`、`--text-accent`、`--text-danger`。
- Border：`--border-subtle`、`--border-strong`、`--border-focus`。
- Shadow：`--shadow-hairline`、`--shadow-floating`、`--shadow-dialog`。
- Radius：`--radius-control`、`--radius-card`、`--radius-panel`、`--radius-dialog`。
- Motion：`--motion-fast`、`--motion-menu`、`--motion-panel`、`--ease-out-quint`、`--ease-spring-soft`。

涉及文件：

- `src/App.css`
- `src/components/ui/button.tsx`
- `src/components/ui/modal-shell.tsx`
- 少量共用 UI primitives，如已有 input/select/switch 类所在文件。

验收：

- 不改变功能行为。
- light/dark/system 下 Button、Modal、输入框、菜单 surface 都可读。
- 现有测试不因 class 改名失败。

验证：

- `npm run typecheck`
- `npm run test:frontend`
- `npm run build`
- `npm run dev` + 浏览器截图：默认桌面、设置深色、设置浅色。

## 阶段 2：Shell / Titlebar / Sidebar / Right Rail

模式：AFK 实现，HITL 视觉确认。

目标：

- 让 app shell 形成明确三层：page background、glass navigation、solid content。
- 解决窄屏时 terminal 被挤成竖条的问题。
- 统一左侧栏和右侧 rail 的图标按钮、选中态、hover、collapse motion。

改造点：

- `AppTitleBar` 使用 `material-nav`，窗口按钮和 collapse 按钮统一尺寸。
- `KerminalShell` 定义响应式收起优先级：右 tool panel -> 左 sidebar -> rail/command mode。
- `MachineSidebar` 改 source-list 层级：主机 rows、分组 header、status dot、badge、空状态动作。
- `ToolPanel` rail 使用 selected pill，不让 sky 色满屏泛滥。

排序规则：

- 主机列表：Pinned > Connected/Active > Recent > Group natural sort > Hidden/Offline。
- 右侧工具：AI、SFTP、服务器信息、端口/流程、日志、设置；高频和上下文相关优先。

验收：

- 1440px、1024px、780px、390px 宽度不出现 UI 重叠或终端窄条。
- 左右栏收起/展开动效不挤压文字。
- 空状态提供下一步动作。

验证：

- `npm run test:frontend`
- `npm run build`
- `npm run dev` 截图：desktop、tablet、小宽度。
- 如涉及 Tauri window drag/window controls：`npm run tauri:dev`。

## 阶段 3：Terminal Workspace / Tabs / Pane Cards

模式：AFK 实现，HITL 视觉确认。

目标：

- 保持终端正文稳定、清晰、低延迟。
- 把 tabbar、tab overview、pane header、broadcast command 做成统一空间关系。

改造点：

- Tab bar 使用 glass navigation；active tab 用 subtle elevation + text weight + fine border。
- Group color 从高饱和色块改成 muted indicator。
- Pane focus 使用轻 ring 和 header accent，不做强蓝大边框。
- Broadcast command 改风险 sheet：目标数量、生产主机提示、发送动作、取消动作。
- Empty workspace 提供“新建本地终端 / 连接 SSH / 打开最近 / 让 AI 帮我配置”。

涉及文件：

- `src/features/terminal/TerminalWorkspace.tsx`
- `src/features/terminal/terminalTabChrome.tsx`
- `src/features/terminal/TerminalPaneCard.tsx`
- `src/features/terminal/XtermPane.tsx`

验收：

- Terminal readable，terminal theme 没有被 glass 影响。
- Split pane focus、tab active、broadcast 状态一眼可辨。
- Tab/context menu 动效自然，reduced motion 下无位移。

验证：

- 终端相关 Vitest。
- `npm run build`
- `npm run dev` 有 tab/多 pane 截图。
- `npm run tauri:dev` 验证 xterm 启动、输入、分屏、右键菜单。

## 阶段 4：Settings 结构、卡片大小、字体层级

模式：AFK 实现，HITL 视觉确认。

目标：

- 设置面板从“多卡片堆叠”改成 native settings 结构。
- 让说明文字只出现在必要处，控件顺序更符合用户决策路径。

改造点：

- 左侧分类保留 source list，右侧改 section + setting rows。
- Theme/density 用 segmented controls。
- Font size/line height/opacity 用 slider/stepper/input 组合。
- Terminal preview 保留为 compact preview，不占过大高度。
- Ghost suggestion 高级配置折叠，避免压过基础外观。

字体层级：

- Dialog title 17px/600。
- Category title 13px/600。
- Row label 13px/500。
- Helper 12px/400 secondary。
- Preview mono 13px。

验收：

- 设置第一页无需滚太久即可完成主题、密度、终端字体基础设置。
- light/dark/system 下 controls 和 helper 都清晰。
- 没有 nested card inside card 的视觉拥挤。

验证：

- Settings 相关 Vitest。
- `npm run build`
- `npm run dev` 截图：settings dark/light/system。

## 阶段 5：AI Panel / SFTP / Server Info / Logs 等工具内容

模式：AFK 实现，部分 HITL。

目标：

- 右侧工具面板内部统一 header、status、toolbar、list、empty、error、menu。
- 用真实状态增强 geek/tech 感。

AI 改造：

- 顶部 context signal strip：provider、active terminal、policy、context size。
- Composer 做 bottom glass dock。
- Pending invocation 做风险确认 sheet，明确工具、范围、风险、批准/拒绝。
- History/audit 做 searchable command-list。

SFTP 改造：

- Finder-like 文件列表，目录优先和 natural sort。
- Toolbar 按导航/视图/创建/传输/危险分组。
- Path input focus 时可编辑，非 focus 时像 breadcrumb。
- Drop zone 显示源/目标/数量/动作。
- Transfer bar active first，失败可重试，完成可清理。

Server/Logs/Snippets/MCP 改造：

- 统一 small metric cards，但不要大卡片套小卡片。
- 运行体检、诊断包、审计等状态使用 mono metrics 和语义 chip。
- 长说明改为 disclosure 或 tooltip。

验收：

- 每个工具都遵循同一 header/toolbar/list/empty/error 语言。
- 高频动作靠前，危险动作靠后。
- SFTP 拖拽和 AI pending 这种高风险/高状态交互清晰。

验证：

- `npm run test:frontend`
- `npm run build`
- `npm run dev` 截图：AI/SFTP/日志/服务器信息。
- SFTP/AI 若涉及 Tauri invoke 行为：`npm run tauri:dev` smoke。

## 阶段 6：Motion / Micro-interaction / Accessibility

模式：AFK 实现，HITL 体验确认。

目标：

- 所有 floating layers、menus、panel collapse、selection、drag/drop 都有统一 motion。
- reduced motion、keyboard、focus、contrast 不回退。
- 明确哪些动效用 CSS，哪些需要 `motion` spike，避免无控制地增加依赖。

动效库决策：

- 默认不新增依赖：hover、press、focus、menu fade、dialog fade/scale、sidebar collapse 使用 CSS token + data-state。
- 对 `tab overview`、`command palette`、`AI pending sheet`、`pane layout` 做 `motion` spike。如果 CSS 实现出现退出动画难维护、layout 跳动或 reduced motion 难控，再引入 `motion`。
- 不引入 Vaul、React Transition Group。
- AutoAnimate 只允许在简单非虚拟 list 的原型中验证，不允许直接套到 SFTP 文件表或 terminal pane。
- 若引入 `motion`，必须集中封装 motion presets：`fadeScale`、`slidePanel`、`layoutMorph`、`sheetInOut`，组件不得各写各的 spring。

改造点：

- 建立 `.motion-popover-enter`、`.motion-panel`、`.motion-pressable`、`.focus-ring` 等 class。
- Button press 使用 0.98 scale，但不改变布局尺寸。
- Menu/popover 从触发点附近 fade/scale。
- Sidebar/tool panel collapse 分离 width 与 content opacity。
- Drag/drop overlay 使用短 fade，不使用大幅位移。
- Focus ring 用 accent alpha + outline，不只靠颜色。

验收：

- 动效短、连续，不晃、不拖。
- `prefers-reduced-motion` 下位移和 scale 关闭。
- 键盘 tab 顺序清晰，menu/dialog 可用。
- 如果新增 `motion` 依赖，bundle/build 通过，且所有 motion preset 都能被 reduced motion 禁用。

验证：

- 浏览器手动/脚本截图。
- reduced motion 模拟检查。
- `npm run build`。
- 若新增依赖：`npm install` 后检查 lockfile、`npm run typecheck`、`npm run test:frontend`。

## 阶段 7：Command Palette / Action Search

模式：HITL 决策后 AFK。

目标：

- 类 Raycast/Arc，把深层功能、设置、主机、tab、工具、SFTP、AI 审计等动作统一到 command/action palette。
- 降低右 rail、侧栏、设置入口的视觉压力。

首版动作范围：

- 新建本地终端。
- 连接 SSH 主机。
- 搜索/切换 tab。
- 打开工具面板。
- 打开设置 section。
- 切换主题/密度。
- SFTP 当前路径动作。
- 复制诊断信息/打开日志。

验收：

- 键盘入口可配置，Win/macOS 显示不同 shortcut。
- 动作结果有反馈。
- 不绕过现有权限和 AI 工具确认边界。

验证：

- Command palette 组件测试。
- `npm run build`
- `npm run dev` keyboard smoke。

## 阶段 8：最终视觉 QA 与收口

模式：AFK + HITL。

截图矩阵：

- Desktop 1440x960：default、with terminal、settings dark/light、AI、SFTP。
- Medium 1024x768：with terminal + right panel。
- Narrow 780x800：sidebars collapsed behavior。
- Small 390x844：不要求完整手机体验，但不能出现终端竖条和重叠。

主题矩阵：

- light。
- dark。
- system。
- reduced motion。

最终验证：

- `npm run typecheck`
- `npm run test:frontend`
- `npm run build`
- `npm run dev` screenshot smoke
- `npm run tauri:dev` smoke，如涉及 Tauri UI/window/portal

## 可回滚策略

- Foundation 阶段只新增 token 和 class，保留旧 class 兼容，避免一次性改断。
- 每个模块单独 PR/commit，出现问题只回滚该模块。
- 不删除现有设置项，只改变呈现。
- Command palette 作为 additive feature，默认可隐藏。

## 需要用户确认的 HITL 决策

1. 默认主题是否从当前 `dark` 调整为 `system`。
2. Kerminal 主 accent 是继续 sky/cyan，还是改为更克制的 blue + graphite + green status 组合。
3. Command palette 是否进入本轮，还是放到下一轮产品切片。
4. 玻璃强度：偏 macOS sidebar 的低透明，还是偏 Liquid Glass 的更明显折射感。桌面生产力工具建议低透明。
5. 是否需要新的应用图标/品牌视觉；本计划默认不做品牌资产。
6. 是否允许在 Motion spike 通过后引入 `motion` 作为唯一动画依赖；默认先不加，CSS 不够时再加。

## 验收标准

- 看起来更 Apple-inspired，但仍是 Kerminal 自己的开发者工具，不像 Apple 官网营销页。
- terminal、file list、log、settings 在 light/dark/system 都清晰。
- glass 只用于导航和浮层，不影响正文阅读。
- 按钮、菜单、toolbar、tab、rail、dialog 的尺寸、圆角、hover、press、focus 一致。
- 空状态、错误状态、loading 状态都有可执行下一步。
- 小窗口不会出现控件重叠或终端内容被挤成不可用窄条。
- 动效自然、短、可关闭，不影响性能。
- 高频操作路径更短，危险操作更明确。
- 技术感来自真实状态、指标和上下文，而不是装饰。

## Round Log

### 2026-06-20 Round 1：Foundation / Shell / Terminal Empty State

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 在 `src/App.css` 新增 material、surface、border、shadow、motion、focus 和 semantic color token。
- 将 `Button`、`ModalShell` 接入统一 press/focus/floating material，不改变原 props 合同。
- 调整 `AppTitleBar`、`KerminalShell`、`MachineSidebar`、`ToolPanel`、terminal tab chrome 的导航层和浮层材质。
- 新增 `TerminalEmptyState`，为空工作区提供“本地终端 / 连接 SSH / 打开 AI”三个明确动作。
- 将 viewport/layout 计算移动到 `KerminalShell.helpers.tsx`，保持 `KerminalShell.tsx` 和 `TerminalWorkspace.tsx` 不超过 1000 行。

验证结果：

- `npm run typecheck`：通过。
- `npm run test:frontend -- src/app/KerminalShell.test.tsx src/app/AppTitleBar.test.tsx src/features/machine-sidebar/MachineSidebar.test.tsx src/features/tool-panel/ToolPanel.test.tsx src/features/terminal/TerminalWorkspace.test.tsx`：5 files / 101 tests 通过。
- `npm run test:frontend`：69 files / 545 tests 通过。
- `npm run build`：通过；仅保留既有 Vite large chunk / dynamic import warnings。
- `npm run tauri:dev`：Vite 启动、Rust dev build 完成，并运行 `target\debug\kerminal.exe`；启动期未继续输出 WebView/权限/冻结原型错误。结束后确认无 `kerminal` 进程残留，1425 端口无服务。
- Playwright Chrome 截图矩阵：9 张截图均写入 `.updeng/data/ui-audit/2026-06-20/`；`report.json` 记录 browser console error 为空，所有场景 `overflowX=false`。

视觉抽查结论：

- 桌面深色默认壳层、右侧工具面板、设置浅色 modal、system/light、780px host popover、390px light shell、AI/SSH 空态动作均可渲染。
- 390px 下空态按钮文字不溢出，三个主动作均保持可识别按钮 affordance。
- 780px 下左侧栏自动进入 rail + popover，避免 terminal 被挤成不可用竖条。

下一轮建议：

- 阶段 4：重构 Settings 为更接近 native settings 的 row/section 结构，减少卡片堆叠和硬编码灰色。
- 阶段 5：统一 AI panel、SFTP、server info、logs 内部 header/status/toolbar/list/empty/error。
- 阶段 6：补 reduced motion、popover/menu/tab overview 的动效和键盘可达性 QA。

### 2026-06-20 Round 2：Settings / AI Panel Material Unification

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 在 `src/App.css` 扩展 `--surface-muted`、`--surface-field`、`--surface-field-hover`，新增 `kerminal-muted-surface` 与 `kerminal-field-surface`，让 Settings、Select、AI 面板复用同一套 field/subsurface/focus token。
- 将 `Select` 的 field、menu、option selected/hover 从硬编码 `#0A84FF` 和局部 glass 改为 app accent、floating material 与统一 enter motion。
- 将 `SettingsToolContent` 分类导航、`shared-controls` 文本/数字输入、指标块、策略开关迁移到统一 material utility。
- 将 Settings 的 AI/SFTP 子页外层、内层设置组和输入区迁移到 solid/muted/field surface；保留 AI 安全策略和 SFTP 性能语义，不改变设置数据合同。
- 将 `AiToolContent` 主面板、header、history/audit 浮层、composer、send button 接入 terminal/material/floating/solid 层级。
- 将 AI 子组件的 command visibility、provider pill、history search、conversation active row、assistant bubble meta、pending invocation arguments 区统一到 shared surface；保留 pending approval 的 amber/rose 风险语义。
- 三个只读 subagent 审计已回收：Settings 重点在 `appearance-section` 拆分和 native row primitives；AI 重点在浮层/composer/安全时序边界；SFTP/Logs/Server/Snippets 重点在后续统一工具页 section/list/state primitives。

验证结果：

- `npm run typecheck`：通过。
- `npm run test:frontend -- src/components/ui/select.test.tsx src/features/settings/SettingsDialog.test.tsx src/features/settings/SettingsToolContent.test.tsx src/features/tool-panel/AiToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx src/app/KerminalShell.test.tsx`：6 files / 60 tests 通过。
- `npm run test:frontend`：69 files / 545 tests 通过。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- `npm run dev -- --host 127.0.0.1`：真实 dev server 截图 smoke 通过；截图写入 `.updeng/data/ui-audit/2026-06-20-round2/`，`report.json` 记录 `horizontalOverflow=false`，无 page error；仅有 Chrome verbose password field form 提示。
- `npm run tauri:dev`：Vite 启动、Rust dev build 完成，并运行 `target\debug\kerminal.exe`；启动后 5 秒无新增错误输出。结束后确认无 `kerminal` 进程残留，1425 端口无服务。

视觉抽查结论：

- Settings dark appearance、dark/light AI、light/system SFTP 均可读，新的侧栏 selected/hover、field focus 和 card/subsurface 层级更统一。
- 390px system dark Settings 截图中 SFTP 子页纵向布局正常，没有横向溢出。
- AI 面板 history/audit 浮层在右栏内收敛，composer、provider/approval pill 和浮层材质一致。

下一轮建议：

- 阶段 4 深化：拆 `appearance-section.tsx` 的 native settings row/section primitives，避免继续堆到 847 行大组件。
- 阶段 5 继续：迁移 Log、Port、Snippet、ServerInfo、SFTP browser 的 surface/list/empty/error primitives；优先避免直接大改 900+ 行文件。
- 阶段 6：补 reduced motion 模拟、keyboard focus 顺序和 AI pending approval 真实交互态截图。

### 2026-06-20 Round 3：Log / Port / ServerInfo Tool Surface Pass

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 将 `LogToolContent` 的命令历史 card、scope chip、搜索 field、来源 Select、最近记录 table shell/table header/code chip 迁移到 shared solid/muted/field surface。
- 将 `PortForwardToolContent` 的 SSH 未选中态、创建转发表单、转发类型选项、错误提示、session row 迁移到 shared surface；补齐浅色主题下 production badge、selected kind、running badge、icon 的可读性。
- 将 `SystemMetricCard` / `SystemOverviewCard` / `SystemOverviewTile` 迁移到 shared solid/muted surface。
- 将 `ServerInfoToolContent` 的 badge、loading/empty state、GPU/disk/network/process 明细 row 和 fallback message 迁移到 shared surface。
- 本轮只替换视觉层 class，不改变 Log 删除/分页/过滤、Port 创建/关闭、ServerInfo 采样/缓存/刷新间隔等行为。

验证结果：

- `npm run typecheck`：通过。
- `npm run test:frontend -- src/features/logs/LogToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx`：2 files / 16 tests 通过。
- `npm run test:frontend`：69 files / 545 tests 通过。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- `npm run dev -- --host 127.0.0.1`：真实 dev server 截图 smoke 通过；截图写入 `.updeng/data/ui-audit/2026-06-20-round3/`，`report.json` 记录 `horizontalOverflow=false` 且 `consoleIssues=[]`。
- 结束后确认无 `kerminal` 进程残留，1425 端口无服务；`git diff --check` 只有 Windows 行尾提示，无 whitespace error。

视觉抽查结论：

- dark Log table、diagnostics card、search/select 与右侧面板层级一致，表格横向滚动仍可用。
- dark Port empty state 不再使用只适合暗色的裸 `bg-white/6`，浅色可读性已补齐。
- light ServerInfo cards 使用统一 solid/muted surface，metric tile、overview tile 与 shell 层级一致。

风险记录：

- `ServerInfoToolContent.tsx` 当前 993 行，仍低于 1000 行红线，但下一轮若继续修改它必须先拆分 view/model/helper，不能继续追加代码。
- `SftpToolContent.tsx`、`SnippetToolContent.tsx`、`appearance-section.tsx` 仍是后续高风险迁移目标，应先抽 shared primitives 再迁移。

下一轮建议：

- 先拆 `ServerInfoToolContent.tsx` 和 `appearance-section.tsx`，降低 1000 行红线风险。
- 迁移 Snippet、SFTP browser、Container files、MCP/Skills 的 list/empty/error/toolbars。
- 做 reduced motion、keyboard tab order、focus ring 和 AI pending approval 真实交互态 QA。

### 2026-06-20 Round 4：Snippet Surface Split / System Preview Fix

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 并行只读 subagent 审计 Snippet、SFTP/文件浏览、Appearance settings 和剩余 UI 一致性，确认后续优先级：Snippet 可先落地，SFTP/Appearance 需要先拆分再深入，MCP/Workflow/LLM Provider/Terminal menus 是下一批高价值区域。
- 将 `SnippetToolContent.tsx` 的 row、inline run panel、create dialog、empty state、segmented/filter button class 抽到 `SnippetToolContent.parts.tsx`；主文件从约 900 行降到 501 行，新 parts 文件 407 行。
- 将 Snippet 搜索输入、scope/tag chip、mine/preset segmented control、列表壳、group header、row hover、inline run panel、变量输入和 create dialog field 迁移到 `kerminal-field-surface` / `kerminal-solid-surface` / `kerminal-muted-surface` / `kerminal-floating-enter` / `kerminal-focus-ring` / `kerminal-pressable`。
- 修复 Appearance 在 `themeMode: "system"` 下终端字体预览错误固定为 dark 的问题：`SettingsToolContent` 新增可选 `resolvedTheme`，未传入时从 document theme / `matchMedia` 解析；`AppearanceSettingsSection` 直接使用解析后的 theme。
- 新增回归测试，覆盖 `themeMode: "system"` + `resolvedTheme="light"` 时终端预览使用 light scheme。
- 本轮不改变 Snippet API、片段执行、删除、复制、workflow 创建、终端写入和 settings 持久化行为。

验证结果：

- `npm run test:frontend -- src/features/snippets/SnippetToolContent.test.tsx src/features/snippets/snippetCatalogModel.test.ts src/features/snippets/snippetVariables.test.ts src/lib/snippetApi.test.ts`：4 files / 19 tests 通过。
- `npm run test:frontend -- src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsDialog.test.tsx`：2 files / 13 tests 通过。
- `npm run typecheck`：通过。
- `npm run test:frontend`：69 files / 546 tests 通过。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- `npm run dev -- --host 127.0.0.1`：真实 Chrome/Playwright smoke 通过；截图写入 `.updeng/data/ui-audit/2026-06-20-round4/`，`report.json` 记录 `horizontalOverflow=false` 且 `consoleIssues=[]`。
- `npm run tauri:dev`：Vite 启动、Rust dev build 完成，并运行 `target\debug\kerminal.exe`；启动后 8 秒无新增错误输出。结束后确认无 `kerminal.exe` 残留，1425 端口仅有 TIME_WAIT。

截图证据：

- `.updeng/data/ui-audit/2026-06-20-round4/01-snippet-initial.png`
- `.updeng/data/ui-audit/2026-06-20-round4/02-settings-light-appearance.png`
- `.updeng/data/ui-audit/2026-06-20-round4/03-settings-system-light-preview.png`
- `.updeng/data/ui-audit/2026-06-20-round4/04-snippet-light.png`
- `.updeng/data/ui-audit/2026-06-20-round4/05-snippet-create-dialog-light.png`
- `.updeng/data/ui-audit/2026-06-20-round4/06-settings-system-light-terminal-preview.png`
- `.updeng/data/ui-audit/2026-06-20-round4/report.json`

视觉抽查结论：

- Snippet dark/light 搜索、scope/tag、segmented control、列表、row action、tag chip 都可读；右侧 panel 没有横向溢出。
- Snippet create dialog light 下 field、Select、segmented control、按钮和 backdrop 层级正常，未发现文字重叠。
- Settings system-light 下终端字体预览不再落到 dark；本机截图中的 computed preview background 为 `rgb(247, 247, 250)`，符合当前 Kerminal light terminal scheme。

风险记录：

- `SftpToolContent.tsx` 和 `SftpBrowserView.tsx` 仍是下一轮高风险区域；先拆 toolbar/list/drop/error/empty/floating layers，再做 Apple-style 行为和语义调整。
- `appearance-section.tsx` 仍存在 card nesting 和大量旧 surface，已修 P1 预览 bug，但完整 native settings row 化还未完成。
- `SettingsToolContent.test.tsx` 当前 884 行，后续继续加 Appearance/SFTP/MCP 用例前应考虑拆测试文件。

下一轮建议：

- 迁移 SFTP browser / upload menu / drag overlay / error-empty states，先拆组件再替换视觉。
- 迁移 MCP/Skills、Workflow、LLM Provider settings 的旧 surface/input/button。
- 补 reduced motion、keyboard focus、copy/delete 可见反馈和 Snippet 删除确认/撤销。

### 2026-06-20 Round 5：MCP / Skills Material And Accessibility Pass

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 并行只读 subagent 审计 SFTP browser、MCP/Skills、Workflow/LLM Provider，确认本轮优先处理 MCP/Skills，后续再独立迁移 SFTP 与 Workflow/LLM Provider。
- 将 `mcp-section.tsx` 的外层 section、系统 agent、HTTP transport 区、skills 路由、自定义 MCP/Skills 区从硬编码 `bg-white/*` / `bg-black/*` / `border-black/*` 迁移到 `kerminal-solid-surface`、`kerminal-muted-surface`、`kerminal-focus-ring` 和 `kerminal-pressable`。
- 将 `mcp-catalog.tsx` 的 HTTP transport card、inline code、JSON config、tool catalog、definition list、empty state 和 copy/refresh buttons 迁移到 shared material/token。
- 将 `mcp-custom.tsx` 的 add server dialog、custom server card、config field panels、tool row、skills root preview 和 folder actions 迁移到 shared material/token；移除浅色模式下过重的硬 dark/cyan skills root 预览。
- 为 custom MCP server discovery 错误补 `role="alert"`，为 manifest loading/empty 状态补 `role="status"`。
- 新增 `SettingsToolContent.test.tsx` 回归测试，覆盖 custom MCP server discovery 失败时错误以 alert 暴露。
- 本轮不改变 MCP manifest、server discovery、skills directory、settings 持久化、HTTP server 启动或工具合并逻辑。

验证结果：

- `npm run test:frontend -- src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsDialog.test.tsx`：2 files / 14 tests 通过。
- `npm run typecheck`：通过。
- `npm run test:frontend`：69 files / 547 tests 通过。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- `npm run dev -- --host 127.0.0.1 --port 1435`：真实 dev server 启动通过；默认 1425 被已有进程占用，本轮按约束换 1435 验证。
- Chrome/Playwright smoke：Settings -> MCP / Skills 浅色、深色、system-light、custom section 和 add server dialog 截图通过；`consoleIssues=[]`，`horizontalOverflow=false`。

截图证据：

- `.updeng/data/ui-audit/2026-06-20-round5/01-mcp-light.png`
- `.updeng/data/ui-audit/2026-06-20-round5/02-mcp-dark.png`
- `.updeng/data/ui-audit/2026-06-20-round5/03-mcp-system-light.png`
- `.updeng/data/ui-audit/2026-06-20-round5/04-mcp-custom-light.png`
- `.updeng/data/ui-audit/2026-06-20-round5/05-mcp-add-server-dialog-light.png`
- `.updeng/data/ui-audit/2026-06-20-round5/06-mcp-add-server-dialog-dark.png`
- `.updeng/data/ui-audit/2026-06-20-round5/report.json`
- `.updeng/data/ui-audit/2026-06-20-round5/theme-report.json`

视觉抽查结论：

- MCP/Skills 系统 catalog、agent capability、transport card、resources/prompts、skills route 与 Settings 其它页的 solid/muted/field 层级一致。
- 自定义 MCP server 空状态、添加按钮、skills root preview 和 folder actions 在 light 下不再出现突兀的暗色 cyan 代码块。
- Add server dialog 在 light/dark 下继承 portal 主题；暗色下 `Server ID` field computed style 使用 `--surface-field: rgb(0 0 0 / 0.22)`，文本为浅色，主题变量正常。
- 浏览器 dev 环境没有真实 Tauri MCP HTTP server，endpoint 文本未出现属于预期 smoke 限制；单元测试仍覆盖了 mocked endpoint 与 copy buttons。

风险记录：

- `SettingsToolContent.test.tsx` 当前 937 行，后续继续增加 Settings 用例前应拆分 MCP/Appearance/AI 子测试，避免接近 1000 行红线。
- SFTP browser 仍有硬编码 surface、upload/context menu focus、drag overlay、empty/error state 等问题；需要避开 953 行 `SftpToolContent.tsx`，优先改 leaf files。
- LLM Provider settings 和 Workflow 仍有旧 surface、按钮 focus/press、loading/error empty state 问题，已有 subagent 审计可作为下一轮直接输入。

下一轮建议：

- 先迁移 `LlmProviderSettingsSection.tsx`，补 loading/error state 测试；这是 Settings 内最安全的剩余切片。
- 再迁移 SFTP browser leaf files：`SftpBrowserView.tsx`、`ToolbarButton.tsx`、`SftpEntryRow.tsx`、`SftpContextMenu.tsx`，避免修改 `SftpToolContent.tsx` state hub。
- 继续补 reduced motion、keyboard tab order、focus ring 和真实操作 QA。

### 2026-06-20 Round 6：LLM Provider Settings Material And State Pass

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 将 `LlmProviderSettingsSection.tsx` 的外层 section、provider list aside、连接配置、模型参数、环境状态、footer action bar 从硬编码 `bg-white/*` / `bg-black/*` / `border-black/*` 迁移到 `kerminal-solid-surface`、`kerminal-muted-surface`、`kerminal-field-surface`、`kerminal-focus-ring` 和 `kerminal-pressable`。
- 将 provider row 去掉直接 `active:scale-*`，统一使用 shared pressable 与 focus ring；selected row 使用 `--surface-selected`。
- 将 API key、text/number/context window field 迁移到 shared field surface，保留 Select 与 Switch 现有行为。
- 修复 LLM Provider 初始 `state === "loading"` 且 providers 为空时误显示“还没有 API 环境”的状态语义；新增 loading `role="status"`。
- 将初始 provider load 失败放在 provider list 区用 `role="alert"` 暴露；footer message 只负责保存/测试/删除操作结果，避免重复 alert。
- 新增 `LlmProviderSettingsSection.test.tsx` 回归测试，覆盖 loading 不误报空状态、provider load failure alert。
- 本轮不改变 provider CRUD、dry validation、API key 凭据保存、draft normalization、model/context 参数语义。

验证结果：

- `npm run test:frontend -- src/features/settings/LlmProviderSettingsSection.test.tsx src/features/settings/SettingsToolContent.test.tsx`：2 files / 18 tests 通过。
- `npm run typecheck`：通过。
- `npm run test:frontend`：69 files / 549 tests 通过。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- `npm run dev -- --host 127.0.0.1 --port 1435`：沿用 Round 5 真实 dev server；默认 1425 被已有进程占用，本轮继续按约束使用 1435。
- Chrome/Playwright smoke：通过 Settings 自身“浅色 / 深色 / 跟随系统”按钮切换主题后抓取 AI 与模型页；`consoleIssues=[]`，`horizontalOverflow=false`。
- `git diff --check`：通过；仅有 Windows LF -> CRLF 提示。

截图证据：

- `.updeng/data/ui-audit/2026-06-20-round6/01-llm-provider-light.png`
- `.updeng/data/ui-audit/2026-06-20-round6/02-llm-provider-dark.png`
- `.updeng/data/ui-audit/2026-06-20-round6/03-llm-provider-system-light.png`
- `.updeng/data/ui-audit/2026-06-20-round6/report.json`
- `.updeng/data/ui-audit/2026-06-20-round6/theme-control-report.json`

视觉抽查结论：

- LLM Provider 在 light/dark/system-light 下输入框、Select、empty provider list、参数区和环境状态区均可读，无横向溢出或文字重叠。
- 真实主题控件路径下，light 字段 computed style 为 `backgroundColor: rgba(255, 255, 255, 0.78)`、`color: oklch(0.141 0.005 285.823)`、`borderColor: rgba(0, 0, 0, 0.12)`，说明主题变量正确落到 field surface。
- 手动改 DOM class 的截图曾出现 field 仍像 dark 的误判；后续截图验证应优先走应用内主题控件，而不是直接改根节点 class。

风险记录：

- `LlmProviderSettingsSection.tsx` 当前 759 行，仍安全；后续如果继续扩展 provider presets、advanced headers 等，应先拆分 provider list、form groups 和 footer actions。
- `appearance-section.tsx` 仍有大量旧 surface 和直接 `active:scale-*`，后续主题控件自身也应迁移到 shared pressable/focus。
- SFTP browser、Workflow 仍未迁移，是下一批高价值 UI 面。

下一轮建议：

- 迁移 SFTP browser leaf files：`SftpBrowserView.tsx`、`ToolbarButton.tsx`、`SftpEntryRow.tsx`、`SftpContextMenu.tsx`，重点处理 upload menu、context menu、row focus/selected、loading/empty/error state。
- 或先迁移 `WorkflowToolContent.tsx` 的 surface 与 empty/error state，并补最小组件测试。

### 2026-06-20 Round 7：SFTP Browser Leaf UI Material Pass

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 按前序审计只迁移 SFTP 叶子 UI，避开 `SftpToolContent.tsx` 状态中枢：`SftpBrowserView.tsx`、`ToolbarButton.tsx`、`SftpEntryRow.tsx`、`SftpContextMenu.tsx`、`SftpActionDialog.tsx`、`SftpTransferStatusBar.tsx`、`RemoteWorkspaceEditorFallback.tsx`。
- 将 SFTP 空目标卡片、header、路径输入、CWD sync、工具栏按钮、upload menu、drop zone、drag overlay、目录 header、loading/empty/error、table header、row hover/selected、context menu、action dialog input/readonly path、transfer status bar 和 remote editor fallback 迁移到 `kerminal-solid-surface`、`kerminal-muted-surface`、`kerminal-field-surface`、`kerminal-floating-surface`、`kerminal-floating-enter`、`kerminal-focus-ring`、`kerminal-pressable`。
- 为 toolbar pressed 状态补 `aria-pressed`；hidden files 与 upload menu 按钮有显式 selected/pressed 视觉。
- 为 SFTP loading 状态补 `role="status"`，为 SFTP error 状态补 `role="alert"`；remote editor fallback 作为 lazy loading 状态也补 `role="status"`。
- 移除 CWD sync 小圆点的强 glow 阴影，保留 emerald 语义色但降低视觉噪声。
- 语义色保留在错误、成功、拖拽上传/下载、传输进度等状态；本轮不改变 SFTP list/load/upload/download/delete/rename/chmod/transfer/workspace 业务逻辑。

验证结果：

- `npm run test:frontend -- src/features/sftp/SftpToolContent.test.tsx src/features/sftp/SftpToolContent.transfers.test.tsx src/features/sftp/SftpToolContent.clipboard.test.tsx`：3 files / 43 tests 通过。
- `npm run typecheck`：通过。
- `npm run test:frontend`：69 files / 549 tests 通过。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- `git diff --check -- src/features/sftp/sftp-tool-content`：通过；仅有 Windows LF -> CRLF 提示。
- 残留扫描 `rg "bg-white/|bg-black/|dark:bg-white/|dark:bg-zinc-950/|border-black/|dark:border-white/|hover:bg-black|dark:hover:bg-white|shadow-\[0_0|focus:ring" src/features/sftp/sftp-tool-content -S`：无命中。
- `npm run dev -- --host 127.0.0.1 --port 1435`：沿用真实 dev server，HTTP 200；默认/其它 Vite 端口已有进程，本轮继续使用 1435。
- Chrome headless CDP smoke：通过 Settings 自身“浅色 / 深色 / 跟随系统”按钮切换主题后回到文件工具截图；`consoleIssues=[]`，`horizontalOverflow=false`。

截图证据：

- `.updeng/data/ui-audit/2026-06-20-round7/00-initial.png`
- `.updeng/data/ui-audit/2026-06-20-round7/01-sftp-file-tool-current-theme.png`
- `.updeng/data/ui-audit/2026-06-20-round7/02-sftp-file-tool-light.png`
- `.updeng/data/ui-audit/2026-06-20-round7/03-sftp-file-tool-dark.png`
- `.updeng/data/ui-audit/2026-06-20-round7/04-sftp-file-tool-system.png`
- `.updeng/data/ui-audit/2026-06-20-round7/sftp-theme-report.json`

视觉抽查结论：

- SFTP empty target 卡片在 light/dark/system 下与右侧工具栏和主工作区层级一致；无横向溢出、文字重叠或主题反色。
- light 下 SFTP card computed style 为 `backgroundColor: rgba(255, 255, 255, 0.88)`、`borderColor: rgba(0, 0, 0, 0.08)`；dark/system-dark 下为 `backgroundColor: rgba(28, 28, 30, 0.88)`、`borderColor: rgba(255, 255, 255, 0.1)`，说明 shared surface token 正常落地。
- 当前 browser dev 环境没有 SSH/Tauri SFTP target，无法真实进入远端目录列表、上传 dropdown 和右键菜单；这些状态由 SFTP 单元测试和后续 Tauri/SSH 端到端 smoke 继续覆盖。

风险记录：

- `SftpBrowserView.tsx` 当前仍是大文件，但本轮只改叶子视觉和状态语义，没有继续扩大 `SftpToolContent.tsx`；后续如果继续加 SFTP 行为，应优先拆 header、listing body、workspace dialog 三块。
- SFTP 真实目录、upload menu、context menu、drag/drop overlay 仍需要带 SSH target 的 Tauri 运行验证；browser 空目标截图不能替代端到端。
- `appearance-section.tsx` 和 `WorkflowToolContent.tsx` 仍是下一批旧 surface / focus / motion 集中区。

下一轮建议：

- 迁移 `WorkflowToolContent.tsx` 的 surface、empty/error/loading state 和 action focus/press，并补最小测试。
- 或继续处理 `appearance-section.tsx`：先拆分低风险子组件，再迁移主题/密度/背景/终端外观控制。
- 开始 reduced motion、键盘 tab order、focus ring、portal theme inheritance 的专项 QA。

### 2026-06-20 Round 8：Workflow Tool Component Material And State Pass

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 只迁移 `WorkflowToolContent.tsx` 与新增 focused 测试 `WorkflowToolContent.test.tsx`；未修改 `ToolPanel`、`workflowApi` 或 terminal command write 行为。
- 将 Workflow 外层 panel、create panel、draft step、workflow card、step list、tags、run panel、variable input、next-step preview、loading/empty state 从硬编码 `bg-white/*` / `bg-black/*` / `border-black/*` / direct focus ring 迁移到 shared material：`kerminal-solid-surface`、`kerminal-muted-surface`、`kerminal-field-surface`、`kerminal-floating-enter`。
- 新增局部 class 常量 `workflowPanelClassName`、`workflowInputClassName`、`workflowNoticeClassName(...)` 等，避免在 900 行组件里继续复制长 class 字符串。
- 为 loading state 补 `role="status"`；保留 error/status 的 `role="alert"` / `role="status"`。
- 修复 list 失败后同时显示 empty state 的状态语义；错误优先于 empty。
- 空态区分“暂无命令工作流”和“当前筛选下没有命令工作流”。
- 运行按钮在 run panel 打开时改为 `aria-pressed` + “收起”文案；run panel 使用 `kerminal-floating-enter`，发送中不再用 `animate-pulse`。

验证结果：

- `npm run test:frontend -- src/features/workflows/WorkflowToolContent.test.tsx src/lib/workflowApi.test.ts`：2 files / 6 tests 通过。
- `npm run typecheck`：通过。
- `git diff --check -- src/features/workflows/WorkflowToolContent.tsx src/features/workflows/WorkflowToolContent.test.tsx`：通过；仅有 Windows LF -> CRLF 提示。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- `npm run test:frontend`：首次与 `npm run build` 并发执行时，`ToolPanel.test.tsx` 的 AI lazy import 用例超时；随后单独 `npm run test:frontend -- src/features/tool-panel/ToolPanel.test.tsx` 15 tests 通过，再次非并行 `npm run test:frontend` 70 files / 552 tests 通过。
- `WorkflowToolContent.tsx` 当前约 923 行，仍低于 1000 行硬线；后续继续扩展前应先拆 parts。

截图证据：

- `.updeng/data/ui-audit/2026-06-20-round8/01-workflow-preview-light.png`
- `.updeng/data/ui-audit/2026-06-20-round8/02-workflow-preview-dark.png`
- `.updeng/data/ui-audit/2026-06-20-round8/03-workflow-preview-system-dark.png`
- `.updeng/data/ui-audit/2026-06-20-round8/workflow-preview-report.json`

视觉抽查结论：

- `WorkflowToolContent` 当前没有出现在右侧工具栏正式入口；本轮通过 Vite dev server 动态 import 真模块，临时 React root 渲染组件预览截图。
- 组件预览在 light/dark/system-dark 下可见，无横向溢出，无 console/log issue。
- light 下 panel computed style 为 `backgroundColor: rgba(255, 255, 255, 0.88)`、field 为 `rgba(255, 255, 255, 0.78)`；dark/system-dark 下 panel 为 `rgba(28, 28, 30, 0.88)`、field 为 `rgba(0, 0, 0, 0.22)`，shared tokens 正常落地。

风险记录：

- Workflow 仍未正式挂到右侧工具栏；如果要产品化入口，应单独切片修改 `ToolPanel` / `ToolId` / tests，不与样式迁移混做。
- `WorkflowToolContent.tsx` 已超过 900 行，后续实现保存/删除 loading 分离、run state 更丰富反馈、键盘执行流时应先拆分 `WorkflowCard`、`DraftStepEditor`、`WorkflowNotice`。
- 当前截图是组件级预览，不等价于 app 正式入口端到端验收。

下一轮建议：

- 迁移 Appearance settings 子树：`appearance-section.tsx`、`terminal-preview.tsx`、`inline-suggestions.tsx` 的 surface/button/field/focus。
- 新增 focused appearance theme fallback 测试文件，不再往已经过线的 `SettingsToolContent.test.tsx` 追加。

### 2026-06-20 Round 9：Appearance Settings Material And Theme Resolution Pass

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 迁移 Appearance settings 子树：`settings-tool-content/appearance-section.tsx`、`terminal-preview.tsx`、`inline-suggestions.tsx`，不改 settings 数据模型、保存链路、Tauri 权限或终端业务行为。
- 为 Appearance 页新增局部 class helper，把外层面板、基础外观、主页面背景、终端主题、终端交互、灰色提示、Provider、诊断、光标形态统一到 `kerminal-solid-surface`、`kerminal-muted-surface`、`kerminal-field-surface`、`kerminal-focus-ring`、`kerminal-pressable` 和 `--surface-selected`。
- 移除这组组件内旧的 `border-black/8`、`bg-white/*`、`bg-black/*`、直接 `active:scale-*` 等分散样式；保留错误、成功、warning、terminal preview 色彩的语义用途。
- 将背景路径 field、浏览按钮、终端主题 card、灰色提示状态 tile、telemetry action buttons、retention input shell 等迁移到 shared material/focus。
- 新增 `SettingsToolContent.appearance-theme.test.tsx`，覆盖 `themeMode: "system"` 且没有显式 `resolvedTheme` 时，终端预览优先读根节点 `data-theme`，再 fallback 到 `matchMedia`；避免继续膨胀已经超过 1000 行的 `SettingsToolContent.test.tsx`。

验证结果：

- `npm run test:frontend -- src/features/settings/SettingsToolContent.appearance-theme.test.tsx src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsDialog.test.tsx`：3 files / 17 tests 通过。
- `npm run typecheck`：通过。
- `git diff --check -- src/features/settings/settings-tool-content/appearance-section.tsx src/features/settings/settings-tool-content/terminal-preview.tsx src/features/settings/settings-tool-content/inline-suggestions.tsx src/features/settings/SettingsToolContent.appearance-theme.test.tsx`：通过；仅有 Windows LF -> CRLF 提示。
- 残留扫描 `rg "border-black/8|bg-white/80|bg-white/70|dark:bg-black/20|active:scale|bg-black/\[0\.03\]|bg-white/6|bg-white/55|bg-white/65" ...`：无命中。
- `npm run test:frontend`：71 files / 555 tests 通过。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- 真实 dev server `http://127.0.0.1:1435/`：HTTP 200；通过真实点击“设置”打开 Appearance，再点击“深色 / 浅色 / 跟随系统”截图。
- Chrome headless CDP smoke：`appearanceVisible=true`、`terminalVisible=true`、`horizontalOverflow=false`、`consoleIssueCount=0`。

截图证据：

- `.updeng/data/ui-audit/2026-06-20-round9/01-appearance-dark.png`
- `.updeng/data/ui-audit/2026-06-20-round9/02-appearance-light.png`
- `.updeng/data/ui-audit/2026-06-20-round9/03-appearance-system.png`
- `.updeng/data/ui-audit/2026-06-20-round9/04-appearance-terminal-system.png`
- `.updeng/data/ui-audit/2026-06-20-round9/05-appearance-inline-suggestions-system.png`
- `.updeng/data/ui-audit/2026-06-20-round9/appearance-theme-report.json`

视觉抽查结论：

- Appearance 顶部、基础外观、主页面背景在 light/dark/system-dark 下可读，selected card 使用统一蓝色选中态，未选中 card 不再像独立硬编码浅/暗面。
- 终端主题和字体配置的 card、preview、number fields 与 Settings 侧栏和 modal shell 层级一致；没有横向溢出。
- 灰色提示区域的策略、Provider、状态 tile、诊断按钮和 retention input 在深色密集布局中没有错位或文字重叠。

风险记录：

- `appearance-section.tsx` 当前约 857 行，仍低于 1000 行但已接近警戒；下一次扩展 Appearance 应拆分 BackgroundSection、TerminalInteractionSection、InlineSuggestionSection。
- 真实 Tauri 窗口未在本轮重新启动，因为只改 React/CSS 和测试；本轮已完成 dev server smoke。涉及窗口、权限或 portal 入口时仍需跑 `npm run tauri:dev`。
- Settings 系列已有旧测试文件超过 1000 行，后续一律新增 focused test file 或拆分，不再追加到 `SettingsToolContent.test.tsx`。

下一轮建议：

- 继续 UI 全面调整的剩余高价值面：AI 对话面板、ServerInfo/PortForward/Logs/Snippets 细节 QA、主工作台空态和标题栏按钮的人性化微动效。
- 做专项 QA：reduced motion、键盘 tab order、focus ring 顺序、portal theme inheritance、移动/窄宽布局、真实 SFTP/SSH 右键菜单和上传菜单。

### 2026-06-20 Round 10：Settings About And Keybindings Material Pass

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 只迁移 Settings 剩余轻量 section：`settings-tool-content/about-section.tsx`、`keybindings-section.tsx`。
- 将 About 的外层 panel、产品信息、更新、项目链接、info tile、link card、检查更新按钮迁移到 `kerminal-solid-surface`、`kerminal-muted-surface`、`kerminal-focus-ring`、`kerminal-pressable`。
- 将 Keybindings 的外层 panel、平台 tab、scope group、shortcut row、scope/action badge、说明提示迁移到 shared material 和 `--surface-selected`。
- 保留 updater 行为、GitHub links、keybinding 数据、平台切换语义；本轮不改 settings model、Tauri updater API 或快捷键业务逻辑。
- 为 About 更新错误补 `role="alert"`；检查中图标使用已有 `animate-spin` 表达 loading。

验证结果：

- 残留扫描 `rg "border-black/8|bg-white/80|bg-white/70|bg-black/\[0\.025\]|bg-black/\[0\.03\]|dark:bg-black/20|dark:bg-white/6|active:scale|focus:ring" src/features/settings/settings-tool-content/about-section.tsx src/features/settings/settings-tool-content/keybindings-section.tsx`：无命中。
- `npm run test:frontend -- src/features/settings/SettingsToolContent.appearance-theme.test.tsx src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsDialog.test.tsx`：3 files / 17 tests 通过。
- `npm run typecheck`：通过。
- `git diff --check -- src/features/settings/settings-tool-content/about-section.tsx src/features/settings/settings-tool-content/keybindings-section.tsx`：通过；仅有 Windows LF -> CRLF 提示。
- `npm run test:frontend`：71 files / 555 tests 通过。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- 真实 dev server `http://127.0.0.1:1435/`：通过真实点击 Settings、Appearance 主题控件和 About/Keybindings 导航截图；`horizontalOverflow=false`，`consoleIssueCount=0`。

截图证据：

- `.updeng/data/ui-audit/2026-06-20-round10/01-about-dark.png`
- `.updeng/data/ui-audit/2026-06-20-round10/02-about-light.png`
- `.updeng/data/ui-audit/2026-06-20-round10/03-keybindings-light.png`
- `.updeng/data/ui-audit/2026-06-20-round10/04-keybindings-system.png`
- `.updeng/data/ui-audit/2026-06-20-round10/settings-about-keybindings-report.json`

视觉抽查结论：

- About 在 light/dark 下产品信息、更新状态、项目链接和保存提示可读，section 层级与前几轮 Settings 页面一致。
- Keybindings 在 light/system-dark 下平台 tab、metrics、快捷键行和 badge 无重叠，无横向溢出。
- 第一次截图曾在 About 页直接点“浅色”导致仍停留 dark；已更正为先回 Appearance 点击真实主题控件，再进入 About/Keybindings 截图。

风险记录：

- Settings 子树主要高频页已基本迁移；后续 Settings 余留风险转向 `remote-host-dialog`、`About updater` 真实 Tauri 行为和窄屏滚动。
- 本轮没有跑 `npm run tauri:dev`，因为未改 Tauri/window/permission/updater API 行为；真实自动更新安装仍需发布链路单独验收。

下一轮建议：

- 按并行审计结果，优先迁移 `AiToolContentParts.tsx` 单文件：命令显示分段、历史搜索按钮、上下文进度轨、消息头像/气泡、streaming motion。
- 或迁移 terminal tab chrome 两文件：`TerminalWorkspace.tsx`、`terminalTabChrome.tsx` 的浮层、重命名输入和广播栏。

### 2026-06-20 Round 11：AI Chat Parts Material And Interaction Pass

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 只迁移右侧 AI 对话 parts：`src/features/tool-panel/ai-tool-content/AiToolContentParts.tsx`，不改 `AiToolContent` 状态机、stream API、历史持久化、工具调用确认或 LLM provider 业务行为。
- 将上下文进度轨从旧 `bg-black/8` / `dark:bg-white/8` 收敛到 `--surface-hover`，保留 loading/error/connected 的语义填充色。
- 将命令显示模式分段按钮、无 provider 配置按钮、历史搜索清空按钮、历史列表行焦点态统一补齐 `kerminal-focus-ring` / `kerminal-pressable`。
- 将历史空态、AI 头像、assistant bubble、process steps、context meta badge、pending invocation arguments summary 迁移到 `kerminal-muted-surface`、`--surface-selected` 和 `--app-accent`。
- 深色主题下 accent 背景使用 `dark:text-zinc-950`，避免浅蓝 accent 搭白字对比不足。
- 移除等待回复里的 `animate-pulse`，保留 process active spinner；全局 `prefers-reduced-motion` 仍会压缩 animation/transition duration。
- 在 `AiToolContent.test.tsx` 增加视觉契约断言：命令显示按钮必须有 focus/pressable，process steps 走 muted surface，context badge 走 selected surface，历史搜索清空按钮可聚焦且能清空。

验证结果：

- 残留扫描 `rg "bg-black/8|dark:bg-white/8|hover:bg-black/6|dark:hover:bg-white/10|border-black/10|dark:border-white/10|animate-pulse" src/features/tool-panel/ai-tool-content/AiToolContentParts.tsx`：仅剩 `ExecutionModeSelector` 的 amber warning hover，作为风险提示语义色保留。
- `npm run test:frontend -- src/features/tool-panel/AiToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx src/features/logs/LogToolContent.test.tsx`：3 files / 25 tests 通过。
- `npm run typecheck`：通过。
- `git diff --check -- src/features/tool-panel/ai-tool-content/AiToolContentParts.tsx src/features/tool-panel/AiToolContent.test.tsx`：通过；仅有 Windows LF -> CRLF 提示。
- 第一次 `npm run test:frontend` 全量运行中，`ToolPanel` 的 AI lazy load 用例在 5s 等待内偶发停在 Suspense fallback；单文件和单用例复跑均通过，随后全量复跑通过。
- `npm run test:frontend`：71 files / 555 tests 通过。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- 真实 dev server `http://127.0.0.1:1435/`：HTTP 200；通过真实点击 Settings 外观主题控件，再打开 Kerminal Agent 截图。
- Playwright + 系统 Chrome smoke：dark/light/system-light 下 `aiVisible=true`、`horizontalOverflow=false`、`consoleIssueCount=0`；dark 历史弹层 `historyVisible=true`、`emptyHistoryVisible=true`；命令分段和配置模型按钮均检测到 focus/pressable class。

截图证据：

- `.updeng/data/ui-audit/2026-06-20-round11/01-ai-dark.png`
- `.updeng/data/ui-audit/2026-06-20-round11/02-ai-dark-history.png`
- `.updeng/data/ui-audit/2026-06-20-round11/03-ai-light.png`
- `.updeng/data/ui-audit/2026-06-20-round11/04-ai-system-light.png`
- `.updeng/data/ui-audit/2026-06-20-round11/ai-panel-report.json`

视觉抽查结论：

- AI header、命令分段、上下文进度、空态、输入 composer 和模型配置在 dark/light/system-light 下层级清晰，没有横向溢出。
- 历史弹层在 dark 下搜索框、空态和弹层边界统一到 shared material，不再像硬贴的独立黑白半透明盒。
- 当前 dev browser 没有配置 LLM Provider，因此真实截图覆盖 AI 空态/历史空态；消息气泡和 process steps 通过组件测试覆盖，后续有真实 provider 后应补一轮端到端对话截图。

风险记录：

- 本轮未跑 `npm run tauri:dev`，因为只改 React class 与测试；没有修改 Tauri/window/permission/API 行为。真实 Tauri AI 对话和工具审批仍沿用现有链路。
- `AiToolContentParts.tsx` 当前约 721 行，仍低于 1000 行；如果后续继续扩展 message rendering、tool invocation card 或 history item，建议拆出 `ConversationHistory`、`ChatMessageBubble`、`PendingInvocationPanel`。
- 全量测试曾出现一次 Suspense 懒加载等待偶发超时；复跑通过，暂不改产品代码。若再次出现，应单独提高该测试的 wait timeout 或预热 lazy import。

下一轮建议：

- 迁移 terminal tab chrome：`TerminalWorkspace.tsx`、`terminalTabChrome.tsx` 的所有标签弹层、重命名输入、广播栏、context menu 入口。
- 继续处理 MachineSidebar、snippets、remote host dialogs 中残留的旧边框/背景/focus 样式。

### 2026-06-20 Round 12：Terminal Tab Chrome Material And Overlay Pass

状态：已完成本轮代码改造和运行验证；整个 Apple-inspired UI overhaul 仍继续 active。

本轮范围：

- 迁移 `src/features/terminal/TerminalWorkspace.tsx`、`src/features/terminal/terminalTabChrome.tsx` 的 tab chrome、所有标签浮层、右键菜单、重命名弹窗、分屏广播输入和广播状态条。
- 新增 `--surface-overlay` 主题变量，专供终端内容上方的高可读浮层；light 为 `rgb(255 255 255 / 0.96)`，dark 为 `rgb(20 20 22 / 0.96)`。
- 所有标签浮层和 tab 右键菜单使用 `bg-[var(--surface-overlay)]`、`backdrop-blur-xl`、`kerminal-floating-enter` 和 `z-[1000]`，避免被终端 pane stacking context 或高对比终端文字干扰。
- tab 选择按钮、关闭按钮、分组 header、overview item、menu item 统一补齐 `kerminal-focus-ring` / `kerminal-pressable`。
- 广播命令输入和重命名输入迁移到 `kerminal-field-surface`；广播目标 badge 和命令确认摘要迁移到 shared surface token。
- 广播成功/失败状态在 light 下改为 `text-emerald-700` / `text-rose-700`，dark 下保留浅色文本，避免浅色主题下状态条文字过淡。
- 重命名弹窗的错误提示补 `role="alert"`。

验证结果：

- 残留扫描 `rg "border-black/8|border-black/10|bg-white/80|bg-white/86|bg-white/96|dark:bg-zinc-950|dark:bg-black/20|focus:ring|hover:bg-black/5|dark:hover:bg-white/8|dark:hover:bg-white/10|bg-black/5|bg-black/10" src/features/terminal/TerminalWorkspace.tsx src/features/terminal/terminalTabChrome.tsx`：无命中。
- 行数检查：`TerminalWorkspace.tsx` 966 行，`terminalTabChrome.tsx` 476 行；未突破 1000 行硬线。`TerminalWorkspace.test.tsx` 已有 1017 行，本轮没有继续追加测试行。
- `npm run test:frontend -- src/features/terminal/TerminalWorkspace.test.tsx`：1 file / 26 tests 通过。
- `npm run test:frontend -- src/features/terminal/TerminalWorkspace.test.tsx src/app/KerminalShell.test.tsx src/features/workspace/workspaceStore.test.ts`：3 files / 91 tests 通过。
- `npm run typecheck`：通过。
- `git diff --check -- src/App.css src/features/terminal/TerminalWorkspace.tsx src/features/terminal/terminalTabChrome.tsx`：通过；仅有 Windows LF -> CRLF 提示。
- `npm run test:frontend`：71 files / 555 tests 通过。
- `npm run build`：通过；仅保留既有 Vite dynamic import / large chunk warnings。
- 真实 dev server `http://127.0.0.1:1435/`：通过真实点击 Settings 外观主题控件、创建浏览器预览本地终端、打开所有标签、右键菜单和重命名弹窗截图。
- Playwright + 系统 Chrome smoke：dark/light/system-light 下 `horizontalOverflow=false`、`consoleIssueCount=0`；tab 选择按钮有 focus class，关闭按钮有 pressable class，浮层带 `bg-[var(--surface-overlay)]` 和 `z-[1000]`。

截图证据：

- `.updeng/data/ui-audit/2026-06-20-round12/01-terminal-tabs-dark-overview.png`
- `.updeng/data/ui-audit/2026-06-20-round12/02-terminal-tabs-dark-context-menu.png`
- `.updeng/data/ui-audit/2026-06-20-round12/03-terminal-tabs-dark-rename.png`
- `.updeng/data/ui-audit/2026-06-20-round12/04-terminal-tabs-light-overview.png`
- `.updeng/data/ui-audit/2026-06-20-round12/05-terminal-tabs-system-light-overview.png`
- `.updeng/data/ui-audit/2026-06-20-round12/terminal-chrome-report.json`

视觉抽查结论：

- 所有标签浮层在 dark/light/system-light 下位置、边界和阴影清晰，未发生横向溢出。
- 右键菜单首次截图看起来被终端文字干扰；computed style 显示是 `kerminal-floating-enter` 过渡中 opacity 约 0.25 的中间帧。截图脚本改为等待 350ms 后，菜单可读性正常；同时本轮将菜单提升到 `z-[1000]` 并使用更实的 overlay surface，降低真实交互中的层级风险。
- 重命名弹窗的输入焦点、面板层级和按钮布局在 dark 下清晰；field surface 和 focus ring 与 Settings/AI 面板一致。

风险记录：

- Browser preview 环境没有通过 UI 触发真实分屏，因此分屏广播栏由组件测试覆盖，未在截图中展示；真实 Tauri 多分屏仍需后续 `npm run tauri:dev` 或实际窗口验证。
- 本轮没有改 terminal session、PTY、pane layout 或 native menu 行为；未跑 `npm run tauri:dev`。
- `TerminalWorkspace.test.tsx` 已超过 1000 行，后续视觉契约测试应新建 focused test file 或先拆测试。

下一轮建议：

- 迁移 MachineSidebar：搜索框、分组 header、机器行、拖拽/选中态、底部设置和添加按钮。
- 迁移 snippets/remote host dialogs：尤其是片段列表、变量输入、执行按钮、连接弹窗 fields 和错误状态。

### 2026-06-20 Round 13：MachineSidebar Material And Menu Pass

状态：已完成。

本轮范围：

- 迁移 `src/features/machine-sidebar/MachineSidebar.tsx` 与 `MachineSidebar.parts.tsx`。
- 搜索框、分组 header、机器行、选中态、collapsed popover、底部操作和右键菜单统一到 `kerminal-*` material、`--surface-*`、`--border-subtle`。
- 侧栏 context menu 和 collapsed popover 使用 `bg-[var(--surface-overlay)]` 与 `z-[1000]`，降低被终端或弹层 stacking context 干扰的风险。

验证结果：

- MachineSidebar residual scan 无旧黑白半透明边框/hover 残留。
- 真实 dev server 下完成 dark、light、system-light/collapsed popover 截图，均无横向溢出。
- 截图证据位于 `.updeng/data/ui-audit/2026-06-20-round13/`，报告为 `machine-sidebar-report.json`。

### 2026-06-20 Round 14：Shared Shell, Modal, Button And Terminal Floating Controls

状态：已完成。

本轮范围：

- 迁移共享基础控件：`src/components/ui/button.tsx`、`modal-shell.tsx`、`src/app/AppTitleBar.tsx`、`KerminalShell.helpers.tsx`、`src/App.tsx`、`src/bootstrap.tsx`。
- 迁移终端浮层：`TerminalContextMenu.tsx`、`TerminalSearchPanel.tsx`、`TerminalCommandBlockRail.tsx`、`TerminalPaneCard.tsx`、`XtermPane.tsx`。
- `Button` 的 secondary/ghost variant 改用 solid/hover surface；Modal shell 使用统一分隔线、overlay material 和 rounded dialog。
- 终端搜索、右键菜单、命令块 rail 与状态提示统一到 overlay/muted surface、focus ring、pressable motion。

验证结果：

- 终端 context/search/command floating control residual scan 无旧 `border-black/*`、`bg-white/*`、`focus:ring` 类残留。
- 相关测试与类型检查在后续全量验证中通过。

### 2026-06-20 Round 15：Remote Host Dialog And SFTP Workspace Pass

状态：已完成。

本轮范围：

- 迁移 Remote Host 创建/编辑弹窗及 `remote-host-dialog/*` 中的输入、卡片、协议面板、Docker 下拉、SSH/SFTP/Terminal 选项。
- 迁移 SFTP 与远程工作区：`ContainerFilesToolContent.tsx`、`SftpTransferWorkbench.tsx`、`RemoteWorkspaceEditor.tsx`、`RemoteWorkspaceWindow.tsx`、`SftpContextMenu.tsx`。
- 输入控件统一 `kerminal-field-surface`，列表和卡片统一 `kerminal-solid-surface` / `kerminal-muted-surface`，菜单统一 overlay material 与高层级。

验证结果：

- Remote Host Dialog residual scan 无旧硬编码 light/dark 透明样式残留。
- SFTP residual scan 无旧硬编码 light/dark 透明样式残留。
- 本轮未修改 SSH/SFTP 后端协议、权限或数据库行为。

### 2026-06-20 Round 16：Snippets, Tool Panel Residual And Final QA

状态：已完成，本计划收口。

本轮范围：

- 迁移 `Switch`、Snippets、Terminal empty/error state、Diagnostics、Runtime Health、System Metrics、Server Info、MCP Prompt Preview、Logs、ToolPanel drawer/loading/crash、AI Audit 管理界面。
- 将最后一个 AI 执行模式按钮从旧 `dark:hover:bg-white/10` 改为 amber 语义 hover 与 `kerminal-focus-ring`。
- 全局扫描收敛旧 UI 关键词：`border-black/8`、`border-black/10`、`border-white/8`、`border-white/10`、`bg-white/72`、`bg-white/80`、`bg-zinc-950/72`、`bg-zinc-950/80`、`hover:bg-black`、`hover:bg-white`、`focus:ring`。

最终验证：

- `rg` 全局旧样式扫描：无命中。
- `npm run test:frontend`：71 files / 555 tests 通过。
- 最后一次 AI/ToolPanel targeted 复验：2 files / 24 tests 通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；保留既有 Vite dynamic import 与 large chunk warnings。
- `git diff --check`：通过；仅有 Windows LF -> CRLF 提示。
- 真实 dev server `http://127.0.0.1:1435/`：HTTP 200。
- Playwright + 系统 Chrome final smoke：dark terminal、dark settings、dark agent、light terminal、system-light sidebar menu 均 `horizontalOverflow=false`，主题状态正确，overlay 菜单使用 `bg-[var(--surface-overlay)]` 与 `z-[1000]`。
- Playwright + 系统 Chrome functional smoke：9/9 场景通过，覆盖 workbench shell、Settings 六个分区、主题切换、右侧六个工具面板、AI 输入框、添加连接弹窗协议列表、终端 tab overlay/context menu、SFTP 传输入口和侧栏搜索。

最终截图证据：

- `.updeng/data/ui-audit/2026-06-20-final/01-final-dark-terminal.png`
- `.updeng/data/ui-audit/2026-06-20-final/02-final-dark-settings.png`
- `.updeng/data/ui-audit/2026-06-20-final/03-final-dark-agent.png`
- `.updeng/data/ui-audit/2026-06-20-final/04-final-light-terminal.png`
- `.updeng/data/ui-audit/2026-06-20-final/05-final-system-light-sidebar-menu.png`
- `.updeng/data/ui-audit/2026-06-20-final/final-ui-report.json`
- `.updeng/data/ui-audit/2026-06-20-final/functional-smoke-report.json`

剩余风险：

- `npm run tauri:dev` 本轮未跑；本计划只改 React/CSS/测试与文档，没有修改 Rust、Tauri window、capability、updater 或权限行为。真实原生窗口体验可在下一次 Tauri 发行前单独 smoke。
- final browser smoke / functional smoke 记录到非阻断 `xterm.js: Parsing error` console 诊断；页面未白屏、无 pageerror、无横向溢出，functional smoke 无 unexpected console。该日志属于终端解析链路风险，不是本轮 UI material 改动引入的视觉阻断。
- Vite large chunk warnings 仍存在，属于既有构建体积治理问题，已排队到代码规范、架构和性能治理计划。
