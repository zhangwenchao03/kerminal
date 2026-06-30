---
id: PLAN-20260625-093610-legacy-compat-dead-code-cleanup
status: done
created_at: 2026-06-25T09:36:10+08:00
started_at: 2026-06-25T09:48:49+08:00
completed_at: 2026-06-25T12:05:00+08:00
updated_at: 2026-06-25T12:05:00+08:00
owner: ai
---

# 遗留、兼容、无用和废弃代码清理计划

## 背景

- 当前产品方向已经从内置 AI runtime / provider / 自定义 MCP 配置器，收敛为外部 Agent Launcher + Kerminal MCP tools-only server。
- settings/profile/hosts/snippets/workflows 已转向文件优先，命令历史和命令建议保留 `data/command.sqlite`；旧一体化 `kerminal.db` 不再作为当前事实源。
- 当前工作区已有大量未提交改动，且存在一个 active lane 和一个 blocked lane：
  - `lane-test-production-boundary-cleanup`：正在迁移生产路径中的测试代码、测试 helper 和 `cfg(test)` 残留。
  - `lane-kerminal-db-cleanup`：代码侧已确认并清理旧 `kerminal.db` / runtime SQLite 入口，当前 blocked 于用户手动删除真实 home 下旧 DB 文件。
- 本计划已经进入 active cleanup lane；首轮先做 production-only inventory 和低冲突候选确认，不抢已有 active lane 的 owned paths。

## 目标

- 系统排查并清理遗留代码、兼容性代码、无用代码和废弃功能代码。
- 把可删除、需降级为迁移窗口、需保留为当前契约、需等待 active lane 的候选分开处理。
- 每个删除切片都有引用扫描、行为测试、构建和启动验证。
- 清理后 README、ADR、运行脚本、依赖清单和测试边界一致，不再留下已废弃功能的维护入口。

## 非目标

- 不恢复内置 AI/provider/chat UI、旧 pending/confirm/approval/audit 队列或旧 custom MCP CRUD。
- 不删除当前仍有效的 Kerminal MCP tools-only server、外部 Agent workspace、命令历史和命令建议 SQLite。
- 不迁移或删除用户真实 `~/.kerminal` 数据；只处理仓库代码、仓库内旧产物和明确无用的工作区文件。
- 不在 active `test-production-boundary-cleanup` 和 `kerminal-db-cleanup` lane 未收口前抢它们的 owned paths。
- 不把历史 ADR 和已归档计划当作代码残留直接删除；只标注 superseded 或在新文档中建立当前事实入口。

## 当前候选清单

