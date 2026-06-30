---
id: PLAN-20260630-103212-pty-stability-hardening
status: done
created_at: 2026-06-30T10:32:12+08:00
started_at: 2026-06-30T10:32:12+08:00
completed_at: 2026-06-30T18:13:19+08:00
updated_at: 2026-06-30T18:13:19+08:00
owner: ai
lane: lane-pty-stability-hardening-20260630
---

# PTY 稳定性与健壮性生产级加固方案

## 目标

- 借鉴 `crynta/terax-ai` 的 PTY 运行时设计，提升 Kerminal 本地 PTY 在高频输出、进程退出、Windows ConPTY、shell 状态识别、Agent CLI 状态感知和异常输入输出下的稳定性。
- 保持 ADR-0001 的技术路线：React `@xterm/xterm` + Rust `portable-pty`，不替换终端渲染器，不重写远程 SSH/Telnet/Serial/容器终端主链路。
- 把稳定性能力沉到有测试缝隙的深模块中，避免继续扩大 `terminal_manager.rs` 和 `XtermPane.runtime.ts` 的编排复杂度。
- 为后续实现提供可执行任务、验收标准、回滚口径和真实 smoke 矩阵，达到生产级实施准备状态。

## 非目标

- 初始调研轮只产出改造方案；后续实现按本计划逐个最小切片推进，每个切片必须先补行为测试再接生产路径。
- 不直接复制 Terax 源码或保留 Terax 命名、文案和协议标识；所有实现必须按 Kerminal 领域、AGPL 授权边界和现有模块契约重写。
- 不把 shell integration 强行套到 SSH、Telnet、Serial 和容器输出流。远程输出默认不可信，必须通过 capability 和信任窗口逐步接入。
- 不恢复右栏 Agent 的外部 composer、prompt queue 或旧内置 AI runtime。Agent CLI 仍运行在真实 xterm/PTY 中。
- 不改 `src-tauri/tauri.conf.json` 的 `app.security.freezePrototype` 策略。

## 调研快照

- Terax 本地源码快照：`C:\Users\24052\AppData\Local\Temp\terax-ai-review-20260630094052`，commit `3f4d6803e90ca4a98bfb1fd8508e76d64963c57b`。
- Kerminal 当前版本：`0.2.2`，工作区在调研开始时 `git status --short` 为空。
- Kerminal 相关决策：
  - `.updeng/docs/decisions/ADR-0001-terminal-technology-stack.md`：当前采用 xterm + portable-pty；性能问题先优化输出缓冲和 React 隔离。
  - `.updeng/docs/decisions/ADR-0017-external-agent-launcher-and-mcp-only.md`：Kerminal 只保留外部 Agent Launcher 和 MCP tools-only server。
  - `.updeng/docs/decisions/ADR-0018-agent-session-workspace-and-terminal-restore.md`：Agent session、terminal session 和 target binding 边界必须清晰。
  - `.updeng/docs/plan/blocked/PLAN-20260626-155809-agent-terminal-production-compat.md`：右栏 Agent terminal 必须保持真实 xterm/PTY，剩余真实 Codex/Claude prompt smoke 为 HITL。

## 当前 Kerminal 实现事实

- `src-tauri/src/services/terminal_manager.rs`
  - 使用 `portable_pty::{native_pty_system, CommandBuilder, MasterPty}` 创建本地 PTY。
  - `spawn_reader_thread(...)` 当前按 `READ_BUFFER_SIZE = 8192` 读取，`String::from_utf8_lossy` 解码后立即写入 `TerminalOutputBuffer`、日志和 `TerminalOutputEvent::data`。
  - 后端没有独立 flusher、coalescing、pending byte cap 或 backpressure overflow 策略；输出事件数量取决于 OS read chunk。
  - `TerminalOutputBuffer` 只保留 64 KiB recent tail，用于 snapshot，不保护 Tauri event 队列。
  - 关闭时从 `sessions` 移除后 `child.kill()`，再清理临时路径；未看到 Windows Job Object、ConPTY lifecycle lock、detached drop 或 process tree kill。
  - 现有优势：`TerminalSecretInputResponder` 已支持 prompt 自动响应、输出脱敏和日志脱敏，后续 output pump 必须保留这个顺序。
- `src/features/terminal/terminalOutputWriter.ts`
  - 前端已有帧级 output writer，默认每帧最多 64 KiB，支持队列压缩、flush/writeNow 和 surrogate pair safe split。
  - 这层只能保护 xterm 写入，不保护 Rust 到 WebView 的事件风暴。
- `src/features/terminal/XtermPane.runtime.ts`
  - 终端输入经 xterm `onData` 原样 `writeTerminal(sessionId, data)`；右栏 Agent 使用 `agentTui` input compatibility。
  - 对远程/容器输出调用 `collectCurrentDirOscSequences(...)` 采集 cwd，并同步 terminal session registry。
  - 命令块主要由前端输入模型、xterm marker、prompt line heuristic 和 alternate screen 事件推断。
  - session close 通过 output event 和 2 秒 polling 双保险处理。
- `src/features/terminal/XtermPane.helpers.ts`
  - 当前只识别 iTerm 风格 `OSC 1337;CurrentDir=` 和 prompt 正则，不是通用 `OSC 7 file://`。
  - cwd 采集从原始输出流解析，缺少 Terax 那种 “命令运行中拒绝 cwd OSC” 的信任门。
- `src/features/tool-panel/agent-launcher/agentTerminalContextModel.ts`
  - Agent prompt 上下文依赖 terminal output tail、selection、latest command block 和 tab/pane target 边界。后续 Agent 状态信号只能增量接入，不能破坏这些入口。

## Terax 值得吸收的稳定性能力

| 能力 | Terax 位置 | 价值 | Kerminal 当前差距 | 直接照搬风险 |
| --- | --- | --- | --- | --- |
| Rust 侧输出 coalescing | `src-tauri/src/modules/pty/session.rs` 的 reader + flusher + `FLUSH_COALESCE=4ms` + `FLUSH_MAX_IDLE=50ms` | 降低 Tauri/WebView event 风暴，减少大输出卡死 | Kerminal 只在前端批量写入 xterm，后端逐 read emit | 合并窗口会改变输出可见时序，需要测试交互 prompt、password responder、日志写入和 final tail |
| Backpressure cap | `MAX_PENDING=4MiB`，overflow 清空 pending 并发送 notice | 防止消费者慢时内存无界增长 | Kerminal 后端没有 pending cap | Terax 使用 `ESC c` hard reset，可能清空 Kerminal scrollback/command block；Kerminal 应先设计可配置 overflow 策略 |
| Final tail flush | waiter 在 exit 前取 pending tail 并先发 data 再发 exit | 避免命令最后一行、错误栈或 Agent 总结丢失 | Kerminal reader 遇 EOF 直接 closed，缺少显式 tail 顺序保障 | 需要避免 closed 和 error 重复、前端 reconnect 文案抢在 tail 前 |
| Windows Job Object | `src-tauri/src/modules/pty/job.rs` | 关闭 session 时杀掉 shell 子进程树，避免 orphan | Kerminal 只 kill child shell | Windows 进程已属于其他 Job 时可能 assign 失败，必须软失败并记录 |
| ConPTY lifecycle lock | `CONPTY_LIFECYCLE_LOCK` 包住 create/drop | 避免 Windows ConPTY create/drop 重叠导致 shell 不出字或关闭卡住 | 未看到等价保护 | 不能在 Tauri IPC worker 上同步等待过久，drop 应放 detached thread |
| Drop kill guard | `Session::drop`、`ChildKillGuard`、`pty_close_all` | 创建失败、webview reload、frontend crash 时不遗留进程 | Kerminal cleanup 主要在显式 close 和 reader EOF | Kerminal 多协议终端不全是本地 PTY，清理策略要只作用本地 manager |
| Shell integration | `shell_init.rs` + `scripts/*.ps1|zsh|bash|fish` | 用 `OSC 7` 和 `OSC 133 A/B/C/D` 稳定表示 cwd、prompt、command start/end | Kerminal command block/cwd 多为启发式 | 注入 shell rc 影响用户 shell，必须 opt-in/auto with fallback、可关闭、原子写、失败裸 shell |
| OSC 信任门 | `src/modules/terminal/lib/osc-handlers.ts` | 命令运行中忽略 `OSC 7`，防止命令输出伪造 cwd | Kerminal 当前 raw output parser 缺少 in-command gate | Kerminal 远程/容器输出更不可信，不能全局相信 OSC |
| Agent 状态 detector | `agent_detect.rs` 只从 `OSC 133`/`OSC 777` 转换状态 | 识别 Codex/Claude/Gemini running/attention/finished/exited，避免 TUI repaint 误判 | Kerminal Agent 状态主要来自 launcher/session，不来自 PTY 内协议 | OSC 777 必须换成 Kerminal 自有 marker，且只对已知 agent/self-arm 生效 |
| DA/DSR filter | `da_filter.rs` | 回答 startup DA/CPR 查询，尤其避免 pwsh/PSReadLine 在 renderer 未绑定前卡住 | Kerminal 测试里需要手动回 `ESC[1;1R`，生产链路未见后端 filter | 过滤 escape sequence 容易破坏真实终端协议，必须小范围、带状态机单测 |
| Raw IPC write | `pty_write` 用 raw body + `x-pty-id` header | 降低每个 keystroke 的 JSON 编解码开销 | Kerminal 当前 `writeTerminal(sessionId, data)` 走常规 invoke | 收益需要测量；Kerminal 支持多协议 write，贸然改 API 会扩大 blast radius |
| 纯状态机测试 | `modeMachine.ts`、`agent_detect.rs`、`osc-handlers.test.ts` | 把 prompt/running/alt/cwd trust/agent status 变成可测模型 | Kerminal 有部分 terminal model tests，但 OSC/shell integration 状态机缺失 | 需要先抽模型，不要把测试绑死在 `XtermPane.runtime.ts` 私有实现 |

## 架构深化候选

### 1. `PtyOutputPump`

- 文件/模块：新增 Rust 模块，建议 `src-tauri/src/services/terminal_output_pump.rs` 或 `src-tauri/src/services/terminal_manager/output_pump.rs`；由 `terminal_manager.rs` 的 reader thread 调用。
- 当前摩擦：输出流控、secret responder、snapshot buffer、log sink 和 event emit 现在堆在 `spawn_reader_thread(...)`，后端没有独立流控边界。
- 建议深化：提供一个小接口承载 coalescing、pending cap、overflow notice、final tail、closed/error 顺序和统计计数。
- 局部性收益：大输出稳定性和事件顺序集中在一个模块，不再让 frontend writer 独自承担背压。
- 杠杆收益：后续 SSH/telnet/serial/docker terminal 如需共享输出流控，可在各自 service 复用同一 pump adapter。
- 测试改善：可用 synthetic producer/consumer 单测覆盖小 chunk 合并、超限丢弃、UTF-8 边界、final tail 先于 closed、channel 关闭停止。
- ADR 冲突：无。符合 ADR-0001 “先优化输出缓冲和 React 隔离”。
- 推荐强度：Strong。

### 2. `PtyProcessGuard`

- 文件/模块：新增 Rust 平台模块，建议 `src-tauri/src/services/pty_process_guard.rs`，Windows 子模块封装 Job Object 和 lifecycle lock。
- 当前摩擦：本地 PTY child、master、writer 的 drop 顺序和 Windows ConPTY 关闭风险分散在 `TerminalSession` 字段顺序和 `close(...)` 中，没有平台语义说明。
- 建议深化：把 child killer、Windows Job Object、detached drop、spawn failure kill guard、orphan reaper 统一成 guard。`TerminalSession` 只持有 guard，不知道 Windows 细节。
- 局部性收益：进程树清理和 ConPTY 风险集中，避免各服务重复处理。
- 杠杆收益：Agent terminal、普通本地 terminal、未来 WSL/local profile 都可复用。
- 测试改善：Unix 覆盖 drop kills child；Windows 覆盖 Job Object invalid pid、drop kills process tree、close 不阻塞 IPC。
- ADR 冲突：无。但如果 `portable-pty` 表现仍不满足，可按 ADR-0001 后续评估更底层 PTY。
- 推荐强度：Strong。

