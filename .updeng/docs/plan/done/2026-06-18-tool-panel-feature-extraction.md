---
id: PLAN-20260618-000044-tool-panel-feature-extraction
status: done
created_at: 2026-06-18T00:00:44+08:00
started_at: 2026-06-18T00:00:44+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 工具面板片段与日志模块拆分

## 目标
- 将右侧工具面板中的脚本片段、工作流入口和命令历史/诊断日志 UI 从 `ToolPanel.tsx` 抽离到独立 feature 模块。
- 保持 `ToolPanel.tsx` 只负责工具 rail、当前工具说明和子工具组合，避免继续膨胀成多能力大文件。
- 将片段与日志行为测试迁移到独立测试文件，保留 ToolPanel 的工具切换和组合测试。

## 非目标
- 本次不修改 Rust Command、SQLite schema 或现有 API 契约。
- 本次不改变脚本片段、工作流、命令历史、诊断包的用户可见功能。
- 本次不做视觉重设计，只做结构拆分和回归保护。

## 影响范围
- 前端组件：`src/features/tool-panel/ToolPanel.tsx`、`src/features/snippets/SnippetToolContent.tsx`、`src/features/logs/LogToolContent.tsx`
- 前端测试：`src/features/tool-panel/ToolPanel.test.tsx`、`src/features/snippets/SnippetToolContent.test.tsx`、`src/features/logs/LogToolContent.test.tsx`
- 文档：`.updeng/docs/plan/next/terminal-product-plan.md`、`.updeng/docs/in-progress.md`

## 执行步骤
- [x] 抽离 `SnippetToolContent` 和片段 helper 到 snippets feature。
- [x] 抽离 `LogToolContent` 到 logs feature。
- [x] 调整 `ToolPanel.tsx` imports 和测试职责，使其只验证工具组合。
- [x] 补齐独立 Vitest 覆盖片段创建/删除/填参发送、历史搜索/删除/清空、诊断体检/诊断包入口。
- [x] 运行窄测试。
- [x] 运行 `npm run check`。
- [x] 使用桌面版做启动冒烟，网页 1425 只做补充 UI 预览。
- [x] 更新长期计划并移除 in-progress 条目。

## 验证
- `npm run test:frontend -- ToolPanel SnippetToolContent LogToolContent`
- `npm run check`
- 桌面版启动冒烟：确认 `kerminal.exe` 窗口存在且无启动错误。

## 风险
- 片段执行和工作流执行都依赖当前 focused pane，抽离时必须保留 `activeTabId`、`focusedPane` 参数和作用域校验。
- 日志工具依赖命令历史、运行体检和诊断包 API，抽离时必须保留加载、错误、空状态和清空确认行为。

## 完成记录
- 完成时间：2026-06-18。
- 代码结果：`ToolPanel.tsx` 保留右侧工具容器、rail 和主机配置组合职责；脚本片段/工作流入口迁移到 `src/features/snippets/SnippetToolContent.tsx`；命令历史/运行体检/诊断包入口迁移到 `src/features/logs/LogToolContent.tsx`。
- 测试结果：`ToolPanel.test.tsx` 保留工具组合测试；`SnippetToolContent.test.tsx` 覆盖片段加载、创建、作用域校验、变量填参发送和工作流创建/执行；`LogToolContent.test.tsx` 覆盖历史加载、搜索、删除、清空、运行体检刷新和诊断包生成。
- 验证证据：`npm run test:frontend -- ToolPanel SnippetToolContent LogToolContent` 通过，3 个测试文件 23 个测试；`npm run check` 通过，36 个前端测试文件 254 个测试，并通过 Rust fmt、clippy、cargo test 和生产构建；桌面版复用 1425 dev server 启动冒烟通过，检测到 `kerminal.exe` 窗口标题 `Kerminal`，随后已停止进程。



