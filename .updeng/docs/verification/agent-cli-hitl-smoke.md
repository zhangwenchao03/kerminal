# Codex / Claude Agent CLI HITL Smoke

更新时间：2026-06-30T18:13:19+08:00。

本文件记录 PTY 稳定性加固计划剩余的真实 Agent prompt 验收入口。默认自动化不会启动真实 Codex/Claude TUI，也不会向外部模型提交 prompt；需要用户明确授权并设置环境变量后才执行。

## 当前本机 CLI

- `codex`: `C:\dev\js\nodejs\codex.ps1`，版本 `codex-cli 0.142.2`
- `claude`: `C:\dev\js\nodejs\claude.ps1`，版本 `2.1.195 (Claude Code)`

## 默认安全检查

只编译 harness，不启动真实 CLI：

```powershell
cd C:\dev\rust\kerminal\src-tauri
cargo test --test terminal_agent_cli_hitl_matrix -- --nocapture
```

预期输出：`codex`、`claude` 均显示 `status=skipped reason=set KERMINAL_AGENT_CLI_HITL=1...`。

## 真实 CLI 预检

会启动真实 Codex/Claude TUI，发送多行输入、Tab、Shift+Tab、Esc、bracketed paste、Ctrl+C，但不发送最终 Enter，不应主动提交模型请求。CLI 启动本身仍可能读取账号状态或做网络检查，因此只在用户确认当前账号/网络可用于验收时执行。

```powershell
cd C:\dev\rust\kerminal\src-tauri
$env:KERMINAL_AGENT_CLI_HITL = "1"
cargo test --test terminal_agent_cli_hitl_matrix -- --nocapture
Remove-Item Env:\KERMINAL_AGENT_CLI_HITL
```

## 真实提交验收

会向 Codex 和 Claude 各提交一个最小 prompt，要求回复 `KERMINAL_SMOKE_OK`。这一步会使用当前账号、网络和模型服务；执行前需要用户明确授权。

```powershell
cd C:\dev\rust\kerminal\src-tauri
$env:KERMINAL_AGENT_CLI_HITL = "1"
$env:KERMINAL_AGENT_CLI_HITL_ALLOW_SUBMIT = "1"
$env:KERMINAL_AGENT_CLI_HITL_EXPECT = "KERMINAL_SMOKE_OK"
cargo test --test terminal_agent_cli_hitl_matrix -- --nocapture
Remove-Item Env:\KERMINAL_AGENT_CLI_HITL
Remove-Item Env:\KERMINAL_AGENT_CLI_HITL_ALLOW_SUBMIT
Remove-Item Env:\KERMINAL_AGENT_CLI_HITL_EXPECT
```

## 手工 UI 复验

在 Kerminal 右栏 Agent Launcher 中分别启动 Codex 和 Claude：

- 输入 `line1`，按 Shift+Enter，输入 `line2`，按 Ctrl+J，输入 `line3`，确认 prompt 中保持三行，Enter 才发送。
- 验证 Ctrl+C interrupt、Esc cancel/back、Tab / Shift+Tab 导航、多行 paste、窗口 resize 后 TUI 不白屏、不丢输入、不退出。
- 记录 CLI 版本、Kerminal 版本、shell、TERM/COLORTERM、是否 tmux、是否登录账号、是否执行了真实提交验收。

通过上述真实提交或手工 UI 复验后，才能关闭 `BLK-20260630-001` 并把 PTY 稳定性计划移到 `plan/done/`。

## 本次复验结论

2026-06-30 用户确认可关闭 PTY 稳定性目标：

- Codex：`Alt+Enter` 可换行；图片粘贴正常。
- Claude：`Ctrl+J` 可换行；图片粘贴使用 `Alt+V`，验证可用。
- 结论：Codex/Claude 的换行和图片粘贴快捷键不同，属于各 Agent CLI 与终端宿主的交互差异；不作为 Kerminal PTY 稳定性 blocker。
