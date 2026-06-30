# ADR-0022: Kerminal 加密文件凭据库与统一 SSH 认证运行时

## 状态

Accepted

## 背景

- 用户反馈：Kerminal 连接 SSH 主机时，每次新开终端都会在终端里出现 `user@host's password:`，而成熟终端或 SSH 客户端在保存密码、启用 key 或 agent 后不会反复要求手输。
- 用户明确最终产品方向：
  - AI 助手是第一入口。用户可以把主机、账号、密码交给 AI，AI 应能帮用户添加主机并让终端、SFTP、容器、tmux、端口转发等能力直接可用。
  - UI 编辑主机时希望能看到旧密码，体验应接近当前“界面自己添加/编辑主机”。
  - 不采用系统 Keychain / Credential Manager 作为主存储。Kerminal 自己做加密文件凭据库。
  - 加密密钥也存放在 Kerminal 工作空间里，方便手动迁移整个 `~/.kerminal`。
  - Kerminal 设置里需要新增“同步”入口，允许用户查看工作空间 Git 状态、初始化/修复 `.gitignore`、导入/导出/修改 vault key。
  - 默认创建 `~/.kerminal` 工作空间时尝试初始化 Git 仓库并写入 `.gitignore`；如果机器没有 Git，只提示 Git 不可用，Kerminal 其它功能仍可用。
- 当前 Kerminal 的 SSH 认证事实源分散：
  - `RemoteHostAuthType::Password` 和 `RemoteHost.credential_secret` 仍按“密码随主机记录明文保存”建模。
  - `ConfigFileStore` 会把普通 `hosts/*.toml` 和 `secrets/hosts/*.toml` 合并成 runtime `RemoteHost`，所以终端、SFTP、端口转发、Docker、tmux、server info、MCP SSH tools 都通过同一个 runtime host 读到明文 secret。
  - `ssh_terminal_service`、`sftp_service`、`ssh_command_service`、`ssh_route_plan` 当前各自读取 `credential_secret`。
- README 目前明确写着“当前 SSH 密码和内联私钥随远程主机记录明文保存和展示”。新方案要替换这个长期口径。

## 外部实践结论

| 实践来源 | 关键做法 | 对 Kerminal 的启示 |
| --- | --- | --- |
| OpenSSH `ssh-agent` | `ssh-agent` 保存用于公钥认证的私钥，`ssh` 通过环境变量定位 agent 并自动使用。 | key + agent 仍是推荐认证方式，但不能覆盖用户要求的 password 保存和 AI 添加主机。 |
| OpenSSH `ControlMaster` / `ControlPersist` | 复用底层连接，减少重复认证和新 session 延迟。 | 可作为性能优化，不能替代凭据库。 |
| VS Code Remote SSH | 主要复用 OpenSSH config、key 和 agent；password/2FA 走交互提示。 | 适合开发者生态，但不满足 Kerminal “AI 直接添加 password 主机并可迁移配置”的目标。 |
| PuTTY / Pageant | Pageant 是 SSH authentication agent，把已解锁 private keys 放在内存中供多个 session 复用。 | 认证材料管理要和终端 session 分层。 |
| KeePass / 1Password 类 vault | 文件或云同步保存加密后的 secret，应用解锁后读取。 | Kerminal 的文件优先和 AI-first 目标更接近这个方向。 |
| Tauri Stronghold | Stronghold 可用应用级 secret engine 存 secret 和 key，但需要 vault 初始化、解锁和备份设计。 | 可参考 vault 生命周期，但本决策不引入系统 keychain；先实现 Kerminal 自己的简单加密文件 vault。 |

参考：

