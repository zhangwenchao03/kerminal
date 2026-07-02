<div align="center">
  <img src="docs/assets/kerminal-icon.png" width="76" alt="Kerminal logo" />
  <h1>Kerminal</h1>
  <p><strong>一个本地优先的多机器终端工作台。</strong></p>
  <p>
    <sub>Terminal · SSH · GPU Renderer · Split Panes · tmux · Docker / Compose · SFTP · Agent CLI · Codex / Claude Code · Kerminal MCP Server</sub>
  </p>
</div>

![Kerminal live workspace](docs/assets/kerminal-hero.png)

Kerminal 把主机、终端、tmux、容器、SFTP 传输、端口转发、系统状态、命令片段、工作流和外部 Agent 放在同一个桌面工作区里。它的核心不是“多开几个终端”，而是围绕当前目标机器保留上下文、减少来回切换，并让 Codex、Claude 或自定义 CLI 通过 Kerminal MCP Server 受控参与工作。

## 为什么不只是另一个终端

| 亮点 | Kerminal 的优势 |
| --- | --- |
| GPU/WebGL 终端渲染 | 终端支持 CPU、GPU 和自动 WebGL 渲染模式；高输出日志、构建、训练和远程排障场景优先释放主线程压力，异常时自动回退到 CPU，并在设置里暴露 renderer、PTY flush、输出待写入和建议队列诊断 |
| 分屏工作台 | 多 tab、多分屏、pane 拖动重排/交换、批量发送和命令块色条导航都围绕当前机器组织；看日志、跑构建、连 tmux、查服务不用在多个窗口之间找上下文 |
| Agent CLI 一等适配 | Codex CLI、Claude Code / Claude CLI 和自定义 Agent CLI 都按终端 Tab 绑定成持久会话；每个会话有独立 workspace、`AGENTS.md` / `CLAUDE.md` / MCP 配置和目标快照，不把模型 provider、工具批准或审计硬塞进终端本体 |
| 远程运维闭环 | SSH 主机上下文里直接进入 Docker/Podman/Compose、tmux、SFTP、端口转发、系统/GPU 状态和命令历史；Kerminal MCP Server 只暴露运行态工具，让外部 Agent 能操作当前目标但不绕过 host 自己的审批边界 |
| 本地优先与可控配置 | 主机、设置、profile、片段和 workflow 以 `~/.kerminal` TOML 为事实源，凭据进 encrypted vault；外部 Agent 可以直接改文件并跑 validator，坏配置保留 last-known-good |

## 最新入口

| 区域 | 当前行为 |
| --- | --- |
| 主机侧边栏 | 添加 Local、SSH、RDP、Telnet、Serial；分组、标签、认证和跳板机都从这里管理 |
| Docker / Compose | 不在“新增主机”里添加；右击某个 SSH 主机，选择“容器”进入该主机的 Docker/Podman/Compose 管理 |
| 工作区中间 | 多 tab、多分屏、GPU/CPU/Auto renderer、终端命令块、SFTP 传输 Tab、pane 拖动重排/交换、批量发送和输出保护 |
| 右侧工具栏 | Agent Launcher、系统、文件、端口、tmux、片段、日志、设置；文件工具保留右侧随手浏览，传输工作台可独立成 Tab |
| 设置 | 搜索设置；分为界面外观、终端、命令提示、SFTP、MCP、同步、桌面、快捷键列表和关于；终端页可切换 GPU 渲染并查看 runtime diagnostics |
| 文件型配置 | `~/.kerminal` 下的 TOML 是事实源；settings/profile/host/snippet/workflow 外部写入后自动刷新 |

## 快速上手

