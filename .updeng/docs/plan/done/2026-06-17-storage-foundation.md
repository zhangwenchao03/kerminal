---
id: PLAN-20260617-000028-storage-foundation
status: done
created_at: 2026-06-17T00:00:28+08:00
started_at: 2026-06-17T00:00:28+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Kerminal 数据目录与 SQLite 基础

## 目标

- 建立跨平台 `~/.kerminal` 数据目录抽象，统一管理 db、logs、cache、themes、snippets、exports、temp、diagnostics。
- 使用 `rusqlite` 建立 SQLite 基础连接、WAL、foreign keys、busy timeout 和 `PRAGMA user_version` migration。
- 在 Tauri 启动时初始化本地数据目录和数据库，并通过 Rust state 管理。
- Rust 代码按 `paths`、`storage`、`state`、`error` 模块拆分，不把逻辑堆在 `lib.rs`。
- 测试代码放到独立 `src-tauri/tests/` 文件，覆盖路径和 migration 基础行为。

## 非目标

- 本轮不实现 profile、workspace、remote host、history、AI audit 等业务表。
- 本轮不实现前端设置页或数据库 CRUD UI。
- 本轮不处理 OS keychain、SSH 凭据或 LLM API key 存储。

## 影响范围

- Rust 依赖：`src-tauri/Cargo.toml`
- Rust 模块：`src-tauri/src/error.rs`、`paths.rs`、`state.rs`、`storage/`
- Tauri 启动：`src-tauri/src/lib.rs`
- Rust 测试：`src-tauri/tests/`
- 文档状态：`.updeng/docs/in-progress.md`

## 执行步骤

- [x] 增加 `rusqlite`、`thiserror`、`dirs`、`tempfile` 依赖。
- [x] 实现 `KerminalPaths`，支持默认 home 目录和测试注入根目录。
- [x] 实现 SQLite migration v1，创建基础 metadata/settings 表，并拦截未来版本数据库。
- [x] 实现 `AppState`，启动时确保目录和数据库初始化。
- [x] 增加独立 Rust 集成测试，覆盖目录结构、数据库文件、user_version、幂等 migration、WAL/foreign_keys、未来版本拒绝和启动失败路径。
- [x] 运行 `npm run check` 并修复失败。

## 验证

- `cd src-tauri && cargo test --test storage_foundation -- --nocapture`：通过，8 个测试通过。
- `npm run check`：通过。包含前端 5 个测试文件 13 个测试、Rust fmt/clippy/test、`tsc` 和 `vite build`。

## 风险

- 当前真实启动会在用户主目录创建 `~/.kerminal`，测试必须使用临时目录，避免污染用户数据。
- Windows/macOS/Linux home 目录差异通过 `dirs::home_dir()` 封装，后续跨平台 smoke test 仍需要在实际系统验证。
- 第一版 schema 不能过度设计业务表；本轮只建立 migration 和必要元数据基础。
- WAL 会生成 `kerminal.db-wal` 和 `kerminal.db-shm` 旁路文件；后续备份、导出和诊断包需要一起考虑。


