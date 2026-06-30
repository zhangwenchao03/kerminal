---
id: PLAN-20260619-000004-ssh-command-ghost-suggestions
status: blocked
created_at: 2026-06-19T00:00:04+08:00
started_at: 2026-06-19T00:00:04+08:00
completed_at: 
updated_at: 2026-06-21T08:47:10+08:00
owner: ai
---
# SSH 远程命令灰色提示生产级实施计划

## 目标

- 实现可长期使用的生产级 SSH 命令 inline suggestion，不是 MVP demo。
- 不要求用户在远端主机安装 fish、zsh 插件、shell integration、agent、Node/Python 运行时或联网下载内容。
- 在远端无互联网环境下仍可使用本地历史、离线 CLI specs、SFTP 路径缓存、Git/命令只读探测和本地索引。
- 对终端交互保持保守：提示不写入 PTY，不污染 scrollback，不破坏远端 shell Tab 补全和全屏程序。
- 建立 provider 架构，使本地终端、SSH、Docker 容器、AI 未来都走同一套建议管线。

## 非目标

- 不默认读取或修改远端 shell init 文件。
- 不默认上传命令历史、远端路径或环境信息到云端。
- 不在第一阶段实现 PTY proxy 或替换当前 SSH 交互通道。
- 不追求对所有 shell line editor 的 100% 精确模拟；不可确定场景必须降级。

## 产品验收口径

生产完成至少满足：

- **可用性**：常用 SSH bash/zsh/sh 场景可稳定显示、隐藏、接受建议；Tab 默认仍交给远端。
- **准确性**：能综合同主机/同目录历史、远端路径、Git refs、远端命令、静态 CLI specs 排序，不只是历史前缀匹配。
- **离线性**：远端主机没有互联网时，除 AI provider 外所有核心 provider 可工作。
- **安全性**：敏感命令和 secret 默认不提示；生产主机危险建议降权或需要显式确认；provider 可关闭。
- **性能**：按键同步路径无远端 IO，P95 查询和渲染不产生可感知卡顿。
- **可维护性**：provider、评分、缓存、设置、审计和测试边界清晰。

## 架构分层

| 层 | 模块 | 职责 |
| --- | --- | --- |
| 输入模型 | `TerminalInputModel` | 跟踪当前命令行、光标、粘贴、选择、buffer、提交/取消状态 |
| 渲染 | `GhostTextRenderer` | 在 xterm 上方绘制灰色后缀，不写入 terminal buffer |
| 编排 | `SuggestionOrchestrator` | 合并 provider、取消过期请求、排序、去重、降级 |
| Provider | history/path/command/git/spec/AI | 产生候选和解释信息 |
| 本地索引 | SQLite + 内存快照 | 保存候选、TTL、provider cache、score features |
| 远端采集 | SFTP + SSH command | 后台只读采集路径、Git、命令、可选远端 history |
| 安全 | policy + redaction + audit | 敏感过滤、生产主机策略、AI/provider 审计 |

## 外部调研结论

- xterm.js 提供 decoration 能力，但它主要面向 buffer 范围装饰；inline ghost text 仍更适合用 DOM overlay 绑定 cursor/cell 坐标实现，避免污染 PTY buffer。
- VS Code 的 terminal shell integration 能获得命令边界、exit code 和 decorations，但需要 shell integration；本项目约束是不要求远端安装或修改 shell，因此只能把它作为能力对照，不作为默认依赖。
- `zsh-autosuggestions`、fish autosuggestion、Atuin、inshellisense、Amazon Q CLI/Fig 类方案说明了 history/spec/AI/provider 化是有效方向，但多数需要本机 shell 插件、额外 runtime、专用 CLI 或云/同步能力；Kerminal 的 SSH 场景应把这些能力下沉为本地索引和显式只读远端采集。
- `withfig/autocomplete` 的 completion specs 可作为离线 CLI Spec provider 参考，但需要许可证、体积和动态 generator 安全审计，不能直接把任意 generator 放到生产路径。

参考：

- https://xtermjs.org/docs/api/terminal/classes/terminal/#registerdecoration
- https://code.visualstudio.com/docs/terminal/shell-integration
- https://github.com/zsh-users/zsh-autosuggestions
- https://github.com/atuinsh/atuin
- https://github.com/microsoft/inshellisense
- https://github.com/withfig/autocomplete
- https://aws.amazon.com/about-aws/whats-new/2024/06/amazon-q-inline-completions-command-line/

## 实施切片

| 顺序 | 标题 | 类型 | 依赖 | 覆盖故事 | 验收 |
| --- | --- | --- | --- | --- | --- |
| 1 | 输入模型与保守降级规则 | AFK | None | US-1/US-2 | 单元测试覆盖普通输入、编辑键、提交、取消、粘贴、IME、宽字符、alternate buffer 禁用 |
| 2 | GhostTextRenderer 生产渲染 | AFK | 1 | US-1 | 不调用 `terminal.write`；resize/scroll/theme/font/DPI 下位置正确；右方向键只写入后缀 |
| 3 | 建议 IPC、索引 schema 和 provider trait | AFK | None | US-3 | Rust/TS 类型稳定；SQLite migration、TTL、provider metadata、查询索引测试通过 |
| 4 | History provider 生产化 | AFK | 3 | US-3/US-4 | 同 host/cwd/session/source/frecency 排序；10k/100k 历史性能达标；敏感命令过滤 |
| 5 | Remote Path provider | AFK | 3 | US-5 | 使用 SFTP list/stat 后台缓存当前 cwd/显式访问目录；无互联网远端可用；超时不阻塞输入 |
| 6 | Remote Command provider | AFK | 3 | US-6 | 受控 SSH 命令采集 PATH 可执行、shell builtins、alias/function 摘要；有超时、输出上限、审计 |
| 7 | Git provider | AFK | 3 | US-7 | 在 Git workspace 中缓存 branch/tag/remote/stash 摘要；非 Git 目录静默跳过 |
| 8 | Bundled CLI Spec provider | AFK | 3 | US-8 | 打包静态 specs 子集；无网络可用；覆盖 git/docker/npm/cargo/kubectl/ssh/systemctl 等 |
| 9 | 评分、去重和解释 | AFK | 4-8 | US-9 | 候选带 provider/source/explanation；综合 token、语法位置、host/cwd、frecency、provider 置信度排序 |
| 10 | 设置、安全策略和审计 | AFK | 4-9 | US-10 | provider 级开关、接受键、生产主机策略、敏感过滤、审计事件可验证 |
| 11 | XtermPane 端到端集成 | AFK | 1-10 | US-1..US-10 | SSH 真实会话中显示/接受/隐藏正确；全屏程序、断线重连、大输出无残留 |
| 12 | 可观测性和性能基准 | AFK | 11 | US-11 | provider latency、cache hit、remote probe errors、accepted/dismissed 事件可统计；基准脚本可重复 |
| 13 | 可选 AI provider | HITL | 10-12 | US-12 | 需确认隐私、模型、本地/远程策略；默认关闭，关闭后核心 provider 不受影响 |
| 14 | 远端 shell history 只读缓存 | AFK | 10 | US-13 | 随 history provider 和 remoteProbe 策略启用；只读读取 `.bash_history`/`.zsh_history`/`.ash_history` 等常见文件，敏感过滤后进入本地 TTL cache |

## User Stories

- US-1：作为 SSH 用户，我输入 `git ch` 时能看到灰色建议，按右方向键接受，不自动执行。
- US-2：作为终端用户，我在 `vim`、`less`、`top`、`tmux` 或粘贴多行命令时不会被错误提示打扰。
- US-3：作为长期用户，我的同主机、同目录历史命令会优先被建议。
- US-4：作为安全敏感用户，包含 token/password/private key 的命令不会被建议。
- US-5：作为远端文件用户，我输入 `cd /var/lo`、`cat app.` 时能得到远端路径建议，即使远端无互联网。
- US-6：作为远端 shell 用户，我能获得远端 PATH 中真实存在的命令建议，但 Kerminal 不在远端安装任何东西。
- US-7：作为 Git 用户，我在远端 repo 内输入 `git checkout`、`git pull origin` 时能看到分支/remote 建议。
- US-8：作为 CLI 用户，我输入 `kubectl get --`、`docker compose` 时能获得离线 specs 驱动的子命令/参数建议。
- US-9：作为用户，我看到的建议来源可解释，错误建议会被降权而不是反复出现。
- US-10：作为团队用户，我能按主机、provider、生产环境关闭或限制建议。
- US-11：作为维护者，我能看到 provider 延迟、缓存命中率、远端探测失败等诊断信息。
- US-12：作为 AI 用户，我可以显式开启 AI 生成命令建议，但默认不会把数据发出去。
- US-13：作为 SSH 用户，我可以在不安装远端插件的前提下，连接后按策略自动只读读取远端 shell history，并把安全过滤后的命令作为可关闭、可清理、带 TTL 的本地索引。

## 详细实施

### 1. 输入模型与渲染

- 新增 `src/features/terminal/terminalInputModel.ts`。
- 输入模型不依赖 React state，保持同步路径小于 1ms。
- 支持：
  - printable ASCII 和 Unicode 宽字符。
  - Backspace/Delete/Left/Right/Home/End。
  - Ctrl+C/Ctrl+U/Ctrl+W/Esc/Enter。
  - paste start/end 或大块 `onData` 粘贴识别。
  - normal/alternate buffer 状态。
- 明确降级：
  - 光标不在行尾、选择文本、多行不确定、alternate buffer、鼠标应用模式、IME composition 未结束时隐藏。
- `GhostTextRenderer` 优先 DOM overlay：
  - 使用 xterm cell 宽高和 cursor 位置计算。
  - 支持 theme token、font size、line height、devicePixelRatio、resize。
  - 超出可视区域时裁剪或隐藏，不让文本覆盖下一行。

### 2. Rust suggestion service 和索引

- 新增 model：
  - `CommandSuggestionRequest`
  - `CommandSuggestionCandidate`
  - `SuggestionProviderKind`
  - `SuggestionContext`
  - `SuggestionTelemetryEvent`
- 新增 service：
  - `CommandSuggestionService`
  - `SuggestionProvider` trait
  - `SuggestionIndexer`
  - `RemoteProbeScheduler`
- SQLite 新增表或等价 schema：
  - `suggestion_candidates`
  - `suggestion_provider_cache`
  - `suggestion_remote_probe_runs`
  - `suggestion_user_feedback`
- 关键索引：
  - `(target_key, cwd_scope, provider, normalized_prefix)`
  - `(remote_host_id, provider, ttl_expires_at)`
  - `(candidate_hash, provider)`
- 查询路径：
  - 前端请求只读取内存 snapshot 或 SQLite 缓存。
  - 远端刷新异步运行，完成后通过 event 通知前端下一次输入可用。

### 3. Provider 实现

#### History provider

- 使用现有 `command_history` 表作为基础。
- 增加聚合视图或增量索引，记录频次、最近时间、cwd、host、source、成功状态候选字段。
- 后续如果接入 exit status，需要从 command block/session 结果记录补充。

#### Remote Path provider

- 使用现有 SFTP 后端。
- 触发：
  - SSH session connected 后预热 cwd。
  - 用户打开 SFTP 目录后复用列表结果。
  - 输入 path token 且缓存缺失时排后台刷新。
- 限制：
  - 单目录条目上限。
  - TTL 5-30s，可按目录大小调整。
  - 不递归扫描；不扫描 `/proc`、`/sys`、`.git/objects` 等高风险目录。

#### Remote Command provider

- 通过 `SshCommandService` 运行只读短命令，例如获取 `$PATH`、`command -v`、`compgen -c`、`alias`、`declare -F`，但必须按 shell/OS 能力降级。
- 不要求 bash 必须存在；sh 场景只采集 PATH 可执行。
- 输出上限和超时严格控制，失败不影响终端。

