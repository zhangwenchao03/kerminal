# 阻塞事项

只记录当前仍有效、需要用户或外部环境推进的阻塞点。过期计划、已被新方向覆盖的 blocker 不继续保留。

| ID | 关联计划 | 阻塞点 | 负责人 | 下一步 | 状态 |
| --- | --- | --- | --- | --- | --- |
| BLK-20260629-001 | [右栏 Agent 终端生产级兼容计划](plan/blocked/PLAN-20260626-155809-agent-terminal-production-compat.md) | 自动化和 UI 默认形态已收口；剩余 TASK-006 需要真实 Codex/Claude CLI prompt、账号/网络或人工交互环境，验证 Shift+Enter/Ctrl+J 多行、Ctrl+C、Esc、Tab/Shift+Tab、paste 和 resize。 | user | 提供可交互 Codex/Claude CLI 环境，或确认用本机账号/网络执行真实 smoke；通过后移动到 `plan/done/`。 | open |
| BLK-20260621-002 | [SSH 远程命令灰色提示生产级实现](plan/blocked/2026-06-19-ssh-command-ghost-suggestions.md) | 本地生产门禁、loopback/WSL smoke、真实 app ghost smoke 和 `npm run tauri:dev` 冒烟已记录通过；剩余独立外部无互联网 Linux、外部仅 `/bin/sh` 主机、慢网络、大目录、断线重连、真实 `vim/less/top/tmux`、独立外部主机中文输入和真实生产主机 restricted 策略验收。 | user | 提供或确认外部主机验收环境后执行 `npm run smoke:ssh-suggestions`、`npm run smoke:ssh-terminal:password` 和人工终端交互验收；通过后移到 `plan/done/`。 | open |
| BLK-20260625-001 | [kerminal.db 清理](plan/blocked/PLAN-20260625-092313-kerminal-db-cleanup.md) | 旧 `~/.kerminal/kerminal.db` 已确认不再被当前代码使用，但 AI 执行 Windows 绝对路径 `Remove-Item` 被 PreToolUse 阻止。 | user | 手动删除 `C:\Users\24052\.kerminal\kerminal.db`；不要删除 `C:\Users\24052\.kerminal\data\command.sqlite`。 | open |

整理时间：2026-06-30T18:13:19+08:00。
