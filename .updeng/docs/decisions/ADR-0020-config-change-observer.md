# ADR-0020: 文件型配置变更观察者与运行时刷新边界

## 状态

Proposed

## 修订关系

- Builds on: [ADR-0016: 文件优先存储与外部 Codex 工作目录协作边界](ADR-0016-file-first-storage-and-external-codex-workdir.md)
- Builds on: [ADR-0017: 右栏内置 AI 退场，保留 Kerminal MCP Server 与外部 Agent 启动器](ADR-0017-external-agent-launcher-and-mcp-only.md)
- Related: [ADR-0019: 外部 Agent workspace 指令与配置手册分层](ADR-0019-external-agent-workspace-instructions.md)

## 背景

- Kerminal 已把 settings、profiles、hosts、snippets、workflows 等低频配置迁到 `~/.kerminal` TOML 文件，外部 Codex/Claude/自定义 Agent 默认直接编辑这些文件并运行 validator。
- 当前运行中的前端只在启动、应用内保存/删除和少数工具回调后刷新配置；外部 Agent 直接新增 host 后，后端下一次读取能看到，但当前界面不会自动感知。
- 用户要求生产级完整方案：不是手动刷新按钮，不是只覆盖 host 的 MVP，而是优雅、稳定、可诊断、可回滚的配置热刷新基础设施。
- 用户进一步要求：前端收到配置变更并刷新成功后，要给用户一个简洁、geek 风格、自动关闭的提示，说明应用中新增或变更了什么配置。
- 现有 `FileStore` 使用临时文件 + rename 的原子写；Windows 上更新既有文件会先删除目标再 rename。观察者必须能处理多事件、rename、短暂缺失、半写入和多文件 change set。

## 决策驱动因素

- 正确性：事件不能直接替代事实源；刷新必须最终以 `ConfigFileStore` typed reader 和现有 service 为准。
- 稳定性：外部编辑器、AI、多文件保存、网络盘、WSL/容器挂载和 Windows rename 差异不能导致白屏或状态倒退。
- 安全：不向前端事件泄露 `secrets/hosts/*.toml` 路径内容、密码、私钥或 token。
- 低耦合：Rust 侧负责观察、归一化、去抖和诊断；前端负责根据域刷新对应 store/tool，不把 UI 逻辑塞进 watcher。
- 可测试性：事件分类、去抖、错误保持 last-known-good、前端脏表单保护都需要独立测试缝隙。
- 运维诊断：需要能回答“watcher 是否启用、用 native 还是 polling、最近一次刷新为什么失败”。

## 外部实践调研摘要

| 来源 | 可借鉴做法 | 对 Kerminal 的约束 |
| --- | --- | --- |
| Rust `notify` / `notify-debouncer-full` 官方文档 | 使用跨平台原生 watcher，同时承认平台差异；用 debouncer 合并 rename/create/remove/modify 事件；不可靠文件系统可退到 polling。 | Rust 侧采用 `notify` + `notify-debouncer-full`，把 native watcher 作为默认，保留 `PollWatcher` 降级路径。 |
| Chokidar README | 将编辑器 atomic save 归一化为稳定 add/change，提供 `atomic` 与 `awaitWriteFinish` 这类稳定写入选项。 | Kerminal 不在原始事件上刷新；必须有稳定窗口、重试和 max wait，避免半写入 TOML 刷坏 UI。 |
| VS Code File Watcher Internals | 文件观察被当作基础设施：按 watcher request 管理、限制范围、区分 recursive/non-recursive、处理 restart 和轮询。 | Kerminal 只 watch 已知配置域，不 watch `agents/sessions`、备份和运行日志；watcher 失败要重建并可诊断。 |
| Tauri v2 events 文档 | 后端可发事件，前端用 `listen` 订阅；事件适合通知，不适合承载大量事实数据。 | 事件 payload 只带 domain、sequence、status、诊断摘要；前端收到后调用 typed API 拉取事实源。 |

参考链接：

