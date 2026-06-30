# ADR-0016: 文件优先存储与外部 Codex 工作目录协作边界

## 状态

Proposed

## 背景

- 用户明确要求这次存储改造不考虑旧 SQLite 兼容，尽量把不强依赖 SQLite 的持久化内容改成文件，方便 AI agent、命令行工具和人工用 `rg` 检索、审阅和修改。
- 用户进一步明确：AI 相关 SQLite 表全部去掉；后续不使用 Codex app-server；需要 AI 协作时，直接使用 Codex 打开项目或配置工作目录即可。
- 当前 SQLite schema 版本为 30，表覆盖配置、主机、LLM provider、AI 对话、AI 审批、命令历史、命令建议、审计和端口转发运行态，职责混杂。
- 新边界是：Kerminal 本体不保存 AI conversation、message、provider、pending invocation、context snapshot 或 tool audit 主状态；外部 Codex 通过文件化配置、仓库文档和 `.codex/skills` 工作。

## 决策驱动因素

- AI 可操作性：配置应能被 `rg`、文本编辑和项目 skill 安全处理。
- 数据边界：Kerminal 不再维护内置 AI 对话/审批/运行时状态，不引入 app-server sidecar 或 event mirror。
- 性能：高频写入、高基数检索和排序仍应留在 SQLite。
- 生产可靠性：文件写入必须有原子写、校验、备份、锁和回滚路径，不能只做简单文本写入。
- 安全：主机密钥、密码和 token 即使按当前产品要求明文可见，也要从普通配置中拆到更窄 scope 的 secrets 文件区。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| 继续全量 SQLite | 查询和事务简单，改动小 | AI/人工修改困难，schema 越来越杂，配置不适合 `rg` | AI 仍需写 SQL 或 API，长期复杂 | SQLite 查询压测、AI 操作演练 |
| 全量文件化 | 最适合 AI 和人工检索，结构直观 | 命令历史、建议缓存、排序分页性能差，事务复杂 | 高频写入损坏和并发冲突 | 大量历史和并发写压测 |
| 文件配置 + 命令 SQLite + 删除内置 AI 存储 | 匹配数据性质，减少 SQLite 面积，外部 Codex 可直接操作文件 | 需要移除旧 AI 主链路，不再保留内置 AI 历史 | 用户旧 AI 对话不可见；需要清晰说明非兼容 | 文件 store 单测、SQLite 命令压测、无 AI 表 schema 检查 |
| Codex app-server 集成 | 可获得 app-server thread/turn/event 模型 | 引入 sidecar、协议版本、审批和 runtime 复杂度 | 与用户“直接用 Codex 打开工作目录”的方向冲突 | 不采用 |

## 决策

采用“文件配置 + 命令 SQLite + 删除内置 AI 存储”的混合方案：

- 配置、主机、profile、snippet、workflow、设置和低频运行态改为文件存储。
- 命令历史、命令建议缓存、反馈、遥测和命令建议审计继续使用 SQLite，后续可按需要引入 FTS5 或专用索引。
- AI 相关 SQLite 表全部删除，不迁移、不镜像、不转成 JSONL：
  - `llm_providers`
  - `ai_tool_audits`
  - `ai_conversations`
  - `ai_messages`
  - `ai_attachments`
  - `ai_conversation_slots`
  - `ai_context_snapshots`
  - `ai_tool_pending_invocations`
- 不引入 Codex app-server、ACP adapter 或本地 AI sidecar 作为本计划的一部分。
- 外部 AI 协作方式是直接用 Codex 打开 Kerminal 项目目录或 Kerminal 配置目录，通过文档、TOML 文件和 `.codex/skills` 操作。
- 文件格式按用途分层：
  - 人工和 AI 会编辑的配置用 TOML。
  - 大块运行态快照用 JSON。
  - 追加审计和事件流用 JSONL。
  - 二进制或附件资产独立放文件目录，metadata 只保存引用。

## 影响

- 正向影响：
  - 主机、设置、profile、workflow 等配置可以直接被 `rg` 检索和 Codex 修改。
  - SQLite 只承担真正适合它的高频检索、排序、TTL cache 和统计。
  - 不再维护 Kerminal 内置 AI 对话、provider、审批和 pending 状态，存储面显著收窄。
- 负向影响：
  - 旧 AI 对话、附件、pending invocation 和 provider 设置不再提供兼容读取。
  - 文件 store 需要新增原子写、锁、校验、备份和 schema migration 基础设施。
  - 多文件更新不能天然依赖 SQLite transaction，需要应用层 change set 和 manifest。
- 需要同步修改：
  - `src-tauri/src/storage/*` 存储模块和 `AppState` 注入。
  - settings/profile/remote-host/snippet/workflow/port-forward/audit 相关 service。
  - 旧 AI storage、provider、conversation、pending invocation 相关 command/service/UI 入口删除或退场。
  - `.codex/skills` 增加配置文件操作 skill 和验证脚本。
  - README、本地数据边界说明和 Updeng 计划文档。

## 回滚或替代

- 实现阶段不做旧 DB 兼容读取；若切换失败，回滚到上一提交的 SQLite 存储实现。
- 文件 store 每次写入前创建版本化备份，应用启动发现文件 schema 错误时进入只读恢复模式，提示用户修复或恢复备份。
- 如果某类文件化数据在压测中证明性能不达标，可把该类数据单独迁回 SQLite，但不能把全局配置重新塞回一个混杂 DB。
- 如后续用户重新要求内置 AI 或 app-server 集成，应新建 ADR，不复用本决策。

## 验证

- 文件 store：原子写、并发锁、坏 TOML、缺字段、schema 升级、备份恢复单测。
- SQLite：命令历史和命令建议查询延迟、TTL 清理、索引有效性测试。
- AI 删除边界：fresh schema 不创建任何 `ai_*` 或 `llm_providers` 表；Rust/TS 中旧 AI storage API 无主链路引用。
- 外部 Codex 协作：配置文件 schema、示例和 skill validator 能让 Codex 在工作目录中定位、修改、验证配置。
- 应用门禁：`cargo fmt --check`、相关 Rust 测试、`npm run typecheck`、`npm run build`、真实 dev server smoke；涉及 Tauri 启动时运行 `npm run tauri:dev`。

