# AGENTS.md

## 前端主题约束

- 新增或修改页面、组件、弹框、菜单、下拉、toast、portal 和独立窗口时，必须同时验证浅色、深色和跟随系统主题；颜色优先使用项目主题 CSS 变量或成对的 Tailwind `dark:` 样式，不新增只在单一主题可读的硬编码色彩。
- 弹层和 portal 必须能继承全局主题上下文；新增独立窗口或 portal 入口时复用 `useDocumentTheme`，不要只把 `.dark` / `data-theme` 挂在局部容器上。

## 启动验证约束

- 功能开发、修复或重构完成前，必须保证应用程序可以正常启动；前端改动至少运行 `npm run build` 并做真实 dev server 启动冒烟，涉及 Tauri/Rust/窗口/权限时还要验证 `npm run tauri:dev` 或明确说明无法运行原因。
- 发现白屏、启动失败、动态导入失败、Vite `Outdated Optimize Dep`、Tauri 窗口打不开等启动阻断问题时，先修复到可启动状态，再交付其它功能结果。
- `src-tauri/tauri.conf.json` 的 `app.security.freezePrototype` 不要改回 `true`，除非已经完成 WebView 依赖兼容验证并跑通真实 `npm run tauri:dev`；遇到 `Cannot assign to read only property 'toString'` 时，优先检查该配置和 `@xterm/xterm` 启动兼容补丁。

## 功能变更兼容约束

- 新增或修改功能时，必须保持已经正常工作的功能不被破坏，包括既有入口、交互流程、快捷键、配置格式、数据读写、运行时行为和公开契约。
- 若确实需要改变已有行为，先说明影响范围、迁移或回滚口径和验证方式；实现后至少覆盖新增/修改功能及相邻既有功能的回归验证，不把无关重构、格式化或“顺手修”混入同一变更。

## Kerminal MCP 与外部 Agent 边界

- Kerminal MCP Server 面向 Codex 和其它 MCP host 时只提供运行态 tools；host 自己负责工具确认、审批、权限、hook 和审计。
- 文件型配置优先由 agent 直接编辑工作区文件并运行 validator，不通过 MCP CRUD：`settings.toml`、`profiles/*.toml`、`hosts/groups.toml`、`hosts/*.toml`、`snippets/*.toml`、`workflows/*.toml`。
- 修改 Kerminal 配置文件前必须先读配置手册：仓库内是 `.updeng/docs/config/kerminal-config-files.md`，外部 `~/.kerminal` 工作目录内是生成的 `kerminal-config.md`；手册包含文件用途、关联关系、字段含义、示例、禁止项和 validator。
- 主机凭据保存走 encrypted vault；`hosts/*.toml` 只保留 `secret_ref` / `key_passphrase_ref` 等 vault 引用，禁止写入 `password`、`credential_secret`、`inline_private_key`、key passphrase 或私钥正文。
- 不要为 settings/profile/host/snippet/workflow、UI 编排、历史写入或旧 pending/confirm/approval/audit 重新增加 MCP tools；这些能力应由文件操作、现有前端交互或 MCP host 策略承担。
- MCP tools 只保留必须依赖 live app、既有终端 session、保存连接凭据、SSH/SFTP、tmux、容器（含 `container.files.list`、`container.files.preview`、`container.files.write_text`、`container.files.upload`、`container.files.download`、`container.files.create_directory`、`container.files.rename`、`container.files.chmod`、`container.files.delete` 等容器内文件读写、传输和路径管理能力）、端口转发、服务器信息、命令历史查询或诊断的能力。
- `kerminal.app_guide` 是外部 Agent 的应用导航入口，返回 Kerminal 左栏、终端工作区、右栏工具、Agent 会话和配置 workspace 与 MCP 工具族的对应关系；`kerminal.config_guide` 返回与生成的 `kerminal-config.md` 同源的配置规则正文；`kerminal.capabilities` 是 MCP 工具自发现入口；`kerminal.tool_help` 按 toolId、family 或 query 返回 schema、示例参数、安全标注和故意缺席工具族说明；`kerminal.operation_guide` 是按任务意图返回工具调用顺序的操作指南，`kerminal.runtime_snapshot` 是当前运行态概览入口；新增或移除运行态工具族时，同步更新这些工具返回内容、工作空间初始化模板和外部 Agent 文档。
- 会话级工作空间必须写入 `context/mcp-endpoint.json`、`context/target-binding.json` 和 `context/terminal-snapshot.json`；`AGENTS.md` / `CLAUDE.md` 模板必须提示先读这些文件，再用 `kerminal.agent.current_session` / `kerminal.agent.target_context` 刷新 live 目标。
- `~/.kerminal/AGENTS.md` 是外部 agent 的主规则入口；修改生成模板时要同步更新相关测试和 `.updeng/docs/config/external-agent-workspace.md`。

