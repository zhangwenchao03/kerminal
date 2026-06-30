---
id: PLAN-20260617-000019-port-forwarding
status: done
created_at: 2026-06-17T00:00:19+08:00
started_at: 2026-06-17T00:00:19+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 端口转发切片

## 目标

- 完成产品计划第 9 切片：基于已保存 SSH 主机配置创建、停止、查看 local / remote / dynamic 端口转发。
- Rust 侧新增独立 port forwarding model/service/command，使用系统 OpenSSH `ssh` 受控子进程承载端口转发。
- 前端新增端口转发 API 与右侧“端口”工具面板，选中 SSH 主机后可配置转发类型、端口和目标，并查看/停止运行中的转发。

## 非目标

- 本切片不做端口占用预探测、生产主机高风险确认策略、持久化端口转发配置或自动重连。
- 本切片不保存 SSH 密码或私钥内容；认证继续依赖系统 OpenSSH、agent、known_hosts 和用户已有 SSH 配置。
- 本切片不做外部访问安全策略的最终 UI；默认 bind host 采用 `127.0.0.1`，用户显式填写时才改变。

## 技术选择

- 使用系统 OpenSSH `ssh -N -T -L/-R/-D`，和 SSH terminal / SFTP 的系统 OpenSSH 路线保持一致。
- 使用 Rust `std::process::Command` 参数数组启动，不经 shell 拼接；Windows 使用 `CREATE_NO_WINDOW` 防止打包后弹出黑窗口。
- `PortForwardService` 在内存中管理子进程生命周期，提供 create/list/close；后续可把常用转发配置持久化到 SQLite。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| Rust 端口转发模型 | 是 | `models/port_forward.rs` | Rust 单元测试 |
| Rust 端口转发服务 | 是 | `services/port_forward_service.rs` | Rust 单元/集成测试 |
| 子进程启动规范 | 是 | `services/process_command.rs`、`sftp_service.rs` | Rust fmt/clippy/test |
| Tauri Command | 是 | `commands/port_forward.rs`、`lib.rs`、`state.rs` | Rust 编译、前端 API 测试 |
| 前端 API | 是 | `src/lib/portForwardApi.ts` | Vitest |
| 右侧工具面板 | 是 | `ToolPanel.tsx`、`workspaceData.ts` | ToolPanel/KerminalShell 测试 |
| 计划文档 | 是 | `.updeng/docs/plan/*` | 文档检查 |

## 执行步骤

- [x] 新增端口转发请求、摘要和状态模型，覆盖 local/remote/dynamic 三种类型。
- [x] 新增 `PortForwardService`：读取 host、构造受控 OpenSSH 参数、启动并管理子进程、停止转发。
- [x] 新增 `process_command` helper，让 Windows std::process::Command 不弹黑窗口，并复用到 SFTP。
- [x] 注册 `port_forward_create/list/close` Tauri Commands。
- [x] 新增前端 `portForwardApi.ts`，提供 Tauri 调用和浏览器预览 session。
- [x] 右侧新增“端口”工具面板：选中 SSH 主机后可创建 local/remote/dynamic 转发、查看当前转发、停止转发。
- [x] 补充 Rust、API、ToolPanel 测试，保持左侧和右侧功能测试通过。
- [x] 运行 `npm run check` 和本地页面可达验证。

## 完成记录

- Rust 侧新增 `models/port_forward.rs`、`services/port_forward_service.rs`、`commands/port_forward.rs`，并注册到 `AppState` 与 Tauri invoke handler。
- 端口转发使用系统 OpenSSH `ssh -N -T -L/-R/-D`，参数数组启动，不经 shell 拼接；凭据引用不会进入命令参数。
- 新增 `services/process_command.rs`，统一为 Windows GUI 进程设置 `CREATE_NO_WINDOW`，并复用到 SFTP 子进程。
- 前端新增 `src/lib/portForwardApi.ts` 与 `PortForwardToolContent`，右侧新增“端口”工具，支持 local / remote / dynamic 三类转发的创建、刷新、查看和停止。
- 自动化验证：`npm run check` 通过；前端 12 个测试文件、59 个用例通过；Rust fmt/clippy/test 通过。

## 验证

- `cargo test`
- `npm run test:frontend`
- `npm run check`
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:1420/`
- 搜索确认不引入历史占位品牌文案。

## 风险

- 当前主机可能没有 OpenSSH `ssh`；服务端必须返回清晰中文错误。
- 真实端口转发依赖网络和远程服务器策略；自动化测试只验证命令构造、生命周期管理和 UI 调用路径。
- 远程转发 `-R` 是否允许监听由服务器 `sshd_config` 决定；失败时通过 OpenSSH 错误反馈给用户。


