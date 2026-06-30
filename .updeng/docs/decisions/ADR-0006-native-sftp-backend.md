# ADR-0006: Native SFTP Backend

## 状态

Accepted

## 背景

- Kerminal 当前 SFTP 文件工具通过系统 `sftp` 子进程执行 batch 命令，每次操作都会重新握手并同步等待。
- 用户目标是完整最终版原生 SFTP 文件管理器，不接受范围收缩或外部命令回退。
- SFTP 文件管理需要跨平台、并发、进度、取消、队列、host key 校验和可测试的实现。

## 决策驱动因素

- 跨平台可构建：Windows、macOS、Linux 都必须可运行。
- 最终一致性：SFTP 文件操作不能依赖外部 `ssh`/`sftp` 可执行文件。
- 可测试：队列、进度、取消和错误必须能用 fake backend 测试。
- 安全性：默认拒绝未知或变更的 host key，除非用户显式信任。

## 备选方案

| 方案 | 优点 | 缺点 | 风险 | 验证方式 |
| --- | --- | --- | --- | --- |
| 继续 OpenSSH `sftp` 子进程 | 认证兼容系统配置；实现成本低 | 无连接复用；进度/取消弱；不可控并发；依赖外部命令 | 无法满足最终目标 | 不采用 |
| `ssh2`/libssh2 native adapter | 成熟；SFTP API 完整；支持 password/agent/key；可 vendored OpenSSL | 同步 API；构建依赖 OpenSSL/libssh2；并发需多 session | 最终架构会被同步模型限制 | 不采用 |
| `russh` + upstream `russh-sftp` | 纯 Rust async；SFTP v3；高层 API 接近 `std::fs`，并实现 async file I/O | 大文件吞吐需要项目侧确认 pipeline 行为 | 实现成本中等 | 候选 |
| `russh` + `bssh-russh-sftp` | 继承 upstream `russh-sftp` API；额外提供大文件读写 pipeline helper；贴合传输进度 wrapper | fork 依赖需要跟进 upstream 兼容 | fork 维护风险 | 采用 |
| `russh` + `rusftp` | 纯 Rust async；`rusftp` 明确支持 shared/cloneable client、cloneable file、concurrent requests、tokio 文件抽象 | 与当前项目需要的 pipeline file copy helper 不如 `bssh-russh-sftp` 直接；版本较新 | 生态成熟度风险 | 不采用 |

## 决策

采用 `russh` + `bssh-russh-sftp` 作为最终版原生 SFTP runtime，其中 Cargo 依赖以 `russh-sftp` crate 名称 alias 引入。

原因：

- `russh` 是纯 Rust SSH 客户端/服务端库，提供客户端认证、known_hosts 检查和 keepalive 配置。
- upstream `russh-sftp` 提供 SFTP v3 client/server、高层文件抽象和 async I/O，和 Tauri/tokio runtime 一致。
- `bssh-russh-sftp` 在 upstream API 基础上补充 `write_all_pipelined` / `read_to_writer_pipelined`，让大文件上传/下载可以在单个任务内挂起多条 SFTP 请求，降低 RTT 对吞吐的影响。
- 最终版需要 async 传输、进度、取消和队列；纯 Rust async runtime 比同步 libssh2 更适合长期维护。
- `rusftp` 的并发设计有价值，但当前产品切片更需要稳定的文件流式读写、pipeline 和进度 wrapper 组合，因此不作为本轮协议层。

## 影响

- 正向影响：SFTP 操作可被统一队列、进度、取消和测试缝隙管理；不再依赖外部 `sftp` 命令。
- 负向影响：需要引入 tokio async runtime、host key 信任管理和更完整 SSH 凭据模型。
- 需要同步修改：Rust 依赖、SFTP 模型、服务、Tauri command、前端 API、SFTP UI、设置页、测试。
- SFTP 全局并发、单主机并发、pipeline 深度、packet bytes 和 timeout 作为应用设置持久化；native backend 在连接和传输任务入队时读取当前配置。
- 默认自动化验证包含 in-process `russh` loopback SSH server 和 `bssh-russh-sftp` subsystem，覆盖 native backend 的 host key、密码认证、目录、预览、上传、下载和文件管理操作。
- 跨平台验证通过 `.github/workflows/native-sftp-cross-platform.yml` 在 Ubuntu、macOS 和 Windows runner 上运行前端 typecheck/test/build 与 Rust fmt/clippy/test。

## 回滚或替代

- 如果 `bssh-russh-sftp` fork 无法持续跟进 upstream，则保留 `russh` SSH/session、host key 策略和 transfer manager，替换协议层为 upstream `russh-sftp`，并在项目侧实现等价 pipeline helper。
- 如果 `russh-sftp` 系列无法满足生产能力，则保留 transfer manager 和前后端 IPC，替换协议层为另一个 native async SFTP adapter。
- 不回滚到系统 `sftp` 子进程作为产品能力。

## 验证

- `npm run typecheck`
- `npm run test:frontend`
- `npm run test:rust`
- `cargo test native_sftp_backend_uses_real_ssh_sftp_protocol -q`
- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `npm run build`
- `.github/workflows/native-sftp-cross-platform.yml` matrix: `ubuntu-22.04`、`macos-latest`、`windows-latest`
- 用户环境仍建议手工连接至少一个 known_hosts 已信任 SSH 主机，验证 list、preview、upload、download、cancel 和 keychain 读写；该项用于覆盖外部服务器/平台差异，不再阻塞默认自动化完成口径。

## 外部依据

- [`russh` docs.rs](https://docs.rs/russh)：tokio/futures based async SSH client/server library。
- [`russh-sftp` docs.rs](https://docs.rs/russh-sftp)：SFTP subsystem client/server，支持 raw session 和高层 async file I/O。
- [`bssh` release notes](https://github.com/lablup/bssh/releases)：`bssh-russh-sftp` fork 的剩余 custom value-add 是 `write_all_pipelined` / `read_to_writer_pipelined`。
- [`rusftp` GitHub](https://github.com/aneoconsulting/rusftp)：shared client、cloneable types 和 concurrent requests 设计，作为并发能力对照方案。