## 代码与测试边界

- 测试代码和正式运行代码必须分开：测试夹具、mock、fake、fixture、断言辅助、smoke/harness 入口放在 `tests/`、`__tests__/`、`*.test.*` 或明确的 test-support 目录/命名空间中，不要混入 `src/`、`src-tauri/src/` 等生产路径。
- 正式代码只保留必要的可注入接口、稳定抽象和运行时实现；若测试需要共享辅助能力，应放在测试支持模块里，并确保生产构建和运行时不会依赖这些测试辅助。

## 并行任务协作约束

- 多个 Codex 会话可以并行开发；多个 active plan、长任务、共享路径、脏工作区、worker-assisted、evolution 或 formal change 都必须登记一个 lane，入口为 `.updeng/docs/coordination/lanes.json`；计划、分支/worktree、owner session、主要写入路径、共享热点文件和同步口径必须可见。
- 默认使用独立 worktree/分支承载新并行任务；当前已有脏工作区无法立即迁移时，必须先登记 lane 并把共享文件列入 `sharedPaths`，再继续最小合并。
- 修改别人 lane 的 `ownedPaths` 或任何 `sharedPaths` 前，先读取对应计划、最新文件和当前 diff；只做最小兼容修改，并在本轮 Round Log 或 coordination ledger 记录同步结果。
- 同一文件并行修改不要求停工，但要求可见：不要静默覆盖对方改动，不要宽泛格式化共享文件，不要把“顺手修”混进共享热点文件。

<!-- UPDENG_START -->
## Updeng

本区块由 Updeng CLI 管理；项目自己的规则写在 `UPDENG_START/UPDENG_END` 之外。

### 路由

- 默认启用智能 Updeng 路由：用户可以直接描述需求，也可以用 `/skills <需求>` 或 `/updeng <需求>` 显式触发；不要要求用户重复说明“按 Updeng”。
- 处理开发、修改、排查、评审、文档和技能维护任务时，先查看 `.updeng/manifest.json`，只从当前项目已安装的 skills 中选择；不要假设固定 group，也不要引用模板仓库、插件或全局 skills 作为本项目技能。
- 优先使用 `.codex/skills/bwy-updeng-workflow/SKILL.md` 判定任务类型、技能组合和流程深度；如果目标项目没有安装该 skill，就说明缺失并按普通工程流程谨慎处理。
- 开发功能和修改功能继续使用 `.codex/skills/bwy-development-governance/SKILL.md`；简单 direct 任务可跳过正式计划和问答，直接实现、验证并收口。
- 若项目安装了通用工程工作流 skills：需求模糊或用户要求先聊清楚时用 `bwy-requirement-discovery`，需求术语不清先用 `bwy-domain-context`，缺陷排查用 `bwy-diagnose`，测试先行用 `bwy-tdd-development`，原型探索用 `bwy-prototype`，架构深化用 `bwy-architecture-deepening`，PRD/issue 拆分用 `bwy-issue-planning`。

### 工作流边界

