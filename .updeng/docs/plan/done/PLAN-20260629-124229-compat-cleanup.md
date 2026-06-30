---
id: PLAN-20260629-124229-compat-cleanup
status: done
created_at: 2026-06-29T12:42:29+08:00
started_at: 2026-06-29T12:42:29+08:00
completed_at: 2026-06-29T15:22:47+08:00
updated_at: 2026-06-29T15:22:47+08:00
owner: ai
lane: lane-compat-cleanup
---

# 兼容性代码清理

## 目标

- 清理仓库里的兼容性代码路径，包括但不限于 SSH 密码/凭据相关 legacy 明文存储、fallback、迁移和旧口径文档。
- 新运行时只保留当前产品事实：SSH password / inline private key 写入 encrypted vault；没有 vault secret 时按缺失凭据处理，而不是读取旧明文兼容文件。

## 非目标

- 不删除用户机器上的实际 `~/.kerminal` 数据文件。
- 不扩大到无证据的产品功能重写；每轮先删除已定位的兼容路径并补验证。

## 影响范围

- `src-tauri/src/models/remote_host.rs`
- `src-tauri/src/storage/config_file_store.rs`
- `src-tauri/src/services/remote_host_service.rs`
- `src-tauri/src/services/ssh_credential_resolver.rs`
- `src-tauri/src/services/workspace_sync_service.rs`
- `src-tauri/src/services/mcp_tool_executor_service/*`
- `src-tauri/tests/*`
- `src/lib/remoteHostApi.ts`
- README 与配置手册中兼容/legacy 口径

## 执行步骤

- [x] TASK-001 删除 SSH host legacy plaintext secrets 读取、迁移、fallback 与测试。
- [x] TASK-002 扫描并删除其它 password/credential 兼容口径，例如 validator legacy warning、MCP migration tool、`.gitignore` 旧明文目录规则。
- [x] TASK-003 扫描仓库剩余 `legacy`、`fallback`、`compat` 标记，区分真实兼容代码和普通命名后继续清理。
- [x] TASK-004 跑 Rust/前端/build/启动验证，更新文档口径并收口。

## 验证

- `cargo fmt --check`
- `cargo test --test remote_host_service --test config_file_store --test ssh_credential_resolver`
- 视改动范围追加 MCP/config/workspace sync 测试、`npm run build` 和真实 dev server/tauri 启动。

## 风险

- 删除 legacy 明文兼容后，旧 `secrets/hosts/*.toml` 不再被自动读取或迁移；用户需要重新保存凭据到 vault。
- 当前工作区已有大量未提交改动，本计划只做最小兼容清理，不回滚其它 lane 的改动。

## Round Log

### 2026-06-29T12:42:29+08:00

- 用户目标更新为“清理所有兼容性代码，包括不限于密码相关的”。
- 回读 AGENTS/README/Updeng/in-progress/BLOCKERS/plan/coordination/git diff，确认当前 SSH vault 计划仍保留 legacy plaintext source、migration 和 fallback 作为兼容能力。
- 本轮从 TASK-001 开始，先删除 SSH host `secrets/hosts/*.toml` 明文读取、迁移服务和 resolver legacy fallback。

### 2026-06-29T13:18:10+08:00

