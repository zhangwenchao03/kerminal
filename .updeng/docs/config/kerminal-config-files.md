<!-- @author kongweiguang -->

# Kerminal 文件优先配置

## 根目录

Kerminal 当前文件优先配置根默认为 `~/.kerminal`。右栏 Agent Launcher 启动 Codex、Claude 或自定义 CLI 时，默认工作目录是对应会话目录 `~/.kerminal/agents/sessions/<agentSessionId>`；全局 `~/.kerminal` 仍是配置事实源、通用规则和配置手册所在目录。

`~/.kerminal` 表示当前用户 home 下的 Kerminal 根目录，适用于 Windows、macOS 和 Linux。文档、生成模板和示例不要写成某台机器固定目录，例如 `C:/Users/...`、`/Users/...` 或 `/home/...`，除非用户明确要求绝对路径。

```text
~/.kerminal/
  AGENTS.md
  CLAUDE.md
  .codex/config.toml
  .mcp.json
  settings.toml
  profiles/*.toml
  hosts/groups.toml
  hosts/*.toml
  snippets/*.toml
  workflows/*.toml
  agents/sessions/<agentSessionId>/
  data/command.sqlite
  data/port-forwards/sessions.json
  logs/local-file-operations/YYYY-MM-DD.jsonl
  secrets/vault-key.toml
  secrets/vault.toml
```

当前版本不读取、不迁移早期一体化 SQLite 配置。普通配置文件是当前事实源；`data/command.sqlite` 只保留命令历史和命令建议专用数据。

`secrets/vault-key.toml` 是当前默认的 SSH 凭据加密密钥，必须留在本机；`secrets/vault.toml` 是密文，可随 `~/.kerminal` 工作空间一起提交到 Git，但默认应该被 `kerminal-config.md` 提示用户考虑风险。SSH 密码、内联私钥和跳板机 secret 只通过 UI 保存链路或授权的 vault 工具写入 encrypted vault。

## 跨平台路径规则

- `~`、`~/...`、`~\...` 表示当前用户 home；Kerminal 在本地 SSH/SFTP 私钥路径中会展开这些写法。
- `~/.ssh/id_ed25519` 是推荐的私钥路径示例，Windows、macOS 和 Linux 都可以使用。不要把示例改成固定的 `C:/Users/<name>/.ssh/...`、`/Users/<name>/.ssh/...` 或 `/home/<name>/.ssh/...`。
- 不支持 `~otheruser/...` 这类跨用户 home 写法；需要这种路径时让用户给出明确绝对路径。
- 本地终端 profile 的 shell 按平台写：macOS/Linux 常用 `zsh`、`bash`，Windows 常用 `pwsh` 或 `powershell.exe`，但 `cwd` 仍优先写 `~/.kerminal`。

## AI 助手操作协议

外部 Agent 修改 Kerminal 配置前必须先读本文件；在生成的 `~/.kerminal` 工作目录中，本文件对应 `kerminal-config.md`。

操作顺序：

1. 明确用户要改的是设置、profile、主机、片段还是 workflow。
2. 用 `rg` 精确定位目标 `id`、`name`、`host`、`tag` 或字段，不要全目录重排。
3. 只编辑对应 TOML；跨文件关系必须同步检查，例如 host 的 `group_id` 要存在于 `hosts/groups.toml`。
4. 未在本文列出的字段不要臆造；先保留现有字段和值，必要时查看当前代码模型或询问用户。
5. 修改后调用 MCP 工具 `kerminal.config.validate`；MCP 不可用时，至少人工检查本文件列出的 schema、id、引用、host `production`、secret 和排序规则，并在交付中说明。运行中的 Kerminal 会自动感知配置文件变化并刷新界面，但自动刷新不替代校验。

## 运行时自动刷新

Kerminal 运行中会监听文件型配置目录。外部 Agent、编辑器或脚本修改普通配置文件后，应用会在短暂稳定窗口后按配置域重新读取事实源：

- `settings.toml`：刷新主题、密度、终端外观和低频设置。
- `profiles/*.toml`：刷新本地终端 profile，并同步 `sidebar_group_id` 对应的左侧本地连接。
- `hosts/groups.toml`、`hosts/*.toml`：刷新左侧主机树和主机分组；凭据状态来自 encrypted vault，本轮不监听 `secrets/vault*.toml` 的写入，host 保存链路会同步刷新 `secret_ref` 字段。
- `snippets/*.toml`、`workflows/*.toml`：刷新右栏命令片段和 workflow 目录。

