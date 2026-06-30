# Remote Container Workspace 调研记录

## 目标

调研 VS Code、JetBrains IDEA/Gateway、GitHub Codespaces/Dev Containers 以及 Docker/Rust 生态，回答 Kerminal 是否适合实现：

- 用户先连接一个指定 SSH 主机。
- Kerminal 自动发现该主机上的 Docker/Podman 容器。
- 用户可以像打开 SSH 一样打开容器终端，并为同一容器创建多个会话。
- 右侧文件面板可以浏览容器内文件，支持上传、下载和常见文件操作。

本文是调研证据和结论摘要；长期决策见 [ADR-0008](../decisions/ADR-0008-remote-container-workspace.md)。早期 `plan/next/2026-06-18-remote-container-workspace.md` 长期候选计划已在 2026-06-24 整理时删除，后续容器工作区实施应另开小切片计划。

## 外部实现观察

| 对象 | 观察 | 对 Kerminal 的启示 |
| --- | --- | --- |
| VS Code Dev Containers | 支持 `Attach to Running Container`，也支持先通过 Remote-SSH 打开远程主机上的文件夹，再 `Reopen in Container`。连接后新终端默认运行在容器中。也支持把 Docker client 指向远程 Docker host，例如 `DOCKER_HOST=ssh://user@host`。 | 容器应作为一等 remote target；“远程主机 -> 容器”的层级符合主流工具心智。SSH 是连接宿主机/daemon 的传输，不是要求容器运行 sshd。 |
| VS Code Dev Containers FAQ | 单个 VS Code window 当前只能连接一个 container，但可以开多个 window 或通过 Compose 管多个配置。 | Kerminal 如果要在一个工作台内开多个容器，需要自己的 target/session 抽象，不能照搬 VS Code 的 window 级 remote 模型。 |
| JetBrains Dev Containers/Gateway | 支持在远程机器上创建 Dev Container；远程场景要求远端有 Docker，Gateway/Client 连接后由后端 IDE 工作。JetBrains Docker 设置也支持经 SSH 连接远程 Docker daemon。远程项目的文件由 backend 管理，客户端提供上传/下载入口。 | JetBrains 的模型是“后端 IDE 运行在远端/容器”，不是把容器伪装成 SFTP；Kerminal 应把执行、文件、IDE/AI 能力分别建模。 |
| GitHub Codespaces | 使用 `devcontainer.json` 定义容器环境，包含工具、扩展、端口转发和 Feature。Codespaces 是托管 VM + 容器环境，不是任意 SSH 主机上的容器浏览器；仓库工作区通常位于持久的 `/workspaces`，再挂载进 dev container。 | `devcontainer.json` 适合“创建/重建开发环境”，不适合作为 Kerminal 连接任意已有容器的核心协议。Kerminal 不应默认假设容器 rootfs 就是持久 workspace。 |
| Dev Containers Spec / CLI | `devcontainer.json` 定义 `remoteUser`、`containerUser`、生命周期命令、features、mounts、ports 等。`devcontainers/cli` 源码中把容器封装为 `remoteExec` 和 `remotePtyExec`，底层生成 `docker exec -i [-t] [-u user] [-e ...] [-w cwd] container cmd args`。 | devcontainers/cli 证明“容器执行目标”是核心抽象；Kerminal 应先实现通用 ExecutionTarget，再把 Dev Containers 作为可选工作区生命周期层。 |

## Docker 官方能力边界

Docker Engine API 提供了实现容器终端和文件传输的关键端点：

- `GET /containers/json`：列出容器。
- `GET /containers/{id}/json`：inspect 容器。
- `POST /containers/{id}/exec`：创建容器内 exec 实例。
- `POST /exec/{id}/start`：启动 exec；交互模式返回 raw/multiplexed stream。
- `POST /exec/{id}/resize`：调整 exec TTY 尺寸，前提是创建/启动时启用 TTY。
- `HEAD /containers/{id}/archive`：返回路径 stat 信息，响应头包含 `X-Docker-Container-Path-Stat`。
- `GET /containers/{id}/archive?path=...`：把容器内路径作为 tar archive 下载。
- `PUT /containers/{id}/archive?path=...`：把 tar archive 解包到容器目录。

Docker CLI 文档也确认：

- `docker exec` 支持 `-i`、`-t`、`-u`、`-e`、`-w`，但 paused container 不能 exec。
- `docker cp` 可以把容器内文件输出为 tar stream，也可以用 `-` 从 stdin/stdout 传 tar。
- `/proc`、`/sys`、`/dev`、tmpfs 和部分 mount 有 copy 限制，需要显式 `docker exec tar` 兜底。

## 文件系统关键结论

容器文件能力不能实现为 SFTP。原因：

- Docker 没有 SFTP server，也没有通用目录 listing API。
- Docker archive API 很适合上传/下载和单路径 stat，但不适合高效列目录。
- 删除、重命名、chmod、mkdir 等操作需要 exec 容器内命令，或者用 archive API 做受限替代。

因此容器文件面板应是一个 `RemoteFileSystem` adapter：

- 传输：优先 Docker archive API 或 Docker CLI tar stream。
- 目录列表和文件管理：优先 exec 一个受控、能力探测后的 POSIX helper；对 distroless/no-shell 容器降级为只读/有限能力。
- UI 不展示为 “SFTP”，而展示为通用 “Files”，每个 target 暴露 capabilities。

## Rust / 第三方包观察

