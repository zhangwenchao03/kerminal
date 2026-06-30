# ADR-0004: AI 对话流式 Markdown 渲染方案

## 状态
Accepted

## 背景
- 右侧 AI 对话当前只渲染纯文本，发送时等待 `ai_chat` 完整返回后才追加 assistant 消息。
- 用户要求体验接近 Codex 对话：展示过程、渐进输出、Markdown 渲染，并优先采用开源框架或组件。
- 现有面板已经承载 Kerminal 特有能力：终端上下文、本地历史、Provider 选择、工具建议和审批链。

## 决策驱动因素
- 尽量复用开源组件处理 Markdown、代码块、表格和不完整流式片段。
- 不让外部 chat runtime 接管 Kerminal 已有 Tauri 调用和工具审批边界。
- 先形成可测试的垂直体验，后续能平滑替换为 Rig token 级真实流式事件。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| assistant-ui 全套 runtime | 现成 chat 组件、runtime、工具调用抽象完整 | 会重写当前本地历史、工具审批和 Tauri 调用边界 | 与现有模型重复，迁移面大 | 需要原型验证 runtime adapter |
| Vercel AI Elements + AI SDK | 与 AI SDK 生态匹配，组件覆盖 message/reasoning/tool | 更偏 HTTP route/useChat，当前 Tauri invoke 需要额外 adapter | 可能引入不必要框架约束 | 需要评估 Tauri event/HTTP bridge |
| Streamdown + 现有面板状态 | 专注流式 Markdown，React 19 可用，接入面小 | chat 流程和过程 UI 仍由本项目状态机承载 | 后端真流式需后续单独接入 | 前端测试、typecheck、build |

## 决策
采用 Streamdown 作为 assistant Markdown 渲染组件，并在现有 AI 面板上增加渐进输出状态。

原因：
- Streamdown 官方定位是 AI 流式 Markdown 的 `react-markdown` 替代品，能处理不完整 Markdown、GFM、代码块和安全渲染。
- 它可以作为局部组件接入，不会接管 Kerminal 的 Provider、终端上下文、历史和工具审批模型。
- 现有后端 `rig-core` 已有 `StreamingPrompt` 能力，后续可以把真实 token stream 接入同一个前端流式回调接口。

## 影响
- 正向影响：右侧 AI 对话支持 Markdown 与渐进输出，过程状态更接近开发者 Agent 对话。
- 负向影响：新增 Streamdown 及其渲染依赖，构建包体会增加。
- 需要同步修改：前端依赖、全局样式、AI API 包装、AI 面板测试。

## 回滚或替代
- 如果 Streamdown 在 Tauri WebView 或构建中有兼容问题，回滚依赖和 Markdown 组件，临时恢复纯文本渲染。
- 若后续需要完整 chat runtime，再以 assistant-ui 或 AI Elements 做独立原型，验证能否承接 Kerminal 工具审批后再迁移。

## 验证
- `npm run test:frontend -- AiToolContent aiAgentApi`
- `npm run typecheck`
- `npm run build`