- <https://docs.rs/notify>
- <https://docs.rs/notify-debouncer-full>
- <https://github.com/paulmillr/chokidar#readme>
- <https://github.com/microsoft/vscode/wiki/File-Watcher-Internals>
- <https://v2.tauri.app/develop/calling-frontend/>

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| 仅增加手动刷新按钮 | 改动最小，风险低 | 不满足外部 Agent 写配置后自动可见；用户仍要知道何时刷新 | 体验割裂，容易误以为 AI 没写成功 | 前端点击测试 |
| 前端定时轮询所有配置 | 实现简单，无 native watcher 依赖 | 浪费 IO；延迟和电量不可控；难以给出精确诊断 | 大配置目录或网络盘会拖慢 UI | 轮询压测、功耗观察 |
| Rust 原始 watcher 事件直通前端 | 延迟低，代码短 | 平台差异和编辑器 atomic save 暴露给 UI；会产生多次刷新和误报 | 半写入/短暂删除导致 UI 报错或闪烁 | 真实编辑器保存矩阵 |
| Rust 观察 + 归一化 + 域级失效通知 + 前端 typed reload | 边界清晰；能合并多事件；可诊断；前端仍以事实源为准 | 需要新增后端服务、事件模型、前端 coordinator 和测试 | 设计不当会和应用内保存产生重复刷新 | fake watcher 单测、真实 watcher smoke、UI 事件测试 |
| 引入外部 sidecar 或 app-server 事件总线 | 能做跨进程复杂同步 | 和 ADR-0017 的外部 Agent 边界冲突；部署复杂 | 多一个运行时组件和权限面 | 不采用 |

## 决策

采用“Rust 配置变更观察者 + 域级失效通知 + 前端刷新协调器”的方案。

核心规则：

- `ConfigFileStore` 继续是配置事实源；watcher 永远只触发 reload，不把文件内容作为事实传给前端。
- Rust 新增 `ConfigChangeObserverService`，负责：
  - watch `settings.toml`、`profiles/`、`hosts/`、`secrets/hosts/`、`snippets/`、`workflows/`；
  - 忽略 `.storage.lock`、`storage-manifest.toml`、`backups/`、临时 `.tmp-*`、日志、agent sessions 和无关目录；
  - 将路径归类为 `settings | profiles | hosts | snippets | workflows`；
  - 对原始事件做 debounce、dedupe、retry 和 sequence ordering；
  - native watcher 失败时降级为 polling watcher；
  - 发送 Tauri 事件 `kerminal-config-changed`。
- Tauri 事件 payload 只包含稳定元信息：
  - `version`
  - `sequence`
  - `batchId`
  - `observedAt`
  - `domains`
  - `status: ready | invalid | watcher-unavailable`
  - `diagnostics` 摘要
  - `sourceHint: kerminal | external | unknown`
- `secrets/hosts/*.toml` 变化只映射到 `hosts` domain，不发送 secret 文件名或内容。
- 用户可见的“变更了什么”不由后端 watcher 事件直接提供。前端在 reload 成功后，用 reload 前后的公开 UI 状态做 diff，生成 `ConfigChangeNotice`：
  - hosts/profiles/snippets/workflows 可展示 UI 已经可见的 id/name/title 和数量，例如 `cfg: +1 host "staging-api"`、`cfg: snippets +2`；
  - settings 只展示 section 级摘要，例如 `cfg: settings reloaded`，不展示原始配置值；
  - secret-only 变化最多展示 `cfg: host credentials updated`，不展示 secret 路径、用户名、密码、私钥、token 或文件名；
  - 多域批量变化合并为一条，例如 `cfg: hosts +2, workflows +1`，避免 toast 风暴。
- 前端新增 `useKerminalConfigEvents` / `configRefreshCoordinator`，统一处理事件：
  - hosts -> 调用现有 `refreshRemoteHostTree()`；
  - profiles -> 调用 `listProfiles()` 并同步 local sidebar；
  - settings -> 调用 settings reader 并更新全局主题/设置；如果设置弹窗有未保存状态则提示而不是覆盖表单；
  - snippets/workflows -> 通过 domain revision invalidation 让对应工具面板刷新；如果面板未打开则只记录 revision。