#### Git provider

- 仅在 cwd 或父级存在 `.git` 时触发。
- 采集：
  - branch/tag/remote。
  - 当前 HEAD、upstream、常用 ref。
  - 可选 status 摘要，但避免大 repo 卡顿。
- 每个 repo 独立 TTL；用户切换 cwd 后按 repo root 复用。

#### CLI Spec provider

- 使用 Fig-compatible 静态 specs 的离线子集。
- 不默认执行原始 JS generator。
- 内置少量安全 generator，例如从 provider cache 取 Git refs、路径、远端命令。
- specs 打包进应用或单独离线包；版本和许可证写入 manifest。

#### AI provider

- 默认关闭。
- 只读取用户允许的上下文：当前输入、最近历史、当前 cwd、可见终端摘要、provider 候选。
- 必须有 redaction、预算、超时、审计和“AI 来源”标识。
- 生产主机默认不启用 AI，除非用户或策略明确允许。

### 4. 设置和策略

新增设置建议：

```json
{
  "terminal.inlineSuggestion.enabled": true,
  "terminal.inlineSuggestion.acceptKey": "rightArrow",
  "terminal.inlineSuggestion.providers.history": true,
  "terminal.inlineSuggestion.providers.remotePath": true,
  "terminal.inlineSuggestion.providers.remoteCommand": true,
  "terminal.inlineSuggestion.providers.git": true,
  "terminal.inlineSuggestion.providers.spec": true,
  "terminal.inlineSuggestion.providers.ai": false,
  "terminal.inlineSuggestion.remoteProbeEnabled": true,
  "terminal.inlineSuggestion.productionHostPolicy": "restricted"
}
```

策略规则：

- 生产主机默认禁用 AI provider、远端 shell history 只读探测和危险命令自动建议；已有本地 history 仍可继续用于建议。
- 敏感模式命中时候选不展示或只展示脱敏解释。
- 用户 dismiss 多次的候选降权。
- 用户接受的候选提权，但 dangerous command 不因接受而跳过安全策略。

### 5. 性能预算

| 指标 | 目标 |
| --- | --- |
| 输入模型同步处理 | P95 < 1ms |
| 前端请求 debounce | 40-80ms 可配置 |
| 本地候选查询 | 10k candidates P95 < 10ms，100k P95 < 30ms |
| Overlay re-layout | P95 < 4ms |
| 远端 probe | 默认超时 1-3s，后台运行，不阻塞输入 |
| SFTP list | 单目录上限和 TTL 控制，失败静默降级 |
| 内存 | 每 host/provider snapshot 有上限和 LRU |

## 验证计划

自动化：

- `npm run test:frontend`
- `cd src-tauri && cargo test command_suggestion`
- `cd src-tauri && cargo test sftp`
- `cd src-tauri && cargo test ssh_command`
- `npm run build`
- 性能基准脚本：历史 10k/100k、路径 10k、spec 1k command、混合 provider。

手工 smoke：

- SSH 到无互联网 Linux 主机，验证 history/path/git/spec provider。
- SSH 到只支持 `/bin/sh` 的主机，验证 PATH command provider 降级。
- 大目录、慢网络、认证失败、断线重连下不阻塞输入。
- 在 `vim`、`less`、`top`、`tmux`、nested ssh 中不错误展示。
- 中文输入、宽字符、窗口缩放、字体切换、深浅色主题下 overlay 正常。
- 生产主机策略和 provider 关闭开关有效。

## 风险和处理

- **输入模型误判**：宁可隐藏建议，不强行显示；用 telemetry 找高频误判场景。
- **远端采集慢**：所有采集后台化、TTL 化、可取消；按主机限流。
- **远端权限不足**：provider 独立失败，不影响其他 provider。
- **Spec 许可证/体积**：先小集合、manifest 记录来源；后续支持离线包。
- **敏感数据**：默认本地处理，AI off，redaction 测试必须覆盖。
- **复杂 shell 语法**：先支持 command/subcommand/option/path 的实用解析；复杂语法降级到 history/provider exact prefix。

## Ready for Agent 切片

优先顺序：

1. 输入模型与渲染。
2. Suggestion IPC/schema/provider trait。
3. History provider。
4. Remote Path provider。
5. XtermPane 集成。

这些切片信息充足，可以 AFK 实现。Remote shell history 已按 history provider + remoteProbe 策略落地为只读 TTL cache；AI provider 仍需要 HITL 确认默认策略。Spec provider 需要先做许可证和打包体积审计。

## 当前实现进度

2026-06-19 进展：

- 已完成 slice 1 的输入模型基础：新增 `src/features/terminal/terminalInputModel.ts`，覆盖普通输入、光标编辑、Home/End/Delete、Ctrl+C/Ctrl+U/Ctrl+W、history navigation 降级、Tab 降级、alternate buffer、IME 和宽字符。
- 已让 `XtermPane.collectSubmittedCommands` 委托新的输入模型，避免命令块/历史记录继续使用旧的简化 buffer 语义。
- 已完成 slice 3 的前端契约基础：新增 `src/lib/terminalSuggestionApi.ts`，定义 request、candidate、provider、replacement range、sensitivity，并提供浏览器预览 history fallback。
- 已补充 `src/features/terminal/terminalInputModel.test.ts` 和 `src/lib/terminalSuggestionApi.test.ts`。
- 已验证：
  - `npm run test:frontend -- src/features/terminal/terminalInputModel.test.ts src/lib/terminalSuggestionApi.test.ts src/features/terminal/XtermPane.test.tsx`
  - `npm run typecheck`

仍未完成：

- GhostTextRenderer 的 DOM overlay 基础和 headless Chrome 帧预算基准已落地，但还需要真实 SSH/字体/缩放/宽字符/全屏程序人工验证。
- Rust `CommandSuggestionService`、Tauri command、SQLite 候选索引、持久 provider cache、remote probe scheduler、telemetry 和导出基础已落地；还需要审计事件、清理策略和更多用户可导出的上下文。
- History provider 已支持 host/cwd/session/source 评分、provider 关闭、敏感过滤、危险命令降权、10k/100k 性能基准和用户反馈调权；后续只按真实使用反馈扩展。
- Remote Path provider 已有显式 SFTP 刷新、输入时只读缓存候选、持久缓存和前端 probe 调度；还需要目录访问复用、大目录策略和真实 SSH/SFTP smoke。
- Remote Command provider 已有受控 SSH PATH 扫描、shell builtin cache、持久缓存和前端 probe 调度；还需要真实多发行版 smoke 和 alias/function 安全采集评估。
- Git provider 已有受控 SSH refs/remotes 扫描、持久 TTL cache 和常见 Git 子命令参数位置建议；还需要真实多仓库 smoke 和复杂 Git option 组合。
- Spec provider 已有内置静态离线子集，覆盖 git/docker/docker compose/kubectl/npm/cargo/ssh/systemctl 的常用子命令和选项；还需要许可证化 manifest、更多命令覆盖、可更新离线包和动态 generator 安全策略。
- 设置模型、设置页 provider 开关、接受键、远端探测总开关、主机级生产策略和用户反馈降权已落地；审计事件仍需继续。
- SSH 真实会话、无互联网远端、全屏程序、慢网络和生产主机策略仍需人工端到端 smoke。

2026-06-19 追加进展：

- 新增后端模型/服务/命令：
  - `src-tauri/src/models/command_suggestion.rs`
  - `src-tauri/src/services/command_suggestion_service.rs`
  - `src-tauri/src/commands/command_suggestion.rs`
- `AppState` 增加 `CommandSuggestionService`，`lib.rs` 注册 `command_suggestion_list`。
- XtermPane 已接入 history provider 请求、60ms debounce、过期请求取消、DOM 灰色后缀渲染、scroll/resize/writeParsed 位置刷新、session/alternate buffer/提交清理。
- RightArrow 在存在 ghost suggestion 时只写入 suggestion suffix，不把方向键发送到 PTY；无建议时保持原有远端 shell 行为。
- 新增/更新测试：
  - `src-tauri/tests/command_suggestion_service.rs`
  - `src/features/terminal/XtermPane.test.tsx`
- 已验证：
  - `cargo test --test command_suggestion_service`
  - `cargo test command_suggestion_service::tests`
  - `cargo fmt --check -- src/models/command_suggestion.rs src/services/command_suggestion_service.rs src/commands/command_suggestion.rs src/state.rs src/lib.rs src/models/mod.rs src/services/mod.rs src/commands/mod.rs tests/command_suggestion_service.rs`
  - `npm run test:frontend -- src/features/terminal/terminalInputModel.test.ts src/lib/terminalSuggestionApi.test.ts src/features/terminal/XtermPane.test.tsx`
  - `npm run typecheck`

2026-06-19 Remote Path provider 追加进展：

- 新增 `command_suggestion_refresh_remote_paths` Tauri command：通过现有 `SftpService::list_directory` 显式刷新远端目录，不要求远端安装插件、agent、fish 或 zsh 集成。
- `CommandSuggestionService` 增加 remotePath 内存缓存：按 `(host_id, directory)` 存储 SFTP listing，带 TTL、单目录条目上限、全局目录上限和过期/最旧淘汰。
- `command_suggestion_list` 的按键同步路径只读本地缓存；没有缓存时静默无候选，不触发远端 IO。
- Remote Path 候选支持常见 shell token：绝对/相对/`~` 路径、单双引号、反斜杠转义；无法确定的语法保守不提示。
- XtermPane 在 SSH session connected 和 cwd OSC 更新时低频预热当前目录；SSH 输入建议 provider 扩展为 `history + remotePath`，Docker 容器暂不接入 SFTP 路径 provider。
- 新增/更新验证：
  - `cargo test --test command_suggestion_service`
  - `cargo test command_suggestion_service::tests`
  - `cargo fmt --check`
  - `npm run test:frontend -- src/lib/terminalSuggestionApi.test.ts src/features/terminal/XtermPane.test.tsx src/features/terminal/terminalInputModel.test.ts`
  - `npm run typecheck`
  - `npm run build`

2026-06-19 Remote Command provider 追加进展：

- 新增 `command_suggestion_refresh_remote_commands` Tauri command：通过现有 `SshCommandService` 执行短生命周期、只读、POSIX `sh` 兼容的 `$PATH` 可执行文件扫描，不要求远端安装插件、agent、fish、zsh 集成或联网下载内容。
- `CommandSuggestionService` 增加 remoteCommand 内存缓存：按 host 存储远端命令候选，带 TTL、命令数量上限、2s SSH command 超时和 64KB 输出上限。
- `command_suggestion_list` 的按键同步路径只读本地缓存；没有缓存时静默无候选，不触发远端 IO。
- Remote Command 候选只在 command position 生效，避免把 `git ch` 这类参数位置误判为远端可执行命令；同时补充常见 POSIX shell builtins。
- XtermPane 在 SSH session connected 后按 host 低频预热远端命令缓存；SSH 输入建议 provider 扩展为 `history + remotePath + remoteCommand`。
- 为通过完整验证，顺手修复了当前工作树中阻塞编译的两个既有集成问题：`rmcp` streamable HTTP server feature/JSON 错误映射，以及 `docker_host_service` 中重复 helper 实现导致的 Rust 重定义。
- 新增/更新验证：
  - `npm run typecheck`
  - `npm run test:frontend -- src/lib/terminalSuggestionApi.test.ts src/features/terminal/XtermPane.test.tsx src/features/terminal/terminalInputModel.test.ts`
  - `npm run build`
  - `cargo fmt --check`
  - `cargo test --test command_suggestion_service`

2026-06-19 Git provider 追加进展：

