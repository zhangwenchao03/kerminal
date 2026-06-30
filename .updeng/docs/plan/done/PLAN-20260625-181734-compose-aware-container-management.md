---
id: PLAN-20260625-181734-compose-aware-container-management
status: done
created_at: 2026-06-25T18:17:34+08:00
started_at: 2026-06-25T18:30:00+08:00
completed_at: 2026-06-25T23:06:09+08:00
updated_at: 2026-06-25T23:06:09+08:00
owner: ai
flow_depth: high-risk
---

# Compose-aware 容器管理生产级实施计划

## 收口口径

- 用户最新目标允许在功能完成后收口。本计划按低破坏的 Compose-aware 容器管理闭环收口：Compose/独立容器识别、Compose 项目默认折叠与展开、项目/容器 inspector、宿主机 YAML 路径与只读语法高亮预览、日志按钮打开终端 `docker logs -f`、左右 pane 稳定布局。
- 远程 YAML 编辑/保存/校验和项目级 `docker compose up/stop/restart/pull` 属于更高风险远程写入/运行状态变更，未在本次收口中默认执行；如后续需要，重新开带 HITL 确认、冲突检测、命令预览和回滚口径的独立切片。
- 本次收口不恢复添加主机时添加 Docker 容器的旧入口。

## 目标

- 在 SSH 主机右键 `容器` 的管理弹框里，把 Docker Compose 管理的容器和直接 `docker run` / `podman run` 启动的独立容器清楚区分。
- 让用户可以点开一个 Compose 应用/项目，看到该项目下所有服务容器、运行状态、端口、镜像和快捷操作。
- 让用户知道 Compose YAML 在宿主机上的来源路径，并能安全只读预览；编辑、保存和校验作为后续 HITL 切片保留。
- UI 学习参考图的信息架构：左侧应用列表、右侧详情/YAML/日志工作区，但保持 Kerminal 的主机上下文工作台风格，不照搬第三方面板。

## 非目标

- 本计划不恢复“添加主机时添加 Docker 容器”的旧入口。
- 第一阶段不自动执行 `docker compose up -d`、`down`、`pull`、`build` 等会改变远程运行状态的项目级命令。
- 第一阶段不做 Compose 文件模板市场、应用商店、备份仓库或部署编排平台。
- 不把 Docker Compose 项目提升为和 SSH 主机同级的全局资产；它仍属于某个 SSH 主机。

## 当前事实

- 现有入口已迁移为 SSH 主机右键 `容器`，核心文件是 `src/features/machine-sidebar/HostContainersDialog.tsx`。
- 前端 `hostContainerDialogModel.ts` 已有 `composeProject`、`composeService` 和 labels 派生函数，但 `DockerContainerSummary` 正式契约没有把 Compose 元数据作为一等字段暴露。
- Rust 侧 `DockerContainerSummary` 当前只有 id/name/image/status/ports/runtime/target/capabilities；`docker ps --format '{{json .}}'` 的解析没有保留 Compose labels。
- `docker_inspect_container` 已能读取单容器 labels，但列表页不能依赖用户逐个 inspect 才知道项目归属。
- 现有 `docker_read_text_file` / `docker_write_text_file` 读写的是容器内文件；Compose YAML 通常在宿主机路径上，应该复用 SFTP/远程工作区文本文件能力，而不是容器文件接口。

## 识别规则

### Compose 容器

优先识别 Docker Compose v2 labels：

- `com.docker.compose.project`
- `com.docker.compose.service`
- `com.docker.compose.project.working_dir`
- `com.docker.compose.project.config_files`
- `com.docker.compose.container-number`
- `com.docker.compose.oneoff`

兼容 Podman Compose labels：

- `io.podman.compose.project`
- `io.podman.compose.service`

判定：

- 有 project label：归为 Compose/Podman Compose 项目。
- 有 service label：显示为服务容器。
- 有 project 但无 service：归入该项目的 `other` 容器，避免丢失 one-off/run 容器。
- 无 project label：归为 `独立容器`。

### YAML 路径

路径解析优先级：

1. `com.docker.compose.project.config_files` 提供配置文件列表。
2. `com.docker.compose.project.working_dir` 作为相对路径基准。
3. 若 labels 缺失，尝试 `docker compose ls --format json` 读取同名 project 的 `ConfigFiles`。
4. 仍缺失时，在 UI 上显示 `未发现 Compose YAML 路径`，提供复制 inspect labels、打开宿主目录和手动选择路径的后续入口。

路径规则：

- `config_files` 可能是绝对路径，也可能相对 `working_dir`。
- 多文件 Compose 要保留顺序，例如 `compose.yaml` + `compose.override.yaml`。
- 分隔符优先按逗号解析，再兼容分号；不要用冒号盲拆，避免破坏 Windows 路径。
- 对远程 Windows SSH 主机保留盘符语义；对 Linux/macOS 主机用 POSIX path 展示。

