---
id: PLAN-20260617-000026-sftp-tool-panel
status: done
created_at: 2026-06-17T00:00:26+08:00
started_at: 2026-06-17T00:00:26+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# SFTP 工具面板切片

## 目标

- 完成产品计划第 8 切片：右侧 SFTP 工具面板可基于已保存 SSH 主机配置浏览远程目录。
- Rust 侧新增独立 SFTP service/command/model，优先复用当前系统 OpenSSH 工具链，避免和第 7 切片形成两套认证路径。
- 前端新增 SFTP API 与中文文件浏览 UI，支持加载、刷新、上级目录、进入目录，并为后续上传/下载/删除/重命名留出明确动作入口。

## 非目标

- 本切片不实现凭据管理器、密码保存或私钥内容读取；SFTP 认证继续依赖系统 OpenSSH、agent、known_hosts 和用户已有 SSH 配置。
- 本切片不做拖拽上传、本地文件选择器和传输队列 UI；上传/下载后端 API 先接受明确本地路径参数，后续接入文件选择体验。
- 本切片不做生产主机危险文件操作的最终确认策略；删除/覆盖等高风险动作后续接入 Tool Registry / AI policy。

## 技术选择

- 首片采用系统 `sftp` / `sftp.exe` 执行受控 batch 命令，和当前 SSH terminal 的系统 OpenSSH 路线保持一致。
- Rust 不经 shell 字符串拼接，使用 `std::process::Command` 传参；batch 内容仅由服务端构造，并校验远程路径，避免把用户输入当作任意命令行执行。
- 输出解析先使用 `sftp ls -la` 文本协议，解析失败时保留原始名称/权限信息；后续如果需要更强文件属性语义，再评估 `openssh-sftp-client`、`ssh2` 或 `russh-sftp`。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| Rust SFTP 模型 | 是 | `models/sftp.rs` | Rust 单元测试 |
| Rust SFTP 服务 | 是 | `services/sftp_service.rs` | Rust 单元/集成测试 |
| Tauri Command | 是 | `commands/sftp.rs`、`lib.rs`、`state.rs` | Rust 编译、前端 API 测试 |
| 前端 API | 是 | `src/lib/sftpApi.ts` | Vitest |
| 右侧工具面板 | 是 | `ToolPanel.tsx` | ToolPanel/KerminalShell 测试 |
| 计划文档 | 是 | `.updeng/docs/plan/*` | 文档检查 |

## 执行步骤

- [x] 新增 SFTP 请求/响应模型，覆盖 list/delete/rename/mkdir/upload/download 的首批接口形状。
- [x] 新增 Rust `SftpService`：读取 host、定位 `sftp`、构造受控 batch 命令、解析目录列表。
- [x] 注册 `sftp_list_directory` 等 Tauri Commands，错误信息中文化。
- [x] 新增前端 `sftpApi.ts`，提供 Tauri 调用和浏览器预览数据。
- [x] 改造右侧 SFTP 工具面板：选中 SSH 主机后展示当前路径、刷新、上级、目录/文件列表和错误/加载状态。
- [x] 补充 Rust、API、ToolPanel 测试，确保左侧和右侧已有测试继续通过。
- [x] 运行 `npm run check` 和本地页面可达验证。

## 完成记录

- Rust 侧新增 `models/sftp.rs`、`services/sftp_service.rs`、`commands/sftp.rs`，并在 `AppState` 和 Tauri invoke handler 中注册。
- SFTP 列目录使用系统 OpenSSH `sftp -b -` 执行受控 batch，不经 shell 拼接；路径会拒绝换行/NUL，凭据引用不会进入命令参数。
- 前端新增 `src/lib/sftpApi.ts`；右侧 SFTP 面板跟随当前选中 SSH 主机加载目录，支持刷新、上级目录、点击目录进入和中文错误/空态。
- 自动化验证：`npm run check` 通过；前端 11 个测试文件、55 个用例通过；Rust fmt/clippy/test 通过。

## 验证

- `cargo test`
- `npm run test:frontend`
- `npm run check`
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:1420/`
- 搜索确认不引入历史占位品牌文案。

## 风险

- 用户主机可能没有 `sftp` 客户端；服务端必须返回清晰中文错误，前端需要显示错误态。
- `sftp ls -la` 输出在不同平台/服务器上可能存在差异；解析器必须对未知格式降级，不阻断列表展示。
- 密码认证在非交互 batch 模式下不可用；第一版更适合 agent/key/SSH config，密码凭据管理留给 credential store 切片。


