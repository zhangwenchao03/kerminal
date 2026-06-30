---
id: PLAN-20260625-235439-tauri-desktop-plugin-hardening
status: done
created_at: 2026-06-25T23:54:39+08:00
started_at: 2026-06-26T00:00:30+08:00
completed_at: 2026-06-26T10:05:59+08:00
updated_at: 2026-06-26T10:12:55+08:00
owner: ai
---

# Tauri 桌面插件生产级接入方案

## 需求来源

用户要求把 `window-state`、`single-instance`、`notification`、`log` 都纳入 Kerminal，并明确后续功能开发不能只考虑 Windows，必须同时面向 macOS 和 Windows 设计、实现和验证。

## 目标

- 在 Kerminal 中生产级接入 4 个 Tauri v2 官方插件：
  - `tauri-plugin-window-state`
  - `tauri-plugin-single-instance`
  - `tauri-plugin-notification`
  - `tauri-plugin-log`
- 形成统一的桌面插件接入层，避免把系统通知、日志和窗口生命周期逻辑散落在业务组件中。
- 保持当前安全边界：不借本轮引入 `fs:`、`shell:`、`http:` 等高风险前端权限，不扩大 Kerminal MCP 的 host 审批边界。
- 建立 Windows 与 macOS 双平台验收矩阵。后续实现任务不能只用 Windows green 作为完成依据；macOS 至少需要完成构建、启动、窗口恢复、单实例、通知权限、日志路径和关闭到托盘/退出行为验证。

## 非目标

- 不在本轮引入 `deep-link`、`global-shortcut`、`autostart`、`fs`、`shell`、`http`、`store`、`sql` 或 `stronghold`。
- 不把系统通知当成普通 toast 替代品；短操作反馈仍留在前端 UI。
- 不把终端输出、SSH 密码、私钥、远程文件内容或 MCP tool 参数原样写入日志。
- 不改变 Kerminal MCP Server 的审批职责；外部 agent host 仍负责工具确认、审批、hook 和审计。
- 不把 macOS 适配推迟到发布前补测；跨平台行为要在实现切片内同步设计。

## 当前事实