- 新增 `command_suggestion_refresh_git_refs` Tauri command：通过现有 `SshCommandService` 执行短生命周期、只读、POSIX `sh` 兼容的 Git 探测脚本。
- 远端脚本只执行 `command -v git`、`git rev-parse`、`git for-each-ref` 和 `git remote`；非 Git 目录或无 Git 命令时静默缓存空结果，不要求远端安装插件、agent、shell integration 或联网。
- `CommandSuggestionService` 增加 Git refs 内存缓存：按 `(host_id, cwd)` 存储 branch、remoteBranch、tag、remote，带 TTL、单仓库条目上限、仓库缓存数量上限、2s SSH command 超时和 64KB 输出上限。
- `command_suggestion_list` 的按键同步路径只读本地缓存；没有缓存时静默无候选，不触发远端 IO。
- Git 候选支持常见位置：
  - `git checkout/switch/branch/merge/rebase/show/log/diff` 的 ref/branch/tag 位置。
  - `git fetch/pull/push` 的 remote 位置，以及 remote 后的 ref/branch 位置。
- Git ref 名默认只接受常见安全字符集合，避免把奇怪 ref 名作为可直接写入终端的建议。
- XtermPane 在 SSH session connected 和 cwd OSC 更新时低频预热 Git refs；SSH 输入建议 provider 扩展为 `history + remotePath + remoteCommand + git`。
- 新增/更新验证：
  - `cargo test --test command_suggestion_service`
  - `cargo test command_suggestion_service::tests`
  - `npm run test:frontend -- src/lib/terminalSuggestionApi.test.ts src/features/terminal/XtermPane.test.tsx src/features/terminal/terminalInputModel.test.ts`
  - `npm run typecheck`
  - `cargo fmt --check`
  - `npm run build`

2026-06-19 Spec provider 追加进展：

- 新增后端离线 CLI Spec provider：不触发远端 IO，不要求远端安装 shell 插件、agent、Node/Python runtime 或联网。
- 内置静态 spec 子集覆盖：
  - `git` 常用子命令和选项。
  - `docker` 与 `docker compose` 常用子命令和选项。
  - `kubectl` 常用子命令、资源类型和选项。
  - `npm`、`cargo`、`ssh`、`systemctl` 常用子命令或选项。
- Spec provider 使用同一套 shell token 保守解析：复杂引号、控制字符或不确定 token 静默不提示。
- XtermPane SSH 输入建议 provider 扩展为 `history + remotePath + remoteCommand + git + spec`。
- 新增/更新验证：
  - `cargo test --test command_suggestion_service`
  - `cargo test command_suggestion_service::tests`
  - `npm run test:frontend -- src/lib/terminalSuggestionApi.test.ts src/features/terminal/XtermPane.test.tsx src/features/terminal/terminalInputModel.test.ts`
  - `npm run typecheck`
  - `cargo fmt --check`
  - `npm run build`

2026-06-19 设置策略与收口验证追加进展：

- 新增 `TerminalInlineSuggestionSettings` 前后端设置模型，默认启用 history、remotePath、remoteCommand、git、spec provider，AI provider 保留但默认关闭且当前不在 UI 暴露。
- 设置页已加入“命令灰色提示”分组，支持：
  - 总开关。
  - 远端只读探测总开关。
  - 接受按键选择：右方向键或不绑定。
  - history、remotePath、remoteCommand、git、spec provider 级开关。
- `XtermPane` 按设置动态决定：
  - inline suggestion disabled 时不发起 suggestion 请求、不显示 ghost。
  - acceptKey disabled 时右方向键继续原样发送给远端 PTY。
  - remoteProbeEnabled disabled 时不预热远端路径、远端命令和 Git refs，SSH 输入请求只保留本地 history + 离线 spec provider。
  - 离线 CLI Spec provider 同时用于本地终端和 SSH，不依赖远端环境。
- Rust settings service 已持久化 inline suggestion 设置，并覆盖 SQLite reload 测试。
- 新增/更新验证：
  - `npm run test:frontend -- src/features/settings/settingsModel.test.ts src/features/settings/SettingsToolContent.test.tsx src/lib/terminalSuggestionApi.test.ts src/features/terminal/XtermPane.test.tsx src/features/terminal/terminalInputModel.test.ts`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test settings_service`
  - `npm run typecheck`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_service`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - `npm run build`
  - `cargo test --manifest-path src-tauri/Cargo.toml`

2026-06-19 Provider cache 持久化追加进展：

- 新增 SQLite schema v13：`command_suggestion_provider_cache`，按 `(provider, host_id, scope_key)` 持久化 remotePath、remoteCommand、git provider cache；schema v18 已扩展允许 `history` provider 的 `remoteHistory` cache。
- 缓存 payload 使用 JSON 保存已经归一化和过滤过的 provider 数据：
  - remoteCommand：远端 PATH 命令 + POSIX builtins。
  - remotePath：SFTP 目录条目。
  - git：branch、remoteBranch、tag、remote。
- 刷新路径写入内存 cache 后同步写 SQLite；输入按键查询路径先查内存，miss 时只读 SQLite 未过期缓存并回填内存，不触发远端 IO。
- 过期缓存不会返回；后续可增加后台清理和 telemetry。
- 新增/更新验证：
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_service`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - `cargo test --manifest-path src-tauri/Cargo.toml`

2026-06-19 性能基准与 history 查询优化追加进展：

- 新增 ignored benchmark-style 集成测试：`src-tauri/tests/command_suggestion_performance.rs`。
- 手动运行命令：`cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_performance -- --ignored --nocapture`。
- 覆盖数据规模：
  - 10k command history。
  - 5k remoteCommand cache。
  - 1k remotePath cache。
  - 1k Git refs cache。
- 首次 benchmark 暴露 history provider 仍把全部历史拉到 Rust 过滤，10k history+spec 查询约 45ms。
- 已优化 `CommandHistoryService::list_history`：把 source/target/pane/host/session/query/limit 下推到 SQLite，保留原有 contains 语义并转义 LIKE wildcard。
- 优化后本机 debug 基线：
  - seed：约 5.82s。
  - 10k history + spec：约 8.07ms。
  - remoteCommand：约 0.63ms。
  - remotePath：约 0.41ms。
  - Git：约 0.18ms。
- 新增/更新验证：
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_history_service --test command_suggestion_service`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_performance -- --ignored --nocapture`

2026-06-19 生产主机策略与反馈调权追加进展：

- `TerminalPane` 增加 `remoteHostProduction`，SSH/容器 pane 从远程主机配置继承生产标记；分屏复制时继承，session restore 时兼容旧数据。
- `setRemoteHostTree` 和 `restoreWorkspaceSession` 会按最新主机树同步已恢复 pane 的生产标记，避免旧 session 缺字段绕过 restricted 策略。
- `XtermPane` 已接入 `productionHostPolicy`：
  - 默认 `restricted` 下，生产 SSH 主机不预热 remotePath、remoteCommand、git，也不把这些 remote provider 传入按键查询。
  - 显式切到 `normal` 时，生产主机仍可启用远端只读探测。
  - 本地 history 和离线 spec 不受生产主机远端探测限制影响。
- 新增 SQLite schema v14：`command_suggestion_feedback`，记录 accepted/dismissed 反馈，不写入敏感命令反馈。
- 前端反馈路径：
  - RightArrow 接受 ghost suggestion 记录 `accepted`。
  - 有可见 ghost suggestion 但用户直接 Enter 提交不同命令时记录 `dismissed`。
  - 普通继续输入不记录 dismiss，降低误降权。
- `CommandSuggestionService` 在排序前读取反馈聚合：accepted 轻微提权，dismissed 明显降权，但不直接删除候选，dangerous/sensitive 原有策略仍优先。
- 新增/更新验证：
  - `npm run test:frontend -- src/features/terminal/XtermPane.test.tsx src/lib/terminalSuggestionApi.test.ts src/features/workspace/workspaceStore.test.ts src/features/workspace/workspaceSession.test.ts`
  - `npm run test:frontend`
  - `npm run typecheck`
  - `npm run build`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_service --test storage_foundation`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_performance -- --ignored --nocapture`
- 最新本机 debug benchmark：
  - seed：约 4.70s。
  - 10k history + spec：约 5.40ms。
  - remoteCommand：约 0.62ms。
  - remotePath：约 0.44ms。
  - Git：约 0.29ms。

2026-06-19 遥测、诊断 UI 与收口验证追加进展：

- `CommandSuggestionService` 增加进程内 telemetry summary：
  - provider 查询次数、候选数、平均/最近/最大耗时。
  - remote provider cache hit/miss。
  - refresh success/failure。
  - accepted/dismissed/skipped feedback 计数。
- 新增 `command_suggestion_telemetry_summary` Tauri command 和前端 `getTerminalSuggestionTelemetrySummary` API。
- 设置页“命令灰色提示”分组调整为全宽生产配置面板，新增：
  - 策略状态卡片，说明主机免安装、远端只读预热和生产主机限制。
  - `productionHostPolicy` 显式选择：restricted/normal。
  - 灰色提示诊断面板，展示 provider 查询、cache、refresh 和反馈数据。
  - provider 开关布局改为更适合长期使用的双列/响应式密度。
- 视觉验证已通过 Chrome/Playwright 截图检查：
  - `settings-inline-suggestion-final.png`
  - `settings-inline-suggestion-narrow.png`
  - 新增区域在桌面和窄宽布局下无新溢出；仅剩现有 sr-only/sidebar/theme-card 文本截断。
- 发现并修正既有安全配置测试漂移：`freezePrototype` 当前按项目兼容规则保持 `false`，测试改为保护“严格 CSP + prototype freezing 暂缓”的真实策略。
- 最新验证：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `npx vitest run --no-file-parallelism --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000`
  - `npm run build`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_performance -- --ignored --nocapture`
- 最新本机 debug benchmark：
  - seed：约 5.62s。
  - 10k history + spec：约 4.37ms。
  - remoteCommand：约 0.58ms。
  - remotePath：约 0.46ms。
  - Git：约 0.27ms。

2026-06-19 Telemetry 持久化与诊断导出追加进展：

- 新增 SQLite schema v15：`command_suggestion_telemetry`，按 provider 聚合持久化：
  - 查询次数、候选数、累计耗时。
  - cache hit/miss。
  - refresh success/failure。
  - accepted/dismissed/skipped feedback。
  - first/last event 时间和最近错误。
- `CommandSuggestionService` 在保持按键同步路径轻量的前提下，把 telemetry 增量异步式写入同一 SQLite store；写入失败不阻断 suggestion 查询、接受或远端预热路径。
- 新增 `command_suggestion_telemetry_export` Tauri command 和前端 `getTerminalSuggestionTelemetryExport` API，一次导出 runtime telemetry 与 persisted telemetry，便于长期诊断和用户反馈排障。
- 设置页灰色提示诊断面板新增“复制”按钮，可复制格式化 JSON 诊断；浏览器实测剪贴板内容包含 `persisted` 聚合。
- 新增/更新验证：
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_service --test storage_foundation`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - `npm run test:frontend -- src/lib/terminalSuggestionApi.test.ts src/features/settings/SettingsToolContent.test.tsx`
  - `npm run typecheck`
  - `npm run build`
- 视觉/交互验证：
  - Chrome/Playwright 打开 `http://127.0.0.1:5173/`，设置页诊断区域桌面和 390px 窄屏布局无重叠。
  - 截图：`.updeng/data/verification/settings-telemetry-desktop-scrolled.png`、`.updeng/data/verification/settings-telemetry-mobile.png`。
  - 实际点击“复制灰色提示诊断”后读回剪贴板，确认 JSON 包含 `persisted`。

2026-06-19 100k history 性能闭环追加进展：