- 每轮开工先重读真相源：`AGENTS.md`、`README.md`、`.updeng/docs/README.md`、`.updeng/docs/in-progress.md`、`.updeng/docs/BLOCKERS.md`、`.updeng/docs/plan/INDEX.md`、当前 `plan/active/*.md`、`coordination/status.md`，以及正式 change 的 `proposal.md`、`specs/*/spec.md`、`design.md`、`tasks.md`、`verification.md|json`；不要只依赖对话记忆。
- direct 任务：范围清楚、风险低、无跨模块影响时，直接实现并运行必要验证。
- plan 是默认主流程：普通功能、跨文件修改、缺陷修复、技能维护和持续推进任务，先明确目标、影响范围、验证方式和回滚口径，再登记 `.updeng/docs/plan/INDEX.md` 和对应状态目录。
- formal change 是按需审计流程：只有数据库、权限、安全、生产、发布、公共契约、迁移、强审计或长期多人协作任务，才使用 `updeng new -> explore -> spec -> design -> plan -> build -> verify -> archive`。
- 人工计划不平铺堆在 `.updeng/docs/plan/`：先更新 `.updeng/docs/plan/INDEX.md`，文件按状态放入 `plan/next/`、`plan/active/`、`plan/blocked/` 或 `plan/done/`，文件名使用 `PLAN-YYYYMMDD-HHMMSS-<slug>.md`。
- 多个 active plan、长任务、共享文件、脏工作区或 worker-assisted 任务必须登记 `.updeng/docs/coordination/lanes.json`，并读取/刷新 `coordination/status.md`；每个 changed path 要么归属到 lane，要么作为 unclaimed 风险汇报。
- 正式 change 使用 `.updeng/docs/changes/<change-id>/tasks.md` 作为审计台账；人工计划使用 `plan/active/*.md` 作为默认任务台账。每轮挑第一个依赖满足的未勾选 `TASK-*`，只做一个最小可提交单元，完成后勾选并补 Round Log。
- subagent/batch 工作用 `updeng sdd task-brief`、worker report、`updeng sdd review-package` 和 `updeng sdd progress` 进行文件交接；`.updeng/tmp/sdd/` 是被忽略 scratch，正式结论写回 plan 或 change artifact。
- 任务实现后先运行对应验证，验证通过后才提交或记录未提交原因；同一任务连续 2 轮验证不绿，或连续 3 轮无实质进展，停下汇报阻塞。
- UI/前端/桌面窗口变更必须运行真实界面并截图；有原型、设计图、参考 HTML 或旧页面时并排比对，关键视觉差异未消除前不提交。
- 自主循环必须有上限：默认最多 3 轮无实质进展即停，同一任务最多 2 轮修不绿即停；用户或计划设置了 token/成本/轮数上限时，以更严格者为准。
- 关键风险必须进入工具层门禁：宽泛 `git add -A/.`、敏感文件提交、危险删除、强推主分支或生产写操作不能只靠提示词约束；普通远端推送和常规发版不作为默认工具层拦截项。

### 文件约定

- 人工可读文档写入 `.updeng/docs/`，包括计划、业务事实、决策、完成记录和运行说明。
- `.updeng/docs/plan/INDEX.md` 是人工计划入口；`created_at` 表示生成顺序，`started_at` 表示执行顺序，`completed_at` 表示收口时间。
- `.updeng/docs/changes/` 不是普通任务默认入口；它只承载升级后的 formal change。不要因为计划存在就补建空 change。
- 低风险、可逆的默认选择和待确认点写入 `.updeng/docs/BLOCKERS.md` 或任务 Round Log；不可逆、合规、安全、架构、生产、凭据或外部授权问题必须停下询问。
- 需求发现和头脑风暴结论写入 `.updeng/docs/discovery/`；共享语言写入 `.updeng/docs/domain/`；没有外部 issue tracker 时，PRD、issue 切片和 agent brief 写入 `.updeng/docs/issues/`。
- 机器状态、事件、上下文、worker 结果、审计、指标和自进化提案写入 `.updeng/docs/`。
- task brief、worker report、review package 和 progress ledger 写入 `.updeng/tmp/sdd/`；它们是临时交接文件，不要当长期文档维护。`.updeng/tmp/` 不放长期 build output、浏览器 profile、release 包或唯一验收证据。
- 目标项目已安装的 platform adapter 位于 `.codex/`、`.claude/` 或 `.vscode/`；模板源、schemas、artifact templates 和运行脚本位于 Updeng 包内，不在业务项目里维护运行副本。
- 修改 `AGENTS.md` 或 `.gitignore` 时保留 Updeng 托管标记；除非用户明确要求，不要删除 `.updeng/manifest.json`、`.updeng/state.yaml` 或 `.updeng/docs/`。

### 交付

- 每次代码变更后运行与改动范围匹配的验证；无法运行时说明原因和剩余风险。
- 提交前只 stage 本轮实际修改的具体文件；禁止 `git add -A`、宽泛 `git add .` 或把未归因改动混入当前任务。
- 普通远端推送和常规发版可在用户意图明确、工作区状态清楚时执行；生成签名密钥、删除大量文件、数据库迁移/清空、生产写操作和付费外部服务调用仍需先确认影响范围与回滚方式。
- 不要把临时日志、缓存、密钥、私钥、证书或 `.env` 内容写入文档或提交范围。
- 发现用户已有未归因改动时先保护现状，只在必要范围内继续；不要擅自回滚用户改动。
<!-- UPDENG_END -->