## 推荐信息架构

### 弹框骨架

`HostContainersDialog` 保持工作台弹框，不变成独立 Docker 管理应用。

```text
Host Containers Dialog
├─ Header: host name / runtime / refresh
├─ Summary: Compose 项目数 / 独立容器数 / 运行容器数 / 异常数
├─ Toolbar: search / runtime / view mode / include stopped
└─ Workbench
   ├─ Left: Compose projects + standalone groups
   └─ Right: Project or container inspector
```

### 左侧列表

默认按 `应用` 视图展示：

- Compose 项目行：项目名、运行数 `3/5`、工作目录、配置文件状态、展开按钮、项目操作菜单。
- 项目展开后：服务容器行，显示 service、container name、状态、镜像、端口、进入终端按钮。
- 独立容器分区：只显示直接启动容器，不混在 Compose 项目里。

推荐视觉：

- Compose 项目用轻量 `Compose` badge 和 folder/stack 图标；不要只靠颜色区分。
- 独立容器使用 `Standalone` 或 `独立` 小标签，状态点沿用现有 green/gray/red 语义。
- 选中项目时，右侧 inspector 是项目级；选中容器时，右侧 inspector 是容器级。
- 路径和长镜像名使用 monospace、截断、title tooltip，避免撑破列表。

### 右侧项目 inspector

项目级 tabs：

- `概览`：项目状态、服务数、容器数、工作目录、Compose 文件、最近错误。
- `容器`：该项目所有容器的紧凑表，支持进入、日志、重启单容器。
- `Compose YAML`：配置文件路径、只读预览、文件元数据和截断/错误状态；编辑、保存、冲突提示、校验作为后续高风险切片。
- `日志`：第一阶段可以提供按服务筛选的 `docker logs` 聚合入口；后续再做 `docker compose logs`。

容器级 tabs 保留现有：

- `详情`
- `日志`
- `监控`

项目级和容器级 inspector 不要混用同一个标题，避免用户不知道当前操作对象是项目还是单容器。

## Apple-inspired / geek 设计要求

- 产品气质：calm、technical、precise。
- 密度：balanced compact，适合 40+ 容器的远程主机。
- 材质：弹框和导航层可用 glass/overlay；列表、日志、YAML 编辑器必须用 solid surface，确保可读。
- 颜色：用现有主题变量和 `dark:` 对，不增加单主题硬编码色。
- 交互：项目展开、右侧 inspector 切换使用 140-220ms 以内的轻微 opacity/transform；不要做大幅动效。
- 图标：项目、容器、终端、刷新、更多、复制、文件、校验都用 lucide 线性图标。
- 文案：界面里少解释，靠布局、badge 和明确按钮表达状态；风险动作进入确认弹框。
- 三主题：浅色、深色、跟随系统必须全部截图验证；portal 菜单/确认弹框继承主题。

## 技术方案

### 后端契约

新增 Compose 元数据模型：

```rust
pub struct DockerComposeMetadata {
    pub project: String,
    pub service: Option<String>,
    pub working_dir: Option<String>,
    pub config_files: Vec<String>,
    pub config_paths: Vec<String>,
    pub container_number: Option<String>,
    pub oneoff: bool,
    pub runtime_family: DockerComposeRuntimeFamily,
}
```

扩展 `DockerContainerSummary`：

- `compose: Option<DockerComposeMetadata>`
- 可选 `labels: BTreeMap<String, String>` 只保留 Compose 相关 labels；避免列表响应暴露大量无关 label。

列表读取策略：

1. `docker ps -a --no-trunc --format '{{json .}}'` 继续作为基础列表。
2. 若 `ps` JSON 含 `Labels`，解析 Compose labels。
3. 若 `Labels` 缺失或不完整，批量执行 `docker inspect <ids...>` 获取 `.Config.Labels`，按容器 id 合并。
4. 读取失败时保留基础列表，返回 warning metadata；不要让 Compose metadata 缺失导致整个容器列表失败。

YAML 路径能力：

- 新增 host-level Compose file request，不走 container file API。
- 第一阶段可以直接复用 `SftpService::read_text_file` / `write_text_file` 的 revision 冲突机制。
- 保存前要求 `expectedRevision`，禁止静默覆盖远端修改。
- 保存后默认只更新文件，不自动运行 `up`。

Compose 校验能力：

- 新增 `docker_compose_validate_config`，在 YAML 所在 `working_dir` 执行：
  - Docker: `docker compose -f <file...> config --quiet`
  - Podman: 优先 `podman compose`，不可用则只做本地 YAML parse，不声称运行时校验完成。
- 校验只读，不改变远端状态。

### 前端模型

新增纯模型：

