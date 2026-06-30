---
id: PLAN-20260623-112143-ssh-jump-host-capability
status: done
created_at: 2026-06-23T11:21:43+08:00
started_at: 2026-06-23T11:31:20+08:00
completed_at: 2026-06-23T13:23:39+08:00
updated_at: 2026-06-23T13:23:39+08:00
owner: ai
---
# SSH 跳板机能力完整落地实施计划

## 直接结论

当前跳板机能力不是“底层完全不支持密码”这么简单。

- 数据模型已经能表达跳板机 `password | key | agent`，也能保存跳板机 `credentialSecret`。
- UI 目前主动禁用了跳板机密码认证，并且从“已添加主机”选择密码登录主机时会把跳板认证静默降级成 `agent`。
- 更关键的是，当前 SSH terminal、SFTP、远程命令、端口转发、服务器信息、Docker/container over SSH、AI/MCP 工具等真实连接路径还没有统一消费 `jumpHosts`。
- 所以即使先把 UI 密码框放开，也只能保存配置，不能保证真实连接通过跳板链工作。

对用户问题“已添加的主机使用密码登录，影响跳板机功能吗”的回答是：会影响。现状下它会在跳板配置侧丢失密码认证语义，且底层连接链路也还没真正接入跳板机。

## 目标

让已保存 SSH 主机的跳板链成为 Kerminal 远程能力的统一路由能力：

- SSH terminal 能按 `jumpHosts` 建立交互终端。
- SFTP 文件浏览、预览、上传、下载、删除、重命名、chmod 和传输队列能通过同一跳板链访问目标主机。
- 远程命令、服务器信息、命令建议、AI `ssh.command` / `server_info.snapshot` / SFTP 工具能继承跳板链。
- 端口转发和网络助手能通过跳板链创建 local、remote、dynamic forwarding。
- Docker/container over SSH 能继承宿主 SSH 主机跳板链。
- 跳板机和目标机均支持 `agent`、私钥文件、内联私钥、密码认证，并支持多跳混合认证。
- 密码和私钥内容不出现在命令行参数、日志、审计摘要、错误消息或调试输出中。

## 非目标

- 不使用真实生产主机作为自动化测试环境。
- 不引入未加密的远程 Docker TCP daemon。
- 不重新设计 SSH 凭据保存策略；本计划沿用当前用户已确认的远程主机明文 `credentialSecret` 行为。
- 不做大范围远程主机 UI 重设计，只补齐跳板链必要交互和状态。
- 不在没有后端真实支持前仅前端放开密码跳板选项。

## 当前事实

### 数据模型已经具备密码跳板表达能力

- `src/lib/remoteHostApi.ts:3`：`RemoteHostAuthType = "password" | "key" | "agent"`。
- `src/lib/remoteHostApi.ts:24`：`SshJumpHostOptions` 已包含 `authType`、`credentialRef`、`credentialSecret`。
- `src-tauri/src/models/remote_host.rs:139`：Rust `SshJumpHostOptions` 也有 `credential_secret`，注释说明为“跳板密码或内联私钥内容”。
- `src-tauri/src/services/remote_host_service.rs:337` 起的 SSH options normalize 路径会保留跳板机 `credential_secret`。

结论：不是 schema 层不支持密码。

### UI 当前主动禁用了密码跳板

- `src/features/machine-sidebar/remote-host-dialog/ssh-jump-panel.tsx:85`：密码跳板文案为“跳板机暂不支持密码认证。”。
- `src/features/machine-sidebar/remote-host-dialog/ssh-jump-panel.tsx:190`：认证方式选项过滤掉 `password`。
- `src/features/machine-sidebar/remote-host-dialog/ssh-jump-panel.tsx:286`：从已有密码主机生成跳板 draft 时会把 `password` 映射成 `agent`。
- `src/features/machine-sidebar/remote-host-dialog/request-builders.ts:405`：构建请求前仍拒绝 password jump host。
- `src/features/machine-sidebar/remote-host-dialog/connection-check.test.ts` 已固化当前拒绝行为。

结论：已添加主机如果是密码登录，当前选作跳板机会受影响，表现为认证方式被降级或验证失败。

### 真实连接路径未统一使用跳板链

- `src-tauri/src/services/ssh_terminal_service.rs` 当前主要构造直接 `ssh -tt user@host`，只处理目标主机认证。
- `src-tauri/src/services/sftp_service/backend.rs` 原生 SFTP backend 直接连接目标 host。
- `src-tauri/src/services/ssh_command_service.rs` 原生 russh 命令执行直接连接目标 host。
- `src-tauri/src/services/port_forward_service.rs` 使用 OpenSSH 创建转发，但未把 `jumpHosts` 注入命令计划。
- `src-tauri/src/services/docker_host_service/script.rs` 通过 `ssh_commands.execute_native` 执行远端脚本，因此也继承不到跳板链。
- `src-tauri/src/services/server_info_service.rs`、命令建议和 AI/MCP 远程工具最终复用上述 SSH/SFTP/command 能力，因此同样没有完整跳板支持。

