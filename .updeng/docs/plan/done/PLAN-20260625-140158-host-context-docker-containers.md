---
id: PLAN-20260625-140158-host-context-docker-containers
status: done
created_at: 2026-06-25T14:01:58+08:00
started_at: 2026-06-25T15:07:29+08:00
completed_at: 2026-06-25T17:04:53+08:00
updated_at: 2026-06-25T17:04:53+08:00
owner: ai
---

# 主机上下文 Docker 容器管理生产级方案

## 目标

- 把 Docker/Podman 容器入口从“添加连接”弹窗迁移到左侧主机列表的主机右键菜单，让容器成为某台主机的运行资产，而不是一种需要单独添加的主机类型。
- 在主机右键菜单中新增 `容器` 入口，打开主机限定的容器管理弹框；弹框内完成容器发现、搜索、分组、进入终端、固定到侧栏、文件、日志、详情、监控和生命周期操作。
- 参考用户给的 Docker 管理界面，但不照搬：学习其信息密度、运行状态、分组和行内动作，按 Kerminal 的机器优先工作台重新设计。
- Apple-inspired 方向：简洁、克制、技术感、低噪声；界面应该像 Kerminal 原生工作台能力，不像外置 Docker dashboard。

## 非目标

- 不把 Kerminal 做成完整 Docker Desktop 替代品；第一阶段不做镜像构建、Compose 编辑器、Dockerfile 编辑器、registry 登录、网络拓扑图或 volume browser。
- 不复制参考图的布局、文案、图标或品牌表达；只吸收“按 Compose/独立容器组织、状态清楚、操作靠近对象”的产品原则。
- 不让“进入容器”强制把容器永久加入侧栏；`进入` 是临时终端动作，`固定到侧栏` 才创建持久容器目标。
- 不绕过现有 SSH 凭据、跳板机、SFTP、容器文件和 MCP tools-only 边界。
- 不在第一阶段自动执行危险命令；停止、删除、强制删除、批量操作必须有明确确认。

## 当前问题

当前代码路径把 Docker 添加挂在主机添加弹窗里：

- `RemoteHostCreateDialog` 的 `docker` mode 先选择 SSH 主机，再选择容器，然后调用 `onAddDockerContainer`。
- `DockerPropertiesPanel` 已能列出容器、选择运行时、包含停止容器、刷新和选择一个容器。
- `MachineSidebar` 的 SSH 主机右键菜单没有容器入口；容器目标只有在已添加到侧栏后才有 `进入容器终端` 和 `打开 SFTP`。
- 后端已有 `docker_list_containers`、`docker_create_container_session` 和容器文件操作；还没有容器 start/stop/restart/remove、inspect、logs、stats 的生产 Tauri command。

这导致用户心智错位：用户不是“添加一台 Docker 主机”，而是在“某台已保存主机上管理和进入容器”。

## 产品学习结论

参考图值得学习的点：

- 顶部用少量统计快速回答 Docker 环境概况：容器、卷、镜像、网络。
- 容器行以运行状态、名称、镜像/路径/端口为主，不塞过多装饰。
- Compose 项目和独立容器分开，用户能先按项目扫，再进入具体容器。
- 高频动作靠近行：进入/启动停止/重启/更多；低频动作进更多菜单。
- 更多菜单里包含详情、日志、终端、监控、删除，说明“容器管理”不只是添加一个入口。

Kerminal 自己的设计取舍：

- 入口从 `主机右键 -> 容器` 出发，弹框标题明确绑定主机，例如 `gpu-server / 容器`。
- 容器弹框是临时 command surface，不是右栏常驻 dashboard；右栏仍保留系统、SFTP、端口、tmux、Agent 等工具。
- 主操作是 `进入`，不是 `添加`；`固定到侧栏` 作为次动作，用于长期工作对象。
- 对开发者友好：显示镜像、端口、状态、container id、runtime、project/compose 标签、最近状态文本；路径/端口长文本可复制。
- UI 保持紧凑 geek：一屏能扫很多容器，但行距、状态、hover、focus 和菜单仍要有 Apple-style 的安静质感。

