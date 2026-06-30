---
id: PLAN-20260618-000042-terminal-session-log-redaction
status: done
created_at: 2026-06-18T00:00:42+08:00
started_at: 2026-06-18T00:00:42+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 终端会话日志脱敏

## 状态
- 代码与自动化验证已完成。

## 目标
- 会话日志继续只在用户显式开启后写入 `~/.kerminal/logs/sessions/`。
- 日志文件落盘前复用与 AI 上下文、AI 审计一致的敏感信息脱敏规则。
- 保持终端实时输出和 AI 上下文快照行为不变。

## 非目标
- 本切片不实现日志浏览器、清理策略或诊断包导出。
- 本切片不改变 xterm 输出缓冲和前端展示内容。
- 本切片不新增可配置脱敏规则 UI。

## 影响范围
- Rust 安全模块：`src-tauri/src/security/redaction.rs`
- Rust 服务：`src-tauri/src/services/terminal_manager.rs`、`src-tauri/src/services/ai_context_service.rs`、`src-tauri/src/services/ai_tool_invocation_service.rs`
- 测试：`src-tauri/tests/terminal_manager.rs`、`src-tauri/tests/ai_context_service.rs`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤
- [x] 抽出公共终端文本脱敏模块。
- [x] 让 AI 上下文和 AI 工具审计继续使用同一脱敏函数。
- [x] 在终端 session log sink 写文件前执行脱敏。
- [x] 补充会话日志脱敏集成测试。
- [x] 运行 focused Rust 测试和 `npm run check`。
- [x] 更新长期计划并从 in-progress 收口。

## 验证
- `cd src-tauri && cargo test --test terminal_manager`：7 个用例通过，包含会话日志脱敏回归。
- `cd src-tauri && cargo test --test ai_context_service --test ai_tool_invocation_service`：82 个用例通过。
- `npm run check`：前端 29 个测试文件、196 个用例通过；Rust fmt/clippy/test 和生产构建通过。
- `rg "Next Terminal|next terminal|NextTerminal" .`：无匹配。

## 风险
- 当前脱敏覆盖常见 `api_key/token/password/secret` 赋值、Bearer token 和 `sk-` API key 形态；更复杂的密钥格式需要后续持续补规则。
- 日志写入仍不会阻塞终端输出；如果落盘失败，当前行为仍是忽略单次追加错误，后续可单独补用户可见写入错误提示。