结论：跳板链目前更多是“可保存配置”，不是已落地的连接能力。

### 单密码自动应答模型不足以覆盖多跳

- `src-tauri/src/models/terminal.rs` 当前 `TerminalSecretInputResponse` 只表达一个 response。
- `src-tauri/src/services/terminal_manager.rs` 的 `TerminalSecretInputResponder` 以单个 secret 的匹配和 max response 为核心。
- `src-tauri/src/services/port_forward_service.rs` 有独立但类似的单 secret PTY responder。
- 目标主机密码、跳板机密码、私钥 passphrase、多跳密码可能同时出现，且 OpenSSH prompt 常常只是泛化的 `password:`。

结论：放开密码跳板前，需要先升级为多 secret plan，否则 password jump + password target 很容易答错或重复泄露。

## 架构方案

### 1. 新增统一 SSH 路由规划模块

建议新增：

```text
src-tauri/src/services/ssh_route_plan.rs
```

核心类型：

```rust
pub struct SshRoutePlan {
    pub target: SshHopPlan,
    pub jumps: Vec<SshHopPlan>,
    pub known_hosts_path: PathBuf,
    pub open_ssh: Option<OpenSshRoutePlan>,
    pub native: Option<NativeSshRoutePlan>,
    pub secret_plan: TerminalSecretInputPlan,
    pub cleanup_paths: Vec<PathBuf>,
}

pub struct SshHopPlan {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuthPlan,
}
```

职责：

- 从 `RemoteHost` + `ssh_options.jump_hosts` 生成统一 route plan。
- 复用现有 `ssh_command_plan.rs` 的认证解析、known_hosts、identity file/temp key 处理能力。
- 对每一跳生成稳定 `hop_id`，用于日志摘要、prompt responder、临时 config host alias、测试断言。
- 统一产生 cleanup paths，终端、端口转发、远程命令和 SFTP 都通过同一清理策略释放临时 key/config。
- route plan 只返回脱敏摘要，不返回密码或内联私钥内容给日志层。

### 2. 分离 OpenSSH plan 和原生 russh plan

OpenSSH 消费者：

- SSH terminal。
- port forwarding。
- 任何仍需要系统 OpenSSH PTY 行为的兼容路径。

原生 russh 消费者：

- SFTP backend。
- `ssh_command_service.execute_native`。
- server info、command suggestion、Docker/container script、AI/MCP 工具经由 native command/SFTP 继承。

两类 plan 可以共享 hop/auth/known_hosts/secret 解析，但执行策略不同。

### 3. OpenSSH 路径使用临时 ssh config，而不是裸拼 `-J`

对 key/agent-only 场景，`-J` 可以工作；但完整实现要支持 password jump、inline key 和多跳混合认证，建议统一生成临时 ssh config：

```sshconfig
Host kerminal-hop-0
  HostName bastion.example
  Port 22
  User jump
  PreferredAuthentications password
  UserKnownHostsFile ...

Host kerminal-target
  HostName target.example
  Port 22
  User app
  ProxyCommand ssh -F <temp-config> -W %h:%p kerminal-hop-0
```

多跳时后一跳 alias 的 `ProxyCommand` 指向前一跳 alias。

要求：

- 密码不进入 config，也不进入命令行。
- 私钥文件只写路径；内联私钥写入临时权限文件，路径进入 config，内容不写日志。
- 每个 alias 设置 `HostName`、`Port`、`User`、`IdentityFile`、`IdentitiesOnly`、`PreferredAuthentications`、`UserKnownHostsFile`。
- 继续沿用当前严格 known_hosts 策略，不因跳板链绕过 host key 检查。
- config 和临时 key 在 session 结束后清理，启动时清理陈旧临时文件。

### 4. 原生 russh 路径实现跳板链连接适配器

目标是让 SFTP 和 native command 不退回到 shell 拼命令。

候选实现：

1. 首选：使用 russh 的 `direct-tcpip` channel，从上一跳打开到下一跳的 TCP 通道，再在该 stream 上发起下一段 SSH handshake。
2. 若当前库抽象难以把 channel 作为下一层 `AsyncRead + AsyncWrite` stream，先实现本地 loopback TCP bridge：本机开临时 `127.0.0.1:port`，接入后通过跳板 `direct-tcpip` 转发到下一跳，再让现有 native client 连接本地临时端口。

要求：