### 3. `ShellIntegrationRuntime`

- 文件/模块：Rust `shell_integration` 负责 build command/env/script；前端 `terminalShellIntegrationModel.ts` 负责 OSC 7/133 state reducer。
- 当前摩擦：cwd、command block、prompt line 依赖启发式，远程/容器 cwd parser 没有命令期信任门。
- 建议深化：只对 local PTY 和明确支持的 shell 注入 `KERMİNAL_TERMINAL=1`、`KERMİNAL_SHELL_INTEGRATION=1`、`TERM=xterm-256color`、`COLORTERM=truecolor`，并用 OSC 7/133 作为首选协议；未集成 shell 继续走现有 fallback。
- 局部性收益：cwd trust、command boundary、prompt/running/alt screen 由一个模型拥有，`XtermPane.runtime.ts` 只消费状态事件。
- 杠杆收益：command block、Agent context、remote suggestion prewarm、future task badge 都可共享同一 shell state。
- 测试改善：可用纯 reducer 覆盖 A/B/C/D、alt screen、malicious OSC 7 during command、split OSC、Windows path decode。
- ADR 冲突：无。需保持 Agent terminal `shellAssistEnabled=false` 的默认真实 PTY 体验。
- 推荐强度：Strong。

### 4. `TerminalAgentSignalDetector`

- 文件/模块：Rust detector 或 frontend parser 二选一。建议 Rust 侧处理原始 PTY bytes，前端只消费 typed event。
- 当前摩擦：Agent Launcher 知道 session 生命周期，但不知道 PTY 内 Codex/Claude 是 working、attention 还是 finished；现有 blocked plan 的真实 CLI smoke 也缺少可观测状态。
- 建议深化：定义 Kerminal 自有 OSC marker，例如 `OSC 777;notify;Kerminal;<agent>;<event>`，并可从 `OSC 133;C;<cmd>` 识别已知 agent 命令启动。只接受 `codex|claude|gemini|custom allowlist`，unknown agent 忽略。
- 局部性收益：Agent 状态不再由 UI 猜测或 TUI repaint 推断。
- 杠杆收益：右栏 Agent badge、MCP runtime snapshot、桌面通知和 session context 可以共享状态。
- 测试改善：用状态机测试覆盖 split OSC、oversized OSC、unknown agent、generic OSC 9 attention、finish on PTY close。
- ADR 冲突：符合 ADR-0017/0018，但不能恢复内置 AI run timeline 或 approval。
- 推荐强度：Worth exploring。

### 5. `TerminalEscapeResponder`

- 文件/模块：Rust `terminal_escape_responder.rs`，先只实现 DA/CPR 最小 responder。
- 当前摩擦：某些 shell/PSReadLine 在 renderer 未绑定时发 DA/DSR 查询，Kerminal 当前没有后端早期响应层；测试里已出现对 `ESC[6n` 的手工响应。
- 建议深化：在 reader pipeline 中识别 bare DA1/DA2/CPR startup query，必要时写回 writer，同时保留非 query escape 到输出。
- 局部性收益：terminal protocol quirks 集中，不混进 secret responder 或 frontend runtime。
- 杠杆收益：改善 PowerShell 启动、renderer 重绑和隐藏 terminal 场景。
- 测试改善：状态机单测覆盖 split query、response no-loop、runaway CSI cap、after-output 不抢响应。
- ADR 冲突：无。
- 推荐强度：Worth exploring。

## 实施顺序

### P0-A 输出泵 tracer bullet

- [x] TASK-001 建立 PTY 输出基线和测试缝隙
  - 新增 synthetic output pump 单测，不先接生产 reader。
  - 固定现有行为契约：data 顺序不乱、closed/error 只发一次、secret responder 先于 snapshot/log/event、日志仍脱敏、output snapshot 保留 recent tail。
  - 增加高频输出基线：模拟 1 字节、1 KiB、64 KiB、16 MiB、100 MiB 生产者，统计事件数、最大 pending、最终 tail。
  - 实际新增：`src-tauri/src/services/terminal_output_pump.rs`、`src-tauri/tests/terminal_output_pump.rs`，并在 `src-tauri/src/services/mod.rs` 暴露测试缝隙；未接入生产 `spawn_reader_thread(...)`。
  - 验证命令：`cd src-tauri && cargo test --test terminal_output_pump -- --nocapture`、`cd src-tauri && cargo test --test terminal_manager -- --nocapture`。

- [x] TASK-002 引入 `PtyOutputPump` 并接入本地 `TerminalManager`
  - Reader thread 继续负责 `read(...)` 和 secret responder，pump 负责 pending bytes、coalescing、overflow 和 event emit。
  - 默认参数建议：read buffer 16 KiB；coalesce 4 ms；max idle 50 ms；pending cap 4 MiB；参数放常量并写测试。
  - Overflow 策略先采用 “drop whole pending + SGR reset + Kerminal notice”，不默认 `ESC c` hard reset；是否升级 hard reset 由真实 xterm smoke 决定。
  - `TerminalOutputBuffer` 和 `ActiveTerminalLog` 更新必须在 pump flush 时保持顺序；如果继续在 read path 更新，也必须记录 dropped bytes 与 snapshot 语义。
  - 实际实现：`spawn_reader_thread(...)` 拆为 reader thread + output flusher thread；reader 只做阻塞 read、UTF-8 转换和 secret responder，flusher 通过 `PtyOutputPump` 执行 byte cap、4 ms coalesce、50 ms max idle、64 KiB flush threshold 和 4 MiB pending cap。
  - flush 顺序：`TerminalOutputDeliverySink` 在 data event 上先更新 `TerminalOutputBuffer`，再写 `ActiveTerminalLog`，最后 emit `TerminalOutputEvent`；closed/error 继续作为 terminal event 发送。
  - 验证命令：`cd src-tauri && cargo test --test terminal_manager`、`npm run perf:terminal-output`。

- [x] TASK-003 Final tail 和 session close 顺序加固
  - 拆 reader/flusher/waiter 责任：child exit 后等待 reader EOF 或短 deadline，发送 pending tail，再发送 closed/exit。
  - 前端 `finishSessionClosed(...)` 必须在 tail 写入后再输出 “会话已结束” 文案。
  - 增加测试：短命令最后一行无换行、stderr 最后一行、exit immediately、consumer channel closed。
  - 验证命令：`cd src-tauri && cargo test --test terminal_manager pty_session_emits_output_for_short_lived_command output_snapshot_returns_recent_terminal_output`。
  - 实际实现：`TerminalSession.child` 改为共享 child handle，新增 child-exit waiter 线程；reader 只负责 read/secret responder/data/error/EOF 上报，flusher 继续负责 coalescing/final flush/event emit；waiter 在 child exit 后等待 reader EOF 500 ms，超时强制发送 `Closed`，避免 Windows ConPTY 短命令长期没有 closed。
  - 前端复核：`XtermPane.runtime.ts` 的 `finishSessionClosed(...)` 使用 `outputWriter.writeNow(...)`，而 `writeNow` 会先 `flush()` pending data，因此后端 data-before-closed 顺序足以保证 tail 先于关闭文案，不需要改右栏 Agent terminal 共享文件。
  - 新增测试：`pty_session_emits_final_tail_before_closed_for_short_lived_command`、`pty_session_emits_stderr_tail_before_closed`、`pty_session_immediate_exit_emits_closed_once`、`pty_session_tolerates_output_consumer_closing_before_session_exit`。

### P0-B Windows 生命周期与 orphan guard

- [x] TASK-004 新增 `PtyProcessGuard`
  - Windows：新增 `windows-sys` 直接依赖，封装 Job Object `KILL_ON_JOB_CLOSE`，assign 失败软降级为普通 killer 并 log warn。
  - 所有平台：spawn 成功但 reader/writer setup 失败时 kill child；`TerminalSession::drop` best-effort kill；`close(...)` 从 session map 移除后 detached drop。
  - Windows：用 static lifecycle lock 包住 `openpty/spawn/drop master` 的临界区，避免 create/drop 重叠。
  - 验证命令：`cd src-tauri && cargo test --test terminal_manager`；Windows 额外跑 Job Object focused test。
  - 实际实现：新增 `src-tauri/src/services/pty_process_guard.rs`，包含 `PtyProcessGuard`、`PtyMasterGuard` 和 Windows ConPTY lifecycle lock。`PtyProcessGuard` 持有 shared child、cloned killer、kill-once flag 和可选 Windows Job Object；Job Object assign 失败只 warn 并退回普通 killer。`PtyMasterGuard` 在 Windows 下把 master drop 放进同一 lifecycle lock。
  - `TerminalManager::create_session_with_secret_input_plan(...)` 现在用 lifecycle lock 包住 `openpty/spawn`，spawn 成功后立即建立 guard；如果 reader/writer setup 或后续 session 注册失败，guard drop 会 best-effort kill child，cleanup guard 继续清理临时路径。
  - `TerminalManager::close(...)` 保持缺失 session 报错和 cleanup path 同步删除契约；从 session map 移除后把 process kill、master/writer drop 放到 detached thread，避免 UI/MCP close 被 child teardown 或 ConPTY drop 卡住。
  - 新增测试：`src-tauri/tests/pty_process_guard.rs` 覆盖 drop kill、kill 幂等、已退出不 kill、status 查询和 Windows 无 raw handle 软降级；`src-tauri/tests/terminal_manager.rs` 新增 `close_interactive_session_returns_quickly_and_removes_session`。

- [x] TASK-005 WebView reload orphan reaper
  - 新增本地 PTY close-all/reap 入口，仅清理本进程内 `TerminalManager` 的 orphan local PTY。
  - 前端启动或 root workspace mount 时调用，必须避开 SSH/Telnet/Serial/容器的正常 reconnect 语义。
  - 记录 diagnostics：reaped count、session ids、elapsed ms。
  - 验证：dev HMR/reload 后旧本地 shell 不残留；`npm run tauri:dev` smoke。
  - 实际实现：新增 `TerminalManager::reap_orphan_sessions()` 和 Tauri command `terminal_reap_orphan_sessions`，只 drain 本地 `TerminalManager` session map，返回 `TerminalSessionReapDiagnostics { reaped_count, session_ids, elapsed_ms }`，并复用 `TerminalSession::close_detached()` 同步清理 cleanup paths、后台 kill/drop PTY。
  - 前端接入：`terminalApi.reapOrphanTerminalSessions()` 在 Tauri 下调用本地 command，浏览器预览 no-op；`useWorkspaceSessionPersistence` 新增 `beforeRestore` 钩子，`KerminalShell` 在 workspace session restore 前调用 reaper，失败只 `console.warn` 并继续恢复，避免白屏或阻断 SSH/Telnet/Serial/container 正常入口。
  - 测试覆盖：Rust 覆盖空 manager no-op、两个 interactive local PTY 批量 reap 后 session map 清空；前端覆盖 reaper 完成前不恢复本地 terminal、reaper 失败仍继续恢复、API command/no-op 分支。

### P1 Shell integration 和 OSC 信任模型