## 用户体验

### 入口

- 仅对支持容器管理的主机显示 `容器`：
  - 第一阶段：已保存 SSH 主机。
  - 第二阶段：Local 主机可探测本机 Docker/Podman。
  - 容器目标自身右键保留 `进入容器终端`、`打开 SFTP`、`详情`、`从侧栏移除`。
- SSH 主机右键菜单建议顺序：
  - `打开 SSH 终端`
  - `容器`
  - `打开 SFTP`
  - `新建传输 Tab`
  - `编辑连接配置`
  - `复制主机`
  - `添加同组连接`
  - `删除连接`
- `容器` 菜单项使用线性图标，建议 `Box` / `Container` 语义图标；如果图标库没有 Docker 图标，不手绘复杂品牌图标。

### 容器管理弹框

弹框结构：

```text
Host Containers Dialog
├─ Header
│  ├─ Host identity: name, user@host, runtime
│  ├─ Status: available / checking / failed
│  └─ Refresh
├─ Summary Segments
│  ├─ 容器 count
│  ├─ 镜像 count
│  ├─ 卷 count
│  └─ 网络 count
├─ Toolbar
│  ├─ Search
│  ├─ Runtime segmented control: Docker / Podman
│  ├─ Show stopped toggle
│  └─ Group by: Compose / Status / Flat
├─ Container List
│  ├─ Compose project groups
│  ├─ Standalone containers
│  └─ Empty / error / loading states
└─ Footer / Selection Bar
   ├─ selected container summary
   ├─ Enter
   ├─ Pin to Sidebar
   └─ More actions
```

行级信息：

- 左侧状态点：running 绿色、exited 灰色、paused amber、dead red；状态不能只靠颜色，必须有文本 chip。
- 主标题：container name；副信息：image、short id、status text。
- 第三行/右侧元数据：ports、project、runtime、created/updated when available。
- 高频动作：
  - `进入`：打开容器终端，不固定到侧栏。
  - `固定`：创建或更新侧栏容器目标。
  - `文件`：打开容器文件/SFTP 工作台。
  - `更多`：详情、日志、监控、重启、停止/启动、删除。

### 进入容器

- 默认行为：用户点击 `进入` 后，在当前 workspace 打开一个容器终端 pane 或新 tab。
- 不要求先把容器加入侧栏。
- 默认 shell 自动选择 `bash` 或 `sh`；高级选项可设置 user、workdir、shell。
- 如果容器已停止：
  - `进入` disabled，并提示“容器未运行”。
  - 显示 `启动` 主动作；启动成功后可继续进入。
- 如果同一个容器已有打开的 terminal：
  - 默认 focus existing。
  - 更多菜单提供 `新开一个终端`。

### 详情、日志、监控

第一阶段可做轻量详情：

- 基本信息：id、name、image、runtime、status、ports、labels、project。
- 命令预览：显示 Kerminal 将执行的安全摘要，例如 `docker exec -it <container> <shell>`，不展示敏感凭据。

第二阶段补齐：

- `详情`：`docker inspect` 解析重点字段，不直接把完整 JSON 塞满 UI；完整 JSON 可复制。
- `日志`：tail 最近 N 行，支持刷新、follow 开关、复制；默认不无限流。
- `监控`：`docker stats --no-stream` 或短 interval；只显示 CPU、内存、网络、块 IO，避免重 dashboard。

## Apple-inspired UI 规范

产品情绪：`calm / technical / precise`。

视觉原则：