| 类别 | 候选 | 当前证据 | 初判 | 处理策略 |
| --- | --- | --- | --- | --- |
| 旧 AI 性能残留 | `scripts/perf-collect-baseline.mjs` 仍读取 `perf-ai-streaming-baseline.json` | 当前 `scripts/` 无 `perf-ai-streaming.mjs`，产品已删除内置 AI streaming | 可删/可改 | P1 移除 aiStreaming baseline 字段，更新性能汇总和历史计划引用 |
| Rust 旧依赖 | `src-tauri/Cargo.toml` 中 `rig-core = { features = ["rmcp"] }` | 生产源码无 `rig_core` 引用 | 倾向删除 | P2 删除 `rig-core` 后跑 `cargo tree`、`cargo test`、`cargo clippy` |
| MCP 依赖 feature | `rmcp` 仍启用 `client`、`transport-child-process`、`transport-streamable-http-client-reqwest` | 生产 server 用 `rmcp`，测试用 client；child-process/client reqwest 可能只为旧 custom MCP | 待确认 | P2 先 `cargo tree -e features -i rmcp`，再最小收缩 feature |
| 存储命名兼容 | 当前磁盘已是 `RuntimeFileStore` + `CommandSqliteStore` 分离 | CodeGraph 显示 `RuntimeFileStore::open` 只确保目录，production-only `rg` 无 `SqliteStore` 命中 | 倾向已被前序未提交改动解决 | 等 `kerminal.db` lane 完成后复核，不再重复重命名 |
| 旧 DB 路径 | `kerminal.db` / 旧一体化 SQLite 代码 | blocked `lane-kerminal-db-cleanup` 已确认代码侧无运行时依赖 | 代码侧完成，物理文件删除需用户 | 复用其结论；不删除用户真实数据 |
| workspace 旧快照兼容 | `legacyTargetFromPane` | `workspaceSession.ts` 在 v1 snapshot 缺 `target` 时恢复 target | 迁移窗口 | 先加版本/遥测或一次性迁移策略；确认不再需要后删除 fallback |
| secret plan 旧 id | `TerminalSecretInputEntry::from` 使用 `legacy-secret` | 只为旧 `TerminalSecretInputResponse` 转换生成稳定 id | 兼容入口 | 追踪调用方，若旧 response 类型仍是 public contract 则保留并改名注释；否则迁移到多 entry API 后删除 |
| 测试边界残留 | `src-tauri/src/services/sftp_service.rs` 的 `#[cfg(test)] mod tests;` 和 `src-tauri/src/services/sftp_service/tests/**` | 测试边界 lane 报告列为 P1 剩余 | 等待/接续 | 待 active lane 完成或授权接手后迁到 `src-tauri/tests/sftp_service/**` |
| doc-hidden rules | 多个 `#[doc(hidden)]` rules 模块 | 测试迁移中为集成测试暴露真实规则 | 需二次评估 | 规则属于运行时模型则正式命名；仅测试缝隙则用 public behavior 测试替代并收回 |
| MCP/external-agent inline tests | `external_agent_workspace.rs`、`mcp_streamable_http_server.rs`、`mcp_tool_executor_service/ssh_tools.rs` | 测试边界报告列为剩余 | 等待/接续 | 拆到集成测试，保留 tools-only/server contract |
| `lib.rs` 测试 cfg | `app_menu` / `app_tray` 和 `run` 使用 `#[cfg(not(test))]` | 避免测试构建拉 Tauri runtime/tray | 可能合理 | 只做审查，不作为优先删除；若可通过 mock builder 覆盖再收敛 |
| 文档旧事实 | ADR-0001/0002/0003 仍记录 SQLite/AI tool registry 旧方向 | 后续 ADR-0016/0017/0018 已覆盖 | 不删除历史 | 加 superseded 链接或当前事实索引，避免误读 |

## 执行步骤

- [x] TASK-001：建立 production-only 残留扫描基线。
  - 范围：`src/`、`src-tauri/src/`、`scripts/`、`package.json`、`src-tauri/Cargo.toml`。
  - 输出：`.updeng/docs/reports/legacy-compat-dead-code-inventory-20260625.md`。
  - 扫描维度：旧 AI/provider/tool registry、旧 SQLite、`legacy|deprecated|obsolete|compat` 标记、`#[cfg(test)]`、`#[doc(hidden)]`、未引用依赖、失效脚本。
  - 验证：报告包含 delete / keep / defer / needs-HITL 四类，并记录排除测试夹具和归档文档的规则。

- [x] TASK-002：清理旧 AI 性能 baseline 残留。
  - 候选文件：`scripts/perf-collect-baseline.mjs`、`package.json` 中性能脚本说明、`.updeng/docs/verification/*performance*` 可再生成产物。
  - 做法：删除 `aiStreaming` baseline 汇总字段，避免 `perf:baseline` 永久因为不存在的旧 AI 报告变成 incomplete。
  - 验证：`npm run perf:directory-list`、`npm run perf:terminal-output`、`npm run perf:collect-baseline`，必要时补 `npm run perf:baseline`。

- [x] TASK-003：移除旧 AI / Rig 依赖并收缩 MCP feature。
  - 候选文件：`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`。
  - 做法：先删除无引用 `rig-core`；随后评估 `rmcp` 是否只需要 server feature，测试 client feature 是否可放入 dev dependency 或保留。
  - 验证：`cargo tree -e features -i rig-core` 应无结果或确认删除，`cargo tree -e features -i rmcp` 记录 feature 来源；运行 `cargo test --manifest-path src-tauri/Cargo.toml mcp`、`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`。

- [x] TASK-004：等待或接续旧 `kerminal.db` 清理。
  - 前置：`lane-kerminal-db-cleanup` 至少完成 TASK-001，确认旧 DB 是否仍被打开。
  - 做法：复用 blocked lane 结论：代码侧已清理旧一体化 SQLite，当前有效 SQLite 是 `data/command.sqlite`；剩余真实 `C:\Users\24052\.kerminal\kerminal.db` 物理删除由用户手动执行。
  - 验证：复用 `lane-kerminal-db-cleanup` Round Log：fmt、Rust 相邻测试、typecheck、前端诊断 API 测试、build、Vite dev server smoke、临时 target 下 `tauri:dev` 启动通过。