- 先做 Spike，确认 russh API 能否直接链式握手。
- bridge 模式必须只监听 loopback，并绑定生命周期清理。
- 每一跳都执行 host key 校验。
- 每一跳认证都使用 `SshAuthPlan`，支持 password/key/agent。
- 错误要指明失败 hop，但不输出 secret。

### 5. 多 secret prompt responder

把当前单 response 模型升级为多 entry plan：

```rust
pub struct TerminalSecretInputPlan {
    pub entries: Vec<TerminalSecretInputEntry>,
}

pub struct TerminalSecretInputEntry {
    pub id: String,
    pub label: String,
    pub prompt_markers: Vec<String>,
    pub response: String,
    pub max_responses: usize,
    pub redact_values: Vec<String>,
}
```

兼容策略：

- 旧 `TerminalSecretInputResponse` 自动转换为单 entry plan。
- `TerminalSecretInputResponder` 扫描所有 entries，按状态和 marker 匹配应答。
- 每个 entry 独立计数，超过 `max_responses` 不再回答。
- 所有 `response` 和 `redact_values` 加入终端日志、审计、错误摘要脱敏集合。
- `password:` 这种泛化 marker 只能作为最后 fallback，且必须受 per-entry state 限制。

跳板链场景：

- password jump + key target。
- key jump + password target。
- password jump + password target。
- two jumps mixed auth + password target。
- private key passphrase + password target。

### 6. UI 启用密码跳板

后端 route plan 和 multi-secret responder 合入后，再做 UI enablement：

- `ssh-jump-panel.tsx` 移除 `password` 过滤。
- password jump draft 显示密码输入框，并沿用当前主机密码明文保存口径。
- 从已有主机选择跳板时，保留 `authType: "password"` 和 `credentialSecret`，不再降级为 `agent`。
- 如果已有主机对象未携带 `credentialSecret`，明确提示“该主机没有可复用的已保存密码”，不要静默改认证方式。
- `request-builders.ts` 改为 password jump 必须有 `credentialSecret`。
- key jump 继续校验私钥路径或内联私钥内容。
- 添加“跳板链测试连接”入口，至少验证 route plan 构造和真实连接 smoke。
- 远程主机编辑弹窗的浅色、深色、跟随系统主题均需截图或真实界面 smoke。

## 实施切片

| 顺序 | 标题 | 类型 | 依赖 | 范围 | 验收 |
| --- | --- | --- | --- | --- | --- |
| 1 | SSH route plan 纯模型 | AFK | None | 新增 `ssh_route_plan.rs`，从 RemoteHost 生成 hop/auth/known_hosts/cleanup/secret 脱敏摘要 | Rust unit tests 覆盖 password/key/agent、多跳、inline key、无 secret 失败 |
| 2 | 多 secret responder | AFK | 1 | 统一终端和端口转发 PTY secret responder 模型 | split prompt、多 secret、max response、fallback marker、redaction 测试通过 |
| 3 | OpenSSH terminal 跳板链 | AFK | 1,2 | SSH terminal 使用临时 ssh config/ProxyCommand 连接目标 | loopback key/agent/password jump + password target smoke 通过 |
| 4 | OpenSSH port forwarding 跳板链 | AFK | 1,2 | local/remote/dynamic forwarding 使用同 route plan | 端口转发 through jump integration 通过，临时文件清理可断言 |
| 5 | native russh chain spike | AFK | 1 | 验证 direct-tcpip stream 或 loopback bridge 可行性 | 形成 ADR 或 Round Log，给出选型和失败回退 |
| 6 | native command through jump | AFK | 5 | `ssh_command_service.execute_native` 支持跳板链 | 远程命令 loopback 多跳测试通过，Docker/server info/command suggestion 可继承 |
| 7 | native SFTP through jump | AFK | 5 | SFTP backend 支持跳板链 | list/preview/upload/download/delete/rename/chmod contract through jump 通过 |
| 8 | Docker/container 和 AI/MCP 继承验证 | AFK | 6,7 | Docker script、server info、command suggestion、AI/MCP remote tools 走统一能力 | 工具链不重复实现跳板，只复用 command/SFTP route |
| 9 | UI 启用 password jump | HITL | 3,4,6,7 | 放开 UI password，保留已有密码主机认证，补校验和文案 | 前端测试、三主题真实截图、真实 app smoke 通过 |
| 10 | 端到端验收与文档收口 | HITL | 1-9 | 验证矩阵、用户说明、故障排查 | 所有 P0 矩阵通过，风险和剩余限制写入计划 Round Log |

## 验证矩阵

### Rust unit tests

- route plan 不把密码、私钥内容写入 command args、debug summary 或 temp config dump。
- password/key/agent target auth 仍保持现有行为。
- password/key/agent jump auth 均能生成 route plan。
- jump host 缺少 password 或 key material 时返回明确错误。
- two jumps mixed auth 顺序稳定。
- 临时 inline key/config 路径登记到 cleanup paths。
- known_hosts 对每一跳和目标机都生成校验要求。
- multi-secret responder 支持 split prompt、多 prompt、不重复回答、脱敏所有 secret。

