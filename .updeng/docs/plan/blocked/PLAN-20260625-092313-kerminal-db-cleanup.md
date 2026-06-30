---
id: PLAN-20260625-092313-kerminal-db-cleanup
status: blocked
created_at: 2026-06-25T09:23:13+08:00
started_at: 2026-06-25T09:23:13+08:00
completed_at:
updated_at: 2026-06-25T09:53:15+08:00
owner: ai
---

# kerminal.db 清理

## 目标

- 确认当前文件优先版本是否仍使用工作空间里的旧 `kerminal.db`。
- 若确认无运行时依赖，删除旧数据库文件和只服务旧一体化 SQLite 的残留代码。
- 保留当前仍有效的命令域 SQLite、命令建议缓存和运行态必要存储。

## 非目标

- 不迁移用户本机真实应用数据目录里的历史数据库。
- 不恢复旧 settings/profile/host/snippet/workflow 的 SQLite 兼容读取。
- 不改动现有 active 测试边界整理 lane 的 owned paths，除非验证证明必须做最小兼容修改。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| Rust 存储路径 | 待确认 | `src-tauri/src/storage/**`, `src-tauri/src/paths.rs`, `src-tauri/src/state.rs` | CodeGraph / `rg` 引用确认，Rust 相邻测试 |
| 工作区旧 DB 文件 | 待确认 | `kerminal.db` 或 `.kerminal/kerminal.db` | 文件存在性、git 状态、删除后引用扫描 |
| 前端/UI | 否 | 无 | 不需要截图，若启动路径受影响则做 dev server smoke |
| 并行协作 | 是 | `.updeng/docs/coordination/lanes.json`, `plan/INDEX.md`, `in-progress.md` | diff 检查 |

## 执行步骤

- [x] TASK-001：追踪 `kerminal.db` 路径、文件状态和代码引用，确认是否仍被打开。
- [ ] TASK-002：删除确认无用的旧 DB 文件与旧一体化 SQLite 残留代码。（代码残留已清理；用户目录旧 DB 物理删除被 PreToolUse 门禁阻止。）
- [x] TASK-003：运行相邻验证，补 Round Log 和 lane 状态。

## 验证

- `rg -n "kerminal\.db|database_path|SqliteStore|CommandSqliteStore" src-tauri README.md .updeng/docs`
- `cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation`
- 若改动启动路径，补 `npm run build` 和真实 dev server smoke；如 Rust/Tauri 初始化受影响，补 `npm run tauri:dev` 或说明阻断。

## 风险

- 当前工作区存在大量未归因改动，本轮必须只删除自己确认的旧 DB 文件和残留代码。
- `SqliteStore` 和 `CommandSqliteStore` 名称相近；不能把当前命令域 SQLite 误删。
- 删除本地 DB 文件属于不可逆操作；只有确认是工作区旧产物且当前代码不再使用时才执行。

## Round Log

- 2026-06-25T09:23:13+08:00：按用户要求启动本 lane。已读取 AGENTS、README、Updeng 文档、当前 active lane、coordination status、lanes 和最近 checkpoint；当前事实显示 README 已声明文件优先版本不自动读取或迁移早期一体化 SQLite，下一步追踪代码和实际文件状态。
- 2026-06-25T09:53:15+08:00：确认旧 `~/.kerminal/kerminal.db` 已不再是运行时事实源；当前有效 SQLite 是 `~/.kerminal/data/command.sqlite`。代码侧已删除旧 `KerminalPaths.database_file`、旧运行态 `SqliteStore` / migrations 导出和 runtime SQLite 诊断入口，运行态文件存储改为 `RuntimeFileStore`，诊断改为报告命令域 SQLite。引用扫描只剩 `CommandSqliteStore` 与测试中的“不创建 kerminal.db/runtime.sqlite”断言。验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、临时 `CARGO_TARGET_DIR` 下 `cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation --test diagnostics_service --test settings_service`、`npm run typecheck`、`npm run test:frontend -- src/lib/diagnosticsApi.test.ts`、`npm run build`、Vite dev server HTTP 200 smoke、临时 target 下 `npm run tauri:dev` 启动并运行 10 秒无旧 DB schema 报错。默认 target 的 `cargo test` 曾因 `src-tauri/target/debug/kerminal.exe` 被占用失败，改用临时 target 后通过；`tauri:dev` 首次因 1425 残留 Vite 占用失败，确认是当前仓库 Vite 后停止并重试通过。物理删除 `C:\Users\24052\.kerminal\kerminal.db` 时被 PreToolUse 阻止，原因是 Windows 绝对路径 `Remove-Item`；未绕过门禁。剩余人工动作：用户手动删除该单个旧文件，保留 `C:\Users\24052\.kerminal\data\command.sqlite`。
