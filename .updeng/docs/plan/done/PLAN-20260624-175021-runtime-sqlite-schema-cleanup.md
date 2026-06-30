---
id: PLAN-20260624-175021-runtime-sqlite-schema-cleanup
status: done
created_at: 2026-06-24T17:50:21+08:00
started_at: 2026-06-24T17:50:21+08:00
completed_at: 2026-06-24T17:59:54+08:00
updated_at: 2026-06-24T17:59:54+08:00
owner: ai
---

# Runtime SQLite Schema Cleanup

## 目标
- 移除 `kerminal.db` 中历史遗留运行态表的 schema 留存路径，当前运行态 SQLite 只保留仍由代码读写的 MCP 工具调用表。

## 非目标
- 不直接修改用户本机 `~/.kerminal/kerminal.db`。
- 不恢复旧 app-wide SQLite 数据读取或迁移兼容。
- 不清理命令域 `data/command.sqlite`。

## 影响范围
- `src-tauri/src/storage/migrations.rs`
- `src-tauri/tests/storage_foundation.rs`
- 必要时同步相邻存储测试或文档。

## 执行步骤
- [x] 定位历史表来源和当前调用链。
- [x] 删除遗留表保留路径，并让迁移明确清理旧表。
- [x] 更新针对性测试覆盖新旧库迁移后的表集合。
- [x] 运行存储相关 Rust 测试。

## 验证
- `cargo test --test storage_foundation`

## 风险
- 迁移会删除 `local_file_operation_audits` 和 `port_forward_sessions` 这类已迁出 SQLite 的历史空表；不影响当前 JSONL/JSON 文件存储事实源。

## Round Log
- 2026-06-24T17:50:21+08:00：登记计划和 lane；准备按只改运行态 SQLite schema 的边界执行。
- 2026-06-24T17:59:54+08:00：`CURRENT_SCHEMA_VERSION` 升到 2，v2 迁移直接删除 `local_file_operation_audits` 和 `port_forward_sessions`；新增 v1 旧库清理测试。验证：`cargo test --test storage_foundation` 通过 12/12，`cargo test --test diagnostics_service` 通过 2/2，均使用 `CARGO_TARGET_DIR=target-runtime-schema-cleanup`。
