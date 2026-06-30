---
id: PLAN-20260621-223801-sftp-runtime-crash-fix
status: done
created_at: 2026-06-21T22:38:01+08:00
started_at: 2026-06-21T22:38:01+08:00
completed_at: 2026-06-21T22:53:07+08:00
updated_at: 2026-06-21T22:53:07+08:00
owner: ai
---

<!-- @author kongweiguang -->

# SFTP 传输 runtime 崩溃修复

## 目标

- 修复 SFTP 上传、下载、归档和剪贴板下载入队后应用直接关闭的问题。
- 保证后台传输任务可从 Tauri 同步 IPC 回调安全启动，不依赖当前调用线程已有 Tokio reactor。

## 非目标

- 不改 SFTP 协议传输算法、队列 UI、前端交互和跨主机传输产品形态。
- 不重构 code-quality lane 的其它 SFTP 模块。

## 影响范围

- `src-tauri/src/services/sftp_service/runtime_tasks.rs`
- `.updeng/docs/coordination/lanes.json`

## 执行步骤

- [x] 将 SFTP 后台任务入口从 `tokio::spawn` 改为 Tauri 全局 async runtime。
- [x] 运行 Rust 定向测试、格式检查和真实 Tauri 启动烟测。
- [x] 记录根因、验证和剩余风险。

## 验证

- `cd src-tauri; cargo fmt --check`
- `cd src-tauri; cargo test sftp_service -j 1`
- `npm run build`
- `npm run tauri:dev` 或等价 debug app smoke

## 风险

- 当前工作区有多个 active lane 和大量未提交改动；本修复只写 SFTP runtime task 调度，不格式化共享文件。

## Round Log

- 2026-06-21T22:53:07+08:00 根因确认：SFTP 上传/下载/归档/剪贴板下载入队会从 Tauri/WebView 同步 IPC 回调调用 `tokio::spawn`，当前线程没有 Tokio reactor，触发 `there is no reactor running` panic；panic 穿过 WebView2 COM 回调后 abort，表现为应用关闭，Windows 事件码为 `0xc0000409`。
- 2026-06-21T22:53:07+08:00 修复：`src-tauri/src/services/sftp_service/runtime_tasks.rs` 中后台任务入口改为 `tauri::async_runtime::spawn`，ZIP/剪贴板阻塞子任务改为 `tauri::async_runtime::spawn_blocking`；新增同步上下文回归测试 `enqueue_transfer_from_sync_context_does_not_require_tokio_reactor`，确保普通 `#[test]` 没有 Tokio reactor 时入队不 panic。
- 2026-06-21T22:53:07+08:00 验证：`cargo fmt --check` 通过；`cargo test sftp_service -j 1` 通过，29 passed 且包含新增同步回归；`npm run build` 通过，保留既有大 chunk warning；隔离 `CARGO_TARGET_DIR=src-tauri/target/sftp-runtime-crash-fix-smoke` 下 `cargo build --no-default-features` 通过；受控 `cargo run --no-default-features` smoke 启动隔离 target app 成功，1425 返回 HTTP 200 且 root 存在，随后停止本轮 app/cargo。
