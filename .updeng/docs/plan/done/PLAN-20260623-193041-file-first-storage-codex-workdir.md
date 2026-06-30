---
id: PLAN-20260623-193041-file-first-storage-codex-workdir
status: done
created_at: 2026-06-23T19:30:41+08:00
started_at: 2026-06-23T22:25:26+08:00
completed_at: 2026-06-24T15:29:30+08:00
updated_at: 2026-06-24T15:29:30+08:00
owner: ai
---

<!-- @author kongweiguang -->

# 文件优先存储与外部 Codex 工作目录协作实施计划

## 目标

把 Kerminal 的本地存储从“几乎都塞进一个 SQLite”重构为生产级混合存储：

- 不考虑旧 SQLite 兼容，不做旧数据自动迁移，不维持旧表读取路径。
- 把配置类、低频、适合 Codex/AI agent 阅读和编辑的数据改成文件存储。
- 命令历史、命令建议、缓存、反馈和统计等检索/排序/高频写数据继续放 SQLite。
- AI 相关 SQLite 表全部删除；不迁移到文件、不改成 JSONL、不做 event mirror。
- 后续 AI 协作不接 Codex app-server；用户直接用 Codex 打开 Kerminal 项目目录或配置目录，通过文件、`rg` 和项目 skills 工作。
- 增加项目级 skills 和验证脚本，让不同 AI agent 能安全定位、修改和校验配置内容。

## 非目标

- 不做旧 SQLite 到新文件结构的自动兼容迁移。
- 不把命令历史、命令建议缓存和反馈强行文件化。
- 不让前端直接读写任意配置文件；文件 IO 仍由 Rust command/service 管控。
- 不把密码、API key、私钥和 token 放进普通配置文件里让 agent 默认扫描；当前产品允许明文查看的 secret 也要拆到 `secrets/` scope。
- 不实现 Codex app-server、ACP adapter、内置 AI sidecar 或新的 Kerminal AI runtime。
- 不保留旧 AI conversation/message/provider/pending invocation 的兼容读取路径；如要导出旧 AI 数据，另开一次性导出计划。

## 当前 SQLite 表盘点

当前 schema 来源：`src-tauri/src/storage/migrations.rs` 和 `src-tauri/src/storage/migrations_ai_conversations.rs`，`CURRENT_SCHEMA_VERSION = 30`。

| 表 | 当前用途 | 建议归属 | 目标承载 |
| --- | --- | --- | --- |
| `kerminal_metadata` | SQLite schema/key-value 元数据 | 移出 SQLite | `state/storage-manifest.toml`；命令 DB 自己保留 `PRAGMA user_version` |
| `app_settings` | 应用设置 JSON value | 文件 | `config/settings.toml` |
| `terminal_profiles` | 本地 shell/profile/cwd/env | 文件 | `config/profiles/*.toml` |
| `remote_host_groups` | 主机分组、排序 | 文件 | `config/hosts/groups.toml` |
| `remote_hosts` | Local/SSH/Telnet/Serial/Container/RDP 等主机配置 | 文件 + secrets | `config/hosts/<id>.toml`，`secrets/hosts/<id>.toml` |
| `llm_providers` | 旧自研 AI provider/API key 引用 | 删除 | 无目标承载 |
| `ai_tool_audits` | 旧 AI 工具审批与结果审计 | 删除 | 无目标承载 |
| `command_snippets` | 命令片段配置 | 文件 | `config/snippets/*.toml` |
| `command_history` | 命令历史、最近命令、建议召回 | SQLite | `data/command.sqlite` |
| `command_workflows` | 命令 workflow 配置 | 文件 | `config/workflows/<id>.toml` |
| `command_workflow_steps` | workflow steps | 文件 | 合并进 `config/workflows/<id>.toml` |
| `command_suggestion_provider_cache` | remote path/command/git/history cache，TTL | SQLite | `data/command.sqlite` |
| `command_suggestion_feedback` | 建议接受/忽略反馈，排序学习 | SQLite | `data/command.sqlite` |
| `command_suggestion_telemetry` | provider 统计计数 | SQLite | `data/command.sqlite` |
| `command_suggestion_audit_events` | 建议刷新/反馈审计 | SQLite | `data/command.sqlite`，按保留期清理 |
| `ai_conversations` | 旧 AI conversation | 删除 | 无目标承载 |
| `ai_messages` | 旧 AI message | 删除 | 无目标承载 |
| `ai_attachments` | 旧 AI 附件 metadata | 删除 | 无目标承载 |
| `ai_conversation_slots` | 旧 AI panel slot | 删除 | 无目标承载 |
| `ai_context_snapshots` | 旧 terminal/app context snapshot | 删除 | 无目标承载 |
| `ai_tool_pending_invocations` | 旧 pending approval | 删除 | 无目标承载 |
| `local_file_operation_audits` | 本地文件删除审计 | JSONL | `logs/local-file-operations/YYYY-MM-DD.jsonl` |
| `port_forward_sessions` | 端口转发运行态摘要 | 文件 | `state/port-forwards/sessions.json` |

## 推荐文件布局

文件根目录使用 Tauri 应用目录，不硬编码用户路径：

```text
<app_config_dir>/kerminal/
  settings.toml
  profiles/
    default.toml
  hosts/
    groups.toml
    local.toml
    prod-web-01.toml
  snippets/
    restart-service.toml
  workflows/
    deploy-check.toml

<app_data_dir>/kerminal/
  storage-manifest.toml
  command.sqlite
  port-forwards/
    sessions.json

<app_data_dir>/kerminal/secrets/
  hosts/
    prod-web-01.toml

<app_log_dir>/kerminal/
  local-file-operations/
    2026-06-23.jsonl
```

说明：

- TOML 用于 agent 和人工会编辑的配置：注释友好、`rg` 友好、结构比 JSON 更适合配置。
- JSON 用于运行态快照：不鼓励人工编辑，适合前端状态恢复。
- JSONL 用于非 AI 审计：追加写、可流式读取、可用 `rg` 和 jq 类工具排查。
- SQLite 只保留为 `command.sqlite`，不要再作为所有模块的默认持久化入口。
- 不创建 `codex-agent.toml`、`state/codex/`、AI event mirror 或 AI audit log 目录。

## TOML 方案判断

| 格式 | 适合 | 不适合 | 本计划结论 |
| --- | --- | --- | --- |
| TOML | 设置、主机、profile、snippet、workflow | 大量事件、日志、嵌套动态 transcript | 配置首选 |
| JSON | UI 快照、机器生成状态、schema fixture | 人工长期维护和注释 | 运行态快照 |
| JSONL | 非 AI 审计、诊断事件 | 需要随机更新的配置 | 本地文件审计等追加日志 |
| YAML | 人工配置 | 隐式类型、缩进歧义、安全坑 | 不采用 |
| SQLite | 高基数查询、排序、统计、TTL cache | AI 手改配置和跨 agent 审阅 | 仅命令检索域保留 |

## 性能影响判断

预期性能不会成为问题，前提是按生产方案实现，而不是每次 UI 操作都全盘读写：

