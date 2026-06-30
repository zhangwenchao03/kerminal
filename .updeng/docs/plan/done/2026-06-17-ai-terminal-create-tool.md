---
id: PLAN-20260617-000013-ai-terminal-create-tool
status: done
created_at: 2026-06-17T00:00:13+08:00
started_at: 2026-06-17T00:00:13+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI 工具接入 terminal.create

## 目标
- 让 AI Tool Invocation Gateway 支持 `terminal.create`，用户批准后由前端工作区创建新的本地终端 tab。
- 保持 PTY Channel、xterm 初始化和 pane 生命周期走现有 React 工作区路径，不在 Rust AI 执行器里绕过前端直接创建不可见 session。
- 校准 Tool Registry schema，让 `terminal.create` 参数与现有本地终端创建能力一致。

## 非目标
- 本次不实现 AI 自动切 tab、关闭 tab 或读取新 tab 输出。
- 本次不接入 SSH 终端创建；远程主机相关工具留给 slice 17。
- 本次不新增真实 Rig Agent 自动决策，只接通受控工具调用链路。

## 影响范围
- Rust：AI clientAction 模型、`AiToolInvocationService`、Tool Registry schema、AI 工具集成测试。
- React：AI 工具调用浏览器预览、AI 面板按钮、ToolPanel/KerminalShell handler、workspace store 新建 tab 参数化、组件测试。
- 文档：长期产品计划、进行中事项索引。
- 数据库：不新增表或 migration。

## 执行步骤
- [x] 登记本计划和 `.updeng/docs/in-progress.md`。
- [x] 扩展 Rust `AiToolClientActionKind`，增加 `terminalCreate` 客户端动作。
- [x] 对 `terminal.create` 参数做类型校验：`cols/rows` 为正数，`shell/title/cwd` 可选字符串，`args` 字符串数组，`env` 字符串值对象。
- [x] 更新 Tool Registry schema，去掉当前与后端模型不匹配的 `profileId`，补齐 `shell/title/args/cwd/env/cols/rows`。
- [x] 前端扩展 AI 面板，增加“准备终端”预览入口，批准后创建新本地 tab。
- [x] 参数化 workspace store 的 `addTerminalTab`，允许客户端动作传入 shell/args/cwd/env/title。
- [x] 补 Rust 和 React 测试。
- [x] 更新长期计划 slice 16 当前事实。
- [x] 运行目标测试、`npm run check` 和 1425 浏览器冒烟。

## 验证
- `cd src-tauri; cargo fmt`
- `cd src-tauri; cargo test --test ai_tool_invocation_service`
- `npm run test:frontend -- src/features/workspace/workspaceStore.test.ts src/lib/aiToolInvocationApi.test.ts src/features/tool-panel/AiToolContent.test.tsx`
- `npm run check`
- 浏览器打开 `http://127.0.0.1:1425/`，确认 AI 面板有“准备终端”，批准后新增 tab，无 `Next Terminal` 文案和控制台错误。

## 风险
- `terminal.create` 是客户端动作，真实 PTY 创建仍由新 pane 中的 `XtermPane` 完成；审计记录表示“已批准客户端创建”，不是 Rust 已持有 session。
- `cols/rows` 会用于工具契约和审计，实际 xterm 初始尺寸仍由容器 fit 结果决定。
- 直接传入 shell/cwd/env 需要沿用现有 XtermPane/TerminalManager 校验；不存在目录会在终端 pane 内显示启动失败。

## 结果
- 状态：Done
- Rust 已支持 `terminal.create` 生成白名单化 `terminalCreate` 客户端动作，批准后审计记录写入 SQLite。
- 前端 AI 面板已提供“准备终端”入口，批准后通过 workspace store 创建新的本地终端 tab。
- Tool Registry schema 已与现有终端创建模型对齐，不再暴露当前无法校验的 `profileId`。
- 验证已通过：目标 Rust 测试、目标前端测试、`npm run check` 和 1425 浏览器冒烟。