1. 点左下角 `+` 添加 Local、SSH、RDP、Telnet 或 Serial 目标。
2. 打开 SSH 主机后，在中间工作区分屏看日志、跑命令；拖动 pane 标题栏可以移动或交换分屏位置。
3. 需要容器时，右击左侧 SSH 主机，打开“容器”；Compose 项目会按应用折叠，展开后查看服务容器、YAML、日志和固定入口。
4. 远端已有 tmux 时，打开右侧 `tmux` 工具，直接 attach 到现有 session，或为当前目标新建持久会话。
5. 用右侧“文件”做当前目标的 SFTP 浏览和轻量操作；需要长传输或跨主机复制时，从主机上下文打开 SFTP 传输 Tab，查看预检、队列、重试和历史。
6. 打开 Agent Launcher 启动 Codex CLI、Claude Code / Claude CLI 或自定义 CLI。Agent 会话按当前终端 Tab 绑定，支持继续已有会话或新建会话，每个会话默认进入 `~/.kerminal/agents/sessions/<agentSessionId>` 并通过 session-scoped MCP 配置访问 Kerminal 运行态工具。

## 当前界面

这些截图来自当前运行界面采集，按真实使用路径排列。Docker / Compose 的入口在 SSH 主机右键菜单，不在新增主机弹窗里。

### 连接管理

新增主机只负责 Local、SSH、RDP、Telnet 和 Serial。容器属于已连接主机的上下文能力。

![Kerminal connection dialog](docs/assets/kerminal-connect.png)

### 主机右键容器管理

从左侧 SSH 主机右键打开“容器”，可以查看 Docker/Podman 容器和 Compose 应用。Compose 项目支持应用折叠、服务容器展开、只读 YAML、日志入口、轻量状态和固定到侧栏。

![Kerminal Docker and Compose management](docs/assets/kerminal-docker.png)

### Agent Launcher

右侧工具栏直接启动 Codex CLI、Claude Code / Claude CLI 或自定义 CLI。会话按工作区终端 Tab 隔离，可以继续已有会话或新建会话，并自动生成会话级 workspace 与 MCP 配置。Kerminal 不内置模型 provider；外部 Agent 自己负责工具批准、权限和审计，Kerminal MCP Server 只提供受控运行态 tools。

![Kerminal Agent Launcher](docs/assets/kerminal-agent.png)

### tmux 会话

当前目标支持 tmux 时，右侧面板会显示版本、session 列表、attach 命令、创建/重命名/结束会话和常用 prefix 快捷键。

![Kerminal tmux session manager](docs/assets/kerminal-tmux.png)

### 系统状态

系统面板围绕当前目标展示 CPU、内存、磁盘、网络、进程、运行体检和 GPU 摘要，适合开发、推理、训练和远程排障。

![Kerminal GPU and system monitor](docs/assets/kerminal-gpu.png)

### 文件传输

SFTP 既可以作为右侧文件工具随当前目标浏览，也可以作为独立传输 Tab 长时间运行。传输工作台支持双栏浏览、上传下载、远端复制、服务器到服务器跨主机复制、冲突预检、传输队列、失败重试、运行诊断和远程文本预览。

![Kerminal SFTP transfer workbench](docs/assets/kerminal-sftp.png)

### 设置

设置支持本地搜索和分类跳转，集中管理界面外观、终端、命令提示、SFTP、Kerminal MCP Server、同步、桌面剪贴板/通知/日志、快捷键和关于信息。终端页包含 CPU/GPU/自动 WebGL 渲染模式、renderer diagnostics、输出待写入、PTY 待 flush、建议队列和 SFTP active transfers。

![Kerminal settings](docs/assets/kerminal-settings.png)

## 能力地图