- 新增 ignored 手动性能基准：`command_suggestion_100k_history_query_benchmark`，覆盖 100k command history 下：
  - 最近匹配前缀查询。
  - 历史深处窄前缀查询。
- 暴露并修复 history suggestion 查询路径问题：
  - 原路径复用普通历史 contains 搜索，100k 最近匹配曾达到约 117ms，不满足按键路径预算。
  - 新增 SQLite schema v16，为 history suggestion 增加 prefix/range 与 recent scan 所需索引。
  - 新增 suggestion 专用 command-prefix 查询，不改变普通历史面板 contains 搜索语义。
  - 查询策略改为 latest rowid 小窗口扫描 + prefix range fallback，宽前缀和深处窄前缀都可稳定返回。
- telemetry 按键路径优化：
  - provider query/cache telemetry 不再每次按键同步写 SQLite。
  - 改为按 provider 聚合到进程内 pending map，`command_suggestion_telemetry_export` 时 flush 到 SQLite。
  - refresh/feedback 低频事件仍直接持久化。
- 最新本机 debug benchmark：
  - 100k history seed：约 1.99s。
  - 100k recent history：约 3.59ms。
  - 100k deep history：约 3.15ms。
  - 10k mixed history + spec：约 2.72ms。
  - remoteCommand：约 0.61ms。
  - remotePath：约 0.39ms。
  - Git：约 0.27ms。
- 新增/更新验证：
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_performance -- --ignored --nocapture`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_service --test storage_foundation`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check -- src-tauri/src/storage/command_history.rs src-tauri/src/services/command_history_service.rs src-tauri/src/services/command_suggestion_service.rs src-tauri/src/storage/migrations.rs src-tauri/tests/storage_foundation.rs src-tauri/tests/command_suggestion_performance.rs src-tauri/tests/command_suggestion_service.rs`
  - `npm run typecheck`

2026-06-19 Remote probe scheduler 追加进展：

- 新增前端 `terminalSuggestionProbeScheduler`，统一管理 git、remoteCommand、remotePath 的只读预热请求：
  - 以 `hostId`、`cwd/path` 作为 key 做跨 pane 去重。
  - 以 `ownerId` 管理 pane/session 生命周期，cwd 变化、断开和卸载时清理 pending probe。
  - 支持默认 delay、TTL cooldown、失败指数退避和最大并发限制，避免连接初期或多 pane 同时打开时触发远端探测风暴。
- `XtermPane` 去掉散落在 effect 内的三组本地 timer 和 last-key 状态，统一通过 scheduler 发起预热；生产主机 restricted 策略和 provider 开关仍在调用前短路。
- 新增 scheduler 单测覆盖：
  - 跨 owner 相同 host/path 去重。
  - 同 owner cwd 改变时取消旧 path 预热。
  - owner 移除时取消 pending probe。
  - refresh 失败后的 backoff。
  - `maxConcurrent` 并发限流。
- 新增/更新验证：
  - `npm run test:frontend -- src/features/terminal/terminalSuggestionProbeScheduler.test.ts src/features/terminal/XtermPane.test.tsx`
  - `npm run typecheck`
  - `npm run build`
  - Vite dev server 启动冒烟：`http://127.0.0.1:5187/` 返回 200。

2026-06-19 Ghost overlay 帧预算追加进展：

- `XtermPane` 的 ghost suggestion 更新改为统一经过 `updateGhostSuggestion` / `hideGhostSuggestion`：
  - 稳定布局刷新时，如果 `suffix`、provider/source/replacement、description 和 `left/top/maxWidth` 没有可见变化，不再触发 React state commit。
  - 位置比较使用 0.25px 容差，避免 xterm 测量的 sub-pixel 抖动造成重复重渲染。
  - layout 失效、alternate buffer、输入不再 eligible、请求无候选和请求失败仍会立即清除提示。
- 新增 React Profiler 回归测试：稳定 `onWriteParsed` 布局刷新不会产生额外 React commit。
- 新增 `npm run verify:terminal-ghost-frame`：
  - 无第三方依赖，使用本机 Chrome headless + DevTools Protocol 跑真实 `requestAnimationFrame` 帧采样。
  - 结果写入 `.updeng/data/verification/terminal-ghost-frame-budget.json`。
  - 当前结果：220 帧，平均 16.666ms，p95 16.7ms，max 16.8ms，稳定刷新 DOM writes = 1，pass = true。
- 新增/更新验证：
  - `npm run test:frontend -- src/features/terminal/XtermPane.test.tsx src/features/terminal/terminalSuggestionProbeScheduler.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `npm run verify:terminal-ghost-frame`
  - Vite dev server 冒烟：`http://127.0.0.1:5187/` 返回 200。

2026-06-19 审计事件持久化追加进展：

- 新增 SQLite schema v17：`command_suggestion_audit_events`，按事件维度记录：
  - `remoteProbeSchedule`：前端因远端探测关闭或生产主机 restricted 策略跳过预热。
  - `remoteProbeRefresh`：后端远端 path/command/git 只读刷新成功或失败。
  - `feedback`：accepted/dismissed 反馈记录或敏感命令跳过。
- 新增 `command_suggestion_record_audit_event` Tauri command 和前端 `recordTerminalSuggestionAuditEvent` API，前端只提交策略、provider、host、cwd/path、pane/session 和有限 metadata，不写入命令明文。
- `command_suggestion_telemetry_export` 现在同时导出最近审计事件，便于用户反馈排障时看到生产策略、远端 probe 和反馈路径的关键决策。
- `XtermPane` 在 remote probe 被策略短路时写入 schedule skip 审计；后端 refresh 与反馈路径以 best-effort 写入审计，失败不阻断按键、远端预热或 feedback 主流程。
- 新增/更新验证：
  - `npm run test:frontend -- src/lib/terminalSuggestionApi.test.ts src/features/terminal/XtermPane.test.tsx`
  - `npm run typecheck`
  - `rustfmt --edition 2024 --check src-tauri/src/models/command_suggestion.rs src-tauri/src/storage/command_suggestion_audit.rs src-tauri/src/storage/mod.rs src-tauri/src/storage/migrations.rs src-tauri/src/services/command_suggestion_service.rs src-tauri/src/commands/command_suggestion.rs src-tauri/src/lib.rs src-tauri/tests/storage_foundation.rs src-tauri/tests/command_suggestion_service.rs`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_service --test storage_foundation`
  - `npm run build`
  - `npm run verify:terminal-ghost-frame`
  - Vite dev server 冒烟：`http://127.0.0.1:5187/` 返回 200。

2026-06-19 诊断清理与保留策略追加进展：

- 新增 `command_suggestion_cleanup_diagnostics` Tauri command，统一清理灰色提示诊断数据：
  - 按保留天数删除 `command_suggestion_audit_events`。
  - 按保留天数删除 `command_suggestion_feedback`。
  - 清理已过期 `command_suggestion_provider_cache`。
  - 可显式重置持久化 telemetry 聚合。
- 新增 Rust cleanup storage/service/model 分层，所有删除走参数绑定 SQL，并返回实际删除行数，便于 UI 和诊断导出核对。
- 设置页灰色提示诊断面板新增“数据保留”区块：
  - 审计保留天数默认 30 天。
  - 反馈保留天数默认 365 天。
  - 支持“清理过期”和“重置统计”两个显式操作。
  - 保留天数按 1..3650 天归一化，避免异常输入造成误删或无限保留。
- 新增/更新验证：
  - `npm run test:frontend -- src/lib/terminalSuggestionApi.test.ts src/features/settings/settingsModel.test.ts src/features/settings/SettingsToolContent.test.tsx`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_service --test storage_foundation`
  - `rustfmt --edition 2024 --check src-tauri/src/models/command_suggestion.rs src-tauri/src/storage/command_suggestion_cleanup.rs src-tauri/src/storage/mod.rs src-tauri/src/services/command_suggestion_service.rs src-tauri/src/commands/command_suggestion.rs src-tauri/src/lib.rs src-tauri/tests/command_suggestion_service.rs`
  - `npm run typecheck`
  - `npm run build`
  - Vite dev server 冒烟：`http://127.0.0.1:5187/` 返回 200。
- 视觉验证：
  - Chrome headless 打开设置页，检查桌面亮色、桌面暗色和 390px 窄屏暗色下新增保留区块无交叠。
  - 截图：`.updeng/data/verification/settings-inline-suggestion-cleanup-desktop-light.png`、`.updeng/data/verification/settings-inline-suggestion-cleanup-desktop-dark.png`、`.updeng/data/verification/settings-inline-suggestion-cleanup-mobile-dark.png`。
  - 控制台仅有 Vite/React 开发提示，无运行时异常。

2026-06-19 真实 SSH/SFTP smoke 入口追加进展：

- 新增 `src-tauri/tests/command_suggestion_ssh_smoke.rs`，作为 ignored 集成测试，使用临时 Kerminal home、临时 SQLite 和内存凭据仓库，不把 SSH 密码或私钥写入仓库。
- smoke 测试在真实 SSH 主机上串起完整 provider 链路：
  - `refresh_remote_commands` 通过 `SshCommandService` 执行只读远端命令探测。
  - `refresh_remote_paths` 通过 `SftpService` 读取远端目录并写入 provider cache。
  - `refresh_git_refs` 通过 `SshCommandService` 执行只读 Git refs 探测；若目标 cwd 不是 Git worktree，则只跳过 Git 断言。
  - `list_suggestions` 再从缓存读取 remoteCommand、remotePath 和 Git 候选，验证按键查询路径不触发远端 IO。
  - `telemetry_export` 验证 remote probe refresh 审计事件已产生。
- 新增 `scripts/smoke-ssh-command-suggestions.mjs` 和 `npm run smoke:ssh-suggestions`：
  - 缺少真实 SSH 环境变量时以非零状态退出，避免“没有跑真实主机却绿灯”的假验证。
  - 需要显式配置 `RUN_KERMINAL_SSH_SMOKE=1`、`KERMINAL_SSH_SMOKE_HOST`、`KERMINAL_SSH_SMOKE_USER`，以及 password、inline private key、key path 或 agent 其中一种认证方式。
  - 该 smoke 同时覆盖 remoteCommand/Git/远端 shell history 的 native russh 探测和 SFTP 路径探测，可作为密码、内联私钥、私钥路径和 agent 的完整链路证明入口；设置 `KERMINAL_SSH_SMOKE_HISTORY_PREFIX` 时会强制断言远端 shell history 候选命中。
- 修正 `SshCommandService` 远端命令认证闭环：
  - `auth_type=Key` 且 `credential_ref` 是本地私钥路径时，旧 OpenSSH 参数会带上 `-i <path>`；`credential:` 引用不会泄露到命令行参数。
  - 新增 native russh 执行路径，`execute_with_credentials` 从 OS keychain/内存 vault 解析 password 和内联私钥，使用 app `known_hosts` 校验主机密钥，通过 `sh -s` 发送脚本并限制 stdout/stderr 捕获上限。
  - command suggestion 的 remoteCommand/Git/远端 shell history refresh、公开 `ssh_command_execute` Tauri command、AI `ssh.command` 工具和 Docker 宿主命令执行已接入 native 凭据路径；旧 OpenSSH 计划仅保留给 scp/tar 传输和交互式终端类功能。
- 迁移 Docker 宿主命令执行路径：
  - `docker_list_containers`、容器内目录/预览/文本读写/创建/删除/重命名/chmod Tauri commands 改为 async。
  - `DockerHostService` 的容器命令执行统一透传 `CredentialService` 与 `KerminalPaths`，复用 `execute_with_credentials`，使 password、inline private key、key path 和 agent 行为与 SSH suggestion/AI 工具一致。
