# ADR-0008: Remote Container Workspace Target Architecture

## 状态

Proposed

## 背景

- Kerminal 已有本地终端、SSH 终端、原生 SFTP 文件工具和右侧工具面板。
- 用户希望连接一个指定 SSH 主机后，能看到该主机下所有 Docker 容器；进入容器后体验接近普通 SSH：可创建多个终端会话，右侧文件面板可浏览、上传、下载容器内文件。
- 现有 SSH/SFTP 能力以 `hostId` 为中心，无法表达 “SSH host 下的 Docker container” 这种嵌套 target。
- 容器没有 SFTP 协议；Docker 文件传输主要通过 archive/tar 和 exec 实现。
- VS Code、JetBrains 和 Codespaces 的主流实现都不是要求容器内运行 `sshd` 或 SFTP server；SSH 更多是连接宿主机、Docker daemon 或远程 IDE backend 的传输层。

## 决策驱动因素

- 长期使用：架构要容纳 Local、SSH、Docker Container、后续 WSL/Kubernetes Pod，而不是只补一个 Docker 特例。
- 用户体验：容器终端和文件面板要接近 SSH/SFTP 的日常操作体验。
- 协议诚实：不把容器文件能力伪装成 SFTP；每种 target 暴露真实 capabilities 和限制。
- 可测试：核心逻辑依赖 trait/adapter，可用 fake adapter 覆盖队列、终端、文件和错误路径。
- 安全：Docker socket 权限接近宿主机 root 权限，远程 Docker 连接必须有显式信任、审计和生产确认。
- 生态复用：尽量使用 Docker Engine API、`bollard`、Docker CLI/devcontainers CLI 等成熟能力，但不能让外部工具形态污染 Kerminal 的领域模型。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| 在现有 SSH terminal 上直接拼 `ssh host docker exec -it`，文件面板继续叫 SFTP | 实现最快；复用当前 PTY | 文件不是 SFTP；hostId/path 模型错误；安全和错误处理散落 | 后续支持 Podman、WSL、K8s、Dev Containers 会继续堆特例 | 不采用 |
| 为 Docker 单独做 `DockerTerminalService` 和 `DockerFilePanel` | 局部清晰；不会破坏 SFTP | UI/队列/终端生命周期重复；多 target 能力割裂 | 形成第二套文件管理器和第二套 transfer queue | 不采用 |
| 抽象 `RemoteTarget`、`RemoteExecutionService`、`RemoteFileSystemService`、`TransferService`，SFTP 和 Docker 都做 adapter | 领域模型正确；可扩展；可测试；UI 可统一 | 重构面较大，需要迁移 SFTP API 和前端状态 | 初期设计必须控制接口粒度，避免空泛 wrapper | 采用 |
| 直接集成 `devcontainers/cli` 作为核心 runtime | 成熟支持 devcontainer.json、features、生命周期 | 它不是通用终端/文件系统 runtime；依赖 Node/TS 外部进程；难控制 UI 交互 | attach 任意已有容器和文件面板仍要自研 | 作为可选 Dev Container workspace 层，不作为核心 |
| 全部使用 Docker CLI over SSH | 远程 SSH 主机容易兜底；兼容 Docker 官方 ssh transport 心智 | 输出解析、注入防护、取消、错误归一化和测试较弱 | 长期维护受 CLI 文本输出影响 | 作为 fallback/诊断/兼容 adapter |
| 全部使用 Docker Engine API + `bollard` | 结构化 API；流式传输；和 tokio/Tauri 后端匹配；`bollard` 当前支持 local socket、npipe、TCP/TLS 和 `ssh` feature | 密码式 SSH、复杂交互式 SSH 配置可能仍需 fallback；某些文件操作仍需 exec helper | 需要处理 archive/tar、no-shell 降级和 Docker API 更新 | 作为主语义和首选 adapter |

## 决策

采用通用 remote target 架构：

