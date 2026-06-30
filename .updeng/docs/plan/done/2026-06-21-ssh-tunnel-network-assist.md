---
id: PLAN-20260621-125115-ssh-tunnel-network-assist
status: done
created_at: 2026-06-21T12:51:15+08:00
started_at: 2026-06-21T13:18:13+08:00
completed_at: 2026-06-21T15:08:00+08:00
updated_at: 2026-06-21T15:08:00+08:00
owner: ai
---

# SSH 隧道右栏与主机网络助手实施计划

## 目标

- 把右边栏 SSH 隧道能力从“参数表单”升级为按主机隔离的可视化隧道工作台：左侧固定表达“主机”，右侧固定表达“本机”，中间用方向箭头和模式文案表达网络流向。
- 保留并讲清楚三类基础 SSH 转发：
  - 本机访问主机服务：OpenSSH `-L`，流向为本机 -> 主机。
  - 主机访问本机服务：OpenSSH `-R`，流向为主机 -> 本机。
  - 本机 SOCKS 出口主机：OpenSSH `-D`，本机应用通过主机网络访问目标。
- 新增“主机使用本机网络”一键能力：在当前 Kerminal 主机上下文中启动/停止受管代理与 SSH 反向隧道，让远端命令可以通过主机侧用户可配置监听地址使用当前本机网络出口。
- 让用户不用手动在服务器上输入代理命令即可完成常见操作：支持把代理环境注入当前 Kerminal SSH 终端、后续新终端自动套用、AI/工作流命令带代理运行，并提供用户级/工具级配置助手。
- 普通非 root SSH 用户必须可用；例如使用 `ubuntu` 登录时，不依赖 root、iptables、systemd system scope 或远端安装守护进程，也能开启会话级和用户级代理能力。
- 设计语言采用 Apple-inspired workbench：低噪、清晰、柔和、紧凑，支持浅色、深色和跟随系统主题。

## 非目标

- 不把“系统代理”当作默认实现前提。Linux 服务器没有一个对所有 CLI、服务和后台进程都可靠生效的统一系统代理；生产级实现必须提供会话级、用户级、工具级和服务级多层入口。
- 不做透明全局代理或系统路由接管作为默认能力。透明代理/VPN/TUN/TAP/iptables/pf/route 属于高权限高级能力，必须单独设计、显式授权和回滚。
- 不默认开放远端监听到公网。默认绑定 loopback，但用户必须可以选择 `127.0.0.1`、`0.0.0.0` 或指定局域网 IP；选择非 loopback 时需要安全提示、生产二次确认，并检测远端 `GatewayPorts` 支持。
- 不把本机私钥、密码或系统代理凭据复制到远端。
- 不默认使用 SSH agent forwarding、TUN/TAP VPN、远端 root 权限或远端安装守护进程；这些只能作为显式高级方案。
- 不照抄 VS Code Ports 表格，只吸收它的信息结构：端口、地址、来源、进程和状态要可扫读。

## 已校准的生产级决策

- 主链路确认：Kerminal 本机启动受管代理服务，本机代理端口通过 SSH `-R` 映射到远端主机，远端进程使用这个远端代理地址访问外网或本机网络。
- 多主机共享确认：本机侧应是一个按需启动的 `LocalNetworkProxyService` 单例，不按主机启动多个代理服务。每台主机各自建立 SSH `-R` 反向隧道，把自己的远端代理端口映射回这个共享本地代理服务。
- 生产级隔离方式：共享的是代理核心服务和出网能力；每个主机隧道仍然有独立 session id、远端监听地址、远端端口、策略、统计和停止动作。为了准确归因，单例服务内部可以创建多个“逻辑入口”或本地 listener/tagged endpoint，但不能启动多个独立代理进程。
- “设置主机系统代理”不能作为唯一实现。生产级能力需要分层：
  - 会话级：给当前 Kerminal SSH 终端注入 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY`，不需要 root。
  - 新终端级：同一主机后续新开的 Kerminal 终端自动注入，不修改远端用户 profile，用户可关闭。
  - 用户级：可选写入用户家目录配置，例如 shell rc、git/npm/pip/curl 配置；只作用于该用户，需要预览 diff 和回滚。
  - 服务级：对 user service 或 systemd service 生成 drop-in/env 文件；system service 可能需要 root，不作为默认路径。
  - 系统透明级：iptables/TUN/TAP/路由级透明代理；需要 root 或内核能力，作为独立高级方案。
- 普通用户登录必须可用。`ubuntu` 账号场景至少覆盖：开启网络助手、注入当前终端、后续新终端自动使用、复制命令和用户级配置助手。
- 绑定地址必须可配置。远端监听地址、本机受管代理监听地址、手动本机目标地址都不能硬编码为 `127.0.0.1`；UI 提供 loopback、局域网、全部接口和自定义地址。
- 生产级实现不拆成临时简化版。可以分阶段落地，但最终验收范围必须包含认证链路、权限边界、地址绑定、安全提示、可观测性、回滚、测试和真实启动验证。

## 调研结论

### VS Code Ports 视图

VS Code 的 Ports 视图核心价值是把端口转发变成一组可管理对象：用户输入端口后，视图展示被转发端口和 Forwarded Address，并在地址上提供复制、浏览器打开和预览动作。参考来源：[VS Code Port Forwarding](https://code.visualstudio.com/docs/debugtest/port-forwarding)。

对 Kerminal 的启发：

- 列表不要只显示“15432 -> 127.0.0.1:5432”，还要显示端点归属、来源和动作。
- 每条会话应该有可复制地址、打开/注入/停止等 inline actions。
- “来源”在 Kerminal 中应区分用户手动创建、网络助手创建、AI 工具创建、主机配置预设。

### OpenSSH 语义

OpenSSH `ssh(1)` 当前支持：

- `-R [bind_address:]port:host:hostport`：远端监听，转发到本地侧显式目标。
- `-R [bind_address:]port`：远端监听；未指定显式目标时，`ssh` 会作为 SOCKS 4/5 proxy，按远端 SOCKS client 请求的目标转发。
- 默认远端监听绑定 loopback；绑定 `0.0.0.0` 或指定局域网 IP 通常需要远端 sshd `GatewayPorts clientspecified` 或 `yes` 支持。

参考来源：[OpenBSD current ssh(1)](https://man.openbsd.org/ssh)。

对 Kerminal 的启发：

- “主机使用本机网络”有两条可实现路径：
  - 远端动态 SOCKS：`ssh -R <remote_bind>:<remote_port>`，远端使用 `ALL_PROXY=socks5h://<remote_bind_or_host>:<remote_port>`。
  - 远端 HTTP 代理：Kerminal 本机启动受管 HTTP CONNECT proxy，然后 `ssh -R <remote_bind>:<remote_port>:<local_proxy_bind>:<local_proxy_port>`，远端使用 `HTTP_PROXY/HTTPS_PROXY=http://<remote_bind_or_host>:<remote_port>`。