- 弹框宽度建议 820-960px，高度跟随 viewport，最大 80vh。
- Header 和 toolbar 可用轻量 glass；容器列表使用 solid surface，保证密集文本可读。
- 不做大面积高饱和色块；accent 只用于当前选择、主动作和 focus ring。
- 列表行使用 40-52px 视觉节奏；Compose group header 32px 左右。
- 图标 15-17px，stroke 1.75；状态点 8px，状态 chip 11px。
- 菜单、popover、toast 和 dialog 必须继承 light/dark/system 主题。
- 支持 `prefers-reduced-motion`：菜单/弹框仅保留短 fade，不保留位移动画。

关键交互：

- `Cmd/Ctrl+F` 聚焦搜索。
- `Enter` 对选中容器执行 `进入`。
- `Cmd/Ctrl+R` 刷新。
- `Esc` 关闭菜单；无菜单时关闭弹框。
- 上下方向键在列表中移动选择。
- 所有 icon-only 按钮必须有 accessible name 和 tooltip。

## 技术方案

### 前端模块

建议新增独立组件，不继续扩大 `RemoteHostCreateDialog`：

- `src/features/machine-sidebar/HostContainersDialog.tsx`
  - 弹框容器，负责 open/close、目标 host、runtime、refresh 和动作接线。
- `src/features/machine-sidebar/host-containers/hostContainerDialogModel.ts`
  - 纯 view model：分组、搜索、排序、状态文案、动作 enablement、危险确认文案。
- `src/features/machine-sidebar/host-containers/HostContainerList.tsx`
  - 容器列表、group rows、keyboard navigation。
- `src/features/machine-sidebar/host-containers/HostContainerActionsMenu.tsx`
  - 行级更多菜单，复用 `kerminal-context-menu*` Apple floating menu。
- `src/lib/dockerApi.ts`
  - 增加 typed invoke：inspect/logs/stats/start/stop/restart/remove。
- `src/features/workspace/workspaceStore.ts`
  - 新增临时打开容器终端动作，避免 `进入` 强制持久化侧栏对象。

保留但降级现有入口：

- `RemoteHostCreateDialog` 中的 Docker tab 第一阶段可以保留为兼容入口，但文案改为“从主机右键进入容器管理更推荐”。
- 第二阶段稳定后，移除添加连接弹窗里的 Docker mode，或者只保留为跳转到主机容器弹框的入口。

### 后端模块

当前已有：

- `docker_list_containers`
- `docker_create_container_session`
- 容器文件读写、上传、下载、删除、重命名、chmod。

建议补齐：

| Command | 用途 | 第一阶段 |
| --- | --- | --- |
| `docker_list_containers` | 容器列表 | 复用并扩展 |
| `docker_create_container_session` | 进入容器终端 | 复用 |
| `docker_inspect_container` | 容器详情 | 新增 |
| `docker_tail_container_logs` | 最近日志 | 新增 |
| `docker_container_stats` | 轻量监控 | 新增 |
| `docker_start_container` | 启动容器 | 新增 |
| `docker_stop_container` | 停止容器 | 新增 |
| `docker_restart_container` | 重启容器 | 新增 |
| `docker_remove_container` | 删除容器 | 新增，必须确认 |

实现要求：

- 所有命令继续走 `DockerHostService`，复用已保存 SSH 主机、跳板机和凭据。
- 用户输入的 container id/name、runtime、shell、user、workdir 必须走统一 quote/argv helper，禁止临时拼 shell。
- 删除、停止、重启命令返回 typed result，前端可显示“已执行但刷新失败”等半成功状态。
- stats/logs 不做无限后台 watcher；第一阶段使用手动 refresh 或短生命周期请求，避免资源泄漏。

## 数据模型

在现有 `DockerContainerSummary` 上逐步扩展可选字段：

```typescript
interface DockerContainerSummary {
  hostId: string;
  id: string;
  shortId: string;
  name: string;
  image: string;
  statusText: string;
  status: DockerContainerStatus;
  state: string;
  ports: string[];
  runtime: ContainerRuntime;
  project?: string;
  composeService?: string;
  labels?: Record<string, string>;
}
```

