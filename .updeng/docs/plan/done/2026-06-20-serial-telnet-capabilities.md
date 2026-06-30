---
id: PLAN-20260620-003847-serial-telnet-capabilities
status: done
created_at: 2026-06-20T00:38:47+08:00
started_at: 2026-06-20T00:38:47+08:00
completed_at: 2026-06-20T01:15:29+08:00
updated_at: 2026-06-20T01:15:29+08:00
owner: ai
---

# Serial 和 Telnet 能力实现

## 目标

- 调研并实现 Kerminal 的 Serial 串口终端能力，复用现有 Tauri/React 终端与工作区模型。
- 实现 Telnet 主机创建、保存、打开到终端分屏的最小可用闭环。
- 补齐输入校验、端口/串口参数边界、主题继承与启动烟测相关验证。

## 非目标

- 不实现 Telnet 加密认证或 SSH 级凭据能力。
- 不重构远程主机整体存储模型，除非现有标签/类型表达无法支持本次闭环。
- 不实现 FTP、SMB、VNC 等其它连接类型。
- 不照搬外部截图里的空菜单；只保留已经有真实行为的菜单和分区。

## 影响范围

- React 主机创建弹窗、机器侧边栏、工作区 tab/pane 数据结构。
- 前端 Tauri API 类型封装与测试。
- Rust 远程主机模型、存储/service、终端会话启动和 Tauri command。
- 命令历史、日志和终端 session target 类型。

## 执行步骤

- [x] CodeGraph 调研连接类型、终端启动、主机树和工作区恢复链路。
- [x] 用 subagent 并行实现 Telnet 后端、Serial 后端和前端/测试边界。
- [x] 实现 Telnet 主机保存、打开和终端分屏链路。
- [x] 实现 Serial 主机保存、参数配置、打开和终端分屏链路。
- [x] 裁剪无真实行为的菜单：Telnet 仅保留属性；Serial 保留属性和串口参数。
- [x] 补齐前端和 Rust 边界测试。
- [x] 运行构建、测试和真实启动烟测。

## 实现记录

- Telnet 通过 `telnet_create_session` 启动系统 `telnet`/`telnet.exe`，拒绝非 `telnet` 标签主机和无效终端尺寸。
- Serial 通过 `serial_create_session` 启动外部串口客户端：Windows 使用 `plink -serial`，Unix 优先 `picocom`，再降级到 `screen`。
- Serial 配置使用主机标签保存：`serial-port`、`serial-baud`、`serial-data-bits`、`serial-stop-bits`、`serial-parity`、`serial-flow`。
- Telnet/Serial 使用独立 target kind，参与工作区恢复、分屏、命令历史目标、日志目标和机器侧边栏分类。
- Rust 共享 `RemoteTargetRef`/`TargetKind` 同步支持 Telnet/Serial，避免后端工具上下文反序列化时出现前后端 target 语义不一致。
- 远程主机服务允许 Telnet/Serial 使用空用户名，但仍保留名称、host、port 和标签规范化校验。

## 验证

- `npm run test -- --run src/lib/targetModel.test.ts src/lib/terminalApi.test.ts src/features/workspace/workspaceStore.test.ts src/features/machine-sidebar/MachineSidebar.test.tsx src/features/machine-sidebar/RemoteHostCreateDialog.test.tsx src/features/terminal/XtermPane.test.tsx`：通过，6 个文件 144 条测试。
- `npm run build`：通过，仅保留既有 Vite chunk size warning。
- `cd src-tauri && cargo check`：通过。
- `cd src-tauri && cargo test terminal_model --test terminal_model --no-run`：通过。
- `cd src-tauri && cargo test serial_terminal_service --lib --no-run`：通过。
- `cd src-tauri && cargo test telnet_terminal_service --lib --no-run`：通过。
- `cd src-tauri && cargo test telnet_and_serial_targets_are_terminal_only --lib --no-run`：通过。
- `cd src-tauri && cargo test create_serial_host_allows_empty_username_and_normalizes_tags --test remote_host_service --no-run`：通过。
- `cd src-tauri && cargo test create_telnet_host_allows_empty_username_and_normalizes_tags --test remote_host_service --no-run`：通过。
- `cd src-tauri && cargo test serial_terminal_service --lib`：测试二进制启动被当前 Windows 环境阻断，退出码 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`；非断言失败，已用 `--no-run` 和 `cargo check` 覆盖编译门禁。
- `npm run dev -- --host 127.0.0.1`：Vite 启动成功，`/` 和 `/src/bootstrap.tsx` HTTP 200。
- `npm run tauri:dev`：Vite、Cargo 和 `target\debug\kerminal.exe` 启动成功，追加 Rust target 模型补丁后已二次运行 smoke；观察无启动错误后停止。

## 风险

- Telnet 为明文协议，不能复用 SSH 密码保存口径。
- 系统 telnet/nc/plink 可用性跨平台不稳定，若采用外部命令需要明确降级。
- Serial 依赖外部串口客户端；Windows 需要 `plink` 在 PATH 中，Unix 需要 `picocom` 或 `screen`。
- Serial 串口名称继续走现有 host 字段校验，当前不支持包含空白字符的端口名。
