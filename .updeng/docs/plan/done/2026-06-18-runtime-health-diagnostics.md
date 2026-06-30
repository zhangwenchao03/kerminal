---
id: PLAN-20260618-000027-runtime-health-diagnostics
status: done
created_at: 2026-06-18T00:00:27+08:00
started_at: 2026-06-18T00:00:27+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 运行体检诊断

## 状态

- 状态：Done
- 完成时间：2026-06-18

## 目标

- 在现有诊断能力中新增“运行体检/系统资源摘要”，让用户能从右侧日志工具查看当前应用进程和本机资源状态。
- 后端使用第三方系统信息库采集进程内存、本机内存、CPU、启动时间和数据目录占用等指标。
- 前端以中文展示加载、错误、刷新和指标状态，并在浏览器预览模式提供稳定模拟数据。

## 非目标

- 本次不做长期性能采样数据库、趋势图、告警规则或后台定时采集。
- 本次不做远程 SSH 主机性能指标，远程服务器信息仍使用现有服务器信息工具。
- 本次不把完整终端输出、命令历史明细或凭据值加入运行体检。

## 影响范围

- Rust 后端：`models/diagnostics.rs`、`services/diagnostics_service.rs`、`commands/diagnostics.rs`、`lib.rs`。
- 前端：`src/lib/diagnosticsApi.ts`、右侧工具面板日志工具中的诊断卡片。
- 测试：Rust diagnostics service 测试、前端 diagnostics API 测试、工具面板组件测试。
- 文档：本计划、`.updeng/docs/in-progress.md`、总计划 slice 21 状态说明。

## 执行步骤

- [x] 引入系统资源采集依赖并设计 `RuntimeHealthSnapshot` IPC 模型。
- [x] 在 `DiagnosticsService` 中实现一次性运行体检采样。
- [x] 注册 Tauri Command 并补齐前端 API/browser preview。
- [x] 在日志工具中增加中文“运行体检”卡片。
- [x] 补齐 Rust 与 React 测试。
- [x] 运行窄测试、`npm run check`，并使用 `http://127.0.0.1:1425/` 做浏览器 smoke。
- [x] 更新总计划和本计划状态。

## 验证

- `cd src-tauri && cargo test --test diagnostics_service`：通过，2 个测试。
- `npm run test:frontend -- diagnosticsApi ToolPanel`：通过，2 个测试文件、27 个测试。
- `npm run check`：通过，前端 31 个测试文件/206 个测试、Rust fmt/clippy/test、生产构建均通过；仍有既有 Vite chunk 大小警告。
- 浏览器 `http://127.0.0.1:1425/`：日志工具显示“运行体检 / 诊断包 / 命令历史”，刷新体检按钮可触发，页面无 `Next Terminal` 文案。

## 风险

- 系统资源指标跨平台可用性不同，首版只展示所有平台都能合理获取或安全降级的指标。
- CPU 使用率依赖短间隔刷新可能在一次性采样中偏低，本次以即时摘要为主，不承诺长期精准趋势。
- 数据目录大小可能随文件数量增长而变慢，本次仅遍历 `~/.kerminal` 下普通文件并忽略不可读项。