### Integration tests

优先建设本地 loopback harness，不依赖生产主机：

- jump agent/key -> target password。
- jump password -> target agent/key。
- jump password -> target password。
- two jumps mixed auth -> target password。
- SSH terminal through jump。
- SFTP list/preview/upload/download/delete/rename through jump。
- `ssh_command.execute_native` through jump。
- server info snapshot through jump。
- command suggestion refresh through jump。
- port forward local/remote/dynamic through jump。
- Docker/container script through jump。

### Frontend tests

- 跳板面板可以选择 `password`。
- password jump 显示密码输入，保存时写入 `credentialSecret`。
- 从已添加的密码主机选择跳板时保留 `password`，不降级为 `agent`。
- 缺少密码时给明确 validation message。
- key/agent 原有路径不回归。
- connection check 测试从“拒绝 password jump”改为“允许且校验 secret”。

### 启动与界面门禁

代码实现阶段每个涉及前端/Rust/Tauri 的切片都必须满足：

- `npm run build`
- 相关 `cargo test --manifest-path src-tauri/Cargo.toml ...`
- `cargo check` 或 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- dev server 真实启动 smoke
- 涉及 Tauri/Rust/窗口/权限路径时运行 `npm run tauri:dev`，无法运行时记录具体阻塞原因
- UI 变更截图验证浅色、深色、跟随系统主题

## 风险与处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| russh direct-tcpip 无法直接作为下一层 SSH stream | SFTP/native command through jump 受阻 | 先做 Spike；必要时采用 loopback bridge，且只监听 `127.0.0.1` |
| OpenSSH password prompt 文案不稳定 | 多密码场景可能答错 | 多 entry responder 加 hop 状态、max response 和保守 fallback；测试 split prompt |
| `-J` 无法表达每跳 password/inline key | 密码跳板和多跳混合认证不可靠 | 使用临时 ssh config + ProxyCommand alias |
| 临时私钥/config 泄漏 | 凭据落盘风险 | 限制文件权限、生命周期清理、启动清理陈旧文件、日志不打印内容 |
| known_hosts 只校验目标机 | 跳板链信任边界不完整 | 每一跳和目标机都走同一 known_hosts 策略 |
| UI 先放开但后端不支持 | 用户误以为能力可用 | UI password enablement 放在后端 OpenSSH/native 通过后 |
| Docker/AI 工具各自补跳板 | 形成多套不一致实现 | 所有远程能力只依赖统一 route/native adapter，不在上层拼 SSH |

## 进入 active 前置条件

- 登记新的 coordination lane，列出共享热点文件：`ssh_terminal_service.rs`、`ssh_command_service.rs`、`sftp_service/backend.rs`、`port_forward_service.rs`、`terminal_manager.rs`、`remote_host_service.rs`、`ssh-jump-panel.tsx`、`request-builders.ts`。
- 先执行切片 1 和 2，避免 UI 与执行路径并行打开造成半成品。
- 明确 loopback multi-hop harness 方案，不能依赖人工生产主机验证基础行为。
- 当前工作区已有大量未归因改动，进入实现前必须先确认 lane 和本轮 owned/shared paths。

## 最终验收标准

- 已保存主机配置了一个或多个跳板机后，SSH terminal、SFTP、远程命令、服务器信息、端口转发、Docker/container、AI/MCP 远程工具均能通过同一跳板链工作。
- 跳板机和目标机可以任意组合 `password`、`key`、`agent`。
- 从“已添加主机”选择密码登录主机作为跳板时，认证方式和密码 secret 不丢失。
- 多跳 password prompt 不误答、不重复答，终端日志和审计中看不到密码或私钥内容。
- 临时 config/key/bridge 均有确定 cleanup。
- 每一跳和目标机都有 host key 校验。
- 浅色、深色、跟随系统主题下跳板机配置 UI 可读可用。

## Round Log

### 2026-06-23T11:31:20+08:00 - 启动实现 lane

- 状态：从 `next` 提升为 `active`，开始按用户要求采用 subagent 并行落地。
- 当前工作区：主 worktree 已有大量未归因改动，不迁移独立 worktree；本 lane 在 `.updeng/docs/coordination/lanes.json` 明确共享热点文件和同步协议。
- 本轮优先顺序：先执行切片 1 `SSH route plan 纯模型` 和切片 2 `多 secret responder`，再接 OpenSSH terminal/port forwarding、native russh、SFTP 和 UI。
- 验证口径：每个实现切片至少运行相关 Rust/前端定向测试；涉及 UI 后补 `npm run build`、dev server smoke、三主题截图；涉及 Tauri/Rust 启动路径后补 `npm run tauri:dev` 或记录阻塞。