刷新成功后，界面会显示一条简洁自动关闭提示，例如 `cfg: +1 host "staging-api"`、`cfg: hosts +2, snippets +1`、`cfg: settings reloaded`。提示只基于公开 UI 状态生成，不展示本地绝对路径、原始 TOML、密码、私钥、token 或 secret 文件名；凭据变化最多显示为 `cfg: host credentials updated`。

如果外部写入过程中 TOML 暂时无效，Kerminal 会保留 last-known-good 界面状态，不清空主机树、不关闭现有终端，并提示 `cfg: invalid TOML, kept last-known-good`。修复文件并再次保存后会自动恢复刷新。Agent 仍必须运行 `kerminal.config.validate` 并修复所有诊断后再报告完成。

## 文件关系速查

| 文件 | 作用 | 关键关系 | 默认是否可改 |
| --- | --- | --- | --- |
| `settings.toml` | 应用设置、外观、终端、快捷键、SFTP 性能 | 独立文件，业务范围由 `AppSettings.validated()` 校验 | 是 |
| `profiles/*.toml` | 本地终端启动 profile | 文件名必须等于 `id`；`sidebar_group_id` 可引用 `hosts/groups.toml` 让该 profile 固定显示在左侧分组 | 是 |
| `hosts/groups.toml` | 主机分组和排序 | `groups[].id` 被 `hosts/*.toml` 的 `group_id` 引用 | 是 |
| `hosts/*.toml` | 主机普通元数据 | 文件名必须等于 `id`；`group_id` 引用 group；`secret_ref` 指向 encrypted vault entry，密码/内联私钥/跳板机 secret 拆到 `secrets/vault.toml` | 是 |
| `snippets/*.toml` | 可复用单条命令 | 文件名必须等于 `id`；`scope` 控制 local/ssh/any | 是 |
| `workflows/*.toml` | 多步骤命令流程 | 文件名必须等于 `id`；`[[steps]]` id 唯一，`sort_order` 递增 | 是 |
| `data/command.sqlite` | 命令历史和建议数据 | 只通过 `history.search` 查询 | 否 |
| `secrets/vault-key.toml` | 加密 vault master key | 主路径使用 32-byte random key + XChaCha20-Poly1305；该文件**不能提交**到 Git | 否 |
| `secrets/vault.toml` | 加密 SSH 凭据密文 | 每条 secret 独立 nonce + AAD；可随 workspace 提交到 Git，导入匹配 key 后可直接使用 | 否 |

## 配置校验

优先使用 Kerminal MCP 的只读校验工具，分发用户不需要 Node.js 或源码 checkout：

```json
{"tool":"kerminal.config.validate","arguments":{"scope":"all"}}
```

`scope` 可用值：`all`、`settings`、`profiles`、`hosts`、`snippets`、`workflows`。跨文件编辑用 `all`；单类文件编辑可用较窄 scope。

如果 MCP Server 不可用，按下列范围人工检查并在交付中说明“未执行自动校验”。

校验范围：

- `settings.toml` 必须存在。
- 所有普通 TOML 必须包含顶层 `schema_version = 1`。
- `profiles/*.toml`、`hosts/*.toml`、`snippets/*.toml`、`workflows/*.toml` 的 `id` 必须等于文件名。
- profile `sidebar_group_id` 为空时不显示为左侧连接；非空时必须引用已有 host group。
- `hosts/groups.toml` 的 group id 必须唯一；host `group_id` 必须引用已有 group。
- `hosts/*.toml` 必须显式包含布尔字段 `production = true|false`；Agent 新写文件不要省略该字段。
- `hosts/*.toml` 禁止写入任何 `password`、`secret`、`credential_secret`、`apiKey`、`privateKey`、`token`、`inline_private_key` 等明文凭据字段；保存凭据必须走 `secret_ref` + encrypted `secrets/vault.toml` 或经授权的 UI / `kerminal.host.upsert_with_credential` 工具路径。
- `~/.kerminal/.gitignore` 必须忽略 `secrets/vault-key.toml`；密钥文件若不忽略则 validator 报 error，外部 Agent 修复工作空间同步菜单可一键补齐。
- workflow `[[steps]]` 的 step id 必须唯一，`sort_order` 必须递增，`scope` 必须合法。
- 普通配置文件中禁止 `password`、`secret`、`credential_secret`、`apiKey`、`privateKey`、`token` 等 secret-like key 或 table。