- [x] TASK-006 设计并实现 local shell integration build command
  - Rust 新增 shell 枚举和 sanitization：只允许默认 shell或枚举 shell；任意路径 override 必须 canonicalize 后匹配 list。
  - 支持顺序：Windows PowerShell 7/Windows PowerShell、Git Bash、WSL bash/zsh/fish、Unix zsh/bash/fish。
  - 生成脚本写入 Kerminal cache 目录，原子替换；失败时裸 shell 启动并返回 `shellIntegration=disabled` summary。
  - 环境变量使用 Kerminal 命名：`KERMINAL_TERMINAL=1`、`KERMINAL_SHELL_INTEGRATION=1`，避免复用 Terax 标识。
  - 验证：build command unit tests，Windows/Unix/WSL launch spec tests。
  - 实际实现：新增 `src-tauri/src/services/terminal_shell_integration.rs`，用 `IntegratedShellKind` / `ShellIntegrationCatalog` 建模支持 shell；路径 override 走 canonicalize 与 allowlist 匹配，unsupported/custom args/env opt-out/script setup failure 均降级裸 shell。
  - `TerminalManager` 在 `CommandBuilder` 前应用 launch plan；生产 `AppState` 使用 `~/.kerminal/cache` 作为脚本 cache，测试默认走系统 temp cache；远程/容器/Telnet/Serial 通过 custom args 或 wrapper command 保持 `shellIntegration=disabled` 裸启动。
  - 新增 `TerminalShellIntegrationSummary` 到 Rust/TS `TerminalSessionSummary`，浏览器预览和降级路径显式返回 disabled reason；enabled 时返回 shell kind 和脚本路径。
  - 生成脚本：PowerShell、bash、zsh、fish 写入 cache 并原子替换；PowerShell 尝试 PSReadLine command-start hook，bash/zsh/fish 提供 OSC 7 与 OSC 133 A/B/C/D 基础信号；env 使用 Kerminal 命名并补齐 `TERM=xterm-256color`、`COLORTERM=truecolor`。
  - 新增测试：`src-tauri/tests/terminal_shell_integration.rs` 覆盖 PowerShell 7、Git Bash、WSL bash/zsh/fish、Unix zsh/bash/fish、canonical path override、custom args 降级、script setup failure 降级和 env opt-out。

- [x] TASK-007 前端 `ShellIntegrationState` 和 OSC handler
  - 在 xterm parser 注册 `OSC 7` 和 `OSC 133` handler，新增纯 reducer：`prompt | typing | running | alt`。
  - `OSC 7` 只在不处于 command output/running 窗口时更新 cwd；命令运行中来自输出流的 cwd OSC 必须忽略。
  - 支持 `file://host/path`、Windows `/C:/...`、MSYS `/c/...` decode；拒绝控制字符、超长 path 和 malformed URI。
  - 现有 `collectCurrentDirOscSequences(...)` 作为 remote/container fallback 保留，但标记为 untrusted heuristic，不再用于 local integrated shell。
  - 验证：Vitest 覆盖 malicious `cat` 输出伪造 OSC 7、split OSC、A/B/C/D 顺序、alt screen。
  - 实际实现：新增 `src/features/terminal/terminalShellIntegrationModel.ts`，用纯 reducer 表达 `prompt | typing | running | alt`；`OSC 133 C` 进入 running，`D/A/B` 回到 prompt，输入提交进入 running，alternate buffer 进入 alt 并在返回 normal 时恢复 normal mode。
  - `XtermPane.runtime.ts` 现在注册 xterm `OSC 7` / `OSC 133` handler；只有本地 session 且 `session.shellIntegration.status === "enabled"` 时才信任。`OSC 7` 在 running/alt/disabled 下只消费或忽略，不更新 cwd；enabled prompt 下更新 `currentCwdRef`、session registry 和 `onCurrentCwdChange`。
  - 保留 remote/container 的 `collectCurrentDirOscSequences(...)` fallback；本地 integrated shell 不走该启发式路径。Agent terminal `shellAssistEnabled=false` 输入体验未改，未恢复 composer/queue。
  - 测试同步：`XtermPane.testSupport` mock parser 增加 `registerOscHandler/triggerOsc`；默认 session summary 补 `shellIntegration=disabled`；`XtermPane.contextMenu.test.tsx` 两个 reconnect 断言同步当前 fit 后 100x30 create request 行为。

- [x] TASK-008 命令块从启发式升级到协议优先
  - integrated shell：`OSC 133 C` 创建/提交 command block，`OSC 133 D` 结束 block，`OSC 133 A/B` 更新 prompt marker。
  - non-integrated shell：保留当前 input model + prompt heuristic fallback。
  - Agent terminal `shellAssistEnabled=false`：不创建命令块，不触发 ghost suggestion。
  - 验证：`terminalCommandBlocks.test.ts`、新增 `terminalShellIntegrationModel.test.ts`、真实 xterm smoke。
  - 实际实现：`terminalShellIntegrationModel` 新增 `OSC 133` parser 和按 data/marker 分段的 collector；`XtermPane.runtime.ts` 在 trusted local integrated session 中缓存待提交命令，等可信 `OSC 133 C` 后再创建/提交 command block，并在输出 append 前按协议分段，避免同一 data event 内 `OSC 133 C` 后的首段输出丢失；`OSC 133 D` 停止继续收集 prompt 文本，xterm parser 回调再补 end marker；`A/B` 通过 protocol prompt marker 更新当前 prompt block。`XtermPane.tsx` 在 protocol mode 下停止运行 prompt heuristic，non-integrated session 继续原 fallback。
  - 脚本同步：PowerShell、bash、zsh、fish 的 shell integration preexec/PSReadLine handler 改为发送 `OSC 133;C;<sanitized command>`；前端仍保留输入模型 pending command 作为无 payload fallback。
  - 边界验证：`shellAssistEnabled=false` 即使收到可信 local OSC 133 也不建 command block、不记录 command history；remote/container 仍不信任 local shell integration 协议。

### P1 Agent PTY 状态信号

- [x] TASK-009 定义 Kerminal Agent OSC marker 和 detector
  - 定义 marker：`OSC 777;notify;Kerminal;<agent>;<event>`；event 至少 `working|attention|finished`。
  - Detector 只从 OSC 序列转状态，不从普通输出文本推断，避免 TUI repaint 抖动。
  - 支持 `OSC 133;C;<cmd>` 自动识别 `codex|claude|gemini` 启动；unknown agent 不 self-arm。
  - PTY EOF 时 armed agent 自动 `exited`。
  - 验证：Rust detector tests 覆盖 split、oversized、unknown、finish、OSC 9 attention。
  - 实际实现：新增 `src-tauri/src/services/terminal_agent_signal_detector.rs`，定义 `TerminalAgentKind`、`TerminalAgentStatus`、`TerminalAgentSignal` 和 `TerminalAgentSignalDetector`。Detector 只扫描 OSC，支持 BEL/ST 终止、跨 chunk buffer、8 KiB 默认 sequence cap、`OSC 777;notify;Kerminal;<agent>;<event>`、`OSC 133;C;<cmd>` known agent self-arm、armed agent 上的 `OSC 9` attention 和 PTY EOF `exited`；unknown agent/unknown command 不 self-arm。
  - 实际测试：新增 `src-tauri/tests/terminal_agent_signal_detector.rs`，覆盖 split marker、oversized OSC 丢弃后继续解析、unknown agent 不 arm、不在 EOF 生成状态、`OSC 133 C` 识别 `codex|claude|gemini`、finished marker、OSC 9 attention 和 EOF exited once。

- [x] TASK-010 接入 Agent Launcher 和 MCP runtime snapshot
  - `TerminalOutputEvent` 可新增非输出状态事件，或通过 Tauri app event 发布 typed `TerminalAgentSignal`；不得混入 terminal data 流。
  - 右栏 Agent terminal 可显示轻量状态 badge，但不恢复 composer/queue 主界面。
  - `kerminal.runtime_snapshot` 和 session workspace snapshot 可包含最新 agent signal，用于外部 agent/用户判断是否需要注意。
  - 验证：AgentLauncher model/API tests、MCP snapshot tests、真实 Codex/Claude smoke 可选。
  - 实际实现：`TerminalAgentKind`、`TerminalAgentStatus`、`TerminalAgentSignal` 和 `TerminalAgentSignalSummary` 已提升到 `models::terminal`，`TerminalOutputKind` 新增 `agentSignal` typed event，`TerminalSessionSummary` 保留 `agentSessionId` 和最近一次 `agentSignal`。`TerminalManager` reader 在 secret redaction 后调用 detector，只过滤 Kerminal 自有 Agent OSC marker，其它 OSC 保持进终端；typed signal 通过 output flusher 单独 emit，不写入 `TerminalOutputBuffer`、日志或 xterm data。Detector 状态在线程间共享，reader EOF 和 child-exit waiter timeout 都会通过同一个 `finish_pty()` 生成一次 `exited`。
  - 前端接入：`terminalApi.ts` 增加 Agent signal 类型；`XtermPane` 新增 `onAgentSignal` 窄回调，runtime 在 data/write/history/command-block 之前处理 `agentSignal` 并直接返回。`AgentLauncherToolContent` 根据 `agentSessionId` 更新对应右栏 Agent session，header 显示 `工作中` / `需处理` / `已完成` / `已退出` 轻量 badge，同时继续传 `shellAssistEnabled={false}` 和 `inputCompatibilityMode="agentTui"`，未恢复 composer/queue/prompt toolbar。
  - MCP 接入：`kerminal.runtime_snapshot` 的 `terminalSessions[]`、`agentSessions[]` 和 entities 包含 `agentSessionId` / `agentSignal`，通过 live terminal summary 建立 transient 映射，不改 Agent session TOML 持久化。
  - 实际测试：`src-tauri/tests/terminal_manager.rs` 新增 marker-through-PTY 集成测试，断言 `OSC 777` marker 不进入 data/snapshot，typed `working`/`finished`/`exited` 进入事件和 summary；`src/lib/terminalApi.test.ts`、`src/features/terminal/XtermPane.sessionTargets.test.tsx`、`src/features/tool-panel/AgentLauncherToolContent.test.tsx` 覆盖 Channel passthrough、runtime no-write 和 Agent badge。

### P2 协议细节和性能优化

- [x] TASK-011 `TerminalEscapeResponder` 最小 DA/DSR responder
  - 先只响应 DA1、DA2 和启动期 `ESC[6n` CPR；已经有输出后不再抢 CPR。
  - 必须避免 response loop：识别已是 response 的 `ESC[?1;2c`、`ESC[>0;...c` 原样通过。
  - 验证：状态机单测、PowerShell 启动 smoke、hidden renderer/rebind smoke。
  - 实际实现：新增 `src-tauri/src/services/terminal_escape_responder.rs`，`observe(...)` 返回过滤后的 terminal data 和待写回 PTY 的 response；`TerminalManager` reader 在 secret responder、Agent detector 和 output pump 之前调用 responder 并通过同一 writer 写回 DA/CPR response。
  - 协议边界：过滤并代答 DA1 `ESC[c`/`ESC[0c`、DA2 `ESC[>c`/`ESC[>0c` 和启动期 `ESC[6n`；`ESC[?1;2c`、`ESC[>0;...c`、`ESC[1;1R` 和普通 CSI/OSC 原样通过；已经看到 visible output 后，CPR 不再由后端抢答，交给前端 renderer/真实终端处理。
  - 实际测试：`src-tauri/tests/terminal_escape_responder.rs` 覆盖 DA/DA2/CPR、split query、response no-loop、visible output 后不抢 CPR、OSC payload 不误判 visible output、runaway CSI cap；`src-tauri/tests/terminal_manager.rs` 新增 Node raw TTY harness，确认无前端 renderer 代答时 PTY child 能收到后端 `ESC[1;1R` 并继续输出 `kerminal-cpr-ok`。

- [x] TASK-012 Raw input IPC 性能评估
  - 先测现状：普通输入、paste 1 KiB/64 KiB/1 MiB、IME composition、Agent TUI Shift+Enter。
  - 只有当 JSON invoke 成为可见瓶颈时，新增 local PTY raw write path；远程/SSH/serial/container write path 不在同一切片修改。
  - 验证：raw bytes harness、`XtermPane.inputCompatibility.test.tsx`、真实 Tauri smoke。
  - 实际实现：新增 `scripts/perf-terminal-input.mjs` 和 `npm run perf:terminal-input`，生成 `.updeng/docs/verification/terminal-input-baseline.json`；脚本测量当前 `terminal_write` JSON payload 的 stringify/parse 成本、UTF-8 bytes、JSON bytes 和 expansion ratio。
  - 实际结论：当前 Node 可重复基线中 1 MiB paste JSON stringify p95 约 2.65 ms、parse p95 约 1.33 ms；普通输入、Agent Shift+Enter、IME Unicode 和 1 KiB/64 KiB paste 均远低于阈值。没有证据支持在本切片引入 local PTY raw IPC；保留现有 `writeTerminal(sessionId, data)` API。
  - 实际测试：`XtermPane.inputCompatibility.test.tsx` 增加 8 KiB `onData` 单次透传回归，锁住前端不把较大 payload 拆成逐字符 `writeTerminal`。尝试 1 MiB/64 KiB 组件级 payload 会显著放大输入模型成本并触发超时，因此 1 MiB 规模只进入性能脚本报告，不进入常规 Vitest。