### 2026-06-23T11:33:38+08:00 - subagent 并行分工

- `019ef28b-6ba9-7822-b528-3fccaa2701fe`：Rust route-plan worker，owned `ssh_route_plan.rs`、`services/mod.rs` 和 route plan 测试，目标是切片 1 纯模型。
- `019ef28b-adc4-7a30-ac90-2dc012bcf8a1`：Rust terminal-secret worker，owned `terminal.rs`、`terminal_manager.rs` 和 terminal secret 测试，目标是切片 2 多 secret responder。
- `019ef28b-e7ff-7a30-bd92-d810435a0d6c`：OpenSSH integration explorer，只读调研 `ssh_terminal_service.rs`、`port_forward_service.rs` 和 `ssh_command_plan.rs` 接入点。
- `019ef28c-287b-78f2-83f5-40f0fe574f14`：native russh/SFTP explorer，只读调研 `ssh_command_service.rs`、`sftp_service/backend.rs` 和 direct-tcpip/loopback bridge 可行性。
- Leader 当前复核基线：CodeGraph 显示 `ssh_command_plan.rs` 已有 `resolve_ssh_auth_plan` 和 `SshAuthPlan`，但仍使用单 `TerminalSecretInputResponse`；后续合流点是把 route plan 与 multi-secret plan 对齐，避免上层各自拼 SSH。

### 2026-06-23T11:40:00+08:00 - explorer 结论

- OpenSSH explorer 结论：`ssh_terminal_service.rs` 入口是 `resolve_terminal_request -> build_ssh_terminal_request`，当前只拼直接 `ssh -tt ... user@host`；`port_forward_service.rs` 入口是 `build_forward_plan -> spawn_forward_process`，当前也只拼目标主机 direct OpenSSH。两者都应接入统一 `ssh_route_plan.rs`，由 route plan 产出 `ssh -F <temp-config> <target-alias>`、cleanup paths 和 multi-secret plan。
- OpenSSH 风险：route plan 新类型不能 Debug 泄露 secret；临时 config 必须进入 cleanup paths 和启动 stale cleanup；每个 hop/target 都要设置 app `known_hosts` 策略，并确认 `Host alias + HostName real` 下的 host key alias 行为；Windows OpenSSH 的 `-F`、`ProxyCommand`、`-W` 和带空格路径需要实测。
- native russh/SFTP explorer 结论：`ssh_command_service.rs` 和 `sftp_service/backend.rs` 当前均直连目标；`russh 0.61.2` 本地源码提供 `client::Handle::channel_open_direct_tcpip(...)` 和 `client::connect_stream(...)`，优先做 direct-tcpip 链式握手 spike，不先退到本地 loopback bridge。
- native 继承点：`ServerInfoService::snapshot_native`、Docker/container script、AI `ssh.command` 和 command suggestion 已走 `execute_native`，AI SFTP 工具经 `SftpService` 继承；后续不应在这些上层各自实现跳板。
- 推荐后续 spike：先在 `ssh_command_service/tests.rs` 增加 `native_command_executes_through_loopback_jump_host`，再在 `sftp_service/tests/native_backend.rs` 增加 through-jump list/preview 测试。

### 2026-06-23T11:47:00+08:00 - 切片 1/2 leader 复核