- [OpenSSH ssh-agent manual](https://man.openbsd.org/ssh-agent)
- [OpenSSH ssh_config manual](https://man.openbsd.org/ssh_config)
- [VS Code Remote SSH tips: SSH Agent and ControlMaster](https://code.visualstudio.com/docs/remote/troubleshooting#_setting-up-the-ssh-agent)
- [PuTTY Pageant authentication documentation](https://the.earth.li/~sgtatham/putty/0.58/htmldoc/Chapter9.html)
- [Tauri Stronghold plugin](https://v2.tauri.app/plugin/stronghold/)

## 决策驱动因素

- AI-first：AI 应能根据用户提供的 host、username、password 创建或更新主机，并立即可连接。
- 文件优先与可迁移：`~/.kerminal` 作为配置工作空间，迁移时带走 host 配置、加密凭据和 vault key。
- Git 同步友好：公开配置、加密 vault 和普通工作流文件可以提交；`vault-key.toml` 默认不提交。
- 不明文保存：普通 host TOML、日志、MCP 输出、配置校验和主机列表不能出现 password、内联私钥或 key passphrase 明文。
- 可回显：本地 UI 编辑单个主机时，允许受控解密并回填旧 password。
- 完整性：不能只修终端。终端、SFTP、端口转发、Docker/Compose、容器进入、tmux、server info、命令建议和 MCP SSH tools 必须共用同一认证解析层。
- 可测试：加密、解密、迁移、脱敏、缺 key、损坏 vault、旧明文 secret fallback 都要可自动测试。
- 明确安全边界：密钥和密文一起放在工作空间，目标是避免明文暴露和误写配置，不是抵抗“攻击者完整拿到 `~/.kerminal` 后离线解密”。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| 继续使用 `secrets/hosts/*.toml` 明文 secret | 改动最小，所有现有 SSH 能力继续工作 | 密码仍在本地文件明文保存和展示 | 外部 agent 或日志容易误泄露 | 现有测试即可，但不满足目标 |
| 只要求 SSH key + agent | 安全成熟，生态兼容 | 不能覆盖 password 主机和 AI 直接添加账号密码的体验 | 用户仍会看到 Kerminal 缺保存密码能力 | agent/key smoke |
| 系统 Keychain / Credential Manager | 安全边界更强，系统托管密钥 | 不符合用户“密钥也随工作空间迁移”的要求；AI 文件工作流不直观 | 跨平台体验不一致，Linux/headless 更复杂 | 真实系统 keychain smoke |
| Kerminal 加密文件 vault，key 也在工作空间 | AI-first、文件优先、可手动整体迁移；UI 可回显；不明文写配置 | 完整拿到工作空间即可解密；需要实现 vault、key、加密格式、损坏恢复 | 用户误以为等同系统级安全；key 文件误提交 | 加密/解密/迁移/权限/脱敏测试 |
| Kerminal 加密文件 vault + Git 同步忽略 key | 配置和加密 vault 可同步；key 不进 Git；跨机器可通过导入 key 解密 | 多机器同步需要额外导入 key；key 丢失无法恢复 | 用户只 clone Git 后忘记导入 key，导致 vault 不可用 | gitignore/bootstrap/key import/export 测试 |
| Kerminal vault + 用户 master password | 即使工作空间被复制也更难解密 | 每次解锁体验变重；忘记口令无法恢复；AI 自动化更复杂 | 用户迁移后还要管理口令 | vault unlock/e2e |

## 决策

采用“Kerminal 加密文件凭据库 + 工作空间内 vault key + 统一 SSH 认证运行时解析层”的方案。

不采用系统 Keychain / Credential Manager 作为主存储。系统 keychain 仅可作为未来可选 provider 的备选，不进入第一阶段。

### 1. 安全边界

本决策接受以下取舍：

- `~/.kerminal` 中保存加密后的 secret 和解密所需 vault key，便于迁移。
- 这能防止密码以明文出现在 host TOML、普通 `secrets/hosts`、日志、配置校验、MCP 输出和 Git diff 中。
- 这不能防止“完整工作空间连同 `vault-key.toml` 一起被复制后离线解密”。文档、UI 和导出功能必须明确这一点。
- Git 同步默认提交公开配置和加密后的 `secrets/vault.toml`，不提交 `vault-key.toml`。
- `~/.kerminal/secrets/vault-key.toml` 默认加入 `.gitignore`、诊断脱敏和敏感路径提示。
- `~/.kerminal/secrets/vault.toml` 可以提交，因为它只包含 AEAD 密文和 nonce，不包含解密 key；但所有 UI、日志和 MCP 输出仍必须把它当敏感配置路径处理，不复制原文到聊天或日志。
- 新格式下 `secrets/` 目录里只有 `vault-key.toml` 是默认不提交项；旧版明文 `secrets/hosts/` 在迁移完成前必须继续忽略。

### 2. 文件布局

推荐布局：

```text
~/.kerminal/
  .git/
  .gitignore
  hosts/<id>.toml
  secrets/
    vault-key.toml
    vault.toml
    legacy-hosts/<id>.toml
```

`vault-key.toml`：

```toml
schema_version = 1
key_id = "workspace-default"
algorithm = "xchacha20poly1305"
created_at = "..."
master_key = "<base64-32-byte-random-key>"
```

`vault.toml`：

```toml
schema_version = 1

[[entries]]
id = "credential:kerminal:ssh-host:prod-web-01:target:password:v1"
kind = "ssh-password"
algorithm = "xchacha20poly1305"
key_id = "workspace-default"
nonce = "<base64-24-byte-random-nonce>"
ciphertext = "<base64-ciphertext-with-tag>"
created_at = "..."
updated_at = "..."
```

公开 `hosts/<id>.toml` 只保存引用：

```toml
schema_version = 1
id = "prod-web-01"
name = "prod-web-01"
host = "10.0.0.10"
port = 22
username = "deploy"
auth_type = "password"
secret_ref = "credential:kerminal:ssh-host:prod-web-01:target:password:v1"
production = true
```

### 3. 加密格式

- 第一阶段使用 AEAD：`XChaCha20-Poly1305` 或 `AES-256-GCM`。优先 `XChaCha20-Poly1305`，nonce 更长，随机 nonce 操作更稳。
- 每条 secret 使用独立随机 nonce。
- Associated data 绑定：
  - `schema_version`
  - `entry.id`
  - `entry.kind`
  - `host_id`
  - `target|jump:<index>`
  - `algorithm`
  - `key_id`
- `master_key` 由 Kerminal 后端生成，不由 AI 生成。
- 如果 key 文件缺失或损坏，Kerminal 明确提示 vault 不可解密；不静默回退为明文。
- 修改密钥采用显式 key rotation：先用旧 key 解密所有可解密 entry，再用新 32-byte random key 和新 nonce 重加密，最后原子替换 `vault-key.toml` 和 `vault.toml`。
- 如果旧 key 缺失、vault 中存在不可解密 entry 或原子写失败，rotation 必须中止并保留旧文件。

### 3.1 工作空间 Git 与同步设置

Kerminal 工作空间默认具备“可同步但不泄露 key”的文件布局：

```text
~/.kerminal/
  .git/                  # 如果本机安装了 git，则初始化
  .gitignore             # Kerminal 维护的安全忽略规则
  settings.toml
  hosts/*.toml
  profiles/*.toml
  snippets/*.toml
  workflows/*.toml
  secrets/vault.toml     # 可提交：加密密文
  secrets/vault-key.toml # 不提交：解密 key
```

默认 `.gitignore` 至少包含：

```gitignore
# Kerminal local-only secrets
secrets/vault-key.toml
secrets/hosts/

# Local runtime state
logs/
cache/
temp/
agents/sessions/
workspace/session.json
data/command.sqlite
data/port-forwards/sessions.json
```

规则：

- 创建或修复 `~/.kerminal` 工作空间时，Kerminal 检测 `git --version`。
- 如果 Git 可用且工作空间不是仓库，Kerminal 自动执行等价于 `git init` 的初始化，并写入或修复 `.gitignore`。
- 如果 Git 不可用，设置页显示“Git unavailable / 未安装 Git”，同步相关按钮禁用或展示安装提示；主机、终端、SFTP、vault、AI 工具等核心能力继续可用。
- Kerminal 不自动配置远端、不自动 push、不自动 pull；远端同步属于用户显式操作或后续独立设计。
- `vault.toml` 可以提交，`vault-key.toml` 不提交。新机器 clone 工作空间后，如果没有导入 key，只能看到公开配置和 encrypted vault status，不能连接 password 主机。
- 用户需要跨机器使用同一套加密凭据时，通过设置页“导出 key / 导入 key”或手动复制 `vault-key.toml`；只要新机器的 `vault.toml` 和 `vault-key.toml` 匹配，就可以直接解密并使用保存的 password/key passphrase/inline private key。
- 旧版明文 `secrets/hosts/` 不是新同步格式的一部分，必须迁移到 encrypted vault 后再让 Git 同步。

设置页新增“同步”菜单，至少包含：

| 区域 | 功能 | 约束 |
| --- | --- | --- |
| 工作空间 | 显示 `~/.kerminal` 路径、Git available/unavailable、repo initialized、dirty status | 不展示 key 内容 |
| Git | 初始化仓库、修复 `.gitignore`、打开工作空间目录 | 无 Git 时提示但不阻塞其它功能 |
| Vault key | 显示 key status、创建缺失 key、导入 key、导出 key、修改/轮换 key | 导出/导入/轮换都需要明确确认 |
| 同步状态 | 显示可提交文件摘要、ignored key 提示、vault entry 数量 | 不显示 password、key 或 ciphertext 原文 |

修改密钥的生产语义：

- “创建缺失 key”只允许在没有 `vault.toml` 或 vault 为空时自动执行；已有 encrypted vault 且 key 缺失时必须要求导入旧 key 或重新输入凭据。
- “导入 key”会校验 key id、algorithm、master key 长度，并尝试解密 vault 中至少一个 entry 或执行完整 dry-run；失败不覆盖现有 key。
- “导出 key”只通过用户选择的路径写文件或复制到系统剪贴板的显式动作完成；默认不把 key 发给 AI、不写日志。
- “修改/轮换 key”必须做 dry-run、备份旧 `vault-key.toml` 和 `vault.toml`、重加密全部 entry、原子替换、刷新 credential status。
- key rotation 后旧 key 不再能解密新 vault；如用户要多机器同步，必须重新导入新 key。

### 4. 数据模型

新增显式 secret 引用字段，避免继续把 `credential_ref` 同时当“私钥路径”和“secret 引用”使用。

```rust
pub struct RemoteHost {
    pub auth_type: RemoteHostAuthType,
    pub credential_ref: Option<String>,      // 非 secret 定位：私钥路径、agent identity selector
    pub secret_ref: Option<String>,          // 目标主机 password 或 inline private key 的 vault entry id
    pub key_passphrase_ref: Option<String>,  // 私钥 passphrase 的 vault entry id，可选
    pub credential_secret: Option<String>,   // legacy only，迁移后运行主链路禁止依赖
    pub ssh_options: SshOptions,
}
```

跳板机同样支持 `secret_ref` 和 `key_passphrase_ref`。

secret ref 命名：

```text
credential:kerminal:ssh-host:<host_id>:target:password:v1
credential:kerminal:ssh-host:<host_id>:target:inline-private-key:v1
credential:kerminal:ssh-host:<host_id>:target:key-passphrase:v1
credential:kerminal:ssh-host:<host_id>:jump:<index>:password:v1
credential:kerminal:ssh-host:<host_id>:jump:<index>:inline-private-key:v1
credential:kerminal:ssh-host:<host_id>:jump:<index>:key-passphrase:v1
```

### 5. AI-first 写入流程

AI 不自己实现加密，也不直接手写 ciphertext。

AI 使用受控工具：

```text
kerminal.host.upsert_with_credential
kerminal.vault.encrypt_secret
kerminal.config.validate
```

推荐主路径：

```text
用户给 AI 主机、账号、密码
  ↓
AI 调 kerminal.host.upsert_with_credential
  ↓
后端生成/读取 vault key
  ↓
后端加密 password 并写入 secrets/vault.toml
  ↓
后端写 hosts/<id>.toml 的 secret_ref
  ↓
Kerminal 自动刷新主机树
  ↓
AI 调 validate / connection test
```

工具输出只返回：

```json
{
  "hostId": "prod-web-01",
  "secretRef": "credential:kerminal:ssh-host:prod-web-01:target:password:v1",
  "credentialStatus": "encryptedVaultPresent"
}
```

不得返回旧 password 明文。

如果用户明确要让 AI 用更文件化的流程，允许：

```text
AI 调 kerminal.vault.encrypt_secret
  ↓
工具返回 entry id 和已写入路径，或返回可写入的 encrypted entry
  ↓
AI 只把 encrypted entry / secret_ref 写入文件
```

但推荐仍是 `host.upsert_with_credential`，因为它能原子更新 host 和 vault。

### 6. UI 行为

- 新增/编辑 SSH 主机：
  - key/agent 仍作为推荐，但 password 是一等能力。
  - password 模式保存到 Kerminal encrypted vault。
  - 编辑已有主机时，Kerminal UI 可以通过受控 reveal/edit API 解密旧 password，并回填到密码输入框。
  - 密码输入框支持显示/隐藏切换。显示态可看到旧密码，隐藏态使用密码控件。
  - 旧 password 只能通过打开单个主机编辑弹窗或明确 reveal 当前主机凭据读取；不能通过主机树列表、普通配置读取、validator、日志或 MCP 状态接口批量返回。
- 连接时：
  - vault entry 可解密则自动认证。
  - `secret_ref` 存在但 vault entry/key 缺失，提示凭据不可用并引导重新输入或重新导入。
  - 2FA/OTP 或服务器额外 challenge 仍在终端里提示，不保存。
- 诊断：
  - 主机详情显示 credential status：`encrypted vault present`、`vault key missing`、`vault entry missing`、`decrypt failed`、`legacy plaintext secret`、`prompt-only`。
  - 错误信息不得包含 secret 值或 key 文件内容。
- 设置 / 同步：
  - 设置页新增“同步”菜单，集中显示工作空间路径、Git 状态、`.gitignore` 状态、vault key 状态和 encrypted vault 状态。
  - 用户可在该菜单中初始化 Git、修复 `.gitignore`、导入/导出 vault key、修改/轮换 vault key。
  - 无 Git 时只显示提示，不影响终端、SFTP、vault、AI 添加主机和本地配置刷新。
  - 所有 key 操作使用本地对话框和确认弹窗；界面不以普通文本长期展示 `master_key`。

### 7. 统一认证运行时

新增后端服务 `SshCredentialResolver` 或 `SshAuthRuntimeService`：

```rust
pub struct SshAuthRuntimeService {
    vault: KerminalEncryptedVault,
}

pub enum ResolvedSshAuthMaterial {
    Agent { identity_file: Option<PathBuf> },
    Password { secret: SshSecret },
    PrivateKeyPath { path: PathBuf, passphrase: Option<SshSecret> },
    InlinePrivateKey { content: SshSecret, passphrase: Option<SshSecret> },
    PromptOnly,
}
```

所有 SSH 派生能力只从该服务取认证材料：

| 能力 | 当前入口 | 目标接入方式 |
| --- | --- | --- |
| 终端 shell | `ssh_terminal_service` + OpenSSH PTY | resolver 解密 password，生成 OpenSSH args 和 `TerminalSecretInputPlan` |
| SFTP | `sftp_service::backend` + native russh | resolver 输出 `SftpAuthMaterial` |
| SSH command | `ssh_command_service::execute_native` | resolver 输出 `NativeSshAuthMaterial` |
| Docker/容器 | `docker_host_service` 经 SSH command/terminal | 自动继承 resolver |
| tmux | `tmux_service` 经 SSH command/terminal | 自动继承 resolver |
| server info | `server_info_service::snapshot_native` | 自动继承 resolver |
| port forward | `port_forward_service/plan` + OpenSSH/russh 路由 | resolver 输出 route plan 和 prompt responder |
| MCP SSH tools | `mcp_tool_executor_service/ssh_tools.rs` | 只消费 resolver，不暴露 secret 明文 |

### 8. Legacy 迁移

`secrets/hosts/*.toml` 作为 legacy plaintext source，不再作为生产推荐。

迁移规则：

1. 启动或 host refresh 时检测 legacy secret，不自动展示明文。
2. UI 或 AI 工具提示“迁移到 Kerminal encrypted vault”。
3. 用户确认后：
   - 读取 `credential_secret`。
   - 用 workspace vault key 加密并写入 `secrets/vault.toml`。
   - 更新 `hosts/<id>.toml` 的 `secret_ref` / `key_passphrase_ref`。
   - 删除或移动旧明文 `secrets/hosts/<id>.toml` 到 `secrets/legacy-hosts/` 的无 secret 标记。
4. 如果加密或写入失败，原文件保持不动。
5. validator 对明文 legacy secret 报 warning 或 error，提示迁移。

### 9. 安全与 AI 边界

- 普通 host TOML、主机树列表、config validate、logs、diagnostics、MCP 状态输出不包含 password 明文。
- `vault-key.toml` 和 `vault.toml` 是敏感文件；AI 默认不读取 key 内容，不把 key 或 ciphertext 粘进聊天、日志、文档。
- 允许 AI 根据用户提供的 password 调用受控工具写入加密 vault。
- 默认不提供外部 AI 读取旧 password 的工具。UI 可以 reveal；AI 只可写入和看 status。若未来需要 AI reveal，必须作为高风险能力单独开关。
- OpenSSH 命令行参数不包含 password 或 inline private key。
- native russh 路径只在内存中持有 `SshSecret`；后续实现可用 `zeroize` 或 `secrecy` 收窄生命周期。
- `ForwardAgent` 默认关闭。生产主机如需要 agent forwarding，必须 per-host 显式配置并在 UI 标注风险。

## 影响

- 正向影响：
  - Kerminal 达到用户期望的 AI-first 体验：AI 可以添加账号密码主机，主机立刻可用于终端、SFTP、容器、tmux、端口转发和 MCP tools。
  - `~/.kerminal` 可整体迁移，带走公开配置、加密凭据和 vault key。
  - `~/.kerminal` 可作为 Git 工作空间同步公开配置和 encrypted vault，默认不提交 vault key。
  - 密码不再以明文进入普通 host TOML、日志和配置校验输出。
  - UI 编辑单个主机时仍可看到旧 password。
- 负向影响：
  - 完整复制 `~/.kerminal` 且包含 `vault-key.toml` 的人可以离线解密凭据；这是一项已接受产品取舍。
- 只同步 Git 仓库到新机器时，password 主机不能直接连接，必须导入匹配的 vault key 或重新输入密码。
  - 需要实现 vault key、加密格式、原子写、备份、损坏恢复和 validator。
  - 需要实现 workspace Git bootstrap、`.gitignore` 修复、无 Git 降级提示和设置页同步菜单。
  - 需要把现有 `CredentialService` 从系统 keyring 抽象改造成 Kerminal encrypted file vault 或新增并替换 SSH 路径。
- 需要同步修改：
  - `src-tauri/src/services/external_agent_workspace.rs` 或 workspace bootstrap 入口
  - `src-tauri/src/services/workspace_sync_service.rs` 或同等 Git/status facade
  - `src-tauri/src/models/remote_host.rs`
  - `src-tauri/src/services/credential_service.rs` 或新增 `encrypted_vault_service.rs`
  - `src-tauri/src/services/remote_host_service.rs`
  - `src-tauri/src/storage/config_file_store.rs`
  - `src-tauri/src/services/ssh_terminal_service.rs`
  - `src-tauri/src/services/sftp_service/*`
  - `src-tauri/src/services/ssh_command_service.rs`
  - `src-tauri/src/services/ssh_route_plan.rs`
  - `src-tauri/src/services/port_forward_service/*`
  - Docker、tmux、server info、MCP SSH tools 的相邻测试
  - `src/lib/remoteHostApi.ts`、`src/lib/workspaceSyncApi.ts`、`RemoteHostCreateDialog`、`SettingsToolContent` 同步菜单、配置手册和外部 Agent workspace 文档

## 回滚或替代

- 第一阶段保留 legacy `credential_secret` 解析作为只读 fallback；resolver 优先 encrypted vault，缺失时才标记 `legacyPlaintextSecret`。
- 如果 vault key 缺失或 decrypt failed：
  - 不尝试猜测或静默创建新 key 覆盖旧 vault。
  - UI 提示用户重新导入、重新输入密码或恢复 `vault-key.toml`。
- 如果 Git 不可用：
  - 不影响本地工作空间和 vault 使用。
  - 设置页同步菜单显示 Git 不可用，初始化/状态/提交相关动作禁用或提示安装 Git。
- 如果 `.gitignore` 被用户改坏：
  - 设置页提供“修复 Kerminal 安全忽略规则”，只追加/恢复 Kerminal 管理的必要规则，不删除用户自定义规则。
- 如果某个 SSH 派生能力迁移失败，可以临时只在该能力启用 legacy fallback，但必须在测试矩阵中标为未完成，不能宣称方案完成。
- 如后续要增强安全，可新增可选 master password 或系统 keychain provider，但不替代本决策的默认迁移型 vault。

## 实施计划

执行计划见：

- `.updeng/docs/plan/active/PLAN-20260626-164938-ssh-credential-vault-auth-runtime.md`

关键切片：

1. 新增工作空间 Git bootstrap、`.gitignore` 安全规则、设置页同步菜单和 vault key 管理入口。
2. 新增 Kerminal encrypted vault 文件格式、workspace vault key 和加解密服务。
3. 新增 secret ref 模型、credential status 和 vault entry id 生成规则。
4. 改造 host create/update 和 AI `host.upsert_with_credential`：保存 secret 到加密 vault，公开配置只保存 ref。
5. 新增 `SshAuthRuntimeService`，统一 target/jump 解密和认证材料解析。
6. 接入终端、SFTP、SSH command、Docker、tmux、server info、port forward 和 MCP SSH tools。
7. 改造 UI：编辑主机时可受控回显旧 password，提供显示/隐藏切换、agent/key 引导、vault 状态和同步菜单。
8. 提供 legacy `secrets/hosts` 显式迁移和 validator 更新。
9. 跑完整自动化和真实 loopback/外部主机 smoke。

## 验证

完成标准不是“终端不再提示 password”单点通过，而是下面矩阵全绿：

| 验证项 | 必须覆盖 |
| --- | --- |
| 加密 vault | key 生成、加密、解密、错误 key、损坏 TOML、重复 nonce 防护、原子写、备份恢复 |
| 工作空间 Git | 首次创建 `~/.kerminal` 时 Git 可用自动 init；无 Git 仅提示；`.gitignore` 包含 key ignore；修复规则不删除用户自定义规则 |
| 同步设置 | 设置页同步菜单显示 Git/vault/key 状态；导入/导出/轮换 key；key 缺失、有 vault 时不自动覆盖 |
| 单元测试 | secret ref 生成、credential status、host normalize、config split/merge、legacy migration、redaction |
| AI 工具 | `host.upsert_with_credential` 可创建 password 主机，输出不含 password；validator 可识别 vault 状态 |
| UI | 新建/编辑 host、回显旧 password、显示/隐藏、清空/替换密码、三主题可读 |
| 终端 | password vault、key path、agent、jump host password、OTP fallback、断开重连 |
| SFTP | list、upload、download、rename、delete、跨主机复制，均使用 vault/agent 认证 |
| SSH command | server info、command suggestion probe、tmux query、Docker/Compose inspect、容器进入 |
| port forward | local、remote、dynamic tunnel，含 password target 和 jump host |
| MCP | SSH/SFTP/container/port tools 不暴露 secret，credential missing 给出可操作错误 |
| 迁移 | legacy `secrets/hosts` 导入 encrypted vault、失败回滚、重复迁移幂等 |
| 启动 | `npm run build`、真实 dev server、涉及 Tauri/Rust 后 `npm run tauri:dev` |
