---
id: PLAN-20260618-000024-native-sftp-manager
status: done
created_at: 2026-06-18T00:00:24+08:00
started_at: 2026-06-18T00:00:24+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Native SFTP Manager

## 目标

- 将当前依赖系统 `sftp` 子进程的文件工具替换为原生、异步、可管理的 SFTP 文件管理能力。
- 支持跨平台目录浏览、预览、上传、下载、目录递归、删除、重命名、chmod、传输队列、并发上限、进度、取消和错误状态。
- 最终版不依赖外部 `ssh`/`sftp` 可执行文件完成 SFTP 文件操作。

## 非目标

- 本轮不实现 FTP、S3、SMB、WebDAV 等非 SFTP 协议。
- 本轮只替换 SFTP 文件管理能力；SSH 交互终端是否后续迁移另行决策。
- 本轮不保存明文密码到 SQLite；需要凭据时必须走 OS keychain 或已有 `CredentialService`。

## 调研结论

- `ssh2`/libssh2：成熟、文档完整，但同步 API 和 native OpenSSL/libssh2 依赖不适合作为最终强文件管理器的核心。
- `russh`：纯 Rust async SSH，提供客户端、密码/公钥/agent 认证、known_hosts 检查和可配置 keepalive，是最终版 SSH 层基础。
- `rusftp`：基于 `russh`，设计上强调 shared/cloneable client 和 concurrent requests，但当前与项目依赖图及具体文件流式 API 的贴合度不如 `russh-sftp`。
- `russh-sftp` / `bssh-russh-sftp`：高层 API 接近 `std::fs`/tokio I/O，支持 SFTP v3、OpenSSH 扩展能力，并由 `bssh-russh-sftp` 提供 `write_all_pipelined` / `read_to_writer_pipelined`，适合作为当前最终实现的 SFTP 协议层。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| Rust 服务 | 是 | `src-tauri/src/services/sftp_service.rs`、新增 `sftp_runtime`/transfer manager | `npm run test:rust` |
| Tauri Command | 是 | `src-tauri/src/commands/sftp.rs`、`src-tauri/src/lib.rs` | command/API 测试 |
| IPC 模型 | 是 | `src-tauri/src/models/sftp.rs`、`src/lib/sftpApi.ts` | Rust serde 测试、Vitest |
| 前端页面 | 是 | `src/features/sftp/SftpToolContent.tsx` | `npm run test:frontend` |
| 设置 | 是 | `src-tauri/src/models/settings.rs`、`src/features/settings/settingsModel.ts`、`src/features/settings/SettingsToolContent.tsx` | 设置服务测试、Vitest |
| 依赖 | 是 | `src-tauri/Cargo.toml`、lockfile | `cargo test`、构建检查 |
| 跨平台 CI | 是 | `.github/workflows/native-sftp-cross-platform.yml` | Windows/macOS/Linux matrix |
| 文档/决策 | 是 | `.updeng/docs/decisions/ADR-0006-native-sftp-backend.md` | 文档检查 |

## 执行步骤

- [x] 调研 Rust/GitHub SFTP backend 方案并记录 ADR。
- [x] 建立最终版 SFTP runtime：`russh` SSH session、`bssh-russh-sftp` client、known_hosts、凭据解析。
- [x] 实现原生 list/preview/create/delete/rename/chmod/file transfer/recursive transfer。
- [x] 新增 transfer manager：任务 id、状态、全局并发、per-host 并发、进度快照、取消标记。
- [x] 扩展 Tauri Command：启动上传/下载任务、列出任务、取消任务；旧 command 继续走原生 backend。
- [x] 前端接入传输队列 UI：运行中、排队、成功、失败、取消、刷新。
- [x] 补充 Rust 行为测试：路径校验、严格 host key、显式信任、队列调度、进度累计、取消状态、兼容调用。
- [x] 补充真实协议 smoke：测试内启动 `russh` loopback SSH server 和 `bssh-russh-sftp` subsystem，覆盖未知 host key 拒绝、显式信任、密码认证、list、preview、mkdir、upload、rename、chmod、download、delete。
- [x] 补充前端测试：API invoke、队列渲染、失败/取消状态、按钮行为、host key 信任入口。
- [x] 补齐 SSH/SFTP 凭据录入链路：密码和私钥内容写入 OS keychain，SQLite 只保存 `credential:` 引用；私钥路径和既有凭据引用继续可用。
- [x] 接入 SFTP 性能设置：全局并发、单主机并发、pipeline 深度、packet bytes、timeout 可在设置页配置，并由 native backend 读取。
- [x] 补齐跨平台验证入口：GitHub Actions 在 Ubuntu、macOS、Windows 三个平台运行前端 typecheck/test/build 和 Rust fmt/clippy/test。
- [x] 运行 `npm run typecheck`、`npm run test:frontend`、`npm run check:rust`、`npm run build`。

