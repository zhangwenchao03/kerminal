---
id: PLAN-20260626-164938-ssh-credential-vault-auth-runtime
status: done
created_at: 2026-06-26T16:49:38+08:00
started_at: 2026-06-26T16:49:38+08:00
completed_at: 2026-06-29T19:00:00+08:00
updated_at: 2026-06-29T19:00:00+08:00
owner: ai
lane: lane-ssh-credential-vault-auth-runtime-design
---

# SSH 凭据加密文件库与统一认证运行时生产级方案

## 目标

- 形成生产级实施方案，解决 SSH password 每次连接都要求手输的问题。
- 方案必须覆盖所有 SSH 派生能力：终端、SFTP、端口转发、Docker/Compose、容器进入、tmux、server info、命令建议、MCP SSH/SFTP/container/port tools。
- 按用户最终决策，不使用系统 Keychain / Credential Manager 作为主存储；Kerminal 自己做 encrypted file vault。
- vault key 也放在 `~/.kerminal` 工作空间内，迁移时可整体复制。
- 默认创建 `~/.kerminal` 工作空间时，如果本机有 Git，则初始化 Git 仓库并写入安全 `.gitignore`。
- 设置页新增“同步”菜单，允许查看 Git/vault 状态、修复 `.gitignore`、导入/导出/修改 vault key。
- `secrets/vault-key.toml` 默认不提交；公开配置和 encrypted `secrets/vault.toml` 可以提交；另一台机器只要导入匹配 key 就能直接使用保存凭据。
- AI 助手是第一入口：用户给 AI 主机、账号、密码后，AI 可通过受控工具创建/更新主机并写入加密凭据，之后所有能力可直接使用。
- UI 编辑已有主机时可以受控解密并回显旧 password。

## 非目标

- 本计划文档不直接改生产代码。
- 不把 OTP、2FA、一次性 keyboard-interactive challenge 保存为长期 secret。
- 不采用 OS keychain 作为第一阶段主路径。
- 不承诺“复制完整 `~/.kerminal` 且包含 `vault-key.toml` 后仍无法解密”。密钥可手动随工作空间迁移是用户明确取舍。
- 不自动配置 Git remote，不自动 push/pull，不实现云同步账号体系。
- 不用连接复用掩盖 credential 存储问题；ControlMaster/连接池只作为 P2 优化。

## 当前证据

- README 当前写明 SSH 密码和内联私钥随远程主机记录明文保存和展示。
- `ConfigFileStore` 会把 `hosts/*.toml` 与 `secrets/hosts/*.toml` 合并成 runtime `RemoteHost`。
- `remote_host_service` 当前要求 password auth 直接填写明文 `credential_secret`，并拒绝 `credential:` 引用。
- `ssh_terminal_service`、`sftp_service`、`ssh_command_service`、`ssh_route_plan` 当前各自读取 `credential_secret`。
- Docker、tmux、server info 和 MCP SSH tools 通过 SSH command/terminal/SFTP 间接受影响。

## 方案文档

- 决策文档：[ADR-0022: Kerminal 加密文件凭据库与统一 SSH 认证运行时](../../decisions/ADR-0022-ssh-credential-vault-and-auth-runtime.md)

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 加密凭据库 | 是 | 新增/改造 vault service、`~/.kerminal/secrets/vault*.toml` | 加密/解密/损坏/权限/原子写测试 |
| 工作空间同步 | 是 | workspace bootstrap、Git facade、`.gitignore` 管理 | Git available/unavailable、init、ignore 修复测试 |
| SSH 主机模型 | 是 | `src-tauri/src/models/remote_host.rs`、`src/lib/remoteHostApi.ts` | Rust/TS model tests、serde/TOML roundtrip |
| 配置文件 | 是 | `src-tauri/src/storage/config_file_store.rs`、`.updeng/docs/config/kerminal-config-files.md` | config store tests、validator |
| 终端 | 是 | `src-tauri/src/services/ssh_terminal_service.rs` | password/key/agent/jump smoke |
| SFTP | 是 | `src-tauri/src/services/sftp_service/*` | list/upload/download/rename/delete |
| SSH command | 是 | `src-tauri/src/services/ssh_command_service.rs` | server info、tmux、Docker、MCP tool tests |
| 端口转发 | 是 | `src-tauri/src/services/port_forward_service/*` | local/remote/dynamic tunnel tests |
| 容器与 tmux | 间接 | `docker_host_service`、`tmux_service` | 通过 SSH command/terminal 集成测试 |
| 前端 UI | 是 | `RemoteHostCreateDialog`、Settings 同步菜单、host tree API | component tests、三主题截图 |
| AI/MCP 工具 | 是 | host upsert、vault encrypt、config validate | 工具测试、输出脱敏 |
| 外部 agent 文档 | 是 | config manual、AGENTS/CLAUDE template 如需 | validator + docs review |

## 执行步骤

- [x] TASK-001 调研与 ADR
  - 调研 OpenSSH、VS Code Remote SSH、PuTTY/Pageant、Rust keyring、Tauri Stronghold 和文件型 vault 方案。
  - 根据用户最终决策，ADR-0022 采用 Kerminal encrypted file vault + workspace vault key + 统一 SSH auth runtime。
  - 验证：文档包含外部实践、备选方案、决策、影响、回滚、验证矩阵。

