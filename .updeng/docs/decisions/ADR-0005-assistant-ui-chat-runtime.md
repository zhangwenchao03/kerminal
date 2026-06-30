# ADR-0005: 右侧 AI 对话采用 assistant-ui 外部状态 Runtime

## 状态
Accepted

## 背景
- ADR-0004 先采用 Streamdown 在现有面板上补齐流式 Markdown 渲染。
- 用户进一步要求右侧 AI 对话直接替换为 assistant-ui，体验接近 Codex 对话：过程展示、流式输出、Markdown 渲染和成熟开源组件能力。
- Kerminal 已经拥有本地会话历史、Provider 选择、终端上下文、工具建议、审批面板和审计链，不能让通用 chat runtime 覆盖这些业务边界。

## 决策驱动因素
- 采用开源 UI/runtime 组件承载对话线程、消息和输入体验。
- 保留 Kerminal 自有消息状态、持久化、Tauri `ai_chat` 调用和工具审批逻辑。
- 让后续真实 token 级流式事件可以继续通过同一个消息 draft 更新路径进入 UI。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| assistant-ui `ExternalStoreRuntime` + primitives | 保留现有状态和业务边界，同时使用 assistant-ui 的 Thread/Message/Composer 能力 | 需要维护本地消息到 `ThreadMessageLike` 的转换 | assistant-ui API 后续升级可能有适配成本 | 前端测试、typecheck、build |
| assistant-ui `LocalRuntime` | 接入最简单，runtime 能直接管理消息 | 会重写现有历史、上下文、provider 和工具审批状态 | 与 Kerminal 业务状态重复甚至冲突 | 需要大范围迁移验证 |
| 继续手写 UI + Streamdown | 迁移成本最低 | 用户要求“直接替换成 assistant-ui”未满足，后续对话能力仍要手搓 | UI 行为和可维护性持续分散 | 只能验证 Markdown，不能验证 runtime 集成 |

## 决策
采用 `@assistant-ui/react` 的 `useExternalStoreRuntime`、`AssistantRuntimeProvider`、`ThreadPrimitive`、`MessagePrimitive`、`ComposerPrimitive`，并采用 `@assistant-ui/react-streamdown` 的 `StreamdownTextPrimitive` 渲染 assistant Markdown。

原因：
- assistant-ui 官方文档将 `ExternalStoreRuntime` 定位为接入已有 redux/zustand/自定义状态的方式，由应用提供 messages、转换器和回调。
- 该 runtime 支持通过更新外部 assistant draft 消息实现 streaming，不要求替换现有后端协议。
- `react-streamdown` 是 assistant-ui 集成的 Streamdown 渲染层，可复用 streaming Markdown、代码块和表格能力。

## 影响
- 正向影响：右侧 AI 对话的线程、消息、输入框和 Markdown 渲染由 assistant-ui 组件承载。
- 负向影响：继续保留 Streamdown/Mermaid 相关依赖，生产构建会出现 Mermaid chunk 大于 500 kB 的提示。
- 需要同步修改：`AiToolContent.tsx`、前端测试 setup、依赖锁文件。

## 回滚或替代
- 若 assistant-ui 在 Tauri WebView 中出现兼容问题，可回滚 `AiToolContent.tsx` 到 ADR-0004 的手写 UI + Streamdown 路径。
- 若后续后端改成标准 data stream protocol，可评估 `@assistant-ui/react-data-stream` 或 AI SDK adapter，但必须先验证工具审批边界。

## 验证
- `npm run test:frontend -- AiToolContent aiAgentApi`
- `npm run typecheck`
- `npm run build`

## 修订关系
- 修订 ADR-0004 的实现方案：Markdown 渲染仍使用 Streamdown，但可见对话 UI 和输入体验改由 assistant-ui primitives 承载。
