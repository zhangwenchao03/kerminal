---
id: PLAN-20260618-000005-ai-chat-panel
status: done
created_at: 2026-06-18T00:00:05+08:00
started_at: 2026-06-18T00:00:05+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 右侧 AI 对话面板

状态：已完成

## 目标
- 将右侧 AI 工具面板改为对话式助手界面，默认只展示会话、消息流、输入框、上下文状态和待确认工具调用。
- 支持查看历史会话、切换会话、新建会话，并在同一会话内保留上下文继续追问。
- 继续复用现有 `ai_chat`、终端上下文和 AI 工具建议/确认能力。

## 非目标
- 本次不新增 Rust/SQLite 持久化表，不改 Tauri IPC 契约。
- 本次不删除底层 Tool Registry、MCP、审计能力，只从默认右栏界面降噪。

## 影响范围
- `src/features/tool-panel/AiToolContent.tsx`
- `src/features/tool-panel/AiToolContent.test.tsx`
- 必要时补充前端本地会话历史存取逻辑。

## 执行步骤
- [x] 梳理现有 AI 面板状态、chat 请求和工具确认路径。
- [x] 设计会话数据结构、历史保存策略和上下文拼接方式。
- [x] 重构右侧面板为聊天主界面，保留待确认工具调用和审计入口。
- [x] 更新测试覆盖发送消息、历史会话、工具建议准备和审计操作。
- [x] 运行前端类型检查/测试/构建。

## 验证
- `npm run test:frontend -- AiToolContent ToolPanel` 通过。
- `Invoke-WebRequest http://127.0.0.1:1430/` 返回 200。
- `npm run typecheck` 被非本次文件阻断：`src/features/machine-sidebar/RemoteHostCreateDialog.tsx` 缺少 `buildLocalTerminalOptions`、`LocalPropertiesPanel`、`RdpPropertiesPanel`、`SshPropertiesPanel` 等符号，`src/features/terminal/XtermPane.tsx` 有已有类型比较错误。
- `npm run test:frontend` 被非本次文件阻断：`RemoteHostCreateDialog` 未定义组件导致本模块和 `KerminalShell` 相关测试失败。

## 风险
- 前端本地历史使用浏览器存储，后续若要跨设备或 SQLite 级持久化，需要新增后端模型和迁移。
- 会话上下文拼接需要限制历史条数和长度，避免 prompt 过长。