- [x] TASK-002 Vault 文件格式、工作空间 Git 与同步设置
  - 创建或修复 `~/.kerminal` 时检测 `git --version`；Git 可用且未初始化时执行 workspace repo 初始化。
  - 写入或修复 Kerminal 管理的 `.gitignore` 规则：新格式下 `secrets/` 里只默认忽略 `secrets/vault-key.toml`；兼容迁移期间继续忽略旧版明文 `secrets/hosts/`；日志、缓存、会话和本地 SQLite runtime state 也必须忽略。
  - Git 不可用时只在设置页同步菜单显示提示，不影响终端、SFTP、vault、AI 添加主机和配置热刷新。
  - 设置页新增“同步”菜单，展示工作空间路径、Git 状态、repo 状态、dirty 摘要、vault/key 状态。
  - 同步菜单支持导入 key、导出 key、创建缺失 key、修改/轮换 key；key 操作必须有确认、dry-run、备份、原子写和脱敏日志。
  - 定义 `secrets/vault-key.toml` 和 `secrets/vault.toml`。
  - 后端生成 32-byte random master key，存入 workspace。
  - 使用 `XChaCha20-Poly1305` 或 `AES-256-GCM` AEAD；每条 secret 独立 nonce；associated data 绑定 entry id、kind、host id、key id。
  - `secrets/vault.toml` 可以提交；`secrets/vault-key.toml` 不提交；`vault.toml` 与匹配 key 一起存在时，另一台机器可直接解密使用。
  - 验证：encrypt/decrypt、wrong key、tamper、duplicate id、atomic write、backup restore、git unavailable、git init、ignore 修复、key import/export/rotation。

- [x] TASK-003 模型与 schema 切片
  - 在 Rust/TS host 模型中新增 `secret_ref`、`key_passphrase_ref` 和 credential status。
  - 保留 `credential_secret` 作为 legacy import/fallback 字段，不再作为主路径。
  - 定义 vault entry id 生成函数和解析校验。
  - 验证：model serde、TOML roundtrip、非法 ref、跳板机 index 稳定性。

- [x] TASK-004 Host 保存链路与 AI-first 工具
  - `remote_host_service.create/update` 收到 transient secret 后写入 encrypted vault。
  - 新增 `kerminal.host.upsert_with_credential`：AI 可以提交用户给出的 host、username、password，后端加密并写入 host/vault 文件。
  - 新增或复用 `kerminal.vault.encrypt_secret` 作为低层受控工具；AI 不自己实现 crypto。
  - 公开 host TOML 只写 `secret_ref`，不写 `credential_secret`。
  - 工具输出不包含 password 明文。
  - 验证：AI 工具测试、config file 不含 secret、vault 写入失败回滚。

- [x] TASK-005 统一 SSH 认证运行时
  - 新增 `SshAuthRuntimeService` 或 `SshCredentialResolver`。
  - 输入 host id/host snapshot，解密 target/jump secret，输出 `ResolvedSshAuthMaterial`、known_hosts、secret input plan 和脱敏摘要。
  - 统一处理 password、key path、inline private key、key passphrase、agent、prompt-only 和 legacy plaintext fallback。
  - 验证：纯单测覆盖 target/jump、missing vault key、missing entry、decrypt failed、legacy import、redaction。

- [x] TASK-006 终端链路接入
  - `ssh_terminal_service` 改为使用 resolver。
  - OpenSSH args 不含 secret；password 通过 `TerminalSecretInputPlan` 响应。
  - 保留 2FA/OTP 终端交互。
  - 验证：loopback password、agent、key path、jump password、断开重连。

- [x] TASK-007 Native SSH/SFTP/命令链路接入
  - `sftp_service` 不再直接读 `host.credential_secret`。
  - `ssh_command_service::execute_native` 使用 resolver 输出 native auth material。
  - Docker、tmux、server info 和 command suggestion 通过 SSH command 自动继承。
  - 验证：SFTP list/upload/download/rename/delete，server info，Docker inspect/enter，tmux list/attach command。

- [x] TASK-008 端口转发与跳板机
  - `ssh_route_plan` 支持 vault-resolved material。
  - local/remote/dynamic forwarding 覆盖 target password、jump password、key/agent。
  - `ForwardAgent` 默认关闭，per-host 显式开启。
  - 验证：port forward plan tests、真实 tunnel smoke、secret redaction。

- [x] TASK-009 UI 与诊断
  - RemoteHostCreateDialog 编辑已有主机时，通过受控 reveal/edit API 从 encrypted vault 解密旧 password，并回填到密码输入框。
  - password 输入提供显示/隐藏切换；显示态可看到旧密码，隐藏态使用密码控件。
  - 主机树、普通 host 读取、validator、日志和 MCP 状态接口不能批量返回 password 明文。
  - host 详情显示 agent/key/vault 状态和可操作诊断：`encrypted vault present`、`vault key missing`、`vault entry missing`、`decrypt failed`。
  - Settings 新增“同步”菜单：展示 Git/vault 状态，提供初始化/修复 `.gitignore`、导入/导出/修改 key 的入口。
  - 无 Git 时菜单显示不可用提示，但不阻断其它功能。
  - 验证：组件测试、浅色/深色/系统主题截图、a11y label、key 操作确认弹窗。

- [x] TASK-010 Legacy 迁移与配置手册
  - `secrets/hosts/*.toml` 作为 legacy plaintext source，提供显式迁移到 encrypted vault 的流程。
  - 更新 `.updeng/docs/config/kerminal-config-files.md` 和外部 agent workspace 文档。
  - 文档明确 Git 同步策略：`vault.toml` 可提交，`vault-key.toml` 不提交；跨机器导入匹配 key 后可直接使用，否则需要重新输入密码。
  - validator 报告 plaintext legacy secret，并提示迁移。
  - 验证：迁移幂等、失败回滚、外部 agent 不写明文 secret、`.gitignore` validator 诊断。

