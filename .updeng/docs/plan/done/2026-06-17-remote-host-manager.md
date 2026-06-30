---
id: PLAN-20260617-000021-remote-host-manager
status: done
created_at: 2026-06-17T00:00:21+08:00
started_at: 2026-06-17T00:00:21+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 主机树和 SSH Host Manager 切片

## 目标

- 完成产品计划第 6 切片：建立远程主机分组、SSH 主机配置、SQLite 持久化和 Tauri Command。
- 前端左侧主机树从本地固定主机 + 远程主机数据组合而来，支持搜索、选择、空状态和中文界面。
- 右侧“主机”工具面板展示当前选中 SSH 主机的连接配置摘要，为后续 SSH 连接、SFTP、端口转发和 AI 工具调用复用。

## 非目标

- 本切片不建立真实 SSH 连接，不实现密钥管理、密码输入、跳板机、SFTP 或端口转发。
- 本切片不把密码、私钥内容或 API key 存入 SQLite；只保留未来 credential ref 字段。
- 本切片不做完整设置页弹窗和复杂表单校验体验，只完成 API、状态和基础管理入口。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| SQLite schema | 是 | `src-tauri/src/storage/migrations.rs` | Rust 集成测试 |
| Rust 模型/服务 | 是 | `models/remote_host.rs`、`services/remote_host_service.rs`、`storage/remote_hosts.rs` | Rust 单元/集成测试 |
| Tauri Command | 是 | `commands/remote_host.rs`、`lib.rs` | Rust 编译、前端 API 测试 |
| 前端 API | 是 | `src/lib/remoteHostApi.ts` | Vitest |
| 左侧主机树 | 是 | `MachineSidebar`、`workspaceStore`、`KerminalShell` | Vitest |
| 右侧工具面板 | 是 | `ToolPanel` | Vitest |
| 真实远程连接 | 否 | 第 7 切片 | 不验证 |

## 执行步骤

- [x] 新增远程主机/分组 IPC 类型，覆盖 group、host、创建/更新输入和 auth type。
- [x] 新增 SQLite migration v3：`remote_host_groups`、`remote_hosts` 表，包含分组、标签、生产标记、credential ref 和排序。
- [x] 实现 repository/service：分组 CRUD、主机 CRUD、默认分组初始化、删除保护和输入校验。
- [x] 注册 Tauri remote host commands，并补 Rust 测试覆盖 seed、CRUD、删除非空分组拒绝、主机更新。
- [x] 新增前端 `remoteHostApi`，浏览器预览模式提供中文 mock 主机树。
- [x] 改造 workspace store 和 KerminalShell：加载远程主机树，左侧主机树动态展示，本地主机仍保留。
- [x] 改造右侧主机工具面板：展示选中 SSH 主机配置、标签、生产标记和后续连接入口状态。
- [x] 补充前端 API、store、MachineSidebar/KerminalShell/ToolPanel 测试，保持左右功能测试通过。
- [x] 运行 `npm run check`，并做本地页面可达验证。

## 验证

- `npm run test:frontend`
- `npm run check`
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:1420/` 返回 200；已启动 `npm run dev` 后台进程用于本地预览。
- 历史占位品牌文案搜索无命中。

## 风险

- 这是 SSH 的数据基础，不应提前存储真实秘密；密码、passphrase、私钥内容只能进入后续 credential store。
- 删除分组如果误删主机会破坏用户资产；本切片默认拒绝删除非空分组。
- 前端左侧树要兼容空远程主机库，不能因为数据库为空导致应用主界面不可用。