分组规则：

- 优先按 labels 推断 Compose project：`com.docker.compose.project`。
- 无 project 的容器放入 `独立容器`。
- 搜索命中 name、image、port、short id、project、service。
- 默认排序：running project groups -> running standalone -> stopped project groups -> stopped standalone；组内按 name。

## 实施步骤

- [x] TASK-001 Host Context Entry
  - 在 SSH 主机右键菜单增加 `容器` action 和 props 接线。
  - `MachineSidebar` 只负责打开 host-scoped dialog，不读取 Docker 数据。
  - 验证：`machineSidebarMenuModel` / `MachineSidebar` 相邻测试，右键菜单 light/dark/system 截图。

- [x] TASK-002 Container Dialog MVP
  - 新增 `HostContainersDialog`，复用 `listDockerContainers` 展示主机容器列表。
  - 支持 runtime、包含停止容器、刷新、搜索、按 Compose/独立容器分组、空态和错误态。
  - 验证：view model tests、dialog UI tests、dev server 三主题截图。

- [x] TASK-003 Enter Without Pinning
  - 新增工作区动作：从 `DockerContainerSummary` 临时打开容器终端，不强制创建侧栏机器。
  - 对已存在同容器 terminal 默认 focus existing；提供新开终端选项。
  - 验证：workspace store tests、terminal open state tests、真实 dev server smoke；涉及 Tauri 时跑 `npm run tauri:dev`。

- [x] TASK-004 Pin to Sidebar Compatibility
  - 保留 `固定到侧栏`，复用 `addDockerContainer`，并处理重复固定、分组选择和持久 session 恢复。
  - 容器目标右键新增 `详情`，保留 `进入容器终端`、`打开 SFTP`、`从侧栏移除`。
  - 验证：workspace session tests、MachineSidebar tests、SFTP container smoke。

- [x] TASK-005 Lifecycle Operations
  - 后端新增 start/stop/restart/remove commands，前端行级动作接入。
  - 删除、停止、重启使用 `ModalShell` / `PromptDialog`，不使用浏览器 confirm。
  - 验证：Rust parser/service tests、Tauri command tests、前端 action model tests、手动确认流程截图。

- [x] TASK-006 Details / Logs / Stats
  - 新增详情 drawer 或弹框内 inspector panel，支持 inspect 摘要、tail logs、no-stream stats。
  - 默认只加载选中容器详情；不对列表内所有容器并发 stats。
  - 验证：Rust fixture tests、front-end inspector tests、性能 smoke。

- [x] TASK-007 Remove Old Primary Docker Add Path
  - 将“添加连接”弹窗里的 Docker tab 降级或移除，改为引导用户从主机右键进入容器管理。
  - 清理过时文案和 README 截图说明。
  - 验证：RemoteHostCreateDialog tests、README screenshot capture、build 和真实启动。

## 验收标准

- 用户能在左侧 SSH 主机上右键打开 `容器`，无需重新选择主机。
- 弹框能展示该主机容器列表，支持刷新、搜索、运行/停止筛选和 Compose/独立容器分组。
- 用户能选择运行中容器并直接进入终端；该动作不必把容器固定到侧栏。
- 用户仍可把常用容器固定到侧栏，并继续使用容器终端和容器文件能力。
- 生命周期操作有明确状态、错误反馈和危险确认。
- light、dark、system 三主题下弹框、右键菜单、popover、确认框均可读。
- dev server 和 Tauri dev smoke 至少在触及 Tauri/窗口/容器命令的切片中通过。

## 风险与回滚

