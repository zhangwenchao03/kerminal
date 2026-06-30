# Kerminal 领域上下文

## 术语

### Kerminal

- 含义：多平台开发者终端工作台，整合本地终端、SSH/SFTP、分屏、主机管理、脚本片段、服务器信息和 AI Agent。
- 不等于：只执行命令的一次性 shell wrapper，也不是纯聊天 AI 应用。
- 常见同义词：terminal 产品、终端工作台、开发终端。
- 代码入口：待实现。
- 示例：用户打开 Kerminal 后直接进入左侧主机树、中间终端、右工具面板的工作台。

### Host

- 含义：可被 Kerminal 打开的本地或远程执行目标，包括本地 shell profile、SSH 主机、后续可能的容器或 WSL 目标。用户可见文案统一称“主机”。
- 不等于：只表示物理服务器；本地环境也可以是主机。
- 常见同义词：服务器、连接目标、host。
- 代码入口：`src/features/workspace/types.ts` 当前历史类型名仍为 `Machine`，对外文案使用“主机”。
- 示例：左侧“虚拟机/云服务器”分组中的一条 SSH 主机记录。

### Host Group

- 含义：左侧主机树里的分组文件夹，用于组织本地 profile、SSH 主机或未来连接目标。
- 不等于：权限组或团队组织。
- 常见同义词：分组、文件夹、host group。
- 代码入口：`src/features/workspace/types.ts` 当前历史类型名仍为 `MachineGroup`，对外文案使用“主机分组”。
- 示例：“云服务器”分组下有 7 台主机。

### Terminal Session

- 含义：Rust 侧持有的一个本地 PTY 或远程 SSH shell 会话，拥有稳定 session id、输入输出流和生命周期。
- 不等于：React tab；一个 tab 可以包含多个 session/pane。
- 常见同义词：会话、PTY 会话、SSH 会话。
- 代码入口：待实现。
- 示例：用户在一个 pane 中打开 PowerShell 后产生一个 Terminal Session。

### Terminal Pane

- 含义：中间终端主体中的一个可见终端区域，承载一个 Terminal Session。
- 不等于：完整 tab 或 workspace。
- 常见同义词：分屏、pane、终端面板。
- 代码入口：待实现。
- 示例：右侧聚焦的远程 SSH pane，显示蓝色焦点边框。

### Workspace

- 含义：一组 tabs、panes、hosts、cwd、profile 和工具面板状态的可恢复布局。
- 不等于：单个项目目录；项目目录可以是 workspace 的属性。
- 常见同义词：工作区、布局。
- 代码入口：待实现。
- 示例：一个 workspace 同时打开本地前端、后端 SSH 和日志 pane。

### Tool Panel

- 含义：右侧工具区的详情面板，用于展示 AI、SFTP、服务器信息、主机配置、片段、日志和设置等工具。
- 不等于：普通弹窗；它是工作台常驻区域。
- 常见同义词：右侧工具、工具区、inspector。
- 代码入口：待实现。
- 示例：当前 SSH 主机的 CPU、内存、网络和磁盘信息卡。

### AI Agent

- 含义：Kerminal 内置智能体，使用 Rig 做 LLM Agent 编排，能读取受控上下文并通过 rmcp/Kerminal Tool Registry 操作终端、SSH/SFTP、配置、主题、片段和工作区。
- 不等于：只能回答问题的聊天窗口，也不等于能绕过应用权限的系统 shell。
- 常见同义词：AI、智能体、agent。
- 代码入口：待实现。
- 示例：AI 根据当前终端报错创建一个修复命令，经用户确认后写入当前 pane。

### Tool Registry

- 含义：Kerminal 内部业务工具目录，统一定义 UI、命令面板、快捷键、AI 和 rmcp/MCP 可调用的应用能力，并保存风险等级、确认策略和审计元数据。
- 不等于：第三方插件市场。
- 常见同义词：工具注册表、action registry、能力注册表。
- 代码入口：待实现。
- 示例：`terminal.write`、`remote.connect_ssh`、`sftp.upload`、`settings.update_theme` 都是工具。

### LLM Provider

- 含义：用户配置的模型服务端点，包括 Rig provider 类型、base URL、API key credential ref、model 和上下文策略。
- 不等于：固定的单一供应商。
- 常见同义词：模型配置、AI Provider、OpenAI-compatible endpoint。
- 代码入口：待实现。
- 示例：用户在设置里添加一个本地或远程 LLM 地址。

### Credential Ref

- 含义：SQLite 中保存的凭据引用，真实密钥存 OS keychain 或本地加密存储。
- 不等于：密码、API key 或私钥明文。
- 常见同义词：凭据引用、secret ref。
- 代码入口：待实现。
- 示例：RemoteHost 只保存 `credentialRef`，不保存 SSH 密码明文。

## 状态与生命周期

### Terminal Session

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `creating` | 正在创建 PTY 或 SSH shell | 用户、AI 或 workspace 请求打开终端 | 创建成功或失败 |
| `running` | 会话可输入输出 | shell 启动成功 | 用户关闭、进程退出或连接断开 |
| `exited` | shell 正常退出 | 进程返回退出码 | 用户清理 pane 或重新打开 |
| `disconnected` | 远程连接断开但 pane 仍保留 | SSH 网络断开或用户断开 | 重连或关闭 |
| `failed` | 创建或运行失败 | PTY/SSH/SFTP 错误 | 用户关闭或重试 |

### AI Tool Call

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `planned` | AI 计划调用工具 | 模型输出工具调用意图 | 进入确认或执行 |
| `awaiting_confirmation` | 等待用户确认 | 工具风险等级需要确认 | 用户批准或取消 |
| `running` | 工具正在执行 | 工具获得执行许可 | 成功、失败或取消 |
| `success` | 工具执行成功 | service 返回成功 | 审计完成 |
| `failed` | 工具执行失败 | service 返回错误 | 审计完成 |
| `cancelled` | 用户或策略取消 | 用户拒绝或 policy 拦截 | 审计完成 |

## 关系与边界

- Host 由 Host Group 组织；Host 可以打开一个或多个 Terminal Session。
- Terminal Pane 是 UI 容器；Terminal Session 是 Rust 管理的运行态。
- Workspace 保存布局和引用，不直接拥有凭据明文。
- Tool Panel 展示当前 context 下的工具；工具的真实操作必须走 Rust Command/Service。
- AI Agent 通过 Rig 编排，只能经 rmcp/Kerminal Tool Registry 操作应用能力。
- LLM Provider 管模型连接；Credential Ref 管密钥引用。
- rmcp/MCP 是功能调用和未来外部暴露/接入能力的协议层，不是内部权限模型的替代品。

## 待确认

- 第一版 Rig Provider 是否内置具体模板：OpenAI-compatible、Ollama、本地模型。
- 第一批 shell integration 支持顺序：PowerShell、zsh、bash、fish。
- SSH 底层库最终选择：`russh`、libssh2 绑定或受控系统 `ssh`。