- 完成 TASK-001/TASK-002：SSH host 不再读取、写入或迁移 `secrets/hosts/*.toml`；resolver 没有 `secret_ref` 时返回 prompt-only；validator、workspace sync、config watcher、diagnostics preview、外部 Agent 生成手册和配置手册均改为 encrypted vault-only 口径。
- 额外清理：`ConfigPathClassification.secret` 与旧 secret 文件权限 helper 已删除；`ConfigFileStore` 落盘前清空 jump host transient `credential_secret`；README 改为 `secret_ref` + encrypted vault；`ServerInfoRequest.target` 改为必填，移除 service 层旧 `host_id` 兜底；删除 `PortForwardService::close` 旧 alias，MCP port-forward close 工具直接调用 `stop`。
- 扫描结果：`LegacyPlaintext`、`legacyPlaintext`、`migrate_legacy`、`kerminal.host.migrate_legacy_secrets`、`RemoteHostSecretsTomlDocument`、`HOST_SECRETS_RELATIVE_DIR`、`remote_host_secret_relative_path`、`legacy plaintext`、`legacy 明文` 在生产代码和文档中已清空；仅保留 `mcp_streamable_http_server` 中“迁移工具不得出现在 tools/list”的负向测试断言。
- 验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml`；`CARGO_TARGET_DIR=target-codex-compat-cleanup cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test remote_host_service --test config_file_store --test ssh_credential_resolver --test config_change_observer_service --test workspace_sync_service --test mcp_streamable_http_server --test external_agent_workspace`；`cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test server_info_service --test mcp_streamable_http_server --test mcp_tool_executor_service --test port_forward_service_plan`；`npm run test -- src/lib/serverInfoApi.test.ts src/lib/diagnosticsApi.test.ts src/lib/remoteHostApi.test.ts`；`npm run build`。
- 验证备注：第一次 Rust 多测试并行链接触发 Windows `link.exe` LNK1201/PDB 写入失败，改为 `-j 1` 后通过；后续一次编译出现 Windows incremental finalize `Access is denied` warning，但测试继续并通过。
- 剩余 TASK-003：仓库仍有非密码兼容口径需要逐块清理或判定，例如 SFTP 旧字段/旧全局队列语义、workspace session legacy pane target 迁移、前端 legacy Docker/Compose 字段、settings legacy payload enrich，以及普通 fallback/终端协议 compatibility 中哪些属于产品必要能力。

### 2026-06-29T13:55:17+08:00

- TASK-003 本轮清理 SFTP/SSH command 兼容路径：`SftpTransferSummary.operation/source/target/transport_mode` 从可空旧字段改为必填结构化字段；后端所有 SFTP enqueue 路径直接写入结构化 operation/source/target/transport mode；前端 `SftpTransferSummary` 类型同步改为必填，并删除 `sftpTransferModel` 对缺失 source/target 和 snake_case remote endpoint 的旧 payload 兼容展示。
- SFTP/SSH command 密码运行态改为 vault-only：`sftp_service::resolve_endpoint` 和 saved-host `SshCommandService::execute_native` 先通过 `SshCredentialResolver + EncryptedVaultService` 物化运行态 host，再交给 native SFTP/SSH 执行；测试改为通过 `RemoteHostService::create_host` 写入 vault，不再绕过服务把 transient `credential_secret` 直接写 TOML。
- 清理旧口径文案：SFTP/SSH command native auth 错误从“需要保存明文 SSH 密码”改为“需要已保存 SSH 密码”。扫描 `legacy plaintext`、`migrate_legacy`、`LegacyPlaintext`、`legacyPlaintext`、`RemoteHostSecretsTomlDocument`、`HOST_SECRETS_RELATIVE_DIR`、`remote_host_secret_relative_path`、SFTP 旧字段可空类型和“旧字段保留用于兼容”只剩 `mcp_streamable_http_server` 中迁移 tool 不应出现在 tools/list 的负向断言。
- 验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml`；`npm run test -- src/features/sftp/sftpTransferModel.test.ts src/features/sftp/sftp-tool-content/sftpTransferSyncModel.test.ts src/features/sftp/sftpTransferNotificationModel.test.ts src/features/sftp/useSftpTransferQueueSync.test.ts`；`npm run build`；`CARGO_TARGET_DIR=target-codex-compat-cleanup cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test sftp_service --test ssh_command_service --test ssh_credential_resolver`。
- 验证备注：默认 Rust target 被当前运行中的 `src-tauri/target/debug/kerminal.exe` 锁住，报 `failed to remove file ... kerminal.exe` / `Access is denied`；改用隔离 `target-codex-compat-cleanup` 后通过，验证后已删除该隔离 target 目录。

### 2026-06-29T14:02:46+08:00

- TASK-003 本轮清理 settings keybinding payload 兼容路径：`normalizeKeybindings` 不再从旧 `binding` 字段或默认值补推 `windowsBinding/macBinding`；缺少平台绑定的 keybinding payload 直接跳过，保留当前默认配置。
- 测试同步删除“legacy settings payload 自动填 appearance defaults”口径，并把“legacy keybinding payload enrich”改为“不完整 keybinding payload 被忽略且默认值保留”。
- 验证通过：`npm run test -- src/features/settings/settingsModel.test.ts`；`npm run build`。

### 2026-06-29T14:29:00+08:00

