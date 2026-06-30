---
id: PLAN-20260618-000004-ai-audit-management
status: done
created_at: 2026-06-18T00:00:04+08:00
started_at: 2026-06-18T00:00:04+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 工具审计管理基础

## 状态

- 状态：Done
- 完成时间：2026-06-18

## 目标

- 在现有 AI Tool Invocation 审计持久化基础上，补齐用户可见的审计管理能力。
- 支持按数量读取最近审计、导出审计 JSON 摘要、清空本地 AI 工具审计。
- 在右侧 AI 工具面板提供中文为主的刷新、导出、清空与二次确认交互。

## 非目标

- 不改变 Rig Agent 自动决策链路。
- 不扩大 AI 远程命令、SFTP 或终端写入权限。
- 不实现完整策略配置中心、日志脱敏系统或密钥泄露防护总方案。
- 不把审计导出直接写入文件系统；本轮由前端生成 JSON 下载。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 后端接口 | 是 | `src-tauri/src/commands/ai.rs`、`src-tauri/src/lib.rs` | Rust 集成测试、`npm run check` |
| 前端页面 | 是 | `src/features/tool-panel/AiToolContent.tsx`、`src/lib/aiToolInvocationApi.ts` | Vitest、浏览器 smoke |
| 数据库 | 是 | `src-tauri/src/storage/ai_tool_audits.rs` | Rust 集成测试 |
| 权限/审计 | 是 | AI 工具审计 list/export/clear | 清空、导出、limit 行为测试 |
| 文档/发布 | 是 | 本计划、产品计划、in-progress | 收口时更新 |

## 执行步骤

- [x] Rust model/storage/service：增加 audit list request、export payload、clear response；实现 limit clamp、导出和清空。
- [x] Rust command：注册 `ai_tool_audit_clear`、`ai_tool_audit_export`，并让 list 支持可选 limit。
- [x] 前端 API：补齐 list options、export、clear；浏览器预览同样支持。
- [x] AI 面板：增加审计管理按钮、导出反馈、清空二次确认和更完整列表展示。
- [x] 自动化测试：补 Rust 集成测试、前端 API 测试和 AI 面板交互测试。
- [x] 验证：运行目标测试、`npm run check`，并用 `http://127.0.0.1:1425/` 做浏览器 smoke。
- [x] 文档收口：更新产品计划和 in-progress。

## 验证

- `npm run test:frontend -- aiToolInvocationApi AiToolContent`：通过，2 个测试文件、47 个用例通过。
- `cd src-tauri && cargo test --test ai_tool_invocation_service`：通过，76 个用例通过。
- `npm run check`：通过，包含前端 28 个测试文件 178 个用例、Rust fmt/clippy/test 和生产构建。
- 浏览器 smoke：`http://127.0.0.1:1425/` 通过；AI 面板审计空状态、生成审计、导出、清空二次确认和按钮禁用状态正常，控制台错误为 `[]`。

## 风险

- 清空审计是本地不可恢复操作，前端必须提供二次确认，后端只删除 `ai_tool_audits`。
- 导出内容只能包含现有已脱敏摘要字段，不引入原始参数或终端输出。
- 现有 AI 面板文件较大，本轮只做紧邻功能补齐；后续可单独切片抽 `AiAuditManagement` 组件。