- 新增本地 loopback russh server 回归：
  - 成功路径覆盖 password 凭据解析、临时 app `known_hosts` 信任、`exec sh -s`、stdin 脚本发送、stdout/stderr 捕获、exit status 和截断标记。
  - 失败路径覆盖未信任 host key 时 native SSH 连接拒绝，避免测试绕过生产 strict known_hosts 策略。
- 新增本地 provider chain 端到端回归：
  - 在 `command_suggestion_ssh_smoke.rs` 内启动本地 russh server，同时提供 `exec sh -s` 和 SFTP subsystem。
  - 通过真实 `RemoteHostService`、`CredentialService`、`SshCommandService`、`SftpService` 和 `CommandSuggestionService` 刷新 remoteCommand、remotePath、远端 shell history 和 Git refs。
  - refresh 后主动关闭 loopback server，再用新的 `CommandSuggestionService` 从 SQLite provider cache 查询建议，证明按键查询路径不触发远端 IO。
- 新增 README 验证说明，列出真实 SSH/SFTP smoke 所需环境变量。
- 新增/更新验证：
  - `cargo test --manifest-path src-tauri/Cargo.toml ssh_command_service::tests -- --nocapture`
  - `cargo test --manifest-path src-tauri/Cargo.toml docker -- --nocapture`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_ssh_smoke loopback_ssh_sftp_provider_chain_uses_native_credentials_and_cache_only_query -- --nocapture`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_ssh_smoke -- --nocapture`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ssh_command_service`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_service`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_ssh_smoke smoke_test_is_explicitly_gated`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_ssh_smoke -- --ignored --list`
  - `node scripts/smoke-ssh-command-suggestions.mjs` 在未配置真实 SSH 目标时返回退出码 2，并打印必需变量清单。
  - `npm run smoke:ssh-suggestions` 在未配置真实 SSH 目标时返回退出码 2，并打印必需变量清单。
  - `rustfmt --edition 2024 --check src-tauri/src/services/ssh_command_service.rs src-tauri/tests/command_suggestion_ssh_smoke.rs`
  - `npm run test:frontend -- src/lib/terminalSuggestionApi.test.ts src/lib/sshCommandApi.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - Vite dev server 冒烟：`http://127.0.0.1:5187/` 返回 200。
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，未出现白屏/依赖优化/只读原型补丁类启动错误。

2026-06-19 Ghost overlay 网格测量精度追加进展：

- `XtermPane` 的 ghost overlay 布局测量改为优先使用 xterm 真实 screen 网格：
  - 行高优先读取 `.xterm-screen` 高度除以 `terminal.rows`。
  - 单元格宽度优先读取 `.xterm-screen` 宽度除以 `terminal.cols`。
  - `.xterm-rows > div` 行尺寸仍作为 fallback，避免测试环境或异常 DOM 下完全失效。
- 修复风险：短行或空行的 `.xterm-rows > div` 实际文本宽度可能小于终端视口宽度，旧逻辑会把灰色提示横向位置和可用宽度算窄；新逻辑按 xterm screen 网格定位，更接近真实 cursor/cell 坐标。
- 更新 `XtermPane.test.tsx` 的 mock xterm DOM，包含 `.xterm-screen` 包裹 `.xterm-rows`，并新增短行场景回归：即使第一行只有很短文本，ghost suggestion 的 `left/top/maxWidth` 仍按 screen 网格计算。
- 新增/更新验证：
  - `npm run test:frontend -- src/features/terminal/XtermPane.test.tsx`
  - `npm run typecheck`
  - `npm run build`
  - `npm run verify:terminal-ghost-frame`
  - Vite dev server 冒烟：`http://127.0.0.1:5199/` 返回 200。
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，未出现白屏/依赖优化/只读原型补丁类启动错误。

2026-06-19 本地 loopback smoke 脚本化追加进展：

- 新增 `scripts/smoke-ssh-command-suggestions-loopback.mjs`，封装已有本地 russh + SFTP provider chain 测试，作为无外部 SSH 主机时可重复执行的 smoke 入口。
- 新增 `npm run smoke:ssh-suggestions:loopback`：
  - 启动本地 loopback russh/SFTP server。
  - 覆盖 password 凭据、app `known_hosts`、`exec sh -s`、remoteCommand、remotePath、远端 shell history、Git refresh。
  - refresh 后关闭 server，再验证新的 `CommandSuggestionService` 只读 SQLite provider cache 仍可返回建议。
- 保留 `npm run smoke:ssh-suggestions` 的真实主机门禁：未配置 `RUN_KERMINAL_SSH_SMOKE=1`、目标主机、用户和认证变量时继续非零退出，避免把本地 loopback smoke 误当成真实主机验收。
- README 验证说明已区分：
  - 本地 loopback smoke：无需外部主机，用于开发机自动闭环。
  - 真实 SSH/SFTP smoke：需要非生产测试主机，用于最终端到端验收。
- 新增/更新验证：
  - `npm run smoke:ssh-suggestions:loopback`
  - `npm run smoke:ssh-suggestions` 在未配置真实 SSH 目标时保持非零退出，并打印必需变量清单。
  - `node --check scripts\smoke-ssh-command-suggestions-loopback.mjs`
  - `npm run typecheck`
  - `npm run build`
  - Vite dev server 冒烟：`http://127.0.0.1:5201/` 返回 200。

2026-06-19 Ghost overlay 视觉 smoke 追加进展：

- 新增 `scripts/verify-terminal-ghost-visual.mjs`，使用本机 Chrome headless + DevTools Protocol 生成亮色/暗色 xterm-like 终端截图和 JSON 断言结果。
- 新增 `npm run verify:terminal-ghost-visual`：
  - 校验 ghost suggestion 在 `git` 输入后对齐 cursor。
  - 校验 ghost 文本可见、不过界、不遮挡输入。
  - 校验样式保持 `pointer-events: none`、`white-space: pre`、`overflow: hidden` 和灰色 `rgba(...)`。
  - 同时覆盖亮色和暗色终端背景。
- 视觉证据输出：
  - `.updeng/data/verification/terminal-ghost-visual.json`
  - `.updeng/data/verification/terminal-ghost-visual.png`
- README 验证命令已加入 `npm run verify:terminal-ghost-visual` 和 `npm run verify:terminal-ghost-frame`。
- 新增/更新验证：
  - `node --check scripts\verify-terminal-ghost-visual.mjs`
  - `npm run verify:terminal-ghost-visual`
  - `npm run verify:terminal-ghost-frame`
  - `npm run typecheck`
  - `npm run build`
  - Vite dev server 冒烟：`http://127.0.0.1:5203/` 返回 200。
- 人工目检：`terminal-ghost-visual.png` 中亮/暗主题下灰色后缀均跟随 `git` 后方显示，无明显重叠、越界或主题可读性问题。

2026-06-19 Alternate buffer / 全屏程序回归追加进展：

- `XtermPane.test.tsx` 新增组件级回归，模拟 `vim/less/top/tmux` 这类全屏程序进入 xterm alternate buffer。
- 回归覆盖：
  - 普通 shell 输入 `git` 时 ghost suggestion 可以正常显示。
  - 进入 alternate buffer 后已显示的 ghost suggestion 会立即隐藏。
  - alternate buffer 内继续输入时仍会写入 PTY，但不会触发新的 `listTerminalSuggestions` 请求。
- 新增/更新验证：
  - `npm run test:frontend -- src/features/terminal/XtermPane.test.tsx`
  - `npm run verify:terminal-ghost-visual`
  - `npm run typecheck`
  - `npm run build`
  - Vite dev server 冒烟：`http://127.0.0.1:5205/` 返回 200。

2026-06-19 Slow/Large loopback 边界追加进展：

- `command_suggestion_ssh_smoke.rs` 扩展本地 russh/SFTP loopback server profile，支持模拟远端慢响应、大量命令输出和大目录列表。
- 新增 `loopback_remote_probe_handles_slow_large_outputs_with_cache_limits`：
  - remoteCommand 通过 `sh -s` 返回 12,000 条模拟命令，验证 refresh 后按 `max_entries=64` 缓存。
  - Git refs 返回 4,000 条模拟分支，验证 refresh 后按 `max_entries=32` 缓存。
  - SFTP 目录包含数百个文件/目录，验证 refresh 后按 `max_entries=32` 缓存。
  - 关闭 loopback server 后，用新的 `CommandSuggestionService` 只读 SQLite cache 查询命令、路径和 Git 建议，并断言不会产生新的 SSH/SFTP 请求。
- `scripts/smoke-ssh-command-suggestions-loopback.mjs` 已从单个测试名改为 `loopback_` 过滤，`npm run smoke:ssh-suggestions:loopback` 会同时执行基础闭环和 slow/large 边界闭环。
- README 验证说明已补充 slow/large loopback 覆盖范围。
- 新增/更新验证：
  - `cargo test --test command_suggestion_ssh_smoke`
  - `node --check scripts\smoke-ssh-command-suggestions-loopback.mjs`
  - `npm run smoke:ssh-suggestions:loopback`
  - `npm run build`
  - Vite dev server 冒烟：`http://127.0.0.1:5206/` 启动成功并返回 200，随后清理 5206 监听进程。
  - `npm run tauri:dev` 冒烟到 `kerminal.exe` 启动，随后清理本轮启动进程。

2026-06-19 Disconnect / refresh failure 缓存保留追加进展：

- 新增 `loopback_refresh_failure_keeps_existing_provider_cache_available`，覆盖断线/探测失败时的长期使用行为。
- 回归覆盖：
  - 先通过 loopback server 成功预热 remoteCommand、remotePath、远端 shell history、Git 四类 provider cache。
  - 关闭 loopback server 后强制四类 refresh 失败，验证失败不会清空已有缓存。
  - 使用新的 `CommandSuggestionService` 只读 SQLite cache 仍能返回命令、路径和 Git 建议，且不会产生新的 SSH/SFTP 请求。
  - 导出 telemetry/audit，断言四类 provider 均记录 `refresh_failure_count` 和 `RemoteProbeRefresh + Failed + refresh-failed` 审计事件。
- `npm run smoke:ssh-suggestions:loopback` 现已覆盖基础闭环、slow/large 边界和 disconnect/failure 缓存保留三条本地用例。
- README 本地 smoke 说明已补充“刷新失败不破坏已有缓存”。
- 新增/更新验证：
  - `cargo test --test command_suggestion_ssh_smoke`
  - `node --check scripts\smoke-ssh-command-suggestions-loopback.mjs`
  - `npm run smoke:ssh-suggestions:loopback`
  - `cargo fmt --check`
  - `npm run typecheck`
  - `npm run build`
 - Vite dev server 冒烟：`http://127.0.0.1:5207/` 启动成功并返回 200，随后清理 5207 监听进程。
  - `npm run tauri:dev` 冒烟到 `kerminal.exe` 启动，随后清理本轮启动进程。

2026-06-19 Wide character / 中文 ghost 对齐追加进展：

- `XtermPane.test.tsx` 新增 `positions ghost suggestions using xterm cell cursor for wide characters` 组件回归，模拟输入 `部署` 后显示 ` --dry-run` 灰色后缀。
- 回归断言：
  - suggestion 请求仍使用 JS 字符串 cursor，即 `input: "部署"`、`cursor: 2`。
  - ghost overlay 定位使用 xterm active buffer 的 cell cursor，即 `cursorX = 4` 后得到 `left: 72px`，避免把两个中文宽字符误算成两个半角 cell。
  - `maxWidth` 和 `top` 仍基于 xterm screen grid 计算，保持 resize/字体变化时的定位路径一致。
- `scripts/verify-terminal-ghost-visual.mjs` 已扩展为四帧截图断言：
  - light + ASCII：`git` 后显示 ` status --short`。
  - dark + ASCII：`git` 后显示 ` status --short`。
  - light + 中文宽字符：`部署` 后显示 ` --dry-run`。
  - dark + 中文宽字符：`部署` 后显示 ` --dry-run`。