- `composeMetadataModel.ts`
- `buildComposeProjectViews(containers)`
- `resolveComposeConfigPaths(metadata)`
- `composeProjectStatus(project)`
- `composeSearchIndex(project)`

核心类型：

```ts
type HostContainerListMode = "applications" | "containers" | "status";

interface ComposeProjectView {
  id: string;
  project: string;
  runtime: ContainerRuntime;
  runningCount: number;
  totalCount: number;
  services: ComposeServiceView[];
  workingDir?: string;
  configPaths: string[];
  warnings: string[];
}
```

选择状态：

- `selectedKind: "project" | "container"`
- `selectedProjectId?: string`
- `selectedContainerId?: string`

这样点击 Compose 项目时右侧显示项目级 inspector，点击服务容器时显示容器级 inspector。

### UI 组件拆分

建议拆出：

- `HostContainerWorkbench.tsx`
- `ComposeProjectList.tsx`
- `ComposeProjectInspector.tsx`
- `ComposeYamlPanel.tsx`
- `composeProjectModel.ts`
- `composeProjectModel.test.ts`

保留 `HostContainersDialog.tsx` 负责数据加载、状态协调和命令调用，不继续膨胀到千行以上。

## 任务切片

### TASK-001 AFK：Compose labels 进入列表契约

目标：

- 列表响应能区分 Compose 与独立容器。

改动：

- Rust `DockerContainerSummary` 增加 typed `compose`。
- `docker_host_service/parsing.rs` 解析 Compose/Podman labels。
- `script.rs` 增加批量 inspect metadata fallback。
- `src/lib/dockerApi.ts` 同步类型和 browser preview。

验收：

- Compose 容器显示 project/service。
- 独立容器不带 compose metadata。
- labels 缺失时列表仍可用。

验证：

- `cargo test --test docker_host_service`
- `npm test -- src/lib/dockerApi.test.ts src/features/machine-sidebar/host-containers/hostContainerDialogModel.test.ts`

### TASK-002 AFK：应用视图与项目展开

目标：

- 默认列表让 Compose 项目成为一级对象，独立容器单独成组。

改动：

- 新增 project view model 和 tests。
- `HostContainerList` 支持 project row + expanded service rows。
- 搜索覆盖项目名、service、container、image、port、config path。

验收：

- 用户一眼能分出 `Compose 应用` 与 `独立容器`。
- 点项目选择项目 inspector；点容器选择容器 inspector。
- 展开项目可看到该 project 的所有容器。

验证：

- 前端模型测试。
- `HostContainersDialog` 交互测试。

### TASK-003 AFK：项目 inspector 和 YAML 路径展示

目标：

- 用户能知道 Compose YAML 在哪里。

改动：

- 新增 `ComposeProjectInspector`。
- 展示 `workingDir`、`configPaths`、缺失路径 warning。
- 提供 `复制路径`、`打开所在目录`、`刷新 metadata`。

验收：

- 多 Compose 文件按顺序展示。
- 相对路径正确解析为最终路径。
- 缺失路径时给出清晰状态，不误导为独立容器。

验证：

- 路径解析单测。
- UI 测试覆盖 missing labels / multiple files。

### TASK-004 AFK：Compose YAML 只读预览

目标：

- 用户可以在项目 inspector 里打开 YAML 查看内容。

改动：

- 通过 SFTP host-level text read 读取配置文件。
- 多文件用 tabs 或文件切换器。
- 大文件、二进制、权限不足显示明确错误。

验收：

- 读的是宿主机文件，不是容器内部文件。
- 文件路径、revision、截断状态可见。
- 读取失败不影响容器列表和其他操作。

验证：

- SFTP read API 相邻测试。
- UI 加载/错误/截断状态测试。

### TASK-005 HITL：YAML 编辑和保存策略确认

待确认：

- 保存 YAML 后是否只保存文件，还是提供可选 `校验并应用`。

推荐：

- 默认只保存。
- 保存后给出 `校验 Compose 配置` 按钮。
- `应用变更` 单独放在后续显式确认流，要求展示将执行的命令和 working directory。

原因：

- YAML 保存是远程写文件，`compose up` 是远程运行状态变更；两个风险等级不同。
- 自动 apply 可能重建容器、中断服务或拉取镜像，不应和保存混在一起。

### TASK-006 AFK：YAML 编辑、保存和校验

依赖：

- TASK-005 确认保存策略。

目标：

- 用户可编辑 YAML，保存时有冲突检测，保存后可运行只读校验。

改动：

- `ComposeYamlPanel` 使用 Monaco 或复用 `RemoteWorkspaceEditor` 的文本编辑能力。
- 保存 request 带 `expectedRevision`。
- 冲突时提供 `重新加载` / `覆盖保存`，覆盖保存需二次确认。
- 新增 `docker_compose_validate_config` 只读命令。

