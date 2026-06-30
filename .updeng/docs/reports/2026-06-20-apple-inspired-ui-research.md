---
id: REPORT-20260620-apple-inspired-ui-research
status: completed
created_at: 2026-06-20T13:49:40+08:00
updated_at: 2026-06-20T13:49:40+08:00
owner: ai
---

# Apple-inspired UI 调研：Kerminal 全面视觉与交互升级

## 一句话结论

Kerminal 不应该把“苹果风”和“科技感”理解成更亮的渐变、更重的模糊或更多装饰。Apple 当前设计语言的核心是：内容优先、材质有层级、动效顺着人的空间直觉、交互控件能被快速理解、技术信息用精确数据和可信细节表达。对 Kerminal 来说，正确方向是“安静、清晰、带一点未来感的开发者工作台”：终端和文件列表保持扎实可读，标题栏、侧栏、右侧 rail、弹层、命令面板和状态 HUD 才使用克制的 glass material。

## 调研范围

本次调研覆盖 Apple 官方设计资料、Apple 产品页、开发者工具/效率工具产品，以及当前 Kerminal 代码与截图。

### Apple 官方与产品资料

| 来源 | 观察重点 | 对 Kerminal 的启发 |
| --- | --- | --- |
| [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines) | 平台一致性、可访问性、控件语义、内容优先 | 不做纯视觉贴皮；先统一层级、语义和可访问性 |
| [Apple HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | 材质用于保留背景上下文，而不是抢走内容 | glass 用在导航层和浮层，终端正文不能玻璃化 |
| [Apple Liquid Glass 新闻稿](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) | Liquid Glass 会反射/折射环境，响应移动，适配亮暗模式 | Kerminal 需要自适应 light/dark/system 的材质 token 和动效 token |
| [WWDC25 Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) | glass 是动态 material，强调视觉清晰、内容让位、导航层使用、避免叠玻璃 | 建立 `nav glass / floating glass / solid content` 三层规则 |
| [WWDC25 Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/) | 新系统重塑界面与内容关系，细节决定整体感 | 不只改主色，按钮、菜单、排序、空状态、焦点和过渡都要统一 |
| [Apple Design Resources](https://developer.apple.com/design/resources/) | SF Pro、SF Mono、SF Symbols、设计模板、图标工具 | UI 用系统字体，终端用 JetBrains Mono/SF Mono；图标优先 lucide/SF-like 单线图标 |
| [Apple Vision Pro](https://www.apple.com/apple-vision-pro/) | 空间层次、数字内容与物理空间融合、低延迟、人因舒适 | 三栏工作台要有明确空间深度；动效要低延迟、低眩晕 |
| [MacBook Pro](https://www.apple.com/macbook-pro/) | 用精确性能、显示、端口、续航指标建立技术可信度 | Kerminal 的“科技感”应来自 latency、session、transfer、host health 等真实数据 |
| [iPhone 17](https://www.apple.com/iphone-17/) | 新系统视觉强调 glass 对内容和设备的实时适配 | 同一个材质系统必须覆盖主窗口、弹窗、portal、独立窗口 |
| [iPad Pro](https://www.apple.com/ipad-pro/) | Apple Pencil 的 hover、squeeze、barrel roll 都是顺手的微交互 | Kerminal 的按钮、拖拽、右键、hover、键盘动作需要更“顺手” |
| [AirPods Pro](https://www.apple.com/airpods-pro/) | 自动适配环境、对话感知、减少用户手动切换 | Kerminal 可以把常用上下文变成自适应状态，而不是让用户频繁找开关 |

### 相近产品资料

| 产品 | 观察重点 | 对 Kerminal 的启发 |
| --- | --- | --- |
| [Warp Docs](https://docs.warp.dev/) | 现代 terminal、blocks、agent mode、多行编辑、补全、Rust 性能 | 终端不是只有 xterm 画布，命令块、AI、上下文状态可以成为专业感来源 |
| [Raycast](https://www.raycast.com/) | keyboard-first、native、fast、extensions、低摩擦命令入口 | Kerminal 需要 command/action palette，把设置、工具、tab、主机动作统一可搜索 |
| [Linear Invisible Details](https://medium.com/linear-app/invisible-details-2ca718b41a44) | 菜单安全区域、快捷键提示、重复操作速度、细节不可见但可感知 | 右键菜单、子菜单、工具栏顺序、快捷键显示要做成高频操作友好 |
| [Linear keyboard shortcut improvements](https://linear.app/changelog/2019-06-20-international-keyboard-shortcut-improvements) | 国际键盘快捷键和 command menu 替代复杂下拉 | Kerminal 默认中文界面也要兼顾 Win/macOS/国际键盘 |
| [Arc Command Bar Actions](https://start.arc.net/command-bar-actions) | 一个命令栏覆盖 tab、历史、开发者工具、主题、归档等动作 | Kerminal 可以用“动作中心”统一找功能，减少侧栏/右栏按钮挤压 |

### GitHub / 开源动效库资料

当前 `package.json` 里没有 Motion、react-spring、AutoAnimate、Floating UI、Vaul 或 React Transition Group 依赖，只有 `@radix-ui/react-slot`。这意味着动效体系可以先从 CSS token 和现有组件入手，再谨慎决定是否引入新依赖。

GitHub API 快照时间：2026-06-20T13:49:40+08:00。

| 库 | 仓库信号 | 适合 Kerminal 的地方 | 风险/不适合点 | 结论 |
| --- | --- | --- | --- | --- |
| [Motion](https://motion.dev/) / [motiondivision/motion](https://github.com/motiondivision/motion) | 32.4k stars，MIT，2026-06-17 仍活跃；npm `motion@12.40.0` 支持 React 19 | 官方定位 production-grade；支持 gestures、layout animation、spring、exit animation；适合 tab overview、panel、dialog、command palette 的复杂 enter/exit/layout | 依赖引入后要约束使用边界，不能让每个组件随意写不同 spring | 推荐作为唯一候选动画库，先做小范围 spike |
| [react-spring](https://github.com/pmndrs/react-spring) | 29.1k stars，MIT，2026-06-19 活跃；npm `@react-spring/web@10.1.1` 支持 React 19 | spring physics 很强，适合拖拽、物理感、复杂交互 | API 心智比 CSS/Motion 更重；Kerminal 不是 3D/物理交互产品 | 只作为参考，不优先引入 |
| [AutoAnimate](https://auto-animate.formkit.com/) / [formkit/auto-animate](https://github.com/formkit/auto-animate) | 13.9k stars，MIT，2026-04-02 有更新；npm `@formkit/auto-animate@0.9.0` | 一行给 list reorder/add/remove 做平滑过渡；适合简单列表排序 | 对复杂 table/grid、虚拟列表、xterm、SFTP 列表可能不够可控；已有公开 issues 指向 React StrictMode 和 overlay 类问题 | 可做局部 spike，不作为全局方案 |
| [Radix Animation Guide](https://www.radix-ui.com/primitives/docs/guides/animation) | Radix 建议用 CSS animation 处理 mount/unmount，并通过 data-state 控制 | 与 shadcn/Radix 风格一致，适合 dialog/popover/menu 的基础入场出场 | Kerminal 当前没有完整 Radix primitives，只能借鉴 data-state/CSS 模式 | 推荐作为基础模式：CSS first |
| [Floating UI](https://github.com/floating-ui/floating-ui) | 32.6k stars，MIT，2026-06-10 活跃；npm `@floating-ui/react@0.27.19` | 解决 tooltip、popover、dropdown 的 anchor positioning、collision、interaction accessibility | 它不是动画库；引入后主要解决定位和交互，不解决 motion 风格 | 菜单/tooltip 定位需要升级时再引入 |
| [Vaul](https://github.com/emilkowalski/vaul) | 8.4k stars，MIT，但仓库说明已 unmaintained，latest release 2024-12 | Drawer 手感和拖拽理念值得参考 | 未维护，不适合作为新依赖 | 不引入，只学习 drawer 手势和 sheet 体验 |
| [Animate UI](https://animate-ui.com/docs) | 3.7k stars，组件分发，不是传统 npm 库 | 提供 Motion + Tailwind + shadcn 风格的 animated components，可参考实现 | copy-first 组件质量要逐个审，视觉偏展示型，可能带来风格不一致 | 只作为参考和原型来源，不直接批量复制 |
| [React Transition Group](https://reactcommunity.org/react-transition-group/) | 10.2k stars，BSD-3-Clause；npm `4.4.5` | 只管理 enter/exit 阶段，CSS 自己写 | React 19 生态下 issues 较多；能力不如 CSS data-state + Motion | 不推荐新引入 |

动效库结论：

- 默认方案：CSS token + data-state/data-motion class，覆盖 hover、press、menu、dialog、sidebar collapse、status chip。
- 复杂方案：如果 tab/pane layout、command palette、AI pending sheet、SFTP drag overlay 需要更自然的 enter/exit/layout，优先小范围引入 `motion`，并建立 `MotionProvider`/`useReducedMotion` 约束。
- 不推荐：把 AutoAnimate 直接套在 SFTP 文件表、terminal panes 或设置表单上；不引入 Vaul 和 React Transition Group。
- 参考方式：可以从 Animate UI 和 Vaul 学习 sheet、popover、animated icon、drawer 手感，但代码必须本地化、token 化、主题化。

## Apple 风格为什么显得“科技”

### 1. 技术感来自真实能力，而不是装饰

Apple 产品页很少用“赛博风”装饰来表达科技感，而是用真实规格、真实材料、真实交互和足够克制的镜头语言建立信任。MacBook Pro 页面会强调显示亮度、芯片、神经加速器、端口、续航；Vision Pro 会强调空间计算、低延迟、舒适佩戴、视听输入；AirPods 会强调主动降噪、自适应音频、对话感知。

Kerminal 对应做法：

- 在 UI 中展示真实状态：SSH 延迟、PTY 状态、SFTP 速度、传输剩余时间、AI context bytes、host trust、port forwarding count。
- 技术信息用小型 HUD、status pill、mono 数字和精确单位表达，而不是大面积霓虹背景。
- 终端、日志、文件列表必须是最清楚的内容层；装饰不能压过信息。

### 2. 玻璃不是背景特效，而是空间层级

Apple 的 Liquid Glass 是一种“上层界面材料”：按钮、tab bar、side bar、floating controls、sheet、popover 等可以 glass；主要内容层要保持可读并把注意力让给内容。WWDC 的核心原则可以概括为：glass 要适配环境、保持清晰、让位于内容、用于 navigation layer，不要把 glass 叠在 glass 上。

Kerminal 对应做法：

- `AppTitleBar`、`MachineSidebar`、`ToolPanel rail`、`ModalShell`、context menu、tab overview、command palette 用 glass。
- `XtermPane`、文件列表、设置表单内容区、代码/日志输出用 solid 或 elevated solid。
- 不在终端画布上做玻璃；终端的 premium 感来自字体、色盘、焦点、边框、吞吐和状态反馈。
- 不做层层透明卡片套娃。一个区域最多一层 material，内部用 rows/dividers 控制层级。

### 3. 动效显得自然，是因为它解释了空间关系

Apple 的动效通常不是为了炫，而是说明“东西从哪里来、到哪里去、状态为什么改变”。好的动效有几个特点：短、连续、有物理感、可预测、可被 reduced motion 关闭。

Kerminal 对应做法：

- hover/press：90-140ms，轻微背景和 scale，不让控件跳动。
- popover/menu：120-180ms，从触发点附近 fade + scale + translate 进入。
- panel/sidebar collapse：180-260ms，宽度和内容 opacity 分离，避免文字挤压。
- tab/pane layout：200-320ms，重点是让用户看到 active pane 和 split 的空间关系。
- terminal 输出不做花哨动画；只给状态层和 UI shell 做运动。
- 先用 CSS token 建立统一节奏；只有当 layout/exit/gesture 复杂度超过 CSS 可控范围时，才引入 `motion`。

### 4. 人性化来自默认路径和操作顺序

Apple 产品的易用感来自“你要的东西在此刻可见，不需要解释”。Linear 和 Raycast 也类似：高频动作靠近目标，快捷键被菜单顺手教会，命令入口覆盖深层功能。

Kerminal 对应做法：

- 主动作优先级固定：连接/打开 > 新建 > 搜索 > 管理 > 删除。
- 危险操作永远靠后，使用红色语义和二次确认。
- 菜单项显示快捷键；常用菜单动作前置；重复操作不需要长鼠标路径。
- 工具栏按钮用图标 + tooltip；只有需要消歧时保留短文本。
- 空状态提供下一步动作，而不是只显示“暂无”。

## 当前 Kerminal UI 审计

### 视觉截图证据

本轮使用当前 1425 Vite 实例做了浏览器 smoke 和截图，保存到：

- `.updeng/data/ui-audit/2026-06-20/desktop-default.png`
- `.updeng/data/ui-audit/2026-06-20/mobile-default.png`
- `.updeng/data/ui-audit/2026-06-20/desktop-settings.png`
- `.updeng/data/ui-audit/2026-06-20/desktop-settings-light-click.png`

结果：

- `http://127.0.0.1:1425/` 返回 200。
- 默认桌面和窄屏截图没有 console error。
- 设置弹窗在深色和浅色点击预览下能渲染，`data-theme="light"` 能切换。

### 已有优点

- 已经使用系统 UI 字体和 JetBrains Mono / SF Mono 终端字体栈。
- `useDocumentTheme` 已把 theme/density/language 写到 `documentElement`，portal 继承主题的基础是对的。
- 已经有 `Button`、`ModalShell`、`ToolPanel`、`SettingsDialog` 等可作为统一改造入口。
- 已有 light/dark/system、density、terminal theme、cursor、ghost suggestion 等设置能力。
- 已有 reduced motion 基础 CSS。
- 已使用 lucide 图标，符合“图标优先”的方向。

### 主要问题

1. Material 语言不统一：各组件重复写 `bg-white/70`、`dark:bg-white/6`、`backdrop-blur-xl`、`border-black/8`，导致局部像玻璃，整体不像一个系统。
2. 层级过平：默认桌面中标题栏、左侧栏、右 rail、中央空状态都是接近的黑面，缺少“导航层浮起、内容层稳定”的空间关系。
3. 空状态不够人性化：中央空状态很大但只说“暂无终端 tab”，没有创建本地终端、连接 SSH、打开最近会话等动作。
4. 窄屏布局失控：390px 宽度下中间终端区被挤成竖条，右 rail 仍占固定空间，说明断点和收起优先级需要重做。
5. 设置区卡片套卡片：Settings 已有丰富能力，但说明文字、选择卡、表单控件在同一层竞争注意力，读起来重。
6. 交互动效薄：多数是 `transition`，缺少 floating layer 入场、panel collapse、selected state、drag state 的统一 motion。
7. 菜单与工具入口分散：SFTP、AI、终端、设置各自有按钮/菜单样式，快捷键提示和 action search 不统一。
8. 技术感表达不足：已有大量真实状态，但没有形成统一的 status HUD、mono metric、risk badge 和 activity indicator 体系。
9. 色彩策略偏局部：部分 group/tag/status 色彩较饱和，选中态常用 sky，高亮语义容易过载。
10. 响应式不是产品级：作为 Tauri 桌面工具可以不追求手机优先，但小窗口/窄宽度必须可用，至少要明确自动收起顺序。

## 模块级改造方向

### App Shell / Titlebar

现状：

- 标题栏 44px，自绘窗口按钮可用。
- 背景和主 shell 使用硬编码深浅色。
- 左侧 collapse、窗口控制、右侧工具切换都偏“图标堆叠”。

改造：

- 标题栏使用 `material-nav`：低透明、强边界、轻 blur、轻 highlight。
- 左侧 collapse 和右侧 rail 使用同一 icon button 尺寸和 hover token。
- 窗口控制保留平台习惯，hover/press 需要更细腻，不使用大块突兀颜色。
- 小窗口优先收起右栏，其次压缩侧栏为 rail，最后进入 command palette 模式。

### Machine Sidebar

现状：

- 主机树结构完整，搜索、分组、拖拽、context menu 都有。
- 空状态和分组/host row 视觉偏普通列表。

改造：

- 做成 macOS source list 风格：44-48px rows，左图标、主标题、右 status/metric，二级描述只在必要时出现。
- 排序规则：Pinned > Active/Connected > Recent > Groups natural sort；生产主机和未信任主机用语义 badge。
- 空状态提供“新建 SSH 主机 / 新建本地终端 / 导入配置”三种下一步。
- collapsed rail hover 时展开 glass popover，不让用户失去上下文。

### Terminal Workspace

现状：

- tab group、pane card、split、broadcast、context menu 基础完整。
- 中央空状态、tab bar、pane header 的层级不够 Apple-like。

改造：

- 终端内容区固定为 `surface-terminal-solid`，不玻璃化。
- Tab bar 是 navigation glass；active tab 不是强色块，而是轻浮起、底部/顶部细线和清晰 title。
- Pane focus 使用 subtle ring + header accent，不用强烈蓝边占满注意力。
- Broadcast command 改成风险 sheet：显示目标 pane 数、生产主机提示、发送动作和取消。
- 空状态变成 developer cockpit：本地终端、SSH、最近连接、AI 帮我配置四个入口。

### Terminal Pane / Xterm

现状：

- xterm 基本可用，主题和字体已有设置。
- header、状态 badge、日志 badge、ghost suggestion 仍偏局部设计。

改造：

- Header 40-44px，状态信息集中在右侧小型 HUD。
- 终端色盘减少一味黑灰，保留深色但提高语义色可读性。
- Ghost suggestion 不能抢 prompt；接受/拒绝 affordance 要更明确。
- 日志记录、断开、重连、搜索都用统一 status chip。

### Tool Panel / Right Rail

现状：

- Rail 图标完整，内容 lazy loading。
- Active tool 使用 sky，rail 与主内容边界较硬。

改造：

- Rail 是 `material-nav`，icon button 32-36px，active 使用 pill + subtle glow。
- Tool content 默认 solid，不套玻璃。
- 工具 header 固定高度，标题、当前上下文、主动作一致。
- 当宽度不足时，rail 优先进入 bottom/overlay command mode，而不是挤压 terminal。

### AI Panel

现状：

- 对话、provider、history、audit、pending invocation 已有。
- Header、history、audit、composer 和 pending panel 视觉语法不统一。

改造：

- AI 顶部做 context signal strip：active tab、focused pane、provider、policy、context bytes。
- Composer 做 glass dock，但消息列表保持 solid/readable。
- Pending invocation 做“风险确认 sheet”：工具名、影响范围、风险等级、输入摘要、批准/拒绝。
- History/audit 使用同一 command-list 风格，支持搜索、快捷键和时间/状态排序。

### SFTP / Remote Workspace

现状：

- 目录浏览、路径输入、上传下载、传输队列、拖拽、远程编辑器都已经比较完整。
- SFTP 代码里每个局部都在直接写 border/bg/blur 类。

改造：

- 文件区做 Finder-like list：目录优先、自然排序、按名称/大小/修改时间/类型可切换。
- Toolbar 分组：导航、视图、创建、传输、危险操作；危险操作只在 selection/context menu 出现。
- Path input 是 mono breadcrumb/search hybrid，focus 时可编辑完整路径。
- 拖拽 drop zone 使用清晰 overlay，显示源/目标/数量/动作。
- 传输队列使用底部 compact sheet：active first，失败可重试，完成可清理。

### Settings

现状：

- 设置能力完整，深浅色、密度、背景、终端主题、字体、光标、ghost suggestion 等都已有。
- 视觉上大量卡片、说明和控件在同一层。

改造：

- Settings 改成 native settings 结构：左侧分类 source list，右侧 section + rows。
- 大卡片只用于“可视化选择”或 preview；普通设置使用 row + label + control + helper。
- 说明文字默认 12px/secondary，只解释风险或不可逆行为；常规行为不堆长描述。
- 字体和光标 preview 保留，但放在 compact preview panel 中。
- Theme/density 使用 segmented control；terminal font/size/line-height 用 input/slider/stepper。

### Modal / Popover / Context Menu / Toast

现状：

- `ModalShell` 已有 portal 和 blur。
- 各处 context menu、upload menu、dialog surface 重复写样式。

改造：

- 统一 `FloatingSurface`/`MenuSurface`/`GlassDialog`。
- 入场：fade + scale 0.98 -> 1 + translate 4px -> 0，120-180ms。
- 退出：90-120ms，快速消失。
- Context menu 行高 32-36px，左 icon、label、右 shortcut；危险操作分组靠后。
- 子菜单需要安全区域，避免鼠标斜向移动时误关。

### Empty / Loading / Error

现状：

- 多处只显示“暂无”“加载中”“失败原因”。

改造：

- Empty state 必须有下一步主动作。
- Loading 用 skeleton/progress，不让布局跳动。
- Error 显示用户能做什么：重试、复制错误、打开日志、生成诊断包。
- Success 不长期占位；短 toast + 状态刷新即可。

## 设计 token 建议

### Surface token

| Token | 用途 | 深色建议 | 浅色建议 |
| --- | --- | --- | --- |
| `--surface-page` | app 背景 | `#0b0b0d` | `#f5f5f7` |
| `--surface-terminal` | 终端内容 | `#17171a` | `#fbfbfd` |
| `--surface-solid` | 文件列表/设置内容 | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.82)` |
| `--surface-nav-glass` | titlebar/sidebar/rail/tabbar | `rgba(18,18,22,0.72)` | `rgba(255,255,255,0.66)` |
| `--surface-floating-glass` | popover/menu/dialog | `rgba(22,22,26,0.78)` | `rgba(255,255,255,0.78)` |
| `--surface-hover` | row/button hover | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.045)` |
| `--surface-selected` | selected row/tab | accent alpha, not full fill | accent alpha, not full fill |

### Typography

| 场景 | 字号 | 字重 | 行高 | 说明 |
| --- | --- | --- | --- | --- |
| Window/panel title | 15-17px | 600 | 1.25 | 不做 oversized hero |
| Section title | 13-14px | 600 | 1.3 | 设置、工具模块标题 |
| Body/list row | 13px | 400/500 | 1.35 | 主机、文件、工具列表 |
| Helper/description | 11-12px | 400 | 1.35 | 只解释必要信息 |
| Metric/HUD | 11-12px | 500/600 | 1.2 | 使用 mono 或 tabular nums |
| Terminal | 13-14px | 400/500 | 1.32-1.45 | 默认不小于 13px |

### Card 和区域尺寸

| 元素 | 建议尺寸 | 规则 |
| --- | --- | --- |
| Icon button | 32/36px | toolbar/rail 统一，圆角 9-12px |
| Sidebar row | 44-48px | 主标题 + 一行状态；描述可折叠 |
| Tool rail | 52-60px 宽 | 不挤压主内容，小窗口 overlay |
| Pane header | 40-44px | 状态右对齐，主标题可截断 |
| Settings row | 44-56px | label/control 一行，helper 仅必要时显示 |
| Selection card | 80-96px 高 | 仅用于主题、密度、光标等可视选择 |
| Dialog radius | 22-26px | 大浮层；内部不要再大圆角堆叠 |
| Content card radius | 14-18px | 重复项或真实分组，避免页面 section 卡片化 |

### Motion token

| Token | 时长 | easing | 用途 |
| --- | --- | --- | --- |
| `--motion-fast` | 90-120ms | ease-out | hover/press/color |
| `--motion-menu` | 120-180ms | cubic-bezier(0.16, 1, 0.3, 1) | menu/popover |
| `--motion-panel` | 180-260ms | cubic-bezier(0.2, 0.8, 0.2, 1) | sidebar/tool panel |
| `--motion-layout` | 220-320ms | cubic-bezier(0.16, 1, 0.3, 1) | split/pane/overview |

所有 motion 都必须遵守 `prefers-reduced-motion: reduce`：保留状态变化，去掉位移、scale 和长动画。

### 动效实现分层

| 层级 | 实现方式 | 适用场景 | 不适用场景 |
| --- | --- | --- | --- |
| CSS transition | CSS variables + Tailwind/class | hover、press、focus、color、shadow、border | 需要 enter/exit 生命周期的浮层 |
| CSS keyframes + data-state | Radix-like `data-state=open/closed` | modal、popover、context menu、toast | layout reorder 和复杂手势 |
| Web Animations / AutoAnimate spike | 局部 hook | 简单列表 add/remove/reorder | SFTP table、虚拟列表、terminal pane |
| Motion | 受控 wrapper，集中封装 | tab overview、command palette、pane layout、sheet exit、drag overlay | 普通按钮、普通 row、terminal 输出 |
| react-spring | 暂不引入 | 未来如有复杂拖拽/物理 sheet 可重新评估 | 当前生产力 UI 常规动效 |

## 排序与操作顺序规则

### 主机侧栏

1. Pinned / Favorites。
2. 当前连接中。
3. 最近使用。
4. 分组 natural sort。
5. 离线/未配置/隐藏。

### Terminal tabs

1. 当前 active tab 固定可见。
2. 同一 machine 分组保持相邻。
3. 最近有活动的 tab 排在组内前面。
4. 关闭/重命名/断开等操作进入 context menu，危险动作靠后。

### SFTP 文件列表

1. 目录优先。
2. 文件 natural sort。
3. 隐藏文件在开启后显示，但不抢顶部。
4. 传输队列 active > failed > queued > completed。

### 工具与菜单

1. 高频安全动作靠前。
2. 修改类动作在中段。
3. 危险动作独立分组靠后。
4. 每个菜单项尽量显示快捷键或二级说明。

## 文案和说明文字规则

- 不用页面内文字解释 UI 本身，例如“点击这里可以...”。
- 描述只解释风险、状态来源、不可逆行为或用户可能误解的技术边界。
- 专业术语保留英文：SSH、SFTP、PTY、AI、MCP、Rig、SQLite、host key。
- 空状态文案要直接给下一步，而不是只描述空。
- 错误文案包含动作：重试、复制错误、打开日志、生成诊断包。

## Geek / Tech 感的具体落点

Kerminal 的 geek 感应该来自这些细节：

- Mono metrics：`12ms latency`、`3 panes`、`SFTP 8.4 MB/s`、`context 12.8KB`。
- Tiny status LEDs：connected、recording、trusted、production、AI pending。
- Command-oriented flow：`Ctrl+K`/`Cmd+K` action palette，任何深层功能都能搜。
- Dense but breathable：高信息密度，但每个 row 有稳定尺寸和对齐。
- Deterministic feedback：按下按钮立刻有状态，长任务显示进度，失败可重试。
- Developer-first polish：终端字体、光标、selection、复制、搜索、右键、快捷键都顺手。

## 需要避免的方向

- 不做 Apple 官网式营销 hero；Kerminal 是桌面生产力工具。
- 不用大面积渐变、装饰光球、过度霓虹或单一紫蓝色调。
- 不把 glass 套到 terminal/text/list 正文上。
- 不为动效引入不可控复杂依赖；优先 CSS token 和 data-state，`motion` 只能在复杂 layout/exit/gesture 场景小范围使用。
- 不直接引入未维护的 Vaul，也不批量复制 Animate UI 组件。
- 不一次性重写所有 UI；先建 token 和基线，再逐模块迁移。
- 不牺牲浅色/深色/system 主题和高对比度可读性。

## 下一步

实施计划见：

- `.updeng/docs/plan/next/2026-06-20-apple-inspired-ui-overhaul.md`
- `.updeng/docs/issues/2026-06-20-apple-inspired-ui-overhaul-slices.md`
