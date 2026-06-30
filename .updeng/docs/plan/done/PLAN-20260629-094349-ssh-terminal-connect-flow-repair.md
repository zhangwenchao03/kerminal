---
id: PLAN-20260629-094349-ssh-terminal-connect-flow-repair
status: done
created_at: 2026-06-29T09:43:49+08:00
started_at: 2026-06-29T09:43:49+08:00
completed_at: 2026-06-29T10:12:43+08:00
updated_at: 2026-06-29T10:12:43+08:00
owner: ai
lane: lane-ssh-terminal-connect-flow-repair
---

# SSH 终端连接链路与 password prompt 修复方案

## 目标

- 修复保存过 password 的 SSH 主机打开终端仍停在 `user@host's password:` 的问题。
- 修复同一 SSH 主机双击/重复打开不能新建多个 tab 的问题。
- 不把 password、私钥、vault key、nonce、ciphertext 写入普通配置、日志、文档或前端状态。
- 先把连接链路、失败点和生产级修改方案写入本文，再按本文实施并记录验证结果。

## 当前证据

- 用户截图显示 `172.16.41.60` / `ubuntu@172.16.41.60:22` 终端停在 `ubuntu@172.16.41.60's password:`，说明问题不只是 prompt 显示残留，连接没有完成自动登录。
- 当前用户公开 host 文件 `~/.kerminal/hosts/ddd68b0a-1845-4ac6-97b2-142e49d19c68.toml` 已包含：
  - `auth_type = "password"`
  - `secret_ref = "credential:kerminal:ssh-host:ddd68b0a-1845-4ac6-97b2-142e49d19c68:target:password:v1"`
  - 普通 host TOML 中没有 `credential_secret`。
- `~/.kerminal/secrets/hosts/` 当前为空，说明该 host 不走 legacy plaintext fallback。
- `~/.kerminal/secrets/vault.toml` 存在 encrypted entry，entry 的 associated data 与 host `secret_ref` 对应；不应在文档中复制密文、nonce 或 master key。
- 当前运行的 `kerminal.exe` 路径是 `src-tauri/target/debug/kerminal.exe`，而上一轮验证曾使用临时 `CARGO_TARGET_DIR`；真实运行窗口可能没有加载最新代码，因此修复必须包含明确的桌面壳重启/启动验证。

## SSH 终端连接链路

1. 左侧主机双击或打开动作调用 `workspaceStore.openSshTerminal(hostId)`。
2. `workspaceStore` 创建新的 terminal tab 和 pane；pane 保存 `mode = "ssh"`、`remoteHostId = hostId`、`target = sshTarget(hostId)`。
3. `TerminalWorkspaceContent` / `TerminalPaneCard` 渲染该 pane，`XtermPane` 挂载真实 xterm runtime。
4. `XtermPane.runtime` 对 SSH pane 调用 `terminalApi.createSshTerminalSession({ hostId, rows, cols, ... })`。
5. Tauri command 进入 `SshTerminalService.create_session`。
6. `SshTerminalService.resolve_terminal_launch` 从 `RemoteHostService.require_host(hostId)` 获取公开 host snapshot。
7. `SshCredentialResolver` 解析 host：
   - `auth_type = password` + `secret_ref`：读取 `vault-key.toml` 和 `vault.toml`，用 `secret_ref` bytes 作为 AAD 解密 password。
   - 没有保存密码时返回 prompt-only，不应伪装成自动登录。
   - 解密失败、缺 key、缺 entry 时返回 credential error，不应静默降级为 prompt-only。
8. SSH terminal service 生成 OpenSSH `TerminalCreateRequest`：
   - argv 不包含 password。
   - `PreferredAuthentications=password,keyboard-interactive`。
   - `UserKnownHostsFile` 指向 Kerminal workspace known_hosts。
9. 同一个 resolved auth 结果生成 `TerminalSecretInputPlan`：
   - 包含 `user@host's password:`、`host's password:`、`password:` 等 prompt markers。
   - response 是内存中的 password，redact_values 包含该 password。
   - max response 默认为 1，避免错误密码循环。
10. `TerminalManager.create_session_with_secret_input_plan` 启动 PTY reader；reader 观察 OpenSSH 输出，匹配 prompt 后写入 password + CR，并对前端输出和 session log 做脱敏。

## 诊断结论

- 现有代码有一条脆弱桥接：`SshTerminalService` 先把 `ResolvedSshRouteAuth` materialize 成带 `credential_secret` 的 runtime `RemoteHost`，再从 runtime host 重新推导 `TerminalSecretInputPlan`。这会丢失 resolver 的 auth summary、prompt-only/credential-error 语义和 target/jump 明细，也让后续代码很容易再次绕过 resolver。
- 现有 UI 只看到 OpenSSH prompt，无法区分以下状态：
  - 没有保存 password，需要用户手输。
  - vault 缺 key/entry 或 decrypt failed。
  - 已解密 password，但 prompt matcher 未写入。
  - 当前桌面窗口运行的是旧 target binary。