- [x] TASK-005：复核 file-backed store 命名是否已经收口。
  - 前置：TASK-004 确认旧 app-wide SQLite 已清理。
  - 候选文件：`src-tauri/src/storage/runtime_store.rs`、`src-tauri/src/storage/mod.rs`、`src-tauri/src/state.rs`、local file / port forwarding / MCP executor 路径。
  - 做法：确认当前 `RuntimeFileStore` 命名已经替代旧 `SqliteStore`；若只剩文案残留，改文案，不再做重复重命名。
  - 验证：`rg -n "SqliteStore|sqlite file facade|failed to initialize Kerminal data directory and SQLite" src-tauri/src` 应无误导性命中；跑 storage、port forward、local files、MCP executor 相邻测试。

- [x] TASK-006：审查并收敛 workspace session 旧快照兼容。
  - 候选文件：`src/features/workspace/workspaceSession.ts`、`src/features/workspace/workspaceSession.test.ts`、`src/app/useWorkspaceSessionPersistence.ts`。
  - 做法：确认 `WORKSPACE_SESSION_VERSION = 1` 的兼容窗口；若仍需要，增加明确注释和迁移出口；若已可删除，移除 `legacyTargetFromPane` 并补旧快照拒绝/迁移测试。
  - 验证：`npm run test:frontend -- src/features/workspace/workspaceSession.test.ts src/app/useWorkspaceSessionPersistence.test.ts`、`npm run build`、真实 dev server smoke。

