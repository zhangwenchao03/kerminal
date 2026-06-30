---
id: PLAN-20260625-231610-agent-launch-pwsh
status: done
created_at: 2026-06-25T23:16:10+08:00
started_at: 2026-06-25T23:16:10+08:00
completed_at: 2026-06-26T00:06:35+08:00
updated_at: 2026-06-26T00:27:14+08:00
owner: ai
lane: lane-agent-launch-pwsh
---

# 外部 Agent CLI Windows pwsh 启动策略

## 目标
- Kerminal 右侧 AI 助手在 Windows 启动 Codex、Claude 或自定义 Agent CLI 时，优先使用 PowerShell 7 `pwsh.exe` 作为交互 shell。
- 若 `pwsh.exe` 不可用，退到系统 `powershell.exe`；两者都不可用时才保留现有 `cmd.exe /d /s /k <command>` 兼容路径。
- 保留 `codex resume --last`、Claude 默认命令、自定义命令和 session-scoped env 的现有行为。
- 同步前端权限跳过参数注入和命令展示逻辑，使 `pwsh.exe -NoLogo -NoProfile -NoExit -Command <command>` 这种包装形态能把参数插入真实 CLI 命令，而不是插到 shell 参数前面。
- 同步生成的全局/会话级 `AGENTS.md` 与 `CLAUDE.md`：配置校验入口改为 Kerminal MCP 只读工具，不再把源代码仓库里的 Node validator 写进用户运行时 workspace。
- 新增 MCP 只读配置校验工具，用 Kerminal 运行时代码校验 `settings.toml`、`profiles/*.toml`、`hosts/groups.toml`、`hosts/*.toml`、`snippets/*.toml`、`workflows/*.toml`，让分发用户无需安装 Node 或拥有源码 checkout。
- 修复 AI 助手添加主机后产生的无效 host 配置：host TOML 缺少 `production` 时按 `false` 容错加载，同时文档仍建议显式写出 `production`。
- 清理生成模板和面向用户的运行时文案，避免固定本机路径、源码目录或用户机器不存在的校验脚本。
- 运行与改动范围匹配的 Rust、前端、构建和启动验证，确保变更可交付。

## 非目标
- 本轮不新增设置项，不做 `cmd` / `pwsh` / 自定义 shell 的用户偏好 UI。
- 本轮不重新引入 settings/profile/host/snippet/workflow 的 MCP CRUD；新增工具只做只读校验。
- 本轮不改普通本地终端 profile 的默认 shell，也不改 SSH、Docker、tmux、SFTP 等并行 lane。
- 本轮不修改用户真实 `~/.kerminal` 配置或凭据。

## 当前事实
- 现有 `agent_launch_command()` 在 Windows 固定输出 `cmd.exe` 和 `["/d", "/s", "/k", command]`。
- `session.toml` 中最新 Codex session 的 `[launch] shell = "cmd.exe"`，说明当前右栏 AI 助手确实经 `cmd` 启动。
- 前端 `applyAgentLaunchPermissionMode()`、`formatLaunchCommand()` 目前只特殊识别 `cmd.exe /d /s /k`，改 Rust 输出后必须同步。
- 本机已能解析 `pwsh.exe`：`C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.3.0_x64__8wekyb3d8bbwe\pwsh.exe`。
- 并行 lane `lane-external-agent-prompt-config-redesign` 已拥有 `src-tauri/src/services/external_agent_workspace.rs` 和 `src-tauri/tests/external_agent_workspace.rs`；本轮将这两个文件登记为 shared path，只做启动策略最小改动。

## 影响范围
- Rust 启动 spec：
  - `src-tauri/src/services/external_agent_workspace.rs`
  - `src-tauri/tests/external_agent_workspace.rs`
- Rust 配置加载与校验：
  - `src-tauri/src/storage/config_file_store.rs`
  - `src-tauri/tests/config_file_store.rs`
  - `src-tauri/src/services/mcp_tool_catalog_service/catalog.rs`
  - `src-tauri/src/services/mcp_tool_catalog_service/catalog/foundation.rs`
  - `src-tauri/src/services/mcp_tool_executor_service.rs`
  - `src-tauri/src/services/mcp_tool_executor_service/execution.rs`
  - `src-tauri/src/services/mcp_tool_executor_service/config_tools.rs`
  - `src-tauri/tests/mcp_tool_executor_service.rs`
  - `src-tauri/tests/mcp_streamable_http_server.rs`
- 运行时配置文档源：
  - `.updeng/docs/config/external-agent-workspace.md`
  - `.updeng/docs/config/kerminal-config-files.md`
  - `.codex/skills/bwy-kerminal-config-files/SKILL.md`
- 前端启动展示和权限模式：
  - `src/features/tool-panel/agent-launcher/agentLauncherModel.ts`
  - `src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts`
  - `src/features/tool-panel/AgentLauncherToolContent.tsx`
  - `src/features/tool-panel/AgentLauncherToolContent.test.tsx`
