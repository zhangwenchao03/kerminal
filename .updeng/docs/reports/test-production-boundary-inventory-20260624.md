# 测试代码与正式代码边界盘点

整理时间：2026-06-25T03:55:23+08:00。

## 规则口径

- 测试夹具、mock、fake、fixture、断言辅助、smoke/harness 入口应放在 `tests/`、`__tests__/`、`*.test.*` 或明确 test-support 目录/命名空间。
- `src/` 与 `src-tauri/src/` 下的生产运行代码不应依赖测试辅助；生产代码只保留必要可注入接口、稳定抽象和运行时实现。
- 当前 active MCP lane 占用 `src/features/settings/**`、Tauri MCP/storage/shared paths；本报告先标记这些候选，默认延后处理。

## 已处理切片

### Frontend / machine-sidebar

已迁移：

- `src/features/machine-sidebar/MachineSidebar.testSupport.ts`
- `src/features/machine-sidebar/RemoteHostCreateDialog.testSupport.ts`

迁移到：

- `src/features/machine-sidebar/__tests__/support/MachineSidebar.testSupport.ts`
- `src/features/machine-sidebar/__tests__/support/RemoteHostCreateDialog.testSupport.ts`

引用更新：

- `src/features/machine-sidebar/MachineSidebar.externalDrag.test.tsx`
- `src/features/machine-sidebar/MachineSidebar.test.tsx`
- `src/features/machine-sidebar/machineSidebarMenuModel.test.ts`
- `src/features/machine-sidebar/machineSidebarMenuDomain.test.tsx`
- `src/features/machine-sidebar/RemoteHostCreateDialog.serialTelnet.test.tsx`
- `src/features/machine-sidebar/RemoteHostCreateDialog.test.tsx`

验证：

- `rg --files src/features/machine-sidebar | rg "testSupport"` 只剩 `__tests__/support/**` 下两个文件。
- `rg -n "\.\/MachineSidebar\.testSupport|\.\/RemoteHostCreateDialog\.testSupport" src/features/machine-sidebar` 无旧相对导入命中。
- `npm run test:frontend -- src/features/machine-sidebar/MachineSidebar.test.tsx src/features/machine-sidebar/MachineSidebar.externalDrag.test.tsx src/features/machine-sidebar/machineSidebarMenuModel.test.ts src/features/machine-sidebar/machineSidebarMenuDomain.test.tsx src/features/machine-sidebar/RemoteHostCreateDialog.serialTelnet.test.tsx` 通过，5 个文件 47 个测试通过。

残余：

- 同批包含 `RemoteHostCreateDialog.test.tsx` 的完整测试运行有 2 个失败，断言找不到“多个标签可用逗号...”和“请选择主机后读取远端容器。”；导入已解析，失败点是当前工作区已有 UI 文案/状态断言漂移，不属于本次 test-support 迁移。

### Frontend / workspace

已迁移：

- `src/features/workspace/workspaceStore.testSupport.ts`

迁移到：

- `src/features/workspace/__tests__/support/workspaceStore.testSupport.ts`

引用更新：

- `src/features/workspace/workspaceTerminalOpenState.test.ts`
- `src/features/workspace/workspaceStore.terminalTabs.test.ts`
- `src/features/workspace/workspaceStore.terminalOpen.test.ts`
- `src/features/workspace/workspaceStore.test.ts`

验证：

- `rg -n "\.\/workspaceStore\.testSupport" src/features/workspace` 无旧相对导入命中。
- `npm run test:frontend -- src/features/workspace/workspaceStore.test.ts src/features/workspace/workspaceStore.terminalTabs.test.ts src/features/workspace/workspaceStore.terminalOpen.test.ts src/features/workspace/workspaceTerminalOpenState.test.ts` 通过，4 个文件 78 个测试通过。

### Frontend / app shell

已迁移：

- `src/app/KerminalShell.testSupport.tsx`

迁移到：

- `src/app/__tests__/support/KerminalShell.testSupport.tsx`

引用更新：

- `src/app/KerminalShell.test.tsx`
- `src/app/KerminalShell.splitDrop.test.tsx`

验证：

- `rg --files src/app | rg "KerminalShell\.testSupport"` 只剩 `src/app/__tests__/support/KerminalShell.testSupport.tsx`。
- `npm run test:frontend -- src/app/KerminalShell.test.tsx src/app/KerminalShell.splitDrop.test.tsx` 通过，2 个文件 30 个测试通过。
- `npm run build` 通过，仅 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5197 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:5197/ -TimeoutSec 45` 返回 `status=200 length=644`。第一次 10 秒请求因首屏转换超时，后续请求通过。

同步说明：

- `src/app/KerminalShell.test.tsx` 当前也是 `lane-apple-glass-background` owned path；本轮已读取该 lane 计划和当前 diff，只做 test-support import 路径同步，未修改其 UI/material 断言。

### Frontend / terminal XtermPane

已迁移：

- `src/features/terminal/XtermPane.testSupport.tsx`

迁移到：

- `src/features/terminal/__tests__/support/XtermPane.testSupport.tsx`

引用更新：

- `src/features/terminal/XtermPane.test.tsx`
- `src/features/terminal/XtermPane.commandRail.test.tsx`
- `src/features/terminal/XtermPane.contextMenu.test.tsx`
- `src/features/terminal/XtermPane.inlineSuggestions.test.tsx`
- `src/features/terminal/XtermPane.remoteSuggestions.test.tsx`
- `src/features/terminal/XtermPane.sessionTargets.test.tsx`

验证：

- `rg -n "\./XtermPane\.testSupport" src/features/terminal` 无旧相对导入命中。
- `rg --files src/features/terminal | rg "XtermPane\.testSupport"` 只剩 `src/features/terminal/__tests__/support/XtermPane.testSupport.tsx`。
- `npm run test:frontend -- src/features/terminal/XtermPane.test.tsx src/features/terminal/XtermPane.commandRail.test.tsx src/features/terminal/XtermPane.contextMenu.test.tsx src/features/terminal/XtermPane.inlineSuggestions.test.tsx src/features/terminal/XtermPane.remoteSuggestions.test.tsx src/features/terminal/XtermPane.sessionTargets.test.tsx` 通过，6 个文件 60 个测试通过。
- `npm run build` 通过，用时 4m17s，仅 Vite chunk size warning。

### Frontend / terminal workspace

已迁移：

- `src/features/terminal/TerminalWorkspace.testSupport.ts`

迁移到：

- `src/features/terminal/__tests__/support/TerminalWorkspace.testSupport.ts`

引用更新：

- `src/features/terminal/TerminalWorkspace.test.tsx`
- `src/features/terminal/TerminalWorkspace.broadcast.test.tsx`
- `src/features/terminal/TerminalWorkspace.dropOverlay.test.tsx`
- `src/features/terminal/TerminalPaneCard.test.tsx`

验证：

- CodeGraph 确认 `workspaceProps` 只被 4 个测试文件引用，没有生产调用方。
- `rg -n "\./TerminalWorkspace\.testSupport" src/features/terminal` 无旧相对导入命中。
- `rg --files src/features/terminal | rg "TerminalWorkspace\.testSupport"` 只剩 `src/features/terminal/__tests__/support/TerminalWorkspace.testSupport.ts`。
- `npm run test:frontend -- src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/TerminalWorkspace.broadcast.test.tsx src/features/terminal/TerminalWorkspace.dropOverlay.test.tsx src/features/terminal/TerminalPaneCard.test.tsx` 通过，4 个文件 45 个测试通过。
- `npm run build` 通过，仅 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5199 --strictPort` 启动成功；首页请求返回 `status=200 length=644`。

同步说明：

- `TerminalPaneCard.test.tsx` 曾属于已完成的 Apple lane，本轮只同步 test-support import 路径，不改其 UI/material 断言。

### Frontend / SFTP tool content

已迁移：

- `src/features/sftp/SftpToolContent.testSupport.tsx`

迁移到：

- `src/features/sftp/__tests__/support/SftpToolContent.testSupport.tsx`

引用更新：

- `src/features/sftp/SftpToolContent.test.tsx`
- `src/features/sftp/SftpToolContent.clipboard.test.tsx`
- `src/features/sftp/SftpToolContent.dialogs.test.tsx`
- `src/features/sftp/SftpToolContent.localDrop.test.tsx`
- `src/features/sftp/SftpToolContent.remoteBrowser.test.tsx`
- `src/features/sftp/SftpToolContent.selection.test.tsx`
- `src/features/sftp/SftpToolContent.transfers.test.tsx`
- `src/features/sftp/SftpToolContent.workspaceDialog.test.tsx`

验证：

- `rg -n "\./SftpToolContent\.testSupport" src/features/sftp` 无旧相对导入命中。
- `rg --files src/features/sftp | rg "SftpToolContent\.testSupport"` 只剩 `src/features/sftp/__tests__/support/SftpToolContent.testSupport.tsx`。
- `npm run test:frontend -- src/features/sftp/SftpToolContent.test.tsx src/features/sftp/SftpToolContent.clipboard.test.tsx src/features/sftp/SftpToolContent.dialogs.test.tsx src/features/sftp/SftpToolContent.localDrop.test.tsx src/features/sftp/SftpToolContent.remoteBrowser.test.tsx src/features/sftp/SftpToolContent.selection.test.tsx src/features/sftp/SftpToolContent.transfers.test.tsx src/features/sftp/SftpToolContent.workspaceDialog.test.tsx` 通过，8 个文件 62 个测试通过。
- `npm run build` 通过，仅 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5198 --strictPort` 启动成功；首页请求返回 `status=200 length=644`。

同步说明：

- SFTP 测试文件当前还有其它未归因或其它 lane 来源的行为断言变更；本整理 lane 只认领 test-support 迁移、import 同步和 `SftpToolContent.test.tsx` 中当前 UI 文案断言兼容。

### Frontend / settings

已迁移：

- `src/features/settings/SettingsToolContent.testHarness.tsx`

迁移到：

- `src/features/settings/__tests__/support/SettingsToolContent.testHarness.tsx`

引用更新：

- `src/features/settings/SettingsToolContent.test.tsx`
- `src/features/settings/SettingsToolContent.controls.test.tsx`
- `src/features/settings/SettingsToolContent.about.test.tsx`

验证：

- CodeGraph 和 `rg` 确认该 harness 只被 settings 测试直接引用。
- `rg -n "\./SettingsToolContent\.testHarness" src/features/settings` 无旧相对导入命中。
- `rg --files src/features/settings | rg "SettingsToolContent\.testHarness"` 只剩 `src/features/settings/__tests__/support/SettingsToolContent.testHarness.tsx`。
- `npm run test:frontend -- src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsToolContent.controls.test.tsx src/features/settings/SettingsToolContent.about.test.tsx` 通过，3 个文件 11 个测试通过。
- `npm run build` 通过，仅 Vite chunk size warning。
- `npm run dev -- --host 127.0.0.1 --port 5200 --strictPort` 启动成功；首页请求返回 `status=200 length=644`。

### Rust / SFTP transfer paths helper

已移除生产路径中的测试专用 helper：

- `src-tauri/src/services/sftp_service/transfer_paths.rs` 中 `#[cfg(test)] clipboard_download_target_path_in`
- `src-tauri/src/services/sftp_service/transfer_paths.rs` 中 `#[cfg(test)] unique_local_path`

