---
id: PLAN-20260618-000019-diagnostics-bundle
status: done
created_at: 2026-06-18T00:00:19+08:00
started_at: 2026-06-18T00:00:19+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 诊断包基础

## 状态

- Done：代码、自动化验证和 `http://127.0.0.1:1425/` 浏览器 smoke 均已通过。

## 目标

- 在日志工具中提供“生成诊断包”入口，帮助用户排查终端、SSH、SFTP、AI 工具和设置问题。
- Rust 侧生成脱敏 JSON 诊断包，落在 `~/.kerminal/diagnostics/`。
- 诊断包包含应用版本、平台、数据目录、SQLite schema、终端会话摘要和设置摘要，不包含终端原始输出、API key、SSH 密码或凭据明文。
- 前端浏览器预览、Tauri command、服务层和测试形成完整闭环。

## 非目标

- 本次不压缩 zip，不上传云端，也不读取任意日志文件内容。
- 本次不做性能压测 UI，只先交付可导出的支持诊断材料。
- 本次不收集真实 SSH/SFTP 文件内容或终端输出缓冲。

## 影响范围

- Rust 模型：`src-tauri/src/models/diagnostics.rs`
- Rust 服务：`src-tauri/src/services/diagnostics_service.rs`
- Tauri command：`src-tauri/src/commands/diagnostics.rs`、`src-tauri/src/lib.rs`
- 应用状态：`src-tauri/src/state.rs`
- 前端 API：`src/lib/diagnosticsApi.ts`
- 右侧日志工具：`src/features/tool-panel/ToolPanel.tsx`、`src/features/tool-panel/DiagnosticsBundleCard.tsx`
- 测试：Rust service 测试、前端 API 测试、日志工具面板测试
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 执行步骤

- [x] 定义诊断包 IPC 响应类型，字段使用 camelCase。
- [x] 新增 `DiagnosticsService`，生成脱敏 JSON payload 并写入 diagnostics 目录。
- [x] 注册 `diagnostics_create_bundle` command 并接入 `AppState`。
- [x] 新增前端 `diagnosticsApi`，Tauri 下调用 command，浏览器预览返回中文模拟结果。
- [x] 将诊断包 UI 做成独立组件，并加入日志工具的中文交互状态。
- [x] 补齐 Rust 与前端测试，确保 `npm run check` 继续作为一键验证入口。
- [x] 更新总计划和 in-progress。

## 验证

- 已通过：`cd src-tauri && cargo test --test diagnostics_service`
- 已通过：`npm run test:frontend -- diagnosticsApi ToolPanel`
- 已通过：`npm run check`
- 已通过：浏览器 smoke `http://127.0.0.1:1425/`
  - 日志工具显示 `诊断包` 和 `生成诊断包`。
  - 点击后浏览器预览显示 `已生成 diagnostics-...-preview.json` 和 `browser-preview://diagnostics/...`。
  - 未检测到 `Next Terminal`、`next terminal` 或 `NextTerminal`。

## 风险

- 诊断包容易误收集敏感内容；本次只记录摘要和计数，不记录终端原始输出、命令历史明细或任何凭据值。
- 诊断目录写入失败时必须返回清晰错误，不能影响主应用启动。