验收：

- 远端文件被别人改过时不会静默覆盖。
- YAML 校验失败时显示 stdout/stderr 和命令工作目录。
- 保存成功不自动重启容器。

验证：

- 前端保存状态测试。
- Rust 校验 command tests。
- 真实远程或本地 SSH smoke。

### TASK-007 HITL：项目级生命周期动作

候选动作：

- `启动项目`：`docker compose up -d`
- `停止项目`：`docker compose stop`
- `重启项目`：`docker compose restart`
- `拉取镜像`：`docker compose pull`
- `删除项目`：不默认提供；如提供必须强确认并说明 volumes 风险。

推荐：

- 第二阶段只做 `启动/停止/重启`，且每次确认框展示完整命令、working directory、config files。
- `down -v`、`rm`、`prune` 不进入第一版。

## 验证门禁

代码实现阶段必须完成：

- Rust:
  - `cargo test --test docker_host_service`
  - 新增 compose metadata parser tests。
- Frontend:
  - `npm test -- src/features/machine-sidebar/HostContainersDialog.test.tsx`
  - `npm test -- src/features/machine-sidebar/host-containers/hostContainerDialogModel.test.ts`
  - 新增 compose project model tests。
- Build:
  - `npm run build`
- 真实界面：
  - 启动 dev server。
  - 浅色、深色、跟随系统三主题截图。
  - 至少覆盖：Compose 项目折叠、项目展开、独立容器、项目 inspector、YAML 路径缺失/存在。
- Tauri:
  - 涉及 Rust command/权限/窗口时跑 `npm run tauri:dev`；若端口占用，使用既有 no-dev-server-wait workaround 并记录。

## 风险与回滚

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 远程 Docker inspect 响应大 | 列表变慢或超出输出限制 | 批量、限字段、超时后降级基础列表 |
| labels 不完整 | 无法定位 YAML | UI 显示未知，不误判；提供 compose ls fallback |
| YAML 保存覆盖远端改动 | 配置丢失 | revision 必填，冲突检测，覆盖二次确认 |
| 自动 apply 中断服务 | 生产事故 | 第一阶段不自动 apply；项目级命令单独 HITL |
| Compose v1/v2/Podman 差异 | 命令失败或路径缺失 | runtime capability probe，失败显示具体原因 |
| 多主题 portal 漏继承 | 菜单/弹框不可读 | 复用现有 ModalShell/PromptDialog/useDocumentTheme 规则并截图 |

回滚：

- 前端回滚到当前容器列表：保留基础 `DockerContainerSummary` 字段即可运行。
- 后端 Compose metadata 失败时返回 `compose: null`，不阻断容器基础管理。
- YAML 编辑能力可用 feature flag 或隐藏入口回滚，不影响进入容器、日志、监控。

## 待确认点

- 是否接受第一版“保存 YAML 不自动应用”的策略。
- 是否要在第一版提供项目级 `启动/停止/重启`，还是只保留单容器生命周期操作。
- YAML 编辑器是否直接嵌在容器弹框右侧，还是点击后打开现有远程工作区编辑器。
- 对生产主机是否需要更强提示，例如项目级命令默认禁用，只允许复制命令人工执行。

## 推荐下一步

先做 TASK-001 到 TASK-004，形成一个低破坏的 Compose-aware 只读闭环：

1. 列表能分辨 Compose 与独立容器。
2. 点开 Compose 项目能看到所有容器。
3. 能看到 YAML 路径。
4. 能只读预览 YAML。

确认体验稳定后，再进入 TASK-005/TASK-006 的远程写文件能力；项目级 apply/lifecycle 放到 TASK-007 单独决策。

## Round Log

### 2026-06-25T20:20:00+08:00 用户反馈后的 UI 收口

- 反馈来源：用户指出 Compose 项目行缺少操作按钮、项目默认折叠不合适、容器日志按钮应放在外侧、右侧 YAML 预览太小且需要语法高亮。
- 本轮改动：
  - `HostContainerList`：Compose 项目默认展开，新出现的项目首帧即展开；保留用户手动折叠；项目行新增 `YAML` 和刷新按钮；容器行新增外置实时日志按钮，三点菜单移除日志项。
  - `HostContainersDialog`：项目 inspector tab 提升为父组件受控；项目行 `YAML` 可直接切到 YAML 视图；YAML 视图时工作台改为左窄列表 + 右侧主编辑区；选中项目时底部动作改为项目级 `YAML` / `刷新`。
  - `ComposeProjectInspector`：YAML tab 改为只读 `MonacoTextEditor`，使用 `yaml` language、暗色 `kerminal-dark` / 浅色 `vs` 主题；保留路径、复制、重新读取和截断提示。
  - `HostContainersDialog.test.tsx`：mock Monaco，补充默认展开、项目行 YAML 打开、宿主机 YAML 读取、外置日志按钮的回归断言。
