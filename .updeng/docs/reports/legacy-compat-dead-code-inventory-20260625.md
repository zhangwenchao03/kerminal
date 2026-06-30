# 遗留、兼容、无用和废弃代码清理 Inventory

生成时间：2026-06-25T09:48:49+08:00  
关联计划：[`PLAN-20260625-093610-legacy-compat-dead-code-cleanup`](../plan/active/PLAN-20260625-093610-legacy-compat-dead-code-cleanup.md)  
lane：`lane-legacy-compat-dead-code-cleanup`

## 扫描边界

- 生产路径：`src/`、`src-tauri/src/`、`scripts/`、`package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`。
- 排除：`*.test.*`、`__tests__/`、`src-tauri/src/**/tests/**`，避免把测试夹具和迁移中测试支撑误判为生产引用。
- 文档仅用于事实核对，不把历史 ADR 和 done plan 当作运行时引用；历史事实需要用 superseded 链接收敛。
- 当前工作区很脏，本报告只记录当前磁盘状态，不代表 HEAD。

## 扫描命令摘要

- CodeGraph：`SqliteStore RuntimeFileStore CommandSqliteStore legacyTargetFromPane TerminalSecretInputResponse TerminalSecretInputEntry legacy-secret rig-core rmcp MCP tools-only old AI provider tool registry kerminal.db`
- `rg`：旧 AI/provider/tool registry 关键模式在 production-only 路径无命中。
- `rg`：`legacy|deprecated|compat|backward|obsolete|TODO.*remove|remove.*TODO`
- `rg`：`SqliteStore|RuntimeFileStore|command.sqlite|kerminal.db|migrations|migration|database_path|CommandSqliteStore`
- `rg`：`#[doc(hidden)]|#[cfg(test)]|#[cfg(not(test))]`
- `cargo tree -e features -i rig-core`
- `cargo tree -e features -i rmcp`

## 可删除 / AFK

| 候选 | 证据 | 处理建议 | 验证 |
| --- | --- | --- | --- |
| 旧 AI perf baseline 聚合 | `scripts/perf-collect-baseline.mjs` 仍读取 `perf-ai-streaming-baseline.json`，并把 `aiStreamingPass` 纳入 `summary.pass`；`rg --files scripts | rg "perf-ai"` 无脚本命中，只剩历史验证 JSON。 | TASK-002 删除 `aiStreaming` report/pass 字段；历史 `.updeng/docs/verification/perf-ai-streaming-*.json` 不作为当前 perf gate。 | `npm run perf:directory-list`、`npm run perf:terminal-output`、`npm run perf:collect-baseline`。 |
| `rig-core` 直接依赖 | `src-tauri/Cargo.toml:32` 仍有 `rig-core = { version = "0.38.2", features = ["rmcp"] }`；production-only `rg` 无 `rig_core` 源码引用；`cargo tree -e features -i rig-core` 显示仅根 crate 直接引入。 | TASK-003 删除 `rig-core`，同步 lockfile。 | `cargo tree -e features -i rig-core` 应无结果；MCP/Rust 相邻测试通过。 |
| `rmcp` 旧 client/child-process/client-reqwest feature | `src-tauri/Cargo.toml:33` 直接启用 `client`、`transport-child-process`、`transport-streamable-http-client-reqwest`；生产源码只在 `mcp_streamable_http_server.rs` 使用 server；集成测试 `src-tauri/tests/mcp_streamable_http_server.rs` 使用 client。 | TASK-003 先移除 `rig-core`，再评估 client feature 是否只作为 test dependency 保留；`transport-child-process` 倾向删除。 | `cargo tree -e features -i rmcp` 记录 feature 来源；`cargo test --test mcp_streamable_http_server`。 |

## 保留 / 当前契约

| 项 | 证据 | 保留理由 |
| --- | --- | --- |
| Kerminal MCP tools-only server | README 和 ADR-0017/0018 明确当前产品保留 Kerminal MCP Server；生产 `mcp_streamable_http_server.rs` 使用 `rmcp` server。 | 当前运行时能力，不是遗留代码。 |
| `CommandSqliteStore` / `data/command.sqlite` | `src-tauri/src/paths.rs` 定义 `command.sqlite`；命令历史和命令建议路径大量依赖 `CommandSqliteStore`。 | 当前命令域 SQLite，不能按旧 app-wide SQLite 删除。 |
| `RuntimeFileStore` | CodeGraph 显示 `RuntimeFileStore::open` 只确保运行时目录；`state.rs`、port-forward、local file audit 等使用它；后续复核无 `SqliteStore` 生产命名残留。 | 当前 file-backed runtime store，已不是旧 `SqliteStore` 命名。 |
| `TerminalSecretInputResponse` | `ssh_command_plan.rs`、`ssh_terminal_service.rs`、`terminal_manager.rs`、`port_forward_service/plan.rs` 仍转换到 `TerminalSecretInputPlan`。 | 仍是 SSH/terminal/port-forward secret input 兼容入口，不能直接删。 |
| command suggestion `provider` 术语 | `CommandSuggestionProvider`、history/path/spec/git provider 是当前补全架构术语。 | 不是旧 LLM provider。 |