- 切片 1：`019ef28b-6ba9-7822-b528-3fccaa2701fe` 已新增 `src-tauri/src/services/ssh_route_plan.rs`、`src-tauri/tests/ssh_route_plan.rs`，并在 `src-tauri/src/services/mod.rs` 注册模块。覆盖 password/key/agent jump、target auth、two jumps mixed auth、缺 secret/key 明确错误、Debug/summary 不泄露 password/inline private key。
- 切片 2：`019ef28b-adc4-7a30-ac90-2dc012bcf8a1` 已新增 `TerminalSecretInputPlan` / `TerminalSecretInputEntry`，`TerminalManager::create_session_with_secret_input_plan` 支持多 entry；旧 `TerminalSecretInputResponse` 仍可经 `TerminalCreateRequest.secret_input_response` 兼容为单 entry。
- Leader 复核发现点：`ssh_route_plan` 目前对 password target 缺 `credentialSecret` 会失败，后续接入 terminal direct path 时需确认是否保留旧“人工手输密码”能力，或按明文凭据计划要求改为必须保存密码。
- 验证通过：
  - `rustfmt --edition 2021 src-tauri/src/services/ssh_route_plan.rs src-tauri/tests/ssh_route_plan.rs src-tauri/src/models/terminal.rs src-tauri/src/services/terminal_manager.rs src-tauri/tests/terminal_manager.rs src-tauri/tests/terminal_model.rs`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ssh_route_plan`：5 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --test terminal_model`：5 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --test terminal_manager`：16 passed
  - `cargo check --manifest-path src-tauri/Cargo.toml`
  - `git diff --check -- <本轮切片文件>`：exit 0，仅提示 Windows 换行将被 Git 转换。

### 2026-06-23T11:50:00+08:00 - 第二批 subagent 分工

- `019ef29a-beaa-7bd0-8e6d-6dd38adf361f`：OpenSSH terminal worker，owned `ssh_route_plan.rs`、`ssh_terminal_service.rs` 和相关测试；目标是通过临时 ssh config / alias 让 SSH terminal 消费跳板链和多 secret plan。
- `019ef29b-1f77-7451-a3a8-827fab53d3a5`：native russh spike worker，owned `ssh_command_service.rs` 和相关测试；目标是验证 `channel_open_direct_tcpip + connect_stream`，并尽量推进 native command through jump。
- 本批暂不启动 port forwarding worker，避免与 OpenSSH terminal worker 同时改 `ssh_route_plan.rs`；等 terminal route adapter 稳定后再接 `port_forward_service.rs`。

### 2026-06-23T12:02:00+08:00 - 第二批 leader 复核

- OpenSSH terminal 切片：`019ef29a-beaa-7bd0-8e6d-6dd38adf361f` 已让带 `jump_hosts` 的 SSH terminal 走临时 ssh config / alias，生成 `-F <temp-config> kerminal-target`，不使用裸 `-J`；`SshTerminalService::create_session` 会在 jump route 下调用 `TerminalManager::create_session_with_secret_input_plan` 传入多 secret plan，direct 无 jump 路径保持原行为。
- native russh spike/command 切片：`019ef29b-1f77-7451-a3a8-827fab53d3a5` 已验证 `russh 0.61.2` 的 `channel_open_direct_tcpip + Channel::into_stream() + client::connect_stream()` 可行，并让 `execute_native` 支持 `jump_hosts` 单跳/多跳连接；新增 loopback jump command 测试覆盖 password jump + password target。
- 验证通过：
  - `rustfmt --edition 2021 <本轮 Rust 文件>`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ssh_route_plan -j 1`：7 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_service -j 1`：9 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib -j 1 services::ssh_terminal_service::tests::build_jump_terminal_launch_uses_multi_secret_plan_without_leaking_args`：1 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib -j 1 services::ssh_command_service::tests`：14 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --test ssh_command_service -j 1`：3 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --test terminal_model -j 1`：5 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --test terminal_manager -j 1`：16 passed
  - `cargo check --manifest-path src-tauri/Cargo.toml -j 1`
  - `git diff --check -- <本轮 Rust 文件>`：exit 0，仅提示 Windows 换行将被 Git 转换。
- 剩余风险：OpenSSH config 中 `ProxyCommand ssh -F <config> ...` 的 Windows path/quoting 仍需真实 OpenSSH smoke；native command 自动化目前只覆盖单跳 password/password，多跳混合认证和 SFTP 继承仍待后续矩阵。

### 2026-06-23T12:19:36+08:00 - 切片 4 OpenSSH port forwarding 跳板链

- 本轮 worker 完成 `port_forward_service.rs` 的 OpenSSH 跳板链接入：`build_forward_plan` 在 `jump_hosts` 非空时复用 `build_ssh_route_plan` / `materialize_openssh_route_plan`，命令保留 `-N` / `-T` / `-a`、`ExitOnForwardFailure`、`ServerAlive*` 和原有 `-L` / `-R` / `-D` forward arg 语义，并以 `-F <temp-config> kerminal-target` 作为目标路由。
- `ForwardCommandPlan` 已从单 `TerminalSecretInputResponse` 升级为 `TerminalSecretInputPlan`，端口转发 PTY secret responder 支持多 entry；direct password 路径通过旧 response 转换为单 entry 保持兼容。
- 新增 `src-tauri/src/services/port_forward_service_tests.rs` 跳板链覆盖：local through jump 使用 `-F` 且 endpoint/forward arg 不变，remote/dynamic through jump 保留 `-R`/`-D`，password jump + password target 生成两个 secret entries，args/preview/temp config/Debug 不泄露 password 或内联私钥内容。
- 验证中发现已有 `sftp_service/backend.rs` 编译阻断：`NativeSftpHopExecution` 构造时 move `label` 后又用于错误上下文；本轮仅做 `label.clone()` 的最小兼容修复以恢复验证。
- 验证通过：
  - `rustfmt --edition 2021 src-tauri/src/services/port_forward_service.rs src-tauri/src/services/port_forward_service_tests.rs src-tauri/src/services/sftp_service/backend.rs`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test port_forward_service -j 1`：2 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib -j 1 services::port_forward_service::port_forward_service_tests`：20 passed
  - `cargo check --manifest-path src-tauri/Cargo.toml -j 1`
  - `git diff --check -- src-tauri/src/services/port_forward_service.rs src-tauri/src/services/port_forward_service_tests.rs src-tauri/src/services/sftp_service/backend.rs src-tauri/tests/port_forward_service.rs`：exit 0，仅提示 Windows 换行将被 Git 转换。