### P3 收尾验证矩阵

- [x] TASK-013 自动化本地 PTY 交互矩阵
  - 覆盖当前机器可用 shell：`cmd`、PowerShell 7、Windows PowerShell、Git Bash 或 WSL bash；缺失项必须在测试输出和 Round Log 中标为 skipped，不伪装成通过。
  - 覆盖 TUI 关键字节路径：alternate screen enter/exit、bracketed paste、Unicode 输入、resize 调用、Ctrl+C、Ctrl+D。
  - 不把真实 Codex/Claude prompt、多行输入和实际 `vim/less/top/tmux` 人工交互伪装成自动完成；这些仍按 HITL/后续 smoke 记录。
  - 验证：新增 Rust integration test，运行 `cd src-tauri && cargo test --test terminal_interaction_matrix -- --nocapture`；通过后补 `npm run tauri:dev` 启动冒烟。
  - 实际实现：新增 `src-tauri/tests/terminal_interaction_matrix.rs`，通过 `TerminalManager::create_session/write/resize/close` 公共入口创建真实本地 PTY，会按环境发现 `cmd`、PowerShell 7、Windows PowerShell、Git Bash 和 WSL bash。缺失 shell 输出 `status=skipped reason=...`，不会计入 passed；当前机器五项全部 passed。
  - 覆盖方式：Windows shell/Git Bash 通过 Node raw TTY harness 验证 bracketed paste、Unicode 输入、Ctrl+C、Ctrl+D 和 resize child event；WSL bash 通过 bash raw-mode harness 验证相同输入字节路径，并用 `TerminalManager::session_summary()` 锁定 resize 调用结果。所有 shell 都断言 alternate screen enter/exit escape 序列真实进入 output data。
  - 实际验证：`cd src-tauri && cargo test --test terminal_interaction_matrix -- --nocapture` 输出 `cmd,powershell-7,windows-powershell,git-bash,wsl-bash` 全部 passed，skipped 为空；随后 `npm run tauri:dev` 真实启动通过。

- [x] TASK-014 自动化 WSL TUI 程序 smoke 矩阵
  - 覆盖本机 WSL 中可用的实际 TUI 程序：`vim`、`less`、`top`、`tmux`；缺失项必须在测试输出和 Round Log 中标为 skipped，不伪装成通过。
  - 使用真实 `TerminalManager` 本地 PTY 会话启动 WSL bash，再进入对应 TUI 程序，发送真实退出按键或 tmux detach 序列，验证程序输出、退出标记和会话未卡死。
  - 不把 Codex/Claude 真实 prompt、多行输入和账号态交互伪装成自动完成；这些仍按 HITL/blocked 记录。
  - 验证：新增 Rust integration test，运行 `cd src-tauri && cargo test --test terminal_tui_program_matrix -- --nocapture`；通过后补 `npm run tauri:dev` 启动冒烟。
  - 实际实现：新增 `src-tauri/tests/terminal_tui_program_matrix.rs`，通过真实 `TerminalManager` 本地 PTY 会话调用 `wsl.exe -e bash -lc <script>`，分别启动 WSL 内 `vim`、`less`、`top`、`tmux`，发送真实退出序列 `:q!\r`、`q`、`q`、`Ctrl+B d`。
  - 覆盖方式：每个 case 先等待 `matrix-<program>-ready`，进入 TUI 后断言实际程序输出 marker，再等待脚本打印 `matrix-<program>-exit`；测试遇到前端 CPR query 会模拟 renderer 回 `ESC[1;1R`，避免把 hidden renderer 交互卡死误判为程序失败。
  - 实际验证：`cd src-tauri && cargo test --test terminal_tui_program_matrix -- --nocapture` 输出 `vim,less,top,tmux` 全部 passed，skipped 为空；随后 `npm run tauri:dev` 真实启动通过。

- [x] TASK-015 Codex/Claude 真实 CLI HITL harness
  - 默认只编译 harness 并安全跳过，不启动真实 Codex/Claude TUI，不提交模型 prompt。
  - 显式设置 `KERMINAL_AGENT_CLI_HITL=1` 时才启动真实 CLI，执行多行输入、Tab、Shift+Tab、Esc、bracketed paste、Ctrl+C 和 resize 预检；默认不发送最终 Enter。
  - 显式设置 `KERMINAL_AGENT_CLI_HITL_ALLOW_SUBMIT=1` 时才向 Codex/Claude 各提交最小 prompt，并等待 `KERMINAL_SMOKE_OK`；这一步会使用当前账号、网络和模型服务，必须由用户授权执行。
  - 实际实现：新增 `src-tauri/tests/terminal_agent_cli_hitl_matrix.rs` 和 `.updeng/docs/verification/agent-cli-hitl-smoke.md`，记录本机 `codex-cli 0.142.2`、`Claude Code 2.1.195`、默认安全检查命令、真实预检命令和真实提交验收命令。
  - 实际验证：`cd src-tauri && cargo test --test terminal_agent_cli_hitl_matrix -- --nocapture` 通过；默认输出 `codex`、`claude` 均 skipped，证明无人值守验证不会误触发外部 Agent TUI 或模型服务。`cargo fmt --check`、focused clippy、`npm run build` 和本轮 `git diff --check` 也已通过。

## 验收标准

- 高频输出：本地 PTY 连续输出至少 100 MiB 时，Kerminal 不白屏、不无界增内存、不让 Tauri event 队列堆积到不可恢复；输出丢弃时有用户可见 notice 和 diagnostics。
- 输出顺序：任何 session close/exit/error 前，最后 pending tail 已先进入 xterm 和 output snapshot。
- 进程清理：关闭本地 PTY 后，Windows 下 shell 子进程树在 3 秒内退出；WebView reload 不留下旧本地 shell。
- Shell state：integrated local shell 的 cwd 更新来自可信 `OSC 7` 窗口；命令运行中伪造 `OSC 7` 不改变 Kerminal 当前 cwd。
- 命令块：integrated shell 的 command block start/end 与 `OSC 133` 对齐；non-integrated shell fallback 行为不回退。
- Agent 状态：Codex/Claude/Gemini 启动、attention、finished、exited 能通过 typed signal 被 UI/MCP snapshot 消费；普通命令输出不能伪造 unknown agent。
- 兼容性：PowerShell、Git Bash、WSL、bash/zsh/fish、vim/less/top/tmux、中文路径、IME、paste、resize、alternate screen、Ctrl+C/Ctrl+D 均有自动或人工验证记录。
- 启动：涉及 Rust/Tauri/窗口/PTY 的切片必须跑 `npm run build` 和真实 `npm run tauri:dev` 或写明无法运行原因与剩余风险。

## 验证矩阵

| 层级 | 命令/方式 | 覆盖 |
| --- | --- | --- |
| Rust focused | `cd src-tauri && cargo test --test terminal_manager` | output pump、secret responder、snapshot、close、process guard |
| Rust protocol | 新增 detector/filter/shell integration tests | OSC state、DA/DSR、agent signal、shell command build |
| Rust quality | `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings` | lint 和跨 target 编译风险 |
| Frontend focused | `npm run test -- --run src/features/terminal/<new-tests>` | shell integration reducer、OSC trust、command block fallback |
| Frontend regression | `npm run test -- --run src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/tool-panel/AgentLauncherToolContent.test.tsx` | Agent terminal 输入兼容和真实 PTY UI 边界 |
| Build | `npm run build` | Vite/TypeScript production build |
| Performance | `npm run perf:terminal-output` 加新后端事件计数 | 大输出帧率、event 数、pending cap |
| Runtime | `npm run tauri:dev` | Windows ConPTY、PowerShell/Git Bash/WSL、WebView reload |
| Runtime matrix | `cargo test --test terminal_interaction_matrix -- --nocapture` + `cargo test --test terminal_tui_program_matrix -- --nocapture` | 本机 shell 交互和 WSL `vim/less/top/tmux` 真实 TUI 程序 |
| Manual smoke | `cargo test --test terminal_agent_cli_hitl_matrix -- --nocapture` + Codex/Claude CLI HITL | 默认安全跳过；授权后真实 prompt、多行输入、attention、exit、paste、resize |

## 回滚策略

- P0 output pump 通过窄接口接入。若高频输出或交互 prompt 出现回归，回滚到原 `spawn_reader_thread` 直接 emit 路径，并保留新增测试作为失败证据。
- Windows Job Object 软失败不阻断 terminal 启动。若 assign 引发兼容问题，先关闭 Job Object，只保留 spawn failure kill guard 和 detached drop。
- Shell integration 默认应有开关：`auto | off`。若某 shell rc 兼容失败，单 shell 降级为 bare shell，不影响其它 shell 和远程终端。
- OSC 133 command block 接入必须保留当前 heuristic fallback。若协议事件不完整，回滚到 fallback，不删除现有命令块逻辑。
- Agent signal 是增量状态，不参与写终端和权限决策。若 signal 误判，关闭 marker detector 不影响真实 Agent PTY。
- Raw IPC write 只有在 P2 测量证明必要时做；如果引入兼容问题，回滚到现有 `writeTerminal(sessionId, data)`。

## 并行协作要求

- 本 lane：`lane-pty-stability-hardening-20260630`。
- Owned paths：
  - `.updeng/docs/plan/blocked/PLAN-20260630-103212-pty-stability-hardening.md`
  - `src-tauri/src/services/terminal_output_pump.rs`
  - `src-tauri/tests/terminal_output_pump.rs`
- Shared paths：
  - `.updeng/docs/plan/INDEX.md`
  - `.updeng/docs/in-progress.md`
  - `.updeng/docs/coordination/lanes.json`
  - `src-tauri/src/services/mod.rs`
  - `src-tauri/src/services/terminal_shell_integration.rs`
  - `src-tauri/src/state.rs`
  - 后续实现会涉及 `src-tauri/src/services/terminal_manager.rs`、`src/features/terminal/XtermPane.runtime.ts`、`src/features/terminal/XtermPane.helpers.ts`、`src/features/terminal/terminalCommandBlockLifecycle.ts`、`src/features/terminal/terminalCommandBlocks.ts`、`src/features/tool-panel/AgentLauncherToolContent.tsx`
  - `src-tauri/tests/terminal_manager.rs`
- 写入 `XtermPane.runtime.ts` 或 Agent terminal 文件前，必须先读 blocked lane `.updeng/docs/plan/blocked/PLAN-20260626-155809-agent-terminal-production-compat.md`，保持真实 xterm/PTY 默认体验。
- 每完成一个实现切片，必须 checkpoint 或提交具体文件，并在本计划 Round Log 写明 touched paths、验证命令和剩余风险。

## 待确认点

- TASK-006 默认选择：对无自定义 args 且匹配 allowlist 的 local shell 走 auto shell integration；用户或 profile 可用 `KERMINAL_SHELL_INTEGRATION=off|0|false|disabled` 降级裸 shell。后续如需 UI 设置再另开切片。
- Overflow notice 是否允许 `ESC c` hard reset。推荐先不默认 hard reset，等真实 xterm corruption smoke 证明必要后再开。
- Agent marker 是否只支持 Kerminal 启动的 Agent terminal，还是也允许普通中间终端里手动运行 `codex`/`claude` 时识别。
- SSH/container 是否需要未来注入 remote shell integration。推荐另开计划，因为信任边界、远程文件写入和用户 shell rc 风险明显高于 local。

## Round Log

### 2026-06-30T10:32:12+08:00