- Updeng 协调：
  - `.updeng/docs/plan/done/PLAN-20260625-231610-agent-launch-pwsh.md`
  - `.updeng/docs/plan/INDEX.md`
  - `.updeng/docs/in-progress.md`
  - `.updeng/docs/coordination/lanes.json`

## 实施方案
- 在 Rust Windows 分支增加候选 shell 选择：
  - 先探测 `pwsh.exe` 是否可启动。
  - 不可用时探测 `powershell.exe`。
  - 两者都失败时使用现有 `cmd.exe` 包装。
- PowerShell 包装参数使用：
  - `-NoLogo`
  - `-NoProfile`
  - `-NoExit`
  - `-Command`
  - `<agent command>`
- 保留非 Windows 逻辑：继续通过 `parse_command_line(command)` 拆出真实 shell 和 args。
- 前端抽出 Windows wrapper command 解析函数：
  - 支持现有 `cmd.exe /d /s /k <command>`。
  - 支持 `pwsh.exe` / `powershell.exe ... -Command <command>`。
  - 权限跳过模式只改 `<command>` 字符串，不改变 shell 自身参数。
  - 命令展示优先展示真实 Agent CLI 命令。
- 新增 `kerminal.config.validate` MCP 工具：
  - `ToolCategory::Diagnostics`，`ToolEffect::Read`，默认暴露给外部 MCP。
  - 入参可为空；可选 `scope = all|settings|profiles|hosts|snippets|workflows`。
  - 通过运行时代码读取当前 `KerminalPaths.root` 下的文件型配置，返回 `valid`、`errorCount`、`checked` 和逐项 diagnostics。
  - 不读取 `secrets/`，不写文件，不替代文件编辑；它只回答“当前配置能否被 Kerminal 加载”。
- Host TOML 容错：
  - `RemoteHostTomlDocument.production` 使用 `#[serde(default)]`，历史或 AI 新增 host 缺字段时按非生产主机处理。
  - 保留写出 host 时显式序列化 `production`，避免新文件继续省略。
- 生成文档同步：
  - 全局 `AGENTS.md`、全局 `CLAUDE.md`、会话级 `AGENTS.md`、会话级 `CLAUDE.md` 都要求编辑配置后调用 `kerminal.config.validate`。
  - `kerminal-config.md` 的校验章节改为 MCP 工具优先；MCP 不可用时才人工按手册检查。
  - 不在用户运行时 workspace 中推荐 Node、源码相对路径或固定本机路径。
- 测试调整：
  - Rust 测试允许 Windows 输出 `pwsh.exe` / `powershell.exe` / `cmd.exe` 三种兼容 wrapper，但验证 wrapper 内部真实 command 必须一致。
  - 当前 Windows 环境有 `pwsh.exe` 时，新增或调整测试确认默认输出优先为 `pwsh.exe`。
  - 前端模型测试覆盖 `pwsh.exe -Command "codex resume --last"` 权限参数插入。
  - 前端组件测试把 mocked launch spec 改成 pwsh wrapper，并确认 `XtermPane` 收到 `pwsh.exe` 与正确 args。
  - 配置 store 测试覆盖缺少 `production` 的 host TOML 可加载为 `false`。
  - MCP 测试覆盖 `tools/list` 包含 `kerminal.config.validate`，并能通过 HTTP MCP 调用返回结构化校验结果。

## 验证
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- 默认 `src-tauri/target/debug/kerminal.exe` 可能被正在运行的 app 占用；Rust 验证使用隔离 target，例如 `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-agent-launch external_agent_workspace config_file_store mcp_tool_executor_service mcp_streamable_http_server -j 1`。
- `npm run test -- --run src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx`
- `npm run build`
- 启动冒烟：优先确认已有 dev server；如无运行实例则启动 `npm run dev -- --host 127.0.0.1` 并访问/探测首页。
- 涉及 Tauri/Rust 启动链路：尝试 `npm run tauri:dev`；若当前端口或并行 dev window 占用导致无法启动，记录原因和替代证据。

## 风险与回滚
- `pwsh.exe` 可能不存在：通过 `powershell.exe` 与 `cmd.exe` fallback 降低启动失败风险。
- `pwsh -Command` 的引用规则不同于 `cmd /k`：本轮只把完整 command 作为单个 `-Command` 参数传入，不手写拼接 quoting。
- 权限跳过参数插入位置错误会改变 Codex/Claude 行为：前端模型测试锁定插入到真实 CLI 命令的第一个参数后。
- 新增 MCP 校验工具可能被误解为 config CRUD：工具只读、分类为 Diagnostics，文档明确“文件编辑优先，MCP 只校验/运行态操作”。
- 缺省 `production=false` 可能降低保护强度：仅对缺字段历史文件容错；新写出的 host TOML 仍显式包含 `production`，文档要求生产主机写 `true`。
- 回滚方式：恢复 Windows `agent_launch_command()` 到 `cmd.exe /d /s /k`，同步恢复前端测试期望。