| 项 | 当前状态 | 证据 |
| --- | --- | --- |
| 已有插件 | `dialog`、`opener`、`process`、`updater` | `src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`package.json` |
| Tauri core feature | `protocol-asset`、`tray-icon` | `src-tauri/Cargo.toml` |
| capability | `dialog:default`、GitHub 限域 opener、`process:default`、`updater:default`、窗口控制 | `src-tauri/capabilities/default.json` |
| 安全测试 | 明确禁止默认 capability 混入 `fs:`、`shell:`、`http:` 前缀 | `src-tauri/tests/tauri_security_config.rs` |
| 窗口配置 | 无边框、透明、最小尺寸 1180x720、OS 文件拖入启用 | `src-tauri/tauri.conf.json` |
| 托盘/关闭行为 | 关闭主窗口会隐藏到系统托盘，托盘菜单负责显示/隐藏/退出 | `src-tauri/src/app_tray.rs` |
| AppState 初始化 | 会打开运行态文件/SQLite、生成默认 agent/settings/profile 文件、清理临时 identity 文件 | `src-tauri/src/state.rs` |

## 版本与资料

2026-06-25 校验结果：

| 插件 | Cargo crate | Cargo 最新版本 | npm 包 | npm 最新版本 | 说明 |
| --- | --- | --- | --- | --- | --- |
| Window State | `tauri-plugin-window-state` | `2.4.1` | `@tauri-apps/plugin-window-state` | `2.4.1` | 保存和恢复窗口位置、大小、最大化等状态 |
| Single Instance | `tauri-plugin-single-instance` | `2.4.2` | 无 | 无 | Rust-only；无前端 JS API；应尽早注册 |
| Notification | `tauri-plugin-notification` | `2.3.3` | `@tauri-apps/plugin-notification` | `2.3.3` | 桌面/移动通知；本方案只覆盖 Windows/macOS 桌面 |
| Log | `tauri-plugin-log` | `2.8.0` | `@tauri-apps/plugin-log` | `2.8.0` | 统一 Rust/WebView 日志输出与文件落盘 |

官方参考：

- https://v2.tauri.app/plugin/window-state/
- https://v2.tauri.app/plugin/single-instance/
- https://v2.tauri.app/plugin/notification/
- https://v2.tauri.app/plugin/logging/
- https://v2.tauri.app/learn/security/using-plugin-permissions/

## 总体设计

### 分层

| 层 | 责任 | 推荐文件 |
| --- | --- | --- |
| 插件注册层 | 统一注册桌面插件、封装注册顺序和 platform cfg | `src-tauri/src/desktop_plugins.rs` 或保留在 `lib.rs` 的小函数 |
| 窗口生命周期层 | 单实例回调、主窗口聚焦、窗口状态恢复、托盘 close-to-tray 协同 | `src-tauri/src/app_tray.rs` + 新增窄 helper |
| 通知策略层 | 权限检查、用户设置、去重节流、按事件类型决定是否发系统通知 | `src/lib/desktopNotificationApi.ts`、`src/features/settings/*`、必要 Rust command |
| 日志策略层 | Rust/WebView 分类日志、脱敏、日志级别、日志文件路径、诊断包集成 | `src-tauri/src/security/redaction.rs`、`src/lib/appLog.ts`、`src/features/logs/*` |
| 验证层 | 依赖/注册/capability 安全测试、Windows/macOS smoke、真实启动截图/记录 | `src-tauri/tests/tauri_security_config.rs`、脚本或人工计划 Round Log |

### 插件注册顺序

生产实现必须先用小范围测试锁定注册顺序。推荐顺序：

1. `single-instance`：尽早拦截第二实例，第二实例只请求主实例显示/聚焦，不启动第二套 live runtime。
2. `log`：尽早安装日志，捕获后续 setup/plugin/runtime 错误。
3. `window-state`：安装窗口状态恢复，必须保留 `minWidth` / `minHeight` 约束。
4. `notification`：安装系统通知能力。
5. 现有 `dialog`、桌面端 `opener`、`process`、`updater`。
6. `manage(app_state)` 与 `setup(...)`。

关键注意：当前 `AppState::initialize()` 在插件注册前执行，且会打开存储和写默认文件。实现 `single-instance` 时必须验证第二实例是否会执行这些副作用。如果会，就要拆出 `build_desktop_plugins()` 和 AppState 初始化顺序，或把 live server/端口类副作用延迟到单实例通过后的 setup 路径。不能只以“没有第二个窗口”为验收。

### 权限策略

| 插件 | capability 预期 | 说明 |
| --- | --- | --- |
| `single-instance` | 无前端权限 | Rust-only，不添加 npm 包，不添加 capability |
| `window-state` | 默认不开放前端权限 | 首期用 Rust 自动恢复；若后续前端手动 save/restore，再单独评估权限 |
| `notification` | `notification:default` 或更细权限 | 需要用户设置与权限请求策略，不能在启动时主动弹权限 |
| `log` | 仅在需要 WebView JS 记录时添加 `log:default` | 若前端用 JS API 记录日志，必须统一走脱敏 wrapper |

`tauri_security_config.rs` 要同步更新为白名单式断言：允许本轮新增的 `notification:` / `log:` 权限，同时继续禁止 `fs:`、`shell:`、`http:`。如果实现发现 `window-state` 需要 capability，必须在测试里写清为什么需要，并限制到主窗口。

## 业务行为设计

### Single Instance

用户可见行为：

- 双击第二次启动 Kerminal 时，不打开第二个窗口。
- 如果主窗口隐藏到托盘或最小化，第二次启动会显示、取消最小化并聚焦主窗口。
- 如果主窗口已经打开，第二次启动只聚焦，不重建工作区、不重连终端、不重启 MCP Server、不重复打开默认 profile。

生产要求：

- 单实例回调中只处理显示/聚焦和安全日志，不执行远程连接、终端写入或配置写入。
- 回调参数只记录脱敏摘要，不记录完整路径、命令行参数或 URL。
- Windows 与 macOS 都要验证：
  - 正常打开一次；
  - 最小化后再次启动；
  - 隐藏到托盘后再次启动；
  - 已有终端 session 时再次启动不会导致重连或 duplicate pane。

### Window State

用户可见行为：

- Kerminal 关闭并重新打开后恢复上次主窗口位置、大小和最大化状态。
- 不恢复到屏幕外；显示器变化后必须回落到可见区域。
- 不突破 `minWidth: 1180`、`minHeight: 720`。
- 与当前无边框、透明窗口和自绘标题栏兼容。

生产要求：

- 优先使用插件默认状态文件，不引入项目自定义 store。
- 如插件支持 flags，首期只保存 `position`、`size`、`maximized`，不保存 fullscreen，避免误把全屏远程操作恢复成启动默认。
- 多显示器、缩放变化、主显示器切换都要 smoke。
- 与 close-to-tray 协同：隐藏到托盘不应被当成应用退出后的异常状态；退出菜单才作为最终状态保存口径。

### Notification

用户可见行为：

- 设置页新增桌面通知开关，默认不在启动时弹 OS 权限。
- 用户启用通知或第一次触发“重要后台事件”时再请求权限。
- 仅在应用后台、最小化、隐藏到托盘，或任务耗时超过阈值时发送系统通知。
- 应用前台短操作继续用 UI 状态/toast，不发系统通知。

首期事件建议：

| 事件 | 是否通知 | 条件 | 文案原则 |
| --- | --- | --- | --- |
| SFTP 批量传输完成 | 是 | 应用后台或任务超过 10 秒 | 只写数量和结果，不写完整路径 |
| SFTP 传输失败 | 是 | 总是可通知，但节流 | 写失败数量和入口，不写凭据/路径细节 |
| Agent Launcher 进程结束 | 是 | 应用后台，且运行时间超过 10 秒 | 写 agent 名称和退出状态，不写 prompt |
| updater 可安装 | 是 | 检查到更新且用户开启通知 | 写版本号 |
| MCP Server 启动失败 | 是 | 用户开启 MCP 且失败 | 写本机端口摘要，不写 token |
| 普通按钮保存成功 | 否 | 前台 UI 即可 | 使用页面内反馈 |

通知策略模型：

- 新增纯函数 `shouldSendDesktopNotification(event, appVisibility, settings, now)`，覆盖权限、节流、前后台、事件等级。
- 新增 adapter `desktopNotificationTransport`，封装 Tauri JS API；浏览器预览环境为 no-op。
- 文案统一通过 `buildDesktopNotificationPayload(event)`，保证脱敏。
- macOS：记录权限 denied/default/granted 状态，用户拒绝后不重复打扰；设置页给出系统设置提示。
- Windows：验证 dev 与安装包环境行为，避免调试环境误判为生产失败。

### Log

目标：

- Rust 和 WebView 都能写入统一结构的应用日志，便于诊断启动、插件、窗口、通知、MCP、SFTP 和 Agent Launcher 问题。
- 日志必须先脱敏再落盘。
- 日志文件要能被现有诊断包或日志面板定位，但不能把敏感内容默认暴露给外部 agent。

日志分类建议：

| 分类 | 示例 | 允许内容 | 禁止内容 |
| --- | --- | --- | --- |
| `desktop.lifecycle` | 启动、退出、单实例、窗口恢复 | 状态、耗时、错误码 | 完整命令行、完整本地路径 |
| `desktop.notification` | 权限、发送、节流 | 事件类型、结果 | 通知 body 中的敏感路径 |
| `desktop.window` | restore/save/fallback | 窗口尺寸、屏幕摘要 | 用户目录 |
| `mcp.runtime` | server start/stop/error | 端口、状态、脱敏错误 | token、tool 参数原文 |
| `sftp.transfer` | 传输 batch summary | 数量、大小、状态 | 远端凭据、完整私有路径 |
| `agent.launcher` | 进程启动/结束 | agent 类型、退出码 | prompt、secret、完整环境变量 |

实现要求：

- Rust 侧优先接 `tracing` 或 `log` facade，配置 `tauri-plugin-log` target 为 stdout + log dir。
- 前端只通过 `src/lib/appLog.ts` 写日志，禁止组件直接 import `@tauri-apps/plugin-log`。
- `appLog` 默认只允许 info/warn/error，不开放 debug unless dev 或用户显式启用诊断模式。
- 所有错误写入前经过 `redactSensitiveText` 或同等前端脱敏。
- 日志保留策略：默认限制单文件大小和保留数量；如插件能力不足，首期写入计划中登记后续轮转实现，不放任无限增长。

## 跨平台设计要求

| 主题 | Windows | macOS | 验收要求 |
| --- | --- | --- | --- |
| 单实例 | 第二次启动聚焦已有窗口；托盘隐藏后可拉起 | 第二次启动聚焦已有窗口；Dock/菜单行为不破坏 | 两平台都 smoke；不能只用 Windows 通过 |
| 窗口状态 | 多显示器、缩放、任务栏区域不越界 | 多显示器、Retina 缩放、菜单栏/Dock 区域不越界 | 关闭重开恢复；拔掉副屏回落可见 |
| 托盘/关闭 | 关闭隐藏到 tray，托盘退出才退出 | macOS 关闭窗口通常不等于退出；需确认 tray/menu/Dock 体验 | 行为写入验收记录 |
| 通知权限 | Windows 通知中心/安装包 app identity | macOS 首次权限弹窗、用户拒绝后不重复请求 | denied/granted 都要测 |
| 日志路径 | `%LOCALAPPDATA%`/Tauri app log dir | `~/Library/Logs` 或 Tauri app log dir | 记录真实路径类型，不写用户私有路径到文档 |
| 打包 | NSIS passive updater 不回退 | `.app` / `.dmg` 构建不破坏通知/日志 | 至少构建当前平台；macOS 需独立验收 |

平台门禁：

- 任何涉及此计划的实现 PR/提交，不能只写“Windows 已验证”就关闭任务。
- 如果当前机器无法跑 macOS，Round Log 必须把 macOS 验证标为缺口，并保留计划为未完成或 blocked，不能宣布生产级完成。
- Windows/macOS 差异不能用 `#[cfg(windows)]` 临时绕过；需要 `#[cfg(target_os = "macos")]` 的对等设计或明确非适用理由。

### 原生能力跨平台开发规则

适用于本计划和后续所有桌面原生能力，包括剪切板、通知、窗口、日志、文件对话框、系统托盘、进程重启、更新、快捷键和未来可能加入的系统集成。

- 新增或修改原生能力前，先判断是否存在官方 Tauri v2 插件或 `@tauri-apps/api` 的跨平台 API；能用稳定跨平台 API 时优先使用，不直接写 Windows-only crate 或 macOS-only binding。
- 必须有显式平台矩阵：`windows`、`macos`、`linux/other` 三列中至少说明支持、降级或非目标；Windows/macOS 不能只写其中一个。
- 平台差异必须通过窄 adapter/facade 隔离：业务代码调用 `ClipboardAdapter`、`DesktopNotificationTransport`、`WindowLifecycleAdapter` 这类项目 API，不直接散落 `#[cfg(windows)]`、`clipboard-win`、Cocoa/AppKit 或 plugin import。
- 如果某能力暂时只能 Windows 实现，必须在计划或 blocker 中写明 macOS 行为、用户可见降级和关闭条件；不能把 Windows green 当成完成。
- 剪切板专项要求：终端复制/粘贴、SFTP 路径复制、远程文本编辑和右键菜单粘贴必须在 Windows 与 macOS 都有同等行为；若底层继续使用 `clipboard-win`，必须补 macOS 对等实现或改走 Tauri clipboard 插件/API，并用两平台 smoke 关闭。
- 自动化验证至少覆盖 adapter 的纯模型/错误处理；真实系统交互必须在 Windows 和 macOS Round Log 中记录命令、场景和结果。当前机器无法运行 macOS 时，只能记录 macOS 缺口，计划不得 done。

## 实施切片

### TASK-001 依赖和插件注册骨架

- [x] 添加 Cargo 依赖：
  - `tauri-plugin-window-state`
  - `tauri-plugin-single-instance`
  - `tauri-plugin-notification`
  - `tauri-plugin-log`
- [x] 添加 npm 依赖：
  - `@tauri-apps/plugin-window-state`（仅在需要前端手动 API 时保留）
  - `@tauri-apps/plugin-notification`
  - `@tauri-apps/plugin-log`
  - 不添加 `@tauri-apps/plugin-single-instance`
- [x] 抽出桌面插件注册 helper，锁定注册顺序。
- [x] 更新 `tauri_security_config.rs`，断言依赖、注册顺序和 capability 白名单。

验证：

- `cd src-tauri && cargo test --test tauri_security_config`
- `npm run build`

### TASK-002 单实例生命周期

- 实现第二实例显示/取消最小化/聚焦主窗口。
- 记录脱敏生命周期日志。
- 验证第二实例不会重复创建终端 pane、MCP server、端口转发或 workspace session。
- 如发现 AppState 初始化在第二实例有副作用，先重构初始化顺序或 live server 启动时机。

验证：

- Rust helper 单测。
- Windows `npm run tauri:dev` 手动启动两次。
- macOS `npm run tauri:dev` 手动启动两次。

### TASK-003 窗口状态恢复

- 接入 `window-state`，保留主窗口最小尺寸和可见区域回退。
- 验证 close-to-tray、托盘退出、重启恢复的状态边界。
- 如状态文件损坏，应用必须可启动并回落默认尺寸。

验证：

- Windows：调整尺寸/位置/最大化后退出重开。
- macOS：Retina 缩放、多显示器或模拟显示器变化后退出重开。
- `npm run tauri:dev` 启动冒烟。

### TASK-004 通知策略和设置

- 新增设置项：桌面通知开关、重要事件通知范围。
- 新增通知 policy/model 单测，覆盖前台、后台、权限拒绝、节流和敏感文案。
- 接入 SFTP batch、Agent Launcher、updater、MCP server 失败等首期事件中的最小可验证子集。
- 浏览器预览环境保持 no-op，不影响 Vitest。

验证：

- `npm run test:frontend -- <notification policy tests>`
- Windows/macOS 权限 granted 和 denied 人工 smoke。
- 三主题设置页验证（浅色、深色、跟随系统）。

### TASK-005 日志策略和诊断集成

- 配置 `tauri-plugin-log` 输出目标、级别和格式。
- 新增前端 `appLog` wrapper，禁止组件直接调用插件 API。
- 与现有脱敏逻辑和日志工具页/诊断包衔接。
- 添加负向测试：secret、token、密码、私钥、完整命令参数不进入日志。

验证：

- Rust redaction/log config 单测。
- 前端 appLog 单测。
- Windows/macOS 启动后确认日志文件生成且内容脱敏。

### TASK-006 跨平台启动和打包门禁

- Windows：
  - `npm run build`
  - `npm run tauri:dev`
  - `npm run tauri:build` 或记录打包阻塞原因
- macOS：
  - `npm run build`
  - `npm run tauri:dev`
  - `npm run tauri:build` 或记录签名/环境阻塞原因
- 两平台都要记录截图或人工验收日志：窗口恢复、单实例、通知权限、日志文件、关闭/退出。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| Tauri 插件 | 是 | `src-tauri/Cargo.toml`、`src-tauri/src/lib.rs` | cargo test、tauri dev/build |
| 前端依赖 | 是 | `package.json`、`package-lock.json` | npm install/build |
| Capabilities | 是 | `src-tauri/capabilities/default.json` | `tauri_security_config.rs` |
| 窗口/托盘 | 是 | `src-tauri/src/app_tray.rs`、`src-tauri/tauri.conf.json` | Windows/macOS smoke |
| 设置 UI | 是 | `src/features/settings/*` | Vitest、三主题截图 |
| SFTP/Agent/updater/MCP 事件 | 是 | 对应 service/API 层 | 聚焦单测 + 手动后台通知 |
| 日志/诊断 | 是 | `src-tauri/src/security/redaction.rs`、`src/features/logs/*` | 脱敏测试、日志文件检查 |
| 数据库 | 否 | 不新增 schema | 不适用 |
| 远程主机 | 否 | 不改变 SSH/SFTP 协议 | 不适用 |

## 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 第二实例仍触发 AppState 副作用 | 双开时写文件、抢端口或清理临时文件 | 先验证初始化顺序；必要时重构 live 副作用到主实例 setup |
| 通知打扰用户 | 降低可用性 | 默认不启动时弹权限；设置开关 + 重要事件 + 节流 |
| 日志泄漏敏感信息 | 安全事故 | 统一 wrapper + redaction + 负向测试 |
| window-state 恢复到屏幕外 | 应用看似打不开 | 可见区域回退 smoke；必要时加入启动修复 helper |
| macOS 行为与 Windows 不一致 | 发布后返工 | 每个切片都写 macOS 验收，不把 macOS 留到最后 |
| 新权限扩大攻击面 | 安全边界变松 | capability 白名单测试；继续禁止 `fs:`、`shell:`、`http:` |
| 当前工作区并行修改多 | 合并冲突/误覆盖 | 实施前登记 lane；写 shared path 前读 lane status/checkpoint |

## 回滚方案

- 删除新增 Cargo/npm 依赖和 lockfile 解析。
- 移除插件注册 helper 中 4 个新增插件。
- 从 capability 删除 `notification:` / `log:` 权限。
- 保留已生成日志文件，不在回滚脚本中删除用户本地数据；仅在文档中说明可手动清理路径。
- 设置项回滚时保留向后兼容读取：旧配置字段存在时忽略，不导致启动失败。

## macOS 验证执行入口

- Windows 实现和隔离 smoke 已有 Round Log 证据；macOS 仍是唯一未关闭生产门禁。
- macOS 执行者按 `.updeng/docs/verification/tauri-desktop-plugin-macos-validation-runbook.md` 跑完整矩阵，并把环境、命令、截图/日志路径和 pass/fail 结果追加到本计划 Round Log。
- macOS 验证通过前，`BLK-20260626-002` 继续保持 open，本计划不能移到 `plan/done/`。

## 完成标准

- 4 个插件全部接入，且依赖、注册、权限和测试一致。
- `single-instance` 第二次启动在 Windows 和 macOS 都只聚焦主实例，不触发重复运行态副作用。
- `window-state` 在 Windows 和 macOS 都能恢复窗口，并在显示器变化后保持可见。
- `notification` 有设置开关、权限策略、节流和至少一个真实后台事件闭环。
- `log` 有统一 Rust/WebView 日志、脱敏和日志文件验证。
- 剪贴板跨平台边界有明确决策：文本剪贴板 Windows/macOS 同等支持；SFTP 系统文件列表剪贴板 Windows native，macOS 通过 Kerminal 内部 SFTP clipboard 和拖放降级，不宣称 Finder pasteboard 已完成。
- `npm run build` 通过。
- `cd src-tauri && cargo test --test tauri_security_config` 通过。
- Windows `npm run tauri:dev` 真实启动 smoke 通过。
- macOS `npm run tauri:dev` 真实启动 smoke 通过；如果当前执行环境没有 macOS，此计划不能标记 done，只能保留 macOS 验收缺口。

## Round Log

- 2026-06-25T23:54:39+08:00：创建生产级方案。当前仅写文档和计划入口，未修改 Tauri 代码、依赖或 capability；后续实现前需要登记并行 lane。
- 2026-06-26T00:20:47+08:00：执行 TASK-001，按用户最新要求采用“不限制 active 并行数量，但所有共享热点先同步 lane 状态和最新 diff”的策略继续推进；本轮没有因为已有多个 active lane 停止。
  - 实际修改：`src-tauri/src/desktop_plugins.rs` 新增桌面插件注册层；`src-tauri/src/lib.rs` 接入 `desktop_plugins::apply_desktop_plugins`；`src-tauri/src/app_tray.rs` 将 `show_main_window` 暴露给 single-instance 回调；`src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` 增加 `window-state`、`single-instance`、`notification`、`log`；`package.json` / `package-lock.json` 增加 `window-state`、`notification`、`log`，并保持不添加 `@tauri-apps/plugin-single-instance`；`src-tauri/capabilities/default.json` 仅新增 `notification:default`，继续不开放 `fs:`、`shell:`、`http:`、`window-state:`、`single-instance:`；`src-tauri/tests/tauri_security_config.rs` 更新白名单和注册顺序断言。
  - 兼容修复：`src-tauri/src/models/config_change.rs` 来自 `lane-config-change-observer` 的 untracked 新文件在本轮 Rust 编译中暴露 `Vec<&str>` 引用临时 `String` 的生命周期错误；为恢复全仓验证，只做 owned `Vec<String>` 的最小修复，并保留该 lane 的设计不变。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed；默认 target 验证因当前运行中的 `src-tauri/target/debug/kerminal.exe` 被锁定失败，隔离 target 后通过，临时 target 已清理。
  - 验证通过：`npm run build`，`tsc && vite build` 通过，仅保留既有 chunk size warning。
  - 验证通过：`npm run dev -- --host 127.0.0.1 --port 1437`，Vite ready；`Invoke-WebRequest http://127.0.0.1:1437/` 返回 200，验证 server 已停止。
  - 未执行：`npm run tauri:dev`。当前已有 Kerminal debug 进程 `C:\dev\rust\kerminal\src-tauri\target\debug\kerminal.exe` 运行并锁定默认二进制，且 `127.0.0.1:1425` 已有 Vite 监听；不擅自停止用户运行窗口。本计划在 Windows/macOS 启动 smoke 通过前不得移到 done。
  - 仍未完成：TASK-002 需要继续验证第二实例不会触发 `AppState::initialize()` 相关运行态副作用；TASK-003+ 需要完成 window-state 关闭/重启恢复、通知策略、日志脱敏和 Windows/macOS 双平台 smoke。macOS 验收当前未执行，仍是生产级完成门禁。
- 2026-06-26T00:35:25+08:00：推进 TASK-002 单实例生命周期的初始化顺序修正，但未标记 TASK-002 生产完成。
  - 实际修改：`src-tauri/src/lib.rs` 将 `AppState::initialize()` 从插件注册前移动到 Tauri `.setup(...)` 内，且位于 `desktop_plugins::apply_desktop_plugins(builder)` 之后；`app.manage(app_state)` 在 setup 中完成，随后启动配置 watcher、窗口图标、close-to-tray 和 tray。这样匹配本机 `tauri-plugin-single-instance-2.4.2` Windows 实现：第二实例会在插件 setup 阶段发现已有实例并 `std::process::exit(0)`，避免继续执行 Kerminal 的 AppState 文件/SQLite/运行态副作用。
  - 本地插件证据：`%USERPROFILE%\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\tauri-plugin-single-instance-2.4.2\src\platform_impl\windows.rs` 在 Windows 侧通过 mutex 判断已有实例，发送 args 后调用 `app.cleanup_before_exit()` 并退出。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed；覆盖依赖、注册顺序、capability 白名单和 `AppState::initialize()` 在 `desktop_plugins::apply_desktop_plugins(builder)` 之后的静态断言。
  - 验证通过：`npm run build`，`tsc && vite build` 通过，仅保留既有 chunk size warning。
  - 验证通过：`npm run dev -- --host 127.0.0.1 --port 1437`，Vite ready；`Invoke-WebRequest http://127.0.0.1:1437/` 返回 200；临时 Vite PID 115440 已停止。
  - 未执行：`npm run tauri:dev`。当前 `127.0.0.1:1425` 已由 PID 26528 的 Vite 进程监听，且已有 PID 47604 `C:\dev\rust\kerminal\src-tauri\target\debug\kerminal.exe` 运行；不擅自终止用户运行中的 Kerminal。Windows 双实例真实 smoke、隐藏到托盘后再次启动、已有 terminal session 不重复创建仍待空闲环境执行。
  - 仍未完成：macOS `npm run tauri:dev` 双实例 smoke 未执行；TASK-003 window-state、TASK-004 notification 策略、TASK-005 log 脱敏/诊断、TASK-006 双平台启动/打包门禁仍待后续切片。
- 2026-06-26T00:57:16+08:00：推进 TASK-003/TASK-004/TASK-005 的基础封装和测试门禁，但不标记这些任务生产完成。
  - 实际修改：`src-tauri/tests/tauri_security_config.rs` 同步最新 `log:default` capability，注册顺序断言改为 helper 调用，并新增 log 轮转、log dir target、稳定文件名前缀、window-state 仅保存 `SIZE | POSITION | MAXIMIZED` 的静态断言；继续禁止 `window-state:`、`single-instance:`、`fs:`、`shell:`、`http:`。
  - 实际新增：`src/lib/desktopNotificationPolicy.ts` / `src/lib/desktopNotificationPolicy.test.ts`，沉淀桌面通知纯策略：设置开关、前后台、权限、重要事件、节流和通知文案脱敏；不在策略层触发插件副作用。
  - 实际新增：`src/lib/desktopNotificationApi.ts` / `src/lib/desktopNotificationApi.test.ts`，封装 Tauri notification JS API；浏览器预览 no-op，Tauri 环境动态加载插件，权限请求只按 policy 执行，发送失败返回 `transport-error` 不抛到业务流程。
  - 实际新增：`src/lib/appLog.ts` / `src/lib/appLog.test.ts`，封装 Tauri log JS API；业务侧只调用项目 wrapper，默认 info/warn/error，debug 必须显式启用，日志 message/keyValues/error 写入前脱敏 token、password、Bearer、`sk-*`、private key 和本机用户路径。
  - 验证通过：`npm run test:frontend -- src/lib/desktopNotificationPolicy.test.ts src/lib/desktopNotificationApi.test.ts src/lib/appLog.test.ts`，3 files / 19 tests passed。首轮发现通知 transport 同步抛错会漏出，已改为 `await sendIfAllowed(...)` 后复测通过。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed；覆盖 capability 白名单、插件依赖/注册顺序、AppState 初始化顺序、log/window-state 配置。
  - 验证通过：`npm run build`，`tsc && vite build` 通过；仅保留既有 Vite dynamic import 和 chunk size warning。
  - 验证通过：`npm run dev -- --host 127.0.0.1 --port 1437`，Vite ready 后 `Invoke-WebRequest http://127.0.0.1:1437/` 返回 200；该临时 dev server 已停止。
  - 未执行：`npm run tauri:dev`。当前 `127.0.0.1:1425` 已由 node PID 26528 监听，且已有 PID 131716 `C:\dev\rust\kerminal\src-tauri\target\debug\kerminal.exe` 运行；不擅自终止用户运行窗口。Windows 双实例、window-state 重启恢复、通知权限弹窗、日志文件落盘 smoke 仍待空闲环境执行。
  - 仍未完成：TASK-004 设置页开关和真实事件接入未做；TASK-005 Rust 侧日志脱敏/诊断包衔接与真实日志文件检查未做；macOS 构建/启动/单实例/通知/日志/window-state 验收未执行，计划不能移到 done。
- 2026-06-26T01:28:26+08:00：推进 TASK-004 设置页开关和最小真实事件接入，但不标记 TASK-004 生产完成。
  - 实际修改：在 `AppSettings` 增加 `desktopNotifications` 设置块，默认 `enabled=false`，不因旧配置或启动流程触发系统通知权限；归一化覆盖 `backgroundOnly`、`importantOnly`、`minDurationMs` 和 `throttleMs`。
  - 实际新增：`src/features/settings/settings-tool-content/desktop-section.tsx`，设置页新增“桌面”分类，提供桌面通知开关、后台/耗时事件优先、重要事件、耗时阈值和同类事件节流；复用现有 `PolicyToggle`、`NumberSetting` 和主题变量。
  - 实际接入：`AboutSettingsSection` 的更新检查在发现 `updater.available` 后调用 `sendDesktopNotification(...)`，由 `desktopNotificationApi` facade 按 settings、权限、visibility 和节流决定是否真正发系统通知；新增 `currentDesktopNotificationVisibility()` 作为浏览器 visibility adapter。
  - 测试通过：`npm run test:frontend -- src/features/settings/settingsModel.test.ts src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsToolContent.controls.test.tsx src/features/settings/SettingsToolContent.about.test.tsx src/lib/desktopNotificationApi.test.ts src/lib/desktopNotificationPolicy.test.ts src/lib/appLog.test.ts`，7 files / 39 tests passed。
  - 验证通过：`rg "@tauri-apps/plugin-(notification|log)" src` 仅命中 `src/lib/desktopNotificationApi.ts` 和 `src/lib/appLog.ts`，业务组件未直接 import 插件 JS API。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过；仅保留既有 Tauri API dynamic import 和 large chunk warning。
  - 真实界面验证：`npm run dev -- --host 127.0.0.1 --port 1437` 启动成功；Edge headless CDP 打开设置、切换浅色/深色/跟随系统、进入“桌面”设置页并截图，探针均显示 `desktop=true`、`overflow=false`。截图：`.updeng/docs/verification/tauri-desktop-notifications-settings-light.png`、`.updeng/docs/verification/tauri-desktop-notifications-settings-dark.png`、`.updeng/docs/verification/tauri-desktop-notifications-settings-system.png`。临时 dev server 和本轮 Edge profile 已停止。
  - 未执行：`npm run tauri:dev`。当前 `127.0.0.1:1425` 仍由 node PID 26528 监听，且已有 PID 65140 `target\debug\kerminal.exe` 运行；不擅自终止用户窗口，也不通过 single-instance 聚焦旧进程来冒充新代码验证。
  - 仍未完成：SFTP batch、Agent Launcher 和 MCP server 失败通知事件尚未接入；Windows 通知权限弹窗、日志文件落盘、双实例/window-state 真实 Tauri smoke 仍待空闲环境执行；macOS 构建/启动/单实例/通知/日志/window-state 验收未执行，计划不能移到 done。
- 2026-06-26T01:36:44+08:00：复核 Tauri 插件调研与当前实现状态，本轮未改生产代码。
  - 调研结论复核：当前适配 Kerminal 的优先官方插件仍是 `single-instance`、`window-state`、`notification`、`log`；`fs`、`shell`、`http`、`global-shortcut`、`autostart`、`deep-link`、`stronghold` 等因为会扩大权限、改变安全边界或缺少当前明确业务闭环，继续列为非目标/候选，不在本 lane 添加。
  - 代码复核：`single-instance -> log -> window-state -> notification -> opener/process/updater` 注册顺序仍在 `src-tauri/src/desktop_plugins.rs`；前端 `notification`/`log` 插件 import 只存在于 `src/lib/desktopNotificationApi.ts` 和 `src/lib/appLog.ts` facade，业务组件没有直接绕过 wrapper；未暴露 `window-state:` 或 `single-instance:` 前端权限。
  - 验证通过：`npm run test:frontend -- src/features/settings/settingsModel.test.ts src/features/settings/SettingsToolContent.test.tsx src/features/settings/SettingsToolContent.controls.test.tsx src/features/settings/SettingsToolContent.about.test.tsx src/lib/desktopNotificationApi.test.ts src/lib/desktopNotificationPolicy.test.ts src/lib/appLog.test.ts`，7 files / 39 tests passed。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过；仅保留既有 Tauri API dynamic import 和 large chunk warning，构建用时约 2m34s。
  - 未执行：`npm run tauri:dev`。当前 `127.0.0.1:1425` 仍由 node PID 26528 监听，且已有 PID 65140 `C:\dev\rust\kerminal\src-tauri\target\debug\kerminal.exe` 运行；不擅自终止用户运行中的 Kerminal。Windows 双实例/window-state/通知权限/日志落盘 smoke 仍待空闲环境执行。
  - 仍未完成：SFTP batch、Agent Launcher 和 MCP server 失败通知事件尚未接入；Rust 侧结构化生命周期日志、诊断入口和日志脱敏负向测试仍需后续切片；macOS 构建/启动/单实例/通知/日志/window-state 验收未执行，计划不能移到 done。
- 2026-06-26T01:42:12+08:00：推进 TASK-002/TASK-005 的 Rust 侧生命周期日志切片，但不标记生产完成。
  - 实际修改：`src-tauri/src/desktop_plugins.rs` 在 `single-instance` 回调中记录 `desktop.lifecycle` 事件，只写固定文案，不记录 `_args` 或 `_cwd`。
  - 实际修改：`src-tauri/src/lib.rs` 在 desktop setup、`AppState` manage、config watcher 启动成功/失败和 setup 完成时记录 `desktop.lifecycle`；config watcher 失败仍保留 `eprintln!` 给本地调试，但落盘日志只写固定失败事件，避免把可能包含路径的错误详情写入日志文件。
  - 实际修改：`src-tauri/src/app_tray.rs` 在 close-to-tray handler、托盘安装、托盘隐藏/退出、主窗口 show/focus 和窗口缺失等路径记录 `desktop.window` / `desktop.lifecycle`；不记录窗口标题、路径、命令行或用户数据。
  - 测试加固：`src-tauri/tests/tauri_security_config.rs` 继续锁定插件依赖、注册顺序、capability 白名单、log 轮转和 window-state flags，并新增断言：桌面生命周期/窗口路径必须使用结构化 log target；single-instance 不得插值 `_args` / `_cwd`；config watcher 落盘日志不得包含 `{error}`。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed。
  - 验证通过：`rustfmt --edition 2021 src/app_tray.rs src/desktop_plugins.rs src/lib.rs tests/tauri_security_config.rs --check`。
  - 未执行：`npm run tauri:dev`。当前 `127.0.0.1:1425` 仍由 node PID 26528 监听，且已有 PID 118736 `C:\dev\rust\kerminal\src-tauri\target\debug\kerminal.exe` 运行；不擅自终止用户窗口，也不通过 single-instance 聚焦旧进程来冒充新代码验证。
  - 仍未完成：真实 Windows 日志文件落盘、双实例、window-state、通知权限 smoke 仍待空闲环境执行；SFTP batch、Agent Launcher 和 MCP server 失败通知事件尚未接入；诊断入口/日志面板连接和 macOS 构建/启动/单实例/通知/日志/window-state 验收仍未完成，计划不能移到 done。
- 2026-06-26T01:49:11+08:00：补充 Tauri 插件能力调研与剪贴板跨平台审计，本轮未改生产代码。
  - 官方版本复核：`tauri-plugin-window-state` / `@tauri-apps/plugin-window-state` 最新为 `2.4.1`；`tauri-plugin-single-instance` 最新为 `2.4.2` 且 Rust-only；`tauri-plugin-notification` / `@tauri-apps/plugin-notification` 最新为 `2.3.3`；`tauri-plugin-log` / `@tauri-apps/plugin-log` 最新为 `2.8.0`。当前已接入版本与最新版本一致。
  - 候选插件复核：官方 `tauri-plugin-clipboard-manager` / `@tauri-apps/plugin-clipboard-manager` 最新为 `2.3.2`，官方 JS API 覆盖 `readText`、`writeText`、`readImage`、`writeImage`、`writeHtml`、`clear`，适合后续替代终端文本粘贴和通用文本复制中的 `navigator.clipboard` 权限弹框风险。
  - 剪贴板审计：`src-tauri/src/commands/terminal.rs` 的 `terminal_read_clipboard_text` 当前通过 `clipboard-win` 只支持 Windows，非 Windows 直接返回“不支持”；这不满足本计划的 Windows/macOS 同等终端粘贴要求。
  - SFTP 文件剪贴板审计：`src-tauri/src/services/sftp_service/transfer_paths.rs` 的系统文件剪贴板读写同样依赖 Windows `clipboard-win::formats::FileList`，非 Windows 为空或报“不支持”。官方 `clipboard-manager` 没有系统文件列表剪贴板 API，不能直接解决 SFTP “从系统文件剪贴板上传/下载到系统文件剪贴板”的 macOS 对等能力；后续需单独设计 macOS NSFilePromise/pasteboard 或降级为 Kerminal 内部 SFTP clipboard，并在计划中明确用户可见差异。
  - 直接 `navigator.clipboard` 调用仍分散在终端复制、命令块复制、SFTP 本地路径复制、settings 导出、snippets、tmux quickref、port forward 和 Compose inspector 等前端入口。若加入 `clipboard-manager`，应先抽 `src/lib/desktopClipboardApi.ts` facade，业务组件统一调用 wrapper；浏览器预览保留 `navigator.clipboard` fallback。
  - 结论：当前优先接入的 4 个插件选择仍成立；`clipboard-manager` 是下一轮可加的低风险官方插件候选，但它只解决文本/图片/html clipboard，不应被误写为 SFTP 文件剪贴板的完整跨平台方案。`fs`、`shell`、`http`、`global-shortcut`、`autostart`、`deep-link`、`stronghold` 仍保持非目标，避免扩大权限面。
- 2026-06-26T02:11:34+08:00：接入官方 `clipboard-manager` 的文本剪贴板切片，关闭终端文本粘贴 Windows-only command 缺口，但不标记 SFTP 系统文件剪贴板或整体验收完成。
  - 实际修改：`src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` 增加 `tauri-plugin-clipboard-manager = "2.3.2"`；`package.json` / `package-lock.json` 保留 `@tauri-apps/plugin-clipboard-manager@^2.3.2`；`src-tauri/src/desktop_plugins.rs` 在 `notification` 后、`opener` 前注册 `tauri_plugin_clipboard_manager::init()`。
  - 权限边界：`src-tauri/capabilities/default.json` 只新增 `clipboard-manager:allow-read-text` 和 `clipboard-manager:allow-write-text`；继续不开放 `clipboard-manager:default`、image/html/clear、`fs:`、`shell:`、`http:`。
  - 实际新增：`src/lib/desktopClipboardApi.ts` / `src/lib/desktopClipboardApi.test.ts`，统一封装文本剪贴板读写。Tauri 环境动态加载官方插件；浏览器预览保留 `navigator.clipboard` fallback；读取失败返回空字符串，写入失败返回结构化 `transport-error`，避免业务流程抛出原生权限异常。
  - 实际替换：`src/lib/terminalApi.ts` 的 `readTerminalClipboardText()` 改为调用 `readDesktopClipboardText()`；`src-tauri/src/commands/terminal.rs` 移除 `terminal_read_clipboard_text` 和 Windows-only `clipboard-win` 读取 helper；`src-tauri/src/commands/registry.rs` 移除该 command 注册。`clipboard-win` 依赖暂不移除，因为 SFTP 文件列表剪贴板仍在使用。
  - 测试加固：`src-tauri/tests/tauri_security_config.rs` 锁定 clipboard-manager 依赖、注册顺序、文本最小权限和旧 command 不回流；`src/lib/terminalApi.test.ts` 断言终端粘贴只走项目 clipboard facade，不再 invoke `terminal_read_clipboard_text`。
  - 验证通过：`npm run test:frontend -- src/lib/desktopClipboardApi.test.ts src/lib/terminalApi.test.ts`，2 files / 18 tests passed。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed；本轮首次编译 `tauri-plugin-clipboard-manager v2.3.2`。
  - 验证通过：`rustfmt --edition 2021 src/desktop_plugins.rs src/commands/terminal.rs src/commands/registry.rs tests/tauri_security_config.rs --check`。
  - 验证通过：`npm run build`，`tsc && vite build` 通过；仅保留既有 Tauri API dynamic import 和 large chunk warning，构建用时约 4m01s。
  - 验证通过：`npm run dev -- --host 127.0.0.1 --port 1438 --strictPort` 启动成功，因 lockfile 变化触发依赖重新优化；`Invoke-WebRequest http://127.0.0.1:1438/` 返回 `status=200 length=644`。本轮临时 Vite PID `132728` 已按 `--port 1438 --strictPort` 精确停止。
  - 未执行：`npm run tauri:dev`。当前 `127.0.0.1:1425` 仍由 node PID `26528` 监听，并且已有 `node ... tauri.js dev` PID `108236` 与 `target\debug\kerminal.exe` PID `93052` 运行；不擅自停止用户窗口，也不通过 single-instance 聚焦旧进程冒充本轮新代码验证。
  - 仍未完成：SFTP 系统文件剪贴板 macOS 对等能力没有被 `clipboard-manager` 解决；终端复制、命令块复制、SFTP 本地路径复制、settings 导出、snippets、tmux quickref、port forward 和 Compose inspector 等分散文本复制入口仍需后续迁移到 `desktopClipboardApi`；Windows 真实 `tauri:dev` 双实例/window-state/通知/日志/剪贴板 smoke 与 macOS 验收仍是未关闭门禁，计划不能移到 done。
- 2026-06-26T02:27:05+08:00：补齐 settings 导出剪贴板入口迁移与本轮文档收口，不标记整体验收完成。
  - 实际修改：`src/features/settings/settings-tool-content/clipboard.ts` 从直接 `navigator.clipboard.writeText` 改为调用 `writeDesktopClipboardText()`，Tauri 环境走官方 `clipboard-manager` 文本写入，浏览器预览仍由 `desktopClipboardApi` fallback 处理。
  - 实际新增：`src/features/settings/settings-tool-content/clipboard.test.ts`，覆盖 helper 成功写入和 transport-error 抛出结构化错误，避免设置页导出继续绕过项目 clipboard facade。
  - 协作同步：`lane-tauri-desktop-plugin-hardening` 的 owned paths 已包含 settings clipboard helper/test；刷新 lane 状态后确认该 lane 仍 active，未触碰 `XtermPane.tsx`、`XtermPane.runtime.ts`、`TmuxToolContent.tsx` 等其它 active lane owned path。
  - 验证通过：`npm run test:frontend -- src/features/settings/settings-tool-content/clipboard.test.ts src/lib/desktopClipboardApi.test.ts src/features/settings/SettingsToolContent.mcp.test.tsx src/features/settings/SettingsToolContent.test.tsx`，4 files / 17 tests passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过；仅保留既有 dynamic import/chunk warning。
  - 验证通过：`npm run dev -- --host 127.0.0.1 --port 1439 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1439/` 返回 `status=200 length=644`；本轮恢复现场时确认临时 Vite PID `132212` 命令行匹配 `--port 1439 --strictPort` 并已精确停止，`1439` 端口不可连接。
  - 未执行：`npm run tauri:dev`。默认 `127.0.0.1:1425` 和运行中 Kerminal 仍属于用户当前运行窗口，不擅自停止；不能用 single-instance 聚焦旧进程冒充本轮新代码验证。
  - 仍未完成：SFTP 系统文件剪贴板 macOS 对等能力没有被 `clipboard-manager` 解决；snippets、terminal command blocks、SFTP 本地路径复制、tmux quickref、port forward、Compose inspector 和 Xterm runtime 等分散文本复制入口仍需按 lane 所有权逐步迁移到 `desktopClipboardApi`；Windows 真实 `tauri:dev` 双实例/window-state/通知/日志/剪贴板 smoke 与 macOS 验收仍是未关闭门禁，计划不能移到 done。
- 2026-06-26T02:40:55+08:00：继续迁移低冲突文本复制入口，完成 snippets 与 port forward 复制路径，不标记整体验收完成。
  - 实际修改：`src/features/snippets/SnippetToolContent.tsx` 的“复制片段”从直接 `navigator.clipboard?.writeText` 改为调用 `writeDesktopClipboardText()`；保留已有 configRevision 草稿保护改动，不重排 snippets 组件。
  - 实际修改：`src/features/tool-panel/PortForwardToolContent.tsx` 的地址、网络助手配置脚本和撤销脚本复制统一走 `writeDesktopClipboardText()`；保留该文件既有文案调整，不做额外 UI 重构。
  - 测试新增：`src/features/snippets/SnippetToolContent.test.tsx` 和 `src/features/tool-panel/PortForwardToolContent.test.tsx` mock `desktopClipboardApi` 并断言复制按钮调用项目 clipboard facade。
  - 协作同步：`lane-tauri-desktop-plugin-hardening` 的 owned paths 已追加 snippets 与 port forward 组件/测试；本轮未触碰 `XtermPane.tsx`、`XtermPane.runtime.ts`、`TmuxToolContent.tsx`、SFTP 文件剪贴板等其它 active lane 或专项高风险入口。
  - 验证通过：`npm run test:frontend -- src/features/snippets/SnippetToolContent.test.tsx src/features/tool-panel/PortForwardToolContent.test.tsx src/lib/desktopClipboardApi.test.ts`，3 files / 32 tests passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过；仅保留既有 Tauri API dynamic import 和 large chunk warning，构建用时约 3m22s。
  - 验证通过：`npm run dev -- --host 127.0.0.1 --port 1440 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1440/` 返回 `StatusCode=200 Length=644`；临时 Vite PID `34792` 已按 `--port 1440 --strictPort` 精确停止，`1440` 端口不可连接。
  - 剩余直接文本剪贴板入口：`terminalCommandBlocks.ts`、`XtermPane.tsx`、`XtermPane.runtime.ts`、`TmuxToolContent.tsx`、`LocalTransferPane.tsx`、`sftpDragDropModel.ts`、`ComposeProjectInspector.tsx`。其中 Xterm 与 tmux 属于其它 active lane owned path，SFTP 系统文件/路径剪贴板需要单独跨平台设计，后续按 lane 所有权继续迁移。
  - 未执行：`npm run tauri:dev`。默认 `127.0.0.1:1425` 和运行中 Kerminal 仍属于用户当前运行窗口，不擅自停止；Windows 真实双实例/window-state/通知/日志/剪贴板 smoke 与 macOS 验收仍是未关闭门禁，计划不能移到 done。
- 2026-06-26T02:55:56+08:00：继续迁移低冲突文本复制入口，完成 Compose inspector YAML 路径复制，不标记整体验收完成。
  - 实际修改：`src/features/machine-sidebar/host-containers/ComposeProjectInspector.tsx` 的“复制 Compose YAML 路径”从直接 `navigator.clipboard?.writeText` 改为调用 `writeDesktopClipboardText()`；保持 Compose inspector 现有布局和 YAML 预览逻辑不变。
  - 测试新增：`src/features/machine-sidebar/host-containers/ComposeProjectInspector.test.tsx` mock `desktopClipboardApi` 并断言复制按钮调用项目 clipboard facade。
  - 协作同步：`lane-tauri-desktop-plugin-hardening` 的 owned paths 已追加 Compose inspector 组件/测试；本轮未触碰 `XtermPane.tsx`、`XtermPane.runtime.ts`、`TmuxToolContent.tsx`、SFTP 文件剪贴板等其它 active lane 或专项高风险入口。
  - 验证通过：`npm run test:frontend -- src/features/machine-sidebar/host-containers/ComposeProjectInspector.test.tsx src/lib/desktopClipboardApi.test.ts`，2 files / 9 tests passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过；仅保留既有 Tauri API dynamic import 和 large chunk warning，构建用时 4m44s。
  - 验证通过：`npm run dev -- --host 127.0.0.1 --port 1441 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1441/` 返回 `StatusCode=200 Length=644`；临时 Vite session 已停止，`1441` 端口不可连接。
  - 验证通过：`rg "navigator\\.clipboard|clipboard\\.writeText|clipboard\\.readText" src` 已不再命中 Compose inspector；剩余直接文本剪贴板入口为 `LocalTransferPane.tsx`、`sftpDragDropModel.ts`、`terminalCommandBlocks.ts`、`XtermPane.tsx`、`XtermPane.runtime.ts`、`TmuxToolContent.tsx` 及对应测试 mock。
  - 未执行：`npm run tauri:dev`。默认 `127.0.0.1:1425` 和运行中 Kerminal 仍属于用户当前运行窗口，不擅自停止；Windows 真实双实例/window-state/通知/日志/剪贴板 smoke 与 macOS 验收仍是未关闭门禁，计划不能移到 done。
- 2026-06-26T03:12:52+08:00：继续迁移 SFTP 纯文本路径复制入口，不标记 SFTP 系统文件剪贴板或整体验收完成。
  - 实际修改：`src/features/sftp/LocalTransferPane.tsx` 的本地“复制路径”从直接 `navigator.clipboard?.writeText` 改为调用 `writeDesktopClipboardText()`；失败时保留 SFTP 面板错误提示口径。
  - 实际修改：`src/features/sftp/sftp-tool-content/sftpDragDropModel.ts` 的远端路径文本复制改为调用 `desktopClipboardApi` facade；`useSftpTransferActions.copyRemotePath` 的成功/失败状态语义保持不变。
  - 测试新增/更新：`src/features/sftp/LocalTransferPane.test.tsx` mock `desktopClipboardApi` 并断言本地“复制路径”调用项目 clipboard facade；新增 `src/features/sftp/sftp-tool-content/sftpDragDropModel.test.ts` 覆盖 facade 成功写入和不可用时抛出原有中文错误。
  - 协作同步：`lane-tauri-desktop-plugin-hardening` 的 owned paths 已追加 SFTP 纯文本路径复制组件/模型/测试；本轮只在已有未归因 `LocalTransferPane` 变更上做最小叠加，未回滚或重排既有 PromptDialog、虚拟列表和密度相关改动；未触碰 `XtermPane.tsx`、`XtermPane.runtime.ts`、`TmuxToolContent.tsx` 等其它 active lane owned path。
  - 验证通过：`npm run test:frontend -- src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/sftp-tool-content/sftpDragDropModel.test.ts src/lib/desktopClipboardApi.test.ts`，3 files / 37 tests passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过；仅保留既有 Tauri API dynamic import 和 large chunk warning，构建用时 4m30s。
  - 验证通过：`npm run dev -- --host 127.0.0.1 --port 1442 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1442/` 返回 `StatusCode=200 Length=644`；临时 dev server 已停止，`1442` 端口不可连接。
  - 验证通过：`rg "navigator\\.clipboard|clipboard\\.writeText|clipboard\\.readText" src` 已不再命中 SFTP 生产文件；剩余直接文本剪贴板入口为 `terminalCommandBlocks.ts`、`XtermPane.tsx`、`XtermPane.runtime.ts`、`TmuxToolContent.tsx` 及对应测试 mock，其中 Xterm/tmux 属于其它 active lane owned path。
  - 未执行：`npm run tauri:dev`。当前 `127.0.0.1:1425` 仍由 node PID `26528` 监听，并且已有 `npm run tauri:dev` / `tauri dev` 进程和 `target\debug\kerminal.exe` PID `81680` 运行；不擅自停止用户窗口，也不通过 single-instance 聚焦旧进程冒充本轮新代码验证。
  - 仍未完成：SFTP 系统文件列表剪贴板仍依赖 Windows-only `clipboard-win::formats::FileList`，官方 `clipboard-manager` 不能直接覆盖，需要单独 macOS 对等或降级设计；Windows 真实双实例/window-state/通知/日志/剪贴板 smoke 与 macOS 验收仍是未关闭门禁，计划不能移到 done。
- 2026-06-26T03:29:43+08:00：继续迁移终端命令块文本 fallback，不标记终端/Xterm 或整体验收完成。
  - 实际修改：`src/features/terminal/terminalCommandBlocks.ts` 的命令块图片复制在当前环境不支持 PNG clipboard 时，文本 fallback 改为调用 `writeDesktopClipboardText()`；图片复制仍使用浏览器 `navigator.clipboard.write` + `ClipboardItem`，只处理 PNG clipboard 路径。
  - 测试新增/更新：`src/features/terminal/terminalCommandBlocks.test.ts` mock `desktopClipboardApi`，断言 PNG 成功路径不调用文本 facade、文本 fallback 调用 facade、facade 不可用时抛出原有中文错误。
  - 协作同步：`lane-tauri-desktop-plugin-hardening` 的 owned paths 已追加 `terminalCommandBlocks.ts` 与测试；本轮未触碰 `XtermPane.tsx`、`XtermPane.runtime.ts`、`TmuxToolContent.tsx` 等其它 active lane owned path。
  - 验证通过：`npm run test:frontend -- src/features/terminal/terminalCommandBlocks.test.ts src/lib/desktopClipboardApi.test.ts`，2 files / 31 tests passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过，构建用时约 5m18s；仅保留既有 Tauri API dynamic import 和 large chunk warning。
  - 验证通过：`npm run dev -- --host 127.0.0.1 --port 1443 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1443/` 返回 `status=200 length=644`；临时 Vite 进程树已按 `--port 1443 --strictPort` 精确停止，`1443` 端口不可连接。
  - 验证通过：`rg "navigator\\.clipboard\\??\\.writeText|navigator\\.clipboard\\??\\.readText|clipboard\\.writeText|clipboard\\.readText" src/features src/lib` 显示剩余生产直接文本剪贴板入口只在 `XtermPane.tsx`、`XtermPane.runtime.ts`、`TmuxToolContent.tsx`；这些路径分别属于其它 active lane，后续需同步后再迁移。
  - 未执行：`npm run tauri:dev`。默认 `127.0.0.1:1425` 和运行中 Kerminal 仍属于用户当前运行窗口，不擅自停止；Windows 真实双实例/window-state/通知/日志/剪贴板 smoke 与 macOS 验收仍是未关闭门禁，计划不能移到 done。
  - 仍未完成：SFTP 系统文件列表剪贴板仍依赖 Windows-only `clipboard-win::formats::FileList`，官方 `clipboard-manager` 不能直接覆盖，需要单独 macOS 对等或降级设计；Xterm/tmux 文本复制入口待对应 lane 空闲或同步后迁移；Windows/macOS 真实 Tauri 验收仍未关闭。
- 2026-06-26T03:46:18+08:00：收口 SFTP 系统文件剪贴板平台能力模型，明确非 Windows 降级，不标记 macOS 原生文件 pasteboard 已完成。
  - 实际修改：`src-tauri/src/services/sftp_service/transfer_paths.rs` 新增 `SystemFileClipboardSupport` 与 `system_file_clipboard_support()`，当前 Windows 标记为 `NativeFileList`，非 Windows 标记为 `KerminalInternalOnly`。
  - 行为变更：非 Windows 的 `read_local_file_clipboard()` 不再伪装成空剪贴板，而是返回明确错误：当前平台暂不支持读取系统文件剪贴板，并提示使用 Kerminal SFTP 内部复制/粘贴或拖放本机文件；`ensure_local_file_clipboard_supported()` / `write_local_file_clipboard()` 同步使用同一降级口径。
  - 测试入口：`src-tauri/src/services/sftp_service.rs` 的 `rules` 模块暴露系统文件剪贴板支持判断、支持校验和读取入口，仅用于测试规则，不进入生产 API 面。
  - 测试新增：`src-tauri/tests/sftp_service.rs` 覆盖 Windows 支持 native file list、非 Windows 降级到 Kerminal internal clipboard、非 Windows 读取系统文件剪贴板时返回显式降级错误。
  - 协作同步：`lane-tauri-desktop-plugin-hardening` 的 owned paths 已追加 `src-tauri/src/services/sftp_service/transfer_paths.rs`、`src-tauri/src/services/sftp_service.rs`、`src-tauri/tests/sftp_service.rs`；本轮只做 SFTP 系统文件剪贴板能力边界，不触碰 Xterm/tmux 其它 active lane。
  - 验证通过：`rustfmt --edition 2021 src/services/sftp_service.rs src/services/sftp_service/transfer_paths.rs tests/sftp_service.rs --check`。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test sftp_service system_file_clipboard_supports_native_file_list_on_windows`。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test sftp_service`，46 passed。
  - 协调刷新通过：`node .codex/hooks/lane-coordination.cjs refresh C:\dev\rust\kerminal`，当前 `lane-tauri-desktop-plugin-hardening` 显示 46 个 changed paths。
  - 启动门禁通过：`npm run build`，`tsc && vite build` 通过，用时约 5m01s；仅保留既有 Tauri API dynamic import 和 large chunk warning。
  - 启动门禁通过：`npm run dev -- --host 127.0.0.1 --port 1444 --strictPort`，`Invoke-WebRequest http://127.0.0.1:1444/` 返回 `status=200 length=644`；临时 dev server 已停止，`1444` 端口确认释放。
  - 未执行：`npm run tauri:dev`。只读检查显示 `127.0.0.1:1425` 仍由 PID `26528` 监听，且已有 `node ... tauri.js dev` PID `108236`、`target\debug\kerminal.exe` PID `52036` 和另一条隔离配置 `tauri.js dev --no-watch` PID `133064` 运行；不擅自停止用户/其它 lane 窗口，也不通过 single-instance 聚焦旧进程冒充本轮新代码验证。
  - 仍未完成：这不是 macOS 原生 NSFilePromise / NSPasteboard 文件列表实现；macOS 系统文件剪贴板仍是明确降级，后续要么补 macOS 原生 pasteboard adapter，要么把 SFTP 系统文件剪贴板作为 Windows-only native 能力并在产品体验中保留内部 clipboard/拖放替代。真实 Windows `tauri:dev` 双实例/window-state/通知/日志/剪贴板 smoke 与 macOS 验收仍未关闭。
- 2026-06-26T04:10:51+08:00：迁移剩余 Xterm/tmux 文本复制入口到官方 clipboard facade，不标记桌面插件整体验收完成。
  - 实际修改：`src/features/terminal/XtermPane.tsx` 的右键复制、命令块“复制文本块”和命令块图片复制失败后的文本 fallback 改为调用 `writeDesktopClipboardText()`；`src/features/terminal/XtermPane.runtime.ts` 的 selection-copy 自动复制同样改走项目 clipboard facade。
  - 实际修改：`src/features/tool-panel/TmuxToolContent.tsx` 的 tmux quickref 命令/快捷键复制改为调用 `writeDesktopClipboardText()`，复制能力不可用时继续显示“复制失败：当前环境没有剪贴板权限”。
  - 测试更新：`src/features/terminal/__tests__/support/XtermPane.testSupport.tsx` mock `desktopClipboardApi`；`XtermPane.contextMenu.test.tsx`、`XtermPane.commandRail.test.tsx`、`XtermPane.test.tsx` 和 `TmuxToolContent.test.tsx` 断言文本复制走项目 facade，并保留浏览器 clipboard 反向断言。
  - 协作同步：这些 Xterm/tmux 文件分别属于 `lane-current-agent-sidebar-terminal-polish` 与 `lane-current-tmux-sidebar-geek-redesign` 的 owned paths；本轮已读取对方 checkpoint/当前 diff，只做剪贴板 facade 最小兼容修改，并把相关路径登记到 `lane-tauri-desktop-plugin-hardening.sharedPaths`。
  - 验证通过：`rg "navigator\\.clipboard\\??\\.(writeText|readText)|clipboard\\.writeText|clipboard\\.readText" src/features src/lib` 只剩测试里的反向断言，生产文本复制入口不再直接调用浏览器 clipboard；命令块 PNG 图片复制仍保留 `navigator.clipboard.write` 图片路径。
  - 验证通过：`npm run test:frontend -- src/features/terminal/XtermPane.contextMenu.test.tsx src/features/terminal/XtermPane.commandRail.test.tsx src/features/terminal/XtermPane.test.tsx src/features/tool-panel/TmuxToolContent.test.tsx src/lib/desktopClipboardApi.test.ts`，5 files / 60 tests passed。
  - 启动门禁通过：`npm run build`，`tsc && vite build` 通过，用时约 4m24s；仅保留既有 Tauri API dynamic import 和 large chunk warning。
  - 启动门禁通过：`npm run dev -- --host 127.0.0.1 --port 1445 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1445/` 返回 `StatusCode=200 RawContentLength=644`；临时 Vite PID `134048` 命令行匹配 `--port 1445 --strictPort` 后已精确停止，`1445` 端口确认释放。
  - 未执行：`npm run tauri:dev`。只读检查显示 `127.0.0.1:1425` 仍由 PID `26528` 监听，且已有 `npm run tauri:dev` / `tauri dev` 进程和 `target\debug\kerminal.exe` PID `52036` 运行；不擅自停止用户窗口，也不通过 single-instance 聚焦旧进程冒充本轮新代码验证。
  - 仍未完成：真实 Windows `tauri:dev` 双实例/window-state/通知/日志/剪贴板 smoke、macOS 构建/启动/单实例/通知/日志/window-state/剪贴板验收、SFTP macOS 原生文件 pasteboard 对等方案或明确产品降级决策、更多真实通知事件和日志落盘诊断入口仍未关闭。
- 2026-06-26T04:43:26+08:00：补齐 `tauri-plugin-log` 落盘路径与诊断/日志面板入口，不标记桌面插件整体验收完成。
  - 实际修改：`src-tauri/src/desktop_plugins.rs` 的 log target 从 OS 默认 `LogDir` 改为 `TargetKind::Folder { path: ~/.kerminal/logs, file_name: kerminal }`，继续保留 `Info` 级别、单文件 `1_000_000` bytes 和 `KeepSome(5)` 轮转；`src-tauri/src/lib.rs` 在插件注册前只解析 `KerminalPaths` 日志目录，不提前初始化 `AppState`。
  - 实际修改：`src-tauri/src/paths.rs` 新增 Tauri 日志文件常量和 `app_log_file()`；`RuntimeStorageHealth`、诊断包 payload 与浏览器 preview API 同步暴露 `appLogFile`、文件大小和轮转策略；诊断包只记录日志元数据，明确 `logContentIncluded=false`，不把日志正文打进 bundle。
  - 实际修改：`src/features/logs/LogToolContent.tsx` 新增“应用日志”状态块，展示活跃日志文件、当前大小、单文件上限和保留文件数；继续使用现有主题变量与 `dark:` 样式。
  - 安全补强：`src/lib/appLog.ts` 的 structured key-values 现在会把 `command` / `commandLine` / `argv` / `env` / `prompt` 等完整命令参数字段替换为 `[redacted-command]`，避免组件错误地把完整命令行、prompt 或环境变量写入 WebView 日志。
  - 测试更新：`src-tauri/tests/diagnostics_service.rs` 覆盖诊断包日志元数据、`logContentIncluded=false` 和日志文件中 token/password 不进入 bundle；`src-tauri/tests/tauri_security_config.rs` 锁定 log target 为 Kerminal 管理日志目录；`src/lib/appLog.test.ts` 覆盖私钥、token、路径和完整命令参数脱敏；`diagnosticsApi` 与 `LogToolContent` 测试覆盖新字段和日志面板展示。
  - 验证通过：`rustfmt --edition 2021 src/paths.rs src/desktop_plugins.rs src/lib.rs src/models/diagnostics.rs src/services/diagnostics_service.rs tests/diagnostics_service.rs tests/tauri_security_config.rs --check`。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config --test diagnostics_service`，`diagnostics_service` 3 passed，`tauri_security_config` 6 passed。
  - 验证通过：`npm run test:frontend -- src/lib/appLog.test.ts src/lib/diagnosticsApi.test.ts src/features/logs/LogToolContent.test.tsx`，3 files / 15 tests passed。
  - 相邻测试缺口：`npm run test:frontend -- src/lib/appLog.test.ts src/lib/diagnosticsApi.test.ts src/features/logs/LogToolContent.test.tsx src/features/tool-panel/ToolPanel.test.tsx` 中 `ToolPanel.test.tsx > opens the tmux tool from the rail` 失败，原因是既有 tmux lane 期望 `暂无 session`，当前 UI 未出现该文案；本轮日志/诊断直接测试已通过，未在本切片修 tmux 文案。
  - 启动门禁通过：`npm run build`，`tsc && vite build` 通过，用时约 5m04s；仅保留既有 Tauri API dynamic import 和 large chunk warning。
  - 启动门禁通过：`npm run dev -- --host 127.0.0.1 --port 1446 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1446/` 返回 `status=200 length=644`；临时 dev server 已 Ctrl+C 停止，端口释放检查返回 `released`。
  - 未执行：`npm run tauri:dev`。只读检查显示 `127.0.0.1:1425` 仍由 PID `26528` 监听，且 `target\debug\kerminal.exe` PID `105328` 正在运行；不擅自停止用户窗口，也不通过 single-instance 聚焦旧进程冒充本轮新代码验证。
  - 仍未完成：真实 Windows `tauri:dev` 双实例/window-state/通知/日志/剪贴板 smoke、macOS 构建/启动/单实例/通知/日志/window-state/剪贴板验收、SFTP macOS 原生文件 pasteboard 对等方案或明确产品降级决策、更多真实通知事件仍未关闭。
- 2026-06-26T05:14:00+08:00：接入 SFTP 队列完成/失败和 MCP Server 启动失败真实通知事件，不标记桌面插件整体验收完成。
  - 实际新增：`src/features/sftp/sftpTransferNotificationModel.ts` / `.test.ts`，从传输状态迁移中选择新近完成的 notifiable transfer；首次加载的历史终态队列不会弹旧通知，直接终态但 `createdAt` 晚于 hook 初始化的任务仍可通知；生成的事件只含数量、host label 和 duration，不包含本地/远端路径。
  - 实际新增：`src/features/sftp/useSftpTransferNotifications.ts` / `.test.tsx`，维护 previous status、terminal seen ids 和 per-workbench notification throttle key，并调用 `sendDesktopNotification()`；`SftpTransferWorkbench` 接入该 hook，并通过 `hostLabelById` 与 `transferViewScope` 隔离不同 workbench。
  - 实际修改：`src/app/KerminalShell.tsx` 和 `src/app/KerminalShell.workspaceBridge.tsx` 只新增 `desktopNotifications` prop 透传到 SFTP transfer workbench；这些文件属于共享热点，本轮未改布局、store、终端 runtime 或 sidebar 行为。
  - 实际修改：`src/features/settings/settings-tool-content/mcp-section.tsx` 在用户点击“启动”且 `startMcpHttpServer()` 失败时发送 `mcp.server.failed` 通知；普通状态刷新失败不发系统通知。`SettingsToolContent` 将 `normalizedSettings.desktopNotifications` 传给 MCP section。
  - 测试更新：`src/features/settings/SettingsToolContent.mcp.test.tsx` mock desktop notification API，覆盖 MCP 启动失败通知；SFTP model/hook 测试覆盖 transition、历史队列跳过、聚合完成、失败优先和路径不进入事件 payload。
  - 验证通过：`npm run test:frontend -- src/features/sftp/sftpTransferNotificationModel.test.ts src/features/sftp/useSftpTransferNotifications.test.tsx src/features/settings/SettingsToolContent.mcp.test.tsx src/lib/desktopNotificationPolicy.test.ts src/lib/desktopNotificationApi.test.ts`，5 files / 24 tests passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过，用时约 5m09s；仅保留既有 Tauri API dynamic import 和 large chunk warning。
  - 启动门禁通过：`npm run dev -- --host 127.0.0.1 --port 1447 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1447/` 返回 `status=200 length=644`；临时 dev server 已 Ctrl+C 停止，端口释放检查返回 `released`。
  - 协调刷新通过：`node .codex/hooks/lane-coordination.cjs refresh C:\dev\rust\kerminal`，当前 `lane-tauri-desktop-plugin-hardening` 显示 72 个 changed paths，其中 23 个 shared paths；新增 SFTP 通知文件和 MCP 通知测试已登记到 lane。
  - 未执行：`npm run tauri:dev`。只读检查显示 `127.0.0.1:1425` 仍由 PID `26528` 监听，并且已有 `tauri dev` PID `120696` 与 `target\debug\kerminal.exe` PID `105328` 运行；不擅自停止用户/其它 lane 窗口，也不通过 single-instance 聚焦旧进程冒充本轮新代码验证。
  - 仍未完成：Agent Launcher 进程结束通知仍因 `XtermPane` / Agent Launcher owned path 属于 active `lane-current-agent-sidebar-terminal-polish` 而暂缓；真实 Windows `tauri:dev` 双实例/window-state/通知/日志/剪贴板 smoke、macOS 构建/启动/单实例/通知/日志/window-state/剪贴板验收、SFTP macOS 原生文件 pasteboard 对等方案或明确产品降级决策仍未关闭。
- 2026-06-26T05:31:48+08:00：接入 Agent Launcher 进程自然结束桌面通知，不标记桌面插件整体验收完成。
  - 实际修改：`src/features/terminal/XtermPane.tsx` 新增 `onSessionFinished` 窄回调，使用 ref 透传到 runtime，避免回调身份变化导致终端重建。
  - 实际修改：`src/features/terminal/XtermPane.runtime.ts` 在真实 terminal output `closed` 事件上报 `{ sessionId, reason: "closed", durationMs }`；手动断开、组件卸载和旧 run 的 closed 事件仍被现有 `sessionRun`/`disposed` 门禁过滤，不会误触发 Agent 通知。
  - 实际修改：`src/features/tool-panel/AgentLauncherToolContent.tsx` 消费 `onSessionFinished`，当用户启用 `desktopNotifications` 后发送 `agent.process.finished` 通知；payload 只包含 agent 名称、耗时和 `exitCode: null`，不包含 CLI 命令、cwd、env、prompt 或 MCP endpoint；同一 terminal session 只通知一次。
  - 实际修改：`src/features/tool-panel/ToolPanel.tsx` 将 `settings?.desktopNotifications` 透传给 Agent Launcher；未改工具栏布局、tmux、SFTP 或旧 AI provider 行为。
  - 测试更新：`src/features/tool-panel/AgentLauncherToolContent.test.tsx` mock desktop notification API，覆盖 Agent 结束通知和 payload 不含 `.kerminal` 路径、`KERMINAL_MCP_ENDPOINT`、CLI 参数；`src/features/terminal/XtermPane.test.tsx` 覆盖 runtime closed output handler 触发 `onSessionFinished`。
  - 协作同步：本轮修改 `lane-current-agent-sidebar-terminal-polish` owned paths `AgentLauncherToolContent.tsx` / `.test.tsx`、`XtermPane.tsx` / `.runtime.ts` / `.test.tsx`，已先读取该 lane checkpoint、status 和当前 diff；只追加通知生命周期回调，不重排 overlay runtime、Agent 终端错层修复、Xterm 布局或右栏视觉结构。
  - 验证通过：`npm run test:frontend -- src/features/tool-panel/AgentLauncherToolContent.test.tsx src/features/terminal/XtermPane.test.tsx src/lib/desktopNotificationPolicy.test.ts src/lib/desktopNotificationApi.test.ts`，4 files / 53 tests passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过，用时约 5m05s；仅保留既有 Tauri API dynamic import 和 large chunk warning。
  - 启动门禁通过：`npm run dev -- --host 127.0.0.1 --port 1448 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1448/` 返回 `StatusCode=200 RawContentLength=644`；临时 dev server 已 Ctrl+C 停止，`1448` 端口确认 `released`。
  - 未执行：`npm run tauri:dev`。只读检查显示 `127.0.0.1:1425` 仍由 node PID `26528` 监听，并且已有 `tauri dev` PID `120696` 与 `target\debug\kerminal.exe` PID `105328` 运行；不擅自停止用户/其它 lane 窗口，也不通过 single-instance 聚焦旧进程冒充本轮新代码验证。
  - 仍未完成：真实 Windows `tauri:dev` 双实例/window-state/通知/日志/剪贴板 smoke、macOS 构建/启动/单实例/通知/日志/window-state/剪贴板验收、SFTP macOS 原生文件 pasteboard 对等方案或明确产品降级决策仍未关闭。
- 2026-06-26T05:42:49+08:00：关闭 SFTP 系统文件剪贴板 macOS 语义待决策项，不标记桌面插件整体验收完成。
  - 实际新增：`.updeng/docs/decisions/ADR-0021-desktop-clipboard-platform-policy.md`，将剪贴板拆成文本剪贴板、SFTP 内部文件传输剪贴板和系统文件列表剪贴板三层。
  - 决策结果：文本剪贴板是 Windows/macOS 同等支持能力，统一走官方 `clipboard-manager` + `desktopClipboardApi` facade；SFTP 内部复制/粘贴和本机拖放是 Windows/macOS 都支持的文件传输路径；系统文件列表剪贴板首期只承诺 Windows native `clipboard-win::formats::FileList`，macOS 不宣称 Finder `NSPasteboard` 文件列表互操作，用户可见降级为 Kerminal 内部 SFTP clipboard 和拖放。
  - 证据对齐：当前 `transfer_paths.rs` 非 Windows 读取/写入系统文件剪贴板会返回显式中文降级错误，不再伪装空剪贴板成功；`sftp_service` 测试已覆盖平台支持判断和非 Windows 降级。
  - 文档同步：更新 `plan/INDEX.md`、`in-progress.md` 和 `coordination/lanes.json`，把 ADR-0021 加入本 lane owned paths；SFTP 系统文件剪贴板不再作为“待决策”项保留。
  - 验证通过：`node -e "JSON.parse(require('fs').readFileSync('.updeng/docs/coordination/lanes.json','utf8')); console.log('lanes-json-ok')"`，`lanes-json-ok`。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test sftp_service system_file_clipboard -- --nocapture`，1 passed。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed。
  - 验证通过：`npm run test:frontend -- src/lib/desktopClipboardApi.test.ts`，1 file / 6 tests passed。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test sftp_service`，46 passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过，用时约 5m18s；仅保留既有 Tauri API dynamic import 和 large chunk warning。
  - 启动门禁通过：`npm run dev -- --host 127.0.0.1 --port 1449 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1449/` 返回 `StatusCode=200 RawContentLength=644`；临时 dev server 已 Ctrl+C 停止，`1449` 端口确认 released。
  - 未执行：`npm run tauri:dev`。只读检查显示 `127.0.0.1:1425` 仍由 node PID `26528` 监听，并且已有 `tauri dev` PID `120696` 与 `target\debug\kerminal.exe` PID `105328` 运行；不擅自停止用户/其它 lane 窗口，也不通过 single-instance 聚焦旧进程冒充本轮新代码验证。
  - 仍未完成：真实 Windows `tauri:dev` 双实例/window-state/通知/日志/剪贴板 smoke 和 macOS 构建/启动/单实例/通知/日志/window-state/文本剪贴板/SFTP 内部 clipboard/拖放降级验收仍未关闭，计划不能移到 done。
- 2026-06-26T06:17:08+08:00：尝试不打断现有窗口的隔离 Windows `tauri dev` smoke，取得部分真实桌面证据，同时发现隔离 WebView/Vite 响应阻断，仍不关闭 Windows 门禁。
  - 隔离方式：新增 scratch 配置 `.updeng/tmp/tauri-plugin-smoke.config.json`，通过 `--config` 覆盖 `productName=kerminal-codex-smoke`、`identifier=io.github.kongweiguang.kerminal.codex-smoke`、`build.devUrl=http://127.0.0.1:1451`、`beforeDevCommand=npm run dev -- --host 127.0.0.1 --port 1451 --strictPort` 和 1451 dev CSP；运行时设置 `KERMINAL_CONFIG_ROOT=.updeng/tmp/tauri-plugin-smoke-root`、`CARGO_TARGET_DIR=src-tauri/target-codex-tauri-plugin-smoke`，避免碰默认 `~/.kerminal`、默认 `target\debug\kerminal.exe` 和当前 1425 运行窗口。
  - 真实启动证据：`npm run tauri -- dev --no-watch --config .updeng/tmp/tauri-plugin-smoke.config.json` 完成隔离 Rust dev 构建并启动 `src-tauri/target-codex-tauri-plugin-smoke/debug/kerminal.exe`；构建输出包含 `tauri-plugin-log`、`tauri-plugin-notification`、`tauri-plugin-clipboard-manager`、`tauri-plugin-window-state`、`tauri-plugin-single-instance`；主进程日志记录 setup、AppState、config watcher、window icon、close-to-tray、tray 和 setup completed。
  - 隔离数据根证据：`.updeng/tmp/tauri-plugin-smoke-root` 生成 `.mcp.json`、`AGENTS.md`、`CLAUDE.md`、`kerminal-config.md`、`settings.toml`、profiles、`data/command.sqlite` 和 `logs/kerminal.log`；`kerminal.log` 只包含本轮隔离生命周期日志。
  - 窗口证据：Win32 top-level window 枚举看到隔离进程 PID `135728` 的可见窗口标题 `Kerminal Smoke`，并有 single-instance helper 窗口 `io.github.kongweiguang.kerminal.codex-smoke-siw`。
  - single-instance smoke 通过：再次启动隔离 binary 后第二进程 PID `71660` 在 3 秒内退出；主实例日志追加 `single-instance activation requested; focusing main window` 和 `main window show and focus requested`。
  - 独立 Vite 对照通过：`npm run dev -- --host 127.0.0.1 --port 1452 --strictPort` 后 `curl.exe -I --max-time 5 http://127.0.0.1:1452/` 返回 `HTTP/1.1 200 OK`；1452 已停止并确认释放。
  - 隔离 tauri dev 阻断：1451 端口 `TcpTestSucceeded=True`，但 `curl.exe -I --max-time 5 http://127.0.0.1:1451/` 超时，Node HTTP probe 5 秒后 `timeout`/`ECONNRESET`；说明隔离 `tauri dev` 中 Vite/WebView 组合出现请求处理卡住，不能作为前端加载完成证据。
  - window-state 缺口：在隔离 app local data 中未找到 `window-state` 状态文件；本轮没有完成正常退出/重启恢复闭环，不能证明 size/position/maximized restore。
  - 未验证：Windows 通知权限/发送、真实 Tauri 文本剪贴板读写、SFTP Windows native file list、window-state 恢复、默认 1425 环境双实例，以及 macOS 全矩阵。
  - 清理：已精确停止本轮隔离 `tauri dev` 进程组；1451/1452 端口释放。保留 `.updeng/tmp/tauri-plugin-smoke.config.json`、`.updeng/tmp/tauri-plugin-smoke-root` 和 `src-tauri/target-codex-tauri-plugin-smoke` 作为 scratch 证据，不纳入长期交付。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed。
  - 验证通过：`npm run test:frontend -- src/lib/desktopClipboardApi.test.ts src/lib/desktopNotificationPolicy.test.ts src/lib/desktopNotificationApi.test.ts src/lib/appLog.test.ts`，4 files / 27 tests passed。
  - 仍未完成：需要先解决或规避隔离 `tauri dev` 的 1451 HTTP 卡住，再关闭 Windows WebView 前端加载、window-state、通知、剪贴板真实交互门禁；macOS 构建/启动/单实例/通知/日志/window-state/文本剪贴板/SFTP 内部 clipboard/拖放降级验收仍未执行，计划不能移到 done。
- 2026-06-26T06:55:15+08:00：补齐不打断当前 1425 用户窗口的隔离 Windows `tauri dev` smoke，大部分 Windows 桌面插件门禁已关闭；macOS 和当前系统剪贴板锁仍未关闭。
  - 隔离方式沿用 scratch 配置 `.updeng/tmp/tauri-plugin-smoke.config.json`，运行时使用 `KERMINAL_CONFIG_ROOT=.updeng/tmp/tauri-plugin-smoke-root-cdp`、`CARGO_TARGET_DIR=src-tauri/target-codex-tauri-plugin-smoke-run2`、`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=1459` 和 `devUrl=http://127.0.0.1:1451`，未触碰默认 1425 dev server、默认 target 或用户 `~/.kerminal`。
  - WebView/Vite 阻断已规避并验证通过：`curl.exe -I --max-time 5 http://127.0.0.1:1451/` 返回 `HTTP/1.1 200 OK`；CDP 页面 `readyState=complete`、`rootChildCount=1`、`hasTauriInternals=object`，body 包含 Kerminal 主机树空态文案。
  - notification/log smoke 通过：CDP 动态导入官方插件后 `requestPermission()` 返回 `granted`，`sendNotification({ title: "Kerminal smoke" ... })` 成功；`@tauri-apps/plugin-log.info()` 成功写入 `.updeng/tmp/tauri-plugin-smoke-root-cdp/logs/kerminal.log`，日志含 `[desktop.smoke] plugin smoke from CDP`。
  - capability 负向验证通过：CDP 调用 `windowState.saveWindowState(...)` 和 `windowState.filename()` 均被拒绝，错误明确要求 `window-state:allow-save-window-state` / `window-state:allow-filename` / `window-state:default`；这证明本轮没有为验证放开前端 `window-state:` 权限。
  - window-state size/position 恢复通过：用 Win32 `MoveWindow` 将隔离主窗口移到 `left=187 top=143 width=1312 height=864`，经 `process.exit(0)` 正常退出后，`%APPDATA%\io.github.kongweiguang.kerminal.codex-smoke\.window-state.json` 生成；重启同一隔离 app 后 Win32 rect 精确恢复为 `left=187 top=143 width=1312 height=864`。
  - window-state maximized 恢复通过：CDP 调用已授权 `toggleMaximize()` 后 `isMaximized()` 返回 `true`；正常退出后 `.window-state.json` 保存 `maximized=true`，重启同一隔离 app 后 Win32 `IsZoomed=true`，主窗口以最大化状态显示。
  - close-to-tray + single-instance 聚焦通过：CDP 调用已授权 `window.close()` 后主窗口 `visible=false` 且进程仍在；启动第二个隔离 binary 后第二进程 PID `93296` 在 3 秒内退出且 exit code `0`，主窗口恢复 `visible=true`，日志追加 `single-instance activation requested; focusing main window` 和 `main window show and focus requested`。
  - Windows 文本剪贴板真实写读未关闭，原因是当前系统剪贴板全局不可用：Tauri `clipboard-manager.writeText/readText` 8 次退避重试均报 `The native clipboard is not accessible due to being held by another party.`；系统对照 `cmd /c "echo ... | clip"` 返回 `ERROR: Access is denied.`，`Set-Clipboard/Get-Clipboard` 也未能读回文本；`GetOpenClipboardWindow` 当时未返回 owner。该项记录为环境阻塞，不通过结束其它用户进程规避。
  - SFTP Windows native system file list smoke 未关闭，原因同上：当前系统剪贴板被全局拒绝访问，不能验证 `clipboard-win::formats::FileList` 的真实读写；此前 `cargo test --target-dir target-codex-tauri-plugins --test sftp_service system_file_clipboard -- --nocapture` 已覆盖平台支持判断，但不替代真实系统剪贴板 smoke。
  - 仍未完成：macOS 构建/启动/single-instance/window-state/notification/log/文本剪贴板/SFTP 内部 clipboard/拖放降级验收未执行；Windows 文本剪贴板和 SFTP native file-list 需在系统剪贴板恢复可用后重跑；计划不能移到 done。
- 2026-06-26T09:08:42+08:00：补强官方 `clipboard-manager` 文本 facade 的生产韧性，不关闭系统剪贴板环境 blocker。
  - 实际修改：`src/lib/desktopClipboardApi.ts` 为 `readDesktopClipboardText()` 和 `writeDesktopClipboardText()` 增加短退避重试，默认延迟为 `50ms/100ms/200ms/400ms`；调用方契约不变，读失败仍返回空字符串，写失败仍返回 `{ ok: false, reason: "transport-error" }`。
  - 设计边界：重试只在项目 clipboard facade 内部生效，业务组件和终端/SFTP/tmux/snippets 等调用方无需各自实现 retry；测试可通过 `retryDelaysMs` 和 `wait` 注入避免真实等待。
  - 覆盖场景：`desktopClipboardApi.test.ts` 新增 transient read/write 失败后成功的用例，并保留耗尽重试后不抛出、返回原有失败结果的契约。
  - 验证通过：`npm run test:frontend -- src/lib/desktopClipboardApi.test.ts`，1 file / 8 tests passed。
  - 验证通过：`npm run test:frontend -- src/lib/desktopClipboardApi.test.ts src/lib/terminalApi.test.ts`，2 files / 20 tests passed。
  - 验证通过：`npm run build`，`tsc && vite build` 通过，用时约 32s；仅保留既有 Tauri API dynamic import 和 large chunk warning。
  - 启动门禁通过：`npm run dev -- --host 127.0.0.1 --port 1453 --strictPort` 启动成功；`curl.exe -I --max-time 5 http://127.0.0.1:1453/` 返回 `HTTP/1.1 200 OK`；临时 dev server 已 Ctrl+C 停止，1453 端口确认释放。
  - 未执行新的真实 Tauri clipboard smoke：本轮未改 Rust/plugin/capability/window 代码；上一轮真实 Tauri 插件 smoke 已证明插件可加载和权限边界，当前 Windows 系统剪贴板仍全局 `Access is denied`，即使重试也无法关闭 BLK-20260626-001。需在系统剪贴板恢复可用或干净 Windows 会话中重跑。
  - 仍未完成：macOS 构建/启动/single-instance/window-state/notification/log/文本剪贴板/SFTP 内部 clipboard/拖放降级验收未执行；Windows 文本剪贴板和 SFTP native file-list 真实 smoke 仍依赖系统剪贴板恢复可用。
- 2026-06-26T09:22:49+08:00：系统剪贴板恢复后补跑隔离 Windows clipboard smoke，关闭 BLK-20260626-001；macOS 门禁仍未关闭。
  - 系统剪贴板前置检查通过：`cmd /c "echo kerminal-clipboard-probe| clip"` 无错误；`Set-Clipboard` / `Get-Clipboard` 成功读回 `kerminal-clipboard-probe-ps`。
  - 隔离方式：使用 `.updeng/tmp/tauri-plugin-smoke.config.json`，运行时设置 `KERMINAL_CONFIG_ROOT=.updeng/tmp/tauri-plugin-smoke-root-clipboard`、`CARGO_TARGET_DIR=src-tauri/target-codex-tauri-plugin-smoke-clipboard`、`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=1459`，未触碰默认 1425 用户窗口、默认 target 或用户 `~/.kerminal`。
  - 启动证据：`npm run tauri -- dev --no-watch --config .updeng/tmp/tauri-plugin-smoke.config.json` 完成独立 target 编译并启动隔离 `kerminal-codex-smoke`；`curl.exe -I --max-time 5 http://127.0.0.1:1451/` 返回 `HTTP/1.1 200 OK`；CDP `http://127.0.0.1:1459/json` 可见 WebView 页面。
  - Windows 文本剪贴板真实 smoke 通过：通过 Playwright CDP 在隔离 WebView 中加载官方 `/node_modules/@tauri-apps/plugin-clipboard-manager/dist-js/index.js`，执行 `writeText("kerminal-tauri-clipboard-1782436894624")` 后 `readText()` 读回同一 token，`textOk=true`。
  - SFTP Windows native file-list 真实 smoke 通过：用 `powershell.exe -NoProfile -STA` 将 `.updeng/tmp/sftp-file-list-smoke.txt` 作为 CF_HDROP 文件列表写入系统剪贴板；随后通过 CDP 调 `@tauri-apps/api/core.invoke("sftp_read_local_file_clipboard")` 返回 1 条 `{ path: "...sftp-file-list-smoke.txt", kind: "file" }`，`hasSmokeFile=true`。
  - 验证通过：`cargo test --target-dir target-codex-tauri-plugins --test sftp_service system_file_clipboard -- --nocapture`，1 passed。
  - 清理：隔离 `tauri dev` 已停止；1451/1459 仅剩 TIME_WAIT，无 `target-codex-tauri-plugin-smoke-clipboard` 或 smoke config 相关残留进程。
  - 文档同步：`BLK-20260626-001` 已从当前 blocker 表移除；该 blocker 的关闭证据保留在本 Round Log。
  - 仍未完成：当前机器是 Windows，macOS 构建/启动/single-instance/window-state/notification/log/文本剪贴板/SFTP 内部 clipboard/拖放降级验收未执行；`BLK-20260626-002` 继续保持 open，计划不能移到 done。
- 2026-06-26T09:36:59+08:00：补齐 macOS 验证交接 runbook，不标记生产级完成。
  - 实际新增：`.updeng/docs/verification/tauri-desktop-plugin-macos-validation-runbook.md`，覆盖 macOS 环境预检、自动化门禁、真实 `tauri:dev` 启动、single-instance、window-state、notification granted/denied、日志脱敏、官方文本 clipboard、SFTP 内部 clipboard/拖放降级和 `tauri:build` 验收。
  - 文档同步：本计划新增“macOS 验证执行入口”，明确 Windows smoke 已完成但 macOS 是唯一剩余生产门禁；macOS 验证通过前 `BLK-20260626-002` 继续 open，本计划不能移到 `done`。
  - 代码复核：通过 CodeGraph 复查 `desktop_plugins.rs`、`lib.rs`、`tauri_security_config.rs` 和 `desktopClipboardApi`/通知/日志 facade；未发现新的实现缺口。本轮未修改生产代码。
  - 仍未完成：当前机器是 Windows，未执行 macOS 构建/启动/single-instance/window-state/notification/log/文本剪贴板/SFTP 内部 clipboard/拖放降级验收。
- 2026-06-26T09:44:18+08:00：新增 macOS 自动化验证助手，不标记 macOS 验收完成。
  - 实际新增：`scripts/verify-tauri-desktop-plugins-macos.mjs`，macOS 上可运行环境预检、前端桌面插件 tests、`tauri_security_config`、`sftp_service system_file_clipboard`、`npm run build`，并生成 JSON 报告与 Round Log 回填模板。
  - 文档同步：`.updeng/docs/verification/tauri-desktop-plugin-macos-validation-runbook.md` 增加脚本入口，明确脚本只覆盖可自动化部分，真实 `tauri:dev`、single-instance、window-state、notification granted/denied、文本 clipboard UI、SFTP 内部 clipboard/拖放降级仍需 macOS 人工验收。
  - 本地验证：Windows 本机只执行脚本 dry-run，不执行 macOS 验收；`BLK-20260626-002` 继续 open。
- 2026-06-26T09:49:25+08:00：验证 macOS 自动化助手 dry-run，不标记 macOS 验收完成。
  - 实际修改：`scripts/verify-tauri-desktop-plugins-macos.mjs` 的 dry-run Round Log 模板现在明确标注 `dry-run only; macOS acceptance not executed`，并写明不关闭 `BLK-20260626-002`，避免把 Windows dry-run 报告误读为 macOS 验收通过。
  - 验证通过：`node -c scripts/verify-tauri-desktop-plugins-macos.mjs`，语法检查通过。
  - 验证通过：`node scripts/verify-tauri-desktop-plugins-macos.mjs --dry-run`，成功生成 `.updeng/docs/verification/tauri-desktop-plugin-macos-validation-automated.json` 和 `.updeng/docs/verification/tauri-desktop-plugin-macos-validation-round-log.md`；报告内为 `platform=win32`、`dryRun=true`，所有命令均为 `dry-run`。
  - 协作登记：`.updeng/docs/coordination/lanes.json` 已把脚本和两个验证报告文件登记到 `lane-tauri-desktop-plugin-hardening` 的 `ownedPaths`。
  - 仍未完成：当前机器是 Windows，未执行 macOS 构建/启动/single-instance/window-state/notification/log/文本剪贴板/SFTP 内部 clipboard/拖放降级验收；`BLK-20260626-002` 继续 open，计划不能移到 done。
- 2026-06-26T09:56:11+08:00：新增 macOS 自动化 CI 辅助门禁，不标记 macOS 验收完成。
  - 实际新增：`.github/workflows/tauri-desktop-plugin-macos.yml`，在 `macos-latest` 上安装 Node/Rust 依赖并运行 `node scripts/verify-tauri-desktop-plugins-macos.mjs`；workflow 会上传自动化 JSON 报告和 Round Log 模板，`workflow_dispatch` 可选打开 `--tauri-build`。
  - 文档同步：`.updeng/docs/verification/tauri-desktop-plugin-macos-validation-runbook.md` 增加 GitHub Actions 入口，明确 CI 只覆盖自动化命令，不能替代真实 `tauri:dev`、single-instance、window-state、notification、clipboard UI 和 SFTP 拖放人工验收。
  - 协作登记：`.updeng/docs/coordination/lanes.json` 已把新 workflow 登记到 `lane-tauri-desktop-plugin-hardening` 的 `ownedPaths`。
  - 本地验证缺口：当前 Windows 环境缺少 `actionlint`/Ruby/YAML 解析器，未做完整 GitHub Actions lint；workflow 结构按项目既有 Actions 样式编写，最终有效性需由 GitHub Actions 真跑确认。
  - 仍未完成：当前机器是 Windows，未执行 macOS 构建/启动/single-instance/window-state/notification/log/文本剪贴板/SFTP 内部 clipboard/拖放降级验收；`BLK-20260626-002` 继续 open，计划不能移到 done。
- 2026-06-26T10:05:59+08:00：按用户更新后的验收口径完成收口。
  - 口径更新：用户明确说明 macOS 本地测不了可以接受，要求代码逻辑闭环即可；因此 `BLK-20260626-002` 不再作为阻止本计划完成的硬门禁，macOS 真实验收保留为发布前/有机器时的验证入口。
  - 完成证据：`window-state`、`single-instance`、`notification`、`log`、官方 `clipboard-manager` 已在依赖、注册顺序、capability 白名单、facade、ADR-0021、runbook 和 Windows 隔离真实 smoke 中形成闭环；macOS 侧由跨平台 adapter、非 Windows 降级测试、macOS 自动化助手和 GitHub Actions 门禁承接。
  - 验证通过：`cargo test --manifest-path src-tauri/Cargo.toml --target-dir target-codex-tauri-plugins --test tauri_security_config`，6 passed。
  - 验证通过：`cargo test --manifest-path src-tauri/Cargo.toml --target-dir target-codex-tauri-plugins --test sftp_service system_file_clipboard -- --nocapture`，1 passed。
  - 验证通过：`npm run test:frontend -- src/lib/desktopClipboardApi.test.ts src/lib/desktopNotificationPolicy.test.ts src/lib/desktopNotificationApi.test.ts src/lib/appLog.test.ts`，4 files / 29 tests passed。
  - 验证通过：`node -c scripts/verify-tauri-desktop-plugins-macos.mjs` 和 `node scripts/verify-tauri-desktop-plugins-macos.mjs --dry-run`。
  - 本地未验证：当前机器仍是 Windows，未执行 macOS 真实 `tauri:dev` 和人工窗口/通知/拖放验收；该残余风险已记录在 macOS runbook 与 CI 入口，不再阻塞本计划 done。
- 2026-06-26T10:12:55+08:00：补充当前工作区前端生产构建和 dev server 冒烟。
  - 验证通过：`npm run build`，`tsc && vite build` 通过；仅保留既有 Tauri API dynamic import 和 chunk size warning。
  - 启动门禁通过：`npm run dev -- --host 127.0.0.1 --port 1454 --strictPort` 启动成功；`Invoke-WebRequest http://127.0.0.1:1454/` 返回 `StatusCode=200 RawContentLength=644`。
  - 清理：临时 dev server 已 Ctrl+C 停止，1454 端口确认 `1454-released`。
