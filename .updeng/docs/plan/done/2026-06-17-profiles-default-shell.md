---
id: PLAN-20260617-000020-profiles-default-shell
status: done
created_at: 2026-06-17T00:00:20+08:00
started_at: 2026-06-17T00:00:20+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Profiles 与默认 shell 探测切片

## 目标

- 完成产品计划第 5 切片：建立本地终端 Profile 数据模型、SQLite 持久化、默认 shell 探测和 Tauri Command。
- 前端工作台可以展示 profile、选择 profile，并在新建本地终端 tab/pane 时使用选中的 shell/cwd/env/启动参数。
- 保持中文为主的用户界面，并让 profile 能力后续被设置页、命令面板、AI 工具和 workspace 恢复复用。

## 非目标

- 本切片不做完整设置页表单、profile 编辑弹窗、导入 Windows Terminal/iTerm 配置。
- 本切片不做 OS keychain、SSH profile 或远程主机 profile。
- 本切片不做启动命令的高级模板变量和 workflow 编排。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| SQLite schema | 是 | `src-tauri/src/storage/migrations.rs` | Rust 集成测试 |
| Rust 模型/服务 | 是 | `models/profile.rs`、`services/profile_service.rs`、`storage/sqlite.rs` | Rust 单元/集成测试 |
| Tauri Command | 是 | `commands/profile.rs`、`lib.rs` | Rust 编译、前端 API 测试 |
| 前端 API | 是 | `src/lib/profileApi.ts` | Vitest |
| 工作台 UI/state | 是 | `TerminalWorkspace`、`workspaceStore`、`KerminalShell` | Vitest、浏览器验证 |
| 左右功能 | 间接 | `MachineSidebar`、`ToolPanel` | 既有测试保持通过 |

## 执行步骤

- [x] 新增 profile/shell IPC 类型，覆盖 profile、创建/更新输入、shell 候选。
- [x] 新增 SQLite migration v2：`terminal_profiles` 表，包含 shell、args、cwd、env、默认标记和排序。
- [x] 实现 profile repository/service：默认 shell 探测、空库种子 profile、list/create/update/delete。
- [x] 注册 Tauri profile commands，并补 Rust 测试覆盖 seed、CRUD、默认唯一性和 shell 候选。
- [x] 新增前端 `profileApi`，浏览器预览模式提供中文 mock profile。
- [x] 改造 workspace store 和 terminal UI：选择 profile、新建 tab 使用 profile、显示当前 profile。
- [x] 补充前端 API、store、TerminalWorkspace/KerminalShell 测试，保持左右面板测试通过。
- [x] 运行 `npm run check`；本地页面 HTTP 200，当前会话未暴露 Browser 控制工具，未做截图级自动化验证。

## 验证

- `npm run test:frontend`
- `npm run check`
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:1420/` 返回 200。
- 历史占位品牌文案对源码和 `dist` 均无命中。
- 浏览器截图级验证：当前会话未暴露 Browser 控制工具；工作台顶部 profile 选择器、左侧主机栏、右侧工具栏由 Vitest 覆盖。

## 风险

- 跨平台 shell 探测容易写死 Windows 路径；探测逻辑必须允许 PATH 和常见绝对路径组合，并在无候选时回退到安全默认 shell。
- profile env/args 需要 JSON 存储，解析失败必须返回可诊断错误，不能 panic。
- 目前真实 xterm pane 创建 PTY 仍由前端请求触发，profile 切换不能导致已有终端重启或串 session。


