---
id: PLAN-20260618-000011-ai-security-policy-settings
status: done
created_at: 2026-06-18T00:00:11+08:00
started_at: 2026-06-18T00:00:11+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 安全策略设置

## 状态
- 代码与自动化验证已完成。
- slice 20 仍保留 HITL：完整 Rig/rmcp 自动执行策略接入、日志脱敏深化和密钥泄露防护继续后续切片处理。

## 目标
- 在 SQLite-backed 应用设置中加入 AI 安全策略字段。
- 在中文设置页提供可保存的 AI 策略配置。
- 当前 AI 终端上下文请求使用用户配置的最近输出字节上限。

## 非目标
- 本切片不改 Rig Agent 自动决策链路。
- 本切片不允许 AI 绕过现有 Tool Registry、确认和审计边界。
- 本切片不关闭密钥脱敏；基础脱敏始终开启。

## 影响范围
- Rust 设置模型：`src-tauri/src/models/settings.rs`
- SQLite 设置存储：继续复用 `app_settings` JSON，不新增 migration。
- 前端设置模型和设置页：`src/features/settings/*`
- AI 上下文请求：`src/lib/aiContextApi.ts`、`src/features/tool-panel/AiToolContent.tsx`、`ToolPanel`
- 测试：Rust 设置服务测试、前端设置/API/AI 面板测试。

## 策略字段
- `ai.contextMaxOutputBytes`：AI 最近终端输出上限，默认 `12288`，范围 `512..=24576`。
- `ai.includeCommandHistory`：是否允许后续把命令历史纳入 AI 上下文，默认 `false`。
- `ai.requireRemoteApproval`：远程工具默认需要用户确认，默认 `true`。
- `ai.allowDestructiveTools`：是否允许破坏性工具进入可执行策略，默认 `false`。
- 密钥脱敏不提供关闭开关。

## 执行步骤
- [x] 扩展 Rust `AppSettings`，补默认值、反序列化兼容和范围校验。
- [x] 扩展 TS `AppSettings`，补默认值和 normalize clamp。
- [x] 设置页加入 “AI 安全策略” 区块和中文控件。
- [x] AI 面板通过 `settings.ai.contextMaxOutputBytes` 构建上下文请求。
- [x] 补齐 Rust 与前端测试。
- [x] 运行 focused tests、`npm run check` 和 1425 浏览器 smoke。

## 验证
- `npm run test:frontend -- settingsApi SettingsToolContent aiContextApi AiToolContent`：4 个测试文件、35 个用例通过。
- `cd src-tauri && cargo test --test settings_service`：5 个用例通过。
- `npm run check`：前端测试、Rust fmt/clippy/test 和生产构建通过。
- 浏览器打开 `http://127.0.0.1:1425/`：设置页可见 “AI 安全策略 / 上下文输出上限 / 纳入命令历史”，console error 为 0。

## 风险
- 旧设置 JSON 缺少 `ai` 字段必须能自动补默认值。
- 前端和 Rust 的数值边界必须一致。
- 当前只接入上下文输出上限，其余策略字段先持久化和可见，后续再进入 Rig/rmcp 工具策略执行链。


