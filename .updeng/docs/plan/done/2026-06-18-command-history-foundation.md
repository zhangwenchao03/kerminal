---
id: PLAN-20260618-000018-command-history-foundation
status: done
created_at: 2026-06-18T00:00:18+08:00
started_at: 2026-06-18T00:00:18+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 命令历史基础

## 目标
- 建立 SQLite-backed 命令历史能力，支持本地和 SSH 终端命令记录。
- 在右侧日志工具中提供历史搜索、过滤、刷新、删除和清空入口。
- 为后续 AI 上下文、命令面板、workflow 和隐私策略预留稳定数据模型。

## 非目标
- 本次不实现完整 shell integration、退出码、命令块和输出绑定。
- 本次不做云同步、团队共享、历史导入导出。
- 本次不实现生产主机/敏感目录的完整可配置策略，只提供 `record=false` 和基础敏感命令跳过。

## 影响范围
- Rust：`models`、`storage`、`services`、`commands`、`state`、`lib`、AI tool execution context。
- SQLite：新增 schema v7 `command_history` 表和索引。
- React：新增 `commandHistoryApi`，接入 `XtermPane`、批量发送和 `ToolPanel` 日志工具。
- 测试：Rust service 集成测试、前端 API/组件/终端输入测试。
- 文档：更新长期计划 slice 18 当前事实和验收说明。

## 执行步骤
- [x] 设计并新增命令历史模型、migration v7 和 storage CRUD。
- [x] 新增 `CommandHistoryService`，覆盖搜索、记录、删除、清空、敏感命令跳过。
- [x] 暴露 Tauri commands，并接入 `AppState` 和 invoke handler。
- [x] 将 `history.search` 注册到 Tool Registry，并接入 AI 受控执行器只读查询。
- [x] 新增前端 API，xterm 回车提交与批量发送旁路记录历史。
- [x] 在右侧日志工具中展示命令历史搜索和管理 UI。
- [x] 补齐 Rust/React 测试并运行一键验证。

## 验证
- `cargo test --manifest-path src-tauri/Cargo.toml --test command_history_service`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test tool_registry_service`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service`：通过。
- `npm run test:frontend -- commandHistoryApi XtermPane terminalSessionRegistry ToolPanel`：通过。
- `npm run check`：通过；包含 149 个前端测试、Rust fmt/clippy/test 和生产构建，Vite 仅保留既有 chunk size warning。
- 浏览器 smoke：`http://127.0.0.1:1425/` 已打开日志工具，命令历史面板和 `git` 搜索可用，控制台无 error。

## 风险
- 当前没有 shell integration，前端只能识别直接输入到回车的命令；方向键召回、复杂行编辑和退出码留后续。
- 历史记录为旁路能力，记录失败不会阻断命令写入，需通过 UI/测试确认常见路径可见。
- 敏感过滤是基础规则，不替代后续完整隐私策略和生产主机策略。