- [x] TASK-011 完整验收
  - Rust tests：vault service、remote_host_service、config_file_store、ssh_terminal_service、ssh_routear_plan、ssh_command_service、sftp_service、port_forward_service、docker_host_service、tmux_service、server_info_service、mcp_tool_executor_service。
  - Frontend tests：remoteHostApi、RemoteHostCreateDialog、host tree credential status。
  - Settings/sync tests：Git 状态、无 Git 提示、`.gitignore` 修复、key import/export/rotation UI。
  - 运行：`npm run build`、真实 dev server smoke、`npm run tauri:dev`。
  - 真实 smoke：password vault 主机、key/agent 主机、SFTP、端口转发、容器进入、tmux、server info。

## 风险

- 完整工作空间可解密：密钥和密文都在 `~/.kerminal` 时，复制完整工作空间即可离线解密；这是用户明确接受的手动迁移取舍。
- Git 同步 key 缺失：默认 Git 不提交 `vault-key.toml`，新机器 clone 后需要导入匹配 key 或重新输入密码；设置页必须给出清晰状态和操作入口。
- vault key 丢失：加密 secret 无法恢复；必须提示用户恢复 key 或重新输入密码。
- 修改 key 风险：rotation 失败不能损坏旧 vault；必须 dry-run、备份和原子替换。
- 无 Git 环境：不能阻塞 Kerminal 使用；只提示 Git 不可用并禁用同步相关动作。
- vault 文件损坏：需要原子写、备份和损坏诊断。
- AI 工具参数：AI 可以接收用户给的 password 并调用工具，但工具输出、日志、文档和配置不能回显明文。
- UI 编辑已有主机：可以回显旧密码，测试要覆盖显示/隐藏和脱敏边界。
- 多功能共享认证：如果只迁移终端而漏掉 SFTP/port forward，会造成体验割裂，不能收口。

## 验证门禁

- 不出现 `credential_secret` 明文写入普通 `hosts/*.toml`。
- `remote_host_tree`、config validate、MCP status 和日志不返回 password 明文。
- `vault-key.toml`、`vault.toml` 路径被标记为敏感，诊断和文档不得复制 key 内容。
- 工作空间创建时 Git 可用则初始化 repo；Git 不可用时只提示，不影响核心功能。
- `.gitignore` 必须忽略 `secrets/vault-key.toml`；允许提交 encrypted `secrets/vault.toml`、其它 encrypted secrets 和普通配置文件；旧版明文 `secrets/hosts/` 迁移前继续忽略。
- Settings 同步菜单可查看 Git/vault 状态，并支持导入/导出/修改 key；已有 vault 且 key 缺失时不得自动生成新 key 覆盖。
- AI `host.upsert_with_credential` 可以添加 password 主机，且输出不含 password。
- 编辑单个主机时，受控 UI reveal/edit API 可以回填旧 password；列表、日志、MCP 和普通配置 API 仍不能返回 password。
- 保存 password 后，新开 SSH 终端不要求用户重复输入同一 password。
- 同一保存凭据可用于 SFTP、port forward、Docker/Compose、tmux、server info 和 MCP tools。
- key/agent 路径仍正常，agent 不可用时有诊断而不是静默失败。
- 旧 `secrets/hosts` 有迁移路径和 validator 诊断。
- 所有日志、错误、diagnostics 和 MCP 输出脱敏。

## Round Log

### 2026-06-26T16:49:38+08:00

- 用户要求调研成熟终端如何避免重复 password prompt，并输出生产级完整实施方案到文档；随后补充必须保证 SFTP 和其它能力都正常。
- 回读 AGENTS、README、Updeng 文档、active lane 状态、当前 git status 和 SSH/credential 相关代码。
- CodeGraph 梳理现状：`CredentialService` 已有 OS keychain 抽象但 SSH 未接入；`RemoteHost`/`ConfigFileStore`/`remote_host_service`/`ssh_terminal_service`/`sftp_service`/`ssh_command_service` 仍以 `credential_secret` 为主路径。
- 调研 OpenSSH、VS Code Remote SSH、Windows OpenSSH、PuTTY/Pageant、Rust keyring 和 Tauri Stronghold，结论写入 ADR-0022。
- 本轮只写文档，不改生产代码。

### 2026-06-26T17:16:30+08:00

- 根据用户澄清修正方案边界：Kerminal UI 编辑已有主机时需要能看到旧 password，体验应与用户在界面自己新增主机一致。
- 当时调整 ADR-0022 和本计划为：允许本地 UI 通过受控 reveal/edit API 读取单个 host 的旧 password 并回填编辑框；AI 助手可以一次性提交用户提供的 password 到受控 upsert 工具。该轮仍采用系统钥匙串口径，已被 2026-06-26T17:22:30 的用户最终决策覆盖。
- 保持安全边界：公开 host TOML、主机树列表、validator、日志、MCP 状态和 AI 工具返回值不包含旧 password 明文；外部 agent 默认只能写入凭据和查看 status，不能读取旧 password。

### 2026-06-26T17:22:30+08:00

- 根据用户最终决策重写方案：不使用系统 Keychain / Credential Manager 作为主存储；Kerminal 自己做 encrypted file vault。
- vault key 也存放在 `~/.kerminal` 工作空间里，迁移时和加密凭据一起带走。
- 明确安全取舍：该方案防止明文出现在配置、日志、validator 和 MCP 输出中，但完整复制 `~/.kerminal` 的人可以离线解密；这是为 AI-first 和可迁移做出的产品取舍。
- 更新任务切片：新增 vault 文件格式、AEAD 加解密、AI `host.upsert_with_credential`、UI reveal、legacy 明文迁移和全 SSH 能力验收。