- 双击多 tab 的直接根因是 `openSshTerminal` 曾在创建前调用 `focusExistingMachineTabState`，同 host 已有 tab 时只聚焦旧 tab；SSH 主机应与本地 profile 一样，每次双击/打开都创建新 tab。

## 生产级修改方案

### TASK-001 连接链路文档与 lane 登记

- 本文记录连接链路、证据、风险、任务和验证矩阵。
- lane id：`lane-ssh-terminal-connect-flow-repair`。
- 影响路径先限定在：
  - `.updeng/docs/plan/active/PLAN-20260629-094349-ssh-terminal-connect-flow-repair.md`
  - `src-tauri/src/services/ssh_terminal_service.rs`
  - `src-tauri/src/services/terminal_manager.rs`
  - `src-tauri/tests/ssh_terminal_service.rs`
  - `src-tauri/tests/ssh_terminal_password_smoke.rs`
  - `src-tauri/tests/terminal_manager.rs`
  - `src/features/workspace/workspaceStore.ts`
  - `src/features/workspace/workspaceStore.terminalOpen.test.ts`

### TASK-002 SSH terminal service 直接消费 resolver 输出

- [x] `resolve_terminal_launch` 保留原始 host snapshot 和 resolved auth，而不是只返回 materialized runtime host。
- [x] 直连 password host 的 `secret_input_plan` 直接从 `ResolvedSshRouteAuth.target` 构建，避免二次读取 `credential_secret`。
- [x] jump host 的 route plan 和 secret plan 从 resolver auth 构建，确保 target 和每个 jump 使用同一 resolver 结果。
- [x] 直连 key host 的 identity args 从 `ResolvedSshAuthMaterial` 构建，vault PEM 写临时 key 文件，path key 解析为 identity file，不再从 runtime host 的 `credential_secret` / `credential_ref` 二次推导。
- [x] prompt-only 只在没有保存 password 时允许进入交互；vault 缺 key/entry/decrypt failed 必须在 session 创建阶段返回 credential error。
- [x] 保持 OpenSSH argv 不携带 password。
- [x] 清理 SSH terminal service 中旧 `resolve_secret_input_plan`、`normalized_credential_secret` 兼容入口及对应 plaintext 测试。

### TASK-003 TerminalManager prompt matcher 加固

- [x] 已响应的 prompt 不应留在前端输出和日志中。
- [x] prompt 被 PTY 拆成多段输出时，短暂 hold 未完成的 prompt 片段，确认完整 prompt 后再输出清理后的内容。
- [x] 只清理本轮已响应 prompt；第二次真实 password prompt 仍保留给用户，避免隐藏错误密码或 2FA/OTP 场景。

### TASK-004 SSH tab 多开语义

- [x] `openSshTerminal(hostId)` 每次创建新 tab/pane。
- [x] `openSshCommandTerminal` 继续每次创建新 command tab。
- [x] 保留 container terminal 的“聚焦已有容器 tab”语义，不扩大修改范围。

### TASK-005 真实启动与用户配置形态验证

- 针对当前用户 host 形态补测试：公开 host 只有 `secret_ref`，legacy 为空，terminal launch 必须生成 secret plan 且 argv 不泄漏 secret。
- loopback password smoke 覆盖：
  - 首次连接自动登录。
  - 同 host 第二次连接自动登录。
  - 错误 password 不无限重试。
- 前端 store 测试覆盖 SSH 连续打开创建两个 tab。
- 启动验证：
  - `npm run build`
  - 独立 dev server HTTP 200
  - 当前桌面壳必须运行最新编译出的 source；如果已有 single-instance 窗口阻止临时 target 验证，需要明确关闭/重启目标窗口或记录该限制。

## 验收矩阵

| 要求 | 证据 |
| --- | --- |
| saved vault password host 不停在 password prompt | `ssh_terminal_password_smoke` loopback auto login + reconnect 通过；当前用户形态 unit test 证明 secret_ref -> secret plan；真实用户 host `ddd68b0a-1845-4ac6-97b2-142e49d19c68` 后端 PTY verifier 通过 |
| argv 不泄漏 password | `ssh_terminal_service` 断言 OpenSSH args 不包含 secret |
| prompt 显示不误导 | `terminal_manager` 测试覆盖完整 prompt、split prompt、第二次未响应 prompt |
| SSH 双击可多开 tab | `workspaceStore.terminalOpen.test.ts` 连续 `openSshTerminal` 后有两个 tab/pane |
| 构建可启动 | `npm run build`、dev server HTTP 200、Tauri desktop setup 完成 |
| 不写入明文 secret | git diff、host TOML 和文档中不包含 password/master_key/nonce/ciphertext |