- 配置文件量很小，启动读取几十到几百个 TOML 文件可接受。
- 主机、profile、snippet、workflow 读入后应在 Rust 内存中形成 typed cache，文件只作为权威持久化。
- 单实体一个文件可以把写放大控制在 O(单个实体)，避免一个大 `config.toml` 每次都重写。
- `rg` 检索文本配置会比 SQLite 手写查询更适合 Codex 和人工排查。
- 命令历史和建议缓存如果文件化，会在分页、排序、去重、TTL 清理、反馈统计上变差，因此保留 SQLite。
- 审计改 JSONL 后，写入是 append-only，性能和排障都好；需要 UI 聚合时按日期分片和保留期读取，不做无限扫描。

生产约束：

- 启动时只做 schema 校验和索引构建，不做重型 `rg`。
- 文件监听只用于外部编辑后的 reload，必须 debounce。
- 写入必须 temp file + fsync + atomic rename；多文件 change set 必须先写备份和 manifest。
- Windows 上要处理 rename/replace、杀毒占用和文件锁失败。

## 存储架构

### Rust 模块边界

| 模块 | 责任 |
| --- | --- |
| `storage::file_store` | 根目录解析、锁、原子写、备份、schema version、typed load/save |
| `storage::config_store` | settings/profile/host/snippet/workflow 的 typed repository |
| `storage::command_store` | 只包含 command history/suggestion SQLite |
| `storage::audit_log_store` | 非 AI JSONL append、按日期读取、保留期清理 |
| `storage::storage_manifest` | 文件 schema 版本、最近备份、repair state |

`AppState` 不再暴露一个泛用 `SqliteStore` 给所有 service，而是按职责注入：

- `settings()` -> file config repository。
- `profiles()` -> file config repository。
- `remote_hosts()` -> file config repository。
- `command_history()` / `command_suggestions()` -> command SQLite store。
- AI 相关 state/service 不作为本计划目标保留。

### 文件写入规则

- 所有写入先在内存中验证 typed model。
- 单文件写入：
  1. 读取当前文件 metadata。
  2. 写 `<name>.tmp-<pid>-<uuid>`。
  3. flush/fsync 文件。
  4. 原子 replace。
  5. fsync 父目录。
- 多文件写入：
  1. 创建 change set id。
  2. 备份被修改文件到 `backups/<change-set-id>/`。
  3. 全部 temp 写入成功后按确定顺序 replace。
  4. 更新 `storage-manifest.toml`。
  5. 任一失败进入 repair state，不继续局部加载成成功。
- 外部编辑 reload：
  - debounce 300-1000ms。
  - parse 失败时保留内存旧值并报告 diagnostics。
  - 不自动覆盖用户刚编辑的坏文件。

### Schema 策略

- 每类 TOML 顶层带 `schema_version = 1`。
- 每类文件都有 Rust typed model + validation。
- 对 agent 友好的 schema 文档放在 `.updeng/docs/config/` 或 `.codex/skills/.../references/`。
- 不兼容升级可以直接提升 schema version，不做旧 SQLite 兼容；文件 schema 自身仍需要从 v1 到 v2 的升级函数。

## 外部 Codex 协作边界

- Kerminal 不启动、不嵌入、不连接 Codex app-server。
- Kerminal 不保存 Codex thread、turn、item、approval 或 event mirror。
- Codex 作为外部开发/配置 agent 使用：打开 Kerminal 项目目录或 Kerminal 配置目录，按 `.codex/skills` 和配置 schema 工作。
- 配置目录应可通过文档、命令或 UI 复制路径打开，方便用户把该目录作为 Codex 工作目录。
- 项目 skills 只指导 agent 操作文件配置、运行 validator 和避免 secrets，不提供内置 AI runtime。

## Agent Skills 设计

新增项目级 skill 时遵循 `.codex/skills` 规范，不写泛泛提示词。

建议新增：

| Skill | 触发 | 职责 |
| --- | --- | --- |
| `bwy-kerminal-config-files` | 修改 Kerminal 主机、profile、settings、snippet、workflow | 定位配置根目录、用 `rg` 搜索、编辑 TOML、禁止默认改 secrets、运行 validator |
| `bwy-kerminal-storage-migration` | 实现存储改造切片 | 按表归属推进、保护 command SQLite、检查所有 AI 表删除边界 |

配套脚本：

- `.codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs`
- `.codex/skills/bwy-kerminal-storage-migration/scripts/storage-inventory.mjs`

Skill 规则：

- 默认只允许编辑 `config/` 下 TOML，不编辑 `secrets/`。
- 修改前先 `rg` 定位 id/name/tag，不扫全盘。
- 修改后必须运行 validator。
- 不允许 agent 宽泛格式化所有 TOML。
- 对明文 secret 的读取和修改必须有用户显式要求。
- 不建议 agent 尝试调用 Kerminal 内置 AI API，因为本计划将删除 AI 存储主链路。

## 分阶段实施

### P0：冻结目标边界和测试基线

目标：

- 把当前 SQLite 表、调用方和归属固化为可执行清单。
- 为“不兼容改造”建立干净基线，避免边做边猜。

任务：

- 生成当前 storage inventory，列出每张表、Rust storage module、service、command、frontend API。
- 把 ADR-0016 与本计划作为实施入口。
- 为 fresh install 建立空数据目录测试，不读取旧 DB。
- 确定新存储根目录、备份目录和 secrets scope。
- 明确 AI 表删除清单，不给 AI 表分配新文件目标。

验收：

- storage inventory 文档可复核。
- `cargo test` 中新增 fresh storage bootstrap 测试。
- 没有任何实现声称兼容旧 SQLite 数据。
- 没有任何 P0 设计继续引用 app-server。

### P1：FileStore 基础设施

目标：

- 先做可靠文件存储底座，再迁业务表。

任务：

- 新增 `FileStore` / `FileConfigRepository`。
- 引入 TOML 读写 crate，优先考虑 `toml`；如需要保留注释和局部编辑，再评估 `toml_edit`。
- 实现 atomic write、backup、manifest、file lock、schema version、parse diagnostics。
- 实现非 AI JSONL audit writer。
- 增加 Windows/macOS/Linux 路径和权限处理。

验收：

- 单文件写、并发写、坏 TOML、备份恢复、manifest repair 测试通过。
- Windows rename/locked file 场景有错误映射。
- 不接业务 service。

### P2：Settings/Profile 文件化

目标：

- 从低风险配置开始替换 SQLite。

任务：

- `app_settings` -> `settings.toml`。
- `terminal_profiles` -> `profiles/*.toml`。
- settings/profile service 改依赖 file repository。
- 前端 API 契约保持用户行为不变，但不保留旧 DB 兼容读取。

验收：

- settings/profile 相关 Rust 测试通过。
- 新文件可用 `rg "theme|font|shell"` 检索。
- 应用 fresh install 能生成默认 settings/profile。

### P3：Remote Hosts 文件化和 secrets 拆分

目标：

- 主机配置变成 Codex 可审阅文件，同时把 secret scope 分开。

任务：