- 根据用户要求研究 Terax PTY 代码，并形成面向 Kerminal 稳定性/健壮性的生产级完整方案。
- 回读 `AGENTS.md`、`README.md`、`.updeng/docs/README.md`、`in-progress.md`、`BLOCKERS.md`、`plan/INDEX.md`、`coordination/status.md`、`coordination/lanes.json` 和相关 ADR/blocked Agent terminal 计划。
- 使用 CodeGraph 复核 Kerminal `terminal_manager.rs`、`terminalOutputWriter.ts`、`XtermPane.runtime.ts`、`XtermPane.helpers.ts`、`agentTerminalContextModel.ts` 和 `terminal_manager` 测试。
- 复核 Terax commit `3f4d6803e90ca4a98bfb1fd8508e76d64963c57b` 的 `pty/session.rs`、`pty/mod.rs`、`shell_init.rs`、`agent_detect.rs`、`da_filter.rs`、`job.rs`、shell integration scripts、`osc-handlers.ts` 和 `modeMachine.ts`。
- 结论：P0 优先做后端 output pump/backpressure/final tail 和 Windows process guard；P1 做 shell integration/OSC trust/command block protocol/agent signal；P2 再评估 DA/DSR responder 和 raw IPC write。
- 本轮只写计划文档和 lane 台账，不修改生产代码；未运行构建或测试。

### 2026-06-30T11:03:30+08:00

- 完成 P0-A `TASK-001` 输出泵 tracer bullet：新增 `PtyOutputPump` 纯模型，覆盖 byte-threshold coalescing、pending cap、overflow notice、final tail、closed/error 单发、downstream stop 和统计计数。
- 新增 synthetic 测试 `src-tauri/tests/terminal_output_pump.rs`，未接入生产 `spawn_reader_thread(...)`，因此当前本地 PTY 运行行为保持不变。
- 固定交付顺序契约：测试 harness 明确先使用已转换/脱敏数据，再按 snapshot、log、event 顺序交付；相邻 `terminal_manager` 集成测试继续覆盖 secret responder、日志脱敏、output snapshot 和本地 PTY smoke。
- 高频基线结果：1 byte -> 1 data event/max pending 1；1 KiB -> 1 event/max pending 1024；64 KiB -> 1 event/max pending 65536；16 MiB -> 256 events/max pending 65536；100 MiB -> 1600 events/max pending 65536；所有 case final tail 保留 64 字节。
- 验证通过：
  - `cd src-tauri && cargo test --test terminal_output_pump -- --nocapture`：6 passed。
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：22 passed。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk size warning。
  - `npm run tauri:dev`：passed；Vite dev server ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，进程以 0 退出，未出现启动阻断错误。
- 额外检查：
  - `cd src-tauri && cargo clippy --test terminal_output_pump -- -D warnings`：failed，失败点是既有 `remote_host_service.rs`/`ssh_terminal_service.rs` 的 `too_many_arguments` 和 `workspace_sync_service.rs` 的 `needless_borrows_for_generic_args`，不属于本切片。
  - `cd src-tauri && cargo clippy --test terminal_output_pump -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed，用于确认本轮新增 output pump/test 没有额外 lint。
- 本切片仍未接入生产 reader；TASK-002 接入 `spawn_reader_thread(...)` 后需要重新跑完整 Rust/Tauri/前端门禁和真实大输出 smoke。

### 2026-06-30T11:09:09+08:00

- 完成 P0-A `TASK-002`：`PtyOutputPump` 已接入本地 `TerminalManager` 生产 reader。`READ_BUFFER_SIZE` 从 8 KiB 提升到 16 KiB；新增 64 KiB flush threshold、4 ms coalesce、50 ms max idle、4 MiB pending cap 常量。
- `spawn_reader_thread(...)` 现在拆成 reader + flusher：reader 继续负责 `read(...)`、UTF-8 lossless fallback 和 `TerminalSecretInputResponder`；flusher 通过 channel 接收已脱敏 data/closed/error，并用 `PtyOutputPump` 统一控制 pending、overflow、final flush 和 event emit。
- 新增 `TerminalOutputDeliverySink` 作为生产 adapter，data flush 顺序固定为 output snapshot -> active log -> output event；closed/error 不混入 data 流。
- 补充 `terminal_manager` 集成测试：
  - `pty_session_flushes_short_lived_tail_without_waiting_for_threshold`：短输出未达到 64 KiB 阈值时仍会被 idle flush 推给前端。
  - `pty_session_coalesces_fast_bulk_output_and_snapshot_keeps_tail`：快速 128 KiB 输出能 coalesce 后送达，最终 tail 进入 snapshot。
- 发现并记录边界：Windows ConPTY 下 `cmd /C` / `powershell -Command` 的 reader EOF/closed event 并不稳定，短输出和 bulk 输出都能到达，但 `closed` 事件可能不在 5 秒内出现；这正是下一步 `TASK-003` reader/waiter/exit 顺序要解决的问题，本轮不把 closed 顺序冒充为已完成。
- 验证通过：
  - `cd src-tauri && cargo test --test terminal_output_pump -- --nocapture`：6 passed。
  - `cd src-tauri && cargo test --test terminal_manager pty_session -- --nocapture`：3 passed。
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：24 passed。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk size warning。
  - `npm run tauri:dev`：passed；Vite dev server ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，进程以 0 退出，未出现启动阻断错误。
  - `npm run perf:terminal-output`：passed；4 scenarios，max frame gap 33.40 ms，max long task 0.00 ms，报告写入 `.updeng/docs/verification/terminal-output-baseline.json`。
- 额外检查：
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump -- -D warnings`：failed，仍失败于既有 `remote_host_service.rs` / `ssh_terminal_service.rs` 的 `too_many_arguments` 和 `workspace_sync_service.rs` 的 `needless_borrows_for_generic_args`，不属于本切片。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed，用于确认本轮新增接线和测试无新增 lint。

### 2026-06-30T11:22:12+08:00

- 完成 P0-A `TASK-003`：本地 PTY 关闭顺序拆为 reader/flusher/waiter 三段。reader 负责阻塞 read、secret responder、脱敏和 reader done 信号；flusher 负责 `PtyOutputPump` coalescing、pending cap、final flush 和 event emit；waiter 轮询 child exit，退出后等待 reader EOF 500 ms，超时强制发送 `Closed`。
- 修复的核心风险：Windows ConPTY 下 `cmd /C` / PowerShell 短命令最后 tail 已经输出但 reader EOF/closed 不稳定。现在 child exit 会触发 bounded close path，保证 pending tail 先 flush，再发 closed，避免前端和 Agent 上下文长期看不到会话结束。
- 前端共享文件复核但未修改：`XtermPane.runtime.ts` 的 closed 文案走 `outputWriter.writeNow(...)`；`terminalOutputWriter.writeNow(...)` 会先 flush pending data 再写文案，因此后端 data-before-closed 顺序能传递到 xterm，不需要触碰右栏 Agent terminal 默认真实 PTY 体验。
- 新增 `terminal_manager` 集成测试覆盖：短命令无换行 final tail 先于 closed、stderr final tail 先于 closed、immediate exit 只发一次 closed、output consumer 提前关闭不导致 close 崩溃。`terminal_manager` 测试数从 24 增至 28。
- 验证通过：
  - `cd src-tauri && cargo test --test terminal_manager pty_session -- --nocapture`：7 passed。
  - `cd src-tauri && cargo test --test terminal_output_pump -- --nocapture`：6 passed。
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：28 passed。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk size warning。
  - `npm run perf:terminal-output`：passed；4 scenarios，max frame gap 16.80 ms，max long task 0.00 ms，报告写入 `.updeng/docs/verification/terminal-output-baseline.json`。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，进程以 0 退出。
- 额外检查：
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump -- -D warnings`：failed，仍失败于既有 `remote_host_service.rs` / `ssh_terminal_service.rs` 的 `too_many_arguments` 和 `workspace_sync_service.rs` 的 `needless_borrows_for_generic_args`，不属于本切片。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed，确认本轮新增代码无新增 lint。
- 下一步：进入 P0-B `TASK-004`，新增 `PtyProcessGuard`，处理 Windows Job Object、ConPTY lifecycle lock、spawn failure kill guard 和 detached drop/orphan guard。

### 2026-06-30T11:47:31+08:00

- 完成 P0-B `TASK-004`：新增 `PtyProcessGuard` 和 `PtyMasterGuard`。本地 PTY child lifecycle、cloned killer、drop kill guard、Windows Job Object `KILL_ON_JOB_CLOSE`、Job assign 软失败和 ConPTY lifecycle lock 已从 `terminal_manager.rs` 中抽到独立深模块。
- 接入生产路径：`create_session_with_secret_input_plan(...)` 用 lifecycle lock 包住 `openpty/spawn`，spawn 后立即建立 guard；reader/writer setup 失败时不再遗留 child。`TerminalSession` 持有 guard/master wrapper，summary 通过 guard 查询 child status，child-exit waiter 继续复用 shared child handle。
- 关闭路径调整：`TerminalManager::close(...)` 仍同步从 session map 移除并清理 cleanup paths；进程 kill、Job Object close 和 master/writer drop 进入 detached thread，避免本地交互式 shell 关闭卡住 Tauri command 或 MCP host。
- 新增测试：`pty_process_guard_drop_kills_running_child_once`、`pty_process_guard_best_effort_kill_is_idempotent`、`pty_process_guard_does_not_kill_already_exited_child`、`pty_process_guard_reports_child_status`、Windows `pty_process_guard_soft_fails_when_child_has_no_raw_handle`，以及 `terminal_manager` 的交互式 session close 快速返回回归。
- 验证通过：
  - `cd src-tauri && cargo test --test pty_process_guard -- --nocapture`：5 passed。
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：29 passed。
  - `cd src-tauri && cargo test --test terminal_output_pump -- --nocapture`：6 passed。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump --test pty_process_guard -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk size warning。
  - `npm run perf:terminal-output`：passed；4 scenarios，max frame gap 16.80 ms，max long task 0.00 ms，报告写入 `.updeng/docs/verification/terminal-output-baseline.json`。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，进程以 0 退出。
- 额外检查：严格 `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump --test pty_process_guard -- -D warnings` 仍失败于既有无关 lint：`remote_host_service.rs` / `ssh_terminal_service.rs` 的 `too_many_arguments` 和 `workspace_sync_service.rs` 的 `needless_borrows_for_generic_args`；本切片显式 allow 这些旧 lint 后通过。
- 下一步：进入 P0-B `TASK-005` WebView reload orphan reaper，只清理本进程内 `TerminalManager` 的 orphan local PTY，并保持 SSH/Telnet/Serial/容器 reconnect 语义不变。

### 2026-06-30T12:06:11+08:00

- 完成 P0-B `TASK-005`：新增 WebView reload orphan reaper。`TerminalManager::reap_orphan_sessions()` 会 drain 当前进程内所有 local PTY session，返回 reaped count、session ids 和 elapsed ms；每个 session 继续走 `close_detached()`，保持 cleanup paths 同步清理、process kill/master drop 后台化。
- Tauri command/API 接入：新增 `terminal_reap_orphan_sessions`、`TerminalSessionReapDiagnostics` 和前端 `reapOrphanTerminalSessions()`；command 层记录 `reaped_count/session_ids/elapsed_ms`，浏览器预览下 no-op 返回 0。
- 前端启动顺序加固：`useWorkspaceSessionPersistence` 新增 `beforeRestore` 钩子，`KerminalShell` 在 workspace session restore 前调用本地 reaper。这样 WebView/HMR reload 后会先清掉旧 local PTY，再恢复 workspace 创建新的 local terminal；reaper 失败只 `console.warn`，继续恢复工作区，不阻断启动。
- 协议边界：本切片只触碰本地 `TerminalManager` 和 workspace restore glue；SSH/Telnet/Serial/container session 仍由各自 service 管理，没有调用它们的 close/reconnect 路径；右栏 Agent terminal 文件未修改，继续保持真实 xterm/PTY 默认体验。
- 测试同步：`KerminalShell.test.tsx` 增加 reaper-before-restore 和 reaper-failure-continues-restore 回归；同步当前空态文案和测试用 xterm mock 的 `attachCustomKeyEventHandler`；保留 SFTP 工具面板/传输工作台 surface 分离断言，不更改生产 SFTP 语义。
- 验证通过：
  - `npm run test -- --run src/lib/terminalApi.test.ts src/app/KerminalShell.test.tsx`：2 files / 44 tests passed。
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：31 passed。
  - `cd src-tauri && cargo test --test pty_process_guard -- --nocapture`：5 passed。
  - `cd src-tauri && cargo test --test terminal_output_pump -- --nocapture`：6 passed。
  - `npm run typecheck`：passed。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump --test pty_process_guard -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed。
  - `npm run perf:terminal-output`：passed；4 scenarios，max frame gap 16.80 ms，max long task 0.00 ms，报告 `.updeng/docs/verification/terminal-output-baseline.json`。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk size warning。
  - `git diff --check`：passed；仅有 Windows CRLF 提示。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，进程以 0 结束。
- 下一步：进入 P1 `TASK-006` local shell integration build command，先设计 shell 枚举/sanitization 和可关闭 fallback，不影响远程输出信任边界。

### 2026-06-30T12:30:27+08:00

- 完成 P1 `TASK-006`：新增 local shell integration launch plan 深模块。`TerminalManager` 仍接收原 `TerminalCreateRequest`，但在构造 `CommandBuilder` 前尝试生成 integrated launch；仅当 shell 匹配 allowlist 且没有 custom args 时启用，否则原样裸 shell 启动。
- 安全与回滚边界：shell/path override 必须 canonicalize 后命中 allowlist；unsupported shell、custom args、`KERMINAL_SHELL_INTEGRATION=off|0|false|disabled`、脚本写入失败都返回 `shellIntegration.status=disabled`，不阻断本地 PTY 启动。远程/容器/Telnet/Serial wrapper 路径保持裸启动。
- 脚本与 summary：PowerShell、Git Bash、WSL bash/zsh/fish、Unix zsh/bash/fish 的脚本写入 Kerminal cache 并原子替换；enabled summary 返回 shell kind 和 script path；TS `TerminalSessionSummary` 与 browser preview 已同步。
- 实际修改文件：`src-tauri/src/services/terminal_shell_integration.rs`、`src-tauri/tests/terminal_shell_integration.rs`、`src-tauri/src/models/terminal.rs`、`src-tauri/src/services/terminal_manager.rs`、`src-tauri/src/services/mod.rs`、`src-tauri/src/state.rs`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src/lib/terminalApi.ts`、`src/lib/terminalApi.test.ts`。
- 验证通过：
  - `cd src-tauri && cargo test --test terminal_shell_integration -- --nocapture`：8 passed。
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：31 passed。
  - `cd src-tauri && cargo test --test terminal_output_pump -- --nocapture`：6 passed。
  - `cd src-tauri && cargo test --test pty_process_guard -- --nocapture`：5 passed。
  - `npm run test -- --run src/lib/terminalApi.test.ts src/app/KerminalShell.test.tsx`：2 files / 44 tests passed。
  - `npm run typecheck`：passed。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump --test pty_process_guard --test terminal_shell_integration -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed。
  - `npm run perf:terminal-output`：passed；4 scenarios，max frame gap 33.30 ms，max long task 0.00 ms，报告 `.updeng/docs/verification/terminal-output-baseline.json`。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk size warning。
  - `git diff --check`：passed；仅有 Windows CRLF 提示。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，进程以 0 结束。