测试调整：

- `src-tauri/src/services/sftp_service/tests/archive_clipboard.rs` 中同名下载目标和文件名清洗用例改用生产 `reserve_clipboard_download_target_path_in`。
- 用临时目录断言生产 reservation 的文件占位和目录占位副作用，避免保留一套只在测试里绕过文件系统的路径推算逻辑。
- `src-tauri/src/services/sftp_service.rs` 的 `#[cfg(test)]` import 收窄到仍被测试使用的 `classify_clipboard_local_paths` 与 `reserve_clipboard_download_target_path_in`。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/sftp_service.rs src-tauri/src/services/sftp_service/transfer_paths.rs src-tauri/src/services/sftp_service/tests/archive_clipboard.rs` 通过。
- `rg -n "clipboard_download_target_path_in|unique_local_path" src-tauri/src/services/sftp_service` 确认旧 helper 无残留引用；仅剩生产 reservation 函数和测试调用。
- `git diff --check -- src-tauri/src/services/sftp_service.rs src-tauri/src/services/sftp_service/transfer_paths.rs src-tauri/src/services/sftp_service/tests/archive_clipboard.rs` 通过。

补充验证：

- `cargo test --manifest-path src-tauri/Cargo.toml clipboard_download_target` 后续复跑通过，3 个匹配测试通过，0 失败。

### Rust / SFTP transfer IO inline tests

已迁移：

- `src-tauri/src/services/sftp_service/transfer_io.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/sftp_service.rs`

覆盖行为：

- 本地冲突重命名候选保留文件扩展名。
- `open_local_write_target` 在 `skip` 策略下不覆盖已有文件。
- `open_local_write_target` 在 `rename` 策略下创建编号候选文件。
- `prepare_local_directory_root` 在 `skip` 策略下保留已有目录树。
- `prepare_local_directory_root` 在 `rename` 策略下创建编号候选目录。

生产代码调整：

- `sftp_service::rules` 新增 doc-hidden 窄导出，暴露上述运行时规则给集成测试。
- `transfer_io` 中对应运行时 helper 只提升到父模块可见，不新增测试专用 helper。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/sftp_service.rs src-tauri/src/services/sftp_service/transfer_io.rs src-tauri/tests/sftp_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|numbered_candidate_name_preserves|open_local_write_target_skip|prepare_local_directory_root_skip" src-tauri/src/services/sftp_service/transfer_io.rs src-tauri/tests/sftp_service.rs` 只在集成测试文件命中迁移后的测试函数。
- `git diff --check -- src-tauri/src/services/sftp_service.rs src-tauri/src/services/sftp_service/transfer_io.rs src-tauri/tests/sftp_service.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-boundary cargo test --manifest-path src-tauri/Cargo.toml --test sftp_service` 通过，11 个测试通过，0 失败。

### Rust / SFTP transfer emitter cfg cleanup

已收敛：

- `src-tauri/src/services/sftp_service/transfer.rs` 中 `#[cfg(test)]` 空 `TransferEventEmitter`。
- `src-tauri/src/services/sftp_service/transfer.rs` 中 `#[cfg(not(test))]` 生产 emitter、事件常量和时间 helper import 条件编译。
- `src-tauri/src/services/sftp_service/transfer_lifecycle.rs` 与 `transfer_registry.rs` 中 window façade 的 `#[cfg(not(test))]` 条件编译。

生产代码调整：

- `TransferEventEmitter` 统一为同一个运行时类型，测试构建不再使用生产路径内的 no-op 替身。
- `unix_timestamp_millis` 恢复为普通运行时 helper，供统一 emitter 在所有构建下使用。
- window façade 在测试构建和生产构建中保持同一 API 形状，没有新增测试专用入口。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/sftp_service.rs src-tauri/src/services/sftp_service/transfer.rs src-tauri/src/services/sftp_service/transfer_lifecycle.rs src-tauri/src/services/sftp_service/transfer_registry.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|#\\[cfg\\(not\\(test\\)\\)\\]|mod tests|TransferEventEmitter;" src-tauri/src/services/sftp_service/transfer.rs src-tauri/src/services/sftp_service/transfer_lifecycle.rs src-tauri/src/services/sftp_service/transfer_registry.rs` 无命中。
- `git diff --check -- src-tauri/src/services/sftp_service.rs src-tauri/src/services/sftp_service/transfer.rs src-tauri/src/services/sftp_service/transfer_lifecycle.rs src-tauri/src/services/sftp_service/transfer_registry.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-emitter-boundary cargo test --manifest-path src-tauri/Cargo.toml --test sftp_service` 通过，11 个测试通过，0 失败。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-lib-boundary cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` 通过，仅既有 `src-tauri/src/commands/file_dialog.rs` unused import 警告。

残余：

- 直接运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib services::sftp_service` 的测试二进制在当前 Windows 环境报 `STATUS_ENTRYPOINT_NOT_FOUND`，编译已完成；后续若需要 full lib runtime test，应单独诊断该本机入口点问题。

### Rust / SFTP validation tests

已迁移：

- `src-tauri/src/services/sftp_service/tests/validation.rs`

迁移到：

- `src-tauri/tests/sftp_service/validation.rs`

生产代码调整：

- `src-tauri/tests/sftp_service.rs` 使用显式 `#[path = "sftp_service/validation.rs"] mod validation;` 挂载子测试模块。
- `sftp_service::rules` 继续作为 doc-hidden 运行时规则入口，补充预览字节数归一化、chmod/路径校验、远端复制归一化、剪贴板本地路径分类、shell delete 安全规则、远端复制 staging 策略、ZIP 归档和 native host-key policy 校验入口。
- 未把 fake/mock/test-only helper 放入生产路径；新增入口均直接委托既有运行时函数或运行时结构。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/sftp_service.rs src-tauri/src/services/sftp_service/tests/mod.rs src-tauri/tests/sftp_service.rs src-tauri/tests/sftp_service/validation.rs` 通过。
- `git diff --check -- src-tauri/src/services/sftp_service.rs src-tauri/src/services/sftp_service/tests/mod.rs src-tauri/src/services/sftp_service/tests/validation.rs src-tauri/tests/sftp_service.rs src-tauri/tests/sftp_service/validation.rs` 通过，仅 Git CRLF 提示。
- `rg --files src-tauri/src/services/sftp_service/tests src-tauri/tests/sftp_service` 确认生产 SFTP tests 目录不再有 `validation.rs`，新集成测试目录包含 `validation.rs`。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-validation-boundary cargo test --manifest-path src-tauri/Cargo.toml --test sftp_service` 通过，25 个测试通过，0 失败，无新增 warning。

残余：

- `src-tauri/src/services/sftp_service.rs` 仍通过 `#[cfg(test)] mod tests;` 挂载剩余 SFTP 大测试目录，`fake_backend.rs`、`support.rs`、`archive_clipboard.rs`、`transfer_queue.rs`、`native_backend.rs`、`native_jump_backend.rs` 和 `loopback.rs` 仍需后续分批迁移。

### Rust / terminal manager tests

已迁移：

- `src-tauri/src/services/terminal_manager/tests.rs`
- `src-tauri/src/services/terminal_manager.rs` 中的 `#[cfg(test)] fn secret_prompt_matches`
- `src-tauri/src/services/terminal_manager.rs` 底部 `#[cfg(test)] mod tests;`

迁移到：

- `src-tauri/tests/terminal_manager.rs`

生产代码调整：

- 新增 `terminal_manager::rules::secret_prompt_matches` 作为 doc-hidden 运行时规则入口，直接委托生产 secret prompt 匹配逻辑。
- 未新增测试专用 fake/mock/helper 到生产路径；原生产路径测试目录已删除。

覆盖行为：