- TASK-003 本轮清理 SFTP 冲突策略兼容路径：`SftpTransferRequest`、managed transfer、remote copy、archive download/upload 的 `conflict_policy/conflictPolicy` 从缺失时默认 overwrite 改为请求契约必填；移除 Rust `#[serde(default)]`、`Default` enum 入口和“旧行为/兼容旧传输行为”注释。
- 前端所有 SFTP transfer/remote copy/archive/clipboard upload 构造点改为显式发送 `conflictPolicy: "overwrite"`，冲突预检弹窗确认后仍用用户选择覆盖；browser preview adapter 也按新契约向内部 managed transfer 传递策略。
- 测试同步：旧“缺 conflictPolicy 反序列化为 overwrite”的 Rust 用例改为缺字段拒绝；前端 API/model/runner 测试 fixture 均补显式策略。
- 扫描结果：`default_conflict_policy`、`deserialize_default_conflict`、`deserializes_default_conflict`、`为空时保持旧行为`、`兼容旧传输行为`、`旧的全局队列任务` 和 SFTP 模型里的 `#[serde(default)]` 已清空。
- 验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml`；`CARGO_TARGET_DIR=target-codex-compat-cleanup cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test sftp_service`；`npm run test -- src/features/sftp/sftp-tool-content/sftpTransferActionPlan.test.ts src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.test.ts src/features/sftp/sftp-tool-content/sftpTransferConflictPreflight.test.ts src/features/sftp/sftp-tool-content/useSftpTransferActions.helpers.test.ts src/features/sftp/sftp-tool-content/sftpRemoteCopyTaskRunnerModel.test.ts src/features/sftp/sftp-tool-content/sftpTransferTaskRunnerModel.test.ts src/features/sftp/sftp-tool-content/useSftpRemoteCopyTaskRunner.test.ts src/features/sftp/sftp-tool-content/useSftpTransferTaskRunner.test.ts src/features/sftp/LocalTransferPane.test.tsx src/lib/sftpApi.test.ts`；`npm run build`。
- 验证备注：第一次 `npm run build` 暴露剩余测试 fixture 和 browser preview adapter 仍构造缺 `conflictPolicy` 请求；已补齐后重跑前端测试和 build 通过。隔离 Rust target `target-codex-compat-cleanup` 已删除。

### 2026-06-29T14:34:37+08:00

- TASK-003 本轮清理 workspace session 旧快照 target 迁移：删除 `migrateLegacyPaneTarget` 和版本判断，pane 只保留快照中显式 `target`；缺 target 的快照不再根据 `mode/machineId/profileId/containerId` 自动派生 target。
- 测试同步：`workspaceSession.test.ts` 将旧“legacy workspace session snapshots 自动迁移 pane target”用例改为“缺 target ref 不派生 pane target”，保留显式 target 的当前恢复测试。
- 验证通过：`npm run test -- src/features/workspace/workspaceSession.test.ts`；`npm run build`。
- 验证备注：第一次 workspace session 聚焦测试暴露 `localTarget/dockerContainerTarget` 仍被 sidebar machine 归一化使用；已恢复这两个当前逻辑需要的 import，未恢复 pane target 旧迁移。

### 2026-06-29T15:04:09+08:00

- TASK-003 本轮继续清理前端和端口转发兼容残留：`composeProjectModel` 删除旧 `composeProject/composeService/project` 字段和 `working_dir/config_files/config_paths/container_number/runtime_family` snake_case metadata 读取；设置页删除 `settings-terminal` 初始 section 映射并把终端外观 DOM id 改为 `settings-appearance-terminal-panel`；连接弹窗删除旧 Docker default mode、Docker host guidance、旧 Docker 创建回调、旧 Docker 面板文件和相关测试；SFTP workbench 删除 `initialLeftHostId` 作为右侧初始服务器的旧 fallback；SFTP remote drag 删除旧路径数组 MIME `application/x-kerminal-sftp-entry-paths`，只保留 `text/plain` 和完整 source host 元数据下的结构化 remote drag payload；port-forward 删除旧 request/summary JSON 反序列化兼容测试。
- 扫描清理：本轮目标范围内 `SFTP_REMOTE_DOWNLOAD_DRAG_MIME`、`application/x-kerminal-sftp-entry-paths`、`initialLeftHostId`、`defaultMode="docker"`、`DockerHostContextGuidancePanel`、`DockerContainerCreateRequest`、`settings-terminal` 初始入口、`LegacyComposeContainerFields`、Compose snake_case metadata 读取均已清空；`HostContainerList` 的非 Compose 分组组件从 `LegacyGroupList` 改名为 `ContainerGroupList`，测试数据中的 `legacy-*` 命名改为中性名称。
- 验证通过：`npm run test -- src/features/machine-sidebar/host-containers/composeProjectModel.test.ts src/features/settings/SettingsToolContent.test.tsx src/features/machine-sidebar/RemoteHostCreateDialog.test.tsx src/features/machine-sidebar/remote-host-dialog/connection-check.test.ts src/features/sftp/SftpTransferWorkbench.test.tsx src/features/sftp/sftp-tool-content/sftpRemoteTransferModel.test.ts src/features/sftp/sftp-tool-content/useSftpRemoteDownloadDragActions.test.ts src/features/sftp/sftp-tool-content/sftpTransferSyncModel.test.ts src/features/sftp/sftp-tool-content/useSftpTransferSync.test.ts`；`npm run build`；`$env:CARGO_TARGET_DIR='target-codex-compat-cleanup'; cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test port_forward_service_plan`。
- 验证备注：包含 `src/app/KerminalShell.test.tsx` 的宽前端测试批次中，除本轮聚焦文件外有既有 Xterm mock 缺 `attachCustomKeyEventHandler` 和 profile assertion 失败，未作为本轮清理阻塞；隔离 Rust target 冷编译耗时约 9 分钟，验证后已删除 `target-codex-compat-cleanup`。

### 2026-06-29T15:22:47+08:00

- TASK-003/TASK-004 收口审计：把剩余测试夹具里的 `legacy` telnet/RDP/tmux 命名改为中性 `lab/saved/primary` 命名，避免把普通测试数据误判为旧契约兼容；`DockerContainerSummary.labels` 注释从“供前端兼容”改为“供当前 UI 展示和排障使用”。
- 扫描结论：密码旧路径关键词 `LegacyPlaintext`、`legacyPlaintext`、`migrate_legacy`、`migrateLegacy`、`legacy plaintext`、`legacy 明文`、`RemoteHostSecretsTomlDocument`、`HOST_SECRETS_RELATIVE_DIR`、`remote_host_secret_relative_path`、`credential_secret.*fallback`、`secret_ref.*fallback` 已无生产实现；`secrets/hosts` 只剩“不监听/不生成/不写入/不暴露迁移工具”的负向断言；`kerminal.host.migrate_legacy_secrets` 只保留在 MCP tools/list 负向测试里。
- 剩余 `compat/兼容/legacy` 命中已分类为当前产品能力或说明，不属于旧数据/API 兼容代码：README 与配置手册声明不迁移早期 SQLite；Agent/xterm/real xterm 输入兼容矩阵；tmux 输出格式错误提示；Podman 兼容 API；POSIX sh 远端发现脚本；npm `--legacy-peer-deps` 命令建议字面量。
- 验证通过：`npm run test -- src/features/workspace/workspaceTerminalOpenState.test.ts src/features/workspace/workspaceStore.test.ts src/features/workspace/workspaceStore.terminalTabs.test.ts src/lib/targetModel.test.ts src/lib/terminalApi.test.ts src/features/machine-sidebar/MachineSidebar.test.tsx src/features/machine-sidebar/RemoteHostCreateDialog.serialTelnet.test.tsx src/features/terminal/XtermPane.sessionTargets.test.tsx`；`$env:CARGO_TARGET_DIR='target-codex-compat-cleanup-2'; cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test connection --test remote_host_service --test telnet_terminal_service --test tmux_service`；`cargo fmt --manifest-path src-tauri/Cargo.toml --check`；`npm run build`；dev server `http://127.0.0.1:1425/` HTTP 200 冒烟；`npm run tauri:dev` 编译并完成 desktop setup。
- 验证备注：第一次使用 `target-codex-compat-cleanup` 创建隔离 target 被 Windows 拒绝访问，改用 `target-codex-compat-cleanup-2` 通过；验证后已删除该隔离 target。`npm run build` 仍有既有 dynamic import/chunk size warning。`npm run tauri:dev` 启动日志显示 `AppState initialized and managed`、config watcher、window icon、tray 和 `Kerminal desktop setup completed`。