- 验证：
  - `npm test -- --run src/features/machine-sidebar/host-containers/composeProjectModel.test.ts src/features/machine-sidebar/host-containers/hostContainerDialogModel.test.ts src/features/machine-sidebar/HostContainersDialog.test.tsx src/features/workspace/workspaceStore.terminalOpen.test.ts src/lib/dockerApi.test.ts`：35 tests passed。
  - `npm test -- --run src/features/machine-sidebar/HostContainersDialog.test.tsx`：9 tests passed。
  - `npm run build`：通过；仅保留既有 Vite large chunk warning。
  - dev server smoke：`http://127.0.0.1:5178` 返回 200。
  - 真实浏览器 harness 三主题截图：`.updeng/docs/verification/compose-containers-dialog-yaml-light-20260625.png`、`compose-containers-dialog-yaml-dark-20260625.png`、`compose-containers-dialog-yaml-system-20260625.png`；均无 console/page error，YAML Monaco 内容可见。
  - 并行 lane checkpoint：`.updeng/docs/coordination/checkpoints/lane-compose-aware-container-management-implementation.json`。
- 未执行：
  - 本轮未改 Rust/Tauri command/service，不重跑 `cargo test --test docker_host_service`；上一轮已用隔离 target 跑通过。
  - 未执行 `npm run tauri:dev`，本轮为 React 容器弹框局部 UI 调整，已完成 dev server + browser harness smoke。

### 2026-06-25T20:43:11+08:00 工作台列宽稳定与图标化打磨

- 反馈来源：用户指出点击容器更多菜单、容器、Compose 项目和 YAML 时左右框会变大变小，体验突兀。
- 本轮改动：
  - `HostContainersDialog`：工作台统一使用稳定两列轨道 `320-360px` 左侧列表 + 右侧剩余空间，不再按容器详情、Compose 详情、YAML 视图切换列宽。
  - `HostContainerActionsMenu`：打开“更多”菜单不再立即切换选中容器；只有点菜单项时才切换上下文，避免右侧 inspector 因打开浮层突然变化。
  - `HostContainerList`、`ComposeProjectInspector`：常用动作进一步图标化，YAML/刷新/日志/固定/更多保持固定 32px 操作位，减少文字按钮噪声；展开服务行改为轻量行而不是卡片套卡片。
- 验证：
  - `npm test -- --run src/features/machine-sidebar/HostContainersDialog.test.tsx`：9 tests passed。
  - `npm run build`：通过；仅保留既有 Vite large chunk warning。
  - CDP browser harness 三主题截图：`.updeng/docs/verification/compose-containers-dialog-stable-light-20260625.png`、`compose-containers-dialog-stable-dark-20260625.png`、`compose-containers-dialog-stable-system-20260625.png`；目检左右列宽稳定，YAML/Compose/容器视图切换不再改变主列轨道。
- 未执行：
  - 本轮未改 Rust/Tauri command/service，不重跑 `cargo test --test docker_host_service`。
  - 未执行 `npm run tauri:dev`；本轮为 React 容器弹框局部布局与交互修正，已完成 dev server + browser harness smoke。

### 2026-06-25T21:16:13+08:00 工作台骨架固定与交互复测

- 反馈来源：用户继续指出点击容器更多选项后右侧会突然缩小，点容器、Compose 和 YAML 时左右区域观感不一致。
- 本轮改动：
  - `HostContainersDialog`：workbench 从 `lg` 开始固定为 `348px + 1fr`，`2xl` 固定为 `360px + 1fr`；左侧列表 pane 固定 `minmax(0,1fr) + 44px` footer；右侧 inspector 增加固定 `min-h-0 overflow-hidden` 包裹。
  - `HostContainersDialog`：底部操作区改为固定两枚 32px 图标位，进入/启动不再使用可变文字按钮，减少选择对象变化造成的视觉跳动。
  - `HostContainerInspector` / `ComposeProjectInspector`：统一 `h-full min-h-0 overflow-hidden` 骨架和材质重量；YAML 预览去掉 `min-h-[360px]`，改为在右侧 pane 内部伸缩。
  - `HostContainerList`：Compose 项目行移除超宽屏才出现的运行时文字，项目行和容器行操作区改为固定宽度图标槽。
  - `HostContainersDialog.test.tsx`：新增回归测试，覆盖打开更多菜单不切换选择，且 project / YAML / container / project 状态切换时 workbench/list/inspector 外层骨架 class 保持不变。