- [x] TASK-007：审查 `TerminalSecretInputResponse` legacy 转换。
  - 候选文件：`src-tauri/src/models/terminal.rs`，调用方包括 SSH、port forward、terminal manager secret input plan。
  - 做法：追踪 `TerminalSecretInputResponse` 是否仍是 public command contract；若只剩内部旧适配，迁移调用方到 `TerminalSecretInputPlan` 后删除 `legacy-secret` 转换；若仍需保留，改文档说明其兼容原因。
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml --test terminal_manager`、`cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service`、`cargo test --manifest-path src-tauri/Cargo.toml --test port_forward_service_plan`。

- [x] TASK-008：接续测试边界残留迁移。
  - 前置：避免与 `lane-test-production-boundary-cleanup` 同时写同一路径；若该 lane active，先读取其最新 Round Log 和 checkpoint。
  - 候选文件：`src-tauri/src/services/sftp_service/tests/**`、`src-tauri/src/services/sftp_service.rs`、`src-tauri/tests/sftp_service/**`。
  - 做法：把 SFTP fake/support/loopback/queue/archive/native backend 测试迁到 `src-tauri/tests/sftp_service/**` 或明确 test-support 模块；生产 `sftp_service.rs` 删除 `#[cfg(test)] mod tests;` 和测试专用 import。
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml --test sftp_service`、`cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run`、生产路径残留 `rg`。

- [x] TASK-009：二次评估 `#[doc(hidden)] rules` 模块。
  - 候选：`connection.rs`、`file_dialog.rs`、`command_suggestion_service.rs`、`diagnostics_service.rs`、`docker_host_service.rs`、`mcp_streamable_http_server.rs`、`mcp_tool_executor_service.rs`、`port_forward_service.rs`、`serial_terminal_service.rs`、`sftp_service.rs`、`ssh_command_service.rs`、`ssh_terminal_service.rs`、`telnet_terminal_service.rs`、`terminal_manager.rs`。
  - 做法：逐个判断是正式运行时规则模型，还是测试迁移临时入口。正式模型改为清晰模块名并去掉 `doc(hidden)`；临时入口用公开行为测试替代后删除。
  - 验证：每个模块只跑相邻测试；最后跑 `rg -n "#\\[doc\\(hidden\\)\\]" src-tauri/src --glob "!**/tests/**"`，报告保留项理由。

- [x] TASK-010：迁移 external-agent / MCP / SSH tools 内联测试。
  - 候选文件：`src-tauri/src/services/external_agent_workspace.rs`、`src-tauri/src/services/mcp_streamable_http_server.rs`、`src-tauri/src/services/mcp_tool_executor_service/ssh_tools.rs`。
  - 做法：将内联测试迁到 `src-tauri/tests/**`；保持 tools-only server contract，不恢复 resources/prompts/custom MCP CRUD。
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace`、`cargo test --manifest-path src-tauri/Cargo.toml mcp`、`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`、`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_tool_executor_service`。

- [x] TASK-011：文档事实收敛。
  - 候选：旧 ADR、旧 done 计划、README、`.updeng/docs/config/**`。
  - 做法：不删除历史 ADR；给 ADR-0001/0002/0003 增加 superseded-by 指向 ADR-0016/0017/0018 或新增当前事实索引，避免后续 agent 按旧 AI/SQLite 方案行动。
  - 验证：`rg -n "AI Tool Registry|LLM provider|kerminal\\.db|settings\\.ai|custom MCP|pending/confirm" README.md .updeng/docs/decisions .updeng/docs/config`，确认旧事实只出现在历史或明确 superseded 文档中。

- [x] TASK-012：全量验证和收口。
  - 验证命令：`npm run typecheck`、`npm run test:frontend`、`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`。
  - 启动验证：真实 dev server smoke；若改动 Tauri/Rust 初始化、窗口、权限或 storage，补 `npm run tauri:dev`，并优先解决旧 `kerminal.db` schema 阻断。
  - 收口：更新本计划 Round Log、`plan/INDEX.md`、`in-progress.md`、`lanes.json`，必要时归档到 `plan/done/`。

## 删除门禁

- 删除前必须有 production-only 引用扫描，不把测试夹具、归档文档和历史计划当作运行时引用。
- 删除前必须确认不在其它 active lane 的 `ownedPaths` 或未同步 `sharedPaths` 中；命中时先读对方计划、diff 和 checkpoint。
- 兼容代码只有满足以下任一条件才删除：
  - 旧数据/旧 API 入口已被一次性迁移或明确不支持。
  - README/ADR/配置手册已声明不再兼容。
  - 有测试覆盖旧输入被拒绝或迁移后的行为。
- `CommandSqliteStore`、命令历史、命令建议缓存、Kerminal MCP tools-only server 和外部 Agent workspace 默认保留，除非新 ADR 明确改变当前事实。
- 不删除用户真实数据，不运行清空/迁移真实 `~/.kerminal` 的命令。

## 并行策略

- 本计划当前为 `active`，已登记独立 lane：
  - lane id：`lane-legacy-compat-dead-code-cleanup`
  - branch：当前脏主工作区历史例外，暂不切新分支；后续可提交切片时再使用 `kong/legacy-compat-dead-code-cleanup` 或独立 worktree。
  - owned paths 初始只包含本计划和新增 inventory report。
  - shared paths：`.updeng/docs/plan/INDEX.md`、`.updeng/docs/in-progress.md`、`.updeng/docs/coordination/lanes.json`。
- 执行 TASK-004/TASK-008 前必须同步 `lane-kerminal-db-cleanup` 和 `lane-test-production-boundary-cleanup` 的最新 Round Log。
- 当前主工作区已有大量未归因改动；代码删除优先在隔离 worktree 执行，或至少每个切片只 stage 自己实际修改的具体文件。

## 验证矩阵

| 层级 | 命令/检查 | 触发条件 |
| --- | --- | --- |
| 引用扫描 | `rg -n "<deleted symbol/path>" src src-tauri/src scripts package.json src-tauri/Cargo.toml` | 每个删除切片 |
| 前端类型 | `npm run typecheck` | 修改 `src/` 类型、API 或 settings/workspace |
| 前端测试 | `npm run test:frontend -- <slice>` | 修改前端模型、脚本或 UI |
| 前端构建 | `npm run build` | 任意前端生产路径改动 |
| Rust 格式 | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 任意 Rust 改动 |
| Rust 相邻测试 | `cargo test --manifest-path src-tauri/Cargo.toml <slice>` | 每个 Rust 切片 |
| Rust 全量 | `cargo test --manifest-path src-tauri/Cargo.toml` | 多模块删除、依赖清理或收口 |
| 依赖验证 | `cargo tree -e features -i <crate>` / `npm ls <package>` | 删除依赖或 feature |
| 启动冒烟 | `npm run dev -- --host 127.0.0.1 --port <free> --strictPort` | 任意前端/脚本清理后 |
| Tauri 启动 | `npm run tauri:dev` | storage、commands、state、Tauri 初始化或窗口相关改动 |

## 回滚口径

- 每个切片单独提交或生成 checkpoint；回滚只还原该切片文件。
- 若依赖删除导致构建失败，优先恢复依赖和 lockfile，再把原因写入 Round Log。
- 若兼容删除导致旧快照/旧配置无法恢复，先恢复兼容分支，补旧输入测试，再重新设计迁移窗口。
- 若 `tauri:dev` 因真实用户数据 schema 阻断，不修改真实数据；使用隔离 home 或先完成 `kerminal.db` cleanup lane 的启动修复。

## Ready for Agent 切片

| 顺序 | 标题 | 类型 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| 1 | production-only inventory | AFK | None | 生成 inventory report，候选有分类和证据 |
| 2 | 旧 AI perf baseline 清理 | AFK | 1 | `perf:collect-baseline` 不再依赖不存在的 AI 报告 |
| 3 | `rig-core` 删除和 `rmcp` feature 审查 | AFK | 1 | 依赖树和 MCP 测试通过 |
| 4 | 旧 DB 与 `SqliteStore` 命名收口 | HITL/AFK | `lane-kerminal-db-cleanup` | 旧 app-wide SQLite 事实明确，命名不误导 |
| 5 | workspace session legacy 兼容窗口 | HITL | 1 | 用户或 ADR 确认是否保留旧会话快照恢复 |
| 6 | SFTP 大测试挂载迁移 | AFK | `lane-test-production-boundary-cleanup` | 生产路径无 SFTP test module 挂载，SFTP 集成测试通过 |
| 7 | `doc(hidden) rules` 二次收敛 | AFK | 6 | 每个 rules 入口有保留理由或已移除 |
| 8 | external-agent / MCP inline tests 迁移 | AFK | 7 | tools-only contract 测试通过 |
| 9 | 文档 superseded-by 收敛 | AFK | 1 | 旧 AI/SQLite 事实不会被当作当前事实入口 |

## Round Log

- 2026-06-25T09:36:10+08:00：创建 next 计划。已读取 AGENTS、README、Updeng 文档、active 计划、coordination lane/status 和测试边界报告；用 CodeGraph 追踪 `SqliteStore`、`legacyTargetFromPane`、`TerminalSecretInputEntry::from`、SFTP 测试挂载和外部 Agent/MCP 相关入口；用 production-only `rg` 初步确认旧 AI/provider/tool registry 主链路已大多删除，剩余高价值候选是旧 AI perf baseline、`rig-core` 依赖、`SqliteStore` 命名、workspace legacy session fallback、SFTP 大测试挂载和 `doc(hidden) rules` 二次收敛。
- 2026-06-25T09:48:49+08:00：按 goal 启动 active lane。已刷新 coordination status，当前工作区 614 个 changed paths，active lane 为 `lane-test-production-boundary-cleanup` 和 `lane-kerminal-db-cleanup`；本 cleanup lane 初始只认领计划文件与 inventory report，`plan/INDEX.md`、`in-progress.md`、`lanes.json` 作为共享协调路径最小追加。本轮先执行 TASK-001 production-only inventory，代码删除和依赖收缩待报告分类后逐切片处理。
- 2026-06-25T09:48:49+08:00：完成 TASK-001 inventory，报告写入 `.updeng/docs/reports/legacy-compat-dead-code-inventory-20260625.md`。结论：production-only 旧 AI/provider/tool registry 关键模式无运行时命中；可删除优先级为 `scripts/perf-collect-baseline.mjs` 旧 `aiStreaming` 聚合、`rig-core` 直接依赖和 `rmcp` 旧 client/child-process feature；当前磁盘已是 `RuntimeFileStore` + `CommandSqliteStore`，不再重复执行旧 `SqliteStore` 重命名；`legacyTargetFromPane`、`legacy-secret`、历史 ADR superseded、SFTP 大测试挂载和 MCP/external-agent inline tests 需按 HITL 或其它 active lane 同步后处理。
- 2026-06-25T10:07:00+08:00：完成 TASK-002 旧 AI perf baseline 清理。`scripts/perf-collect-baseline.mjs` 不再读取 `perf-ai-streaming-baseline.json`，summary 不再输出 `aiStreamingPass`，pass 条件只要求 directory list、terminal output 和 frontend bundle。验证通过：`node --check scripts/perf-collect-baseline.mjs`、`npm run perf:directory-list`（6 runs，max 13.75 ms，max 32 DOM nodes）、`npm run perf:terminal-output`（4 scenarios，max frame gap 16.80 ms，max long task 0.00 ms）、`npm run perf:collect-baseline`（pass，生成 `.updeng/docs/verification/performance-baseline-20260625.json`）、`rg -n "aiStreaming|perf-ai-streaming" scripts/perf-collect-baseline.mjs .updeng/docs/verification/performance-baseline-20260625.json` 无命中、`git diff --check -- scripts/perf-collect-baseline.mjs` 通过。
- 2026-06-25T10:12:00+08:00：同步 `lane-kerminal-db-cleanup` 最新 blocked 结论，完成 TASK-004/TASK-005。旧 DB 代码侧已由该 lane 确认和清理，剩余用户手动删除真实 `C:\Users\24052\.kerminal\kerminal.db`；本 lane 不触碰真实用户数据。当前磁盘已使用 `RuntimeFileStore` 与 `CommandSqliteStore` 分离，`rg -n "SqliteStore|sqlite file facade|failed to initialize Kerminal data directory and SQLite" ...` 只剩当前有效 `CommandSqliteStore` 命中；本轮仅把 `src-tauri/src/lib.rs` 启动 panic 文案从旧 “data directory and SQLite” 改为 “data stores”。验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、残留 `rg`、`git diff --check -- src-tauri/src/lib.rs scripts/perf-collect-baseline.mjs`、`cargo check --manifest-path src-tauri/Cargo.toml --lib`。
- 2026-06-25T10:44:00+08:00：完成 TASK-003 旧 AI/Rig 依赖和 MCP feature 收缩。`src-tauri/Cargo.toml` 删除无引用 `rig-core`，production `rmcp` 只保留 `transport-streamable-http-server` / `transport-streamable-http-server-session`，client/reqwest feature 移到 dev-dependency；`cargo tree -e features -i rig-core` 与 `cargo tree -e features -i aws-lc-sys` 均返回无匹配包，`cargo tree -e features -i rmcp --edges normal,build` 只显示 server-side HTTP 来源。首次 `cargo check --lib` 被 `russh -> aws-lc-rs -> aws-lc-sys` 缺 NASM 阻断；该依赖不是 `rig-core` 删除引入，本轮把 `russh` 显式改为 `default-features = false, features = ["flate2", "ring", "rsa"]`，复用已有 rustls/ring 栈并移除 `aws-lc-sys` 构建要求。为让 rmcp dev HTTP client 在 `reqwest rustls-no-provider` 下运行，`src-tauri/tests/mcp_streamable_http_server.rs` 显式安装 `rustls::crypto::ring` provider。为满足 `clippy -D warnings`，同步做了低风险 lint 修复：`external_agent_workspace` 默认枚举 derive、Windows 测试构建下不编译非 Windows command parser、agent session target update 初始化、remote host/snippet/workflow 单元素 slice、config/agent target/SSH/SFTP 测试 lint；并给 `sftp_service/runtime_tasks.rs` 补缺失 `SftpEndpoint` import 解除当前工作区编译阻断。验证通过：`cargo check --manifest-path src-tauri/Cargo.toml --lib`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`、`cargo test --manifest-path src-tauri/Cargo.toml --test mcp_streamable_http_server`（5/5）、`cargo test --manifest-path src-tauri/Cargo.toml mcp`、`cargo test --manifest-path src-tauri/Cargo.toml --test external_agent_workspace`（19/19）、`cargo test --manifest-path src-tauri/Cargo.toml --test config_file_store --test agent_target_hydration_service --test ssh_command_service --test sftp_service`（73/73）、`rg -n "rig-core|rig_core|aws-lc-sys|aws_lc|transport-child-process|aiStreaming|perf-ai-streaming" ...` 无命中、相关文件 `git diff --check` 通过。
- 2026-06-25T10:58:00+08:00：完成 TASK-006 workspace session legacy 兼容窗口收敛。结论：直接删除旧 pane 缺 `target` fallback 会让 v1/无版本用户 workspace session 丢失 target，当前不安全；本轮改为版本化迁移出口：`WORKSPACE_SESSION_VERSION` 升到 2，`normalizeWorkspaceSessionSnapshot` 只对 version 1 或无版本旧快照调用 `migrateLegacyPaneTarget`，version 2 起缺 `target` 不再自动合成旧 target。新增测试覆盖 v1 缺 target 迁移与 v2 缺 target 不迁移。验证通过：`npm run test:frontend -- src/features/workspace/workspaceSession.test.ts src/app/useWorkspaceSessionPersistence.test.ts`（2 files，20 tests）、`npm run typecheck`、`npm run build`（通过，仅既有 chunk size warning）、真实 dev server `npm run dev -- --host 127.0.0.1 --port 5201 --strictPort` 后二次 HTTP smoke `status=200 length=644`；首次 10 秒 HTTP 请求因 Vite 首次转换超时，复查通过。已停止本轮 5201 dev server。
- 2026-06-25T11:10:00+08:00：完成 TASK-007 `TerminalSecretInputResponse` / `legacy-secret` 清理。结论：旧 response 不是前端 IPC public contract，`TerminalCreateRequest.secret_input_response` 依赖 `serde(skip)` 只作为 Rust 内部单 secret 适配；当前已有 `TerminalSecretInputPlan` 多 entry 模型，可作为唯一内部契约。本轮删除 `TerminalSecretInputResponse`、`TerminalCreateRequest.secret_input_response`、`TerminalSecretInputPlan::from(response)` 和 `legacy-secret` 转换；SSH 单跳密码、SSH command auth plan、port forward password plan 和 terminal manager 测试全部改为直接生成/消费 `TerminalSecretInputPlan`；`spawn_secret_response_thread` 和测试命名同步改为 secret input plan 口径。触碰 `lane-test-production-boundary-cleanup` 已完成路径前已读取其 done 计划和 checkpoint，本轮只做旧字段删除所需的最小兼容修改。验证通过：`cargo test --manifest-path src-tauri/Cargo.toml --test terminal_manager --test ssh_terminal_service --test port_forward_service_plan`（20 + 16 + 20 tests）、`cargo test --manifest-path src-tauri/Cargo.toml --test terminal_model --test serial_terminal_service --test telnet_terminal_service`（3 + 5 + 3 tests）、`cargo check --manifest-path src-tauri/Cargo.toml --lib`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`；`rg -n "secret_response|secret response|SecretInputResponse|secretInputResponse|legacy-secret|secret_input_response|TerminalSecretInputResponse|requires_secret_response" src-tauri/src src-tauri/tests` 无命中。
- 2026-06-25T11:25:00+08:00：完成 TASK-008 SFTP 测试边界残留复核。本任务实际已由 `lane-test-production-boundary-cleanup` done 计划完成，本轮按 cleanup lane 做复核和验收同步，不重复迁移。验证：CodeGraph 和扫描确认 `src-tauri/src/services/sftp_service` 不再挂载 `#[cfg(test)] mod tests` / `tests/**`，`rg -n "#\\[cfg\\(test\\)\\]|mod tests|src/services/sftp_service/tests|sftp_service/tests" src-tauri/src/services/sftp_service.rs src-tauri/src/services/sftp_service src-tauri/tests/sftp_service.rs src-tauri/tests/sftp_service` 无命中；`rg --files src-tauri/src/services/sftp_service src-tauri/tests/sftp_service | rg "(^|/)tests/|fake_backend|support|loopback|native_backend|native_jump_backend|transfer_queue|archive_clipboard|validation"` 只命中 `src-tauri/tests/sftp_service/**` 下的集成测试和 support。`cargo test --manifest-path src-tauri/Cargo.toml --test sftp_service` 首次被默认 target 下正在运行/锁定的 `kerminal.exe` 阻断（Windows os error 5，未进入测试执行），随后用隔离 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-cleanup` 复跑通过，45 个测试通过。
- 2026-06-25T11:40:00+08:00：完成 TASK-009 `#[doc(hidden)] rules` 二次评估，报告写入 `.updeng/docs/reports/doc-hidden-rules-evaluation-20260625.md`。本轮把已有清晰模块名的正式运行时入口改为普通 public 模块/函数：`file_dialog::path_model`、`command_suggestion_service::{classification, discovery}`、`port_forward_service::plan` 和 `port_forward_service::plan::build_forward_plan` 去掉 `doc(hidden)`；剩余 12 个 `pub mod rules` 入口全部只被 `src-tauri/tests/**` 调用，作为 test-boundary 迁移后的窄规则测试入口暂时保留，报告中逐项记录用途、保留理由和后续抽 `plan` / `policy` / `parser` 模块的建议。验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、隔离 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-cleanup cargo test --manifest-path src-tauri/Cargo.toml --test file_dialog --test command_suggestion_service --test port_forward_service_plan`（5 + 26 + 20 tests）；`rg -n "#\\[doc\\(hidden\\)\\]|pub mod rules" src-tauri/src --glob "!**/tests/**"` 剩余命中均为报告列明的 `rules` 模块。
- 2026-06-25T11:50:00+08:00：完成 TASK-010 external-agent / MCP / SSH tools 内联测试迁移复核。本任务实际已由 `lane-test-production-boundary-cleanup` done 计划迁出，本轮按 cleanup lane 复核：`src-tauri/src/services/external_agent_workspace.rs`、`src-tauri/src/services/mcp_streamable_http_server.rs`、`src-tauri/src/services/mcp_tool_executor_service.rs`、`src-tauri/src/services/mcp_tool_executor_service/ssh_tools.rs` 无 `#[cfg(test)]` / `#[cfg(not(test))]` / `mod tests` / `include!` 残留；对应测试文件位于 `src-tauri/tests/external_agent_workspace.rs`、`src-tauri/tests/mcp_streamable_http_server.rs`、`src-tauri/tests/mcp_tool_executor_service.rs`。验证通过：隔离 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-cleanup cargo test --manifest-path src-tauri/Cargo.toml --test external_agent_workspace --test mcp_streamable_http_server --test mcp_tool_executor_service`（19 + 5 + 5 tests）。
- 2026-06-25T11:55:00+08:00：完成 TASK-011 文档事实收敛。ADR-0001 顶部新增当前事实提示，明确旧 `~/.kerminal/kerminal.db`、AI Tool Registry、keychain/credential-ref 早期口径已分别被 ADR-0016/0017/0018 覆盖；ADR-0002 状态改为 superseded by ADR-0017/0018，并明确不要按旧 Tool Registry / pending-confirm 控制面新增功能；ADR-0003 在已有 superseded 状态下补充 Rig 退场、`rmcp` 仅保留 MCP tools-only server 实现依赖和旧 AI storage 不再兼容读取；`.updeng/docs/decisions/README.md` 新增当前事实入口。验证：`rg -n "AI Tool Registry|LLM provider|kerminal\\.db|settings\\.ai|custom MCP|pending/confirm" README.md .updeng/docs/decisions .updeng/docs/config`，命中均位于当前事实提示、历史 ADR 原文或 ADR-0012/0016/0017/0018 的当前边界描述。
- 2026-06-25T12:05:00+08:00：完成 TASK-012 全量验证和收口。为修复全量前端测试中的陈旧断言，仅调整测试文件：`TerminalEmptyState.test.tsx`、`TerminalWorkspace.test.tsx`、`KerminalShell.test.tsx` 的空状态文案断言恢复为当前实际文案，`ToolPanel.test.tsx` 的 Agent Launcher 断言恢复为组件实际暴露的 `Open Codex` / `Open Claude` aria-label；未改生产代码。验证通过：focused `npx vitest run ...` 子集 11 files / 152 tests；`npm run typecheck`；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`；`npm run test:frontend` 161 files / 1141 tests；`npm run build`（仅既有 chunk-size warning）；隔离 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-cleanup-full cargo test --manifest-path src-tauri/Cargo.toml`。Rust 全量第一次与 build 并行时 `terminal_manager::secret_input_plan_does_not_repeat_after_second_prompt` 因 PTY 输出等待竞态失败，随后单测 exact 复跑通过，非并行完整 `cargo test` 复跑通过。启动验证通过：`npm run dev -- --host 127.0.0.1 --port 5202 --strictPort` 后 HTTP smoke `status=200 length=644`，已停止 dev server；隔离 `USERPROFILE/HOME=%TEMP%/kerminal-tauri-dev-home-cleanup`、真实 `RUSTUP_HOME/CARGO_HOME`、隔离 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-cleanup-tauri-dev` 下复用已有 1425 Vite，`npx tauri dev --no-watch --no-dev-server-wait --config '{"build":{"beforeDevCommand":""}}'` 编译并启动 `kerminal.exe`，观察 30 秒无启动错误，停止后确认无本轮 app 进程残留。收口同步：计划已移到 `plan/done/`，`plan/INDEX.md` / `in-progress.md` / `lanes.json` 已更新，`node .codex/hooks/lane-coordination.cjs refresh C:\dev\rust\kerminal` 成功并显示只剩 `lane-agent-permission-skip-launch` active；收口后再运行 cleanup lane checkpoint 被脚本拒绝为 `Unknown active lane`，该脚本只接受 active lane，未将 lane 状态倒回。剩余外部阻塞仍为 BLK-20260625-001：用户手动删除 `C:\Users\24052\.kerminal\kerminal.db`，不要删除 `C:\Users\24052\.kerminal\data\command.sqlite`。