- 容器操作是远端生产命令：删除、停止、重启默认危险确认；批量操作不进第一阶段。
- 临时进入容器会改变 workspace state：必须明确 ephemeral terminal 与 pinned sidebar machine 的边界。
- Docker/Podman CLI 输出差异：parser 使用 JSON/format 输出和 fixture，不依赖人类可读表格。
- stats/logs 可能变成资源热点：第一阶段不做常驻 watcher，用户打开详情才加载。
- 添加连接弹窗移除 Docker tab 会影响旧习惯：先保留兼容入口一轮，README/截图同步后再移除。

## 生产验证门禁

- 每个切片至少运行相邻 Vitest 和 `npm run build`。
- UI 切片必须启动真实 dev server，采集 light/dark/system 截图。
- 触及 Tauri command、DockerHostService、终端 session 或容器文件能力时，运行 Rust 相邻测试和 `npm run tauri:dev`；无法运行必须记录原因。
- 所有新 portal、菜单、弹框必须继承全局主题，不能硬编码单主题颜色。
- 不使用 `git add -A` 或宽泛 staging；只 stage 当前 TASK 实际改动。

## Round Log

- 2026-06-25T14:01:58+08:00：根据用户反馈确认方向：参考图只学习信息密度和操作模型，不照搬；结合当前 `RemoteHostCreateDialog` Docker mode、`MachineSidebar` 右键菜单和 `DockerHostService` 能力，输出主机上下文 Docker 容器管理 next 计划。本轮只写文档，不改生产代码。
- 2026-06-25T15:07:29+08:00：按用户 `/goal` 启动实现轮次，计划从 `next` 移入 `active`。当前工作区已有大量未归因改动，本轮登记独立 implementation lane，只做 TASK-001 和 TASK-002 的最小可验证切片；同时启动两个只读 explorer 并行梳理 sidebar 菜单链路与 Docker/container 能力边界，主实现仍在当前工作区最小合并。
- 2026-06-25T17:04:53+08:00：TASK-001 至 TASK-007 已完成。实际落地：SSH 主机右键 `容器` 入口、host-scoped 容器弹框、临时进入容器终端、固定到侧栏、容器目标详情入口、start/stop/restart/remove 生命周期命令与确认弹框、inspect/logs/stats inspector，以及添加连接弹窗移除 Docker 主入口；旧 `defaultMode="docker"` 仅保留兼容引导，不再读取容器或添加目标。README 已同步为“主机右键容器管理”口径。验证通过：`npm run test:frontend -- src/lib/dockerApi.test.ts src/features/machine-sidebar/host-containers/hostContainerDialogModel.test.ts src/features/machine-sidebar/HostContainersDialog.test.tsx src/features/machine-sidebar/MachineSidebar.test.tsx src/features/machine-sidebar/machineSidebarMenuModel.test.ts src/features/workspace/workspaceStore.test.ts src/features/workspace/workspaceStore.terminalOpen.test.ts src/app/KerminalShell.test.tsx src/features/machine-sidebar/RemoteHostCreateDialog.test.tsx src/features/machine-sidebar/remote-host-dialog/connection-check.test.ts`，`cargo fmt --manifest-path src-tauri/Cargo.toml --check`，`cd src-tauri; cargo test --test docker_host_service`，`npm run build`。运行态证据：Vite dev server `http://127.0.0.1:1430/` 可启动，三主题截图位于 `.updeng/docs/verification/docker-task007-add-dialog-{light,dark,system}.png`、`docker-task007-host-context-menu-{light,dark,system}.png`、`docker-task007-host-containers-{light,dark,system}.png`；添加连接截图确认无 Docker tab，主机右键菜单确认有 `容器`，容器弹框确认列表、进入、固定、详情/日志/监控可见。`npm run tauri:dev` 首次因已有同仓库 Vite 进程占用固定端口 `1425` 失败；随后使用已有 `1425` dev server 执行 `npx tauri dev --config '{"build":{"beforeDevCommand":""}}' --no-dev-server-wait`，成功编译并启动到 `target\debug\kerminal.exe`，10 秒内无启动期崩溃输出后手动停止 smoke。
