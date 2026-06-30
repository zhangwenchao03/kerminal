---
id: PLAN-20260625-104034-otty-inspired-kerminal-context-workspace
status: next
created_at: 2026-06-25T10:40:34+08:00
started_at:
completed_at:
updated_at: 2026-06-25T10:40:34+08:00
owner: ai
---

# Otty-inspired Kerminal Context Workspace

## 目标

- 借鉴 Otty 的上下文详情、对象搜索、动作面板、Agent 任务状态和 Recipes 思路，形成 Kerminal 可生产落地的工作台体验。
- 保留 Kerminal 的核心定位：目标机器优先、多协议、多终端、多文件/隧道/Agent 运行态工具。
- 用现有主题变量、密度设置、右栏工具架构和 workspace store 渐进改造，不做整套 UI 重写。

## 非目标

- 不复制 Otty 的品牌、截图、文案或 macOS-only 产品形态。
- 不恢复旧内置 AI provider、custom MCP、pending/confirm/approval/audit 链路。
- 不把 Snippets/Workflows 的命令回放改成默认自动执行；第一阶段只做保存、预览、人工触发和风险标记。
- 不在第一阶段做远端大目录全量索引或后台长时间扫描。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 前端工作台 | 是 | `src/app/KerminalShell.workspaceBridge.tsx`、`src/features/workspace/**` | selector/model tests、运行态截图 |
| 右侧工具栏 | 是 | `src/features/tool-panel/**` | ToolPanel tests、theme screenshots |
| 终端输出/命令块 | 是 | `src/features/terminal/**` | detector/model tests、xterm smoke |
| SFTP/文件对象 | 是 | `src/features/sftp/**` | SFTP UI tests、drag/drop smoke |
| Agent Launcher | 是 | `src/features/tool-panel/AgentLauncherToolContent.tsx`、`agent-launcher/**` | agent launcher tests、manual smoke |
| 设置/主题 | 是 | `src/features/settings/**`、`src/App.css` | dark/light/system screenshots |
| Rust/Tauri | 可能 | notification、file open、agent session APIs | `npm run tauri:dev` if touched |

## 资料与原型

- 调研报告：`.updeng/docs/reports/otty-ui-research-kerminal-implementation-20260625.md`
- 调研证据：`.updeng/docs/verification/otty-research-20260625/`
- UI 原型：`.updeng/docs/prototypes/otty-inspired-kerminal-workspace.prototype.html`

原型问题：Otty 的上下文详情、对象搜索、动作面板和 Agent task 体验能否以 Kerminal 的机器优先工作台方式落地。

非目标：验证真实终端协议、真实远端文件读写、真实 Agent provider 或系统通知。

成功信号：用户能从原型中看懂 4 个未来效果界面：Context Inspector、Open Quickly/Command Palette、Agent Task Monitor、Files and Links。

删除/吸收条件：正式实现进入 TASK-002 后，原型保留为视觉参考；实现完成并有真实运行截图后删除或移动到归档。

## 执行步骤

- [ ] TASK-001 Context Model
  - 新增纯模型，把 `activeTab`、`focusedPane`、`selectedMachine`、cwd、output history、command blocks、agent session、SFTP scope 归一化。
  - 不触碰运行态副作用；先用 fixture 锁定空态、本地/SSH/container、SFTP workspace tab、多 pane focus。
  - 验证：workspace selector/model tests。

- [ ] TASK-002 Context Inspector UI
  - 在右栏新增 `context` tool，显示 Info、Outline、Files、Git、Tasks。
  - 默认随 focused pane 刷新；现有 System/SFTP/Ports/Snippets/Logs/Agent 保留为深入口。
  - 验证：ToolPanel tests、dark/light/system 截图、窄屏布局。

- [ ] TASK-003 Open Quickly
  - 新增对象 provider registry：hosts、tabs、panes、recent paths、command history、snippets、workflows、agent sessions。
  - 只做低风险动作：open/focus/copy/send；远端目录不做全量扫描。
  - 验证：provider tests、键盘流测试、dev server smoke。

- [ ] TASK-004 Command Palette
  - 新增 action registry，接入现有菜单和右键菜单动作：分屏、关闭/重命名、SFTP、port、settings、theme、diagnostics、workflow。
  - 动作必须带 scope：pane/window/app；危险动作只打开确认 UI，不直接执行。
  - 验证：action model tests、快捷键冲突检查、browser keyboard smoke。

- [ ] TASK-005 Terminal Artifacts
  - 在命令块/输出 history 上做轻量 detector：路径、URL、OSC 8 link、OSC 7 cwd、git diff、日志文件、progress state。
  - detector 必须异步或增量，不阻塞 xterm 输出。
  - 验证：detector unit tests、terminal output performance smoke。

- [ ] TASK-006 Agent Workflow
  - 围绕现有 Agent Launcher 增加 tab badge、prompt queue、send selection/output to chat、history、fork/branch entry。
  - 保持外部 Agent + MCP tools-only 边界，不引入内置 provider。
  - 验证：AgentLauncher tests、dev server screenshot、必要时 `npm run tauri:dev`。

- [ ] TASK-007 Recipes / Layout Snapshot
  - 把 workspace layout、focused machine、pane arrangement、manual command sequence、snippet/workflow reference 保存为可预览对象。
  - 首版只支持人工打开和手动运行；safe replay 策略单独评审。
  - 验证：serialization tests、settings/config validator、manual smoke。

## 生产验证门禁

- 每个切片至少运行相邻 Vitest 和 `npm run build`。
- 任何 UI 切片必须启动真实 dev server，采集深色、浅色、跟随系统截图。
- 涉及 Tauri、窗口、通知、文件打开或 Agent terminal 时，运行 `npm run tauri:dev`，无法运行时记录原因和剩余风险。
- 右栏、新 portal、overlay 必须继承 `useDocumentTheme` 的全局主题上下文。
- 不使用宽泛 staging；只提交当前 TASK 实际改动文件。

## 风险

- 统一搜索容易变成性能热点：provider 必须 lazy、可取消、分层排序。
- artifact detector 容易污染终端渲染路径：只读 output history，不进入 xterm write 同步路径。
- Command Palette 容易绕过现有确认流程：危险动作只能跳转到现有确认 UI。
- Agent task badge/queue 涉及外部进程状态：必须以现有 agent session 文件化状态为事实源。
- Recipes 涉及命令执行安全：自动回放必须另开计划评审。

## Round Log

- 2026-06-25T10:40:34+08:00：完成 Otty 官网/文档产品页调研，采集 74 个页面截图/JSON；形成报告、计划和 HTML 原型。当前计划保留在 `next/`，等待用户确认是否进入正式实现。
