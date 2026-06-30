# 计划索引

本文件只做人工计划总览入口。执行细节写入对应计划的 Round Log；完成、阻塞或删除时同步状态目录和下表，避免在索引里堆流水账。

整理时间：2026-06-30T19:04:03+08:00。

## Active

| 创建时间 | 计划 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 2026-06-30T19:04:03+08:00 | [发布 0.2.3 版本](active/PLAN-20260630-190403-release-0-2-3.md) | active | 同步版本到 `0.2.3`，提交 release commit，推送 tag 并核对 GitHub Release。 |

## Next

| 创建时间 | 计划 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| 2026-06-25T10:40:34+08:00 | [Otty-inspired Kerminal Context Workspace](next/PLAN-20260625-104034-otty-inspired-kerminal-context-workspace.md) | next | 等待确认是否进入正式实现；推荐从 TASK-001 Context Model 开始。 |

## Blocked

| 创建时间 | 计划 | 阻塞点 | 负责人 | 关闭条件 |
| --- | --- | --- | --- | --- |
| 2026-06-26T15:58:09+08:00 | [右栏 Agent 终端生产级兼容计划](blocked/PLAN-20260626-155809-agent-terminal-production-compat.md) | 默认 Agent terminal 主界面已收口为真实 xterm/PTY；剩余 TASK-006 需要真实 Codex/Claude CLI prompt、账号/网络或人工交互环境验证。 | user | 提供或确认真实 Codex/Claude CLI smoke 环境；通过后移到 `done/`。 |
| 2026-06-19T00:00:04+08:00 | [SSH 远程命令灰色提示生产级实现](blocked/2026-06-19-ssh-command-ghost-suggestions.md) | 本地生产门禁、loopback/WSL smoke、真实 app ghost smoke 和 `npm run tauri:dev` 冒烟已记录通过；剩余独立外部主机、慢网络、大目录、全屏程序和生产主机 restricted 策略验收。 | user | 提供或确认外部主机验收环境后复查；通过后移到 `done/`。 |
| 2026-06-25T09:23:13+08:00 | [kerminal.db 清理](blocked/PLAN-20260625-092313-kerminal-db-cleanup.md) | 代码侧已确认并清理旧一体化 SQLite 入口；物理删除 `C:\Users\24052\.kerminal\kerminal.db` 被 PreToolUse 门禁阻止。 | user | 手动删除该单个旧文件；保留 `C:\Users\24052\.kerminal\data\command.sqlite`。 |

## Recently Done

仅保留最近 10 条完成摘要；完整历史查 `plan/done/`。