- 剩余风险：本切片未做真实 OpenSSH through-jump smoke；Windows OpenSSH 对临时 config 路径和 ProxyCommand 引用仍沿用 terminal 切片记录的后续真实环境验收风险。

### 2026-06-23T12:32:14+08:00 - 切片 7 native SFTP through jump

- 本轮完成 SFTP native backend 跳板链接入：`connect_native_sftp` 统一走 `connect_native_ssh_chain`；list/preview/read/write/stat/delete/rename/chmod/transfer/remote_copy 继续共用该入口并继承跳板链。
- `remove_remote_directory_with_shell` 改为同一 native SSH chain 打开 session 执行 `sh -s`，不再绕过 `jump_hosts` 直连目标；执行后按 target -> jumps 逆序断开。
- 新增 `src-tauri/src/services/sftp_service/native_ssh.rs`，承载 per-hop known_hosts 校验、password/key/agent 认证、`channel_open_direct_tcpip` 和 `client::connect_stream` 链式握手；保留端口转发 worker 对 `label.clone()` 的最小编译修复。
- 新增 loopback SFTP jump harness 和回归测试，覆盖 password jump + password target 的 `list_directory`、`preview_file` 和 shell directory delete，并断言 direct-tcpip 至少发生 3 次。
- 验证通过：
  - `rustfmt --edition 2021 src-tauri/src/services/sftp_service.rs src-tauri/src/services/sftp_service/backend.rs src-tauri/src/services/sftp_service/native_ssh.rs src-tauri/src/services/sftp_service/tests/loopback.rs src-tauri/src/services/sftp_service/tests/mod.rs src-tauri/src/services/sftp_service/tests/native_jump_backend.rs`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib -j 1 services::sftp_service::tests::native_jump_backend::native_sftp_backend_uses_password_jump_for_list_preview_and_shell_delete`：1 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib -j 1 services::sftp_service::tests::native`：10 passed
  - `cargo test --manifest-path src-tauri/Cargo.toml --test sftp_service -j 1`：6 passed
  - `cargo check --manifest-path src-tauri/Cargo.toml -j 1`
  - `git diff --check -- <本轮 SFTP 文件>`：exit 0，仅提示 Windows 换行将被 Git 转换。

### 2026-06-23T12:50:00+08:00 - 切片 8/9 继承验证与 UI 启用 password jump

- 继承路径复核：server info、command suggestion、Docker/container script、AI `ssh.command`/SFTP/diagnostics/container/registry 远程工具均继续复用 `execute_native`、`SftpService` 或 port forward service，不在上层重复拼跳板链。
- 前端启用 password jump：`request-builders.ts` 改为 password jump 必须携带 `credentialSecret`；key jump 允许 `credentialRef` 或 `credentialSecret`；`ssh-jump-panel.tsx` 不再过滤 `password`，从“已添加主机”选择密码主机时保留 `authType: "password"` 和 `credentialSecret`，并展示跳板机密码输入。
- 真实 UI 验证复用 dev server `http://127.0.0.1:1437/`：添加连接 -> SSH -> 跳板机，确认 `跳板机认证方式` 下拉包含 `密码`；选择密码后出现 `跳板机密码` password input；添加 password jump 后摘要展示 `· password`，没有降级为 agent。
- 三主题截图已保存：
  - `.updeng/docs/verification/ssh-jump-host-capability/jump-password-light.png`
  - `.updeng/docs/verification/ssh-jump-host-capability/jump-password-dark.png`
  - `.updeng/docs/verification/ssh-jump-host-capability/jump-password-system-light-resolved.png`
  - `.updeng/docs/verification/ssh-jump-host-capability/jump-password-system-dark-resolved.png`
- 验证通过：
  - `npm run test:frontend -- src/features/machine-sidebar/remote-host-dialog/connection-check.test.ts src/features/machine-sidebar/remote-host-dialog/ssh-jump-panel.test.ts src/features/machine-sidebar/RemoteHostCreateDialog.test.tsx`：3 files, 27 tests passed
  - `npm run typecheck`：passed
  - `npm run build`：passed，仅保留既有 Vite chunk size warnings
  - `Invoke-WebRequest http://127.0.0.1:1437/`：HTTP 200

### 2026-06-23T13:10:00+08:00 - 最终 Rust/Tauri 验证与 OpenSSH through-jump smoke

