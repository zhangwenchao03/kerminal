# Otty UI 调研与 Kerminal 生产实施建议

整理时间：2026-06-25T10:40:34+08:00

## 调研范围

- 官网与产品页：`https://otty.sh/`、`/learn/`、全部 Learn 文章、`/releases/all`。
- 文档主界面：`https://docs.otty.sh/` 下的 Getting Started、User Interface、Workflows、Terminal Features、Agents、Customization、Reference、Pricing、Privacy、License、Changelog。
- 采集证据：`.updeng/docs/verification/otty-research-20260625/`，共 74 个产品/文档页面结构化 JSON 和对应截图。VT escape sequence 叶子页数量多且属于同一协议参考模板，本次只把 VT overview/reference 类入口纳入产品界面分析，不把每个控制序列叶子页作为独立 UI 方向。
- 原型：`.updeng/docs/prototypes/otty-inspired-kerminal-workspace.prototype.html`。

主要来源：

- [Otty 官网](https://otty.sh/)
- [Otty Docs](https://docs.otty.sh/)
- [Window, Tab and Split](https://docs.otty.sh/user-interface/window-tab-split)
- [Details Panel](https://docs.otty.sh/user-interface/details-panel)
- [Files, Folder and Links](https://docs.otty.sh/user-interface/files-and-links)
- [Open Quickly](https://docs.otty.sh/user-interface/open-quickly)
- [Command Palette](https://docs.otty.sh/user-interface/command-palette)
- [Working with Code Agents](https://docs.otty.sh/agents/agents-overview)
- [Recipes](https://docs.otty.sh/workflows/recipes)
- [Themes](https://docs.otty.sh/customization/themes)

## Otty 视觉结论

Otty 的视觉不是传统终端的高对比 neon 风，而是低饱和、编辑器化、文档化的生产工具风格。

| 维度 | 观察 | 可迁移到 Kerminal 的方式 |
| --- | --- | --- |
| 主背景 | 官网与 docs 都以接近黑色的中性底为主，页面空间克制，截图成为主视觉 | Kerminal 已经是工作台界面，不建议做大面积装饰；保留深色中性底，把终端和上下文面板作为主视觉 |
| 文字 | 暖白正文 `rgb(223,223,214)`、灰色辅助 `rgb(152,152,159)`，避免纯白刺眼 | 当前 Kerminal 可以继续使用主题变量，但右栏详情和命令面板应降低纯白/高亮面积 |
| 强调色 | 蓝紫 `rgb(168,177,255)` 做链接/聚焦，少量绿色表示运行/完成 | Kerminal 保留青绿作为机器/连接状态，新增蓝紫用于“可跳转/可执行/搜索命中”语义 |
| 边框 | 弱边框、弱阴影、低分隔，圆角克制 | Kerminal 现有卡片偏多，后续右栏上下文面板要减少卡片套卡片，改成分区列表和轻量 inspector |
| 截图表达 | 官网每段都用应用截图证明能力，文档页用真实 UI 截图嵌入正文 | Kerminal README/计划后续可以按“功能模块截图 + 行为说明”组织，减少抽象宣传语 |

## Otty 布局模式

### 官网首页

首页结构是窄内容列 + 大应用截图 + 分段能力叙事：

1. 顶部品牌与下载 CTA。
2. 大型产品截图作为第一视觉，强调真实应用界面。
3. 能力分区：起步简单、现代终端能力、多窗口/多线程、快捷入口、Agent 工作流。
4. 底部下载与文档/法律/联系入口。

对 Kerminal 的启发：官网/README 可以继续用真实工作台截图，但产品内不要学习首页式营销布局。Kerminal 应学习的是“每个能力都有真实界面承载”，不是把桌面应用改成卡片型 landing page。

### Docs 知识库

Docs 使用三栏结构：

- 左侧：功能树，按 Getting Started、User Interface、Workflows、Terminal Features、Agents、Customization、Reference 分组。
- 中间：正文与截图，严格围绕一个能力解释。
- 右侧：On this page 页内目录。

对 Kerminal 的启发：Kerminal 内部右栏也需要类似的信息架构。当前右栏是工具 rail；未来可以在工具 rail 顶层增加“Context”页，把焦点 pane 的信息、outline、文件、git、任务状态聚合出来。

## Otty 应用模块与连接关系

Otty 暴露出的应用模块可以归纳为 7 组：

| 模块组 | Otty 入口 | 模块连接 |
| --- | --- | --- |
| 工作区框架 | Window, Tab and Split、Status Bar | window -> tab -> pane；tab 有状态 badge；pane 可拆分、移动、恢复 |
| 上下文详情 | Details Panel、Outline、Files and Links | focused pane -> info/outline/git/files；终端输出被解析成文件、URL、diff、prompt 等对象 |
| 快速入口 | Open Quickly、Command Palette、Find | Open Quickly 搜对象；Command Palette 搜动作；Find 搜当前 pane 文本 |
| 终端能力 | shell integration、selection、scroll、images、progress state、hint/read-only | shell/OSC/输出解析 -> cwd、命令块、进度、链接、图像、提示 |
| Workflow | Recipes、Session Recovery、Frequent Folders、CLI usage、Data Sync | layout + commands + snippets + settings 可保存、恢复、分享 |
| Agent | Supported Agents、Composer、Prompt Queue、Monitor Tasks、History、Fork/Branch、Send to Chat | agent run -> tab badge/notification/prompt queue/history/file viewer |
| Customization | Themes、Fonts、Keybindings、Config File、Import/Export | live theme/config/keybinding -> UI 即时生效；配置文件可编辑 |

核心连接图：

```mermaid
flowchart LR
  "Focused Pane" --> "Details Panel"
  "Focused Pane" --> "Find"
  "Focused Pane" --> "Current Filter"
  "Terminal Output" --> "Files / Links / Outline"
  "Shell Integration" --> "cwd / command marks / progress"
  "Open Quickly" --> "Tabs / Hosts / Folders / Commands / Agents / Recipes"
  "Command Palette" --> "Window actions / pane actions / theme / settings / recipes"
  "Agent Run" --> "Tab Badge / Prompt Queue / History / Send to Chat"
  "Recipes" --> "Saved Layout / Safe Command Replay / Snippets"
```

## Kerminal 当前适配判断

Kerminal 现有信息架构是：

- 左侧 `MachineSidebar`：Local、SSH、Docker、RDP、Telnet、Serial。
- 中间 `TerminalWorkspace`：tab、pane、分屏、命令块、终端会话。
- 右侧 `ToolPanel`：Agent Launcher、系统信息、SFTP、端口、Snippets、Logs、Settings。
- `ToolPanelStoreBridge` 已能把 `activeTab`、`focusedPane`、`selectedMachine` 传给右栏。

这意味着 Kerminal 已有可学习 otty 的底座，但需要补一个“焦点上下文层”：

| Otty 能力 | Kerminal 现状 | 建议 |
| --- | --- | --- |
| Details Panel | 右栏工具多，但用户要手动切换 | 新增 `Context Inspector`，默认随 focused pane 展示 Info/Outline/Files/Git/Tasks |
| Open Quickly | 主机搜索、命令历史、snippet/workflow 分散 | 建统一对象搜索，providers 覆盖 hosts/tabs/panes/paths/history/snippets/workflows/agents |
| Command Palette | 操作分散在按钮/右键/菜单 | 建统一 action registry，支持 pane/window/app scope 和快捷键说明 |
| Files and Links | 终端已有命令块，SFTP 已强 | 增加终端输出 artifact detector，把路径/URL/git diff/日志文件送入 inspector 和 SFTP |
| Agent Monitor | Agent Launcher 已外置化 | 补 tab badge、prompt queue、session history、send selection/output to agent |
| Recipes | Snippets/workflows 已存在 | 增加 layout snapshot + safe replay，和 workflow/snippet 文件配置打通 |
| Themes | Kerminal 已有深浅/系统和背景 | 后续新增界面必须同时覆盖 light/dark/system，颜色走 token |

## 建议做出的效果界面

原型文件：`.updeng/docs/prototypes/otty-inspired-kerminal-workspace.prototype.html`

原型包含 4 个界面：

1. **Context Inspector**：右侧随当前 pane 聚合 Info、Outline、Files、Git、Tasks，替代“先想起工具再切换”的操作。
2. **Open Quickly / Command Palette**：对象搜索与动作搜索分离，支持 hosts、tabs、paths、commands、workflows、agents。
3. **Agent Task Monitor**：tab badge、prompt queue、fork/branch、send to chat、history 统一在 Agent lane。
4. **Files and Links**：终端输出对象化，文件/URL/diff/log 可直接预览、打开、发给 SFTP 或 Agent。

## 生产实施计划

正式计划文件：`.updeng/docs/plan/next/PLAN-20260625-104034-otty-inspired-kerminal-context-workspace.md`

推荐分 6 个可提交切片，不做一次性大改：

1. **Context Model**：抽 `workspaceContextModel`，把 active tab、focused pane、selected machine、cwd、output history、command blocks、agent session、SFTP scope 归一化。
2. **Context Inspector UI**：在右栏新增 `context` tool，显示 Info/Outline/Files/Git/Tasks；保留现有 System/SFTP/Ports 等工具作为深入口。
3. **Open Quickly**：新增对象 provider registry，先覆盖 host/tab/pane/path/history/snippet/workflow/agent session；动作只给打开/聚焦/复制/发送。
4. **Command Palette**：新增 action registry，接入现有右键菜单、分屏、SFTP、port、settings、theme、diagnostics、workflow actions；区分 pane/window/app scope。
5. **Terminal Artifacts**：在命令块/输出 history 上做轻量 detector，识别路径、URL、git diff、日志路径、OSC 8 hyperlink、OSC 7 cwd；结果进入 inspector。
6. **Agent Workflow**：围绕现有 Agent Launcher 补 tab badge、prompt queue、send selection/output to chat、history/fork/branch 的最小闭环。

## 验证口径

- 自动化：新增纯模型测试、provider/action registry 测试、artifact detector 测试、workspace selector 测试。
- 前端：相邻 Vitest + `npm run build`。
- 运行态：Vite dev server smoke；深色、浅色、跟随系统截图；窄屏和默认桌面截图；Open Quickly/Command Palette 键盘流。
- Tauri：涉及窗口、通知、系统唤醒、Agent terminal 或文件打开时跑 `npm run tauri:dev` 或记录不可运行原因。
- 性能：Open Quickly 首次打开和增量搜索不得扫描远端大目录；terminal artifact detector 不阻塞 xterm 输出路径。

## 风险和边界

- 不要复制 Otty 的品牌、截图、文案或 macOS-only 外观；只借鉴信息架构和交互模式。
- Kerminal 的核心对象是“目标机器”，Otty 的核心对象是“pane/session”。实施时应保留 Kerminal 左侧主机树，不改成纯 tab-centric。
- Agent 能力继续遵守 Kerminal MCP tools-only 边界；不要恢复内置 AI provider、pending approval 或配置 CRUD。
- 新增 UI 必须走主题变量和现有密度设置，不硬编码只适合深色的颜色。
- Recipes/safe replay 涉及命令执行安全，不在第一阶段做自动执行；先做保存、预览、人工触发和风险标记。
