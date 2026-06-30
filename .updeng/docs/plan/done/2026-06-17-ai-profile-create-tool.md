---
id: PLAN-20260617-000001-ai-profile-create-tool
status: done
created_at: 2026-06-17T00:00:01+08:00
started_at: 2026-06-17T00:00:01+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 工具接入 profile.create

## 目标
- 让 AI Tool Invocation Gateway 支持 `profile.create`，在用户批准后通过现有 `ProfileService` 创建本地终端 Profile。
- 保持参数摘要脱敏、执行结果审计和 SQLite 持久化一致。
- 在右侧 AI 面板提供中文“准备配置”预览入口，方便浏览器和人工验收。

## 非目标
- 本次不接入 `remote_host.create`，避免凭据、生产主机和 SSH 明文配置风险。
- 本次不实现真实 Rig Agent 自动决策，只接通受控工具执行链路。
- 本次不新增 Profile 管理 UI 的完整表单。

## 影响范围
- Rust：`AiToolInvocationService`、`ai_tool_confirm` command、Profile 创建参数解析、AI 工具集成测试。
- React：AI 工具调用浏览器预览、AI 面板按钮与组件测试。
- 文档：长期产品计划、进行中事项索引。
- 数据库：复用已有 `terminal_profiles` 和 `ai_tool_audits` 表，不新增 migration。

## 执行步骤
- [x] 在计划文档和 `.updeng/docs/in-progress.md` 登记本切片。
- [x] 将 `profile.create` 接入 Rust 受控执行器，复用 `ProfileService::create_profile`。
- [x] 校验 JSON 参数类型：`name`、`shell` 必填字符串；`args` 必须是字符串数组；`cwd` 可为空；`env` 必须是字符串值对象；`setDefault` 可选布尔。
- [x] 更新 Tool Registry schema，明确 `env` 和 `setDefault`。
- [x] 补 Rust 集成测试：批准后创建并审计、拒绝不创建、非法参数失败审计、敏感 env 摘要脱敏。
- [x] 更新前端浏览器预览标题和结果摘要，增加 AI 面板“准备配置”入口。
- [x] 补前端 API 与组件测试。
- [x] 更新长期计划 slice 16 当前事实。
- [x] 运行最窄测试、`npm run check`，并在 `http://127.0.0.1:1425/` 做浏览器冒烟。

## 验证
- `cd src-tauri; cargo fmt`
- `cd src-tauri; cargo test --test ai_tool_invocation_service`
- `npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx`
- `npm run check`
- 浏览器打开 `http://127.0.0.1:1425/`，确认 AI 面板中文内容、`准备配置` 入口和无 `Next Terminal` 文案。

## 风险
- Profile 创建会写入本地 SQLite；测试使用临时 home，实际浏览器预览只模拟。
- `cwd` 校验复用现有 ProfileService，会拒绝不存在目录。
- `env` 可能包含敏感值，摘要必须按 key 脱敏，后续更完整的 secret policy 留给安全切片。

## 结果
- 状态：Done
- Rust 已支持 `profile.create` 受控执行，批准后写入 `terminal_profiles`，拒绝不写入，失败进入 `ai_tool_audits`。
- 前端 AI 面板已提供“准备配置”入口；浏览器预览模式能展示待确认卡片且不产生真实写入。
- 验证已通过：目标 Rust 测试、目标前端测试、`npm run check` 和 1425 浏览器冒烟。