- generic `password:` prompt 后缀、`enter password:` 和 `password for ...`。
- password history / status line false positive。
- specific marker 不接受前缀噪声。
- 终端控制序列前缀清理。
- banner / split prompt 只匹配最后一行。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/terminal_manager.rs src-tauri/tests/terminal_manager.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|terminal_manager/tests|include!\\(" src-tauri/src/services/terminal_manager.rs src-tauri/src/services/terminal_manager src-tauri/tests/terminal_manager.rs` 无命中。
- `git diff --check -- src-tauri/src/services/terminal_manager.rs src-tauri/src/services/terminal_manager/tests.rs src-tauri/tests/terminal_manager.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-terminal-manager-boundary cargo test --manifest-path src-tauri/Cargo.toml --test terminal_manager` 通过，21 个测试通过，0 失败。

### Rust / target model inline tests

已迁移：

- `src-tauri/src/models/target.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/target_model.rs`

覆盖行为：

- `RemoteTargetRef::DockerContainer` camelCase tagged enum 序列化。
- 容器目标缺少 `container_id` 时返回 `AppError::InvalidInput`。
- Telnet / Serial 目标类型、stable id、host id 和 terminal-only capabilities。
- `FileLocation::new` 规范化远端路径。
- `TargetDescriptor::new` 使用目标 stable id。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/models/target.rs src-tauri/tests/target_model.rs` 通过。
- `rg -n "cfg\\(test\\)|mod tests|serde_json::json" src-tauri/src/models/target.rs src-tauri/tests/target_model.rs` 确认生产模型文件无测试模块残留，`serde_json::json` 只在集成测试文件中。
- `git diff --check -- src-tauri/src/models/target.rs src-tauri/tests/target_model.rs` 通过。

补充验证：

- `cargo test --manifest-path src-tauri/Cargo.toml --test target_model` 后续复跑通过，6 个测试通过，0 失败。

### Rust / redaction inline tests

已迁移：

- `src-tauri/src/security/redaction.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/redaction.rs`

覆盖行为：

- hyphenated `sk-...` token 脱敏。
- escaped newline 后的 `sk-...` token 脱敏。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/security/redaction.rs src-tauri/tests/redaction.rs` 通过。
- `rg -n "cfg\\(test\\)|mod tests|redacts_hyphenated|redacts_sk_tokens" src-tauri/src/security/redaction.rs src-tauri/tests/redaction.rs` 确认生产安全文件无测试模块残留，测试函数只在集成测试文件中。
- `git diff --check -- src-tauri/src/security/redaction.rs src-tauri/tests/redaction.rs` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test redaction` 通过，2 个测试通过，0 失败。

### Rust / model directory sweep

验证：

- `rg -n "#\\[cfg\\(test\\)\\]|mod tests" src-tauri/src/models` 无命中，当前 `src-tauri/src/models` 目录下 inline test 已清空。

### Rust / storage manifest inline tests

已迁移：

- `src-tauri/src/storage/storage_manifest.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/storage_manifest.rs`

覆盖行为：

- manifest backup failure / repair lifecycle。
- successful apply 后清理 active change set 并记录 last applied id。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/storage/storage_manifest.rs src-tauri/tests/storage_manifest.rs` 通过。
- `rg -n "cfg\\(test\\)|mod tests|manifest_tracks_backup|manifest_clears_active" src-tauri/src/storage/storage_manifest.rs src-tauri/tests/storage_manifest.rs` 确认生产 storage manifest 文件无测试模块残留，测试函数只在集成测试文件中。
- `git diff --check -- src-tauri/src/storage/storage_manifest.rs src-tauri/tests/storage_manifest.rs` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test storage_manifest` 通过，2 个测试通过，0 失败。

### Rust / audit log store inline tests

已迁移：

- `src-tauri/src/storage/audit_log_store.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/audit_log_store.rs`

覆盖行为：

- `AuditLogStore::append_jsonl/read_jsonl` 在 JSONL 文件中存在坏 JSON 行时，返回有效记录并报告 diagnostics。

验证：

- CodeGraph 确认该 inline test 只依赖公开 `AuditLogStore` API 和测试内 `AuditEvent` 夹具，不需要放宽生产 API。
- `rustfmt --edition 2021 --check src-tauri/src/storage/audit_log_store.rs src-tauri/tests/audit_log_store.rs` 通过。
- `rg -n "cfg\\(test\\)|mod tests|jsonl_reader_skips_bad_lines|struct AuditEvent" src-tauri/src/storage/audit_log_store.rs src-tauri/tests/audit_log_store.rs` 确认生产 audit log store 文件无测试模块残留，测试函数和夹具只在集成测试文件中。
- `git diff --check -- src-tauri/src/storage/audit_log_store.rs src-tauri/tests/audit_log_store.rs` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test audit_log_store` 通过，1 个测试通过，0 失败。

### Rust / file store tests

已迁移：

- `src-tauri/src/storage/file_store.rs` 中公开 TOML 读写测试。
- `src-tauri/src/storage/file_store.rs` 中坏 TOML 诊断测试。
- `src-tauri/src/storage/file_store.rs` 中 storage manifest 固定路径/default 测试。
- `src-tauri/src/storage/file_store.rs` 中 lock 文件互斥与释放测试。
- `src-tauri/src/storage/file_store.rs` 中 change set 应用、备份和恢复测试。

迁移到：

- `src-tauri/tests/file_store_toml.rs`
- `src-tauri/tests/file_store_change_set.rs`

生产文件删除：

- `TestSettings` 测试夹具。
- `parse_flat_toml` 测试 helper。
- `#[cfg(test)] mod tests` 整体测试模块。

覆盖行为：

- `FileStore::write_toml/read_toml` 可以用公开 `StorageManifest` 完成 TOML roundtrip。
- `FileStore::read_toml::<StorageManifest>` 遇到坏 TOML 时返回带相对路径的 parse diagnostics。
- `FileStore::write_storage_manifest/read_storage_manifest` 使用固定 `storage-manifest.toml` 路径，缺失时返回默认 manifest。
- `FileStore::acquire_lock` 拒绝第二个 holder，释放后允许重新获取。
- `FileStore::apply_change_set` 多文件写入时持久化 manifest 并保留旧文件 backup。
- `FileStore::restore_change_set` 对没有 backup 的新增文件执行删除，对 partial write 失败场景从 backup 恢复旧内容。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/storage/file_store.rs src-tauri/tests/file_store_toml.rs` 通过。
- `rg -n "TestSettings|parse_flat_toml|toml_roundtrip_writes_and_reads_one_file" src-tauri/src/storage/file_store.rs src-tauri/tests/file_store_toml.rs` 无旧测试夹具、私有 helper 和旧测试函数残留。
- `rg -n "toml_roundtrip_writes_and_reads_storage_manifest|bad_toml_returns_parse_diagnostics_with_path" src-tauri/src/storage/file_store.rs src-tauri/tests/file_store_toml.rs` 确认迁移后的测试函数只在新集成测试文件中。
- `git diff --check -- src-tauri/src/storage/file_store.rs src-tauri/tests/file_store_toml.rs` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test file_store_toml` 通过，2 个测试通过，0 失败。
- `rustfmt --edition 2021 --check src-tauri/src/storage/file_store.rs src-tauri/tests/file_store_change_set.rs src-tauri/tests/file_store_toml.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|backup_existing_file_preserves_previous_contents|backup_existing_returns_none_for_missing_file|lock_file_rejects_second_holder_until_released|change_set_applies_multiple_files_and_persists_manifest|restore_change_set_recovers_partial_write_from_backup" src-tauri/src/storage/file_store.rs` 无命中，生产 file store 文件无测试模块残留。
- `git diff --check -- src-tauri/src/storage/file_store.rs src-tauri/tests/file_store_change_set.rs src-tauri/tests/file_store_toml.rs` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test file_store_change_set` 通过，6 个测试通过，0 失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --test file_store_toml` 通过，2 个测试通过，0 失败。
- `cargo test --manifest-path src-tauri/Cargo.toml storage::file_store::tests` 通过，0 个匹配测试，201 个过滤。

### Rust / config file store inline tests

已迁移：

- `src-tauri/src/storage/config_file_store.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/config_file_store.rs`

覆盖行为：

- settings TOML roundtrip 保持 runtime `AppSettings` 模型。
- profile TOML 逐 profile 文件读写。
- path-like profile id 被拒绝为 invalid path。
- settings schema version 错误返回 TOML parse diagnostics。
- remote host public TOML 与 secrets TOML 分离，并在读取时合并 secrets。
- remote host tree 使用 runtime `__ungrouped__` group，不落盘 `__ungrouped__.toml`。
- public host TOML 中出现 secret 字段时拒绝读取。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/storage/config_file_store.rs src-tauri/tests/config_file_store.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|settings_toml_roundtrip|profile_toml_roundtrip|remote_host_toml" src-tauri/src/storage/config_file_store.rs src-tauri/tests/config_file_store.rs` 确认生产 config file store 文件无测试模块残留，测试函数只在集成测试文件中。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests" src-tauri/src/storage` 无命中，当前 `src-tauri/src/storage` 目录下 inline test 已清空。
- `git diff --check -- src-tauri/src/storage/config_file_store.rs src-tauri/tests/config_file_store.rs` 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test config_file_store` 通过，7 个测试通过，0 失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::config_file_store::tests` 通过，0 个匹配测试，194 个过滤。
- 误跑不带 `--lib` 的 `cargo test --manifest-path src-tauri/Cargo.toml storage::config_file_store::tests` 会尝试编译全体集成测试目标；本机返回 Windows `os error 1455` 页面文件不足并连带 rustc ICE，非 `config_file_store` 测试目标失败，已改用 `--lib` 完成旧路径匹配确认。

### Rust / storage directory sweep

验证：

- `rg -n "#\\[cfg\\(test\\)\\]|mod tests" src-tauri/src/storage` 无命中，当前 `src-tauri/src/storage` 目录下 inline test 已清空。

### Rust / command history service inline tests

已迁移：

- `src-tauri/src/services/command_history_service.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/command_history_service.rs`

覆盖行为：

- `CommandHistoryService::record_command` 对 `\r\n` / `\r` 命令文本做归一化并 trim。
- 敏感 `api_key` 命令不会被记录到历史。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/command_history_service.rs src-tauri/tests/command_history_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|normalize_command_trims|sensitive_command_skip_reason_detects|record_history_normalizes_multiline" src-tauri/src/services/command_history_service.rs src-tauri/tests/command_history_service.rs` 确认生产 command history service 文件无测试模块残留，迁移后的行为测试只在集成测试文件中。
- `git diff --check -- src-tauri/src/services/command_history_service.rs src-tauri/tests/command_history_service.rs` 通过，仅 Git CRLF 提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --test command_history_service` 通过，7 个测试通过，0 失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib services::command_history_service::tests` 通过，0 个匹配测试，192 个过滤。

### Rust / snippet and workflow service inline tests

已迁移：

- `src-tauri/src/services/snippet_service.rs` 底部 `#[cfg(test)] mod tests`
- `src-tauri/src/services/workflow_service.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/snippet_service.rs`
- `src-tauri/tests/workflow_service.rs`

覆盖行为：

- snippet create 会 trim / 去重 tags，空 command 会被公开 create 行为拒绝。
- workflow create 会 trim step title / command，生成 step id 和 sort order，空 steps / 空 command 会被公开 create 行为拒绝。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/snippet_service.rs src-tauri/tests/snippet_service.rs src-tauri/src/services/workflow_service.rs src-tauri/tests/workflow_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|normalize_tags_trims|normalize_required_text_rejects_empty_command|normalize_steps_assigns|normalize_steps_rejects_empty" src-tauri/src/services/snippet_service.rs src-tauri/tests/snippet_service.rs src-tauri/src/services/workflow_service.rs src-tauri/tests/workflow_service.rs` 无命中，生产 service 文件无测试模块残留。
- `git diff --check -- src-tauri/src/services/snippet_service.rs src-tauri/tests/snippet_service.rs src-tauri/src/services/workflow_service.rs src-tauri/tests/workflow_service.rs` 通过，仅 Git CRLF 提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --test snippet_service` 通过，4 个测试通过，0 失败。
- `cargo test --manifest-path src-tauri/Cargo.toml --test workflow_service` 通过，4 个测试通过，0 失败；库编译阶段仅有其它 active lane 的 unused import warning。
- 旧 `--lib services::snippet_service::tests` 验证被 active `lane-agent-session-file-restore` 当前 `src-tauri/src/services/mcp_tool_executor_service/terminal_tools.rs` 测试态编译错误阻断，错误不在本切片文件；以生产文件残留扫描证明内联测试已移除。

### Rust / local files stat inline tests

已迁移：

- `src-tauri/src/commands/local_files/stat.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/local_files_stat.rs`

覆盖行为：

- 公开 async command wrapper `local_files_stat_path` 对 root 内缺失目标返回 `exists = false`。
- 已有文件返回 `file` kind、size 和 modified metadata。
- root 外目标返回“路径超出允许根目录”错误。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/commands/local_files/stat.rs src-tauri/tests/local_files_stat.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|stat_path_reports|local_files_stat_reports" src-tauri/src/commands/local_files/stat.rs src-tauri/tests/local_files_stat.rs` 确认生产 stat 文件无测试模块残留，迁移后的测试函数只在集成测试文件中。
- `git diff --check -- src-tauri/src/commands/local_files/stat.rs src-tauri/tests/local_files_stat.rs` 通过，仅 Git CRLF 提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_files_stat` 通过，3 个测试通过，0 失败。

### Rust / local files write command tests

已迁移：

- `src-tauri/src/commands/local_files/local_files_write_tests.rs`
- `src-tauri/src/commands/local_files/local_files_audit_tests.rs`
- `src-tauri/src/commands/local_files.rs` 底部 `#[cfg(test)] mod local_files_*_tests`

迁移到：

- `src-tauri/tests/local_files_write.rs`

覆盖行为：

- 公开 async command wrapper `local_files_create_directory` / `local_files_copy_path` / `local_files_rename_path` / `local_files_delete_path` 覆盖原 create/copy/rename/delete 成功与拒绝场景。
- `local_files_delete_path` 通过 Tauri mock app 管理的 `AppState` 覆盖确认名不匹配时的失败审计写入，不再直接调用私有 `local_delete_audit_write`。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/commands/local_files.rs src-tauri/tests/local_files_write.rs` 通过。
- `rg -n "local_files_audit_tests|local_files_write_tests|local_delete_audit_write_records_failed_confirmation|mod local_files_|#\\[cfg\\(test\\)\\]" src-tauri/src/commands/local_files.rs src-tauri/src/commands/local_files src-tauri/tests/local_files_write.rs` 无命中。
- `git diff --check -- src-tauri/src/commands/local_files.rs src-tauri/src/commands/local_files/local_files_audit_tests.rs src-tauri/src/commands/local_files/local_files_write_tests.rs src-tauri/tests/local_files_write.rs` 通过，仅 Git CRLF 提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_files_write` 通过，24 个测试通过，0 失败。

### Rust / profile service inline tests

已迁移：

- `src-tauri/src/services/profile_service.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/profile_service.rs`

覆盖行为：

- `AppState::initialize_with_paths` 会 seed 至少一个 terminal profile，且只有一个 default profile。
- `ProfileService::create_profile` 遇到包含 `=` 的 env key 时返回 `AppError::InvalidInput`。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/profile_service.rs src-tauri/tests/profile_service.rs src-tauri/src/services/remote_host_service.rs src-tauri/tests/remote_host_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|detect_shells_returns_at_least_one_candidate|normalize_env_rejects_invalid_keys|normalize_tags_trims_deduplicates|normalize_host_rejects_whitespace" src-tauri/src/services/profile_service.rs src-tauri/tests/profile_service.rs src-tauri/src/services/remote_host_service.rs src-tauri/tests/remote_host_service.rs` 无命中。
- `git diff --check -- src-tauri/src/services/profile_service.rs src-tauri/tests/profile_service.rs src-tauri/src/services/remote_host_service.rs src-tauri/tests/remote_host_service.rs` 通过，仅 Git CRLF 提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --test profile_service` 通过，5 个测试通过，0 失败。

### Rust / remote host service inline tests

已迁移：

- `src-tauri/src/services/remote_host_service.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/remote_host_service.rs`

覆盖行为：

- `RemoteHostService::create_host` 会 trim / 去重 tags，且 telnet / serial 空 username 场景继续按公开行为覆盖。
- `RemoteHostService::create_host` 遇到包含空白字符的 host address 时返回 `AppError::InvalidInput`。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/profile_service.rs src-tauri/tests/profile_service.rs src-tauri/src/services/remote_host_service.rs src-tauri/tests/remote_host_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|detect_shells_returns_at_least_one_candidate|normalize_env_rejects_invalid_keys|normalize_tags_trims_deduplicates|normalize_host_rejects_whitespace" src-tauri/src/services/profile_service.rs src-tauri/tests/profile_service.rs src-tauri/src/services/remote_host_service.rs src-tauri/tests/remote_host_service.rs` 无命中。
- `git diff --check -- src-tauri/src/services/profile_service.rs src-tauri/tests/profile_service.rs src-tauri/src/services/remote_host_service.rs src-tauri/tests/remote_host_service.rs` 通过，仅 Git CRLF 提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --test remote_host_service` 通过，13 个测试通过，0 失败。

### Rust / local network proxy service inline tests

已迁移：

- `src-tauri/src/services/local_network_proxy_service.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- 复用既有 `src-tauri/tests/local_network_proxy_service.rs`

覆盖行为：

- CONNECT tunnel 可以桥接到本地 HTTP 服务。
- absolute-form HTTP 请求会被代理转发。
- 多个 entry 共享同一个 service core，release 后 snapshot 状态正确。
- release entry 后 listener 停止并释放端口。
- 非法 bind host 和非法 target 返回友好错误响应。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/local_network_proxy_service.rs src-tauri/tests/local_network_proxy_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|connect_proxy_bridges_tcp_stream|absolute_form_request_is_rewritten_and_forwarded|entries_are_tagged_and_validate_bind_host|wait_for_entry_stats" src-tauri/src/services/local_network_proxy_service.rs src-tauri/tests/local_network_proxy_service.rs` 无命中。
- `git diff --check -- src-tauri/src/services/local_network_proxy_service.rs src-tauri/tests/local_network_proxy_service.rs` 通过，仅 Git CRLF 提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --test local_network_proxy_service` 首次等待 Cargo artifact lock 后无诊断退出；重跑通过，5 个测试通过，0 失败。

### Rust / file dialog inline tests

已迁移：

- `src-tauri/src/commands/file_dialog.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/src/commands/file_dialog/path_model.rs`
- `src-tauri/tests/file_dialog.rs`

覆盖行为：

- 保存对话框 default path 拆分抽成运行时路径模型，并在集成测试中覆盖空值、文件名和目录/文件名拆分。
- Windows verbatim 路径归一化抽成运行时路径模型，并在集成测试中覆盖 drive 与 UNC 前缀。
- 目录读取改用公开 `file_dialog_list_local_directory` 覆盖目录优先、文件排序、点号隐藏文件和列表路径归一化。
- Unix 下继续覆盖 symlink entry kind；Windows 本轮跑测环境会按 `#[cfg(unix)]` 跳过。

同步说明：

- `src-tauri/src/commands/file_dialog.rs` 已有未归因 diff 删除 `file_dialog_get_app_skills_directory` 和相关 `AppState`/`State` import；本轮保留该变更，只迁移测试边界和抽路径模型。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/commands/file_dialog.rs src-tauri/src/commands/file_dialog/path_model.rs src-tauri/tests/file_dialog.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests" src-tauri/src/commands/file_dialog.rs src-tauri/src/commands/file_dialog/path_model.rs` 无命中。
- `rg -n "default_save_path_parts_ignores_empty_default|read_local_directory_sorts_directories_before_files|read_local_directory_includes_symlink_entries|include!\\(" src-tauri/src/commands/file_dialog.rs src-tauri/src/commands/file_dialog/path_model.rs src-tauri/tests/file_dialog.rs` 无命中。
- `git diff --check -- src-tauri/src/commands/file_dialog.rs src-tauri/src/commands/file_dialog/path_model.rs src-tauri/tests/file_dialog.rs` 通过，仅 Git CRLF 提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --test file_dialog` 通过，5 个测试通过，0 失败。

### Rust / command test-build cfg cleanup

已收敛：

- `src-tauri/src/commands/file_dialog.rs` 中剩余 `#[cfg(not(test))]`。
- `src-tauri/src/commands/mod.rs` 中 command module 级 `#[cfg(not(test))]`。

生产代码调整：

- 文件对话框 command wrapper、dialog helper 和 panic payload helper 在测试构建中也正常编译，不再只对非测试构建可见。
- command 模块入口不再按测试构建隐藏生产 command modules，避免 lib test 编译绕过运行时代码。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/commands/mod.rs src-tauri/src/commands/file_dialog.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|#\\[cfg\\(not\\(test\\)\\)\\]|mod tests|include!\\(" src-tauri/src/commands/mod.rs src-tauri/src/commands/file_dialog.rs src-tauri/src/commands/file_dialog src-tauri/tests/file_dialog.rs` 无命中。
- `git diff --check -- src-tauri/src/commands/mod.rs src-tauri/src/commands/file_dialog.rs src-tauri/src/commands/file_dialog/path_model.rs src-tauri/tests/file_dialog.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-commands-cfg-boundary cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` 通过，仍仅有 SFTP 剩余测试挂载带来的 5 个 warning。
- 同一临时 target 下 `cargo test --manifest-path src-tauri/Cargo.toml --test file_dialog` 通过，5 个测试通过，0 失败。
- 全局残留扫描确认 `commands/file_dialog.rs` 和 `commands/mod.rs` 不再出现。

### Rust / command suggestion service inline tests

已迁移：

- `src-tauri/src/services/command_suggestion_service.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/command_suggestion_service/rules.rs`

生产模型调整：

- `classification` 与 `discovery` 作为 doc-hidden 运行时规则模型导出，供集成测试覆盖真实规则入口。
- `REMOTE_COMMAND_DISCOVERY_SCRIPT` 从根 service 文件移入 `discovery.rs`，继续由生产 refresh 流程通过 `discovery::*` 使用。

覆盖行为：

- 敏感命令和危险命令分类规则。
- 远端 shell history 解析会保留最近、安全、去重的命令。
- 远端命令发现脚本保持 POSIX sh 兼容，不依赖 bash/zsh/fish 专属语法。
- Git discovery 脚本使用 shell `printf` 输出 tab 分隔记录，不把 tab 文本塞进 `git for-each-ref --format`。

同步说明：

- `src-tauri/src/services/command_suggestion_service.rs` 和 `src-tauri/tests/command_suggestion_service.rs` 已有未归因 diff（command store / file store / provider order 调整）；本切片保留这些改动，只迁移测试边界。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/command_suggestion_service.rs src-tauri/src/services/command_suggestion_service/classification.rs src-tauri/src/services/command_suggestion_service/discovery.rs src-tauri/tests/command_suggestion_service.rs src-tauri/tests/command_suggestion_service/rules.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests" src-tauri/src/services/command_suggestion_service.rs src-tauri/src/services/command_suggestion_service/classification.rs src-tauri/src/services/command_suggestion_service/discovery.rs` 无命中。
- `rg -n "sensitive_and_dangerous_patterns_are_classified|remote_history_parser_keeps_recent_unique_safe_commands|remote_command_discovery_script_stays_posix_sh_compatible|git_discovery_script_uses_shell_printf_tabs_for_real_git|include!\\(" src-tauri/src/services/command_suggestion_service.rs src-tauri/src/services/command_suggestion_service/classification.rs src-tauri/src/services/command_suggestion_service/discovery.rs src-tauri/tests/command_suggestion_service.rs src-tauri/tests/command_suggestion_service/rules.rs` 只在新集成测试文件命中测试函数，无 `include!` 绕法。
- `git diff --check -- src-tauri/src/services/command_suggestion_service.rs src-tauri/src/services/command_suggestion_service/classification.rs src-tauri/src/services/command_suggestion_service/discovery.rs src-tauri/tests/command_suggestion_service.rs src-tauri/tests/command_suggestion_service/rules.rs` 通过，仅 Git CRLF 提示。
- 默认 `cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_service` 被默认 target 中仍被占用的 `target/debug/kerminal.exe` 拒绝删除阻断；使用临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-command-suggestion-boundary` 重跑同一测试目标通过，26 个测试通过，0 失败。

### Rust / port forward service plan tests

已迁移：

- `src-tauri/src/services/port_forward_service_tests.rs`
- `src-tauri/src/services/port_forward_service.rs` 底部 `#[path = "port_forward_service_tests.rs"]` 挂载

迁移到：

- `src-tauri/tests/port_forward_service_plan.rs`

生产模型调整：

- `src-tauri/src/services/port_forward_service/plan.rs` 承载端口转发命令计划、route 解析、命令预览和 summary 派生。
- `src-tauri/src/services/port_forward_service.rs` 继续负责 session 生命周期、OpenSSH 进程启动、PTY secret 响应和持久化，不再包含测试模块或 plan/route 私有实现。
- `plan` 模块是 `#[doc(hidden)]` 运行时模型，供生产创建流程和集成测试共用同一套行为入口。

覆盖行为：

- local / remote / dynamic OpenSSH 参数、bind host、target、proxy protocol 和 remote access scope。
- host network assist HTTP / SOCKS 计划与 client-reachable proxy URL。
- inline private key 物化、旧 `credential:` 引用拒绝、key path、agent 和 password 认证计划。
- jump host 临时 OpenSSH config、remote/dynamic jump forward args、多 password secret entries 和敏感信息不进入 args / preview / config / Debug。
- 监听端口、目标主机校验和旧 create/summary JSON 兼容。

同步说明：

- `src-tauri/src/services/port_forward_service.rs` 迁移前已有未归因 diff：`create` / `create_with_context` / `start_with_context` 已改为通过 `RemoteHostService` 获取主机；本切片保留该变更，只抽 plan 模型和删除生产路径测试挂载。
- `src-tauri/tests/port_forward_service.rs` 迁移前已有未归因 diff：`RemoteHostService::create_host` 调用和 file-backed state 断言；本切片只复跑该目标作为回归验证，不认领其语义改动。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/port_forward_service.rs src-tauri/src/services/port_forward_service/plan.rs src-tauri/tests/port_forward_service_plan.rs src-tauri/tests/port_forward_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|port_forward_service_tests|include!\\(" src-tauri/src/services/port_forward_service.rs src-tauri/src/services/port_forward_service/plan.rs src-tauri/tests/port_forward_service_plan.rs` 无命中。
- `git diff --check -- src-tauri/src/services/port_forward_service.rs src-tauri/src/services/port_forward_service/plan.rs src-tauri/src/services/port_forward_service_tests.rs src-tauri/tests/port_forward_service_plan.rs src-tauri/tests/port_forward_service.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-port-forward-plan-boundary cargo test --manifest-path src-tauri/Cargo.toml --test port_forward_service_plan` 通过，20 个测试通过，0 失败。
- 同一临时 target 下 `cargo test --manifest-path src-tauri/Cargo.toml --test port_forward_service` 通过，2 个测试通过，0 失败。

### Rust / docker host service tests

已迁移：

- `src-tauri/src/services/docker_host_service/tests.rs`
- `src-tauri/src/services/docker_host_service.rs` 中 `#[cfg(test)] mod tests` 挂载

迁移到：

- `src-tauri/tests/docker_host_service.rs`

生产模型调整：

- `src-tauri/src/services/docker_host_service.rs` 新增 `#[doc(hidden)] pub mod rules`，只导出容器列表/目录/预览/文本元数据解析、容器终端请求构建、exec 脚本构建和 tar stream helper 这些生产运行时已经使用的规则函数。
- `parsing.rs`、`script.rs`、`terminal_request.rs`、`text_file.rs`、`transfer.rs` 中被 `rules` 复用的函数改为可导出；没有新增测试专用 helper，也没有恢复生产路径测试模块。

覆盖行为：

- Docker/Podman JSON line 容器列表解析、短 id、运行状态、端口和 target stable id。
- 容器终端 OpenSSH + `docker exec -it` 参数构建、user/workdir/shell/container id 引号处理和空 container id 拒绝。
- 容器目录 `ls -la` 输出解析、目录优先排序、symlink 名称处理。
- 文件预览字节 marker、文本文件元数据 marker、revision hash 优先比较和容器编辑器行尾检测。
- 容器 exec 脚本参数 quoting、上传 tar stream 写入和下载 tar stream 首个文件提取。

同步说明：

- `src-tauri/src/services/docker_host_service.rs`、`script.rs`、`terminal_request.rs`、`text_file.rs` 迁移前已有未归因 diff：服务 API 正从 `SqliteStore` 迁到 `RemoteHostService` / 更新 `SshCommandService::execute_native` 调用；本切片保留这些改动，只删除生产路径测试挂载、添加 `rules` 导出和迁移测试。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/docker_host_service.rs src-tauri/src/services/docker_host_service/parsing.rs src-tauri/src/services/docker_host_service/script.rs src-tauri/src/services/docker_host_service/terminal_request.rs src-tauri/src/services/docker_host_service/text_file.rs src-tauri/src/services/docker_host_service/transfer.rs src-tauri/tests/docker_host_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|docker_host_service/tests|include!\\(" src-tauri/src/services/docker_host_service.rs src-tauri/src/services/docker_host_service src-tauri/tests/docker_host_service.rs` 无命中。
- `git diff --check -- src-tauri/src/services/docker_host_service.rs src-tauri/src/services/docker_host_service/parsing.rs src-tauri/src/services/docker_host_service/script.rs src-tauri/src/services/docker_host_service/terminal_request.rs src-tauri/src/services/docker_host_service/text_file.rs src-tauri/src/services/docker_host_service/transfer.rs src-tauri/src/services/docker_host_service/tests.rs src-tauri/tests/docker_host_service.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-docker-host-boundary cargo test --manifest-path src-tauri/Cargo.toml --test docker_host_service` 通过，10 个测试通过，0 失败。

### Rust / telnet terminal service inline tests

已迁移：

- `src-tauri/src/services/telnet_terminal_service.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/telnet_terminal_service.rs`

生产模型调整：

- `build_telnet_terminal_request` 通过 `#[doc(hidden)] pub mod rules` 窄导出，供集成测试复用生产运行时 builder 规则。
- 没有新增测试专用 helper；保留当前文件已有未归因 `RemoteHostService` API 迁移。

覆盖行为：

- Telnet 终端请求使用 host/port 参数化构建。
- 非 telnet tag 主机被拒绝。
- 终端行列为 0 时被拒绝。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/telnet_terminal_service.rs src-tauri/tests/telnet_terminal_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|telnet_terminal_service/tests|include!\\(" src-tauri/src/services/telnet_terminal_service.rs src-tauri/tests/telnet_terminal_service.rs` 无命中。
- `git diff --check -- src-tauri/src/services/telnet_terminal_service.rs src-tauri/tests/telnet_terminal_service.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-terminal-service-boundary cargo test --manifest-path src-tauri/Cargo.toml --test telnet_terminal_service` 通过，3 个测试通过，0 失败。

### Rust / diagnostics service inline tests

已迁移：

- `src-tauri/src/services/diagnostics_service.rs` 底部 Windows-only `#[cfg(all(test, target_os = "windows"))] mod tests`

迁移到：

- `src-tauri/tests/diagnostics_service.rs`

生产模型调整：

- `parse_windows_gpu_json` 通过 `#[cfg(target_os = "windows")] #[doc(hidden)] pub mod rules` 窄导出，供集成测试复用生产运行时 GPU 解析规则。
- 没有新增测试专用 helper；保留当前文件已有未归因 `create_bundle` 显式传入 `AppSettings` 和移除旧 AI settings 输出的改动。

覆盖行为：

- Windows GPU JSON parser 保留 adapter/vendor、driver、显存总量、dedicated usage 和 utilization 四舍五入。
- 既有诊断包测试继续覆盖脱敏摘要 JSON 和 runtime health 采样。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/diagnostics_service.rs src-tauri/tests/diagnostics_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|parse_windows_gpu_json_keeps_usage|include!\\(" src-tauri/src/services/diagnostics_service.rs src-tauri/tests/diagnostics_service.rs` 只在新集成测试文件命中测试函数。
- `git diff --check -- src-tauri/src/services/diagnostics_service.rs src-tauri/tests/diagnostics_service.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-diagnostics-boundary cargo test --manifest-path src-tauri/Cargo.toml --test diagnostics_service` 通过，3 个测试通过，0 失败。

### Rust / serial terminal service inline tests

已迁移：

- `src-tauri/src/services/serial_terminal_service.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/serial_terminal_service.rs`

生产模型调整：

- `build_plink_serial_terminal_request` 通过 `#[doc(hidden)] pub mod rules` 窄导出，供集成测试复用生产运行时串口命令构建规则。
- `SerialClient::Plink` 不再依赖 `cfg(test)` 编译；它是串口命令规划模型的一部分，实际客户端自动选择仍由平台 resolver 决定。
- 没有新增测试专用 helper；保留当前文件已有未归因 `SqliteStore` -> `RemoteHostService` API 调整。

覆盖行为：

- Serial plink 终端请求使用标签中的 port、baud、data bits、stop bits、parity 和 flow 生成 `-sercfg` 参数。
- 缺省配置使用 host 地址和 `9600,8,n,1,N`。
- 非 serial tag、非法 baud 和零尺寸请求返回 `InvalidInput`。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/serial_terminal_service.rs src-tauri/tests/serial_terminal_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|build_serial_terminal_request_uses|build_serial_terminal_request_rejects|include!\\(" src-tauri/src/services/serial_terminal_service.rs src-tauri/tests/serial_terminal_service.rs` 无命中。
- `git diff --check -- src-tauri/src/services/serial_terminal_service.rs src-tauri/tests/serial_terminal_service.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-serial-boundary cargo test --manifest-path src-tauri/Cargo.toml --test serial_terminal_service` 通过，5 个测试通过，0 失败。

### Rust / connection command inline tests

已迁移：

- `src-tauri/src/commands/connection.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/connection.rs`

覆盖行为：

- RDP IPv6 full address 生成 bracketed 地址。
- RDP 文件内容包含 full address、username、desktop width、password blob 和 credential prompt 标记。
- 保存 RDP 密码解析优先使用 host 明文明文 `credential_secret`，不回退 legacy credential ref。
- TCP endpoint 测试能连到本地 listener。
- Telnet 连接测试表单归一化允许空 username，并保留 tag。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/commands/connection.rs src-tauri/tests/connection.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|formats_ipv6_full_address_for_rdp_file|builds_rdp_content_with_core_fields|include!\\(" src-tauri/src/commands/connection.rs src-tauri/tests/connection.rs` 只在新集成测试文件命中测试函数。
- `git diff --check -- src-tauri/src/commands/connection.rs src-tauri/tests/connection.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-connection-boundary cargo test --manifest-path src-tauri/Cargo.toml --test connection` 通过，5 个测试通过，0 失败。

### Rust / SSH terminal service inline tests

已迁移：

- `src-tauri/src/services/ssh_terminal_service.rs` 底部 `#[cfg(test)] mod tests`

迁移到：

- `src-tauri/tests/ssh_terminal_service.rs`

覆盖行为：

- SSH terminal request 通过公开 service 行为覆盖 known_hosts、TERM、identity file、password prompt 和 jump host config。
- 远端 cwd 支持绝对路径进入和单引号 quote。
- 零尺寸请求返回 `InvalidInput`。
- 临时 interactive SSH identity 文件清理只删除 managed key，并遵守 age gate。
- jump host password secret plan 不把 jump/target 密码泄漏到 argv，并保留 redaction 值。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/ssh_terminal_service.rs src-tauri/tests/ssh_terminal_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|build_ssh_terminal_request_uses|build_jump_terminal_launch_uses|cleanup_temporary_identity_files_removes|include!\\(" src-tauri/src/services/ssh_terminal_service.rs src-tauri/tests/ssh_terminal_service.rs` 只在集成测试文件命中迁移后的测试函数。
- `git diff --check -- src-tauri/src/services/ssh_terminal_service.rs src-tauri/tests/ssh_terminal_service.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-ssh-terminal-boundary cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service` 通过，16 个测试通过，0 失败。

### Rust / SSH command service production-path tests

已迁移：

- `src-tauri/src/services/ssh_command_service.rs` 底部 `#[cfg(test)] mod tests;`
- `src-tauri/src/services/ssh_command_service/tests.rs`

迁移到：

- `src-tauri/tests/ssh_command_service.rs`

覆盖行为：

- OpenSSH command plan 参数、identity file、`~` identity path 展开和控制字符拒绝。
- native auth material 解析 password、inline private key、key path 和缺失密码拒绝。
- loopback native command 执行、jump host direct-tcpip、untrusted host key 拒绝和 test connection trust unknown key。
- 命令脚本 CRLF/NUL/空命令归一化与输出截断边界。

验证：

- `rustfmt --edition 2021 --check src-tauri/src/services/ssh_command_service.rs src-tauri/tests/ssh_command_service.rs` 通过。
- `rg -n "#\\[cfg\\(test\\)\\]|mod tests|ssh_command_service/tests|include!\\(" src-tauri/src/services/ssh_command_service.rs src-tauri/src/services/ssh_command_service src-tauri/tests/ssh_command_service.rs` 无命中。
- `git diff --check -- src-tauri/src/services/ssh_command_service.rs src-tauri/src/services/ssh_command_service/tests.rs src-tauri/tests/ssh_command_service.rs` 通过，仅 Git CRLF 提示。
- 临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-ssh-command-boundary cargo test --manifest-path src-tauri/Cargo.toml --test ssh_command_service` 通过，18 个测试通过，0 失败。

## Frontend 候选

| 优先级 | 候选 | 证据 | 建议 |
| --- | --- | --- | --- |
| done | `src/app/KerminalShell.testSupport.tsx` | 文件名为 testSupport，含 `vi.hoisted`、大量 `vi.mock` 和 Xterm mock；只被 `KerminalShell.test.tsx` / `KerminalShell.splitDrop.test.tsx` 引用。 | 已迁到 `src/app/__tests__/support/`。 |
| done | `src/features/workspace/workspaceStore.testSupport.ts` | 文件名为 testSupport，只被 workspace store 相关测试引用。 | 已迁到 `src/features/workspace/__tests__/support/`。 |
| done | `src/features/terminal/TerminalWorkspace.testSupport.ts` | 文件名为 testSupport，只被 terminal workspace / pane card 测试引用。 | 已迁到 `src/features/terminal/__tests__/support/`。 |
| done | `src/features/terminal/XtermPane.testSupport.tsx` | `rg` 确认只被 6 个 `XtermPane*.test.tsx` 直接引用，含 `MockTerminal` / `MockFitAddon` / `MockSearchAddon` 等测试 mock。 | 已迁到 `src/features/terminal/__tests__/support/`。 |
| done | `src/features/sftp/SftpToolContent.testSupport.tsx` | 含 SFTP、Docker container、file dialog、webview、event 等 API mocks；被 8 个 `SftpToolContent*.test.tsx` 引用。 | 已迁到 `src/features/sftp/__tests__/support/`。 |
| done | `src/features/settings/SettingsToolContent.testHarness.tsx` | settings MCP lane 已收口后复核，`rg` 确认只被 3 个 settings 测试直接引用。 | 已迁到 `src/features/settings/__tests__/support/`。 |

## Rust/Tauri 候选

| 优先级 | 候选 | 证据 | 建议 |
| --- | --- | --- | --- |
| done | `src-tauri/src/commands/local_files/local_files_write_tests.rs` / `local_files_audit_tests.rs` | command tests 位于生产 command 子目录，仅由 `local_files.rs` 的 `#[cfg(test)] mod ...` 挂载。 | 已迁到 `src-tauri/tests/local_files_write.rs`；测试改用公开 async command wrapper，delete audit 改用 Tauri mock app + AppState 公开行为覆盖。 |
| done | `src-tauri/src/services/terminal_manager/tests.rs` | tests 文件位于生产服务目录，并有 `#[cfg(test)] fn secret_prompt_matches(...)` 私有 wrapper。 | 已迁到 `src-tauri/tests/terminal_manager.rs`；secret prompt 匹配通过 `terminal_manager::rules` 窄导出，生产 service 文件无测试模块残留。 |
| done | `src-tauri/src/services/port_forward_service_tests.rs` | `_tests.rs` 文件位于 `src-tauri/src/services`，由 `#[path = "port_forward_service_tests.rs"]` 挂载。 | 已迁到 `src-tauri/tests/port_forward_service_plan.rs`；端口转发命令计划抽到 `src-tauri/src/services/port_forward_service/plan.rs` 作为 doc-hidden 运行时模型。 |
| done | `src-tauri/src/services/docker_host_service/tests.rs` | tests 文件位于生产服务目录，覆盖容器列表/目录/预览/文本解析、终端请求、exec 脚本和 tar stream helper。 | 已迁到 `src-tauri/tests/docker_host_service.rs`；生产运行时规则通过 `docker_host_service::rules` 窄导出。 |
| done | `src-tauri/src/services/sftp_service/transfer_paths.rs` 内 `#[cfg(test)]` helper | `clipboard_download_target_path_in`、`unique_local_path` 只被 `sftp_service/tests/archive_clipboard.rs` 使用。 | 已删除测试专用 helper，测试改用生产 `reserve_clipboard_download_target_path_in` 和临时目录断言 reservation 副作用。 |
| done | `src-tauri/src/services/sftp_service/transfer_io.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖本地传输冲突命名、skip 和 rename 写入策略，可通过 doc-hidden 运行时规则入口从集成测试覆盖。 | 已迁到 `src-tauri/tests/sftp_service.rs`；生产 `transfer_io.rs` 无测试模块残留，`sftp_service::rules` 窄导出本地传输规则。 |
| done | `src-tauri/src/models/target.rs` 底部 `#[cfg(test)] mod tests` | 测试只覆盖公开 `RemoteTargetRef`、`TargetCapabilities`、`TargetDescriptor` 和 `FileLocation` 行为，不依赖私有函数。 | 已迁到 `src-tauri/tests/target_model.rs`，生产模型文件无测试模块残留。 |
| done | `src-tauri/src/security/redaction.rs` 底部 `#[cfg(test)] mod tests` | 测试只覆盖公开 `redact_terminal_text` 行为，不依赖私有函数。 | 已迁到 `src-tauri/tests/redaction.rs`，生产安全文件无测试模块残留。 |
| done | `src-tauri/src/storage/storage_manifest.rs` 底部 `#[cfg(test)] mod tests` | 测试只覆盖公开 `StorageManifest`、`ChangeSetStatus` 和 `ManifestRepairState` 行为，不依赖私有函数。 | 已迁到 `src-tauri/tests/storage_manifest.rs`，生产 storage manifest 文件无测试模块残留。 |
| done | `src-tauri/src/storage/audit_log_store.rs` 底部 `#[cfg(test)] mod tests` | 测试只覆盖公开 `AuditLogStore::append_jsonl/read_jsonl` 行为，不依赖私有函数。 | 已迁到 `src-tauri/tests/audit_log_store.rs`，生产 audit log store 文件无测试模块残留。 |
| done | `src-tauri/src/storage/file_store.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖 TOML、manifest、lock、backup/change-set/restore 行为；可通过公开 `FileStore` / `FileStoreChange` 行为和标准 `fs` 测试准备表达。 | 已迁到 `src-tauri/tests/file_store_toml.rs` 与 `src-tauri/tests/file_store_change_set.rs`；生产 file store 文件无测试模块残留。 |
| done | `src-tauri/src/storage/config_file_store.rs` 底部 `#[cfg(test)] mod tests` | 测试覆盖公开 `ConfigFileStore` settings/profile/remote host TOML 行为，不依赖私有函数。 | 已迁到 `src-tauri/tests/config_file_store.rs`；生产 config file store 文件无测试模块残留，storage 目录 inline test 已清空。 |
| done | `src-tauri/src/services/ssh_command_service/tests.rs` | tests 文件位于生产服务目录，含 loopback/fake server helper。 | 已迁到 `src-tauri/tests/ssh_command_service.rs`；生产 service 文件只保留 `ssh_command_service::rules` 窄导出命令归一化、输出截断和 native auth summary，loopback fake server helper 只存在于集成测试文件。 |
| done | `src-tauri/src/services/sftp_service/transfer.rs` 测试态 emitter | 原文件用 `#[cfg(test)]` 空 `TransferEventEmitter` 替换生产事件 emitter，并用 `#[cfg(not(test))]` 隐藏 window façade。 | 已统一为运行时 emitter 类型，`transfer.rs`、`transfer_lifecycle.rs`、`transfer_registry.rs` 不再有测试条件分支；测试构建用同一 API 编译。 |
| done | `src-tauri/src/services/mcp_tool_executor_service/port_forward_tools.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖 MCP `port_forward.create` host network assist 参数解析和非法 proxy protocol 拒绝。 | 已迁到 `src-tauri/tests/mcp_tool_executor_service.rs`；`mcp_tool_executor_service::rules` 只窄导出真实运行时 MCP 参数解析规则，生产 executor 文件无测试模块残留。 |
| P1 | `src-tauri/src/services/sftp_service/tests/**` | `rg --files` 显示剩余 `fake_backend.rs`、`support.rs`、`archive_clipboard.rs`、`transfer_queue.rs`、`native_backend.rs`、`native_jump_backend.rs` 和 `loopback.rs` 位于 `src-tauri/src` 生产树；`validation.rs` 已迁出；`sftp_service.rs` 仍通过 `#[cfg(test)] mod tests;` 引入。 | 已先迁出纯规则验证到 `src-tauri/tests/sftp_service/validation.rs`；剩余 fake/support/loopback/queue/archive/native backend 测试继续独立设计迁移到 `src-tauri/tests/sftp_service/**` 或测试 support crate/module。 |
| done | `src-tauri/src/services/command_history_service.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖私有 normalize/sensitive helper；可通过公开 `record_command/list_history` 行为表达。 | 已迁入既有 `src-tauri/tests/command_history_service.rs`，生产 service 文件无测试模块残留。 |
| done | `src-tauri/src/services/snippet_service.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖私有 normalize_tags / normalize_required_text helper；既有集成测试可通过公开 create 行为覆盖。 | 已由 `src-tauri/tests/snippet_service.rs` 覆盖，生产 service 文件无测试模块残留。 |
| done | `src-tauri/src/services/workflow_service.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖私有 normalize_steps helper；既有集成测试可通过公开 create 行为覆盖。 | 已由 `src-tauri/tests/workflow_service.rs` 覆盖，生产 service 文件无测试模块残留。 |
| done | `src-tauri/src/commands/local_files/stat.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖 stat path 行为；可通过公开 `local_files_stat_path` command wrapper 覆盖。 | 已迁到 `src-tauri/tests/local_files_stat.rs`，生产 stat 文件无测试模块残留。 |
| done | `src-tauri/src/services/profile_service.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖 shell detection 和私有 env normalize helper；可通过公开初始化 seed 与 create profile 行为覆盖。 | 已由 `src-tauri/tests/profile_service.rs` 覆盖，生产 service 文件无测试模块残留。 |
| done | `src-tauri/src/services/remote_host_service.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖私有 tags/host normalize helper；既有集成测试已覆盖 tag normalize，新补 host address whitespace 拒绝。 | 已由 `src-tauri/tests/remote_host_service.rs` 覆盖，生产 service 文件无测试模块残留。 |
| done | `src-tauri/src/services/local_network_proxy_service.rs` 底部 `#[cfg(test)] mod tests` | 生产 service 文件内联网络代理测试；既有集成测试已覆盖 CONNECT、absolute-form、entry lifecycle 和错误响应。 | 已删除生产文件内联测试，复用 `src-tauri/tests/local_network_proxy_service.rs` 覆盖公开 service 行为。 |
| done | `src-tauri/src/services/diagnostics_service.rs` 底部 Windows-only `#[cfg(all(test, target_os = "windows"))] mod tests` | 原测试覆盖 Windows GPU JSON parser；既有 `src-tauri/tests/diagnostics_service.rs` 可承载诊断服务集成测试。 | 已迁到 `src-tauri/tests/diagnostics_service.rs`；Windows GPU parser 通过 `diagnostics_service::rules` 窄导出。 |
| done | `src-tauri/src/commands/file_dialog.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖保存路径拆分、Windows verbatim 路径归一化和本地目录列表排序；私有 pure helper 先抽成生产路径模型，再由集成测试覆盖。 | 已迁到 `src-tauri/tests/file_dialog.rs`，并新增 `src-tauri/src/commands/file_dialog/path_model.rs` 作为运行时路径模型；生产 command 文件无测试模块残留。 |
| done | `src-tauri/src/commands/file_dialog.rs` / `src-tauri/src/commands/mod.rs` 中的 `#[cfg(not(test))]` | 原先在测试构建下隐藏文件对话框 command wrapper 和大部分 command modules，导致 lib test 编译绕过生产 command 入口。 | 已去掉这些 `cfg(not(test))`；`cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` 在临时 target 下通过，command modules 在测试构建中可编译。 |
| done | `src-tauri/src/services/command_suggestion_service.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖分类、远端 history parser、远端命令发现脚本和 Git discovery 脚本规则；可抽为 doc-hidden 运行时规则模型并由现有集成测试目标覆盖。 | 已迁到 `src-tauri/tests/command_suggestion_service/rules.rs`；`classification` / `discovery` 窄导出运行时规则模型，生产 service 文件无测试模块残留。 |
| done | `src-tauri/src/services/telnet_terminal_service.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖 Telnet 终端请求 builder、tag 校验和尺寸校验。 | 已迁到 `src-tauri/tests/telnet_terminal_service.rs`；builder 通过 `telnet_terminal_service::rules` 窄导出。 |
| done | `src-tauri/src/services/serial_terminal_service.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖 Serial plink 终端请求 builder、tag/baud/尺寸校验。 | 已迁到 `src-tauri/tests/serial_terminal_service.rs`；plink builder 通过 `serial_terminal_service::rules` 窄导出，`SerialClient::Plink` 不再依赖 `cfg(test)`。 |
| done | `src-tauri/src/commands/connection.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖 RDP 文件构建、保存 RDP 密码解析、TCP endpoint 和连接测试表单归一化。 | 已迁到 `src-tauri/tests/connection.rs`；RDP/TCP/表单规则通过 `connection::rules` 窄导出，生产 command 文件无测试模块残留。 |
| done | `src-tauri/src/services/ssh_terminal_service.rs` 底部 `#[cfg(test)] mod tests` | 原测试覆盖 SSH terminal argv、remote cwd quote、identity file、临时 identity 清理和 jump host secret plan。 | 已并入 `src-tauri/tests/ssh_terminal_service.rs`；jump launch / temporary identity cleanup 通过 `ssh_terminal_service::rules` 窄导出，生产 service 文件无测试模块残留。 |
| P3 | 多个 `src-tauri/src/** #[cfg(test)] mod tests` | 已清空 models/storage 内联测试，并迁出 connection、terminal_manager、ssh_terminal_service、ssh_command_service、sftp transfer_io、command_history_service、snippet_service、workflow_service、profile_service、remote_host_service、local_network_proxy_service、diagnostics_service、file_dialog、command_suggestion_service、port_forward_service、local_files/stat、telnet_terminal_service、serial_terminal_service、mcp port forward executor 内联或生产路径测试；commands `cfg(not(test))` 已清空；其它目录仍需后续重新盘点。 | 当前全局残留扫描只剩 SFTP 大测试挂载和 external-agent/MCP 相关内联测试，后续按模块逐步拆。 |

## 下一步建议

1. 前端本轮已处理明确 testSupport/testHarness 候选；后续新增候选应重新盘点，避免在当前超大脏工作区里误认其它 lane 改动。
2. Rust 下一刀优先处理 SFTP 大测试挂载；MCP/external-agent 相关 inline tests 需要按 done lane 边界单独评估。
3. Tauri/Rust 候选当前还需避开其它 done lane 的 accepted 边界和未归因 diff，触碰前先读对应计划与当前 diff。

## 本轮总体验证

- machine-sidebar 相邻测试通过：5 个文件 47 个测试。
- workspace 相邻测试通过：4 个文件 78 个测试。
- app shell 相邻测试通过：2 个文件 30 个测试。
- terminal XtermPane 相邻测试通过：6 个文件 60 个测试。
- terminal workspace 相邻测试通过：4 个文件 45 个测试。
- SFTP tool content 相邻测试通过：8 个文件 62 个测试。
- settings 相邻测试通过：3 个文件 11 个测试。
- Rust SFTP transfer paths helper 验证通过：`rustfmt --edition 2021 --check`、旧 helper 引用 `rg` 检查、`git diff --check` 和 `cargo test --manifest-path src-tauri/Cargo.toml clipboard_download_target` 均通过。
- Rust target model inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件残留 `rg` 检查、`git diff --check` 和 `cargo test --manifest-path src-tauri/Cargo.toml --test target_model` 均通过。
- Rust redaction inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件残留 `rg` 检查、`git diff --check` 和 `cargo test --manifest-path src-tauri/Cargo.toml --test redaction` 均通过。
- Rust storage manifest inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件残留 `rg` 检查、`git diff --check` 和 `cargo test --manifest-path src-tauri/Cargo.toml --test storage_manifest` 均通过。
- Rust audit log store inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件残留 `rg` 检查、`git diff --check` 和 `cargo test --manifest-path src-tauri/Cargo.toml --test audit_log_store` 均通过。
- Rust file store tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check`、`cargo test --manifest-path src-tauri/Cargo.toml --test file_store_toml`、`cargo test --manifest-path src-tauri/Cargo.toml --test file_store_change_set` 和 `cargo test --manifest-path src-tauri/Cargo.toml storage::file_store::tests` 均通过。
- Rust config file store inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、storage 目录残留 `rg` 检查、`git diff --check`、`cargo test --manifest-path src-tauri/Cargo.toml --test config_file_store` 和 `cargo test --manifest-path src-tauri/Cargo.toml --lib storage::config_file_store::tests` 均通过。
- Rust command history service inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check`、`cargo test --manifest-path src-tauri/Cargo.toml --test command_history_service` 和 `cargo test --manifest-path src-tauri/Cargo.toml --lib services::command_history_service::tests` 均通过。
- Rust snippet/workflow service inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check`、`cargo test --manifest-path src-tauri/Cargo.toml --test snippet_service` 和 `cargo test --manifest-path src-tauri/Cargo.toml --test workflow_service` 均通过；旧 `--lib` 路径确认被其它 active lane 测试态编译错误阻断，残留以 `rg` 无命中为准。
- Rust local files stat inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和 `cargo test --manifest-path src-tauri/Cargo.toml --test local_files_stat` 均通过。
- Rust local files write/audit command tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和 `cargo test --manifest-path src-tauri/Cargo.toml --test local_files_write` 均通过。
- Rust profile/remote host service inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check`、`cargo test --manifest-path src-tauri/Cargo.toml --test profile_service` 和 `cargo test --manifest-path src-tauri/Cargo.toml --test remote_host_service` 均通过。
- Rust local network proxy service inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和 `cargo test --manifest-path src-tauri/Cargo.toml --test local_network_proxy_service` 均通过；首次 cargo test 等 artifact lock 后无诊断退出，重跑通过。
- Rust file dialog inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、旧测试名和 `include!` 残留 `rg` 检查、`git diff --check` 和 `cargo test --manifest-path src-tauri/Cargo.toml --test file_dialog` 均通过。
- Rust command suggestion service inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、旧测试名和 `include!` 残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-command-suggestion-boundary cargo test --manifest-path src-tauri/Cargo.toml --test command_suggestion_service` 均通过，26 个测试通过；默认 target 重跑被已占用的 `target/debug/kerminal.exe` 拒绝删除阻断。
- Rust port forward service plan tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check`、临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-port-forward-plan-boundary cargo test --manifest-path src-tauri/Cargo.toml --test port_forward_service_plan` 和同一临时 target 下 `cargo test --manifest-path src-tauri/Cargo.toml --test port_forward_service` 均通过，分别 20 个和 2 个测试通过。
- Rust docker host service tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-docker-host-boundary cargo test --manifest-path src-tauri/Cargo.toml --test docker_host_service` 均通过，10 个测试通过。
- Rust telnet terminal service inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-terminal-service-boundary cargo test --manifest-path src-tauri/Cargo.toml --test telnet_terminal_service` 均通过，3 个测试通过。
- Rust diagnostics service inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-diagnostics-boundary cargo test --manifest-path src-tauri/Cargo.toml --test diagnostics_service` 均通过，3 个测试通过。
- Rust serial terminal service inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-serial-boundary cargo test --manifest-path src-tauri/Cargo.toml --test serial_terminal_service` 均通过，5 个测试通过。
- Rust connection command inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-connection-boundary cargo test --manifest-path src-tauri/Cargo.toml --test connection` 均通过，5 个测试通过。
- Rust SSH terminal service inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-ssh-terminal-boundary cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service` 均通过，16 个测试通过。
- Rust SSH command service production-path tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-ssh-command-boundary cargo test --manifest-path src-tauri/Cargo.toml --test ssh_command_service` 均通过，18 个测试通过。
- Rust SFTP transfer IO inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-boundary cargo test --manifest-path src-tauri/Cargo.toml --test sftp_service` 均通过，11 个测试通过。
- Rust SFTP transfer emitter cfg cleanup 验证通过：`rustfmt --edition 2021 --check`、`transfer.rs` / `transfer_lifecycle.rs` / `transfer_registry.rs` 残留 `rg` 检查、`git diff --check`、临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-emitter-boundary cargo test --manifest-path src-tauri/Cargo.toml --test sftp_service` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-lib-boundary cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` 均通过；直接运行 `--lib services::sftp_service` 的测试二进制仍受本机 `STATUS_ENTRYPOINT_NOT_FOUND` 阻断。
- Rust SFTP validation tests 迁移验证通过：`rustfmt --edition 2021 --check`、`git diff --check`、`rg --files src-tauri/src/services/sftp_service/tests src-tauri/tests/sftp_service` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-sftp-validation-boundary cargo test --manifest-path src-tauri/Cargo.toml --test sftp_service` 均通过，25 个测试通过且无新增 warning。
- Rust terminal manager tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-terminal-manager-boundary cargo test --manifest-path src-tauri/Cargo.toml --test terminal_manager` 均通过，21 个测试通过。
- Rust command `cfg(not(test))` cleanup 验证通过：`rustfmt --edition 2021 --check`、commands/file_dialog 残留 `rg` 检查、`git diff --check`、临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-commands-cfg-boundary cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` 和同一临时 target 下 `cargo test --manifest-path src-tauri/Cargo.toml --test file_dialog` 均通过；全局残留扫描不再包含 `commands/file_dialog.rs` / `commands/mod.rs`。
- Rust MCP port forward executor inline tests 迁移验证通过：`rustfmt --edition 2021 --check`、生产文件测试模块残留 `rg` 检查、`git diff --check` 和临时 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-mcp-tool-executor-boundary cargo test --manifest-path src-tauri/Cargo.toml --test mcp_tool_executor_service` 均通过，2 个测试通过。
- 当前全局残留扫描剩余：`src-tauri/src/services/external_agent_workspace.rs`、`src-tauri/src/services/mcp_streamable_http_server.rs`、`src-tauri/src/services/mcp_tool_executor_service/ssh_tools.rs` 和 `src-tauri/src/services/sftp_service.rs` 大测试挂载。
- `npm run build` 多次通过；仅有 Vite chunk size warning。
- app shell 迁移后做过真实 dev server 启动冒烟：`npm run dev -- --host 127.0.0.1 --port 5197 --strictPort` 就绪，首页请求返回 `status=200 length=644`。
- SFTP 迁移后做过真实 dev server 启动冒烟：`npm run dev -- --host 127.0.0.1 --port 5198 --strictPort` 就绪，首页请求返回 `status=200 length=644`。
- terminal workspace 迁移后做过真实 dev server 启动冒烟：`npm run dev -- --host 127.0.0.1 --port 5199 --strictPort` 就绪，首页请求返回 `status=200 length=644`。
- settings 迁移后做过真实 dev server 启动冒烟：`npm run dev -- --host 127.0.0.1 --port 5200 --strictPort` 就绪，首页请求返回 `status=200 length=644`。
- 未运行新的 Tauri smoke：当前 Rust 切片只迁移 terminal manager 生产路径测试挂载，聚焦 cargo 构建与集成测试已通过，未扩大到真实 Tauri 启动。
- Rust 聚焦测试当前已恢复并通过；未运行全量 `cargo test`，剩余 Rust/Tauri 候选仍需按后续切片继续迁移和验证。