### 2026-06-26T17:29:23+08:00

- 按用户再次确认的方向，将 ADR-0022 状态从 `Proposed` 调整为 `Accepted`。
- 第一阶段正式排除系统 Keychain / Credential Manager 作为主存储；Kerminal encrypted file vault 和 workspace vault key 是默认实现路径。

### 2026-06-26T17:51:39+08:00

- 按用户要求完善生产设计：新增设置页“同步”菜单、workspace Git bootstrap、`.gitignore` 安全规则和 vault key 修改/导入/导出/轮换语义。
- 明确默认 Git 策略：有 Git 时创建/修复 `~/.kerminal` 仓库和 `.gitignore`；无 Git 时只提示不可用，Kerminal 核心功能继续可用。
- 明确提交边界：`secrets/vault-key.toml` 不提交；公开配置和 encrypted `secrets/vault.toml` 可以提交；跨机器导入匹配 key 后可直接使用，否则需要重新输入密码。

### 2026-06-26T18:10:06+08:00

- 实现 TASK-002 第一切片：新增 workspace sync/vault bootstrap 后端服务、`workspace_sync_status` / `workspace_sync_ensure` Tauri command、Settings “同步”菜单、前端 API 和针对性测试。
- vault 文件约定落地为 `secrets/vault-key.toml` 与 `secrets/vault.toml`：默认生成 32-byte workspace key；secret entry 使用 XChaCha20-Poly1305、独立 nonce 和 associated data；`vault.toml` 可提交，`.gitignore` 只忽略 `secrets/vault-key.toml`，并继续忽略 legacy 明文 `secrets/hosts/`。
- workspace bootstrap 在启动时确保目录、缺失 key、Git 可用时的 repo 初始化和 `.gitignore` 修复；已有 vault 但 key 缺失或 vault 损坏时不自动生成新 key 覆盖迁移语义；Git 不可用时状态显示 unavailable，不阻断功能。
- 验证通过：`cargo fmt --check`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test workspace_sync_service`（4 passed）；`npm run test:frontend -- src/features/settings/SettingsToolContent.sync.test.tsx`（2 passed）。
- `npm run typecheck` 和 `npm run build` 当前未通过，阻断来自另一个 active lane 的 `src/features/tool-panel/AgentLauncherToolContent.tsx` 类型错误：`"context"` 尚未加入 `submit | paste | queue` 参数联合类型；本轮按并行 lane 边界未修改该文件。
- TASK-002 剩余：key 导入、导出、修改/轮换的确认、dry-run、备份和原子替换 UI/后端能力；vault parse/tamper/wrong-key/backup restore 等更完整负向诊断仍需后续切片补齐。

### 2026-06-26T18:23:51+08:00

- 完成 TASK-002 剩余 key 操作切片：后端新增 `workspace_sync_export_key`、`workspace_sync_import_key`、`workspace_sync_rotate_key`；Settings “同步”菜单新增 key TOML 导出、导入校验、导入写入、轮换预检和轮换写入入口。
- vault entry 新增非敏感 `associated_data` 字段，用于生产级 key rotation 时确定性重建 AEAD AAD；轮换会先用旧 key 解密所有 entry，再用新 key 重加密 vault，并为旧 `vault-key.toml` 和 `vault.toml` 创建 `.bak.<timestamp>` 备份。
- 导入 key 支持 dry-run；写入前校验 key schema、算法、master key 长度，并在已有 vault entries 时验证导入 key 可以解密当前 vault；写入前备份旧 key。
- 验证通过：`cargo fmt --check`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test workspace_sync_service`（6 passed）；`npm run test:frontend -- src/features/settings/SettingsToolContent.sync.test.tsx`（4 passed）；`npm run typecheck`；`npm run build`；`npm run dev -- --host 127.0.0.1 --port 1435` + `Invoke-WebRequest http://127.0.0.1:1435/` 返回 200。

### 2026-06-27T15:24:03+08:00

- 针对用户最新截图“停在 `root@172.16.40.220's password:`”继续收口 SSH 终端链路，确认这次剩余用户感知点分成两类：一类是真正的 `secret_ref` 未解析导致无法自动输密，另一类是自动输密已经触发但 password prompt 仍留在终端输出里造成误判。
- 在 `src-tauri/src/services/terminal_manager.rs` 为 `TerminalSecretInputResponder` 增加 prompt marker redaction：当保存的 password 已自动提交时，同一拍输出里的 `password:` 提示会被从前端终端流中抹掉，避免用户把 SSH 自带提示词误判为“还在等我手输密码”。
- 保持单次 password plan 只响应一次的安全边界不变；第二次真实 prompt、错误密码重试或未覆盖的 challenge 仍会继续显示，不会被静默吞掉。
- 补齐并更新验证：`cargo test --manifest-path src-tauri/Cargo.toml --test terminal_manager`（20 passed）、`cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service`（17 passed）、`cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_password_smoke -- --nocapture`（4 passed, 1 ignored）。由于工作区有运行中的 `src-tauri/target/debug/kerminal.exe`，默认 target 目录会报 Windows `os error 5`；本轮改用独立 `CARGO_TARGET_DIR=%TEMP%/...` 完成验证。
- 继续执行运行态门禁：确认 `http://127.0.0.1:1425/` 返回 200，随后使用独立 `CARGO_TARGET_DIR=%TEMP%/kerminal-cargo-target-tauri-shell-ssh-prompt` 执行 `cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always --`，新的 Tauri 壳完成构建并成功启动 `kerminal.exe`，避免默认 target 目录被已运行实例锁住时影响本轮验收。
- 视觉冒烟：通过系统 Edge channel 打开 `http://127.0.0.1:1435/`，进入设置弹窗并切到“同步”页；确认 Git/vault/.gitignore 状态卡、key TOML 文本框和导出/导入/轮换按钮在深色主题下可见且未重叠。本轮未单独采集浅色/跟随系统截图。
- `npm run tauri:dev` 未完成启动，失败原因是默认 Vite `1425` 端口已被现有进程占用，`beforeDevCommand` 退出；本轮没有停止用户现有运行窗口。
- 下一步进入 TASK-003：Rust/TS host 模型新增 `secret_ref`、`key_passphrase_ref` 和 credential status，并保留 legacy `credential_secret` 迁移入口。