- 下一步：进入 P1 `TASK-007` 前端 `ShellIntegrationState` 和 OSC handler，只对 `shellIntegration.enabled` 的 local shell 信任 OSC 7/133，保留 remote/container heuristic fallback。

### 2026-06-30T12:48:15+08:00

- 完成 P1 `TASK-007`：新增前端 `ShellIntegrationState` 纯模型和 xterm `OSC 7` / `OSC 133` handler 接线。状态机覆盖 `prompt | typing | running | alt`；`OSC 133 C` 进入 running，`D/A/B` 回 prompt，输入提交进入 running，alternate buffer 期间进入 alt。
- 信任边界：`XtermPane.runtime.ts` 只在本地 session 且 `session.shellIntegration.status === "enabled"` 时信任 OSC 7/133；`OSC 7` 在 running/alt/disabled 状态下不更新 cwd，避免命令输出窗口里的 cwd spoof。remote/container 仍走 `collectCurrentDirOscSequences(...)` untrusted heuristic fallback，本地 integrated shell 不再走该 fallback。
- 路径解析：支持 `file://host/path`、`file:///C:/...`、直接 `/C:/...` 和 MSYS `/c/...`，拒绝 relative path、控制字符、超长 path、malformed percent URI、带 user/password/search/hash 的 file URI。
- 测试同步：`XtermPane.testSupport` mock parser 增加 `registerOscHandler/triggerOsc`，默认 session summary 补 `shellIntegration=disabled`；`XtermPane.contextMenu.test.tsx` 两个 reconnect 断言同步当前 fit 后 100x30 create request 行为，不改生产 reconnect 逻辑。
- 实际修改文件：`src/features/terminal/terminalShellIntegrationModel.ts`、`src/features/terminal/terminalShellIntegrationModel.test.ts`、`src/features/terminal/XtermPane.runtime.ts`、`src/features/terminal/XtermPane.sessionTargets.test.tsx`、`src/features/terminal/XtermPane.contextMenu.test.tsx`、`src/features/terminal/__tests__/support/XtermPane.testSupport.tsx`。
- 验证通过：
  - `npm run test -- --run src/features/terminal/terminalShellIntegrationModel.test.ts src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/terminal/XtermPane.inputCompatibility.test.tsx`：3 files / 31 tests passed。
  - `npm run test -- --run src/features/terminal/XtermPane.contextMenu.test.tsx src/features/terminal/XtermPane.realXtermCompatibility.test.ts src/features/terminal/terminalShellIntegrationModel.test.ts src/features/terminal/XtermPane.sessionTargets.test.tsx`：4 files / 36 tests passed。
  - `npm run test -- --run src/lib/terminalApi.test.ts src/app/KerminalShell.test.tsx src/features/terminal/terminalShellIntegrationModel.test.ts src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/terminal/XtermPane.contextMenu.test.tsx`：5 files / 76 tests passed。
  - `npm run typecheck`：passed。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk-size warnings。
  - Vite dev server smoke：`npm run dev -- --host 127.0.0.1 --port 1451` 后 `Invoke-WebRequest http://127.0.0.1:1451/` 返回 200；1451 server 已停止。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，命令退出码 0。
  - `git diff --check`：passed；仅有 Windows CRLF 提示。
- 说明：Vitest 运行 real xterm/jsdom 相关用例时仍会输出一次 `HTMLCanvasElement.getContext()` not implemented 提示，但测试退出码为 0；这不是本轮新增失败。
- 下一步：进入 P1 `TASK-008`，把命令块从启发式升级为 integrated shell 协议优先，同时保留 non-integrated fallback 和 Agent terminal `shellAssistEnabled=false` 边界。

### 2026-06-30T13:17:26+08:00

- 完成 P1 `TASK-008`：命令块从输入启发式升级为 trusted local shell integration 协议优先。integrated session 中输入模型只缓存待提交 command 并继续记录 history，真正 command block 创建延迟到 `OSC 133 C`；non-integrated session 继续走原 input model + prompt heuristic fallback。
- 输出顺序加固：新增 `collectTerminalShellIntegrationOsc133Segments(...)`，在写入 xterm 前按 `OSC 133` marker 和 data 分段，先处理 `C` 再把同一 data event 内后续输出 append 到 block，避免首段输出丢失；`D` 后停止收集 prompt 文本，parser 回调补 end marker。`A/B` 用 protocol prompt marker 更新当前 prompt block。
- shell integration 脚本同步：PowerShell `AddToHistoryHandler`、bash DEBUG preexec、zsh preexec、fish preexec 都改为发送 `OSC 133;C;<sanitized command>`；前端 parser 清洗控制字符并限制命令长度，输入 pending command 仍作为无 payload fallback。
- Agent 边界：`shellAssistEnabled=false` 的右栏 Agent terminal 即使收到 local enabled shell integration OSC，也不会创建 command block、不会记录 command history、不会触发 ghost suggestion；默认真实 xterm/PTY 体验未恢复 composer/queue。
- 实际修改文件：`src/features/terminal/terminalShellIntegrationModel.ts`、`src/features/terminal/terminalShellIntegrationModel.test.ts`、`src/features/terminal/XtermPane.runtime.ts`、`src/features/terminal/XtermPane.tsx`、`src/features/terminal/XtermPane.sessionTargets.test.tsx`、`src/features/terminal/terminalCommandBlockLifecycle.ts`、`src-tauri/src/services/terminal_shell_integration.rs`、`src-tauri/tests/terminal_shell_integration.rs`。
- 验证通过：
  - `npm run test -- --run src/features/terminal/terminalShellIntegrationModel.test.ts src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/terminal/terminalCommandBlocks.test.ts`：3 files / 50 tests passed。
  - `cd src-tauri && cargo test --test terminal_shell_integration -- --nocapture`：9 passed。
  - `npm run test -- --run src/features/terminal/XtermPane.contextMenu.test.tsx src/features/terminal/XtermPane.realXtermCompatibility.test.ts src/features/terminal/XtermPane.inputCompatibility.test.tsx src/features/terminal/terminalShellIntegrationModel.test.ts src/features/terminal/XtermPane.sessionTargets.test.tsx`：5 files / 53 tests passed。
  - `npm run test -- --run src/lib/terminalApi.test.ts src/app/KerminalShell.test.tsx src/features/terminal/terminalShellIntegrationModel.test.ts src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/terminal/XtermPane.contextMenu.test.tsx`：5 files / 80 tests passed。
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：31 passed。
  - `npm run typecheck`：passed。
  - `cd src-tauri && cargo test --test terminal_output_pump -- --nocapture`：6 passed。
  - `cd src-tauri && cargo test --test pty_process_guard -- --nocapture`：5 passed。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump --test pty_process_guard --test terminal_shell_integration -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed；allow 项仍是既有无关 lint。
  - `npm run perf:terminal-output`：passed；4 scenarios，max frame gap 16.70 ms，max long task 0.00 ms，报告 `.updeng/docs/verification/terminal-output-baseline.json`。
  - `git diff --check`：passed；仅有 Windows CRLF 提示。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk-size warnings。
  - Vite dev server smoke：`npm run dev -- --host 127.0.0.1 --port 1452` 后 `Invoke-WebRequest http://127.0.0.1:1452/` 返回 200；1452 server 已停止。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，命令退出码 0。
- 说明：Vitest 运行 real xterm/jsdom 相关用例仍输出一次 `HTMLCanvasElement.getContext()` not implemented 提示，但退出码为 0；不是本轮新增失败。
- 下一步：进入 P1 `TASK-009`，定义 Kerminal Agent OSC marker 和 detector；继续保持 Agent terminal 默认真实 xterm/PTY，不恢复 composer/queue 主界面。

### 2026-06-30T13:30:59+08:00

