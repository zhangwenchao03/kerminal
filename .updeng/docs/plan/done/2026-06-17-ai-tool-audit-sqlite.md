---
id: PLAN-20260617-000014-ai-tool-audit-sqlite
status: done
created_at: 2026-06-17T00:00:14+08:00
started_at: 2026-06-17T00:00:14+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 工具审计 SQLite 持久化

## 状态

- Done，2026-06-17

## 目标

- 将 AI Tool Invocation Gateway 的审计记录从内存队列扩展为 SQLite 持久化记录。
- App 重启后，`ai_tool_audit_list` 仍能返回最近的 AI 工具调用审计。
- 保持现有 `prepare -> confirm -> audit` 行为、风险摘要和前端数据结构不变。

## 非目标

- 不实现审计清除、导出、筛选或分页 UI。
- 不扩大 AI 工具白名单，不接入真实 Rig Agent 自动决策。
- 不改变确认策略、危险命令识别规则或权限模型。

## 影响范围

- 数据库：新增 schema v5 和 `ai_tool_audits` 表。
- Rust storage：新增 AI 工具审计仓储读写方法。
- Rust service/command：`confirm` 写入 SQLite，`ai_tool_audit_list` 从 SQLite 读取最近记录。
- 测试：补充审计持久化、迁移建表和列表顺序回归。

## 执行步骤

- [x] 新增 v5 migration，创建 `ai_tool_audits` 表和索引。
- [x] 新增 `storage/ai_tool_audits.rs`，封装 insert/list 和枚举 DB 字符串映射。
- [x] 改造 `AiToolInvocationService`，确认完成后同步写审计，列表接口读取 SQLite。
- [x] 更新 command 和测试调用签名。
- [x] 补充重启后审计仍存在的集成测试。
- [x] 更新产品计划中的当前项目事实和 slice 状态说明。

## 验证

- `cd src-tauri; cargo fmt`
- `cd src-tauri; cargo test --test ai_tool_invocation_service`：11 passed。
- `cd src-tauri; cargo test --test storage_foundation`：8 passed。
- `npm run check`：前端 23 files / 104 tests passed；Rust fmt、clippy、cargo test 和 Vite build passed。
- 浏览器 smoke：`http://127.0.0.1:1425/` 标题为 Kerminal，AI 面板可见，无 `Next Terminal` 文案，console error 为空。

## 风险

- Schema 版本升级需要保证幂等迁移，不能破坏已有 `~/.kerminal/kerminal.db`。
- 审计参数只能保存脱敏摘要，不能把完整工具参数或密钥写入 SQLite。
- 枚举 DB 映射需要稳定，避免未来前端 serde 名称变化导致历史数据不可读。