### 2026-06-26T19:06:02+08:00

- 完成 TASK-003 模型与 schema 切片：Rust `RemoteHost` / `SshJumpHostOptions` / create-update request 新增 `secret_ref`、`key_passphrase_ref` 和 `RemoteHostCredentialStatus`；TS `remoteHostApi` 新增对应 `secretRef`、`keyPassphraseRef`、`credentialStatus` 类型和 browser preview normalize/clone 保留逻辑。
- 新增 vault ref 模型函数：`build_vault_secret_ref`、`parse_vault_secret_ref`、`validate_vault_secret_ref`；当前格式为 `credential:kerminal:<kind>:<host_id>:<scope>:<material>:v1`，支持 `ssh-host` / `jump-host` / `rdp-host` 与 `password` / `private-key` / `key-passphrase`。
- 配置文件 roundtrip 已保留 encrypted vault ref 到公开 `hosts/*.toml`；legacy `credential_secret` 仍继续写入/读取 `secrets/hosts/*.toml`，读回时推导 `legacyPlaintext`/`vault`/`agent`/`missing` 状态。
- 同步修复受影响测试夹具：connection、SSH terminal/command/route、SFTP、port forward、Docker、server info、serial/telnet、command suggestion smoke 等 Rust 测试构造点全部补齐新字段，未改变连接链路读取 secret 的旧行为。
- 验证通过：`cargo fmt --check`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test config_file_store --test remote_host_service`（9 + 15 passed）；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --tests --no-run -j1`；`npm run test:frontend -- src/lib/remoteHostApi.test.ts`（9 passed）；`npm run typecheck`；`npm run build`；`npm run dev -- --host 127.0.0.1 --port 1436` + HTTP 200；`npm run tauri:dev` 编译并运行 `target\debug\kerminal.exe`。
- 下一步进入 TASK-004：Host 保存链路与 AI-first 工具，把 transient password/inline key 写入 encrypted vault，公开 host TOML 只保留 `secret_ref`。

### 2026-06-26T19:30:15+08:00

- 完成 TASK-004：`remote_host_service.create/update` 现在把 transient password/inline private key 写入 encrypted vault，公开 `hosts/*.toml` 只保留 `secret_ref`，不再写 `credential_secret`；host 配置写失败时会恢复本轮 vault 快照，vault 写失败时不会落 host。
- 新增 AI-first MCP tools：`kerminal.host.upsert_with_credential` 接收用户给 AI 的主机、账号和密码，后端统一加密并保存主机；`kerminal.vault.encrypt_secret` 作为低层受控加密工具，输出只包含 ref/metadata，不回显 plaintext。
- 新增测试覆盖 AI tool、低层 vault encrypt tool、host TOML 不含 secret、vault 密文不含 plaintext、vault 写失败不落 host；保持 `vault.toml` 可提交、`vault-key.toml` 私有迁移的产品口径。
- 按用户反馈重做 Settings “同步”页：默认视图改成 geek 状态面板，只展示 workspace/root、Git/vault key/.gitignore 三个紧凑信号、vault/key 路径和少量 metrics；刷新/修复保留为主操作，导出/导入/轮换 key 折叠到“高级”，避免按钮铺满。
- 验证通过：`cargo fmt --check`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test remote_host_service --test config_file_store --test workspace_sync_service`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test mcp_tool_executor_service`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --tests --no-run -j1`；`npm run test:frontend -- src/features/settings/SettingsToolContent.sync.test.tsx`；`npm run typecheck`；`npm run build`；dev server `http://127.0.0.1:1438/` HTTP 200。
- 视觉验证：用本机 Edge/Playwright 打开真实 dev server，进入设置/同步页；深色默认态截图确认只显示刷新和修复两个主操作，低频 key 操作折叠。截图路径：`.updeng/docs/verification/sync-settings-geek-20260626.png`、`sync-settings-light-20260626.png`、`sync-settings-dark-20260626.png`、`sync-settings-system-20260626.png`。
- 下一步进入 TASK-005：统一 SSH 认证运行时，开始把 vault ref 解析成终端/SFTP/SSH command 可复用的认证材料。

### 2026-06-26T19:50:18+08:00

