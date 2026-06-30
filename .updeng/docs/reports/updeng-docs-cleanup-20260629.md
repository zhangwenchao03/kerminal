# Updeng 文档清理报告 - 2026-06-29

## 范围

本轮只整理 `.updeng/docs` 下的流程文档、计划状态、索引、blocker、completed 能力和 coordination lane。未修改业务代码、运行配置、用户目录或历史验证资产。

## 已整理

- `plan/active/PLAN-20260626-233645-terminal-command-rail-tui-fix.md` 移到 `plan/done/`。代码事实已落盘，聚焦测试通过。
- `plan/active/PLAN-20260626-164938-ssh-credential-vault-auth-runtime.md` 移到 `plan/done/`。核心 encrypted vault 和统一 SSH auth runtime 已有验证证据；已有 1425 时 `npm run tauri:dev` wrapper 平滑复用 dev server 作为后续候选，不再阻塞本计划。
- `plan/active/PLAN-20260626-155809-agent-terminal-production-compat.md` 移到 `plan/blocked/`。剩余 TASK-006 需要真实 Codex/Claude CLI prompt、账号/网络或人工交互环境，已登记 `BLK-20260629-001`。
- `plan/INDEX.md`、`in-progress.md`、`BLOCKERS.md` 和 `coordination/lanes.json` 已同步到当前状态。
- `completed.md` 删除过期的“SSH 凭据明文保存与展示”能力，改为记录当前有效的 encrypted vault 能力。
- 删除空的顶层 `specs/.gitkeep`。正式规格应归属到 `changes/<change-id>/specs/`，顶层空目录不再作为文档入口。
- 清理无效 auto claim：`auto-session-137397a4038f` lastSeenAt 过旧，且 claimed path 为字面量 `$path`，未对应当前有效变更。

## 明确保留

- `plan/done/` 历史计划保留，不批量删除。完成历史是变更证据；近期摘要只在 `plan/INDEX.md` 保留最近条目。
- `verification/` 下截图和 JSON 保留。本轮未做引用追踪后的大规模删除，避免误删 UI、Tauri、release 和 smoke 证据。
- `archive/legacy-data-*` 保留为旧 `.updeng/data` 迁移归档，不重新激活为工作台目录。
- `metrics/`、`audit/`、`context/` 和 `coordination/checkpoints/` 保留为机器状态、审计和并行协作证据。

## 当前有效待办

- `plan/active/`：仅剩本轮文档清理计划，收口后应移动到 `done/`。
- `plan/next/`：`Otty-inspired Kerminal Context Workspace`，等待用户确认是否进入正式实现。
- `plan/blocked/`：
  - Agent 终端真实 Codex/Claude CLI HITL。
  - SSH 远程命令灰色提示外部主机/生产策略验收。
  - `kerminal.db` 用户目录旧文件手动删除。

## 验证记录

- `npm run test -- --run src/features/terminal/terminalCommandBlocks.test.ts`：通过，1 file / 28 tests。
- 后续收口统一运行 `node .codex/hooks/lane-coordination.cjs refresh C:\dev\rust\kerminal`、`npm run build` 和 `.updeng/docs` 状态检查。