| 候选 | 适用点 | 风险 | 结论 |
| --- | --- | --- | --- |
| `bollard` | async Rust Docker/Podman API client，`0.21.0` 已发布；docs.rs 显示有 `create_exec`、`start_exec`、`resize_exec`、`attach_container`、`download_from_container`、`get_container_archive_info`、`upload_to_container` 等能力。启用 `ssh` feature 后可走 `ssh://user@host`，内部依赖 OpenSSH/dial-stdio 类路径。 | SSH feature 通常更适合 key/agent；密码登录和复杂交互仍可能需要 Kerminal 自己的兼容路径。archive stream 仍需要项目侧封装 tar/list/stat 语义。 | 推荐作为 Docker Engine API adapter 的主依赖。 |
| `docker-api` crate | 高层 container API，docs.rs 显示支持 attach、exec、copy_from/copy_to。 | 版本和 Docker API 新鲜度明显落后于 `bollard`；没有一等 SSH connector。 | 作为备选，不作为首选。 |
| Docker CLI + OpenSSH | 与 Docker 官方远程 SSH 工作流兼容，远端只要有 Docker CLI；实现诊断和兜底最直接。 | 输出解析、shell quoting、能力探测、错误归一化和取消控制更难；长期可测试性弱于 Engine API。 | 作为 fallback/诊断/兼容 adapter，不应泄漏到业务层。 |
| `devcontainers/cli` | 成熟处理 `devcontainer.json`、build/rebuild、features、生命周期命令，npm 包维护活跃。 | TypeScript/Node 工具，定位是创建和管理 dev container 工作区，不是通用容器终端/文件面板 runtime。 | 作为后续 Dev Container workspace 创建/重建能力的可选外部工具，不作为核心文件/终端实现。 |
| Rust `tar` crate | 与 Docker archive API 天然匹配，用于读取/写入 tar stream、单文件 preview、目录打包/解包。 | 需要自己处理权限、mtime、symlink、路径穿越防护和大文件流式进度。 | 推荐引入。 |

## 项目内现状

- SSH 终端当前通过 `SshTerminalService` 把远程会话解析成一个本地 OpenSSH PTY 命令，再交给 `TerminalManager` 管输入、resize、关闭、日志和输出快照。
- SFTP 当前已有 native `russh` + `bssh-russh-sftp` 后端、传输队列、进度、取消、归档和剪贴板能力。
- `SftpService` 内部有 `SftpBackend` trait，但请求模型仍是 `hostId + path`，不是通用 target。
- 前端 `SftpToolContent` 只在 `selectedMachine.kind === "ssh"` 时工作，所有操作都传 `hostId`。
- `MachineKind` 目前只有 `local | ssh | group`；领域文档已经把 Host 定义成未来可包含容器或 WSL 的连接目标。

## 最终判断

这件事不算“难到不能做”，但不能按“给 SFTP 增加一种 hostId”处理。终端部分相对直观，核心难点是：

- target identity 要从 `hostId` 升级为 `Local/SshHost/DockerContainer/...`。
- 文件服务要从 `SftpService` 升级为协议无关的 `RemoteFileSystemService` 和 `TransferService`。
- Docker remote transport 要有 adapter 层，避免把 Engine API、Docker CLI over SSH、Podman 差异扩散到 UI 和业务服务。
- 容器文件能力必须有 capabilities 和降级策略，尤其是 no-shell/distroless、paused/stopped、read-only rootfs、权限不足等场景。

## 参考链接

- [VS Code: Attach to a running container](https://code.visualstudio.com/docs/devcontainers/attach-container)
- [VS Code: Developing inside a Container](https://code.visualstudio.com/docs/devcontainers/containers)
- [VS Code Dev Containers FAQ](https://code.visualstudio.com/docs/devcontainers/faq)
- [VS Code: Develop on a remote Docker host](https://code.visualstudio.com/remote/advancedcontainers/develop-remote-host)
- [VS Code Remote Development overview](https://code.visualstudio.com/docs/remote/remote-overview)
- [JetBrains: Start Dev Container for a remote project](https://www.jetbrains.com/help/idea/start-dev-container-for-a-remote-project.html)
- [JetBrains: Dev Container overview](https://www.jetbrains.com/help/idea/connect-to-devcontainer.html)
- [JetBrains: Docker connection settings](https://www.jetbrains.com/help/idea/settings-docker.html)
- [JetBrains: Work inside remote project](https://www.jetbrains.com/help/idea/work-inside-remote-project.html)
- [JetBrains: FAQ about Dev Containers](https://www.jetbrains.com/help/idea/faq-about-dev-containers.html)
- [GitHub Codespaces: Deep dive](https://docs.github.com/en/codespaces/about-codespaces/deep-dive)
- [GitHub Codespaces: Introduction to dev containers](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers)
- [Development Containers Specification](https://containers.dev/implementors/spec/)
- [Dev Container metadata reference](https://devcontainers.github.io/implementors/json_reference/)
- [Dev Containers CLI](https://github.com/devcontainers/cli)
- [Docker Engine API v1.54 OpenAPI](https://docs.docker.com/reference/api/engine/version/v1.54.yaml)
- [Docker CLI: docker container exec](https://docs.docker.com/reference/cli/docker/container/exec/)
- [Docker CLI: docker container cp](https://docs.docker.com/reference/cli/docker/container/cp/)
- [`bollard` docs.rs](https://docs.rs/bollard/latest/bollard/struct.Docker.html)
- [`bollard` crates.io](https://crates.io/crates/bollard)
- [`docker-api` docs.rs](https://docs.rs/docker-api)
- [`docker-api` crates.io](https://crates.io/crates/docker-api)