- UI 遇到 invalid 配置时保持 last-known-good，不清空当前列表，不关闭已有终端，不自动覆盖编辑中的表单。
- 正常 external/unknown 变更刷新成功后显示非阻塞 notice，默认 2600-3500ms 自动关闭；invalid/watcher-unavailable 也使用简洁提示自动关闭，但诊断状态保留在 diagnostics/status 入口。
- notice 视觉必须复用现有主题变量或成对 `dark:` 样式，支持 light/dark/follow system；使用 `aria-live="polite"`，避免遮挡终端输入、侧栏菜单和弹窗焦点。
- 观察者状态对诊断可见：新增只读 command 或 diagnostics 项，返回 watcher backend、watched paths、last sequence、last event、last error、fallback 状态。

## 影响

- 正向影响：
  - 外部 Agent 直接修改配置后，运行中的 Kerminal 能自动展示新 host/profile/snippet/workflow/settings。
  - watcher 与 UI 解耦，避免平台文件事件差异污染前端状态。
  - 配置坏掉时保留当前可用 UI，并给出可操作诊断。
  - 为后续外部 Agent 协作、配置手册和 validator 建立统一运行时反馈闭环。
- 负向影响：
  - Rust 依赖增加 `notify` / `notify-debouncer-full`。
  - 启动时多一个后台 watcher；需要处理 app 生命周期和资源释放。
  - 前端配置刷新路径会变成事件驱动，需要补状态竞争和脏表单测试。
- 需要同步修改：
  - `src-tauri/Cargo.toml` 和 `Cargo.lock`
  - `src-tauri/src/services/config_change_observer_service.rs`
  - `src-tauri/src/models/config_change.rs`
  - `src-tauri/src/state.rs`
  - `src-tauri/src/lib.rs` 或 app setup lifecycle
  - `src-tauri/src/commands/diagnostics.rs` 或新增只读 watcher status command
  - `src/app/KerminalShell.tsx`
  - `src/app/useKerminalShellRemoteActions.ts`
  - settings/snippets/workflows 工具刷新入口和测试
  - `.updeng/docs/config/kerminal-config-files.md` 与外部 agent runtime prompt，在实现完成后补充“自动可见”和“坏配置处理”说明

## 回滚或替代

- 短期回滚：保留 typed reload API，移除 watcher 启动和事件订阅；应用恢复到启动/保存后刷新行为。
- 运行时降级：如果 native watcher 无法启动，自动切到 polling；如果 polling 也失败，仅禁用自动刷新并显示诊断，不影响手动保存和启动读取。
- 安全降级：如果事件分类或 reload 失败，前端保持 last-known-good；用户可修复 TOML 后 watcher 再次触发。
- 依赖替代：如果 `notify-debouncer-full` 在目标平台表现不稳定，可保留 `notify` 原始 watcher，使用项目内 `ConfigChangeCoalescer` 完成去抖。

## 验证

- Rust unit:
  - 路径分类、忽略规则、secret redaction、domain 合并、sequence 单调性。
  - fake watcher 输入 create/remove/rename/modify 风暴，只输出一次 domain 事件。
  - half-written TOML 先 invalid 后修复，last-known-good 不被清空。
- Rust integration:
  - temp config root 写入 `hosts/groups.toml` + `hosts/<id>.toml` 后触发 hosts event。
  - native watcher 不可用时 polling fallback 状态可见。
- Frontend:
  - 收到 hosts event 后调用 `refreshRemoteHostTree()` 并保留当前选中机器的合理 fallback。
  - reload 成功后基于 old/new public state 生成 geek notice；单项新增显示名称，批量变化显示数量，secret/settings 不泄露原始值。
  - notice 自动关闭、清理 timer，重复事件合并，不产生 toast 风暴。
  - settings 弹窗 dirty 时不覆盖本地表单，只提示外部配置变化。
  - snippets/workflows 未打开时记录 revision，打开后刷新。
  - invalid event 显示错误提示但不清空 UI。
- End-to-end:
  - `npm run build`
  - `cargo test --manifest-path src-tauri/Cargo.toml config_change_observer config_file_store`
  - 真实 `npm run tauri:dev`：在 `~/.kerminal/hosts/*.toml` 外部新增 host，左侧主机树自动出现，并显示类似 `cfg: +1 host "staging-api"` 的自动关闭提示；写入坏 TOML 后 UI 保持稳定，修复后自动恢复。
  - 涉及 UI 提示时做 light/dark/system 主题截图。