## Round Log

### 2026-06-29T09:43:49+08:00

- 用户反馈上一轮“并没有修复”，并要求先梳理连接逻辑、写生产级方案到文档，再按方案实施。
- 重新查看截图，确认仍停在 `ubuntu@172.16.41.60's password:`。
- 读取 AGENTS、README、Updeng docs、配置手册、当前用户生成的 `kerminal-config.md`、coordination lanes 和 git status。
- 检查当前用户公开 host 配置，确认该 host 是 `auth_type=password` + encrypted vault `secret_ref`，legacy secrets 目录为空。
- 本文建立为当前实施计划。

### 2026-06-29T09:52:30+08:00

- 按用户追加要求“清除旧代码兼容，采用最新逻辑”，收敛 SSH terminal 连接链路到 resolver/vault 结果。
- `ssh_terminal_service.resolve_terminal_launch` 现在从 `ResolvedSshRouteAuth` 直接生成 terminal secret input plan；删除终端服务旧 `resolve_secret_input_plan` 兼容入口，不再从 runtime host 的 `credential_secret` 二次推导 password plan。
- `ssh_route_plan` 新增 `build_ssh_route_plan_from_resolved`，jump 终端路径从 resolver auth 生成 OpenSSH route config 和 secret plan，不再依赖旧 credential field 桥接。
- 更新测试：saved vault password host 的完整 terminal launch 必须生成 secret plan；jump password route 走完整 service + resolver；旧 plaintext plan 单测删除。
- 已通过验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service`、`cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_password_smoke -- --nocapture`、`cargo test --manifest-path src-tauri/Cargo.toml --test terminal_manager`、`npm run test -- src/features/workspace/workspaceStore.terminalOpen.test.ts`。

### 2026-06-29T10:04:17+08:00

- 根据用户“清除旧代码兼容，采用最新逻辑”的追加要求继续收紧：直连 SSH key identity 也改为只消费 `ResolvedSshAuthMaterial`，不再读取 runtime host 的 `credential_secret` 或旧 credential bridge。
- `ssh_terminal_service` 当前运行时路径：公开 host snapshot 只用于 host/label/argv 元数据；password plan、jump route、inline key、key path 均来自同一次 `SshCredentialResolver.resolve_host` 结果。
- 补跑验证：
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service` 通过，17 passed。
  - `CARGO_TARGET_DIR=$TEMP/kerminal-codex-target cargo test --manifest-path src-tauri/Cargo.toml --test ssh_route_plan` 通过，8 passed。
  - `CARGO_TARGET_DIR=$TEMP/kerminal-codex-target cargo test --manifest-path src-tauri/Cargo.toml --test terminal_manager` 通过，20 passed。
  - `CARGO_TARGET_DIR=$TEMP/kerminal-codex-target cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_password_smoke -- --nocapture` 通过，4 passed，1 ignored real-host test。
  - `npm run test -- src/features/workspace/workspaceStore.terminalOpen.test.ts` 通过，13 passed。
  - `npm run build` 通过。
  - `npm run dev -- --host 127.0.0.1 --port 1446` 启动成功，`Invoke-WebRequest http://127.0.0.1:1446/` 返回 200，随后已停止临时 dev server。
  - `npm run tauri:dev` 通过，日志显示 `Kerminal desktop setup completed`，随后已停止临时 dev session 并确认 1425 不再占用。
- 真实 host 操作验证当轮受桌面点击能力限制未完成，随后改用后端 PTY verifier 直接调用 `SshTerminalService.create_session` 验证同一运行链路。

### 2026-06-29T10:12:43+08:00

- 使用临时集成测试文件（运行后已删除）加载当前用户 `~/.kerminal` 公开 host 配置和 encrypted vault，对真实 saved password host `ddd68b0a-1845-4ac6-97b2-142e49d19c68` 直接调用 `SshTerminalService.create_session`。
- 验证命令：`KERMINAL_REAL_SAVED_SSH_HOST_ID=ddd68b0a-1845-4ac6-97b2-142e49d19c68 CARGO_TARGET_DIR=$TEMP/kerminal-codex-target cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_real_saved_host_verify -- --nocapture`。
- 验证结果：1 passed，远端 command 返回 success marker，捕获输出不包含 `password:`；这证明当前真实 host 的 saved vault password 已能自动应答 OpenSSH prompt，不再停在 password prompt。
- 临时 verifier 已从仓库删除；没有把 password、vault key、nonce、ciphertext 或远端命令输出写入文档。
- 本计划完成：连接链路已梳理，生产级方案已写入本文，代码按方案实施并完成针对单测、smoke、build、Tauri 启动和真实 saved-host 后端 PTY 验证。
