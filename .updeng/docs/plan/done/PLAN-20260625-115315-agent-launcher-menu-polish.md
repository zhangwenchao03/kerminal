---
id: PLAN-20260625-115315-agent-launcher-menu-polish
status: done
created_at: 2026-06-25T11:53:15+08:00
started_at: 2026-06-25T11:53:15+08:00
completed_at: 2026-06-25T12:01:40+08:00
updated_at: 2026-06-25T12:01:40+08:00
owner: codex
---

# Agent Launcher 右键菜单美化

## 目标
- 只美化 Codex/Claude 图标右键弹出的 `跳过权限打开` 菜单。
- 菜单更窄、更紧凑，视觉上接近原生小浮层。

## 非目标
- 不修改 Windows 启动 shell。
- 不修改外部 Agent 启动参数、权限跳过业务逻辑或后端。
- 不改其它全局右键菜单行为。

## 影响范围
- `src/features/tool-panel/AgentLauncherToolContent.tsx`
- `src/features/tool-panel/AgentLauncherToolContent.test.tsx`
- `src/App.css`

## 执行步骤
- [x] 收窄 Agent Launcher 专用菜单尺寸与贴边常量。
- [x] 为该菜单补局部精致样式，不影响其它 `kerminal-context-menu`。
- [x] 运行相邻测试、构建和真实界面截图验证。

## 验证
- `npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx`
- `npm run build`
- 真实 dev server 打开 Agent Launcher，截图检查深色、浅色、跟随系统主题下弹出菜单。

## 风险
- 该弹层使用绝对定位和固定尺寸贴边，尺寸变化需同步 clamp 常量。

## Round Log

### 2026-06-25T12:01:40+08:00
- 修改 `AgentLauncherToolContent.tsx`：Agent Launcher 右键菜单从 `w-40` / 160px 收窄到 `w-[136px]`，贴边高度预估同步为 38px；菜单项改用更轻的 `ShieldOff` 图标和专用 item class。
- 修改 `src/App.css`：新增 `kerminal-agent-launch-menu*` 专用样式，菜单 padding 4px、圆角 14px、单项高度 30px，hover 使用低透明 danger 背景；不改变其它全局 `kerminal-context-menu`。
- 修改 `AgentLauncherToolContent.test.tsx`：断言菜单仍是单项，并带有专用窄菜单 class。
- 验证通过：`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx`，16 passed。
- 验证通过：`npm run build`，Vite 构建成功，仅保留既有 chunk size 警告。
- 真实 dev server：`http://127.0.0.1:5217/` 可访问。
- 截图证据：
  - `.updeng/docs/verification/agent-menu-polish-dark-20260625.png`
  - `.updeng/docs/verification/agent-menu-polish-light-20260625.png`
  - `.updeng/docs/verification/agent-menu-polish-system-20260625.png`
- 浏览器实测菜单 metrics：宽 136px，高 40px，圆角 14px；深色背景 `rgba(28, 28, 30, 0.86)`，浅色背景 `rgba(255, 255, 255, 0.86)`。