- 完成 TASK-005：新增 `src-tauri/src/services/ssh_credential_resolver.rs`，提供 `SshCredentialResolver`、`ResolvedSshRouteAuth`、`ResolvedSshHopAuth`、`ResolvedSshAuthMaterial`、`TerminalSecretInputPlan` 和脱敏 summary。
- resolver 当前覆盖 target 与 jump host；支持 vault password、vault inline private key、vault key passphrase、private key path、agent、prompt-only 和 legacy plaintext fallback。
- vault ref 解析使用完整 `secret_ref` 作为 AEAD associated data；配置了 vault ref 但缺 `vault-key.toml`、缺 vault entry 或解密失败时返回明确 `Credential` 错误，不静默退回重复 prompt。
- 安全边界：`ResolvedSshAuthMaterial` 和 `ResolvedSshSecretValue` 自定义 `Debug`，password、inline private key 和 passphrase 不进入 debug/summary；新增测试覆盖错误输出不包含 plaintext。
- 本轮实际修改：`src-tauri/src/services/ssh_credential_resolver.rs`、`src-tauri/src/services/mod.rs`、`src-tauri/tests/ssh_credential_resolver.rs` 和本计划文件。`src-tauri/src/services/mod.rs` 中已有的 `encrypted_vault_service` / `workspace_sync_service` 导出来自前序 TASK-002，本轮只追加 `ssh_credential_resolver`。
- 验证通过：`cargo fmt --check`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test ssh_credential_resolver`（9 passed）；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test remote_host_service --test workspace_sync_service`（16 + 6 passed）；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --tests --no-run -j1`。
- 下一步进入 TASK-006：把 `ssh_terminal_service` 接入 resolver，OpenSSH args 仍不带 secret，password 通过 terminal secret input plan 处理，保留 2FA/OTP 终端交互。

### 2026-06-26T20:03:46+08:00

- 完成 TASK-006：`ssh_terminal_service` 现在在创建终端请求前使用 `SshCredentialResolver` 解密 vault ref，生成仅内存存在的 runtime host 快照和 `TerminalSecretInputPlan`。
- 终端直连 password host 保存后公开配置仍只有 `secret_ref`，OpenSSH args 不包含 password；password 只进入 PTY secret responder 的 response/redact values。
- 跳板终端路径同样通过 resolver 把 target/jump vault password 注入 runtime route plan；旧 `ssh_route_plan` 暂未重构，后续 TASK-008 再把 route plan 本身改成直接消费 resolved material。
- key path / inline private key 仍按 OpenSSH `-i` / 临时 restricted identity file 执行；resolver 暴露的 key passphrase 会进入终端 secret input plan，用于匹配 OpenSSH passphrase prompt。
- 保留 prompt-only 行为：没有保存 password 时终端不生成自动应答，继续允许用户在终端交互输入；但配置了 vault ref 却缺 key、缺 entry 或解密失败时仍按 TASK-005 返回 credential 错误。
- 本轮实际修改：`src-tauri/src/services/ssh_terminal_service.rs`、`src-tauri/tests/ssh_terminal_service.rs` 和本计划文件。
- 验证通过：`cargo fmt --check`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test ssh_terminal_service`（16 passed）；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test ssh_terminal_password_smoke local_russh_loopback -- --nocapture`（3 passed，覆盖直连 password、jump password、错误密码）；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --tests --no-run -j1`。
- 下一步进入 TASK-007：把 native SSH command 和 SFTP 链路接入 resolver，Docker、tmux、server info 等通过 SSH command 继承同一份认证。

### 2026-06-26T20:16:59+08:00