| 能力 | 用户得到什么 |
| --- | --- |
| 多协议主机 | Local、SSH、RDP、Telnet、Serial；支持分组、标签、密码/私钥/agent、代理、跳板机和连接检查 |
| 终端工作台 | 多标签、多分屏、pane 拖动重排/交换、批量发送、命令块色条导航、搜索、右键菜单、断开重连、输出保护、CPU/GPU/Auto renderer 和运行时诊断 |
| tmux 管理 | 当前目标 tmux 探测、版本展示、session 列表、attach 命令、创建/重命名/结束/Detach、prefix 快捷键速查 |
| 容器操作 | SSH 主机右键 Docker/Podman 容器列表、Compose 项目折叠/展开、服务容器分组、只读 Compose YAML、进入终端、固定到侧栏、启动/停止/重启/删除、详情、日志和容器文件 |
| 文件操作 | 右侧 SFTP 文件工具、独立 SFTP 传输 Tab、双栏浏览、上传下载、目录传输、远端复制、跨主机复制、冲突预检、冲突策略、传输队列、失败重试、运行诊断、远程文本预览和远程工作区编辑 |
| 网络与隧道 | SSH local/remote/dynamic forwarding、主机网络助手、本机受管 HTTP CONNECT proxy、远端 SOCKS、无外网主机借本机网络出口 |
| 机器观测 | CPU、核心占用、内存、Swap、磁盘、网络接口、进程、运行体检、诊断包、GPU 名称/驱动/显存/占用/温度 |
| 外部 Agent 协作 | Codex CLI、Claude Code / Claude CLI、自定义 Agent CLI；按终端 Tab 绑定的持久会话；继续/新建会话；会话级 `AGENTS.md` / `CLAUDE.md` / `.codex/config.toml` / `.mcp.json`；Kerminal MCP Server 提供 `kerminal.app_guide` 应用导航入口、`kerminal.config_guide` 配置规则入口、`kerminal.capabilities` 自发现入口、`kerminal.tool_help` schema/示例/安全标注入口、`kerminal.operation_guide` 任务意图操作指南、`kerminal.runtime_snapshot` 运行态概览，以及终端、SSH/SFTP、tmux、容器、端口转发、服务器信息、命令历史、诊断和授权凭据工具 |
| 配置与热刷新 | `~/.kerminal` 下 settings、profiles、hosts、snippets、workflows 文件优先；外部写入自动刷新；坏 TOML 保持 last-known-good；设置页支持搜索分类，validator 暴露给外部 Agent |
| 桌面集成 | Tauri window-state、single-instance、原生文本剪贴板、系统通知、应用日志和最小 capability 配置 |

## 本地运行

```powershell
npm install
npm run dev
```

桌面壳调试：

```powershell
npm run tauri:dev
```

生产前端构建：

```powershell
npm run build
```

刷新 README 截图时，先启动 dev server，再运行：

```powershell
node scripts/capture-readme-screenshots.mjs http://127.0.0.1:<port>/
```

## 本地边界

Kerminal 是本地桌面应用，默认把工作区状态、会话、主机、文件传输和设置保存在本机。当前 SSH 密码和内联私钥通过保存链路写入本地 encrypted vault；主机 TOML 只保存 `secret_ref`，运行 SSH、SFTP、Docker 容器、端口转发、命令建议和 Kerminal MCP 工具时按需解密复用同一份认证信息。

Kerminal MCP Server 面向 Codex、Claude 和其它 MCP host 时只提供运行态 tools。生产主机、破坏性命令、远程写操作、文件删除和外部发布的批准流程由外部 Agent host 负责；Kerminal 只做工具目录、参数边界、loopback/Host 校验和输出脱敏。

文件优先版本不自动读取或迁移早期一体化 SQLite 数据库。升级前如需保留旧数据，请先备份应用数据目录；新版本以 TOML 配置文件和命令域 SQLite 作为当前事实源。settings、profiles、hosts、snippets 和 workflows 的人工/Agent 修改都应直接落到 `~/.kerminal` 文件，再用 validator 校验。

## 适合谁

- 经常同时操作本机、跳板机、云服务器、GPU 机器、容器、开发板和串口设备的人。
- 希望把 GPU 渲染终端、多分屏、文件、监控、脚本、tmux 和端口转发收进同一个本地工作台的人。
- 想让 Codex CLI、Claude Code / Claude CLI 或自定义 Agent CLI 通过受控工具参与排障和开发，但不想给它们无限 shell/凭据权限的人。

## 设计取向

Kerminal 追求的是克制、密度和可控。主机在左，工作区在中间，工具在右；高频操作贴近当前目标，复杂环境不再把上下文打散。

## 开源协议

Kerminal 源代码以 GNU Affero General Public License v3.0 only（AGPL-3.0-only）授权，详见 [LICENSE](LICENSE)。

Kerminal 名称、Logo、图标、截图和其它品牌资产不随 AGPL 授权，未经许可不得用于表示官方版本、官方背书或造成来源混淆；详见 [TRADEMARKS.md](TRADEMARKS.md)。
