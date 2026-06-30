---
id: PLAN-20260618-000045-workflow-foundation
status: done
created_at: 2026-06-18T00:00:45+08:00
started_at: 2026-06-18T00:00:45+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Workflow 基础链路

## 目标

- 增加 SQLite-backed command workflow 能力，支持创建、搜索、更新、删除多步命令工作流。
- 工作流由有序步骤组成，每步包含标题、命令、可选说明、可选作用域和可选确认点。
- 右侧“片段”工具面板增加“工作流”区域，支持创建、预览和逐步发送到当前聚焦分屏。
- 工作流执行写入命令历史，并使用独立 `workflow` 来源。

## 非目标

- 本次不做 AI 自动规划/自动执行 workflow。
- 本次不做跨主机组批量 workflow 编排。
- 本次不做工作流导入导出、版本管理和拖拽排序。
- 本次不做 shell integration 的命令块级成功/失败识别。

## 影响范围

- Rust 模型、SQLite migration、storage、service、Tauri command 和 AppState。
- 前端 workflow API、工具面板接线、终端写入 registry 和命令历史来源类型。
- Rust/React 单元测试与产品计划文档。

## 执行步骤

- [x] 增加 migration v8：workflow 表、step 表、command history `workflow` 来源。
- [x] 增加 Rust workflow model/storage/service/command 并注册到 Tauri。
- [x] 增加前端 workflow API 和浏览器预览数据。
- [x] 抽象 terminal pane command 写入，保留 snippet wrapper，并增加 workflow wrapper。
- [x] 在“片段”工具中增加 workflow 创建、搜索、预览和逐步执行 UI。
- [x] 补充 Rust/React 测试，更新长期产品计划。

## 验证

- 已通过：`npm run test:frontend -- workflow terminalSessionRegistry ToolPanel`
- 已通过：`cd src-tauri && cargo test workflow`
- 已通过：`npm run check`
- 已通过：浏览器 smoke `http://127.0.0.1:1425/`，打开“片段”，创建两步工作流，逐步执行到当前分屏，日志显示 workflow 来源且控制台错误为空。

## 风险

- SQLite CHECK 约束新增 `workflow` 来源需要重建 `command_history` 表，迁移必须保留旧数据。
- ToolPanel 已偏大，本次 UI 尽量放到独立 workflow 组件，只做最小接线。
- 工作流执行只是逐步发送命令，不代表命令完成或成功；后续需 shell integration 支撑状态识别。