- 新增一等 `RemoteTarget` / `ExecutionTarget` / `FileTarget` 模型，表达 Local、SSH Host、Docker Container 等目标。
- 新增 `RemoteExecutionService`，统一普通命令执行和交互式 PTY 会话；Docker container 通过 Docker exec 创建独立会话，每开一个 pane 就创建一个 exec instance。
- 新增 `RemoteFileSystemService`，统一 list/stat/preview/mkdir/delete/rename/chmod/upload/download；SSH 目标由现有 SFTP 后端适配，Docker 目标由 Docker archive + exec helper 适配。
- 新增或泛化 `TransferService`，把现有 SFTP transfer queue 迁到协议无关队列；SFTP、Docker container、未来 WSL/K8s 都通过 adapter 提供数据流。
- 右侧工具从产品语义上升级为 “Files”；SFTP 是 Files 的一个 backend，而不是唯一入口。
- Docker runtime 采用 adapter 分层：
  - `DockerEngineAdapter`：以 Docker Engine API 为主语义；本地 socket/npipe、TCP/TLS 和 SSH daemon 连接优先使用 `bollard`。
  - `DockerCliOverSshAdapter`：远程 SSH 主机的兼容/兜底路径，服务于密码登录、复杂 SSH 配置、诊断模式或 `bollard` SSH transport 不可用的环境；隐藏在 adapter 后，不让 UI 和业务服务依赖 CLI 输出。
- `devcontainers/cli` 只作为后续 “创建/重建 Dev Container 工作区” 的外部工具集成，不作为核心终端和文件能力。

## 影响

- 正向影响：
  - 容器、SSH、未来 WSL/K8s 共享终端、文件、传输、审计和 AI tool registry。
  - 文件面板不再被 SFTP 语义锁死，用户可在同一 UI 中浏览 SSH 和容器。
  - Docker 能力通过 adapter 可替换，便于先兼容 remote SSH，再引入更原生的 Engine API transport。
- 负向影响：
  - 需要重构现有 `SftpService`、`SftpToolContent`、`Machine`/workspace 类型和 terminal session metadata。
  - 容器目录 listing、rename、delete、chmod 依赖容器内命令能力；distroless/no-shell 容器必须降级。
  - Docker 权限风险高，需要比普通 SSH/SFTP 更明确的信任提示、生产确认和审计。
- 需要同步修改：
  - Rust models、services、Tauri commands、state 注册。
  - TypeScript API、workspace types、machine sidebar、right tool panel、terminal registry。
  - SQLite 持久化：Docker runtime profile、target bookmarks、capability cache、审计事件。
  - 测试：fake adapters、local Docker integration、SSH remote Docker harness、文件/传输合同测试。

## 回滚或替代

- 如果 generic Files 重构风险过高，可保留原 `sftp_*` IPC 作为兼容 wrapper，但内部必须转发到 `RemoteFileSystemService`。
- 如果 `bollard` 在某些平台连接 Docker daemon 不稳定，可只替换 `DockerEngineAdapter`，不影响上层 target/execution/files 接口。
- 如果 `bollard` SSH transport 在某些用户环境不可用，继续使用 `DockerCliOverSshAdapter`，但保持 adapter 边界和合同测试。
- 如果容器文件管理在 no-shell 容器能力不足，UI 根据 capabilities 禁用 list/mutate，只保留 archive download/upload 或明确提示。

## 验证

- 架构合同测试：
  - 同一套 `RemoteFileSystemContract` 覆盖 SFTP fake、Docker fake、真实 local Docker。
  - 同一套 `RemoteExecutionContract` 覆盖 local PTY、SSH adapter、Docker exec adapter。
- 自动化命令：
  - `npm run typecheck`
  - `npm run test:frontend`
  - `npm run test:rust`
  - `cargo fmt --check`
  - `cargo clippy --all-targets --all-features -- -D warnings`
  - 有 Docker 环境时运行 `cargo test docker_container -- --ignored` 或等价 integration suite。
- 手工 smoke：
  - 连接一台 SSH 主机，发现运行中和已停止容器。
  - 打开同一容器两个终端 pane，分别输入输出互不串扰，resize 正常。
  - 在容器 Files 面板 list、preview、upload、download、rename、delete、chmod。
  - paused/stopped/read-only/no-shell 容器显示正确能力和错误。
  - 生产主机执行容器写操作时触发确认和审计。

## 外部依据

- VS Code Dev Containers 支持 attach running container，也支持 Remote-SSH 主机上的 container 工作流。
- JetBrains Dev Containers/Gateway 通过远程后端和 Docker/SSH 连接管理 dev container，而不是把容器当 SFTP。
- GitHub Codespaces 和 Dev Containers Spec 使用 `devcontainer.json` 描述可创建/可重建开发环境。
- Docker Engine API 提供 container list/inspect、exec create/start/resize 和 container archive get/put/head。
- `bollard` 是 async Rust Docker/Podman API client，覆盖 exec、resize、container archive upload/download，并提供 SSH transport 方向。