## 执行步骤
- [x] 读取真相源、当前 lane、现有 prompt/config lane 计划和相关代码。
- [x] 写入本实施计划并登记并行 lane。
- [x] 修改 Rust Windows agent launch wrapper。
- [x] 修改 Rust external agent workspace 测试。
- [x] 修改前端 permission mode 和 launch command 展示模型。
- [x] 修改前端 Agent Launcher 测试。
- [x] 同步全局/会话级 `AGENTS.md` 与 `CLAUDE.md` 生成模板，移除运行时 Node validator 依赖。
- [x] 新增 `kerminal.config.validate` MCP 工具和测试。
- [x] 修复 host TOML 缺少 `production` 的加载容错并补测试。
- [x] 运行验证并修复失败。
- [x] 更新 Round Log、计划索引和 lane 证据。

## Round Log

### 2026-06-25T23:16:10+08:00
- 建立计划。确认当前 `session.toml` 记录和代码均为 Windows `cmd.exe /d /s /k` 启动。
- 与 `lane-external-agent-prompt-config-redesign` 存在同文件重叠，本轮将 Rust service/test 标为 shared path，仅做启动策略最小变更。

### 2026-06-25T23:35:00+08:00
- 用户指出生成的 AGENTS/CLAUDE 和配置手册不能要求分发用户拥有本机路径、源码 checkout 或 Node。
- 扩展本计划：把运行时校验入口从 Node validator 改为 MCP 只读工具 `kerminal.config.validate`，并同步修复 AI 新增 host 缺 `production` 导致配置加载失败的问题。
- 由于默认 Cargo target 中 `kerminal.exe` 被运行中 app 占用，后续 Rust 测试改用隔离 target 目录避免误判。

### 2026-06-26T00:06:35+08:00
- 完成 Windows Agent CLI 启动策略：Windows 优先 `pwsh.exe`，fallback 到 `powershell.exe`，最后保留 `cmd.exe /d /s /k`。
- 完成前端 launch model 更新：权限跳过参数插入真实 Agent CLI 命令，命令展示从 shell wrapper 中提取真实命令。
- 完成生成模板同步：全局/会话级 `AGENTS.md` 与 `CLAUDE.md` 都要求编辑配置后调用 `kerminal.config.validate`，不再把 Node validator 写进用户运行时 workspace；`kerminal-config.md` 改为 MCP 校验优先。
- 完成 MCP 只读校验工具：`kerminal.config.validate` 暴露在 tools/list，返回 `valid`、`errorCount`、`warningCount`、`checked` 和 diagnostics；host 校验读取 public metadata，不合并 `secrets/hosts`。
- 完成 host TOML 容错：缺少 `production` 时按 `false` 加载；校验工具对缺字段给 warning，对类型错误给 error。
- 验证通过：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-agent-launch --test external_agent_workspace --test config_file_store --test mcp_streamable_http_server --test mcp_tool_executor_service -j 1`
  - `npm run test -- --run src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx`
  - `npm run build`
  - Dev server smoke：`http://127.0.0.1:1425/` 返回 200。
- `npm run tauri:dev` 未启动：当前已有 `C:\dev\rust\kerminal\src-tauri\target\debug\kerminal.exe` 进程运行并锁住默认 target，本轮未擅自关闭用户窗口；Rust 测试使用隔离 target 验证 Tauri/Rust 侧改动。

### 2026-06-26T00:27:14+08:00
- 完成收口审计时发现 MCP 校验工具仍把 host TOML 缺少 `production` 记为 error，和本计划“缺字段容错加载为 `false` 并给 warning；类型错误才 error”的目标不一致。
- 已修复 `src-tauri/src/services/mcp_tool_executor_service/config_tools.rs`：新增 warning diagnostic，缺少 `production` 只增加 `warningCount`，`production` 类型错误仍增加 `errorCount` 并使 `valid=false`。
- 已更新 `src-tauri/tests/mcp_streamable_http_server.rs`：MCP smoke 同时覆盖缺 `production` 为 warning 且 `valid=true`、错误类型为 error 且 `valid=false`。
- 追加验证通过：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-agent-launch --test config_file_store --test mcp_streamable_http_server -j 1`
  - `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-agent-launch --test external_agent_workspace --test mcp_tool_executor_service -j 1`
  - `npm run test -- --run src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx`
  - `npm run build`
  - Dev server smoke：`http://127.0.0.1:1425/` 返回 200。
- `npm run tauri:dev` 仍未重启：当前已有 `C:\dev\rust\kerminal\src-tauri\target\debug\kerminal.exe` 运行中，本轮不擅自关闭用户窗口。
