---
id: PLAN-20260625-105720-agent-permission-skip-launch
status: done
created_at: 2026-06-25T10:57:20+08:00
started_at: 2026-06-25T10:57:20+08:00
completed_at: 2026-06-25T11:42:32+08:00
updated_at: 2026-06-25T11:42:32+08:00
owner: ai
---

# Agent Launcher 权限跳过启动模式

## 目标

- 在右栏 Agent Launcher 中，用户右击 Codex 或 Claude 图标时可选择用跳过权限的危险模式启动。
- 默认左键启动保持现状，不自动启用危险模式。
- Codex 使用本机 CLI 支持的 `--dangerously-bypass-approvals-and-sandbox`。
- Claude 使用本机 CLI 支持的 `--dangerously-skip-permissions`。

## 非目标

- 不恢复旧内置 AI/provider/chat UI。
- 不改 Kerminal MCP Server 的 tools-only 边界、权限审批模型或配置 CRUD。
- 不让 custom agent 自动追加任何危险参数；自定义命令由用户显式输入。
- 不修改外部 agent workspace 生成模板，除非测试发现必须同步说明。

## 影响范围

- 前端 Agent Launcher 启动按钮、右键菜单和启动参数派生。
- Agent terminal 当前会话展示的命令标签。
- 相邻前端测试。
- 如确需后端持久化危险启动参数，再最小触碰 `external_agent_workspace`，并同步 active lane。

## 执行步骤

- [x] TASK-001：建立权限跳过启动模式模型。
  - 入口：Agent Launcher 前端模型或局部 helper。
  - 验收：Codex/Claude 能派生危险参数；默认模式无变化；custom 不支持该模式。
- [x] TASK-002：给 Codex/Claude 图标增加右键危险模式菜单。
  - 入口：`AgentLauncherToolContent.tsx`。
  - 验收：左键仍正常启动；右键展示主题可读的菜单；选择后启动带危险参数。
- [x] TASK-003：补相邻测试并验证启动。
  - 验证：相邻前端测试、`npm run typecheck`、`npm run build`、真实 dev server smoke；如涉及 Tauri/Rust 再补 `npm run tauri:dev` 或说明无法运行原因。

## 风险与回滚

- 风险：跳过权限会绕过 Codex/Claude host 侧确认和沙箱，可能执行破坏性操作。
- 控制：默认不启用，仅右键显式入口；文案使用危险/跳过权限语义；不写入全局配置。
- 回滚：移除前端菜单与参数追加 helper，默认启动路径不受影响。

## Round Log

- 2026-06-25T10:57:20+08:00：创建 active 计划。本轮已读取 AGENTS、README、Updeng 文档、当前 active cleanup 计划、coordination status/lanes/checkpoint 和 `git status --short`；CodeGraph 定位 Agent Launcher 启动链路。当前方案优先前端当次启动参数包装，避免触碰 active cleanup lane 正在共享的后端 workspace 文件。CLI 本机帮助确认 Codex 参数为 `--dangerously-bypass-approvals-and-sandbox`，Claude 参数为 `--dangerously-skip-permissions`。
- 2026-06-25T11:42:32+08:00：按用户反馈把右键入口收敛为一个小菜单，仅保留 `跳过权限打开`，移除旧方案中的正常打开项和额外危险说明 chip；左键默认启动保持不变。实现只触碰 Agent Launcher 前端模型、组件和相邻测试，未触碰后端 workspace、MCP tools-only 边界或 custom agent 自动参数。
- 验证通过：`npm run test:frontend -- src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx`（2 files / 25 tests）、`npm run typecheck`、`npm run build`、dev server HTTP smoke `http://127.0.0.1:5203/` 返回 `status=200 length=660`。运行态截图已覆盖深色、浅色、跟随系统：`.updeng/docs/verification/agent-permission-skip-menu-dark-20260625.png`、`.updeng/docs/verification/agent-permission-skip-menu-light-20260625.png`、`.updeng/docs/verification/agent-permission-skip-menu-system-20260625.png`；CDP 元数据确认菜单尺寸为 `160x46`，仅 1 个 `menuitem`，不含 `正常打开`。