- 完成 P1 `TASK-009`：新增 Kerminal Agent OSC marker/detector 纯 Rust 模块。协议 marker 为 `OSC 777;notify;Kerminal;<agent>;<event>`，当前 known agent 为 `codex|claude|gemini`，event 为 `working|attention|finished`；`finish_pty()` 会把已 armed agent 转为 `exited`。
- 检测边界：Detector 只消费 OSC 序列，不从普通输出文本或 TUI repaint 推断状态；支持 BEL/ST 终止、split OSC buffer 和 oversized OSC cap；unknown marker 与 unknown `OSC 133;C;<cmd>` 不 self-arm，未 armed 时 `OSC 9` attention 不产出状态。`OSC 133;C;<cmd>` 可从 quoted/path/env/sudo/command/exec wrapper 中识别 known agent 启动。
- 本轮只定义 detector 和测试，不把状态混进 `TerminalOutputEvent.data`，也不接右栏 Agent UI/MCP snapshot；这些属于下一步 `TASK-010`。右栏 Agent terminal 默认仍是真实 xterm/PTY，没有恢复 composer/queue。
- 实际修改文件：`src-tauri/src/services/terminal_agent_signal_detector.rs`、`src-tauri/tests/terminal_agent_signal_detector.rs`、`src-tauri/src/services/mod.rs`、`.updeng/docs/coordination/lanes.json`。
- 验证通过：
  - `cd src-tauri && cargo test --test terminal_agent_signal_detector -- --nocapture`：7 passed。
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：31 passed。
  - `cd src-tauri && cargo test --test terminal_shell_integration -- --nocapture`：9 passed。
  - `cd src-tauri && cargo test --test terminal_output_pump -- --nocapture`：6 passed。
  - `cd src-tauri && cargo test --test pty_process_guard -- --nocapture`：5 passed。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump --test pty_process_guard --test terminal_shell_integration --test terminal_agent_signal_detector -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed；allow 项仍是既有无关 lint。
  - `npm run typecheck`：passed。
  - `npm run perf:terminal-output`：passed；4 scenarios，max frame gap 16.80 ms，max long task 0.00 ms，报告 `.updeng/docs/verification/terminal-output-baseline.json`。
  - `git diff --check`：passed；仅有 Windows CRLF 提示。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk-size warnings。
  - Vite dev server smoke：`npm run dev -- --host 127.0.0.1 --port 1453` 后 `Invoke-WebRequest http://127.0.0.1:1453/` 返回 200；1453 server 已停止。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，命令退出码 0。
- 下一步：进入 P1 `TASK-010`，把 Agent signal 作为 typed event 接入 Agent Launcher 和 MCP runtime snapshot；仍不得混入 terminal data 流，不恢复 composer/queue 主界面。

### 2026-06-30T14:11:35+08:00

- 完成 P1 `TASK-010`：Agent signal 已作为 typed event 从 Rust PTY reader/flusher 接入前端 Agent Launcher 和 MCP runtime snapshot。`TerminalOutputKind::AgentSignal` 不进入 terminal data、xterm writer、output history、command block、snapshot buffer 或日志。
- Rust 接线：`TerminalAgentKind` / `TerminalAgentStatus` / `TerminalAgentSignal` / `TerminalAgentSignalSummary` 迁入 `models::terminal` 并由 detector re-export 兼容测试入口；`TerminalManager` 在 secret redaction 后运行 `TerminalAgentSignalDetector::observe_and_filter`，只过滤 `OSC 777;notify;Kerminal;...` marker。Detector 状态由 reader 和 child-exit waiter 共享，EOF 与 child-exit timeout 都通过同一个 `finish_pty()` 发送一次 `exited`。
- 前端接线：`terminalApi.ts` 同步 typed signal；`XtermPane` 新增 `onAgentSignal`，runtime 先处理 `agentSignal` 再 return，避免落入 data/closed/error 分支。`AgentLauncherToolContent` 用 `agentSessionId` 更新对应右栏 Agent session，header 增加轻量状态 badge；右栏 Agent terminal 继续 `shellAssistEnabled=false`，并显式传 `inputCompatibilityMode="agentTui"`，没有恢复 composer、queue、history、prompt toolbar 或 Kerminal 自有聊天 runtime。
- MCP 接线：`kerminal.runtime_snapshot` 在 `terminalSessions[]`、`agentSessions[]` 和 entities 中携带 live `agentSessionId` / `agentSignal`；映射来自当前 live terminal summary，不写入 Agent session TOML。`kerminal.agent.target_context` 的 structured result 会通过 `TerminalSessionSummary` 自然带出最新 signal；`context/terminal-snapshot.json` 文件格式本轮未扩展，避免扩大持久化契约。
- 实际修改文件：`src-tauri/src/models/terminal.rs`、`src-tauri/src/services/terminal_agent_signal_detector.rs`、`src-tauri/src/services/terminal_manager.rs`、`src-tauri/src/services/mcp_tool_executor_service/diagnostics_tools.rs`、`src-tauri/tests/terminal_manager.rs`、`src-tauri/tests/terminal_output_pump.rs`、`src/lib/terminalApi.ts`、`src/lib/terminalApi.test.ts`、`src/features/terminal/XtermPane.tsx`、`src/features/terminal/XtermPane.runtime.ts`、`src/features/terminal/XtermPane.sessionTargets.test.tsx`、`src/features/tool-panel/AgentLauncherToolContent.tsx`、`src/features/tool-panel/AgentLauncherToolContent.test.tsx`。
- 验证通过：
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：32 passed。
  - `cd src-tauri && cargo test --test terminal_agent_signal_detector -- --nocapture`：7 passed。
  - `cd src-tauri && cargo test --test terminal_output_pump -- --nocapture`：6 passed。
  - `cd src-tauri && cargo test --test mcp_streamable_http_server generated_codex_and_claude_configs_connect_to_tools_list -- --nocapture`：1 passed。
  - `npm run test -- --run src/lib/terminalApi.test.ts src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/tool-panel/AgentLauncherToolContent.test.tsx`：3 files / 50 tests passed。
  - `npm run typecheck`：passed。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump --test pty_process_guard --test terminal_shell_integration --test terminal_agent_signal_detector --test mcp_streamable_http_server -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed；allow 项仍为既有无关 lint。
  - `npm run perf:terminal-output`：passed；4 scenarios，max frame gap 16.80 ms，max long task 0.00 ms，报告 `.updeng/docs/verification/terminal-output-baseline.json`。
  - `git diff --check`：passed；仅有 Windows CRLF 提示。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk-size warnings。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，命令退出码 0。
- 剩余风险：真实 Codex/Claude CLI 是否主动发 Kerminal `OSC 777` marker 仍取决于后续 wrapper/hook 或 CLI 支持；当前实现已支持 `OSC 133;C;<cmd>` self-arm 和 `OSC 9` attention fallback，但真实 prompt 交互 smoke 仍沿用 blocked Agent terminal 兼容计划的 HITL 口径。
- 下一步：进入 P2 `TASK-011`，评估 `TerminalEscapeResponder` 最小 DA/DSR responder，优先用状态机测试约束 escape query/response 边界。

### 2026-06-30T14:28:01+08:00

- 完成 P2 `TASK-011`：新增 `TerminalEscapeResponder` 最小 DA/DSR responder，并接入本地 `TerminalManager` reader pipeline。后端只过滤并代答 DA1、DA2 和启动期 CPR query，不把 response 写入 terminal data/log/snapshot；已有 visible output 后的 `ESC[6n` 会原样交给前端 renderer，避免后端长期抢占真实终端协议。
- 状态机边界：支持 split CSI、OSC passthrough、response no-loop、runaway incomplete CSI cap；`OSC 777` Agent marker 与其它 OSC payload 不会被误判为 visible output，因此不会提前关闭启动期 CPR 窗口。
- 集成验证：`terminal_manager` 新增 Node raw TTY harness，子进程输出 `ESC[6n` 后读取 PTY input；测试端不模拟 xterm 回包，只有后端 responder 写回 `ESC[1;1R` 才输出 `kerminal-cpr-ok`。首次 PowerShell harness 因未进入 raw input 导致 response 被 echo 为 `^[[1;1R`，已改为 raw TTY harness；真实 PowerShell 启动兼容仍由 `npm run tauri:dev` 和后续人工 shell matrix 补强。
- 实际修改文件：`src-tauri/src/services/terminal_escape_responder.rs`、`src-tauri/src/services/mod.rs`、`src-tauri/src/services/terminal_manager.rs`、`src-tauri/tests/terminal_escape_responder.rs`、`src-tauri/tests/terminal_manager.rs`。
- 验证通过：
  - `cd src-tauri && cargo test --test terminal_escape_responder --test terminal_manager --test terminal_output_pump --test terminal_agent_signal_detector -- --nocapture`：52 passed。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_output_pump --test pty_process_guard --test terminal_shell_integration --test terminal_agent_signal_detector --test terminal_escape_responder --test mcp_streamable_http_server -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed；allow 项仍为既有无关 lint。
  - `npm run typecheck`：passed。
  - `npm run perf:terminal-output`：passed；4 scenarios，max frame gap 31.94 ms，max long task 0.00 ms，报告 `.updeng/docs/verification/terminal-output-baseline.json`。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk-size warnings。
  - `git diff --check`：passed；仅有 Windows CRLF 提示。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，命令退出码 0。
- 剩余风险：本轮没有为 PowerShell/PSReadLine 做人工交互 smoke；自动化用 raw TTY harness 证明 hidden renderer/rebind 类 CPR 卡住问题已由后端 responder 覆盖。下一步进入 P2 `TASK-012` Raw input IPC 性能评估，先测现有 JSON invoke，不先改 API。

### 2026-06-30T14:39:10+08:00

- 完成 P2 `TASK-012`：新增 `perf:terminal-input` 输入 JSON payload 基线，先测现有 `writeTerminal(sessionId, data)` 的 JSON payload 成本，不新增 raw IPC、不改 Tauri command API、不触碰 SSH/serial/container write path。
- 基线数据：`.updeng/docs/verification/terminal-input-baseline.json` 覆盖 single key、Agent Shift+Enter LF、IME Unicode composition、paste 1 KiB、paste 64 KiB、paste 1 MiB。最差场景为 1 MiB paste：stringify p95 约 2.65 ms，parse p95 约 1.33 ms，JSON expansion ratio 约 1.05，所有场景通过阈值。
- 前端契约：`XtermPane.inputCompatibility.test.tsx` 增加 8 KiB `onData` 单次透传测试，确认较大 xterm input payload 仍只调用一次 `writeTerminal`。1 MiB/64 KiB 组件级测试曾导致 Vitest 超时，说明常规组件测试不适合承担性能压测；对应规模由脚本报告覆盖。
- 结论：当前证据不支持引入 raw IPC。若未来真实 WebView/Tauri invoke smoke 显示明显输入卡顿，再开新切片测完整 IPC latency 并限定 local PTY raw write path；本计划保持现有 JSON invoke API。
- 实际修改文件：`scripts/perf-terminal-input.mjs`、`package.json`、`src/features/terminal/XtermPane.inputCompatibility.test.tsx`。
- 验证通过：
  - `npm run perf:terminal-input`：6 scenarios passed，报告 `.updeng/docs/verification/terminal-input-baseline.json`。
  - `npm run test -- --run src/features/terminal/XtermPane.inputCompatibility.test.tsx`：14 passed。
  - `npm run typecheck`：passed。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk-size warnings。
  - `git diff --check`：passed；仅有 Windows CRLF 提示。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，命令退出码 0。
- 剩余风险：本轮脚本是 Node 侧 JSON payload 代理基线，不是完整 WebView/Tauri IPC latency；真实 invoke latency 仍由 `tauri:dev` 冒烟和后续手工输入/粘贴 smoke 兜底。计划内实现任务已全部勾选，下一步应做完成审计：核对验收标准、shell/Agent HITL 缺口、lane checkpoint 和是否移动计划状态。

### 2026-06-30T14:45:00+08:00

- 完成审计结论：实现任务 `TASK-001`~`TASK-012` 已全部勾选并有对应自动化/启动证据，但计划暂不移动到 `done/`，也不宣称整个目标完成。原因是验收标准里仍有真实交互矩阵和 Agent CLI HITL 缺口，当前证据不足以逐项证明。
- 已有强证据：
  - 输出泵/backpressure/final tail：`terminal_output_pump` synthetic baseline 覆盖 1 byte、1 KiB、64 KiB、16 MiB、100 MiB；`terminal_manager` 覆盖 short tail、stderr tail、closed once、consumer closed；`perf:terminal-output` 前端 xterm 写入基线通过。
  - 本地 PTY 生命周期：`pty_process_guard`、`terminal_manager` close/reaper tests、`npm run tauri:dev` 启动冒烟通过。
  - Shell integration 和 OSC trust：`terminal_shell_integration`、`terminalShellIntegrationModel`、`XtermPane.sessionTargets` / command block tests 已覆盖 enabled-local-only、running/alt spoof rejection 和 protocol-first command block。
  - Agent signal：`terminal_agent_signal_detector`、`terminal_manager` marker-through-PTY、AgentLauncher/XtermPane/terminalApi/MCP snapshot tests 已覆盖 typed event、不混入 data/log/snapshot。
  - DA/DSR：`terminal_escape_responder` pure tests 和 Node raw TTY hidden-renderer integration test 已覆盖后端代答启动期 CPR。
  - Raw input IPC：`perf:terminal-input` 显示当前 JSON payload 成本不足以支持新增 raw IPC，且 8 KiB xterm input payload 单次透传测试通过。