- `remote_host_groups` -> `hosts/groups.toml`。
- `remote_hosts` -> `hosts/<id>.toml`。
- `credential_secret` -> `secrets/hosts/<id>.toml`。
- remote host service 改成 file repository。
- Docker/Telnet/Serial/RDP/SSH 的 target model 全部读新 repository。
- agent skill 默认不读取 `secrets/`。

验收：

- 主机增删改查、排序、分组、生产标记、jump hosts、ssh options 测试通过。
- SSH/SFTP/port forward/docker/server info 读取主机配置行为不变。
- `rg "prod|jump|serial|telnet" <config>/hosts` 能定位配置。
- secrets 文件权限或 Windows 等价保护有测试/检查。

### P4：Snippets/Workflows 文件化

目标：

- 把最适合 `rg` 和 agent 批量维护的命令资产改成文件。

任务：

- `command_snippets` -> `snippets/*.toml`。
- `command_workflows` + `command_workflow_steps` -> `workflows/<id>.toml`。
- workflow steps 与 workflow 放在同一个文件，避免跨表 join。
- 增加 TOML schema 文档和示例。

验收：

- snippet/workflow CRUD 和执行测试通过。
- `rg "systemctl|docker|kubectl" <config>/snippets <config>/workflows` 可直接检索。
- agent skill 能修改一个 workflow 并通过 validator。

### P5：命令 SQLite 收敛

目标：

- 保留 SQLite，但把它收窄成 command domain 的专用 DB。

保留表：

- `command_history`
- `command_suggestion_provider_cache`
- `command_suggestion_feedback`
- `command_suggestion_telemetry`
- `command_suggestion_audit_events`

任务：

- 新建 `CommandSqliteStore`，不要暴露泛用 `SqliteStore`。
- SQLite 文件改名/定位为 `data/command.sqlite`。
- 重建 migration，只包含命令域 schema。
- 评估 FTS5：如果历史搜索需要 substring/fuzzy，再新增 `command_history_fts`，否则先保留索引查询。
- 清理 command suggestion 对 remote host 的 FK 依赖，改存 host id 字符串和失效容错。
- 如 command history/source 枚举仍包含 `ai`，评估是否保留为历史值；fresh 不再由内置 AI 写入。

验收：

- command history record/list/search 测试通过。
- suggestion cache TTL、feedback ranking、telemetry update 测试通过。
- 10k/100k command history 查询有基准记录。
- 非命令模块不能直接依赖 command SQLite。

### P6：AI 存储和内置 AI 主链路删除

目标：

- 所有 AI 相关 SQLite 表从 fresh schema 中消失。
- 不建立 app-server mirror，不把 AI 数据迁到文件。

删除表和主链路：

- `llm_providers`
- `ai_tool_audits`
- `ai_conversations`
- `ai_messages`
- `ai_attachments`
- `ai_conversation_slots`
- `ai_context_snapshots`
- `ai_tool_pending_invocations`

任务：

- 删除 AI storage modules 和 migrations 中 AI 表创建逻辑。
- 删除或退场旧 AI provider settings、conversation persistence、pending invocation storage、AI tool audit storage。
- 前端旧 AI 面板如果仍存在，应改为非存储型入口或移除；不能继续调用已删除的 AI persistence API。
- README/文档说明：AI 协作用外部 Codex 打开项目或配置目录，不走 Kerminal 内置 AI runtime。

验收：

- `rg "CREATE TABLE IF NOT EXISTS ai_|CREATE TABLE IF NOT EXISTS llm_providers" src-tauri/src/storage` 无 fresh schema 命中。
- `rg "ai_conversations|ai_messages|ai_tool_pending_invocations|llm_providers" src-tauri/src/storage src-tauri/src/services src-tauri/src/commands src` 无主链路引用，测试 fixture 例外需说明。
- fresh install 不创建任何 AI 表。
- 不存在 app-server bridge、event mirror 或 `state/codex` 新目录。

### P7：非 AI 审计和运行态文件化

目标：

- 把不需要强查询的非 AI 审计和运行态从 SQLite 拆出。

任务：

- `local_file_operation_audits` -> `logs/local-file-operations/YYYY-MM-DD.jsonl`。
- `port_forward_sessions` -> `state/port-forwards/sessions.json`。
- 增加日志保留期、压缩/清理策略。
- UI 最近记录读取按日期分片，不做无限全量 scan。

验收：

- 本地文件删除审计、端口转发列表恢复测试通过。
- JSONL 坏行不会导致整个日志不可读。
- 端口转发运行态写入不会阻塞转发进程。

### P8：项目 skills 和验证脚本

目标：

- 让不同 AI agent 能按固定规则操作配置，不靠对话记忆。

任务：

- 新增 `bwy-kerminal-config-files` skill。
- 新增 validator 脚本：
  - 检查 TOML schema version。
  - 检查 id/file name 一致。
  - 检查 host group 引用。
  - 检查 workflow step 顺序。
  - 检查 secrets 不被普通 config 引用成明文字段。
- 增加 `agents/openai.yaml`。
- 在 README 或 `.updeng/docs/config/` 写配置示例、配置目录定位方式和“用 Codex 打开配置目录”的操作口径。

验收：

- `node .codex/skills/bwy-project-skill-maintenance/scripts/validate_skills.js --run-tests` 通过。
- `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --root <fixture>` 通过。
- skill 明确禁止默认编辑 `secrets/`。

### P9：清理旧 SQLite schema 和启动验证

目标：

- 完成不兼容改造收口，fresh install 只创建新文件结构和 command SQLite。

任务：

- 删除或替换旧 migrations 中非命令表。
- `SqliteStore` 改名或拆分，防止新业务继续误用。
- 更新 README 本地边界。
- 更新测试 fixture 和 mock API。
- 增加启动 repair diagnostics。

验收：

