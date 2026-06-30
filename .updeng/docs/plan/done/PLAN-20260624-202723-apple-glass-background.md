---
id: PLAN-20260624-202723-apple-glass-background
status: done
created_at: 2026-06-24T20:27:23+08:00
started_at: 2026-06-24T20:27:23+08:00
completed_at: 2026-06-24T21:04:50+08:00
updated_at: 2026-06-24T21:04:50+08:00
owner: ai
lane: lane-apple-glass-background
---

# Apple-inspired 透明与背景图材质升级

## 目标

- 让 Kerminal 的窗口透明、背景图片和 shell chrome 材质更接近高质量 Apple-style workbench：清晰、克制、分层、可读。
- 背景图不再只是直接铺在底层加一层线性纯色遮罩，而是用 tone map、vignette、阅读遮罩和语义材质 token 形成稳定层级。
- 左侧栏、顶部导航、浮层、resize seam 和终端卡片在 light、dark、system 主题下保持一致的透明逻辑；终端正文保持可读的 solid terminal surface。
- 按用户给的参考图对照：允许背景图有存在感，但不能压过命令输出、pane 标题和主机导航。

## 非目标

- 不引入 OS 级 Mica/Acrylic/window-vibrancy 依赖；本轮只做应用内 CSS/WebView 材质升级。
- 不新增背景图片管理或上传能力，不改变已有背景路径、铺放、透明度设置的数据模型。
- 不重写设置页、终端工作区、主机树或右键菜单业务逻辑。
- 不把终端正文、日志、文件列表做成全透明玻璃层。

## 调研结论

- Apple HIG 的材料原则是用 material/vibrancy 表达层级和上下文，不是对所有内容套透明；内容密集区域需要保留可读实体面。
- Apple 近年的 Liquid Glass 方向强调材质会随浅色/深色、内容背景和交互状态适配；Kerminal 对应到 CSS 应该是语义 token + per-theme opacity/blur，而不是组件内硬编码 rgba。
- 参考图的质感来自三件事：背景被整体压暗并降对比、终端和导航有不同强度的半透明材料、pane 边框/选中态足够轻但明确。
- Kerminal 现有 `.updeng/docs/plan/done/PLAN-20260622-202049-transparent-window-material.md` 已确认 P0 不上原生 vibrancy，当前问题仍属于应用内材质统一和背景图处理。

## 当前基线

- `src/app/KerminalShell.helpers.tsx` 的 `workspaceBackgroundImage` 只生成 `linear-gradient(...) + url(...)`，遮罩强度等于 `1 - backgroundOpacity`，缺少暗角、饱和度/对比控制和阅读区保护。
- `src/app/KerminalShell.tsx` 只写入 `--app-window-opacity`、`--app-nav-surface-opacity` 和 `--app-terminal-surface-opacity`，且 nav/terminal 透明度随窗口透明度线性变化。
- `src/App.css` 已有 `--surface-*`、`kerminal-material-nav`、`kerminal-terminal-surface`、`kerminal-floating-surface` 和 context menu 材质，是本轮最小增量的正确落点。
- `src/features/settings/**` 当前属于 `lane-mcp-tools-only-server-refactor` shared paths；本轮不写设置页，避免和 active MCP lane 冲突。

## 实施方案

### 1. 背景图 tone-map helper

文件：

- `src/app/KerminalShell.helpers.tsx`
- `src/app/KerminalShell.test.tsx`

做法：

- 将 `workspaceBackgroundImage` 改为多层背景：
  - theme-aware app tint overlay，控制全局亮暗。
  - subtle radial vignette，压住四角和边缘，避免背景抢 chrome。
  - content reading veil，给终端工作区中心保留阅读对比。
  - source image URL 保持最后一层，继续支持 Tauri `convertFileSrc` 和浏览器预览路径。
- 新增小型纯函数或常量，集中计算 alpha，测试覆盖 dark/light 与 opacity 边界。
- `backgroundOpacity` 仍表示“图片可见强度”，但实际输出会保留最小阅读遮罩，避免 100% 背景图让终端不可读。

验收：

- dark/light 下 `backgroundImage` 包含多层 gradient 和 url。
- path escaping、tile/cover/contain 现有行为不变。
- `backgroundOpacity=100` 仍有可读遮罩；`0` 时背景几乎不可见。

### 2. 语义材质 token 与 glass budget

文件：

- `src/App.css`
- `src/app/KerminalShell.tsx`

做法：

- 新增或调整语义 token：
  - `--app-background-veil-opacity`
  - `--app-nav-surface-opacity`
  - `--app-terminal-surface-opacity`
  - `--app-terminal-header-opacity`
  - `--surface-terminal-rgb`
  - `--surface-terminal-header`
  - `--shadow-terminal`
- nav chrome 使用较高 blur/saturate 和低噪声边框，保持参考图那种顶部/侧栏轻玻璃感。
- terminal pane 外壳使用 slightly translucent solid material，正文区域不要继续透明到底。
- focused pane 用 restrained accent ring，不加亮色厚边框。

验收：

- CSS 变量均有 light/dark 映射。
- `kerminal-material-nav`、`kerminal-terminal-surface`、`kerminal-floating-surface` 视觉层级明确。
- 不新增大面积渐变、霓虹、强 glow 或 card nesting。

### 3. 终端 pane 阅读性修正

文件：

- `src/features/terminal/TerminalPaneCard.tsx`
- `src/features/terminal/TerminalPaneCard.test.tsx`

做法：

- pane card 保持 `kerminal-terminal-surface`，但标题栏使用 `--surface-terminal-header`，减少背景图直接穿透标题信息。
- preview pane 的 fallback 背景改用 terminal semantic surface，避免 hard-coded `#f7f7fa/#1f1f21` 和整体材质脱节。
- focused 边框从单一 sky border 调整为轻边框 + focus ring shadow，避免参考图里那种金色/亮色边框过重。