## 通用规则

- 字段名以 Rust TOML 落盘模型为准，wrapper 字段使用 snake_case，例如 `schema_version`、`group_id`、`sidebar_group_id`、`auth_type`、`sort_order`、`created_at`、`updated_at`、`ssh_options`、`requires_confirmation`、`secret_ref`、`key_passphrase_ref`。
- `settings.toml` 的业务字段沿用 `AppSettings` serde 字段，当前文件中已有的 camelCase 字段应原样保留，不要改成 snake_case。
- 只小范围编辑目标文件，不批量重排所有 TOML。
- 默认不读取、不修改 `secrets/`。用户明确要求处理凭据时，走 encrypted vault（`secret_ref` + `kerminal.host.upsert_with_credential` / `kerminal.vault.encrypt_secret`）；不要直接编辑 `secrets/vault*.toml`。
- `logs/`、`cache/`、`temp/`、`data/command.sqlite` 默认不由外部 agent 直接修改。

## 必填字段矩阵

Agent 新建或重写配置文件时必须显式写出下列字段。Agent 产物必须完整、可审查、可 validator 拦截。

| 文件 | 必填字段 |
| --- | --- |
| `settings.toml` | `schema_version`，以及本次修改涉及的 documented settings 字段 |
| `profiles/*.toml` | `schema_version`、`id`、`name`、`shell`、`is_default`、`sort_order`、`created_at`、`updated_at` |
| `hosts/groups.toml` | `schema_version`；每个 `[[groups]]` 需要 `id`、`name`、`sort_order`、`created_at`、`updated_at` |
| `hosts/*.toml` | `schema_version`、`id`、`name`、`host`、`port`、`username`、`auth_type`、`tags`、`production`、`sort_order`、`created_at`、`updated_at`；保存过密码/内联私钥/跳板机 secret 时需要 `secret_ref`（每个 `[[ssh_options.jump_hosts]]` 同步加 `secret_ref`），Agent 不得写明文 `credential_secret`/`password`/`private_key` |
| `secrets/vault-key.toml` | 由 Kerminal 加密 vault 服务管理，外部 Agent 不直接编辑；修改/轮换/导入/导出 key 走设置页"同步"菜单，MCP 只暴露授权保存 secret 的 `kerminal.vault.encrypt_secret` |
| `secrets/vault.toml` | 由 Kerminal 加密 vault 服务管理，外部 Agent 不直接编辑；新增/更新主机凭据走 `kerminal.host.upsert_with_credential` 或 UI 保存路径 |
| `snippets/*.toml` | `schema_version`、`id`、`title`、`command`、`scope`、`sort_order`、`created_at`、`updated_at` |
| `workflows/*.toml` | `schema_version`、`id`、`title`、`scope`、`sort_order`、`created_at`、`updated_at`；每个 `[[steps]]` 需要 `id`、`title`、`command`、`requires_confirmation`、`sort_order`、`created_at`、`updated_at` |

示例里的 `"1"` 只是占位时间戳。修改已有文件时优先保留原有时间字符串；新建文件时使用当前项目已有生成口径或清晰的字符串时间。

## 常用修改 recipes

新增主机分组：

1. 编辑 `hosts/groups.toml`。
2. 追加一个 `[[groups]]`，写入 `id`、`name`、`sort_order`、`created_at`、`updated_at`。
3. 不要使用 `groups` 或 `__ungrouped__` 作为 id。
4. 调用 `kerminal.config.validate`，scope 可用 `hosts`。

新增本地 profile：

1. 创建 `profiles/<id>.toml`。
2. 写入 `id`、`name`、`shell`、`args`、`cwd`、`is_default`、`sort_order`、`created_at`、`updated_at`。
3. 只有 profile 需要显示在左侧主机树时才加 `sidebar_group_id`，且值必须引用 `hosts/groups.toml`。
4. 不要在 `[env]` 写 token、password、secret。

新增 snippet：