- `rg "CREATE TABLE IF NOT EXISTS (app_settings|remote_hosts|ai_conversations|llm_providers)" src-tauri/src/storage` 无旧主链路命中。
- `cargo fmt --check` 通过。
- 相关 Rust storage/service tests 通过。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run tauri:dev` 真实启动或明确记录无法运行原因。

## 执行任务清单

- [x] TASK-001：生成 storage inventory 和调用方矩阵。
- [x] TASK-002：实现 FileStore 基础设施与测试。
- [x] TASK-003：迁移 settings/profile 到 TOML。
- [x] TASK-004：迁移 remote hosts/groups 到 TOML，并拆分 secrets。
- [x] TASK-005：迁移 snippets/workflows 到 TOML。
- [x] TASK-006：收敛 command SQLite schema 和 store。
- [x] TASK-007：删除所有 AI SQLite 表和内置 AI persistence 主链路。
- [x] TASK-008：迁移非 AI local-file/port-forward 审计和运行态到 JSONL/JSON。
- [x] TASK-009：新增配置操作 skill、schema 文档和 validator。
- [x] TASK-010：删除旧 migrations/commands/services 的 SQLite 依赖和死代码。
- [x] TASK-011：全量启动、构建、Tauri smoke、文档收口。

## 并行和 lane 策略

- 本计划当前是 `active`，lane id 为 `lane-file-first-storage-codex-workdir`。
- 当前因历史脏工作区和并行实现成本，继续共用 `C:/dev/rust/kerminal` 工作区；每轮通过 Round Log 和 `coordination/lanes.json` 暴露写入范围。
- 后续新并行任务仍优先使用独立 worktree/branch。
- 高风险共享路径预计包括：
  - `src-tauri/src/state.rs`
  - `src-tauri/src/storage/**`
  - `src-tauri/src/services/**`
  - `src-tauri/src/commands/**`
  - `src/lib/*Api.ts`
  - `.updeng/docs/plan/INDEX.md`
  - `.updeng/docs/in-progress.md`
  - `.updeng/docs/coordination/lanes.json`
- 写共享路径前必须刷新 coordination status，读取对方 active plan 和 diff，只做最小兼容修改。

## 验证矩阵

| 阶段 | 自动验证 | 手工/运行验证 |
| --- | --- | --- |
| P1 FileStore | Rust 单测、坏文件/并发/备份测试 | 手动编辑 TOML 后 reload |
| P2-P4 配置文件化 | service tests、frontend API tests | 设置、主机、profile、snippet、workflow UI smoke |
| P5 Command SQLite | command history/suggestion tests、查询基准 | 真实终端输入历史召回 |
| P6 AI 删除 | schema grep、dead-code grep、Rust/TS compile | 确认没有内置 AI persistence UI 阻断启动 |
| P7 JSONL audit | JSONL append/read/bad-line tests | 文件删除、端口转发记录检查 |
| P8 skills | skill validator、config validator | Codex 按 skill 修改 fixture 配置 |
| P9 收口 | `cargo fmt --check`、Rust tests、`npm run typecheck`、`npm run build` | `npm run tauri:dev` 真实启动 |

## 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
| --- | --- | --- | --- |
| 文件写入失败或半写 | 配置损坏 | temp + fsync + replace + backup + manifest | 从备份恢复，或回滚该切片 |
| agent 误改 secrets | 凭据泄露或连接失败 | secrets scope 拆分，skill 默认禁止，validator 检查 | 恢复 secrets 备份，审计本次修改 |
| 文件化主机后跨服务读取不一致 | SSH/SFTP/Docker 行为回归 | 单一 repository cache，所有 service 注入同一接口 | 回滚 remote host 切片 |
| 命令 SQLite 被过度收窄 | 命令建议性能下降 | P5 保留完整 command suggestion 域并做基准 | 恢复该表/索引到 command DB |
| 删除 AI 表导致旧 UI/API 悬空 | 启动失败或白屏 | P6 同步删除/退场旧 UI/API，编译和启动验证 | 回滚 P6 或隐藏入口 |
| 不兼容改造导致用户旧数据不可见 | 用户数据丢失感 | 按用户要求不兼容；实现前可提示手工备份旧 DB，但不自动迁移 | 回滚应用版本或提供单独导出工具 |
| 外部 Codex 找不到配置目录 | AI 无法操作配置 | README/skill/UI 提供复制配置目录路径和 validator | 文档修正，无需恢复内置 AI |
| 多文件 change set 部分成功 | 配置关系不一致 | manifest repair state 和启动校验 | 恢复 change set 备份 |

## 完成标准

- Fresh install 不再创建非命令域 SQLite 表。
- `config/` 下 TOML 能覆盖 settings/profile/hosts/snippets/workflows。
- `data/command.sqlite` 只承载命令历史和命令建议域。
- 所有 AI 相关 SQLite 表不存在，不迁移到文件，不做 app-server mirror。
- 旧 AI storage/API 主状态不再被 command/service/frontend 使用。
- 配置操作 skill 和 validator 可供外部 Codex 执行。
- README 或 `.updeng/docs/config/` 有新存储布局、配置目录定位和外部 Codex 工作目录说明。
- 真实启动 smoke 通过，或明确记录无法运行原因和剩余风险。

## Round Log

### 2026-06-23 Round 1：计划写入

状态：完成存储表盘点、ADR 和实施计划写入；当前不开始实现。

证据：

- 已读取 `AGENTS.md`、`README.md`、`.updeng/docs/README.md`、`.updeng/docs/in-progress.md`、`.updeng/docs/BLOCKERS.md`、`.updeng/docs/plan/INDEX.md`、`.updeng/docs/coordination/lanes.json`。
- 已用 CodeGraph 和 `rg` 核对 `src-tauri/src/storage/migrations.rs`、`migrations_ai_conversations.rs`，确认 schema version 30 和现有表。
- 已按当时理解写成 Codex app-server 方案；该方向已在 Round 2 按用户新指令修正。

本轮修改：

- 曾短暂写入 app-server 方向的 ADR/计划草案；该草案已在 Round 2 删除并替换为外部 Codex 工作目录方案。
- 更新 `.updeng/docs/plan/INDEX.md` 的最近整理条目。

验证：

- 文档为人工计划，无代码实现；执行了上下文读取、schema 盘点和 lane status refresh。
- 后续实现前必须登记 active lane 并从 TASK-001 开始。

### 2026-06-23 Round 2：按用户指令移除 app-server 方向

状态：完成文档方向修正；当前不开始实现。

输入：

- 用户明确要求：AI 相关表全部去掉；后续不用 app-server；直接使用 Codex 当项目打开工作目录。

本轮修改：

- ADR-0016 改为“文件优先存储与外部 Codex 工作目录协作边界”。
- 计划文件改名为 `.updeng/docs/plan/next/PLAN-20260623-193041-file-first-storage-codex-workdir.md`。
- 所有 AI 表目标统一为删除，无文件、JSONL、event mirror 或 app-server 目标。
- 删除过时 app-server ADR/计划草案，以及 `codex-agent.toml`、`state/codex`、bridge/event store 相关任务。
- 新增外部 Codex 工作目录协作边界：Codex 打开项目目录或配置目录，通过 TOML、`rg`、skills 和 validator 操作配置。
- 更新 `.updeng/docs/plan/INDEX.md` 摘要。

验证：

- 本轮只改文档；执行 `git diff --check` 检查文档 whitespace。
- 未运行构建或测试，因为没有代码实现变更。

### 2026-06-23 Round 3：最终一致性核对

状态：完成最终文档核对；当前不开始实现。

本轮修改：

- 收紧 Round 1 历史记录，明确 app-server 方向只是过时草案且已删除。
- 保持 AI 表删除口径：不迁移到文件、不转 JSONL、不做 event mirror、不接 app-server。

验证：

- CodeGraph 读取 `src-tauri/src/storage/migrations.rs` 和 `src-tauri/src/storage/migrations_ai_conversations.rs`，核对 `CURRENT_SCHEMA_VERSION = 30` 与现有表清单。
- `rg "CREATE TABLE IF NOT EXISTS|CREATE TABLE" src-tauri/src/storage -n` 核对 SQLite 表来源。
- `git diff --check -- .updeng/docs/decisions/ADR-0016-file-first-storage-and-external-codex-workdir.md .updeng/docs/plan/next/PLAN-20260623-193041-file-first-storage-codex-workdir.md .updeng/docs/plan/INDEX.md` 无输出。
- `rg -n "[ \t]+$" ...` 未发现目标文档 trailing whitespace。
- `Test-Path` 确认过时 app-server ADR/计划文件不存在。

### 2026-06-23 Round 4：storage worker 低冲突基础切片

状态：完成本 worker 低冲突切片；未提交。

本轮修改：

- 新增 `.updeng/docs/reports/storage-inventory-20260623.md`，基于 `migrations.rs` 与 `migrations_ai_conversations.rs` 盘点表、当前模块/调用方、目标归属和第一批改造顺序。
- 新增 `src-tauri/src/storage/file_store.rs`：root path、relative path guard、temp + rename 原子写、typed TOML codec trait、parse diagnostics 和单测。
- 新增 `src-tauri/src/storage/storage_manifest.rs`：manifest schema version、change set、repair state skeleton。
- 新增 `src-tauri/src/storage/audit_log_store.rs`：非 AI JSONL append/read，读坏行跳过并记录 diagnostics。
- `src-tauri/src/storage/mod.rs` 只追加 `pub mod audit_log_store/file_store/storage_manifest`。
- 新增 `.codex/skills/bwy-kerminal-config-files/**`：配置操作 skill、OpenAI metadata 和 `validate-kerminal-config.mjs` validator 骨架。

本轮约束同步：

- 用户补充外部 agent workspace 初始化口径：安装后首次运行/程序初始化只默认生成 Codex 和 Claude 相关 `AGENTS.md`、`CLAUDE.md`、`.codex/config.toml`、`.mcp.json`。
- 不初始化 Custom Agent 配置。
- Tauri resource 只作为模板来源候选；真实用户目录写入由程序 bootstrap/repair 逻辑负责。
- 已同步到 `bwy-kerminal-config-files` skill 和 storage inventory guardrails。

验证：

- `cargo fmt --check --manifest-path src-tauri/Cargo.toml` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::file_store` 通过，2 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::audit_log_store` 通过，1 test。
- `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --self-test` 通过。
- `node .codex/skills/bwy-project-skill-maintenance/scripts/validate_skills.js --run-tests` 通过。

验证备注：

- 曾并行启动两个 `cargo test` 过滤命令，Windows/rustc 一度报 `os error 1455` 页面文件不足和 crate metadata mmap 失败；随后改为串行 `--lib` 定向测试，目标新增 storage 模块测试通过。
- 未运行 `npm run build` 或 `npm run tauri:dev`，本轮没有前端/UI/Tauri 窗口接线改动，且用户指定为 storage/file workspace 低冲突切片。

### 2026-06-23 Round 5：leader 集成复验与外部 agent 初始化口径同步

状态：未新增 storage 代码；复核 Round 4 产物并同步用户关于默认初始化的最新约束。

同步结论：

- 默认程序 bootstrap/repair 只初始化 Codex 和 Claude 相关文件：`AGENTS.md`、`CLAUDE.md`、`.codex/config.toml`、`.mcp.json`。
- 不初始化其它 agent，也不为 custom agent 写默认配置文件。
- Tauri resource 可作为模板来源候选，但真实用户目录写入由程序逻辑完成，便于首次运行、端口变化和 repair。

验证：

- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::file_store` 通过，2 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::audit_log_store` 通过，1 test。
- `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --self-test` 通过。
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml` 通过。
- 本轮 `npm run build` 作为 Agent Launcher/Tauri command 集成门禁通过；storage 代码本身未新增前端接线。

### 2026-06-24 Round 6：settings/profile TOML repository 前置切片

状态：完成 settings/profile 文件化的独立 repository 前置实现；尚未把生产 `SettingsService` / `ProfileService` 从 SQLite 切到 TOML，因此 `TASK-003` 不标记完成。

本轮修改：

- `src-tauri/Cargo.toml` 增加 `toml = "0.9"` 依赖，用于 typed TOML encode/decode。
- `src-tauri/src/storage/file_store.rs` 增加 `FileStoreError::TomlEncode`。
- 新增 `src-tauri/src/storage/config_file_store.rs`：`ConfigFileStore` 支持 `settings.toml` 和 `profiles/<id>.toml` 读写，顶层 `schema_version = 1`，复用 runtime `AppSettings` / `TerminalProfile` 模型，并拒绝 path-like profile id。
- `src-tauri/src/storage/mod.rs` 注册 `config_file_store` 模块。

验证：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::config_file_store` 通过，4 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::file_store` 通过，2 tests。
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- `git diff --check -- src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/storage/file_store.rs src-tauri/src/storage/config_file_store.rs src-tauri/src/storage/mod.rs` 无 whitespace error；仅当前工作区 LF/CRLF warning。

剩余：

- `SettingsService` / `ProfileService` 仍未切换到 `ConfigFileStore`。
- FileStore 的 file lock 和多文件 change set 仍未完成，`TASK-002` 暂不标记完成。

### 2026-06-24 Round 7：FileStore 备份与 manifest repair 基础

状态：完成 FileStore 写前备份和 manifest repair 状态流转的最小底座；尚未接入生产 settings/profile 写路径，也未实现 file lock 或多文件 change-set transaction。

本轮修改：

- `src-tauri/src/storage/file_store.rs` 增加 `backup_existing(relative_path, backup_relative_root)`：
  - 复用相对路径越界保护。
  - 缺失文件返回 `None`，已有文件复制到 `backups/<change-set>/<relative-path>`。
  - 目录 source 会返回 `InvalidPath`。
- `src-tauri/src/storage/storage_manifest.rs` 增加 `set_backup_dir`、`mark_repaired`，并让 `mark_failed` 清空 active change set、进入 repair state。
- 增加 FileStore 备份保留旧内容、缺失文件 no-op，以及 manifest backup/failure/repair 生命周期测试。

验证：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::file_store` 通过，4 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::storage_manifest` 通过，2 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::config_file_store` 通过，4 tests。
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。

剩余：

- File lock、manifest 持久化 TOML、跨多文件 change set 写入和 repair restore 仍未完成。
- `SettingsService` / `ProfileService` 仍未切换到 `ConfigFileStore`。

### 2026-06-24 Round 8：FileStore change set、manifest 落盘与 repair restore 闭环

状态：完成 `TASK-002`。FileStore 基础设施现在覆盖 file lock、`storage-manifest.toml` TOML 持久化、多文件 change set 和从 backup repair restore；仍不接入生产 `SettingsService` / `ProfileService`，后续从 `TASK-003` 单独切换 settings/profile。

本轮修改：

- `src-tauri/src/storage/file_store.rs` 增加 `.storage.lock` 锁文件守卫，第二个 holder 会得到 `FileStoreError::Locked`，锁释放后可重新获取。
- `src-tauri/src/storage/file_store.rs` 增加 `read_storage_manifest` / `write_storage_manifest`，固定读写 `storage-manifest.toml`；缺失 manifest 时返回 `StorageManifest::new()`，坏 schema 走 TOML diagnostics。
- `src-tauri/src/storage/file_store.rs` 增加 `FileStoreChange` 和 `apply_change_set`：先持锁、加载 manifest、记录 started change set、备份 touched files，再按顺序 atomic write，成功后标记 applied，失败后标记 failed 并进入 repair state。
- `src-tauri/src/storage/file_store.rs` 增加 `restore_change_set`：按 manifest `backup_dir + touched_files` 从备份恢复；原先不存在的文件没有 backup 时会移除目标文件，成功后标记 repaired。
- `src-tauri/src/storage/storage_manifest.rs` 增加 `change_set` 查询方法，方便执行器和测试读取单个 change set 状态。
- 为保持全仓 `cargo fmt --check` 绿色，`cargo fmt` 同步格式化了并行工作区里已有的 `src-tauri/src/app_tray.rs` close-to-tray 改动；本轮没有改变该功能行为。

验证：

- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::file_store` 通过，9 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::storage_manifest` 通过，2 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::config_file_store` 通过，4 tests。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- `git diff --check -- src-tauri/src/storage/file_store.rs src-tauri/src/storage/storage_manifest.rs src-tauri/src/app_tray.rs` 无 whitespace error。

剩余：

- `SettingsService` / `ProfileService` 仍未切换到 `ConfigFileStore`，进入 `TASK-003`。
- Host、snippet、workflow 文件化仍未开始。
- `npm run tauri:dev` 仍受本机 1425 端口 PID `105544` 监听占用阻断，本轮未杀用户进程。

### 2026-06-24 Round 9：SettingsService / ProfileService 切到 TOML

状态：完成 `TASK-003`。`SettingsService` 和 `ProfileService` 已从 SQLite 主路径切换到 `ConfigFileStore`，Tauri settings/profile commands 和 MCP settings/profile 工具继续调用同一 service，前端 API 契约不变。启动初始化会 seed `settings.toml` 和 `profiles/*.toml`；旧 SQLite `app_settings` 会被忽略，不做兼容读取。

本轮修改：

- `src-tauri/src/services/settings_service.rs` 持有 `ConfigFileStore`，`load_settings()` / `update_settings()` 直接读写 `settings.toml`，并新增 `ensure_seed_settings()`。
- `src-tauri/src/services/profile_service.rs` 持有 `ConfigFileStore`，profile list/create/update/delete 读写 `profiles/*.toml`，默认 profile seed 使用 recoverable profile change set。
- `src-tauri/src/state.rs` 创建一个共享 `ConfigFileStore::new(paths.root.clone())`，注入 settings/profile service，并在初始化时 seed 默认 settings/profile。
- `src-tauri/src/commands/settings.rs`、`src-tauri/src/commands/profile.rs` 不再把 `state.storage()` 传入 settings/profile service。
- `src-tauri/src/services/mcp_tool_invocation_service/settings_tools.rs` 和 `profile_remote_tools.rs` 通过新的 service 签名间接使用 TOML。
- `src-tauri/tests/settings_service.rs` 和 `src-tauri/tests/profile_service.rs` 改为文件优先断言，覆盖 TOML 落盘、重启读取、忽略 legacy SQLite settings 和 profile 默认项维护。
- `src-tauri/src/storage/profiles.rs` 仍保留部分旧 SQLite helper；当前扫描只显示它们自身和同名内部函数命中，已作为 `TASK-010` 旧 schema/死代码清理范围保留，不混入本切片。

验证：

- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test settings_service` 通过，5 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test profile_service` 通过，4 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test mcp_tool_invocation_service settings_terminal_audit` 通过，14 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test mcp_tool_invocation_service local_resources` 通过，18 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test mcp_tool_invocation_service local_management_gateway` 通过，1 test。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --lib storage::file_store` 通过，9 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --lib storage::config_file_store` 通过，4 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --lib storage::storage_manifest` 通过，2 tests。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- `npm test -- --run src/features/terminal/terminalContextMenuModel.test.ts src/features/tool-panel/agent-launcher/agentLauncherModel.test.ts src/features/tool-panel/AgentLauncherToolContent.test.tsx` 通过，3 files / 19 tests，用于复核右栏 Agent Launcher 最新交互未回归。
- `npm run typecheck` 通过。
- `npm run build` 通过；保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5203 --strictPort` 启动成功，HTTP smoke 返回 200。
- `rg` 扫描确认 settings/profile service/commands/MCP settings/profile tools 不再要求传入 `SqliteStore`；旧 `list_terminal_profiles` 等 SQLite helper 只有 `src-tauri/src/storage/profiles.rs` 自身命中。
- `rg` 扫描旧 AI/provider/custom MCP/custom skills 用户可见文案后，只剩 `SettingsToolContent.controls.test.tsx` 中断言 `AI 与模型` 不可见的负向测试；原生菜单残留 `打开 Kerminal Agent` 已改为 `打开 Agent Launcher`。
- `git diff --check` 无 whitespace error；仅当前工作区 LF/CRLF warning。

剩余：

- `TASK-004` 继续迁移 remote hosts/groups 到 TOML 并拆分 secrets。
- `TASK-005` 继续迁移 snippets/workflows。
- `TASK-006` 继续收敛 command SQLite；`TASK-010` 清理旧 migrations/commands/services 的 SQLite 依赖和死代码。
- `npm run tauri:dev` 仍需在 1425 端口空闲后复验；当前本机该端口仍被既有进程占用，本轮未杀用户进程。

### 2026-06-24 Round 10：RemoteHostService 切到 TOML 并拆分 secrets

状态：完成 `TASK-004`。`RemoteHostService` 已从旧 SQLite helper 切换到 `ConfigFileStore`，主机分组写入 `hosts/groups.toml`，主机普通配置写入 `hosts/<id>.toml`，凭据 secret 写入 `secrets/hosts/<id>.toml`。不保留旧 `remote_hosts` / `remote_host_groups` SQLite 读取兼容路径。

本轮修改：

- `src-tauri/src/storage/config_file_store.rs` 增加 remote host/group typed TOML repository、recoverable change set、runtime secret merge、普通 host TOML 禁止 `credential_secret` / `credentialSecret`。
- `src-tauri/src/services/remote_host_service.rs` 改为依赖 `ConfigFileStore`，相关 command/service/test 签名同步。
- 删除旧 SQLite remote host helper：`src-tauri/src/storage/remote_hosts.rs`，并从 `src-tauri/src/storage/mod.rs` 移除模块导出。
- SSH、SFTP、Docker、server info、port forward、command suggestion smoke 和 MCP tool invocation remote/ssh 路径统一通过 `RemoteHostService` / `ConfigFileStore` 解析主机。
- `src-tauri/src/storage/migrations.rs` 移除 `port_forward_sessions.host_id` 对 legacy `remote_hosts` 的外键约束，避免 file-backed host id 写入运行态摘要时依赖旧表。
- `src-tauri/tests/remote_host_service.rs` 增加 runtime secret merge 和普通 host TOML 不含 secret 的断言；相邻 SSH/SFTP/server-info/port-forward/password smoke 测试更新为新签名。

验证：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --lib storage::config_file_store` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test remote_host_service` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test mcp_tool_invocation_service remote_host` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test mcp_tool_invocation_service ssh_` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test mcp_tool_invocation_service local_management` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test ssh_terminal_service` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test server_info_service` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test command_suggestion_ssh_smoke smoke_test_is_explicitly_gated` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test port_forward_service` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test sftp_service` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test ssh_command_service` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test ssh_terminal_password_smoke` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --no-run -j 1` 通过；并行 `--no-run` 曾因 Windows linker `LNK1201` 写 PDB 失败，串行复验通过。
- `npm run typecheck` 通过。
- `npm run build` 通过；保留既有 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5204 --strictPort` 启动成功，HTTP smoke 返回 200；5203 当时被占用，改用 5204，smoke 后已停止 dev server。
- `npm run tauri:dev` 未运行：`127.0.0.1:1425` 仍被 PID `105544` 占用，本轮未杀用户进程。
- CodeGraph 复核 `ConfigFileStore` / `RemoteHostService` 主路径，确认 remote host 核心读取入口在文件 repository。

剩余：

- `TASK-005` 继续迁移 snippets/workflows 到 TOML。
- `TASK-006` 继续收敛 command SQLite。
- `TASK-010` 继续清理旧 migrations/commands/services 的 SQLite 依赖和死代码；本轮已删除 remote host helper，但旧 broader schema 清理仍留给收口切片。

### 2026-06-24 Round 11：Snippets / Workflows 切到 TOML

状态：完成 `TASK-005`。`SnippetService` 和 `WorkflowService` 已从 SQLite 主路径切换到 `ConfigFileStore`，脚本片段写入 `snippets/<id>.toml`，命令工作流和 steps 合并写入 `workflows/<id>.toml`。不保留旧 `command_snippets` / `command_workflows` / `command_workflow_steps` SQLite helper 和 fresh schema 创建逻辑。

本轮修改：

- `src-tauri/src/storage/config_file_store.rs` 增加 snippet/workflow typed TOML repository、单文件实体读写、change set 删除、id/file name 一致性校验和 workflow steps 排序。
- `src-tauri/src/services/snippet_service.rs` 改为持有 `ConfigFileStore`，创建/更新/删除直接写 TOML；保留原有标题、命令、标签、scope、查询过滤和排序行为。
- `src-tauri/src/services/workflow_service.rs` 改为持有 `ConfigFileStore`，workflow steps 与 workflow 同文件保存；更新 workflow 时继续整体替换 steps，与旧行为一致。
- `src-tauri/src/commands/snippet.rs`、`src-tauri/src/commands/workflow.rs`、`src-tauri/src/services/mcp_tool_invocation_service/content_tools.rs`、`execution.rs` 改用新 service 签名，前端和 MCP tool 参数契约不变。
- `src-tauri/src/state.rs` 复用同一个 `ConfigFileStore` 注入 snippets/workflows。
- 删除旧 SQLite helper：`src-tauri/src/storage/snippets.rs`、`src-tauri/src/storage/workflows.rs`，并从 `src-tauri/src/storage/mod.rs` 移除模块导出。
- `src-tauri/src/storage/migrations.rs` 删除 fresh schema 中 `command_snippets`、`command_workflows`、`command_workflow_steps` 创建逻辑；`src-tauri/tests/storage_foundation.rs` 改为断言这些文件化配置表不会创建。
- `src-tauri/tests/snippet_service.rs`、`src-tauri/tests/workflow_service.rs`、MCP local resources/local management tests 同步新签名，并增加 TOML 落盘断言。

验证：

- `cargo fmt --manifest-path src-tauri/Cargo.toml` 已运行。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --lib storage::config_file_store` 通过，7 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test snippet_service` 通过，4 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test workflow_service` 通过，4 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test mcp_tool_invocation_service local_resources` 通过，18 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test mcp_tool_invocation_service local_management` 通过，1 test。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --test storage_foundation` 通过，23 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-file-storage --no-run -j 1` 通过，所有 Rust test targets 编译成功。
- `rg` 扫描确认 `storage::snippets`、`storage::workflows`、旧 `list_command_snippets` / `list_command_workflows` 和 fresh `CREATE TABLE IF NOT EXISTS command_snippets|command_workflows|command_workflow_steps` 无主链路命中；仅 `storage_foundation.rs` 的负向断言保留旧表名。
- `git diff --check` 对本轮涉及 Rust 文件和测试无 whitespace error；仅当前工作区既有 LF/CRLF warning。
- 已运行 `node .codex/hooks/lane-coordination.cjs checkpoint lane-file-first-storage-codex-workdir C:/dev/rust/kerminal`，生成 `.updeng/docs/coordination/checkpoints/lane-file-first-storage-codex-workdir.json`，包含 23 个 path 和 11 个 tracked patch path。

剩余：

- `TASK-006` 继续把 SQLite 收敛为 command history/suggestion 专用 store。
- `TASK-010` 继续清理旧 remote host/port-forward/local-file broader schema 和死代码。
- `npm run tauri:dev` 仍需在 1425 端口空闲后复验；当前本机该端口仍被既有 PID `105544` 占用，本轮未杀用户进程。

### 2026-06-24 Round 12：Command SQLite 收敛、旧兼容分支删除与全量门禁

状态：完成 `TASK-006`、`TASK-007`、`TASK-010` 和 `TASK-011` 的当前范围。命令历史/建议已经收敛到 command-domain SQLite；settings/profile/hosts/snippets/workflows 已由 `ConfigFileStore` 文件化；旧 AI/LLM/custom MCP/custom skills 主链路已删除；runtime SQLite 不再自动识别、归档或重置旧 app-wide schema，unsupported schema 直接失败。

本轮修改：

- `src-tauri/src/storage/migrations.rs` 删除旧 app-wide SQLite 表名单和旧 schema 识别函数。
- `src-tauri/src/storage/sqlite.rs` 删除旧库自动归档/drop/re-migrate 分支。
- `src-tauri/tests/storage_foundation.rs` 删除旧库归档兼容测试；新增早期 `user_version = 30` runtime DB 直接拒绝测试；保留 fresh runtime schema、command SQLite schema 和 unsupported schema 拒绝测试。
- `src/features/machine-sidebar/MachineSidebar.tsx` 和 `machineSidebarMenuDomain.test.tsx` 同步默认展开分组行为，修复全前端套件中因旧默认折叠假设导致的失败。
- `README.md` 的本地边界补充文件优先版本不自动读取或迁移早期一体化 SQLite 数据库。

验证：

- `npm test -- --run src/features/machine-sidebar/machineSidebarMenuDomain.test.tsx` 通过，1 file / 7 tests。
- `npm run test:frontend` 通过，158 files / 1114 tests。
- `npm run typecheck` 通过。
- `npm run build` 通过；保留既有 Vite large chunk warning。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --test storage_foundation` 通过，11 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --no-run -j 1` 通过，所有 Rust test targets 编译成功。
- `npm run dev -- --host 127.0.0.1 --port 5206 --strictPort` 启动成功，HTTP 200；Agent Launcher 截图：`.updeng/docs/verification/final-agent-launcher-5206-msedge.png`。
- `npm run tauri:dev` 使用临时 `KERM_SMOKE_HOME=.updeng/tmp/tauri-smoke-home-2` 启动成功，Rust dev build 完成并运行 `target\debug\kerminal.exe`，进程保持 15 秒无启动崩溃；本轮 smoke 进程已停止，1425 已释放。

搜索证据：

- `rg "settings-ai|AI 与模型|LlmProvider|llmProvider|RigProvider|AiToolContent|streamAiChatMessage|llm_providers|ai_conversations|ai_messages|ai_attachments|ai_agent_runs|ai_context_snapshots|ai_tool_audits|ai_tool_pending_invocations|custom MCP|CustomMcp|mcp_discovery|skills_repository|file_dialog_get_app_skills_directory|paths\\.skills|llm_api_key_ref|old_app_wide|old-v" src src-tauri/src src-tauri/tests scripts README.md .updeng/docs/config/external-agent-workspace.md` 无命中。

剩余：

- `TASK-008` 非配置运行态的 local-file audit / port-forward sessions 仍在 runtime SQLite，未迁移到 JSONL/JSON。
- `TASK-009` 配置操作 skill 和 validator 已有骨架与 self-test，完整 schema 文档和生产级 validator 规则仍需补齐。

### 2026-06-24 Round 13：非配置运行态 JSONL/JSON 迁移

状态：完成 `TASK-008`。本机文件操作审计改为 `logs/local-file-operations/YYYY-MM-DD.jsonl`，端口转发运行态摘要改为 `data/port-forwards/sessions.json`；runtime SQLite fresh schema 不再创建 `local_file_operation_audits` 或 `port_forward_sessions`，只保留 MCP tool audit/pending 两张运行态表。

本轮修改：

- `src-tauri/src/storage/local_file_operations.rs` 从 SQLite insert/list 改为 JSONL append/read，保留 `LocalFileOperationAuditWrite` / `LocalFileOperationAuditRecord` 和现有 public 方法名。
- `src-tauri/src/storage/port_forwards.rs` 从 SQLite insert/list/get/delete 改为 JSON state file 读写，保留现有 public 方法名，旧数据不迁移。
- `src-tauri/src/storage/sqlite.rs` 增加 root path 和 file IO mutex，作为迁移期 file-backed facade，MCP audit/pending 仍使用 SQLite connection。
- `src-tauri/src/storage/migrations.rs` 删除 `local_file_operation_audits` 和 `port_forward_sessions` fresh schema。
- `src-tauri/tests/storage_foundation.rs` 增加 local-file audit JSONL 落盘断言，并确认 runtime SQLite 只创建 MCP 表。
- `src-tauri/tests/port_forward_service.rs` 增加 `data/port-forwards/sessions.json` 落盘断言。

验证：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --test port_forward_service --test storage_foundation` 通过，2 + 11 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --test mcp_tool_invocation_service port_forward` 通过，10 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --no-run -j 1` 通过，所有 Rust test targets 编译成功。
- `npm run tauri:dev` 使用临时 `KERM_SMOKE_HOME=.updeng/tmp/tauri-smoke-home-3` 启动成功，Rust dev build 完成并运行 `target\debug\kerminal.exe`，进程保持 15 秒无启动崩溃；本轮 smoke 进程已停止，1425 已释放。

搜索证据：

- `rg "CREATE TABLE IF NOT EXISTS (local_file_operation_audits|port_forward_sessions)|FROM local_file_operation_audits|FROM port_forward_sessions|INSERT INTO local_file_operation_audits|INSERT INTO port_forward_sessions|DELETE FROM port_forward_sessions" src-tauri/src src-tauri/tests` 无命中。

剩余：

- `TASK-009` 配置操作 skill、schema 文档和 validator 生产级规则仍需补齐。

### 2026-06-24 Round 14：配置操作 skill、schema 文档和 validator 收口

状态：完成 `TASK-009`，本计划全部任务已完成。配置操作 skill、OpenAI agent metadata、validator 和配置 schema 文档已对齐当前文件优先结构；不保留旧 SQLite、旧 AI provider、旧 custom MCP/skills 或 `~/.kerminal/config` 子目录兼容口径。

本轮修改：

- `.codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs` 从骨架扫描扩展为生产级静态校验：覆盖 `settings.toml`、`profiles/*.toml`、`hosts/groups.toml`、`hosts/*.toml`、`snippets/*.toml`、`workflows/*.toml`；校验 `schema_version = 1`、id/file name 一致、host group 引用、workflow step id 唯一和 sort order 递增、scope/boolean 类型、普通 config secret-like key/table，并支持常见多行数组。
- `.codex/skills/bwy-kerminal-config-files/SKILL.md` 和 `agents/openai.yaml` 去掉“骨架/后续迁移”旧说法，明确默认根目录是 `~/.kerminal`，普通配置是根下 TOML，默认不读取 `secrets/`。
- 新增 `.updeng/docs/config/kerminal-config-files.md`，记录当前文件布局、每类 TOML 的核心字段、示例、禁止项和 validator 命令。
- `.updeng/docs/config/README.md` 增加配置 schema 与外部 Agent workspace 文档入口。
- `.updeng/docs/config/external-agent-workspace.md` 修正旧 `config/` 子目录和 `state/command.sqlite` 口径，改为当前 `~/.kerminal/settings.toml`、`profiles/`、`hosts/`、`snippets/`、`workflows/` 和 `data/command.sqlite`。
- `src-tauri/src/services/external_agent_workspace.rs` 生成的 `AGENTS.md` 管理块改为提示编辑当前 workspace 根下的文件化配置，避免误导外部 Codex/Claude 去找 `config/` 子目录。

验证：

- `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --self-test` 通过，覆盖 valid、secret、missing schema、bad host group ref、bad workflow step order、id/file mismatch、多行数组 fixture。
- `node --check .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs` 通过。
- `node .codex/skills/bwy-project-skill-maintenance/scripts/validate_skills.js --run-tests` 通过，64 skills 无 findings。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --lib external_agent_workspace` 通过，6 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --lib storage::config_file_store` 通过，7 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --test settings_service --test profile_service --test remote_host_service` 通过，5 + 4 + 12 tests。
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir .updeng/tmp/cargo-target-verify --test snippet_service --test workflow_service` 通过，4 + 4 tests。
- `git diff --check -- .codex/skills/bwy-kerminal-config-files/SKILL.md .codex/skills/bwy-kerminal-config-files/agents/openai.yaml .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs .updeng/docs/config/README.md .updeng/docs/config/external-agent-workspace.md .updeng/docs/config/kerminal-config-files.md src-tauri/src/services/external_agent_workspace.rs` 通过。

剩余：

- 本文件优先存储计划无剩余任务；后续如要继续增强，可另开小切片，例如 validator 调用 Rust typed parser 或 `ExternalAgentWorkspaceService` dry-run diff / overwrite policy UI。