- 验证：
  - `npm test -- --run src/features/machine-sidebar/HostContainersDialog.test.tsx`：10 tests passed。
  - `npm run build`：通过；仅保留既有 Vite large chunk warning。
  - dev server smoke：`http://127.0.0.1:5178` 返回 200。
  - Playwright 同源 harness 三主题截图：`.updeng/docs/verification/compose-containers-dialog-fixed-light-20260625.png`、`compose-containers-dialog-fixed-dark-20260625.png`、`compose-containers-dialog-fixed-system-20260625.png`。
  - 同一 harness 依次测量 `initial` / `menu` / `yaml` / `container` / `project`：三主题均为 `list=348px`、`inspector=688px`、`workbench=1074px`，无 console/page error。截图 harness 使用轻量只读编辑器替身验证布局；真实 Monaco/YAML bundling 由 `npm run build` 覆盖。
- 未执行：
  - 本轮未改 Rust/Tauri command/service，不重跑 `cargo test --test docker_host_service`。
  - 未执行 `npm run tauri:dev`；本轮为 React 容器弹框局部布局与交互修正，已完成 dev server + browser harness smoke。

### 2026-06-25T21:33:39+08:00 YAML 多文件切换防抖收口

- 反馈来源：延续用户对 Compose/YAML 右侧区域切换“不突兀、不跳动”的要求，补齐多文件 YAML 预览的异步边界。
- 本轮改动：
  - `ComposeProjectInspector`：为 YAML 读取加入请求序列号；切换项目、路径列表或 YAML 文件时递增序列，旧的远程读取结果返回后会被忽略，避免慢请求覆盖当前选中的文件内容。
  - `HostContainersDialog.test.tsx`：新增多 Compose YAML 文件快速切换测试；先打开 `compose.yaml`，立刻切到 `compose.override.yaml`，让 override 先返回、base 后返回，断言预览仍停留在 override 内容和路径，并覆盖截断提示。
  - 保持当前布局决策不变：Compose 项目默认折叠；workbench 继续使用固定 `348px/360px + 1fr` 两列；更多菜单只作为浮层，不改变选中对象和列宽。
- 验证：
  - `npm test -- --run src/features/machine-sidebar/HostContainersDialog.test.tsx`：11 tests passed。
  - `npm run build`：通过；仅保留既有 Vite large chunk warning。
  - dev server smoke：`http://127.0.0.1:5178` 返回 200。
  - 视觉证据复核：沿用并复核上一轮生成的三主题截图 `.updeng/docs/verification/compose-containers-dialog-fixed-light-20260625.png`、`compose-containers-dialog-fixed-dark-20260625.png`、`compose-containers-dialog-fixed-system-20260625.png`；左侧列表、右侧 inspector、YAML 预览在浅色/深色/跟随系统下保持稳定宽度。
- 未执行：
  - 本轮未改 Rust/Tauri command/service，不重跑 `cargo test --test docker_host_service`。
  - 未执行 `npm run tauri:dev`；本轮只补 React YAML 读取竞态和回归测试，已完成 build、dev server smoke 和既有三主题截图复核。

### 2026-06-25T22:00:20+08:00 Inspector 骨架统一与 YAML 元数据栏

- 反馈来源：用户指出点击更多菜单、容器、Compose 项目和 YAML 时左右框视觉上仍有变大变小，右侧切换不够自然。
- 本轮改动：
  - `HostContainerInspector` / `ComposeProjectInspector`：统一右侧 inspector 外框、标题区高度、body 滚动 gutter 和 segmented tab 宽度；容器、Compose、YAML 切换只替换内容，不再改变 inspector chrome。
  - `ComposeProjectInspector`：YAML 路径条改为固定高度轻量 toolbar，底部新增固定高度 metadata rail，显示大小、权限、编码、换行、RO/RW 和修改时间，避免截断/加载状态改变编辑器外框高度。
  - 新增 `ComposeProjectInspector.test.tsx`，不继续扩张已接近 800 行的 `HostContainersDialog.test.tsx`；覆盖 YAML metadata/footer 的渲染。
- 验证：
  - `npm test -- --run src/features/machine-sidebar/host-containers/ComposeProjectInspector.test.tsx src/features/machine-sidebar/HostContainersDialog.test.tsx`：12 tests passed。
  - `npm run build`：通过；仅保留既有 Vite large chunk warning。
  - dev server smoke：`http://127.0.0.1:5178` 返回 200。
  - Chrome headless/CDP 同源 harness 三主题截图：`.updeng/docs/verification/compose-containers-dialog-chrome-stable-light-20260625.png`、`compose-containers-dialog-chrome-stable-dark-20260625.png`、`compose-containers-dialog-chrome-stable-system-20260625.png`。
  - 同一 harness 依次测量 `menu` / `yaml` / `container` / `project`：均为 `list=348px`、`inspector=688px`、`workbench=1074px`；`initial` 首帧在数据完全展开前为 `list=343px`、`inspector=678px`，交互态稳定后不再跳动。