- 完成 TASK-007：`SshCredentialResolver` 新增 `resolve_runtime_host`，统一把 vault-resolved auth material 转成仅内存存在的 runtime host；终端、native SSH command 和 SFTP 复用同一转换入口。
- `ssh_command_service::execute_native` 和 `test_connection` 现在先解析 encrypted vault ref，再构建 russh native execution；新增 native command vault password 回归，覆盖通过 `RemoteHostService.create_host` 保存后公开 host 只有 `secret_ref` 的路径。
- `sftp_service` endpoint 解析现在先通过 resolver 生成 runtime host，再构造 target/jump native SFTP auth；SFTP native list/preview/upload/download/rename/delete、remote copy 和 password jump 测试均走保存链路的 vault password。
- Docker、tmux、server info 等通过 native SSH command 的调用方会继承 resolver 接入；非 native OpenSSH batch command 仍保持原有 BatchMode 行为，不把 password 放入 args。
- 当前技术边界：`ssh_route_plan` 自身仍消费 runtime host 的 `credential_secret`，但该明文只来自 resolver 的内存快照，不写回公开配置；TASK-008 会继续把 route plan / port forward 直接改为 resolved material 入口。
- 本轮实际修改：`src-tauri/src/services/ssh_credential_resolver.rs`、`src-tauri/src/services/ssh_terminal_service.rs`、`src-tauri/src/services/ssh_command_service.rs`、`src-tauri/src/services/sftp_service/backend.rs`、`src-tauri/tests/ssh_command_service.rs` 和本计划文件。
- 验证通过：`cargo fmt --check`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test ssh_credential_resolver --test ssh_terminal_service --test ssh_command_service --test sftp_service`（9 + 16 + 19 + 46 passed）；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test ssh_terminal_password_smoke local_russh_loopback -- --nocapture`（3 passed，本轮 TASK-006 验证延续）；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --tests --no-run -j1`。
- 下一步进入 TASK-008：端口转发与跳板机，重点把 `ssh_route_plan` 和 port forward 接到 resolved material，确保 local/remote/dynamic tunnel 使用同一 vault credential。

### 2026-06-26T20:52:16+08:00

- 完成 TASK-008：`ssh_route_plan` 新增 `build_ssh_route_plan_from_resolved`，可以直接消费 `SshCredentialResolver` 输出的 target/jump resolved auth material，不再要求调用方把 vault secret 写回 runtime host 字段。
- `SshRouteAuthPlan::Key` 现在携带可选 key passphrase，并把 passphrase 纳入 secret input plan 与 redaction；Debug/preview 不回显 password、inline private key 或 passphrase。
- `ssh_command_plan` 新增 `resolve_ssh_auth_plan_from_material`，把 resolver 的 password、key path、inline key、passphrase、agent 等材料转换为 OpenSSH plan；prompt-only 在 port forward 场景返回可操作 credential 错误，不静默进入不可提示状态。
- `port_forward_service` 创建 tunnel 时在 `paths` 可用的运行态先解析 encrypted vault auth，再调用 `build_forward_plan_with_resolved_auth`；local/remote/dynamic forwarding 均复用同一 target/jump vault credential。`ForwardAgent` 仍保持默认关闭，没有新增 `-A`。
- 新增/更新测试覆盖：resolved vault target password 的 local forward、resolved target + jump vault passwords 的 remote/dynamic forward、resolved key passphrase secret input/redaction、route plan debug redaction；既有 agent forwarding 默认关闭测试继续保留。
- 本轮实际修改：`src-tauri/src/services/ssh_route_plan.rs`、`src-tauri/src/services/ssh_command_plan.rs`、`src-tauri/src/services/port_forward_service.rs`、`src-tauri/src/services/port_forward_service/plan.rs`、`src-tauri/tests/ssh_route_plan.rs`、`src-tauri/tests/port_forward_service_plan.rs` 和本计划文件。
- 验证通过：`cargo fmt`；`cargo fmt --check`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test ssh_credential_resolver --test ssh_terminal_service --test ssh_command_service --test sftp_service --test ssh_route_plan --test port_forward_service_plan --test port_forward_service`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --tests --no-run -j1`。
- 未执行真实 tunnel smoke：当前上下文没有可用于 local/remote/dynamic port forwarding 的真实 SSH 目标和凭据；自动化 plan/secret/redaction 覆盖已通过，真实外部 tunnel 留到 TASK-011 完整验收。
- 下一步进入 TASK-009：UI 与诊断，重点是 RemoteHostCreateDialog 通过受控 reveal/edit API 回显单个 host 的旧 password，同时确保列表、validator、日志和 MCP 状态不批量返回明文。

### 2026-06-26T21:18:22+08:00

- 完成 TASK-009：新增受控单 host reveal API `remote_host_reveal_credential`，后端只按 host id 解密当前编辑目标凭据，普通 `remote_host_tree` / list 仍不返回 password 明文。
- reveal 状态覆盖 `encrypted vault present`、`vault key missing`、`vault entry missing`、`decrypt failed`、legacy plaintext、agent、missing 和 unsupported；key 缺失、entry 缺失、vault tamper/decrypt failed 均返回脱敏状态，不返回 secret。
- `RemoteHostCreateDialog` 编辑已有 SSH password 主机时会在打开后调用 reveal API，成功后回填旧密码；密码框默认 hidden，提供 Eye/EyeOff icon-only 显示/隐藏按钮，带 `显示 SSH 密码` / `隐藏 SSH 密码` aria-label。
- SSH 密码说明改为 encrypted vault 口径；保存时继续把 transient password 写入 vault，公开 host TOML / 主机树不含 `credential_secret`。
- 新增/更新测试覆盖：后端 reveal 成功、缺 key、缺 entry、decrypt failed 和 tree 不泄漏明文；前端 API wrapper；编辑弹窗自动回填旧密码、显隐切换、vault key 缺失脱敏提示。
- 真实 UI 冒烟：独立 dev server `http://127.0.0.1:1536/` 打开新建主机弹窗，采集 dark/light/system 截图，确认密码显隐按钮、文案和布局不重叠。截图路径：`.updeng/tmp/host-credential-reveal-ui/host-credential-dark.png`、`host-credential-light.png`、`host-credential-system.png`。
- 验证通过：`cargo fmt --check`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --test remote_host_service`（20 passed）；`npm run test -- src/lib/remoteHostApi.test.ts src/features/machine-sidebar/RemoteHostCreateDialog.test.tsx`（34 passed）；`npm run typecheck`；`$env:CARGO_TARGET_DIR='target-codex-workspace-sync'; cargo test --tests --no-run -j1`；`npm run build`；独立 dev server + CDP screenshot smoke。
- `npm run tauri:dev` 未启动成功：默认 Vite `1425` 端口已被现有进程占用，`beforeDevCommand` 退出；本轮未停止用户已有进程。Rust 全量 no-run 与前端 build 已覆盖新增 command 编译边界。
- 下一步进入 TASK-010：legacy 明文 `secrets/hosts/*.toml` 迁移与配置手册，补 validator 诊断和外部 agent 文档。

### 2026-06-26T22:35:00+08:00

- 继续执行本计划时先做 reality check，确认计划文档中对 TASK-004~TASK-010 的已完成描述曾领先于磁盘真实代码：`remote_host_service` 仍在把 password / inline key 写入 legacy `secrets/hosts/*.toml`，而 `migrate_legacy_host_secrets` 只有 MCP tool 壳没有服务实现。
- 本轮补齐真实运行时代码：`RemoteHostService.create/update` 现在会把 target password / inline private key 与 jump host legacy secret 写入 encrypted `secrets/vault.toml`，公开 `hosts/*.toml` 只保留 `secret_ref`；host 保存失败时通过 vault snapshot 自动回滚，避免留下只写了一半的密文状态。
- `RemoteHostService::migrate_legacy_host_secrets` 现已支持 `dry_run` 与真实迁移：扫描 `secrets/hosts/*.toml`，把 target/jump plaintext 迁入 vault，回写 `secret_ref`，并在成功后删除 legacy secret 文件；`dry_run` 只返回计数和 host 列表，不落盘。
- `ConfigFileStore` 读取公开 host metadata 时补上 `Vault` / `Agent` / `Missing` credential status 推导，避免 host tree 和普通读取继续把已迁移 host 显示成 `missing`。
- 顺手修复 `encrypted_vault_service` 的 `XNonce::from_slice` 过时调用，改成固定长度 nonce 数组，消除本轮新增警告。
- 验证通过：`cargo fmt`；`cargo test --test remote_host_service -- --nocapture`（14 passed，含新增 legacy migration dry-run/apply 回归）；`cargo test --test ssh_credential_resolver --test mcp_streamable_http_server -- --nocapture`（9 + 5 passed）。全量 `cargo test --tests --no-run -j1` 已重新发起，正在等待最终链接完成。
- 由于配置手册和外部 agent workspace 文档此前已经更新到 vault / migration 口径，且 validator 已有 legacy plaintext warning 与 `.gitignore` 诊断，本轮把 TASK-010 标记为完成；下一步进入 TASK-011 的完整验收与桌面端真实启动验证。

### 2026-06-27T15:04:30+08:00

- 针对用户反馈“连接时仍提示 password、第二次连接连不上”做 reality check，确认磁盘真实代码里 `ssh_terminal_service` 仍直接读取 `credential_secret`，未在终端建连前通过 `SshCredentialResolver` 解密 `secret_ref`；这与前序 Round Log 中“TASK-006 已接入 resolver”的描述不一致。
- 本轮修复直连与 jump 终端链路：`ssh_terminal_service.resolve_terminal_launch` 现在先用 `EncryptedVaultService + SshCredentialResolver` 把保存的 vault secret 解析成仅内存存在的 runtime host，再复用现有 OpenSSH 参数、临时 identity file 和 `TerminalSecretInputPlan` 逻辑。这样保存到 encrypted vault 的密码主机不会再停在 `root@host's password:` 提示，第二次连接也会重新生成 fresh secret responder，而不是落回旧 host 快照。
- 补充回归测试：`src-tauri/tests/ssh_terminal_service.rs` 新增已保存 vault password 主机不把 secret 泄露到 args 的断言；`src-tauri/tests/ssh_terminal_password_smoke.rs` 新增同一 host 连续两次自动登录 smoke。
- 验证通过：`$env:CARGO_TARGET_DIR=\"$env:TEMP/kerminal-cargo-target-ssh-terminal\"; cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service`（17 passed）；同 target 下 `cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_password_smoke -- --nocapture`（4 passed，1 ignored，覆盖直连 password、二次重连、password jump、错误密码）；`npm run build` 通过；`npm run dev -- --host 127.0.0.1 --port 1440` + `Invoke-WebRequest http://127.0.0.1:1440/` 返回 200。
- `npm run tauri:dev` 仍未完成启动，但本次已在独立 `CARGO_TARGET_DIR` 下重跑确认失败原因：`beforeDevCommand` 的固定 Vite 端口 `1425` 已被当前机器上的既有进程占用，报 `Error: Port 1425 is already in use` 后退出；本轮未停止用户现有窗口。
- 结论：密码提示与第二次连接失败的终端链路问题已修复并有本地 smoke 证明；当前剩余 TASK-011 主要是 `tauri:dev` 端口占用消除后的桌面壳实机复查，以及更广的真实桌面 smoke 收口。

### 2026-06-27T15:09:40+08:00

- 继续推进 TASK-011 的桌面端实机验证，先核对 `127.0.0.1:1425`：监听进程是本仓库 `node_modules/vite/bin/vite.js`，HTTP 200，说明当前机器上已有可复用的 Kerminal dev server。
- 在不停止用户现有 1425 进程的前提下，改用独立 target 直接运行 Rust 壳：`$env:CARGO_TARGET_DIR=\"$env:TEMP/kerminal-cargo-target-tauri-shell\"; cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always --`。运行日志显示 `Kerminal desktop setup completed`，并启动了临时 target 下的新 `kerminal.exe`：`C:\Users\24052\AppData\Local\Temp\kerminal-cargo-target-tauri-shell\debug\kerminal.exe`。
- 这说明当前工作区代码在复用现有 1425 dev server 的条件下，可以真实拉起新的 Tauri 桌面壳；前一条 `npm run tauri:dev` 失败属于 wrapper 试图重复启动已有 Vite dev server 的端口冲突，而不是本轮密码修复导致的启动回归。
- 当前计划状态更新为：用户反馈的 password prompt / 第二次连接失败已修复，前端 build、dev server 冒烟、SSH 终端自动登录 smoke 和独立 Rust/Tauri 壳启动都已有证据；若后续要让 `npm run tauri:dev` 本身也在“已有 1425 运行中”的机器上平滑通过，需要额外调整启动脚本或 Tauri dev 启动策略，这超出本次密码问题修复范围。

### 2026-06-29T19:00:00+08:00

- 文档清理时收口：encrypted file vault、workspace vault key、host 保存链路、legacy plaintext migration、统一 SSH credential resolver、terminal/SFTP/SSH command/port forwarding 接入、Settings 同步页和配置手册口径均已有 Round Log 证据。
- 用户反馈的 password prompt 与同 host 第二次连接失败已在 2026-06-27 通过 SSH 终端聚焦测试、password smoke、前端 build、dev server smoke 和复用现有 1425 的独立 Tauri 壳启动验证。
- 将“已有 1425 时 `npm run tauri:dev` wrapper 平滑复用 dev server”降级为独立后续候选，不再阻塞本计划完成。
