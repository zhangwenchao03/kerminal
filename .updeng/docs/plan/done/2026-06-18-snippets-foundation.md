---
id: PLAN-20260618-000035-snippets-foundation
status: done
created_at: 2026-06-18T00:00:35+08:00
started_at: 2026-06-18T00:00:35+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 脚本片段基础

## 目标
- 建立 SQLite-backed 脚本片段能力：可创建、搜索、查看、更新和删除常用命令片段。
- 右侧“片段”工具面板从占位变成可用列表与创建表单，界面文案以中文为主。
- 将 `snippet.create` 注册到 Tool Registry，使 AI 可在统一确认、执行和审计边界内创建脚本片段。

## 非目标
- 本次不实现命令历史采集。
- 本次不实现多步骤 workflow 执行器。
- 本次不直接把片段注入当前终端执行；先完成可持久化和可被 AI 创建。

## 影响范围
- Rust：`models`、`storage`、`services`、`commands`、`state`、Tool Registry、AI Tool Invocation。
- 前端：右侧工具面板、脚本片段 API、组件测试。
- 数据库：新增 `command_snippets` 表和 schema migration。
- 文档：长期计划第 18 片状态说明与本计划收口。

## 执行步骤
- [x] 新增脚本片段数据模型、SQLite migration 和存储访问层。
- [x] 新增 `SnippetService` 和 Tauri Commands：list/search/create/update/delete。
- [x] 将服务接入 `AppState` 与 Tauri command handler。
- [x] 注册 `snippet.create` 工具，并接入 AI 受控执行器与审计摘要。
- [x] 实现前端 `snippetApi` 和右侧片段工具面板。
- [x] 补充 Rust 集成测试、Tool Registry/AI 测试和前端组件测试。
- [x] 运行 targeted tests、`npm run check`，并在 `http://127.0.0.1:1425/` 做浏览器烟测。

## 验证
- `cargo test --manifest-path src-tauri/Cargo.toml --test snippet_service`
- `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service`
- `cargo test --manifest-path src-tauri/Cargo.toml --test tool_registry_service`
- `npm run test:frontend -- ToolPanel`
- `npm run check`
- 浏览器烟测：打开 `http://127.0.0.1:1425/`，确认“片段”工具可创建和搜索，AI 面板可看到/准备 `snippet.create`。

## 风险
- 片段内容可能包含 token 或生产命令；本次只做基础脱敏摘要和创建确认，不自动执行片段。
- SQLite migration 需要递增 schema 版本并兼容已有 v5 数据库。
- 前端浏览器预览需要提供本地 fallback 数据，避免非 Tauri 环境空白。

## 完成记录
- 完成时间：2026-06-18。
- 新增 SQLite schema v6：`command_snippets`。
- 新增 `snippet.create` AI 工具；AI 只能创建片段，不会自动执行片段命令。
- 自动化验证：`npm run check` 通过，包含前端 24 个测试文件 143 个测试、Rust fmt/clippy/test 和生产构建。
- 浏览器烟测：`http://127.0.0.1:1425/` 通过；片段面板创建“烟测片段1425”成功，AI 面板 `准备片段` 生成 `snippet.create` 待确认调用，拒绝后 pending 清理成功。