- 视觉证据输出：
  - `.updeng/data/verification/terminal-ghost-visual.json`
  - `.updeng/data/verification/terminal-ghost-visual.png`
- 新增/更新验证：
  - `npm run test:frontend -- src/features/terminal/XtermPane.test.tsx`
  - `node --check scripts\verify-terminal-ghost-visual.mjs`
  - `npm run verify:terminal-ghost-visual`
  - `npm run typecheck`
  - `npm run build`
  - Vite dev server 冒烟：`http://127.0.0.1:5208/` 启动成功并返回 200，随后清理 5208 监听进程。
- 人工目检：`terminal-ghost-visual.png` 中亮/暗主题下 ASCII 与 `部署 --dry-run` 宽字符场景均无明显重叠、越界或主题可读性问题。

2026-06-19 Remote shell history 只读缓存追加进展：

- 新增 `command_suggestion_refresh_remote_history` Tauri command 和 `refreshTerminalRemoteHistorySuggestions` 前端 API。
- 后端通过 native russh 凭据执行只读 POSIX `sh -s` 脚本读取 `$HOME` 下常见 history 文件尾部：
  - `.history`
  - `.sh_history`
  - `.ash_history`
  - `.zsh_history`
  - `.bash_history`
- 不要求远端安装 fish/zsh 插件、Atuin、专用 CLI 或互联网能力；远端脚本只读文件，不修改 shell 配置。
- 解析策略：
  - 支持 zsh extended history `: timestamp:duration;command`。
  - 反向去重，保留最近命令优先。
  - 过滤空行、注释、控制字符、超长命令和疑似 password/token/private key 的敏感命令。
  - 不写入 `command_history` 表，避免反复刷新造成历史表膨胀。
- 缓存策略：
  - 使用 `command_suggestion_provider_cache` 的 `provider=history`、`scope_key=remoteHistory`。
  - schema v18 重建旧 provider cache 表，允许 `history` provider，同时保留已有 remotePath/remoteCommand/Git 缓存。
  - 查询时仍走 history provider；本地应用历史优先，远端 shell history cache 作为补充候选。
- 前端调度策略：
  - SSH session connected 后调度 remoteHistory probe。
  - 仅当 inline suggestion 总开关、history provider 和 remoteProbeEnabled 均开启时执行。
  - 生产主机 `restricted` 策略下不读取远端 history，只继续使用本地已记录 history + spec。
- loopback smoke 已扩展：
  - 基础闭环覆盖远端 shell history refresh、SQLite cache-only 查询、敏感行过滤、重复历史去重和 zsh extended history 解析。
  - disconnect/failure 闭环覆盖 remote history refresh 失败不破坏已有 cache，并记录 history provider 的失败 telemetry/audit。
- 新增/更新验证：
  - `cargo test --test command_suggestion_ssh_smoke loopback_`
  - `cargo test remote_history_parser_keeps_recent_unique_safe_commands`
  - `cargo test --test command_suggestion_service remote_history_suggestions_restore_from_persistent_cache`
  - `cargo test --test storage_foundation migration_v13_creates_command_suggestion_provider_cache`
  - `cargo test --test storage_foundation migration_v18_allows_history_provider_cache`
  - `npm run test:frontend -- src/lib/terminalSuggestionApi.test.ts src/features/terminal/terminalSuggestionProbeScheduler.test.ts src/features/terminal/XtermPane.test.tsx`
  - `npm run smoke:ssh-suggestions:loopback`
  - `cargo fmt --check`
  - `npm run typecheck`
  - `npm run build`
  - Vite dev server 冒烟：`http://127.0.0.1:5209/` 启动成功并返回 200，随后清理 5209 监听进程。
  - `npm run tauri:dev` 冒烟到 `kerminal.exe` 启动，随后清理本轮启动进程。

2026-06-19 真实 WSL OpenSSH smoke 追加验证：

- 使用本机 WSL Ubuntu 22.04 已安装的 OpenSSH Server 启动临时 `sshd`，未安装远端 fish/zsh 插件，也未依赖远端联网。
- smoke 通过临时 host key、临时 client key、临时 `HOME/.bash_history`、真实 SFTP subsystem 和真实 Git repo 验证：
  - `trust_host_key` 写入临时 app `known_hosts` 后，remoteCommand、remotePath、远端 shell history 和 Git refs 均通过 strict known_hosts 链路。
  - 设置 `KERMINAL_SSH_SMOKE_HISTORY_PREFIX=echo kerminal-history` 后，真实远端 shell history 候选强制命中，并保留 `remoteShellHistory` metadata。
  - 真实 Git smoke 暴露并修复 `git for-each-ref --format='branch\t...'` 输出字面 `\t` 的兼容问题；脚本已改为 Git 输出 ref name，再由 shell `printf 'branch\t%s\n'` 生成真实 tab，并新增单元测试防回归。
- 已清理 WSL 临时 `sshd`、`/tmp/kerminal-ssh-smoke-*` 和 Windows 临时私钥目录。
- 新增/更新验证：
  - `cargo test git_discovery_script_uses_shell_printf_tabs_for_real_git`
  - `npm run smoke:ssh-suggestions`（WSL OpenSSH 临时主机，`KERMINAL_SSH_SMOKE_HISTORY_PREFIX=echo kerminal-history`）

2026-06-19 WSL OpenSSH smoke 脚本化追加进展：

- 新增 `scripts/smoke-ssh-command-suggestions-wsl.mjs` 和 `npm run smoke:ssh-suggestions:wsl`：
  - Windows 开发机上复用已有 WSL 发行版，不安装包、不写 shell init、不改用户 known_hosts。
  - 自动创建临时 Windows client key、临时 WSL `sshd`、临时 Git repo、`HOME/.bash_history`、PATH 内测试命令和 SFTP 目录内容。
  - 通过 `npm run smoke:ssh-suggestions` 复用真实 SSH/SFTP ignored 集成测试，强制覆盖 remoteCommand、remotePath、Git refs、远端 shell history 候选命中，以及 POSIX `sh` builtin 的 `source=posixBuiltin` metadata。
  - 完成后 kill 临时 `sshd`、删除 WSL `/tmp/kerminal-ssh-smoke-*` 和 Windows `%TEMP%/kerminal-wsl-ssh-smoke-*`。
- 新增/更新验证：
  - `node --check scripts\smoke-ssh-command-suggestions-wsl.mjs`
  - `npm run smoke:ssh-suggestions:wsl`
  - `npm run test:frontend -- src/features/workspace/workspaceStore.test.ts`
  - `npm run test:frontend -- src/features/machine-sidebar/MachineSidebar.test.tsx`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听。
  - 清理确认：WSL 仅剩系统原有 `sshd -D`，无 `/tmp/kerminal-ssh-smoke-*`；Windows TEMP 无 `kerminal-wsl-ssh-smoke-*`。

2026-06-19 启动验证收口：

- `npm run build` 暴露并修复 workspace/session 与 MachineSidebar 的现有启动阻断：
  - `WorkspaceSessionSnapshot` 保存时补齐 `sidebarMachines`，恢复时合并本地 pane 推导机器和 docker container pane 推导机器。
  - `setProfiles` 会为持久化 terminal profile 补齐缺失的本地 sidebar machine，同时保留已有机器状态。
  - 特殊分组默认标题统一为“默认分组”，与 RemoteHost API、MachineSidebar 和测试语义一致。
  - 清理 MachineSidebar 测试中的旧 `onAddLocal` prop 期望，并保留当前“添加连接”默认 `mode: local` 行为。
- `tauri:dev` 首次重跑时发现旧 Vite dev server 占用 1425，已定位并清理本项目残留进程后重新冒烟通过。
- 新增/更新验证：
  - `npm run test:frontend -- src/features/workspace/workspaceStore.test.ts`
  - `npm run test:frontend -- src/features/machine-sidebar/MachineSidebar.test.tsx`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `kerminal.exe` 启动，随后清理本轮启动进程与 1425 监听。

2026-06-19 POSIX sh 远端命令降级与解释性追加进展：

- Remote Command provider 的 PATH 采集脚本保持 POSIX `sh -s` 兼容，不依赖 `bash`、`zsh`、`fish`、`compgen`、`declare` 或 shell 插件。
- 远端命令缓存即使 PATH 采集为空，也会补入 POSIX sh 内建命令集合，保证只有 `/bin/sh` 的主机仍能提示 `cd`、`export`、`printf` 等基础命令。
- Remote Command 候选 metadata 新增 `source=posixBuiltin|path`，候选描述区分“远端 shell 内建命令”和“远端 PATH 命令”，避免把内建命令误解释为 PATH 文件。
- 真实 WSL OpenSSH smoke 暴露了大量 PATH 命令时 POSIX builtin 被 `max_entries` 截掉的边界；已修复为 builtin 优先保留，剩余容量再缓存 PATH 命令，并在 remoteCommand provider 内先按分数排序再截断候选。
- 真实 WSL OpenSSH smoke 已强制断言 `umask` builtin 经过 native russh refresh 后仍以 `source=posixBuiltin` 返回。
- 新增/更新验证：
  - `cargo test remote_command_discovery_script_stays_posix_sh_compatible`
  - `cargo test --test command_suggestion_service remote_command_suggestions_include_posix_builtins_without_path_commands`
  - `cargo test --test command_suggestion_service remote_command_builtins_survive_noisy_capped_path_cache`
  - `cargo test --test command_suggestion_service`
  - `cargo test --test command_suggestion_ssh_smoke loopback_`
  - `cargo fmt --check`
  - `npm run smoke:ssh-suggestions:wsl`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听。

2026-06-19 WSL OpenSSH posix-only smoke 追加进展：

- 新增 `npm run smoke:ssh-suggestions:wsl:posix`：
  - 复用同一个 WSL 临时 `sshd` runner，但通过 `--posix-only` 让 sshd 会话只暴露一个包含 `sh` 的最小 PATH。
  - 新增 ignored Rust smoke `real_ssh_remote_command_posix_builtin_fallback_survives_minimal_path`，只刷新 remoteCommand，不要求 Git、远端 history、SFTP 路径候选或 PATH 测试命令命中。
  - 验证真实 OpenSSH 链路下仍能通过 `sh -s` 刷新远端命令缓存，并返回 `umask` 的 `source=posixBuiltin` 候选；同时断言完整 PATH fixture 命令 `kerminal-smoke` 不会出现，证明该用例确实跑在受限 PATH 下。
- 新增/更新验证：
  - `node --check scripts\smoke-ssh-command-suggestions-wsl.mjs`
  - `cargo test --test command_suggestion_ssh_smoke smoke_test_is_explicitly_gated`
  - `npm run smoke:ssh-suggestions:wsl:posix`
  - `npm run smoke:ssh-suggestions:wsl`
  - `cargo test --test command_suggestion_ssh_smoke`
  - `cargo fmt --check`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听。

2026-06-19 Alternate buffer 视觉 smoke 追加进展：

- `scripts/verify-terminal-ghost-visual.mjs` 已扩展到 6 帧：
  - light + ASCII：`git` 后显示 ` status --short`。
  - dark + ASCII：`git` 后显示 ` status --short`。
  - light + 中文宽字符：`部署` 后显示 ` --dry-run`。
  - dark + 中文宽字符：`部署` 后显示 ` --dry-run`。
  - light + alternate buffer：模拟 `vim/less/top/tmux` 全屏程序时不渲染 ghost。
  - dark + alternate buffer：模拟 `vim/less/top/tmux` 全屏程序时不渲染 ghost。