- 新增真实 OpenSSH through-jump 终端 smoke：`src-tauri/tests/ssh_terminal_password_smoke.rs` 新增 `local_russh_loopback_password_jump_terminal_auto_login_smoke`，本地 russh 目标机和密码跳板机配合 Windows OpenSSH `ProxyCommand` / `direct-tcpip` 验证 password jump + password target 终端自动登录，断言目标密码和跳板密码均不出现在终端输出中。
- `npm run tauri:dev` 直接运行被现有 Vite 端口 `1425` 占用阻断；随后使用临时 Cargo target 并跳过 beforeDevCommand 运行 `npx tauri dev --config '{"build":{"beforeDevCommand":""}}' --no-watch`，Tauri debug app 编译并启动 10 秒无错误后停止。默认 `src-tauri/target/debug/kerminal.exe` 仍被既有进程占用，未擅自结束该进程。
- Rust 验证通过：
  - `cargo test --test ssh_terminal_password_smoke -j 1 -- --nocapture`：3 passed, 1 ignored
  - `cargo test --test ssh_route_plan -j 1`：7 passed
  - `cargo test --test terminal_model -j 1`：5 passed
  - `cargo test --test terminal_manager -j 1`：16 passed
  - `cargo test --test ssh_terminal_service -j 1`：9 passed
  - `cargo test --lib services::ssh_terminal_service::tests::build_jump_terminal_launch_uses_multi_secret_plan_without_leaking_args`：1 passed
  - `cargo test --lib services::ssh_command_service::tests`：14 passed
  - `cargo test --test ssh_command_service -j 1`：3 passed
  - `cargo test --lib services::port_forward_service::port_forward_service_tests`：20 passed
  - `cargo test --test port_forward_service -j 1`：2 passed
  - `cargo test --lib services::sftp_service::tests::native_jump_backend::native_sftp_backend_uses_password_jump_for_list_preview_and_shell_delete`：1 passed
  - `cargo test --lib services::sftp_service::tests::native`：10 passed
  - `cargo test --test sftp_service -j 1`：6 passed
  - `cargo test --test server_info_service -j 1`：7 passed
  - `cargo test --lib services::docker_host_service::tests -j 1`：10 passed
  - `cargo test --test command_suggestion_ssh_smoke -j 1 loopback_provider_chain`：1 passed
  - `cargo test --test tool_registry_service -j 1`：21 passed
  - `cargo test --test ai_tool_invocation_service -j 1 diagnostics_client`：15 passed
  - `cargo test --test ai_tool_invocation_service -j 1 sftp_read_protocol`：8 passed
  - `cargo test --test ai_tool_invocation_service -j 1 ssh_facade`：5 passed
  - `cargo test --test ai_tool_invocation_service -j 1 container_read_protocol`：3 passed
  - `cargo test --test ai_tool_invocation_service -j 1 registry_contract`：3 passed
  - `cargo check --manifest-path src-tauri/Cargo.toml -j 1`：passed
- 已知非本任务失败：完整 `cargo test --test ai_tool_invocation_service -j 1` 有 2 个 settings terminal audit 断言失败，`expected 13, actual 15`，失败用例为 `confirm_terminal_appearance_update_invalid_value_records_failed_audit` 和 `confirm_terminal_appearance_update_rejection_does_not_change_settings`；与跳板机链路无关，相关 AI/SSH/SFTP/container/registry 过滤测试均通过。

### 2026-06-23T13:23:39+08:00 - 完成审计

- 最终结果：计划完成。已保存 SSH 主机的 `jumpHosts` 现在是统一路由能力，SSH terminal、OpenSSH port forwarding、native command、SFTP、server info、Docker/container、command suggestion 和 AI/MCP 远程工具通过统一 route/native adapter 继承跳板链。
- 对用户问题的稳定结论更新为：已添加的主机如果使用密码登录，现在可以直接作为跳板机使用；跳板配置会保留 `password` 和已保存密码 secret，不再静默降级为 `agent`。目标机密码和跳板机密码是两套凭据，都会进入多 secret plan，终端输出、命令行参数、日志摘要和测试断言中不泄露 secret。
- 验收覆盖：route plan 覆盖 password/key/agent 和多跳混合认证建模；OpenSSH loopback smoke 覆盖 password jump + password target 真实终端；native command/SFTP 覆盖 `channel_open_direct_tcpip + connect_stream`；port forward 覆盖 local/remote/dynamic args 和多 secret；UI 覆盖浅色、深色、跟随系统主题。
- 残余限制：未用真实生产跳板机执行外部网络矩阵，这是本计划非目标；key/agent 多跳的真实外部环境 smoke 仍可作为后续人工验收补充，但当前模型、单元测试和 loopback integration 已覆盖核心行为与回归边界。
