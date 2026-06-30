---
id: PLAN-20260617-000023-rig-llm-provider-settings
status: done
created_at: 2026-06-17T00:00:23+08:00
started_at: 2026-06-17T00:00:23+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Rig LLM Provider 设置切片

## 目标
- 在设置页新增 LLM Provider 配置区，用户可以配置 OpenAI-compatible base URL、模型、temperature、上下文策略和 API key。
- Rust 侧通过 `rig-core` 构造 provider/client 进行配置级验证，不在业务代码里手写 LLM HTTP 请求。
- API key 不进入 SQLite 明文字段，SQLite 只保存 credential ref；真实密钥通过 keyring 抽象保存，测试使用内存凭据仓库。
- 提供 `llm_provider_list/create/update/delete/test` Tauri Commands 和前端 API 封装。

## 非目标
- 本切片不实现 AI 聊天流、terminal context 读取或工具调用执行。
- 本切片不实现 rmcp gateway 的完整工具列表和 dispatch；只在依赖和架构边界上为后续切片预留。
- 本切片不做真实 LLM completion 请求，避免没有用户确认的外部网络调用和 API key 消耗。

## 影响范围
- Rust 模型：新增 LLM provider、上下文策略、保存/测试请求与测试结果类型。
- Rust 存储：新增 SQLite migration v4 和 `llm_providers` repository。
- Rust 服务：新增 credential service 和 rig provider service，负责 keyring 抽象、配置校验和 Rig client 构造。
- Rust Command：注册 `llm_provider_*` commands。
- React API：新增 `src/lib/llmProviderApi.ts` 和测试。
- React UI：扩展设置面板，增加中文 LLM Provider 表单、保存、测试和删除反馈。
- 文档：更新主计划 slice 13 状态、依赖版本和 in-progress。

## 执行步骤
- [x] 确认当前 crate 版本：`rig-core 0.38.2`、`rmcp 1.7.0`、`keyring 4.1.1`。
- [x] 新增 migration v4：`llm_providers` 表只保存 `api_key_credential_ref`，不保存 API key。
- [x] 新增 Rust 模型、存储、服务、command，并把服务挂到 `AppState`。
- [x] 新增前端 LLM Provider API 和设置页 UI。
- [x] 补 Rust service/storage 测试：CRUD、凭据写入、SQLite 不含 API key、Rig client dry validation。
- [x] 补前端 API/UI 测试：保存、测试、错误显示、API key 不回显。
- [x] 运行 `npm run check`。

## 验证
- `npm run check`：通过。包含 `vitest run` 19 个测试文件、86 个测试，`cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`、`cargo test` 和 `vite build`。
- Rust 集成测试：`llm_provider_service` 4 个测试通过，覆盖创建、更新、删除、SQLite 不保存明文 API key、凭据引用和 Rig dry validation。
- 浏览器 smoke：`http://127.0.0.1:1425/` 设置工具中可见 `LLM Provider`、`Base URL`、模型、上下文策略、`API key` 密码输入、保存和测试按钮；API key 输入类型为 `password`，DOM 中未出现测试密钥。

## 风险
- `keyring` 依赖系统凭据服务；Linux 桌面环境可能没有可用 Secret Service，因此 service 需要返回可理解错误，测试不能依赖 OS keychain。
- `rig-core` provider API 后续可能变化，本切片只把构造逻辑隔离在 `rig_provider_service`，后续聊天流复用该入口。
- 真实连接测试可能产生费用或泄露上下文；首版只做本地 dry validation，后续由用户显式点击真实测试时再补网络调用策略。

## 当前状态
- Done：代码、自动化验证和浏览器 smoke 已完成。