- JSON 断言已覆盖 hidden 场景没有 `.ghost` 节点；截图人工目检确认最后两帧无灰色提示残留，前四帧仍保持亮/暗主题、ASCII 和中文宽字符对齐。
- 视觉证据输出：
  - `.updeng/data/verification/terminal-ghost-visual.json`
  - `.updeng/data/verification/terminal-ghost-visual.png`
- 新增/更新验证：
  - `node --check scripts\verify-terminal-ghost-visual.mjs`
  - `npm run verify:terminal-ghost-visual`
  - `npm run test:frontend -- src/features/terminal/XtermPane.test.tsx`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听。

2026-06-19 SSH 交互终端 known_hosts 一致性追加进展：

- 交互式 SSH terminal 仍走本地 OpenSSH CLI，但现在与 native russh provider/SFTP 共享应用私有主机信任文件：
  - `ssh_create_session` 将 `state.paths()` 传给 `SshTerminalService`。
  - `SshTerminalService` 生成 OpenSSH 参数时增加 `UserKnownHostsFile=<app-root>/known_hosts`。
  - 同时设置 `GlobalKnownHostsFile=none`，避免 provider/SFTP 使用应用信任状态而交互终端又隐式落到系统全局 known_hosts。
- 安全边界：
  - 不把 `credential_ref` 或 secret 写进 OpenSSH 参数。
  - 不要求远端安装 fish、zsh、agent、插件或联网能力。
  - 首次连接仍由交互式 OpenSSH 处理主机密钥确认；确认结果写入 Kerminal 管理的 known_hosts 文件。
- 新增/更新验证：
  - `cargo test --test ssh_terminal_service`
  - `cargo test ssh_terminal_service`
  - `cargo fmt --check`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 SSH 交互终端 key path 认证一致性追加进展：

- 交互式 SSH terminal 现在会复用远程主机配置中的“私钥路径”：
  - 当 `auth_type=Key` 且 `credential_ref` 是普通文件路径时，OpenSSH 参数增加 `-i <key-path>`。
  - 同时增加 `IdentitiesOnly=yes`，避免 OpenSSH 继续尝试大量默认 identity，降低连错 key、认证过多失败和连接变慢的概率。
  - 当 `credential_ref` 以 `credential:` 开头时仍不写入命令行，避免暴露 keychain 引用或内联私钥内容。
- 影响范围：
  - provider/native russh 已能使用 password、内联私钥、私钥路径和 agent；本次让真实交互终端至少与“私钥路径”这一无 secret 参数形态保持一致。
  - 内联私钥自动注入交互式 OpenSSH 仍未实现；需要后续设计安全的临时 key 文件生命周期或改为 native russh 交互 PTY。
- 新增/更新验证：
  - `cargo test --test ssh_terminal_service`
  - `cargo test ssh_terminal_service`
 - `cargo fmt --check`
 - `npm run build`
 - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 SSH 交互终端 credential 私钥追加进展：

- 交互式 SSH terminal 已支持远程主机 key auth 的 `credential:` 内联私钥凭据：
  - `SshTerminalService` 从 `CredentialService` 读取私钥 secret，支持 raw PEM/OpenSSH 私钥文本和 `{ "privateKey": "...", "passphrase": "..." }` JSON 形态。
  - 解析后写入 Kerminal 管理的 `<app-temp>/ssh-terminal-keys/identity-*.key`，OpenSSH 参数只带 `-i <temp-key-path>` 和 `IdentitiesOnly=yes`。
  - `credential:` 引用、私钥内容和 passphrase 不进入命令行参数或环境变量；带 passphrase 的 key 仍由 OpenSSH 在终端内交互提示。
  - `TerminalCreateRequest` 新增后端内部 `cleanup_paths`，不参与 IPC；`TerminalManager` 在创建失败、显式 close 和 reader 线程退出时清理临时 key 文件。
- 新增/更新验证：
  - `cargo fmt --check`
  - `cargo test --test ssh_terminal_service`
  - `cargo test --test terminal_manager`
  - `cargo test --test terminal_model`
  - `cargo test ssh_terminal_service`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 SSH 交互终端临时私钥残留清理追加进展：

- 补齐异常退出后的临时私钥清理闭环：
  - AppState 初始化时调用 `SshTerminalService::cleanup_temporary_identity_files`，清理上次崩溃、强杀或异常退出遗留的 `<app-temp>/ssh-terminal-keys/identity-*.key`。
  - 创建新的 `credential:` 内联私钥临时 key 前，会清理超过 24 小时的同目录托管 key 文件。
  - 清理范围只匹配 Kerminal 管理命名 `identity-*.key`，不会删除同目录下用户或其它工具的非管理文件。
- 新增/更新验证：
  - `cargo test --test ssh_terminal_service`
  - `cargo test ssh_terminal_service`
  - `cargo fmt --check`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 SSH 交互终端 password 凭据追加进展：

- 交互式 SSH terminal 已支持 password auth 的保存密码自动响应：
  - 当 `auth_type=Password` 且 `credential_ref` 是 `credential:` 引用时，`SshTerminalService` 从 `CredentialService` 读取密码，生成后端内部 `TerminalSecretInputResponse`。
  - OpenSSH 参数、环境变量和 IPC payload 不包含密码或 `credential:` 引用；前端不能通过 `terminal_create_session` 注入 secret response。
  - `TerminalManager` 的 reader 线程检测 SSH 风格 password prompt 后，通过共享 PTY writer 最多自动写入 1 次密码回车；后续失败重试仍交给用户手动输入，避免错误密码循环。
  - 如果远端异常回显保存的密码，输出事件、输出快照和日志会用精确值替换为 `[已脱敏]`，避免保存密码进入日志或 AI 上下文。
- 新增/更新验证：
  - `cargo test --test terminal_model`
  - `cargo test --test ssh_terminal_service`
  - `cargo test --test terminal_manager`
  - `cargo test ssh_terminal_service`
  - `cargo fmt --check`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 SSH 交互终端真实 OpenSSH password smoke 追加进展：

- 新增外部主机门禁 smoke：
  - `scripts/smoke-ssh-terminal-password.mjs` 默认要求 `RUN_KERMINAL_SSH_TERMINAL_PASSWORD_SMOKE=1`、host、user 和 password，未配置时非零退出。
  - 新增 ignored Rust 集成测试 `ssh_terminal_password_smoke::real_openssh_password_terminal_auto_login_smoke`，通过 `SshTerminalService -> TerminalManager -> OpenSSH PTY` 创建真实交互 SSH 会话。
  - 测试会把 password 存入内存 `CredentialService`，写入 Kerminal app `known_hosts`，等待登录成功标记或首批终端输出后写入命令，并断言输出不包含保存密码。
  - 支持 `KERMINAL_SSH_TERMINAL_SMOKE_KNOWN_HOST_LINE` 固定 known_hosts；未提供时尝试 `ssh-keyscan`，不绕过产品的 app known_hosts 路径。
- 新增 WSL 临时真实主机入口：
  - `npm run smoke:ssh-terminal:password:wsl` 复用 WSL smoke runner 的临时 `sshd` 机制，但以 root 在 WSL 内创建临时用户、一次性密码和 password-only `sshd_config`。
  - 临时 sshd 使用真实 OpenSSH password authentication，不要求远端安装 fish/zsh/插件；通过 `ForceCommand` 输出 `kerminal-password-login-ready` 后进入 `/bin/sh -i`，让测试稳定写入 PTY 命令。
  - 清理阶段会停止临时 `sshd`、结束临时用户进程、删除临时用户和临时目录；本轮已用 `id <temp-user>` 确认临时用户删除。
- 新增/更新验证：
  - `node --check scripts/smoke-ssh-command-suggestions-wsl.mjs`
  - `node --check scripts/smoke-ssh-terminal-password.mjs`
  - `cargo test --test ssh_terminal_password_smoke -- --ignored --list`
  - `npm run smoke:ssh-terminal:password:wsl`
  - WSL 清理核验：`id <temp-user>` 返回 `1`，确认临时用户不存在。
  - `cargo fmt --check`
  - `cargo test --test ssh_terminal_service`
  - `cargo test --test terminal_manager`
  - `cargo test --test terminal_model`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 SSH 交互终端 password prompt 误触发防护追加进展：

- `TerminalManager` 的保存密码自动响应不再对整个滚动缓冲做任意 `contains("password:")` 判断，改为只检查当前最后一行是否像正在等待输入的密码提示。
- 误触发防护：
  - 登录 banner、审计日志或系统提示里的 `last failed password:`、`accepted password:`、`password changed:` 等状态行不会触发自动写入。
  - Windows PTY 同一 read 内带 OSC title/CSI 控制序列时，会先剥离终端控制前缀再判断 prompt，避免安全收紧破坏真实 PTY prompt。
  - 具体 `user@host's password:` marker 必须等于当前可见最后一行；不会因为 banner/status 行前缀里带同样片段而响应。
  - 真实 prompt 仍支持 OpenSSH 常见的 `user@host's password:`、裸 `Password:`、`Enter password:` 和 PAM 常见的 `Password for <user>:`。
  - reader 保留 rolling buffer，prompt 文案跨 read chunk 拆分时仍能在完整最后一行出现后响应。
- 新增/更新验证：
  - `cargo test terminal_manager::tests`
  - `cargo test --test terminal_manager`
  - `cargo fmt --check`
  - `cargo test --test ssh_terminal_service`
  - `cargo test --test terminal_model`
  - `npm run smoke:ssh-terminal:password:wsl`
  - WSL 清理核验：`id <temp-user>` 返回 `1`，确认临时用户不存在。
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 SSH 交互终端 UTF-8 中文命令 smoke 追加进展：

- `ssh_terminal_password_smoke` 的真实 OpenSSH password 终端 smoke 已在登录后连续写入 ASCII 命令和 UTF-8 中文命令 `kerminal-unicode-部署-完成`，覆盖 `SshTerminalService -> TerminalManager -> OpenSSH PTY` 的中文输入输出往返。
- `npm run smoke:ssh-terminal:password` 和 WSL 临时主机入口现在同时验证保存密码自动响应、PTY 命令写入、UTF-8 中文命令输出以及保存密码不进入终端输出。
- 新增/更新验证：
  - `cargo fmt --check`
  - `node --check scripts\smoke-ssh-terminal-password.mjs`
  - `cargo test --test ssh_terminal_password_smoke -- --ignored --list`
  - `npm run smoke:ssh-terminal:password:wsl`
  - WSL 清理核验：`id kerminalpw9608868738` 返回 `1`，确认本轮临时用户不存在。
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无新增 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 SSH 交互终端错误保存密码 smoke 追加进展：

- 新增 `secret_input_response_does_not_repeat_after_second_prompt` 本地集成测试，构造同一 PTY 内连续两次 password prompt，证明 `TerminalSecretInputResponse(max_responses=1)` 只会自动写入一次，第二个 prompt 保持等待用户输入，不会自动循环响应。
- `ssh_terminal_password_smoke` 支持 `KERMINAL_SSH_TERMINAL_SMOKE_EXPECT_AUTH_FAILURE=1`：保存的 password 被视为错误凭据，测试会等待真实 OpenSSH 返回认证失败反馈，断言不会到达 ready marker、不会写入登录后的命令 marker、输出不包含保存的错误密码。
- 新增 `npm run smoke:ssh-terminal:password:wsl:wrong`：WSL runner 会用临时用户的真实密码启动 password-only `sshd`，但传给 Kerminal 一个错误保存密码，覆盖真实 OpenSSH password prompt 失败路径，不要求远端安装 fish/zsh/插件或联网。
- 新增/更新验证：
  - `cargo fmt --check`
  - `node --check scripts\smoke-ssh-command-suggestions-wsl.mjs`
  - `node --check scripts\smoke-ssh-terminal-password.mjs`
  - `cargo test --test terminal_manager secret_input_response_does_not_repeat_after_second_prompt`
  - `cargo test --test ssh_terminal_password_smoke -- --ignored --list`
  - `npm run smoke:ssh-terminal:password:wsl`
  - `npm run smoke:ssh-terminal:password:wsl:wrong`
  - WSL 清理核验：`id kerminalpw4680469235` 和 `id kerminalpw8416869242` 均返回 `1`，确认本轮临时用户不存在。
  - `cargo test --test terminal_manager`
  - `cargo test --test ssh_terminal_service`
  - `cargo test --test terminal_model`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无新增 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 alternate buffer 状态恢复与长期保留设置追加进展：