1. 创建 `snippets/<id>.toml`。
2. 写入 `title`、`command`、`scope`、`sort_order`、`created_at`、`updated_at`。
3. `scope` 按用途选择 `any`、`local` 或 `ssh`。
4. 命令里不要嵌入密码、token 或私钥。

新增 workflow：

1. 创建 `workflows/<id>.toml`。
2. 先写 workflow 元数据，再按执行顺序写 `[[steps]]`。
3. 每个 step 的 `id` 在同一 workflow 内唯一，`sort_order` 必须递增。
4. 危险步骤写 `requires_confirmation = true`；这是本地 workflow UI 策略，不是 MCP approval 队列。

保存主机密码或内联私钥（推荐路径）：

1. 默认通过 Kerminal UI 新建/编辑主机，或 AI 助手调用 `kerminal.host.upsert_with_credential` 工具；密码/内联私钥会自动加密进 `secrets/vault.toml`，公开 `hosts/<id>.toml` 只写 `secret_ref`。
2. `secrets/vault-key.toml` 由 Kerminal 自动管理，外部 Agent 不要直接读写；轮换/导入/导出 key 走设置页"同步"菜单，MCP 只暴露授权保存 secret 的 `kerminal.vault.encrypt_secret`。
3. 跨机器使用：先同步 `secrets/vault.toml`（可提交），再导入匹配 `secrets/vault-key.toml`（不提交）；找不到匹配 key 时会要求重新输入密码。
4. 调用 `kerminal.config.validate`，scope 推荐 `hosts` 或 `all`。

## settings.toml

用途：应用外观、终端外观、快捷键、SFTP 性能和其它低频设置。

最小示例：

```toml
schema_version = 1
themeMode = "dark"
interfaceDensity = "comfortable"
```

注意：

- settings 内部的业务字段沿用现有 `AppSettings` serde 字段，主要是 camelCase。
- 常见枚举包括 `themeMode = "dark" | "light" | "system"`、`interfaceDensity = "compact" | "comfortable" | "spacious"`。
- 背景图路径、终端字体、字号、行高、scrollback 和 SFTP 性能仍由 Kerminal service 做完整范围校验。

## profiles/*.toml

用途：本地终端 profile。

macOS/Linux 示例：

```toml
schema_version = 1
id = "default-zsh"
name = "zsh"
shell = "zsh"
args = ["-l"]
cwd = "~/.kerminal"
is_default = true
sort_order = 10
created_at = "1"
updated_at = "1"

[env]
RUST_LOG = "info"
```

Windows 示例：

```toml
schema_version = 1
id = "default-pwsh"
name = "PowerShell"
shell = "pwsh"
args = ["-NoLogo"]
cwd = "~/.kerminal"
is_default = true
sort_order = 20
created_at = "1"
updated_at = "1"
```

规则：

- 文件名必须是 `<id>.toml`。
- `id` 只能包含 ASCII 字母、数字、`.`、`_`、`-`。
- `sidebar_group_id` 可选；只有从左侧主机树保存为连接的本地终端才需要设置，值必须引用 `hosts/groups.toml` 中已有分组。不要为了显示所有 profile 批量补这个字段。
- `cwd = "~/.kerminal"` 是跨平台推荐值；不要改成分发者电脑上的绝对路径。
- `env` 里不要放 `*_TOKEN`、`*_SECRET`、`PASSWORD` 等敏感变量。

## hosts/groups.toml

用途：主机分组和排序。

```toml
schema_version = 1

[[groups]]
id = "prod"
name = "Production"
sort_order = 10
created_at = "1"
updated_at = "1"
```

规则：

- `groups[].id` 必须唯一。
- `groups` 是保留文件名，不能作为主机 id。
- `__ungrouped__` 是运行态默认分组 id，不能写入 `hosts/groups.toml`。

## hosts/*.toml

用途：Local/SSH/Telnet/Serial/RDP/Container 等保存目标的普通元数据。凭据拆到 encrypted `secrets/vault.toml`，公开 host TOML 只引用 `secret_ref`，不再持有明文。

