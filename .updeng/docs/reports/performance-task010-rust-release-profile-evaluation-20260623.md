<!-- @author kongweiguang -->

# TASK-010 Rust / SQLite / Release Profile 性能评估

评估时间：2026-06-23T23:45:15+08:00

关联计划：[Kerminal 性能优化生产级实施计划](../plan/active/PLAN-20260623-190929-kerminal-performance-optimization.md)

## 结论

本轮不修改 Rust terminal 后端、SQLite 存储入口或 Cargo release profile。

理由是当前性能计划的已证实瓶颈和收益主要来自前端高频状态传播、AI streaming、SFTP 大列表和后台轮询；Rust terminal / SQLite / release profile 目前只有潜在候选，没有量化瓶颈证据。按“性能提升不能牺牲使用体验”的约束，不能为了未证实收益改动终端输出顺序、输入即时性、secret prompt 响应、关闭清理、SQLite 存储边界或跨平台 updater 产物。

## 现状判断

- `terminal_manager.rs` 每 session reader thread 使用 8KB read buffer，read 后依次执行 secret responder、redaction、context buffer、terminal log append 和 output event emit。
- `TerminalManager::write()` 每次 `write_all()` 后立即 `flush()`，保守但保障用户输入即时性。
- `TerminalManager::close()` 移除 session、kill child 并清理临时路径，语义高风险。
- SSH terminal service 主要解析 host、跳板、密码响应和临时私钥 cleanup，再委托 `TerminalManager`。
- `SqliteStore` 是单 `rusqlite::Connection` + `Mutex`，已启用 WAL、foreign keys 和 5s busy timeout。
- `src-tauri/Cargo.toml` 当前没有 `[profile.release]`；默认 release profile 已支撑 v0.1.9 跨平台 CI release 和 updater artifacts。

## 验证证据

- `npm run perf:rust-timings`：通过，dev profile 增量构建 1.31s，timing report 写入 `src-tauri/target/cargo-timings/cargo-timing-20260623T154219304Z-122bdcd98055b800.html`。
- `cd src-tauri; cargo test --test terminal_manager -- --nocapture`：通过，16 tests，覆盖 session create/close、output snapshot、terminal log、secret prompt split read 和 redaction。
- `cd src-tauri; cargo test --test storage_foundation sqlite_connection_enables_wal_and_foreign_keys -- --exact --nocapture`：通过，1 test。
- `npm run verify:command-suggestion-latency`：通过，command suggestion mixed provider latency gate 1 test。
- `cd src-tauri; cargo build --release --lib --timings`：通过，release profile lib baseline 1m37s，timing report 写入 `src-tauri/target/cargo-timings/cargo-timing-20260623T154327108Z-122bdcd98055b800.html`。

## 不落地候选

- 不调整 `READ_BUFFER_SIZE`：可能减少 read loop 次数，但会影响 prompt 自动响应和 output event 粒度，需要专门压测。
- 不批量合并 terminal output event：会影响关闭/error/data 顺序、前端 streaming 体感和日志刷新语义。
- 不延迟或移除 `TerminalManager::write()` 的 flush：可能让用户输入、密码响应和交互式 shell 变迟钝。
- 不把 SQLite 单连接 Mutex 改为连接池或写队列：会影响 60+ 调用点和事务语义，必须先采集 lock wait / 慢查询数据。
- 不添加 `[profile.release]` 的 `lto`、`strip`、`panic = "abort"`、`codegen-units = 1` 或 `opt-level = "z"`：可能影响构建时间、崩溃诊断、运行速度、签名/updater 产物和跨平台 CI。

## 后续门槛

若后续单独开 Rust/storage/release-size 性能任务，第一步应只做默认关闭 instrumentation：

- terminal read / emit / write flush 耗时与 chunk 统计。
- SQLite lock wait、操作耗时和调用频率统计。
- installer size、app startup smoke、Tauri updater download/install/relaunch baseline。

只有这些指标证明 Rust/storage/release profile 是真实瓶颈后，再做单独可回滚切片。