验收：

- runtime pane、preview pane、focused pane 均在 dark/light 下可读。
- 现有 pane 行为测试不变，新增样式语义断言即可。

### 4. 并行执行方式

- 主线程：登记计划/lane，集成最终 patch，运行全量验证和视觉截图。
- Worker A（CSS/material）：负责 App.css 材质 token 和 pane surface 改动，写入 disjoint CSS/TerminalPaneCard 范围。
- Worker B（helper/test/QA）：负责背景 helper 测试候选、视觉 QA 脚本思路和截图检查清单；不写 active lane 的 shared settings 文件。
- 集成规则：worker 不回滚既有脏工作区，不宽泛格式化；主线程复核 diff 后只保留本计划相关变更。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 前端 shell 背景 | 是 | `src/app/KerminalShell.tsx`, `src/app/KerminalShell.helpers.tsx` | focused tests, build, visual smoke |
| 全局主题 CSS | 是 | `src/App.css` | dark/light/system screenshots |
| 终端 pane 材质 | 是 | `src/features/terminal/TerminalPaneCard.tsx` | TerminalPaneCard tests, visual smoke |
| 设置页 | 否 | 不改 `src/features/settings/**` | 避免 active MCP lane shared path |
| Rust/Tauri 配置 | 否 | 不改 `src-tauri/**` | 如 `tauri:dev` 因端口阻断则记录 |

## 验证

- `npm run test:frontend -- src/app/KerminalShell.test.tsx src/features/terminal/TerminalPaneCard.test.tsx`
- `npm run build`
- 真实 dev server 或 preview 启动：
  - desktop dark：背景图开启、双 pane、左侧栏展开。
  - desktop light：同一路径。
  - system：用系统偏好模拟或应用设置 system 模式，确认 document theme 继承。
  - narrow：确认侧栏/toolbar 不重叠、背景不会影响可读性。
- 截图证据写入 `.updeng/docs/verification/` 或记录到 Round Log；无法跑 dev server 时说明具体命令和剩余风险。

## 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
| --- | --- | --- | --- |
| 背景图过亮导致终端不可读 | 命令输出阅读受损 | helper 保留最小 veil，terminal surface 更 solid | 回滚 helper 多层背景和 terminal opacity token |
| 透明层太多导致视觉噪声 | 工作台显得廉价 | glass budget 只给 chrome/浮层，pane 正文 solid | 降低 blur/opacity，保留原 token |
| 当前脏工作区共享文件冲突 | 覆盖其它 lane | 只写 owned paths，改前看 diff，Round Log 记录 | 使用 apply_patch 最小反向 patch |
| dev server transform 卡住 | 无法完成真实 UI 验证 | 尝试 `dev:force`、production preview、Playwright/Browser 截图 | 记录失败命令和残余风险，不宣称 UI 全通过 |

## 设计评分卡

- 第一眼：背景有氛围但不是主角，4/5 以上。
- 层级：nav、pane、floating、terminal body 区分明确，4/5 以上。
- 可读性：终端正文和标题在复杂背景上可读，5/5。
- 主题：light/dark/system 都自然，不是简单反相，4/5 以上。
- 克制：没有过度 blur、glow、彩色渐变和强边框，4/5 以上。

## Round Log

- 2026-06-24T20:27:23+08:00：用户要求调研并按 Apple 设计理念升级当前透明和背景图效果；已加载 Updeng、前端、Apple-inspired、视觉测试技能，读取参考图、真相源、active lane、既有透明材质计划和当前代码基线。当前工作区已有大量未归因改动，本计划只写透明/背景 owned paths，不改 settings shared path。
- 2026-06-24T21:04:50+08:00：完成本计划实现和验证。`workspaceBackgroundImage` 改为 background image + theme veil + vignette + side/horizon reading masks 的多层 tone-map，`KerminalShell` 改为按主题、窗口透明度和背景图可见度派生 nav / terminal / header / veil 材质透明度，`App.css` 增加 terminal/header/shadow 语义 token 并收紧 nav/terminal material，`TerminalPaneCard` 增加 focused data state、semantic header 和 preview surface。并行复核发现旧 `--app-background-image-opacity` 未参与真实渲染，已删除该假信号并让 `--app-background-veil-opacity` 进入实际 `background-image` layer。验证：`npm run test:frontend -- src/app/KerminalShell.test.tsx src/features/terminal/TerminalPaneCard.test.tsx` 通过 2 files / 32 tests；`git diff --check -- <本 lane 文件>` 通过，仅有现有 LF/CRLF 提示；`npm run build` 通过，耗时 3m11s，仅保留既有 Vite large chunk warning。运行态：`npm run dev -- --host 127.0.0.1 --port 5191` 已启动且 HTTP 200 / title `Kerminal`，但 in-app Browser dev tab DOM snapshot 仍为空且无 console warn/error，记录为当前 dev-server smoke 限制；`npm run preview -- --host 127.0.0.1 --port 5192` 完成真实渲染 QA，dark/light/system/narrow 均 zero console warn/error，背景图 layer active（`hasRadial=true`, `hasDataImage=true`）。截图与 computed CSS 证据：`.updeng/docs/verification/apple-glass-background-dark.png|json`、`apple-glass-background-light.png|json`、`apple-glass-background-system.png|json`、`apple-glass-background-narrow.png|json`。本轮未运行 `npm run tauri:dev`：本 lane 不改 `src-tauri/**`、Tauri 配置或窗口权限，且当前工作区另有 active Rust/MCP lane 大量未归因变更；桌面外壳风险留给对应 lane。