```toml
schema_version = 1
id = "prod-web-01"
group_id = "prod"
name = "prod-web-01"
host = "10.0.0.10"
port = 22
username = "deploy"
auth_type = "agent"
credential_ref = "~/.ssh/id_ed25519"
secret_ref = "credential:kerminal:ssh-host:prod-web-01:target:private-key:v1"
tags = ["prod", "web"]
production = true
sort_order = 10
created_at = "1"
updated_at = "1"

[ssh_options.proxy]
protocol = "none"

[[ssh_options.jump_hosts]]
index = 0
host = "jump.example.com"
port = 22
username = "deploy"
auth_type = "password"
secret_ref = "credential:kerminal:jump-host:prod-web-01:jump-0:password:v1"
```

规则：

- 文件名必须是 `<id>.toml`。
- `group_id` 为空或引用 `hosts/groups.toml` 中已有 id。
- `auth_type` 只能是 `password`、`key`、`agent`。
- `credential_ref = "~/.ssh/id_ed25519"` 是跨平台推荐示例；Kerminal 会在本地私钥路径中展开当前用户 `~`。
- `production` 必须显式写出。生产或安全敏感主机写 `true`，普通开发/测试/本地目标写 `false`；不要省略该字段。历史文件缺少该字段时，Kerminal 会按 `false` 加载，避免配置整体失效。
- 保存过密码或内联私钥的目标会同时写入顶层 `secret_ref`（target secret），跳板机写在 `[[ssh_options.jump_hosts]].secret_ref`；key passphrase 写 `key_passphrase_ref`。`secret_ref` 当前格式为 `credential:kerminal:<kind>:<host_id>:<scope>:<material>:v1`，`<material>` 是 `password` / `private-key` / `key-passphrase` 之一。
- 普通 host TOML 禁止 `password`、`credential_secret`、`inline_private_key`、`apiKey`、`privateKey`、`token` 等明文凭据字段；明文由 validator 拒收，明文保存请求必须改走 encrypted vault（UI 保存或 `kerminal.host.upsert_with_credential`）。

新增主机 checklist：

1. 读取 `hosts/groups.toml`，选择已有 `group_id`；没有分组时省略或留空 `group_id`，不要写 `__ungrouped__`。
2. 选择稳定 ASCII `id`，创建 `hosts/<id>.toml`；文件名和 `id` 必须完全一致。
3. 写全必填字段，尤其是 `production = true|false`。
4. `auth_type = "agent"` 表示使用 ssh-agent；`auth_type = "key"` 搭配 `credential_ref = "~/.ssh/id_ed25519"`；`auth_type = "password"` 只描述认证方式，密码不写普通 host TOML。
5. 只有用户要求 proxy、tunnel、jump host、terminal 或 transfer 行为时才新增 `[ssh_options.*]`；每个 `[[ssh_options.jump_hosts]]` 同步维护 `index`、`host`、`port`、`username`、`auth_type` 和 `secret_ref`。
6. 调用 `kerminal.config.validate`，推荐 `scope = "hosts"` 或 `scope = "all"`；失败时先修文件再交付。

常见失败：

- 文件存在但 Kerminal 不显示：检查 TOML 语法、`schema_version`、`id` 与文件名、必填字段和 validator 诊断。
- 分组不对：检查 `group_id` 是否引用 `hosts/groups.toml`，不要把运行态 `__ungrouped__` 写进文件。
- 登录仍然要输入凭据：普通 host TOML 不保存密码或内联私钥；首次保存必须由用户在 UI 输入，或调用 `kerminal.host.upsert_with_credential` 走 encrypted vault 路径。
- validator 报 `credential_secret is forbidden in hosts/*.toml`：把凭据字段移除，只保留 `secret_ref`；密码本身去设置页同步菜单 / 主机编辑弹窗或 MCP upsert 工具写入。
- 编辑已有主机需要回填旧密码：让用户在 Kerminal UI 重新保存凭据，或在用户明确提供新凭据时使用 `kerminal.host.upsert_with_credential` / `kerminal.vault.encrypt_secret`；外部 MCP 不提供 `remote_host.*` reveal/CRUD 工具，不要把 password 写回 host TOML。
- 已有 `secret_ref` 但仍提示密码：检查 `secrets/vault.toml` 是否能由当前 `secrets/vault-key.toml` 解密；缺 key 时诊断会显示 `vault key missing`，可去同步菜单导入或重新输入密码。
- 手工检查看似通过但应用不对：优先以 MCP `kerminal.config.validate` 为准，因为它走 Kerminal 运行时代码加载。
- 运行中的界面还没出现新主机：等待 debounce 稳定窗口后再看；若仍未刷新，先运行 `kerminal.config.validate`，再查看 diagnostics 里的 config watcher 状态。