## 延后 / 需要同步其它 lane

| 候选 | 证据 | 前置/处理 |
| --- | --- | --- |
| 旧 `kerminal.db` / app-wide SQLite | `lane-kerminal-db-cleanup` 已确认代码侧无旧 `kerminal.db` / runtime SQLite 依赖，当前有效 SQLite 是 `data/command.sqlite`；真实 home 下旧 DB 物理删除被门禁阻止。 | 代码侧复用 blocked lane 结论；用户手动删除 `C:\Users\24052\.kerminal\kerminal.db`，保留 `data\command.sqlite`。 |
| SFTP 大测试挂载 | `src-tauri/src/services/sftp_service.rs` 仍有 `#[cfg(test)]` 和 `mod tests;`，属于 `lane-test-production-boundary-cleanup` 剩余热点。 | 等该 lane checkpoint 或接续授权；迁到 `src-tauri/tests/sftp_service/**`。 |
| `#[doc(hidden)] rules` 模块 | production-only 扫描命中 `connection.rs`、`file_dialog.rs`、`command_suggestion_service.rs`、`diagnostics_service.rs`、`docker_host_service.rs`、`mcp_streamable_http_server.rs`、`mcp_tool_executor_service.rs`、`port_forward_service.rs`、`sftp_service.rs`、SSH/Serial/Telnet/terminal rules。 | 多数是测试边界迁移的窄导出；等 SFTP/MCP inline test 迁移完成后逐个判断正式模型化或收回。 |
| external-agent / MCP / SSH tools inline tests | active 测试边界 lane 已列为剩余：`external_agent_workspace.rs`、`mcp_streamable_http_server.rs`、`mcp_tool_executor_service/ssh_tools.rs`。 | 等测试边界 lane 同步后迁到 `src-tauri/tests/**`，保持 tools-only contract。 |

## 需要 HITL 或显式产品决策

| 候选 | 证据 | 需要确认的问题 |
| --- | --- | --- |
| workspace session `legacyTargetFromPane` | CodeGraph 显示只由 `normalizeTerminalPane` 在缺少 `target` 时回填；`WORKSPACE_SESSION_VERSION = 1`。 | 是否仍支持旧 v1 snapshot 缺 `target` 的恢复。如果不再支持，应写明拒绝/迁移策略并补测试。 |
| `legacy-secret` entry id | `TerminalSecretInputEntry::from(TerminalSecretInputResponse)` 固定生成 `id: "legacy-secret"`；测试 `terminal_model.rs` 覆盖该兼容转换。 | 旧单 secret response 是否仍是 public contract。若仍保留，建议改注释说明；若删除，需要先迁完调用方。 |
| 历史 ADR 旧事实 | ADR-0001/0002/0003 仍记录 SQLite/内置 AI/Rig 旧方向；ADR-0003 已有 superseded 说明，ADR-0001/0002 还容易误导。 | 可 AFK 给 ADR-0001/0002 补 superseded-by 到 ADR-0016/0017；不删除历史 ADR。 |

## 已确认没有当前生产主链路的旧功能

- 旧 AI/provider/tool registry 关键模式在 production-only 源码扫描无命中。
- 已删除文件在当前工作区仍显示为 `D`，包括旧 `ai_*` models/services/tests、`llm_provider`、`tool_registry`、旧 MCP gateway 等；这些属于前序 lane 未提交成果，本 lane 不回滚、不重新认领。
- `scripts/perf-ai-streaming.mjs` 当前不存在，只有旧 verification JSON 和历史 done plan 记录。

## 建议执行顺序

1. TASK-002：先清理 `scripts/perf-collect-baseline.mjs` 的旧 AI baseline 聚合。这是当前最低冲突 AFK 切片。
2. TASK-003：删除 `rig-core`，再收缩 `rmcp` features。需要 Rust 依赖测试。
3. `lane-kerminal-db-cleanup` 已输出旧 DB 结论；本 lane 已复核 `RuntimeFileStore` 命名并修正唯一误导性启动文案。
4. 等 `lane-test-production-boundary-cleanup` checkpoint 后，再处理 SFTP/MCP/external-agent inline tests 和 `doc(hidden)` rules。
