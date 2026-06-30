---
id: PLAN-20260618-000014-ai-tool-policy-enforcement
status: done
created_at: 2026-06-18T00:00:14+08:00
started_at: 2026-06-18T00:00:14+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 工具策略执行

## 状态
- 代码与自动化验证已完成。
- 策略已接入 Tauri `ai_tool_prepare` 命令路径；历史非持久化 prepare 入口保留 Tool Registry 兼容行为。

## 目标
- 将 SQLite-backed AI 安全策略接入 AI 工具 prepare 阶段。
- 默认阻止破坏性工具进入可执行 pending 状态。
- 当用户关闭远程确认策略时，远程非破坏性工具可进入自动执行策略。

## 非目标
- 本切片不实现 Rig Agent 自动确认 pending 调用。
- 本切片不新增前端设置项，上轮已提供中文配置 UI。
- 本切片不改变 confirm 阶段已有工具执行、审计和脱敏摘要逻辑。

## 影响范围
- Rust 服务：`src-tauri/src/services/ai_tool_invocation_service.rs`
- Tauri Command：`src-tauri/src/commands/ai.rs`
- 设置模型：复用 `AppSettings.ai`
- 测试：`src-tauri/tests/ai_tool_invocation_service.rs`

## 执行步骤
- [x] 在 AI 工具 prepare 阶段读取当前应用设置。
- [x] 根据 `allowDestructiveTools` 拦截破坏性工具。
- [x] 根据 `requireRemoteApproval` 调整远程工具确认策略。
- [x] 补充策略执行测试。
- [x] 运行 focused Rust 测试和 `npm run check`。

## 验证
- `cd src-tauri && cargo test --test ai_tool_invocation_service`：79 个用例通过。
- `npm run check`：前端测试、Rust fmt/clippy/test 和生产构建通过。
- `rg "Next Terminal|next terminal|NextTerminal" .`：无匹配。

## 风险
- 破坏性工具默认关闭后，未来 Rig Agent 自动执行链必须尊重 prepare 返回的拒绝结果。
- 远程确认关闭仅影响 `Remote` 风险工具；`Destructive` 风险仍受破坏性工具开关约束。