| 完成时间 | 创建时间 | 计划 | 结果 |
| --- | --- | --- | --- |
| 2026-06-30T18:13:19+08:00 | 2026-06-30T10:32:12+08:00 | [PTY 稳定性与健壮性生产级加固方案](done/PLAN-20260630-103212-pty-stability-hardening.md) | 完成 Terax-inspired PTY 稳定性加固：输出 coalescing/backpressure/final tail、Windows process guard、orphan reaper、shell integration、OSC trust、Agent signal、DA/DSR responder、输入性能基线、本地 shell/TUI 自动化矩阵和 Agent CLI HITL harness；用户 UI 复验确认 Codex `Alt+Enter` 换行/图片粘贴正常，Claude `Ctrl+J` 换行/`Alt+V` 图片粘贴正常，CLI 快捷键差异不作为 Kerminal PTY blocker。 |
| 2026-06-30T09:57:25+08:00 | 2026-06-30T09:31:04+08:00 | [发布 0.2.2 版本](done/PLAN-20260630-093104-release-0-2-2.md) | 完成 Windows RDP 密码加密修复提交、`release: v0.2.2` commit、`v0.2.2` tag、`origin/main`/tag push、GitHub Actions release 矩阵和公开 Release；13 个 assets 完整，`latest.json` 为 `0.2.2` 且 5 个唯一 updater URL HEAD 均为 200。 |
| 2026-06-30T00:38:56+08:00 | 2026-06-30T00:12:06+08:00 | [发布 0.2.1 版本](done/PLAN-20260630-001206-release-0-2-1.md) | 完成 `release: v0.2.1` commit、`v0.2.1` tag、`origin/main`/tag push、GitHub Actions release 矩阵和公开 Release；13 个 assets 完整，`latest.json` 为 `0.2.1` 且 5 个唯一 updater URL HEAD 均为 200。 |
| 2026-06-29T23:46:06+08:00 | 2026-06-29T23:00:32+08:00 | [右栏 AI 助手按 Tab 绑定方案](done/PLAN-20260629-230032-tab-scoped-agent-sidebar.md) | 右栏 Agent Launcher 按 workspace terminal tab 隔离：同 provider 跨 tab 创建不同 session，切 tab 只显示本 tab 助手或 launcher，关 tab 归档对应 Agent session；移除顶部目标绑定 chip/rebind UI，context prompt 加 tab 边界。聚焦测试、build、dev server 三主题截图、浏览器 smoke 和隔离 target `tauri dev` smoke 通过。 |
| 2026-06-29T19:06:00+08:00 | 2026-06-29T18:55:46+08:00 | [Updeng 文档清理整理](done/PLAN-20260629-185546-updeng-docs-cleanup.md) | 完成 Updeng 文档状态清理：active 清空，TUI rail 与 SSH vault 计划收口到 done，Agent terminal HITL 转 blocked，清理无效 auto claim 和空顶层 `specs/.gitkeep`，同步 `INDEX`、`in-progress`、`BLOCKERS`、`completed`、`lanes` 和清理报告。 |
| 2026-06-29T19:00:00+08:00 | 2026-06-26T16:49:38+08:00 | [SSH 凭据保险箱与统一认证运行时生产级方案](done/PLAN-20260626-164938-ssh-credential-vault-auth-runtime.md) | encrypted file vault、workspace vault key、host 保存链路、legacy plaintext migration、统一 SSH credential resolver、terminal/SFTP/SSH command/port forwarding 接入、Settings 同步页和配置手册口径已收口；password prompt 和同 host 二次连接问题已有 SSH 终端聚焦测试、password smoke、前端 build、dev server smoke 和独立 Tauri 壳启动证据。 |
| 2026-06-29T19:00:00+08:00 | 2026-06-26T23:36:45+08:00 | [进入 TUI 时命令块色条回归修复](done/PLAN-20260626-233645-terminal-command-rail-tui-fix.md) | `buildTerminalCommandBlockViews(...)` 在 alternate buffer 下返回空视图，只隐藏 rail 不清空命令块数据；`npm run test -- --run src/features/terminal/terminalCommandBlocks.test.ts` 通过，最终 build 随文档清理收口执行。 |
| 2026-06-29T15:22:47+08:00 | 2026-06-29T12:42:29+08:00 | [兼容性代码清理](done/PLAN-20260629-124229-compat-cleanup.md) | 清理 SSH 凭据 legacy plaintext secrets、迁移工具、旧字段 fallback、SFTP/port-forward/settings/workspace/Compose/Docker/dialog/drag 等旧契约兼容路径；剩余 compat 命中仅为当前协议/平台能力或“不迁移旧 SQLite”说明。Rust/前端聚焦测试、rustfmt、build、dev server 和 `tauri:dev` 启动通过。 |
| 2026-06-29T10:48:45+08:00 | 2026-06-29T10:14:37+08:00 | [设置同步页 Git 与密钥极简改造](done/PLAN-20260629-101437-settings-sync-git-key-simplification.md) | 设置同步页收敛为 Git 初始化状态、初始化后“同步”按钮、密钥路径、密钥内容编辑和“保存”按钮；后端新增受控 pull/rebase + 本地 commit 同步命令、密钥读取/保存校验，并显式排除本地专用密钥路径进入提交。前端/Rust 聚焦测试、build、dev server 三主题和窄视口截图通过；最终加固后 `tauri:dev` 隔离 target 增量启动通过，宽过滤复跑受 Windows 页面文件不足/链接卡住影响未完成。 |
| 2026-06-29T10:32:59+08:00 | 2026-06-29T10:04:10+08:00 | [设置通知入口点击修复](done/PLAN-20260629-100410-settings-notification-nav-fix.md) | 修复桌面通知设置行左侧文案区域不可点击，并补齐 Rust `AppSettings.desktopNotifications` 持久化模型，避免 `settings_update` 返回值把开关冲回默认值；前端控件测试、Rust settings service、build、dev server 冒烟和 `tauri:dev` 启动通过。 |

## Removed

| 时间 | 原路径 | 处理原因 |
| --- | --- | --- |
| 2026-06-24T11:35:10+08:00 | `active/2026-06-21-ai-assistant-terminal-context.md` | 已被 ADR-0017 和 Agent Launcher lane 覆盖；旧内置 AI provider/live smoke 不再作为 active 工作或 blocker 保留。 |
| 2026-06-24T11:35:10+08:00 | `next/terminal-product-plan.md` | 早期大一统产品计划已过时；当前事实以 README、ADR 和新的 active 计划为准。 |
| 2026-06-24T11:35:10+08:00 | `next/2026-06-18-remote-container-workspace.md` | 长期候选计划未进入实施且已过期；容器方向保留 ADR/发现记录，后续另开切片。 |
| 2026-06-24T11:35:10+08:00 | `blocked/2026-06-17-settings-theme-appearance.md` | 早期设置/主题 HITL 已被后续 Apple-inspired UI 和 settings 计划覆盖。 |
| 2026-06-24T11:35:10+08:00 | `blocked/2026-06-19-fix-tauri-startup-freeze-prototype.md` | 启动兼容结论已沉淀到 `AGENTS.md` 的 freezePrototype 规则，不再保留为 blocker。 |
| 2026-06-24T11:35:10+08:00 | `blocked/2026-06-20-github-release-updater.md` | 后续 `0.1.9` 发布计划已完成 GitHub Actions、Release 和 `latest.json` 核验。 |
| 2026-06-29T19:00:00+08:00 | `specs/.gitkeep` | 顶层 `specs/` 已无正式 artifact；当前规格应随正式 change 放在 `changes/<change-id>/specs/`，空占位不再保留。 |

## Rules

- `created_at` 表示生成顺序，`started_at` 表示执行顺序，`completed_at` 表示收口时间。
- `active/` 只放当前正在实施的人工计划；完成后移到 `done/`，阻塞且仍有效才放 `blocked/`。
- `next/` 不保存大而全的长期愿望；需要执行时另开新的小切片计划。
- 过期计划删除时必须在本文件 `Removed` 表说明原因，并同步 `in-progress.md`、`BLOCKERS.md` 和 `coordination/lanes.json`。