- 未执行：
  - 本轮未改 Rust/Tauri command/service，不重跑 `cargo test --test docker_host_service`。
  - 未执行 `npm run tauri:dev`；本轮为 React 容器弹框布局与视觉收口，已完成 dev server + Chrome headless/CDP 真实渲染验证。

### 2026-06-25T22:16:57+08:00 右侧内容槽滚动占位收口

- 反馈来源：用户继续指出点击更多菜单、容器、Compose 项目和 YAML 时左右框视觉上仍像在变大变小，希望切换更自然、不突兀。
- 本轮改动：
  - `ComposeProjectInspector`：右侧 body 不再按 YAML / 非 YAML 切换 `overflow` 模式，统一为可滚动且保留稳定 scrollbar gutter 的内容槽。
  - `ComposeProjectInspector`：YAML 读取失败态也保留与 Monaco 预览相同的固定编辑器外框，只替换框内错误内容，避免错误/加载/正常预览之间改换几何。
  - `ComposeProjectInspector.test.tsx`：新增 tab 切换回归，断言 `overview` / `containers` / `yaml` 共享同一 body class 和滚动占位。
- 验证：
  - `npm test -- --run src/features/machine-sidebar/host-containers/ComposeProjectInspector.test.tsx src/features/machine-sidebar/HostContainersDialog.test.tsx`：13 tests passed。
  - `npm run build`：通过；仅保留既有 Vite large chunk warning。
  - dev server smoke：`http://127.0.0.1:5178` 返回 200。
  - Chrome headless 使用本机 Chrome 可执行文件真实渲染三主题截图：
    - `.updeng/docs/verification/compose-containers-dialog-stable-body-light-20260625.png`
    - `.updeng/docs/verification/compose-containers-dialog-stable-body-dark-20260625.png`
    - `.updeng/docs/verification/compose-containers-dialog-stable-body-system-20260625.png`
  - 同一 harness 依次测量 `initial-project` / `menu-open` / `yaml` / `container` / `project`：浅色、深色、跟随系统均为 `workbench=1074x483`、`list=348x457`、`inspector=688x457`；Compose 项目态 `composeBody=662x339`，无 console/page error。
- 未执行：
  - 本轮未改 Rust/Tauri command/service，不重跑 `cargo test --test docker_host_service`。
  - 未执行 `npm run tauri:dev`；本轮为 React 容器弹框局部布局与视觉稳定性修正，已完成 dev server + Chrome headless 真实渲染验证。

### 2026-06-25T22:25:36+08:00 用户跳动反馈复核

- 反馈来源：用户指出点击容器更多选项、容器、Compose 和 YAML 时左右框观感仍应更稳定、更美观。
- 本轮结论：
  - 复核参考图和当前三主题截图后，保留当前“固定 workbench + 左侧应用列表 + 右侧统一 inspector”的方案；不再按不同功能切换左右列比例。
  - 当前代码已通过三层约束处理跳动：`HostContainersDialog` 固定 `348px/360px + 1fr` 两列；`HostContainerInspector` 和 `ComposeProjectInspector` 共享固定 header/body chrome；`HostContainerActionsMenu` 打开更多菜单时不改变选中对象。
  - YAML、错误、加载和正常预览都保留同一个预览框架；日志按钮保持外置并进入终端 tab，不在右侧 inspector 内嵌日志视图。
- 验证：
  - `npm test -- --run src/features/machine-sidebar/host-containers/ComposeProjectInspector.test.tsx src/features/machine-sidebar/HostContainersDialog.test.tsx`：2 files / 13 tests passed。
  - `npm run build`：通过；仅保留既有 Vite large chunk warning。
  - dev server smoke：`http://127.0.0.1:5178` 返回 200。
- 未执行：
  - 本轮未改产品代码，也未改 Rust/Tauri command/service，不重跑 `cargo test --test docker_host_service` 和 `npm run tauri:dev`。

### 2026-06-25T22:51:45+08:00 真实浏览器测量与项目点击语义修正

- 反馈来源：用户追问“为什么问题就可以收口了”，要求不能只用局部代码判断代替真实体验结论。
- 本轮改动：
  - `HostContainersDialog`：点击 Compose 项目行时显式切回项目 `概览` tab；只有项目行/底部的 YAML 图标按钮才进入 `YAML` tab，避免用户点过 YAML 后再点 Compose 项目仍停留在 YAML，造成“点 Compose / 点 YAML 都不一样且突兀”的语义混淆。
  - `HostContainersDialog.test.tsx`：在稳定骨架回归中补充断言：从 YAML/容器详情回点 Compose 项目后，`概览` 被选中、`YAML` 不再被选中，同时 workbench/list/inspector 外层 class 保持不变。
