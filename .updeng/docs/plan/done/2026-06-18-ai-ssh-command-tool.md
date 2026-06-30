---
id: PLAN-20260618-000012-ai-ssh-command-tool
status: done
created_at: 2026-06-18T00:00:12+08:00
started_at: 2026-06-18T00:00:12+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 远程命令工具

## 状态
- Done：代码、自动化验证和 1425 浏览器 smoke 已完成。

## 目标
- 在 Kerminal Tool Registry 中新增 `ssh.command`，让 AI 能通过受控工具在已保存 SSH 主机上执行非交互命令。
- 复用现有 `prepare -> confirm -> Rust 执行器 -> SQLite 审计` 链路，远程命令默认每次确认。
- 对 `rm -rf`、`sudo`、重启、格式化、下载脚本执行等高风险命令进行风险摘要，并升级为破坏性确认和 full audit。
- 命令输出进入审计前必须限长、压缩和脱敏，不能记录完整远程输出或敏感内容。

## 非目标
- 本切片不做交互式 SSH shell；已有 `ssh.connect` 继续负责打开远程终端。
- 本切片不做多主机批量执行 UI，也不做工作流编排。
- 本切片不绕过 Tool Registry 直接调用 LLM API；AI 仍走 Rig/rmcp 规划下的工具层。

## 影响范围
- Rust model：远程命令请求、输出摘要模型。
- Rust service：系统 OpenSSH 非交互命令执行、参数校验、输出限长和命令计划测试。
- Rust AI 执行器：`ssh.command` 参数解析、执行、摘要、风险升级和审计。
- Tool Registry / rmcp gateway：新增工具 schema、风险分类、确认策略和 MCP 导出。
- React AI 面板：新增中文按钮和浏览器预览 mock。
- 测试：Rust service、AI invocation、Tool Registry、前端 API 和组件测试。

## 执行步骤
- [x] 新增远程命令模型和 `SshCommandService`，复用 OpenSSH 参数化调用。
- [x] 将 `SshCommandService` 接入 `AppState` 和 AI 执行上下文。
- [x] 在 Tool Registry 注册 `ssh.command`，并保持 MCP 导出信息正确。
- [x] 在 AI 执行器接入 `ssh.command`，补齐风险升级、输出摘要和错误路径。
- [x] 在 React 浏览器预览和 AI 面板增加“远程命令”入口。
- [x] 补齐 Rust/React 测试并运行自动化验证。
- [x] 用 `http://127.0.0.1:1425/` 做浏览器 smoke，验证 pending、风险摘要和拒绝审计。
- [x] 更新长期产品计划，移除本计划的 in-progress 记录。

## 验证
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml ssh_command_service`
- `cargo test --manifest-path src-tauri/Cargo.toml ai_tool_invocation_service`
- `cargo test --manifest-path src-tauri/Cargo.toml tool_registry_service`
- `npm run test:frontend -- --run src/lib/aiToolInvocationApi.test.ts src/lib/toolRegistryApi.test.ts src/features/tool-panel/AiToolContent.test.tsx`
- `npm run check`
- 浏览器打开 `http://127.0.0.1:1425/`，在 AI 面板点击“远程命令”，确认显示 `ssh.command · 远程`；点击“拒绝”后最近审计显示“用户已拒绝执行。”
- 旧品牌关键词扫描无命中。

## 验证结果
- `npm run check` 通过：前端 138 个测试、Rust fmt/clippy/test 和生产构建均通过。
- 目标集成测试通过：AI 工具调用 68 个用例、Tool Registry 4 个用例、SSH command service 3 个用例。
- 1425 浏览器 smoke 通过：`ssh.command · 远程` pending 展示、参数摘要、拒绝审计均符合预期。

## 风险
- 远程命令可能造成生产影响；默认 `remote/always/summary`，危险命令升级为 `destructive/always/full`。
- 命令输出可能包含密钥或 token；审计摘要必须复用脱敏并限制片段长度。
- 系统 OpenSSH 在不同平台路径不同；继续使用 `which("ssh")` / `which("ssh.exe")` 探测，错误提示保持用户可读。


