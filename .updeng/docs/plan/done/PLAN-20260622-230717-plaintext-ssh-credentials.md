---
id: PLAN-20260622-230717-plaintext-ssh-credentials
status: done
created_at: 2026-06-22T23:07:17+08:00
started_at: 2026-06-22T23:07:17+08:00
completed_at: 2026-06-23T09:36:00+08:00
updated_at: 2026-06-23T09:36:00+08:00
owner: ai
---

# SSH 凭据明文保存与展示

## 目标
- 远程主机的 SSH 密码和内联私钥直接保存在远程主机记录中，编辑已有主机时可以看到原值。
- SFTP、远程文件浏览和传输复用同一份远程主机明文认证信息，不再依赖单独凭据仓库引用。
- AI 创建或复用远程主机时，如果提供了密码或私钥，保存后的主机记录也保留明文字段。
- 移除与 SSH 主机旧安全保存口径、旧凭据引用相关的用户可见描述和主流程依赖。

## 非目标
- 不改变 AI 工具审批、命令风险识别、SFTP 删除确认、生产主机标记等非凭据安全控制。
- 不把真实密码、私钥、token 或 API key 写入计划、日志、文档示例或最终回复。
- 不做全项目安全策略重构，不清理与 SSH 主机无关的 LLM provider API key 管理。

## 影响范围
- Rust 远程主机模型、SQLite 存储、SSH 命令/终端/SFTP 认证解析。
- AI remote host facade / create 工具的请求和 observation。
- 前端远程主机创建/编辑弹窗、类型定义和测试。
- README 或 UI 中关于 SSH 主机凭据保存方式的描述。

## 执行步骤
- [x] 梳理 `RemoteHost` / `credentialRef` / `credentialSecret` / 旧凭据服务调用链。
- [x] 改后端模型和存储，让 SSH 密码/内联私钥按明文随 host 返回和持久化。
- [x] 改 SSH/SFTP/命令认证解析，优先使用 host 明文凭据，拒绝旧 SSH `credential:` 引用。
- [x] 改前端表单和 AI remote host 工具，编辑与创建后可见明文字段。
- [x] 删除或改写旧安全保存口径的用户可见描述和测试断言。

## 验证
- `cargo test --manifest-path src-tauri/Cargo.toml remote_host`
- `cargo test --manifest-path src-tauri/Cargo.toml ssh_command`
- `npm run test -- --run src/features/machine-sidebar/RemoteHostCreateDialog.test.tsx src/lib/remoteHostApi.test.ts`
- `npm run build`
- 真实 dev server 启动冒烟；涉及 Tauri/Rust 连接链路后尝试 `npm run tauri:dev`，若端口或环境阻断则记录原因。

## 风险
- 这是明确降低本地凭据保护的变更：本机数据库、前端状态和 AI 工具上下文会包含 SSH 密码或私钥明文。
- 旧数据中已有 SSH `credential:` 引用不做兼容读取；创建、更新和连接解析都会提示改存明文密码、明文私钥或普通私钥路径。
- 工作区已有大量未提交改动，本轮只修改凭据明文化相关文件，避免混入其它 lane。

## Round Log
- 2026-06-22T23:07:17+08:00：登记计划和 lane。用户明确要求本地个人使用场景下 SSH/SFTP 密码/私钥明文保存与展示，并去除凭据仓库主流程。
- 2026-06-23T00:58:50+08:00：恢复上下文并核验当前实现。已确认后端主机校验、SSH 终端、native SSH 命令、SFTP 和端口转发连接解析都改为读取 `RemoteHost.credential_secret`，旧 SSH `credential:` 引用按用户要求拒绝而不是兼容；同时修复浏览器预览创建主机时丢弃 `credentialSecret` 的前端残留。计划旧口径已从“兼容旧引用”改为“拒绝旧 SSH credential 引用”。
- 2026-06-23T09:36:00+08:00：清理 SFTP、Docker/container 和 command suggestion 远端刷新链路里的旧凭据服务透传参数；这些路径统一通过保存的远程主机明文认证信息连接，不再保留 SSH/SFTP 旧凭据服务兼容代码。保留 LLM provider API key 的独立密钥管理用途。验证通过：`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml --jobs 1 remote_host`、`ssh_command`、`sftp`、`port_forward`、`docker`、`command_suggestion`、`cargo test --manifest-path src-tauri/Cargo.toml --jobs 1 --test tool_registry_service`、`cargo test --manifest-path src-tauri/Cargo.toml --jobs 1 tool_registry_contract_fixture`、前端定向 Vitest、`npm run build`、Vite dev server HTTP 200 与 CDP 截图、`npm run tauri:dev` 二次启动保持运行并返回 HTTP 200。首次并发 Rust 测试曾触发 Windows 页面文件不足/目标文件占用，改为 `--jobs 1` 后通过；首次 `tauri:dev` 退出 `0xffffffff`，加 `RUST_BACKTRACE=1` 复跑后正常保持运行，最终手动停止本轮进程。