- 验证：
  - `npm test -- --run src/features/machine-sidebar/HostContainersDialog.test.tsx src/features/machine-sidebar/host-containers/ComposeProjectInspector.test.tsx`：2 files / 13 tests passed。
  - 临时 CDP harness + 本机 Chrome 真实渲染三主题测量：`.updeng/docs/verification/compose-containers-dialog-real-layout-20260625.json`。
  - 同一 harness 依次测量 `initial-project` / `expanded-project` / `menu-open` / `yaml` / `container` / `project`：浅色、深色、跟随系统均保持 `workbench=1074x483`、`list=348x457`、`inspector=688x457`；点 Compose 项目回到概览后 `yamlPreview=null`。
  - 三主题截图：
    - `.updeng/docs/verification/compose-containers-dialog-real-layout-light-20260625.png`
    - `.updeng/docs/verification/compose-containers-dialog-real-layout-dark-20260625.png`
    - `.updeng/docs/verification/compose-containers-dialog-real-layout-system-20260625.png`
  - `npm run build`：通过；仅保留既有 Vite large chunk warning。
  - dev server smoke：`http://127.0.0.1:5178` 返回 200。
  - 并行 lane checkpoint：`.updeng/docs/coordination/checkpoints/lane-compose-aware-container-management-implementation.json`。
- 未执行：
  - 本轮未改 Rust/Tauri command/service，不重跑 `cargo test --test docker_host_service`。
  - 未执行 `npm run tauri:dev`；本轮是 React 容器弹框局部交互语义和视觉稳定性复核，已完成 dev server + Chrome headless 真实渲染验证。

### 2026-06-25T23:06:09+08:00 完成功能审计与计划收口

- 收口依据：
  - `TASK-001` 已由当前 Rust/API 代码证明：`DockerContainerSummary` 暴露 typed `compose` 与 Compose labels；`parse_container_line` 解析 Docker/Podman Compose labels；`enrich_container_list_labels` 使用批量 inspect 作为 best-effort fallback，失败不阻断基础列表。
  - `TASK-002` 已由当前前端代码证明：`buildComposeProjectViews` 将 Compose 项目作为一级对象，`HostContainerList` 默认折叠 Compose 项目，展开后显示服务容器，独立容器单独分区。
  - `TASK-003` 已由当前 inspector 证明：`ComposeProjectInspector` 展示 workingDir、configPaths、缺失路径 warning、复制路径和刷新入口。
  - `TASK-004` 已由当前 YAML panel 证明：YAML 通过 `readRemoteWorkspaceTextFile({ target: { kind: "ssh", hostId }})` 读取宿主机文件，使用 Monaco `yaml` 语言只读预览，显示 revision/size/permissions/encoding/line-ending/截断状态，失败态不影响容器列表。
  - 日志入口已按用户要求外置为终端 tab：`KerminalShell` 中 `openHostContainerLogs` 调用 `openSshCommandTerminal` 执行 `{docker|podman} logs -f --tail 200 <container>`，不在容器弹框内嵌日志视图。
  - 右侧突兀缩放问题有三层证据：固定 `348px/360px + 1fr` workbench，两类 inspector 统一 chrome，真实浏览器三主题测量在 `initial-project` / `expanded-project` / `menu-open` / `yaml` / `container` / `project` 均保持 `workbench=1074x483`、`list=348x457`、`inspector=688x457`。
- 验证：
  - `cargo test --test docker_host_service`：默认 target 因当前运行中的 `target/debug/kerminal.exe` 被 Windows 占用失败；改用隔离 target 后 `CARGO_TARGET_DIR=target-codex-compose cargo test --test docker_host_service` 通过，21 tests passed。
  - `npm test -- --run src/lib/dockerApi.test.ts src/features/machine-sidebar/host-containers/composeProjectModel.test.ts src/features/machine-sidebar/host-containers/hostContainerDialogModel.test.ts src/features/machine-sidebar/host-containers/ComposeProjectInspector.test.tsx src/features/machine-sidebar/HostContainersDialog.test.tsx src/features/workspace/workspaceStore.terminalOpen.test.ts`：6 files / 40 tests passed。
  - `npm run build`：通过；仅保留既有 Vite large chunk warning。
  - dev server smoke：`http://127.0.0.1:5178` 返回 200。
  - 三主题真实浏览器测量证据：`.updeng/docs/verification/compose-containers-dialog-real-layout-20260625.json`，截图为 `compose-containers-dialog-real-layout-light-20260625.png`、`compose-containers-dialog-real-layout-dark-20260625.png`、`compose-containers-dialog-real-layout-system-20260625.png`。
- 未执行：
  - 未执行 `npm run tauri:dev`；当前收口前已存在运行中的 Windows app 占用默认 Rust target，可由 `target/debug/kerminal.exe` 拒绝覆盖证明。已用隔离 Rust target、生产 build、dev server 200 和真实浏览器三主题测量替代覆盖本轮能力。