## 验收标准

- 目录浏览和文件操作不启动系统 `sftp`/`ssh` 子进程。
- SSH host key 必须通过 `known_hosts` 或用户显式信任记录校验；默认不得接受未知 key。
- 同一 host 默认最多 2 个传输，全局默认最多 4 个传输，超过上限进入 queued；用户可在设置页调整并发和 SFTP pipeline 参数。
- 前端能看到每个传输任务的状态和字节进度，失败原因可见。
- 用户可以取消 queued/running 任务；running 任务在下一次读写循环检查到取消后停止并标记 canceled。
- 所有新增公开 IPC 类型都有 TS/Rust 双侧测试。
- 自动化测试全部通过；真实 SSH/SFTP 协议路径使用 in-process loopback server 锁定，远端环境差异保留为用户环境手工验收项。
- 跨平台默认验证不依赖本机人工操作：`native-sftp-cross-platform.yml` 在 Linux、macOS、Windows runner 上运行核心前端和 Rust 门禁。

## 风险

- `russh`/`bssh-russh-sftp` 生态比 OpenSSH/libssh2 新；当前已用 in-process 真实协议 smoke 覆盖核心协议路径，外部服务器兼容性仍建议按用户常用主机补充手工验收。
- OS keychain 行为存在平台差异；自动化测试使用内存 vault 覆盖语义，真实平台仍需要手工 smoke 验证保存/读取。
- SFTP 外部远端集成测试依赖用户环境，不纳入默认 CI；默认 CI 使用 fake backend 覆盖调度/取消，用 loopback `russh` server 覆盖真实 SSH/SFTP 协议和文件操作。

## 当前实现口径

- SFTP 文件管理不再启动系统 `sftp`/`ssh` 子进程；终端、端口转发和服务器信息采集仍按各自计划使用 OpenSSH。
- 普通 SFTP 连接默认使用 `HostKeyPolicy::RequireKnown`，未知或不匹配的 host key 会失败；用户必须通过 `sftp_trust_host_key` / 前端“信任主机密钥”动作显式写入 Kerminal `known_hosts`。
- 默认并发：全局同时运行 4 个传输任务，同一 host 同时运行 2 个传输任务；设置页允许全局 1-16、单主机 1-8，且单主机不会超过全局上限；超过上限保持 queued。
- 默认单文件 pipeline：`max_packet_len = 512 KiB`，`max_concurrent_writes = 64`，`request_timeout_secs = 30`；设置页允许 pipeline 1-256、packet bytes 32 KiB-4 MiB、timeout 5-300 秒。上传用 `write_all_pipelined`，下载用 `read_to_writer_pipelined`。
- 队列进度通过 `SftpTransferSummary` 暴露给前端，前端每 900ms 轮询并展示字节进度、状态、失败原因和取消入口。
- 远程主机认证支持 agent、私钥路径、既有 `credential:` 引用、密码 secret 和私钥内容 secret；新录入 secret 只写入 OS keychain，不进入 SQLite、主机树或浏览器预览状态。
- Rust 单测 `native_sftp_backend_uses_real_ssh_sftp_protocol` 会启动本地 loopback SSH/SFTP server，证明 native backend 的 host key、密码认证、目录、预览、传输和文件管理操作走真实协议栈。

## 验证记录

- 2026-06-18：`npm run typecheck` 通过。
- 2026-06-18：`npm run test:frontend` 通过，46 个测试文件 / 330 个测试。
- 2026-06-18：`npm run check:rust` 通过，包含 `cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings` 和 Rust 全量测试；`native_sftp_backend_uses_real_ssh_sftp_protocol` 通过。
- 2026-06-18：`npm run build` 通过，Vite 仅报告既有大 chunk 提示。
- 2026-06-18：`rg -n "Command::new\([^\)]*sftp|\bsftp\s+-|sftp.exe|ssh2|libssh2" src-tauri\src src .github\workflows` 无匹配，确认 SFTP 文件管理路径没有系统 `sftp` 子进程或 libssh2 依赖残留。