- 生产级默认推荐 HTTP 代理作为网络助手主模式，因为 `curl`、`git`、`npm`、`pip`、`apt` 等常见工具对 `http_proxy/https_proxy` 支持更直接；SOCKS 必须作为同等级高级模式实现和验证。

### Dev Tunnels / 公网隧道产品

Microsoft Dev Tunnels 把本机服务共享抽象成“host + port + access control”，默认私有，可显式允许匿名访问；CLI 也把启动和停止绑定到进程生命周期。参考来源：[Microsoft Dev Tunnels CLI](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands)。

对 Kerminal 的启发：

- 会话必须有明确生命周期：运行中、失败、已停止。
- 高风险可见性必须默认保守：loopback-first，外部访问需要显式选择。
- “主机网络助手”应是按主机受管会话，而不是全局开关。

### 动态 SOCKS 使用经验

SSH dynamic forwarding 常用于让支持 SOCKS 的应用经 SSH 通道访问任意目标；但是客户端仍需配置代理或用 `proxychains/tsocks` 这类包装工具。参考来源：[Red Hat SSH dynamic port forwarding](https://www.redhat.com/en/blog/ssh-dynamic-port-forwarding)。

对 Kerminal 的启发：

- 隧道本身不是透明 VPN。UI 文案必须避免暗示“服务器全局联网”。
- 一键能力应包含“创建代理端口 + 帮当前终端/命令使用代理”，否则只开端口还不完整。

## 当前 Kerminal 现状

- `src/features/tool-panel/PortForwardToolContent.tsx` 现在是单面板表单：三段按钮选择 local/remote/dynamic，字段按监听地址、监听端口、目标主机、目标端口排列；会话列表只显示一行字符串和停止按钮。
- `src/lib/portForwardApi.ts` 的模型只有 `kind: "local" | "remote" | "dynamic"`、`bindHost`、`sourcePort`、`targetHost`、`targetPort`，没有目的/来源/端点归属/网络助手语义。
- `src-tauri/src/services/port_forward_service.rs` 直接拼 OpenSSH 参数并启动系统 `ssh` 子进程，支持 `-L`、`-R`、`-D`。
- 当前端口转发后端没有复用 `SshTerminalService` 的临时私钥、known_hosts 和密码输入处理；还设置了 `BatchMode=yes`，因此只配置在 Kerminal 凭据里的密码主机或私钥主机，隧道可能不可靠。
- `PortForwardToolContent` 已按 `selectedMachine.id` 过滤会话，这符合“每个主机有自己右栏隧道”的产品目标，但 UI 和模型还没有把 host-scoped session 表达清楚。
- `terminalSessionRegistry.ts` 已有向当前终端写命令的能力，可以作为“注入代理环境到当前终端”的实现基础。

## 产品设计

### 信息架构

右栏分为四个区域：

1. 主机上下文头部
   - 主机名、用户、地址、生产标记。
   - 活跃隧道数和网络助手状态。
   - 刷新按钮和高级设置入口。

2. 场景选择
   - 使用分段控件，不用大卡片堆叠。
   - 四个场景：
     - 访问主机服务
     - 暴露本机服务
     - 主机使用本机网络
     - SOCKS/高级

3. 左右端点路由编辑器
   - 左端固定为“主机”面板。
   - 右端固定为“本机”面板。
   - 中间是方向箭头、协议 chip 和等价命令摘要。
   - 字段靠近所属端点，避免用户靠字段名推理方向。

4. 当前主机会话列表
   - 表格式但轻量：名称、方向、主机端点、本机端点、来源、状态、操作。
   - 操作包括复制地址、注入到当前终端、停止。

### 场景文案和流向

| 场景 | OpenSSH | 左侧主机 | 中间 | 右侧本机 |
| --- | --- | --- | --- | --- |
| 访问主机服务 | `-L` | 目标服务 `<host_target>:5432` | 本机 -> 主机 | 本机监听 `<local_bind>:15432` |
| 暴露本机服务 | `-R` | 主机监听 `<remote_bind>:18080` | 主机 -> 本机 | 目标服务 `<local_target>:3000` |
| 主机使用本机网络 | `-R` + proxy / remote dynamic | 主机代理 `<remote_bind>:18080` | 主机 -> 本机网络 | 本机网络出口 / 受管代理 |
| 本机 SOCKS 出口主机 | `-D` | 主机网络出口 | 本机 -> 主机网络 | 本机 SOCKS `<local_bind>:1080` |

### Apple-inspired 视觉规范

- 使用项目现有 `kerminal-solid-surface`、`kerminal-muted-surface`、`kerminal-field-surface` 和主题变量，避免新增只适配单一主题的硬编码色。
- 端点区域用低对比 solid surface，不做嵌套玻璃卡片；右栏内容密度保持紧凑。
- 箭头区域是视觉焦点：16px 线性图标、1.75 stroke、低饱和 accent，附带短文案。
- 主按钮只保留一个：当前场景的“开启”。停止在会话列表中。
- 地址绑定作为一级但紧凑的高级行展示：默认 loopback，可切换到局域网、全部接口或自定义；切换非 loopback 时显示风险和 sshd 前置条件。
- 所有 icon-only 操作要有 `aria-label` 和 tooltip。
- 浅色、深色、跟随系统主题下，端点标题、端口、状态 chip、错误提示都必须可读。

### 主机网络助手交互

默认流程：

1. 用户选中 SSH 主机，打开右栏 `隧道`。
2. 选择 `主机使用本机网络`。
3. 默认模式为 `HTTP_PROXY`，主机代理地址默认显示为 `127.0.0.1:18080`，但用户可切换为 `0.0.0.0:18080` 或指定局域网 IP；本机侧显示“受管 HTTP CONNECT 代理，出口为当前主机网络”。
4. 点击 `开启网络助手`。
5. Kerminal 启动本地受管代理，启动 SSH remote forward，并把会话标记为 `networkAssist`。
6. UI 显示：
   - 主机侧代理地址：`http://<remote_proxy_host>:18080`
   - 可用操作：注入到当前终端、设为后续 Kerminal 终端默认、生成用户级配置、复制 apt/git/npm 示例、停止。
7. 用户点击 `注入到当前终端`，Kerminal 向当前选中的同主机 SSH terminal 写入：

```sh
export HTTP_PROXY=http://<remote_proxy_host>:18080
export HTTPS_PROXY=http://<remote_proxy_host>:18080
export http_proxy=http://<remote_proxy_host>:18080
export https_proxy=http://<remote_proxy_host>:18080
export NO_PROXY=localhost,127.0.0.1
export no_proxy=localhost,127.0.0.1
```

可选高级流程：

- `SOCKS5` 模式：使用 remote dynamic forwarding，主机代理地址为 `socks5h://<remote_proxy_host>:<port>`，注入 `ALL_PROXY/all_proxy`。
- `新终端自动使用`：只影响 Kerminal 后续打开的同主机终端，使用远端 shell bootstrap 命令注入，不修改远端用户 profile。
- `用户级配置`：可选为当前远端用户写入 shell rc 或工具配置；必须先预览、可撤销、记录来源。
- `局域网可访问`：用户可将远端监听绑定到 `0.0.0.0` 或指定网卡地址；需要明确说明需要远端 `GatewayPorts`，生产主机必须二次确认。

## 技术方案

### 模型扩展

在 `src-tauri/src/models/port_forward.rs` 和 `src/lib/portForwardApi.ts` 中扩展：

```rust
pub enum PortForwardPurpose {
    Generic,
    HostNetworkAssist,
}

pub enum PortForwardProxyProtocol {
    Http,
    Socks5,
}

pub enum PortForwardOrigin {
    User,
    AiTool,
    NetworkAssist,
    HostPreset,
}
```

保留 `PortForwardKind` 兼容现有 API，同时新增：

- `purpose`
- `origin`
- `local_endpoint`
- `remote_endpoint`
- `local_bind_host`
- `remote_bind_host`
- `remote_access_scope`
- `proxy_url`
- `proxy_apply_scope`
- `shared_proxy_service_id`
- `local_proxy_entry_id`
- `command_preview`
- `managed_proxy_pid` 或受管服务 id
- `last_error`

是否新增 `PortForwardKind::RemoteDynamic` 作为单独枚举，需要在实现前做一次 OpenSSH 版本兼容验证。若默认走 HTTP proxy + 普通 `Remote`，可以先不扩 enum；正式 SOCKS5 模式也必须保留清晰的模型表达和测试覆盖。

### SSH 命令构建复用

在后端先拆出共享 SSH 命令构建模块，例如：

- `src-tauri/src/services/ssh_command_plan.rs`
- 复用或迁移 `ssh_terminal_service.rs` 中的：
  - `resolve_ssh_executable`
  - `resolve_identity`
  - `write_temporary_identity_file`
  - known_hosts 参数
  - auth args

端口转发后端要能使用 Kerminal 保存的私钥凭据、系统 SSH agent 和密码凭据。生产级要求：

- Key：复用 `SshTerminalService` 已有临时私钥文件方案，进程退出后清理。
- Agent：直接使用系统 `ssh-agent` / Windows OpenSSH Agent / Pageant 兼容入口，不复制私钥；Kerminal 只触发 `ssh` 去请求 agent 签名。
- Password：实现受控密码输入方案，不能要求用户改成密钥才能使用。候选包括：
  - 受控 PTY 启动 `ssh -N -T` 并响应密码提示。
  - `SSH_ASKPASS` 辅助程序 + `DISPLAY`/环境变量控制。
  - 复用现有终端 secret input response 的提示匹配和脱敏逻辑。
- 三种认证方式都要覆盖测试或真实 smoke；失败时显示认证方式、提示匹配和可恢复建议，不泄漏密码。

### SSH agent 说明

SSH agent 不是网络代理。它是本机的认证代理：

- 私钥保存在用户系统 agent 里，或者由 agent 解锁后代持。
- `ssh` 连接远端时把认证挑战交给 agent 签名。
- 私钥内容不会发送给远端，也不需要 Kerminal 自己保存私钥明文。
- 使用 agent 能让端口转发子进程免交互登录，适合生产级受管隧道。
- 不等于 agent forwarding。agent forwarding 是把本机 agent 暴露给远端使用，风险更高；本计划默认不启用 agent forwarding。

### 受管 HTTP CONNECT 代理

新增 Rust 服务：

- `LocalNetworkProxyService`
- AppState 内单例管理，按需启动；多个主机网络助手 session 复用同一个服务。
- 绑定地址可配置，默认 `127.0.0.1:0` 由系统分配本机端口；用户可选择 `0.0.0.0` 或指定局域网 IP，但必须通过安全确认。
- 支持：
  - HTTP `CONNECT host:port`
  - HTTP absolute-form request 转发
  - TCP half-close 和取消
  - 每个会话连接计数、字节计数、最近错误
- 不支持：
  - 认证
  - UDP
  - TLS 解密

生产级还需要：

- 引用计数：第一个网络助手启动本地代理服务，最后一个使用它的网络助手停止后再关闭服务。
- 逻辑入口：支持共享入口端口，也支持为每个主机/session 分配单例服务内部的 tagged listener，用于独立统计、策略和审计。
- 连接并发上限、空闲超时、总连接数和字节统计。
- 访问日志只记录必要元数据，不记录 URL query 中的敏感参数。
- 可选 allowlist/blocklist，至少能限制目标 host/domain/IP 段。
- 与 SSH 反向隧道绑定生命周期，防止本地代理孤儿进程。

依赖选择：

- 当前已有 `tokio`、`http`、`axum`，但 CONNECT 代理更接近 TCP bridge。首选用 `tokio::net::TcpListener` + `tokio::io::copy_bidirectional` 实现最小 HTTP CONNECT parser，避免引入重型代理 crate。
- 若实现复杂度过高，再评估引入轻量 HTTP proxy crate，但要先审许可证和维护状态。

### 网络助手启动计划

HTTP 模式等价流程：

```text
LocalNetworkProxyService singleton ensure-running
LocalNetworkProxyService create entry <local_proxy_bind>:<local_proxy_entry_port> tagged host=<host_id>
ssh -N -T -R <remote_bind>:<remote_port>:<local_proxy_bind>:<local_proxy_entry_port> user@host
remote env: HTTP_PROXY=http://<remote_proxy_host>:<remote_port>
```

SOCKS 模式等价流程：

```text
ssh -N -T -R <remote_bind>:<remote_port> user@host
remote env: ALL_PROXY=socks5h://<remote_proxy_host>:<remote_port>
```

会话关闭时：

1. 停止 SSH child。
2. 释放该 host/session 的本地 proxy entry。
3. 如果没有任何网络助手 session 继续引用共享 `LocalNetworkProxyService`，再停止本地代理服务。
4. 从 host scoped sessions 移除。
5. UI 刷新该主机的隧道列表。

### 终端注入

利用 `terminalSessionRegistry.writePaneCommand` 或新增专用 API：

- 只注入到当前选中的同 host SSH pane。
- 如果当前 pane 不是该 host，按钮 disabled 并说明原因。
- 注入命令作为一组 shell export，不写入远端 profile。
- “新终端自动使用网络助手”通过 Kerminal 管理的 terminal bootstrap 注入；不要依赖 `SendEnv`，因为服务器需要 `AcceptEnv` 配置。
- 用户级配置助手必须先读取目标文件、展示 diff、备份原文件、支持撤销。
- apt 等系统级配置如果需要写 `/etc/apt/apt.conf.d`，必须显示需要 root，并改为生成命令让用户确认执行；普通 `ubuntu` 用户不依赖这个路径也能使用会话级代理。

## 实施切片

| 顺序 | 标题 | 类型 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| 1 | 隧道路由模型与展示语义 | AFK | 当前 port forward API | `PortForwardSummary` 可表达左右端点、流向、来源、purpose；旧 local/remote/dynamic API 兼容 |
| 2 | 共享 SSH 命令构建与三类认证支持 | AFK/HITL | 1 | key、agent、password 主机都能启动受管隧道；密码和私钥不泄漏 |
| 3 | Apple-inspired 左右端点 UI | HITL/AFK | 1 | 右栏显示主机/本机左右端点和中间箭头；浅色/深色/跟随系统可读 |
| 4 | 当前主机会话列表重做 | AFK | 1,3 | 每台主机只显示自己的隧道；会话行有方向、地址、来源、状态、停止动作 |
| 5 | 地址绑定与可见性策略 | AFK/HITL | 1,3 | 本机和远端监听都可选择 loopback、局域网、全部接口、自定义；非 loopback 有安全确认和 GatewayPorts 检测 |
| 6 | 单例受管 HTTP CONNECT 代理服务 | AFK | 2,5 | 一个本地代理服务可服务多个主机隧道；HTTP proxy 可通过单元/集成测试转发 HTTP CONNECT，支持限流、超时、统计和生命周期清理 |
| 7 | 主机网络助手 HTTP 模式 | AFK | 5,6 | 点击开启后远端 `<bind>:<port>` 可作为 HTTP/HTTPS proxy 使用；点击停止清理 SSH 和本地代理 |
| 8 | 远端 SOCKS5 网络助手模式 | AFK/HITL | 2,5 | `ssh -R <bind>:<port>` remote dynamic 通过真实 smoke，UI 提供 `ALL_PROXY=socks5h://...` |
| 9 | 代理应用与回滚 | AFK/HITL | 7,8 | 支持当前终端注入、新终端自动注入、用户级配置助手、撤销和复制命令；普通 ubuntu 用户不需要 root |
| 10 | AI/工具调用集成 | AFK | 7,9 | AI 工具可创建/关闭网络助手并选择应用范围；工具摘要不泄漏凭据 |
| 11 | 启动与主题验收 | AFK/HITL | 3-10 | `npm run build`、dev server smoke、涉及 Tauri 后跑 `npm run tauri:dev`；三主题 UI 无重叠 |

## 详细任务

### TASK-001：隧道路由模型与展示语义

涉及文件：

- `src-tauri/src/models/port_forward.rs`
- `src-tauri/src/services/port_forward_service.rs`
- `src/lib/portForwardApi.ts`
- `src/lib/portForwardApi.test.ts`
- `src-tauri/tests/port_forward_service.rs`

验收：

- local 显示为本机 -> 主机。
- remote 显示为主机 -> 本机。
- dynamic 显示为本机 SOCKS -> 主机网络。
- 旧测试继续通过。

### TASK-002：共享 SSH 命令构建与三类认证

涉及文件：

- `src-tauri/src/services/ssh_terminal_service.rs`
- `src-tauri/src/services/port_forward_service.rs`
- 新增 `src-tauri/src/services/ssh_command_plan.rs`

验收：

- 私钥凭据主机的端口转发命令带 `-i <temporary-key>` 和 `IdentitiesOnly=yes`。
- known_hosts 参数与 SSH terminal 一致。
- key、agent、password 三类主机都能创建受管隧道。
- password 认证通过受控 PTY、SSH_ASKPASS 或复用 secret input response 完成，不把密码写入命令行、日志或持久化文件。
- agent 认证不启用 agent forwarding。

### TASK-003：左右端点 UI

涉及文件：

- `src/features/tool-panel/PortForwardToolContent.tsx`
- 可新增 `src/features/tool-panel/port-forward/PortForwardRouteEditor.tsx`
- `src/features/tool-panel/ToolPanel.test.tsx`

验收：

- 场景切换不需要用户理解 `-L/-R/-D` 才能填写。
- 中间箭头随场景改变方向和文案。
- 字段按端点归属排列。
- 空态、错误态、加载态、禁用态都存在。

### TASK-004：主机 scoped 会话列表

涉及文件：

- `src/features/tool-panel/PortForwardToolContent.tsx`
- `src/features/tool-panel/port-forward/PortForwardSessionList.tsx`

验收：

- 同一时间多个主机有隧道时，当前右栏只显示 selected host 的会话。
- 会话行能复制主机侧地址或本机侧地址。
- 停止动作只停止该会话，不影响其他主机。

### TASK-005：地址绑定与可见性策略

涉及文件：

- `src-tauri/src/models/port_forward.rs`
- `src-tauri/src/services/port_forward_service.rs`
- `src/features/tool-panel/PortForwardToolContent.tsx`

验收：

- 本机监听地址和远端监听地址都不是硬编码。
- 用户可选 `127.0.0.1`、`0.0.0.0`、指定局域网 IP 和自定义地址。
- 选择 `0.0.0.0` 或局域网 IP 时显示暴露范围、生产确认、GatewayPorts 前置条件和回滚方式。
- GatewayPorts 不支持时，UI 能解释为什么无法对局域网开放。

### TASK-006：单例本地 HTTP CONNECT 代理

涉及文件：

- 新增 `src-tauri/src/services/local_network_proxy_service.rs`
- `src-tauri/src/state.rs`
- Rust tests

验收：

- 受管代理默认监听 `127.0.0.1`，但可按用户配置监听局域网或全部接口。
- 多台主机同时启用网络助手时，本机只存在一个受管代理服务实例。
- 每台主机有独立 SSH `-R` child、远端代理端口、session 状态和停止动作。
- 单例服务内部可分配多个 tagged entry，用于按 host/session 统计和策略隔离。
- CONNECT 到本机测试 HTTP server 成功。
- stop 后端口释放。
- 错误、连接数、字节计数、最近目标和空闲超时可查询。

### TASK-007：主机网络助手 HTTP 模式

涉及文件：

- `src-tauri/src/models/port_forward.rs`
- `src-tauri/src/services/port_forward_service.rs`
- `src-tauri/src/commands/port_forward.rs`
- `src/lib/portForwardApi.ts`
- `src/features/tool-panel/PortForwardToolContent.tsx`

验收：

- UI 一键开启网络助手。
- 远端代理地址显示为 `http://<remote_proxy_host>:<remote_port>`。
- 停止后 SSH child 和 local proxy 都被清理。
- 失败时显示远端 `AllowTcpForwarding`、端口占用、认证失败等可理解错误。

### TASK-008：远端 SOCKS5 网络助手模式

验收：

- 通过真实 OpenSSH smoke 验证目标平台支持 remote dynamic `-R <bind>:<port>`。
- UI 提供 SOCKS5 模式和 `ALL_PROXY=socks5h://...` 注入。
- SOCKS5 模式和 HTTP 模式共享会话生命周期、地址绑定和停止逻辑。

### TASK-009：代理应用与回滚

涉及文件：

- `src/features/terminal/terminalSessionRegistry.ts`
- `src/features/tool-panel/PortForwardToolContent.tsx`
- `src/lib/terminalApi.ts` 视需要

验收：

- 当前同 host SSH pane 可一键注入代理环境。
- 后续新开的同 host Kerminal 终端可按用户选择自动注入。
- 用户级 shell/git/npm/pip 配置助手能预览 diff、备份、写入和撤销。
- 普通 `ubuntu` 用户不需要 root 即可完成当前终端和用户级配置路径。
- 需要 root 的系统级配置只生成命令并要求用户确认，不作为默认路径。

## 验证计划

自动验证：

- `npm run test:frontend -- src/features/tool-panel/ToolPanel.test.tsx src/lib/portForwardApi.test.ts`
- `cd src-tauri; cargo test port_forward --lib -- --nocapture`
- 新增 local proxy Rust tests。
- `npm run build`

真实启动：

- `npm run dev -- --host 127.0.0.1 --port <free-port>` 并访问 HTTP 200。
- 涉及 Tauri/Rust/窗口/权限后运行 `npm run tauri:dev`。

人工 smoke：

1. key SSH 主机：开启“访问主机服务”，确认本机端口可访问远端服务。
2. agent SSH 主机：开启“暴露本机服务”，确认远端 `curl <remote_proxy_host>:<remote_port>` 可访问本机服务。
3. password SSH 主机：使用普通非 root 用户登录，开启 HTTP 网络助手，注入当前终端，远端执行 `curl -I https://github.com`。
4. 普通 `ubuntu` 用户：不开 root、不改 `/etc`，开启网络助手、注入当前终端、打开后续新终端自动注入，并验证 `git ls-remote` 或 `curl` 可走代理。
5. SOCKS5 模式：远端注入 `ALL_PROXY=socks5h://<remote_proxy_host>:<remote_port>`，验证支持 SOCKS 的工具可用。
6. 地址绑定：分别验证 `127.0.0.1`、指定局域网 IP、`0.0.0.0`；非 loopback 模式必须有确认和 GatewayPorts 诊断。
7. 停止网络助手后，同一远端代理端口不可再用，本机代理端口释放。
8. 同时开启两台以上主机的网络助手，本机只有一个受管代理服务实例；停止其中一台不会影响另一台，最后一台停止后服务退出。
9. 切换到另一台主机，右栏不显示上一台主机的会话。
10. 浅色、深色、跟随系统主题检查端点卡、箭头、会话列表、弹窗、toast。

## 风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 用户误解为透明全局联网 | 远端后台进程仍不走代理 | 文案明确“会话级/用户级/服务级/透明级”的差异，不叫 VPN |
| password 认证非交互隧道复杂 | 一键失败或密码泄漏风险 | 生产级必须实现受控 PTY/SSH_ASKPASS/secret response 方案之一，并覆盖脱敏测试 |
| 远端 sshd 禁止 TCP forwarding | 网络助手不可用 | 捕获 `ExitOnForwardFailure` 错误并提示检查 `AllowTcpForwarding` |
| 远端端口被占用 | 启动失败 | 支持自动选端口或提示换端口 |
| HTTP proxy parser 不完整 | 某些工具不可用 | 覆盖 CONNECT、absolute-form、错误响应和大流量；SOCKS5 模式作为同等级补充 |
| 生产主机误开启外部监听 | 安全风险 | 默认 loopback；非 loopback 需要 GatewayPorts 说明、生产二次确认和会话醒目标识 |
| 本地代理被远端滥用 | 可能访问任意外网 | 会话按 host 绑定、可停止、有限流和 allowlist/blocklist |
| 多主机共享代理时归因不清 | 难做 per-host 审计和限流 | 单例服务内部使用 tagged entry 或 session id 归因，不按主机启动独立服务 |
| 用户级配置污染远端环境 | 后续命令被意外代理 | 写入前预览 diff、备份、标记 Kerminal 管理块、支持一键撤销 |
| UI 过度卡片化 | 仍显得低级和拥挤 | 左右端点为主、低噪表格为辅，避免卡片套卡片 |

## 生产级决策点

- password 认证实现路径：在受控 PTY、`SSH_ASKPASS`、复用 secret input response 之间选一条主路径，另外一条作为 fallback。
- 主机网络助手默认协议：建议默认 HTTP_PROXY，同时正式支持 SOCKS5，不把 SOCKS 降级成试验能力。
- 新终端自动注入代理环境：建议作为用户显式开关，不默认开启。
- 用户级配置助手：建议支持 shell/git/npm/pip/curl，系统级 apt 配置只生成命令或要求 root 确认。
- 远端外部监听：支持用户选择，但非 loopback 必须有 GatewayPorts 诊断、暴露范围提示和生产确认。

## 结论

新设计应把“SSH 隧道”从协议参数提升成用户场景：

- 左侧主机、右侧本机、中间箭头，是这次右栏改造的核心。
- SOCKS 不应该和 local/remote 平铺成难懂选项，而应作为“本机出口主机”或“主机出口本机”的代理模式。
- “主机使用本机网络”的完整实现是：Kerminal 本机单例受管 HTTP CONNECT proxy 和/或 OpenSSH remote dynamic SOCKS + 每台主机独立 SSH `-R` + 会话级/新终端级/用户级代理应用。
- 完整交付前必须补齐 SSH 隧道认证链路、地址绑定策略、普通用户无 root 路径、用户级配置回滚和真实三主题启动验证。

## Round Log

- 2026-06-21 12:51 调研 VS Code Ports、OpenSSH `-R`/dynamic、Dev Tunnels 和 SSH dynamic forwarding；审阅当前 `PortForwardToolContent`、`portForwardApi`、`port_forward_service`、SSH terminal 凭据链路和 terminal write 能力；形成 next 计划，未改业务代码。
- 2026-06-21 13:00 根据用户反馈修订为生产级完整方案：确认本机受管代理 + SSH 反向映射 + 远端代理应用链路；补充普通非 root 用户可用、远端/本机绑定地址可配置、password/key/agent 三类认证、HTTP 与 SOCKS 同等级支持、用户级配置和回滚要求。
- 2026-06-21 13:08 根据用户反馈修订多主机共享架构：本机侧 `LocalNetworkProxyService` 为单例，多台主机各自建立 SSH `-R` 映射到共享代理服务；单例内部可用 tagged entry 保持 per-host 统计、策略和停止隔离。
- 2026-06-21 13:18 用户明确要求使用 subagent 并行进行代码开发、测试和边界验证；计划从 `next` 移到 `active`，登记 `lane-ssh-tunnel-network-assist`，本轮先保护现有脏工作区并把实现拆为后端代理/SSH 凭据、前端右栏、验证边界三个并行方向。
- 2026-06-21 13:52 验证阻塞收敛：`PortForwardToolContent.tsx` 拆出 `port-forward/PortForwardRouteEditor.tsx` 和 `port-forward/PortForwardSessionList.tsx`，保持请求构建、创建/停止/复制/注入行为不变；主文件降到 908 行，新拆文件分别 261/198 行，`port_forward_service.rs` 当前为 804 行且测试已在 `port_forward_service_tests.rs`。验证结果：`npm run check:source-size` 通过，570 files、over-limit=0；`npm run test:frontend -- src/features/tool-panel/PortForwardToolContent.test.tsx src/lib/portForwardApi.test.ts` 通过，2 files / 9 tests；Vite dev server smoke `npm run dev -- --host 127.0.0.1 --port 1436` 返回 HTTP 200、入口长度 644，随后已关停；`git diff --check -- src/features/tool-panel/PortForwardToolContent.tsx src/features/tool-panel/port-forward/PortForwardRouteEditor.tsx src/features/tool-panel/port-forward/PortForwardSessionList.tsx` 通过，仅有 LF/CRLF 提示。全局 `npm run typecheck` 和 `npm run build` 当前不再被 PortForward 阻断，但失败于 AI assistant lane owned test `src/features/tool-panel/ai-tool-content/aiConversationPersistence.test.ts(334,11)` 缺 `AiChatResponse.visionUsage`；PortForward Rust 窄测 `cargo test --manifest-path src-tauri/Cargo.toml port_forward -- --nocapture` 编译阶段失败于 AI assistant Rust 文件 `src-tauri/src/services/ai_agent_service.rs:186` 缺 `AiChatResponse.vision_usage`，未触达 PortForward 测试执行阶段。
- 2026-06-21 13:46 ssh-port-forward worker 完成后端切片：扩展 `port_forward` 模型 purpose/origin/proxy/endpoint/command preview/last_error/apply scope，新增 `ssh_command_plan` 共享 OpenSSH 可执行文件、known_hosts、key identity、agent/password 认证计划，端口转发服务支持 local/remote/dynamic/hostNetworkAssist HTTP 与 remote dynamic SOCKS 命令计划；password 使用 PTY secret-response 计划且不写入命令行，agent 显式 `-a` 不启用 forwarding。新增模块测试覆盖 local/remote/dynamic/hostNetworkAssist、非 loopback bind、key identity、agent、password 和旧 JSON 兼容；验证 `cargo test port_forward --lib -- --nocapture`、`cargo test --test port_forward_service -- --nocapture`、`cargo check`、`npm run build`、Vite dev server HTTP 200 通过。`npm run tauri:dev` 标准路径因 1425 已有 node dev server 失败；临时跳过 beforeDevCommand 后 Rust 编译被正在运行的 `target/debug/kerminal.exe` pid 30932 占用阻塞，未强制结束进程。
- 2026-06-21 14:02 ssh-port-forward worker 复核并补齐后端兼容性：`ssh_command_plan` 在旧 `PortForwardService::create()` 无凭据上下文时对 `credential:*` 私钥引用退回 OpenSSH 默认认证，不把凭据引用作为 `-i` 或写入命令预览；`create_with_context` 仍使用 Kerminal 凭据写临时 identity 文件。新增单测覆盖旧入口兼容分支。隔离 target 验证通过：`$env:CARGO_TARGET_DIR='target-port-forward-worker'; cargo test port_forward --lib -- --nocapture`（12 passed）、`cargo test --test port_forward_service -- --nocapture`（1 passed）、`cargo check`、`cargo test local_network_proxy --lib -- --nocapture`（3 passed）、`npm run build`、`npm run dev -- --host 127.0.0.1 --port 14201` 后 HTTP 200。未复跑 `npm run tauri:dev`：`127.0.0.1:1425` 仍被 node pid 94240 监听，且 `src-tauri/target/debug/kerminal.exe` pid 29320 正在运行；为保护用户进程未强制结束。
- 2026-06-21 14:06 leader 收口复核并补齐最终门禁：确认主机网络助手采用一个本机 `LocalNetworkProxyService` 共享代理服务，多台主机各自建立独立 SSH `-R` 隧道映射回该共享服务；远端/本机绑定地址均可配置，非 loopback 有 UI 风险提示，agent 认证使用 `-a` 且不启用 agent forwarding，password 走 PTY secret-response 且不泄漏到命令行/预览。验证通过：`npm run typecheck`、`npm run build`、`npm run test:frontend -- src/lib/portForwardApi.test.ts src/features/tool-panel/ToolPanel.test.tsx src/features/terminal/terminalSessionRegistry.test.ts`（3 files / 26 tests）、`npm run test:frontend -- src/features/tool-panel/PortForwardToolContent.test.tsx src/lib/portForwardApi.test.ts`（2 files / 9 tests）、`cargo test port_forward_service --lib -- --nocapture`（12 passed）、`cargo test local_network_proxy_service --lib -- --nocapture`（3 passed）、`cargo test --test local_network_proxy_service -- --nocapture`（5 passed）、`cargo test --test port_forward_service -- --nocapture`（1 passed）、`cargo test --test ai_tool_invocation_service port_forward -- --nocapture`（9 passed）、`cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`、`npm run check:source-size`（570 files，over-limit=0）、`git diff --check`（通过，仅 LF/CRLF 提示）。真实启动验证：`npm run dev -- --host 127.0.0.1 --port 5174 --strictPort` 返回 HTTP 200 后已关闭；标准 `npm run tauri:dev` 因已有 `127.0.0.1:1425` Vite 服务占用而失败，随后用现有 1425 dev server 并设置 `$env:CARGO_TARGET_DIR='target/tauri-smoke'; npx tauri dev --config '{"build":{"beforeDevCommand":""}}'` 隔离启动，成功运行 `target/tauri-smoke/debug/kerminal.exe` 10 秒无崩溃后手动中断。剩余未覆盖：未连接真实外部 SSH 主机执行 key/agent/password 网络助手 smoke；用户级 shell/git/npm/pip 配置写入与撤销仍按计划保留为后续显式切片。
- 2026-06-21 14:07 frontend-port-panel worker 完成右栏视觉切片复核：`PortForwardToolContent.tsx` 接入左右端点编辑器、会话列表、网络助手代理预览和 focusedPane 注入入口，`ToolPanel.tsx` 仅追加 focusedPane 传递；修复最终视觉验证发现的协议切换文字重叠。验证通过：`npm run test:frontend -- src/lib/portForwardApi.test.ts src/features/tool-panel/PortForwardToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx`（24 tests）、`npm run build`（仅既有 Vite chunk warning）、`npm run dev -- --host 127.0.0.1 --port 5178` 后 HTTP 200。真实 Chrome CDP 视觉验证覆盖浅色、深色、跟随系统主题，目标场景为“主机使用本机网络”、远端 `0.0.0.0`、GatewayPorts warning、preview 会话列表和注入入口；截图证据位于 `C:/Users/24052/AppData/Local/Temp/kerminal-port-forward-panel-target-system.png`、`...-target-light.png`、`...-target-dark.png`、`...-session-list-dark.png`。浏览器 preview 无同 host SSH focused pane，注入按钮禁用符合预期。
- 2026-06-21 14:16 worker 完成“后续新终端自动注入代理环境”切片：新增 `src/features/terminal/terminalProxyAutoInjection.ts` 保存 host-scoped、session-scoped 的前端内存自动注入选择；`terminalSessionRegistry.ts` 在 SSH pane session 注册后，仅当 `target === "ssh"` 且 `remoteHostId` 命中已启用 host 时写入一次代理 export，并记录 tool 来源命令历史，不注入容器/本地/其它 host；`PortForwardToolContent.tsx` 和 `PortForwardSessionList.tsx` 为 hostNetworkAssist 会话增加“新终端自动使用/关闭新终端自动使用”状态按钮，关闭会话时同步清除该 session 的自动注入选择。测试补充：当前 focused pane 同 host 注入继续可用、不同 host focused pane 按钮禁用、开启/关闭新终端自动使用、同 host 后续 SSH session 自动注入、不同 host 不注入、关闭后不注入。验证通过：`npm run test:frontend -- src/features/terminal/terminalSessionRegistry.test.ts src/features/tool-panel/PortForwardToolContent.test.tsx`（2 files / 18 tests）、`npm run typecheck`、`npm run build`（仅既有 Vite chunk warning）、`npm run check:source-size`（575 files，over-limit=0，`PortForwardToolContent.tsx` 989 行 warning）、`git diff --check`（通过，仅 LF/CRLF 提示）、`npm run dev -- --host 127.0.0.1 --port 1439` 后 HTTP 200/root 存在并已关闭。未运行 `npm run tauri:dev`：本切片未修改 Rust、Tauri 配置、窗口或权限；已有本轮 leader 记录覆盖 Tauri smoke，真实外部 SSH 主机行为仍需后续人工或集成 smoke 验证。
- 2026-06-21 14:17 worker 完成边界复核和“用户级配置助手最小闭环”：审计确认 AI port-forward 工具当前仍只解析旧 `hostId/name/kind/bindHost/sourcePort/targetHost/targetPort` 参数，尚不能创建 hostNetworkAssist 或声明 proxy apply scope；workflow 路径仅将渲染命令写入 focused pane，未读取网络助手代理上下文；当前终端注入和后续新 SSH 终端自动注入已有前端入口。新增 `portForwardWorkbenchModel` 用户级 setup/undo 脚本生成器，`PortForwardSessionList` 在 hostNetworkAssist 会话上提供“复制配置脚本/复制撤销脚本”；脚本只写当前远端用户 `$HOME` 下 `.kerminal/network-assist`、`~/.profile` Kerminal marker block 和 git/npm/pip 用户级配置，不需要 root、不自动执行，并记录原始 git/npm/pip 配置供撤销恢复。测试补充 `portForwardWorkbenchModel.test.ts` 校验不包含 `sudo` 或 `/etc/`。验证通过：`npm run test:frontend -- src/features/tool-panel/port-forward/portForwardWorkbenchModel.test.ts src/features/tool-panel/PortForwardToolContent.test.tsx src/lib/portForwardApi.test.ts`（3 files / 13 tests）、`npm run build`（仅既有 Vite chunk warning）、`npm run dev -- --host 127.0.0.1 --port 5189 --strictPort` 后 HTTP 200/root 长度 644 并已关闭、`npm run check:source-size`（575 files，over-limit=0）、`git diff --check -- src/features/tool-panel/port-forward/portForwardWorkbenchModel.ts src/features/tool-panel/port-forward/PortForwardSessionList.tsx src/features/tool-panel/port-forward/portForwardWorkbenchModel.test.ts src/features/tool-panel/PortForwardToolContent.test.tsx` 通过。剩余边界：没有实现远端文件读写/预览 diff/自动备份/一键回滚执行链路；真实外部 SSH 主机上的 shell/git/npm/pip 行为仍需人工 smoke。
- 2026-06-21 14:42 leader 追加最终实现闭环：AI `port_forward.create` 已支持 `hostNetworkAssist`、proxy protocol/apply scope、远端/本机绑定和网络助手参数；`ssh.command` 支持 `proxyUrl/proxyProtocol` 并以临时环境变量包裹单次命令；workflow/片段/工具写入终端前会等待同 host 待完成的新终端自动代理注入，避免命令先于 `export` 执行。复验通过：`npm run test:frontend -- src/features/terminal/terminalSessionRegistry.test.ts src/features/tool-panel/port-forward/portForwardWorkbenchModel.test.ts src/features/tool-panel/PortForwardToolContent.test.tsx src/lib/portForwardApi.test.ts`（4 files / 25 tests）、`npm run typecheck`、`npm run build`、`npm run check:source-size`（576 files，over-limit=0）、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`、`cargo test --manifest-path src-tauri/Cargo.toml port_forward_tools --lib -- --nocapture`（2 passed）、`cargo test --manifest-path src-tauri/Cargo.toml ssh_tools --lib -- --nocapture`（3 passed）、`cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service port_forward -- --nocapture`（10 passed）、`cargo test --manifest-path src-tauri/Cargo.toml --test tool_registry_service registry_lists_core_tools_with_risk_and_confirmation_policy -- --nocapture`、Vite smoke `npm run dev -- --host 127.0.0.1 --port 5192 --strictPort` HTTP 200；Tauri smoke 使用既有 1425 dev server 和 `$env:CARGO_TARGET_DIR='target/tauri-smoke-network-assist'; npx tauri dev --config '{"build":{"beforeDevCommand":""}}'` 成功编译并运行 `kerminal.exe` 10 秒无错误输出，随后仅停止该 smoke 应用进程。剩余外部验收：未提供真实 SSH 主机，因此 key/agent/password、GatewayPorts、远端 `curl/git/npm/pip` 的跨机 smoke 未执行；用户级配置助手当前是复制 setup/undo 脚本让用户在远端执行，不自动改远端文件。
- 2026-06-21 15:08 completion audit 收口：主线程和 subagent 并行完成当前状态审计与真实 SSH smoke。补强代码边界：`proxy_url` 对 `0.0.0.0`/`::` 监听生成远端客户端可连接的 `127.0.0.1`/`[::1]` URL；交互式 SSH terminal 显式加 `-a` 禁用 agent forwarding；测试补充 custom private bind、wildcard proxy URL、setup 脚本不含 `sudo`。真实 smoke：Windows OpenSSH client + WSL Ubuntu 临时 `sshd`，非 root 用户 `kong` key auth 登录成功；HTTP 模式 `ssh -N -T -a -R 127.0.0.1:39282:127.0.0.1:39280` 后远端 `http_proxy=http://127.0.0.1:39282 curl --noproxy '' http://example.invalid/smoke` 返回本机 proxy 响应；SOCKS 模式 `ssh -N -T -a -R 127.0.0.1:39283` 后远端 `curl --socks5-hostname 127.0.0.1:39283 http://127.0.0.1:39281/socks-smoke` 返回本机 origin 响应；GatewayPorts `ssh -N -T -a -R 0.0.0.0:39284:127.0.0.1:39280` 后远端 `ss -ltn` 确认 `0.0.0.0:39284` 并通过代理访问成功；本轮临时 Windows/WSL 目录和进程已清理。最终验证通过：`cargo test --manifest-path src-tauri/Cargo.toml --test local_network_proxy_service -- --nocapture`（5 passed）、`cargo test --manifest-path src-tauri/Cargo.toml --test port_forward_service -- --nocapture`（1 passed）、`cargo test --manifest-path src-tauri/Cargo.toml --test ssh_terminal_password_smoke local_russh_loopback -- --nocapture`（2 passed）、`cargo test --manifest-path src-tauri/Cargo.toml --test ai_tool_invocation_service port_forward -- --nocapture`（10 passed）、`cargo test --manifest-path src-tauri/Cargo.toml ssh_terminal_service --lib -- --nocapture`（6 passed）、`cargo test --manifest-path src-tauri/Cargo.toml port_forward_service --lib -- --nocapture`（15 passed）、`npm run test:frontend -- src/features/tool-panel/port-forward/portForwardWorkbenchModel.test.ts src/lib/portForwardApi.test.ts src/features/terminal/terminalSessionRegistry.test.ts`（3 files / 20 tests）、`npm run test:frontend -- src/features/terminal/terminalSessionRegistry.test.ts src/features/tool-panel/port-forward/portForwardWorkbenchModel.test.ts src/features/tool-panel/PortForwardToolContent.test.tsx src/lib/portForwardApi.test.ts`（4 files / 25 tests）、`npm run build`、`npm run check:source-size`（576 files，over-limit=0）、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`、`npm run typecheck`、`git diff --check`（仅 LF/CRLF 提示）、Tauri smoke `$env:CARGO_TARGET_DIR='target/tauri-smoke-network-assist-final'; npx tauri dev --config '{"build":{"beforeDevCommand":""}}'` 成功运行 10 秒无错误后仅停止 smoke 应用。残余生产差异：Docker 路径不可测（本机无 Docker/Podman）；GatewayPorts 只在 WSL 远端侧确认监听和 loopback 转发，没有做外部 LAN 访问；真实生产 sshd 若禁用 `AllowTcpForwarding` 或未配置 `GatewayPorts clientspecified` 会按错误路径处理。
