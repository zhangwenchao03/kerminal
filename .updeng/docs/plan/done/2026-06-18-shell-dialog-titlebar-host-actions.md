---
id: PLAN-20260618-000033-shell-dialog-titlebar-host-actions
status: done
created_at: 2026-06-18T00:00:33+08:00
started_at: 2026-06-18T00:00:33+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 工作台设置弹窗、自绘标题栏与主机新增入口

## 目标

- 点击左下角“设置”时打开独立弹窗，不再把设置内容塞进右侧工具面板。
- 隐藏 Tauri 原生标题栏，使用随深浅色主题变化的 Kerminal 自绘标题栏，保留最小化、最大化、关闭和窗口拖动能力。
- 明确左下角“新建分组”和“新建 SSH 主机”按钮的用户意图，并接入可用表单。
- 新建 SSH 主机表单优先覆盖当前容易实现且真实可用的字段：分组、名称、主机、端口、用户名、认证方式、凭据引用、标签和生产保护。

## 非目标

- 本切片不实现 RDP/Telnet/FTP/S3/SMB/VNC/WebDAV 等协议连接。
- 本切片不伪造“测试连接”；真实连接验证后续应复用 SSH 连接/诊断能力实现。
- 本切片不重写右侧所有工具内容视觉，只修正当前反馈的导航、弹窗和入口问题。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 前端壳层 | 是 | `src/app/KerminalShell.tsx`、新增标题栏/弹窗组件 | Vitest、桌面 smoke |
| 左侧侧栏 | 是 | `src/features/machine-sidebar/MachineSidebar.tsx` | Vitest |
| 设置 UI | 是 | `src/features/settings/*` | Vitest |
| 主机配置 UI | 是 | 新增 SSH 主机/分组弹窗 | Vitest |
| Tauri 窗口配置 | 是 | `src-tauri/tauri.conf.json` | Rust 配置测试、桌面 smoke |
| 权限安全 | 是 | `src-tauri/capabilities/default.json`、安全测试 | Rust 测试 |

## 执行步骤

- [x] 梳理现有设置、工具面板、侧栏和远程主机 API 调用关系。
- [x] 新增通用弹窗框架，并把设置内容迁移到设置弹窗。
- [x] 新增自绘标题栏，调整工作台主布局，Tauri 配置改为无原生 decorations。
- [x] 为左下角分组/主机按钮接入弹窗和真实 create API，并改善可访问标签/提示。
- [x] 补充前端组件测试和 Tauri 配置安全测试。
- [x] 运行聚焦测试、`npm run check`，并按桌面端启动做 smoke。

## 验证

- `npm run test:frontend -- KerminalShell MachineSidebar SettingsDialog RemoteHostCreateDialog RemoteHostGroupCreateDialog AppTitleBar ToolPanel`：7 个测试文件、35 个测试通过。
- `npm run check`：前端 40 个测试文件、267 个测试通过；Rust fmt/clippy/test 通过；生产构建通过。
- 桌面端 smoke：复用 `http://127.0.0.1:1425/`，通过 `.updeng/data/tauri-dev-no-before-command.json` 启动 `kerminal.exe`，窗口标题为 `Kerminal`，非白屏，自绘标题栏可见；截图记录在 `.updeng/data/desktop-smoke-kerminal.png`。

## 风险

- 无边框窗口会改变系统级窗口交互；必须确认拖动、最小化、最大化和关闭仍可用。
- 右侧工具面板不再显示设置后，原生菜单、终端右键菜单和 AI 打开设置路径必须统一到弹窗。
- 新建主机表单只保存配置，不测试连接，避免给用户“已连通”的错误暗示。

## 当前状态

- 代码实现、自动化验证和桌面 smoke 已完成。
- 真实 SSH 连接仍依赖已保存主机配置和系统 OpenSSH；新建表单不做连接测试。