- 输入模型进入或离开 alternate buffer 时会重置当前命令状态；alternate buffer 内按键不再写入灰色提示输入模型，避免 `vim/less/top/tmux` 等全屏程序里的编辑按键污染退出后的下一条 shell 建议。
- `XtermPane` 组件回归已覆盖 `normal -> alternate -> normal`：进入全屏程序后隐藏 ghost、抑制新请求、丢弃进入前还未返回的 stale suggestion，退出后只基于新的 shell 输入恢复请求和渲染。
- Rust `TerminalInlineSuggestionSettings` 已持久化 `auditRetentionDays` 和 `feedbackRetentionDays`，默认值和范围与前端一致（30/365 天，1..=3650），保存设置不再丢失用户配置的诊断保留周期；legacy JSON 中过小或极大的 retention 值会先加载再 clamp，不会在 serde 阶段失败。
- 新增/更新验证：
  - `npm run test:frontend -- src/features/terminal/terminalInputModel.test.ts src/features/terminal/XtermPane.test.tsx`
  - `npm run test:frontend -- src/lib/settingsApi.test.ts src/features/settings/settingsModel.test.ts`
  - `cargo test --test settings_service`
  - `cargo fmt --check`
 - `npm run verify:terminal-ghost-visual`
 - `npm run build`
 - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无新增 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 真实 xterm alternate screen 与粘贴抑制追加进展：

- 新增 `scripts/verify-terminal-ghost-real-xterm.mjs` 和 `npm run verify:terminal-ghost-xterm`，在 headless Chrome 中加载真实 `@xterm/xterm/lib/xterm.mjs`，写入 `ESC[?1049h` / `ESC[?1049l` 覆盖 xterm.js 真实 `normal -> alternate -> normal` buffer 切换。
- 新增 `npm run check:terminal-ghost`，串联帧预算、静态视觉和真实 xterm alternate screen 三类门禁；真实 xterm 门禁同时覆盖亮/暗主题、进入 alternate buffer 后隐藏 ghost、alternate 期间丢弃 stale response、回到 normal 后只基于新输入恢复 ghost。
- 输入模型和组件回归补齐括号粘贴/多行粘贴路径：粘贴块不触发新 ghost 请求，进入粘贴态后旧的 in-flight suggestion 返回也不会渲染，右箭头不能接受 stale ghost，提交后下一条普通 prompt 可恢复建议。
- 视觉证据输出：
  - `.updeng/data/verification/terminal-ghost-real-xterm.json`
  - `.updeng/data/verification/terminal-ghost-real-xterm.png`
- 新增/更新验证：
  - `node --check scripts\verify-terminal-ghost-real-xterm.mjs`
  - `npm run verify:terminal-ghost-xterm`
  - `npm run check:terminal-ghost`
  - `npm run test:frontend -- src\features\terminal\terminalInputModel.test.ts src\features\terminal\XtermPane.test.tsx`
 - `npm run build`
 - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 本地 loopback OpenSSH password 终端 smoke 追加进展：

- 新增 `ssh_terminal_password_smoke::local_russh_loopback_password_terminal_auto_login_smoke`：
  - 测试内启动 russh loopback SSH server，写入 Kerminal app 私有 `known_hosts`。
  - 通过本机 OpenSSH client 和产品 `SshTerminalService -> TerminalManager -> OpenSSH PTY` 创建交互式 SSH terminal。
  - 覆盖保存 password 自动响应、登录 ready marker、ASCII 命令 marker、UTF-8 中文命令 `kerminal-unicode-部署-完成` 往返和输出不泄露保存密码。
- 新增 `ssh_terminal_password_smoke::local_russh_loopback_wrong_password_stays_unauthenticated`：
  - 同一 loopback server 使用真实密码 `secret`，但 Kerminal 保存错误密码。
  - 验证 OpenSSH 返回认证失败反馈，不会到达已认证 shell，不会输出登录后命令 marker，也不会泄露错误保存密码。
- 新增 `npm run smoke:ssh-terminal:password:loopback`：
  - 该入口不需要 WSL、外部测试主机、远端 fish/zsh 插件或远端联网。
  - 如果本机缺少 OpenSSH client，测试会显式跳过；在当前 Windows 工作区已跑通。
- 新增/更新验证：
  - `cargo test --test ssh_terminal_password_smoke local_russh_loopback -- --nocapture`
  - `npm run smoke:ssh-terminal:password:loopback`
  - `npm run check:rust`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 `target\debug\kerminal.exe` 启动，随后清理本轮启动进程并确认无 1425 监听和本项目 `kerminal.exe` 残留。

2026-06-19 混合 provider 延迟门禁追加进展：

- 新增非 ignored Rust 测试 `command_suggestion_mixed_provider_latency_gate`：
  - fixture 使用 10k history、5k remote commands、1k remote paths 和 1k Git refs。
  - seed 写入不计入延迟预算；每个场景先 warmup，再采 5 次查询耗时。
  - 覆盖 `history+spec`、`remoteCommand`、`remotePath`、`git` 四类按键查询路径。
  - 断言 median <= 50ms、max <= 150ms，避免本地缓存查询退化到可感知卡顿。
- 新增 `npm run verify:command-suggestion-latency` 单独入口；该测试也会随普通 Rust test 运行。
- 新增/更新验证：
  - `npm run verify:command-suggestion-latency`
  - `npm run check:rust`

2026-06-19 SSH ghost 本地生产门禁追加进展：

- 新增 `npm run test:terminal-ghost`：
  - 聚合 `terminalInputModel`、`XtermPane` 和 `terminalSuggestionApi` 目标测试，作为 ghost 输入/渲染/IPC 契约的快速前端门禁。
- 新增 `npm run check:ssh-command-ghost`：
  - 串联 `test:terminal-ghost`、`verify:command-suggestion-latency`、`smoke:ssh-suggestions:loopback`、`smoke:ssh-terminal:password:loopback` 和 `check:terminal-ghost`。
  - 覆盖本地无外部主机的生产闭环：前端输入与接受逻辑、后端 provider 查询性能、native russh SSH/SFTP refresh、OpenSSH password 交互终端、帧预算、亮/暗主题视觉、中文宽字符对齐和真实 xterm alternate-screen 隐藏/恢复。
- 新增/更新验证：
  - `npm run check:ssh-command-ghost`
  - 视觉证据刷新：`.updeng/data/verification/terminal-ghost-visual.json`、`.updeng/data/verification/terminal-ghost-visual.png`、`.updeng/data/verification/terminal-ghost-real-xterm.json`、`.updeng/data/verification/terminal-ghost-real-xterm.png`

2026-06-19 后端 policy guard 与真实 app ghost smoke 追加进展：

- `CommandSuggestionService` 已在四个 direct refresh API 前统一执行远端 probe 策略：
  - `remoteProbeEnabled=false`：不进入 SSH/SFTP 连接，返回 0 条刷新结果并写入 `remoteProbeSchedule/skipped`，reason=`remote-probe-disabled`。
  - `productionHostPolicy=restricted` 且 host 标记为生产：不进入 SSH/SFTP 连接，返回 0 条刷新结果并写入 `remoteProbeSchedule/skipped`，reason=`production-host-restricted`。
- `command_suggestion_ssh_smoke` loopback server 增加 connection counter，新增生产主机 restricted 和全局 remote probe disabled 两个回归；每个回归都覆盖 remoteCommand、remotePath、远端 shell history、Git 四类 refresh，断言 `connections/exec/sftp` 均为 0、缓存未被 seed、审计 metadata 包含生产标记、策略和 TTL/maxEntries。
- 新增 `scripts/verify-terminal-ghost-app.mjs` 和 `npm run verify:terminal-ghost-app`：
  - 通过 Vite Node API 启动真实 React/Vite app。
  - 使用 headless Chrome + fake Tauri IPC 打开真实 SSH pane，不依赖外部主机。
  - fake IPC 返回 `remoteCommand` 候选 `journalctl`，真实 `XtermPane` 渲染 `aria-label=终端命令灰色提示` + `data-provider=remoteCommand` overlay。
  - 发送 RightArrow 后断言 accepted feedback 已记录，写入路径为 `j`/`o`/`u`/`r`/`nalctl`，最终拼接为 `journalctl`。
- `npm run check:terminal-ghost` 已扩展为串联 frame、static visual、real xterm 和 real app 四类门禁；`npm run check:ssh-command-ghost` 自动包含该 app smoke。
- 新增/更新验证：
  - `cargo test --test command_suggestion_ssh_smoke loopback_ -- --nocapture`
  - `npm run verify:terminal-ghost-app`
  - `npm run check:ssh-command-ghost`
  - `npm run check:rust`
  - `npm run build`
  - `npm run tauri:dev` 冒烟到 Vite ready 与 `target\debug\kerminal.exe` 启动；首次运行因旧开发进程占用 1425 失败，清理旧 Vite/debug app 后复跑通过，结束后确认无 1425 监听和本项目 `kerminal.exe` 残留。
  - 视觉证据新增：`.updeng/data/verification/terminal-ghost-app.json`、`.updeng/data/verification/terminal-ghost-app.png`

当前剩余：

- telemetry、审计事件、诊断导出、清理策略和保留周期设置已落地；后续如需继续增强，可扩展用户可导出的远端 probe 上下文。
- 交互式 SSH terminal 与 provider/native russh 在应用 known_hosts、私钥路径、内联私钥和 password 保存凭据上已对齐；本轮已通过本地 loopback OpenSSH PTY、WSL 临时真实 OpenSSH password 主机 smoke 和错误保存密码失败 smoke，后续仍建议在独立外部测试主机上覆盖不同发行版、PAM/keyboard-interactive 文案和错误密码重试策略差异。
- 本地 loopback 已自动覆盖无外部主机依赖、仅 `sh -s`、远端 shell history 只读读取、慢响应、大量命令输出、大目录、断开后的 cache-only 查询、refresh 失败保留旧缓存，以及交互式 OpenSSH PTY 的 password 自动响应、错密认证失败和 UTF-8 中文命令往返；WSL OpenSSH 已覆盖真实 SSH/SFTP subsystem、strict known_hosts、真实 Git repo、真实 history 文件读取、只暴露 `sh` 的最小 PATH posix-only remoteCommand fallback、真实 OpenSSH password 交互终端自动响应、错误保存密码失败路径，以及真实 OpenSSH PTY 下 UTF-8 中文命令输入输出；前端组件和视觉 smoke 已覆盖中文/宽字符 ghost 对齐、真实 xterm alternate screen 切换、粘贴抑制和恢复。仍需在独立外部无互联网 Linux、外部仅 `/bin/sh` 主机、慢网络、大目录、断线重连、真实 history 文件差异、真实 `vim/less/top/tmux` 和独立外部主机 SSH 终端中文输入场景执行 `npm run smoke:ssh-suggestions`、`npm run smoke:ssh-terminal:password` 与人工终端交互验收。
- 主机级生产策略已接入 restricted/normal，并记录 schedule skip 审计；仍缺真实生产主机 smoke。
- AI provider 仍保持 HITL/默认关闭。