- 证据不足或待 HITL：
  - 真实 PowerShell/PSReadLine、Git Bash、WSL、bash/zsh/fish 的完整交互 smoke 尚未逐项跑完；本机入口探测显示 `pwsh 7.6.3`、`bash.exe`、`wsl Ubuntu-22.04`、`git.exe` 和 `node.exe` 可用，但这只是环境可用性，不是终端交互验收。
  - `vim/less/top/tmux`、中文路径、IME composition、paste、resize、alternate screen、Ctrl+C/Ctrl+D 的真实桌面交互矩阵尚未形成截图/日志证据。
  - Codex/Claude 真实 prompt 多行、Ctrl+C、Esc、Tab/Shift+Tab、paste、resize 仍沿用 blocked 计划 `PLAN-20260626-155809-agent-terminal-production-compat.md` 的 HITL 口径。
  - 完整 WebView/Tauri invoke latency 没有专门 benchmark；本轮只有 Node JSON payload proxy 和 `tauri:dev` smoke。
- 下一步建议：保持本计划 active，补一个收尾验证切片或复用 blocked Agent terminal 计划完成真实交互矩阵；通过后再移动到 `plan/done/` 并更新 `INDEX.md` / `in-progress.md` / `lanes.json`。

### 2026-06-30T14:49:54+08:00

- 文档台账同步：`TASK-013` 已同步到 `plan/INDEX.md`、`in-progress.md` 和 `coordination/lanes.json`。
- `lanes.json` 已把 `src-tauri/tests/terminal_interaction_matrix.rs` 登记为本 lane owned path；下一步只实现这个自动化验证切片，不扩大到真实 Codex/Claude prompt 或 `vim/less/top/tmux` 人工 HITL。

### 2026-06-30T15:03:54+08:00

- 完成 P3 `TASK-013`：新增 `src-tauri/tests/terminal_interaction_matrix.rs`，使用真实 `TerminalManager` 本地 PTY 会话覆盖本机 shell 交互矩阵。
- 矩阵结果：`cmd`、PowerShell 7、Windows PowerShell、Git Bash 和 WSL bash 全部 passed，skipped 为空。每个 shell 至少覆盖 alternate screen enter/exit、bracketed paste、Unicode input、resize 调用、Ctrl+C 和 Ctrl+D；Node harness shell 还观察到 child resize event，WSL bash 通过 manager summary 验证 resize 调用。
- 实际修改文件：`src-tauri/tests/terminal_interaction_matrix.rs`。
- 验证通过：
  - `cd src-tauri && cargo fmt --check`：passed。
  - `cd src-tauri && cargo test --test terminal_interaction_matrix -- --nocapture`：1 passed；matrix summary `cmd,powershell-7,windows-powershell,git-bash,wsl-bash`，skipped 为空。
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：33 passed。
  - `cd src-tauri && cargo test --test terminal_output_pump --test pty_process_guard --test terminal_shell_integration --test terminal_agent_signal_detector --test terminal_escape_responder -- --nocapture`：33 passed。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_interaction_matrix --test terminal_output_pump --test pty_process_guard --test terminal_shell_integration --test terminal_agent_signal_detector --test terminal_escape_responder --test mcp_streamable_http_server -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed；allow 项仍为既有无关 lint。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk-size warnings。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`。
  - `git diff --check`：passed；仅有 Windows CRLF 提示。
- 完成审计更新：计划内自动化实现与自动化验证任务 `TASK-001`~`TASK-013` 已全部完成；仍不能移动 `done`，因为真实 Codex/Claude prompt 多行、Ctrl+C、Esc、Tab/Shift+Tab、paste、resize，以及实际 `vim/less/top/tmux` 人工交互证据仍按 HITL/blocked 口径等待。
- Lane checkpoint：已运行 `node .codex/hooks/lane-coordination.cjs checkpoint lane-pty-stability-hardening-20260630 C:\dev\rust\kerminal`，写入 `.updeng/docs/coordination/checkpoints/lane-pty-stability-hardening-20260630.json`；本次 checkpoint 覆盖 44 个 lane 路径、26 个 tracked patch paths。

### 2026-06-30T15:10:30+08:00

- 新增 P3 `TASK-014`：本机 WSL 探测显示 `vim=/usr/bin/vim`、`less=/usr/bin/less`、`tmux=/usr/bin/tmux`、`top=/usr/bin/top` 均可用，因此把 blocker 中“实际 `vim/less/top/tmux` 交互证据”转成可自动化真实 PTY smoke。
- 下一步只新增 `src-tauri/tests/terminal_tui_program_matrix.rs`，仍不触碰生产 PTY 路径；Codex/Claude 真实 prompt 继续保留 HITL。

### 2026-06-30T15:17:01+08:00

- 完成 P3 `TASK-014`：新增 `src-tauri/tests/terminal_tui_program_matrix.rs`，使用真实 `TerminalManager` 本地 PTY 会话通过 WSL bash 启动实际 TUI 程序 `vim`、`less`、`top`、`tmux`。
- 矩阵结果：`vim`、`less`、`top`、`tmux` 全部 passed，skipped 为空。交互序列分别为 `:q!\r`、`q`、`q`、`Ctrl+B d`，每个 case 均验证 ready marker、程序输出 marker、exit marker 和会话未卡死。
- 实际修改文件：`src-tauri/tests/terminal_tui_program_matrix.rs`。
- 验证通过：
  - `cd src-tauri && cargo fmt --check`：passed。
  - `cd src-tauri && cargo test --test terminal_tui_program_matrix -- --nocapture`：1 passed；matrix summary `vim,less,top,tmux`，skipped 为空。
  - `cd src-tauri && cargo test --test terminal_interaction_matrix -- --nocapture`：1 passed；matrix summary `cmd,powershell-7,windows-powershell,git-bash,wsl-bash`，skipped 为空。
  - `cd src-tauri && cargo test --test terminal_manager -- --nocapture`：33 passed。
  - `cd src-tauri && cargo test --test terminal_output_pump --test pty_process_guard --test terminal_shell_integration --test terminal_agent_signal_detector --test terminal_escape_responder -- --nocapture`：33 passed。
  - `cd src-tauri && cargo clippy --test terminal_manager --test terminal_interaction_matrix --test terminal_tui_program_matrix --test terminal_output_pump --test pty_process_guard --test terminal_shell_integration --test terminal_agent_signal_detector --test terminal_escape_responder --test mcp_streamable_http_server -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed；allow 项仍为既有无关 lint。
  - `git diff --check`：passed；仅有 Windows CRLF 提示。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk-size warnings。
  - `npm run tauri:dev`：passed；Vite ready，Rust dev profile 编译完成并运行 `target\debug\kerminal.exe`，命令退出码 0。
- 完成审计更新：计划内自动化实现与自动化验证任务 `TASK-001`~`TASK-014` 已全部完成。计划仍保持 active，唯一剩余生产验收缺口是真实 Codex/Claude prompt 多行、Ctrl+C、Esc、Tab/Shift+Tab、paste、resize 的账号态/HITL smoke；`vim/less/top/tmux` 已由自动化真实 PTY smoke 覆盖，不再列为本计划 blocker。

### 2026-06-30T15:26:12+08:00

- 完成 P3 `TASK-015`：新增 `src-tauri/tests/terminal_agent_cli_hitl_matrix.rs` 作为 Codex/Claude 真实 CLI HITL harness。默认不启动真实 Agent TUI，只有设置 `KERMINAL_AGENT_CLI_HITL=1` 才执行真实 CLI 预检；只有额外设置 `KERMINAL_AGENT_CLI_HITL_ALLOW_SUBMIT=1` 才提交最小 prompt。
- 本机 CLI 探测：`codex` 来自 `C:\dev\js\nodejs\codex.ps1`，版本 `codex-cli 0.142.2`；`claude` 来自 `C:\dev\js\nodejs\claude.ps1`，版本 `2.1.195 (Claude Code)`。`codex --help` / `claude --help` 仅用于确认 CLI 入口，不作为真实 prompt 验收。
- 新增人工验收入口：`.updeng/docs/verification/agent-cli-hitl-smoke.md` 记录默认安全检查、真实 CLI 预检、真实提交验收和右栏 UI 手工复验步骤。
- 验证通过：
  - `Get-Command codex,claude`：两者均存在于 `C:\dev\js\nodejs\*.ps1`。
  - `codex --version`：`codex-cli 0.142.2`。
  - `claude --version`：`2.1.195 (Claude Code)`。
  - `codex --help | Select-Object -First 80`：passed。
  - `claude --help | Select-Object -First 80`：passed。
  - `cd src-tauri && cargo test --test terminal_agent_cli_hitl_matrix -- --nocapture`：1 passed；默认 `codex`、`claude` 均 skipped，未启动真实 CLI。
  - `cd src-tauri && cargo fmt --check`：passed。
  - `cd src-tauri && cargo clippy --test terminal_agent_cli_hitl_matrix -- -A clippy::too_many_arguments -A clippy::needless_borrows_for_generic_args -D warnings`：passed；allow 项仍为既有无关 lint。
  - `Get-Content -Raw .updeng/docs/coordination/lanes.json | ConvertFrom-Json`：passed。
  - `git diff --check -- <TASK-015 touched files>`：passed。
  - `npm run build`：passed；仅有既有 Vite dynamic import/chunk-size warnings。
- 完成审计更新：HITL harness 已具备可复跑入口，但真实 Codex/Claude prompt 预检和提交验收仍未执行，因为这会进入账号/网络/模型服务链路，按项目规则需要用户明确授权。计划仍保持 active，`BLK-20260630-001` 继续 open。

### 2026-06-30T15:36:48+08:00

- 状态收口：本计划已从 `plan/active/` 移动到 `plan/blocked/`，frontmatter 状态改为 `blocked`。
- 完成范围：本地自动化实现与验证 `TASK-001`~`TASK-015` 已全部完成并记录证据；`terminal_interaction_matrix`、`terminal_tui_program_matrix`、默认安全的 `terminal_agent_cli_hitl_matrix`、`cargo fmt --check`、聚焦 clippy 和 `npm run build` 等门禁均已通过，真实 Agent CLI 默认不启动。
- 阻塞原因：剩余唯一验收项是真实 Codex/Claude prompt 的账号态、网络和模型服务 HITL smoke，包括多行、Ctrl+C、Esc、Tab/Shift+Tab、paste、resize；该步骤需要用户授权执行 `.updeng/docs/verification/agent-cli-hitl-smoke.md`。
- 收口口径：用户授权并通过 HITL smoke 后，再把本计划移动到 `plan/done/`；否则保持 blocked，不宣称目标完全完成。

### 2026-06-30T18:13:19+08:00

- 用户完成真实右栏 Agent UI 复验并确认可关闭目标。
- Codex 复验结论：`Alt+Enter` 是当前 Codex TUI 的可用换行方式；图片粘贴正常。该差异属于 Codex CLI 快捷键行为，不是 Kerminal PTY 稳定性问题。
- Claude 复验结论：`Ctrl+J` 是当前 Claude Code TUI 的可用换行方式；图片粘贴需使用 `Alt+V`，验证可用。`Ctrl+V` 图片粘贴不可用属于 Claude Code/终端宿主快捷键差异，不作为 Kerminal blocker。
- 自动化与真实 UI 复验合并结论：`TASK-001`~`TASK-015` 已完成，真实 Agent TUI 的多行输入和图片粘贴关键路径已按各 CLI 实际快捷键通过；`BLK-20260630-001` 可关闭，本计划移动到 `plan/done/`。