## secrets/vault-key.toml

用途：加密 vault master key。Kerminal 默认使用 32-byte random key + XChaCha20-Poly1305；外部 Agent 不要直接读写。

```toml
schema_version = 1
key_id = "vault-2026-06-26T16:49:38Z"
algorithm = "xchacha20poly1305"
created_at = "2026-06-26T16:49:38Z"
master_key = "base64-encoded-32-bytes"
```

规则：

- 路径必须在 `~/.kerminal/.gitignore` 忽略（`secrets/vault-key.toml`），不要提交到 Git；丢失后无法恢复密文，只能让用户重新输入密码。
- 修改 / 轮换 / 导入 / 导出 vault key 走设置页"同步"菜单；外部 Agent 只在用户明确授权保存凭据时使用 `kerminal.vault.encrypt_secret` 写入新的加密 secret，不读取或导出既有明文。
- 已有 vault entries 时导入新 key 必须能解密当前 vault，否则拒绝写入；Kerminal 不会自动用导入 key 覆盖 vault。
- 默认权限 0600（macOS/Linux）或 ACL（Windows）；其它用户或进程不应可读。

## secrets/vault.toml

用途：保存主机密码、内联私钥、跳板机 secret、key passphrase 的加密密文；每条 secret 独立 nonce + AAD，AAD 绑定 entry id、kind、host id、key id。

```toml
schema_version = 1
key_id = "vault-2026-06-26T16:49:38Z"
algorithm = "xchacha20poly1305"
created_at = "2026-06-26T16:49:38Z"
updated_at = "2026-06-26T16:49:38Z"

[[entries]]
entry_id = "<deterministic-derived-id>"
kind = "ssh-host"
associated_data = "credential:kerminal:ssh-host:prod-web-01:target:password:v1"
nonce = "base64-24-bytes"
ciphertext = "base64-ciphertext"
created_at = "2026-06-26T16:49:38Z"
```

规则：

- 路径在 `~/.kerminal`；该文件可随 workspace 提交到 Git，但默认应提示用户考虑风险；导入匹配 `vault-key.toml` 后即可解密使用。
- 不要尝试手写条目；新增/更新凭据走 UI 保存或 `kerminal.host.upsert_with_credential` / `kerminal.vault.encrypt_secret` 工具。
- 不要把 `nonce` / `ciphertext` / `master_key` 复制到聊天、文档、日志或测试。
- vault 文件损坏时 Kerminal 会保留 last-known-good vault 并提示解密失败；不要让外部 Agent 强行覆盖 `vault.toml`。

## snippets/*.toml

用途：可复用命令片段。

```toml
schema_version = 1
id = "restart-service"
title = "Restart service"
description = "Restart app service"
command = "systemctl restart app"
tags = ["systemd"]
scope = "ssh"
sort_order = 10
created_at = "1"
updated_at = "1"
```

规则：

- 文件名必须是 `<id>.toml`。
- `scope` 只能是 `any`、`local`、`ssh`。
- command 文本可以包含普通命令参数，但不要把密码、token 或私钥写进命令。

## workflows/*.toml

用途：多步命令 workflow，workflow 和 steps 放在同一个文件。

```toml
schema_version = 1
id = "deploy-check"
title = "Deploy check"
description = "Check service before deploy"
tags = ["deploy"]
scope = "ssh"
sort_order = 10
created_at = "1"
updated_at = "1"

[[steps]]
id = "check-disk"
title = "Check disk"
description = "Show disk usage"
command = "df -h"
scope = "ssh"
requires_confirmation = false
sort_order = 10
created_at = "1"
updated_at = "1"

[[steps]]
id = "check-service"
title = "Check service"
description = "Show service status"
command = "systemctl status app --no-pager"
scope = "ssh"
requires_confirmation = false
sort_order = 20
created_at = "1"
updated_at = "1"
```

规则：

- 文件名必须是 `<id>.toml`。
- `scope` 和 step `scope` 只能是 `any`、`local`、`ssh`。
- `[[steps]]` 的 `id` 必须在同一 workflow 内唯一。
- `sort_order` 必须按文件顺序递增，避免外部 agent 改完后 UI 顺序和文件顺序不一致。
