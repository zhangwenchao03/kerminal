# Tauri desktop plugin macOS validation runbook

关联计划：`.updeng/docs/plan/done/PLAN-20260625-235439-tauri-desktop-plugin-hardening.md`

本 runbook 用于在有 macOS 机器或 CI runner 时复查 Tauri 桌面插件能力。当前目标口径允许本地无法执行 macOS 实机验收时先以跨平台代码逻辑、自动化测试和 CI/runbook 闭环完成计划；macOS 真实启动和人工交互验收仍作为发布前风险复查入口。

## 验收目标

- macOS 上能完成构建、真实启动和 WebView 加载。
- `single-instance` 二次启动只聚焦既有窗口，不重复初始化运行态。
- `window-state` 能恢复 size、position、maximized，且显示器变化后不落到屏幕外。
- `notification` 在 granted 和 denied 场景都有记录，不在启动时主动打扰。
- `log` 写入 Kerminal 管理日志目录，日志不包含凭据、token、私钥、prompt 或完整命令参数。
- 官方 `clipboard-manager` 文本写读在 macOS 可用。
- SFTP 内部 clipboard 与 Finder 拖放可用；Finder 文件列表系统剪贴板按 ADR-0021 降级，不宣称 macOS 原生互操作。

## 准备

在 macOS 机器上确认基础环境：

```bash
sw_vers
uname -a
node --version
npm --version
rustc --version
cargo --version
xcode-select -p
```

如果依赖不是当前 worktree 的最新状态，先执行：

```bash
npm ci
```

推荐先运行自动化助手生成可回填报告：

```bash
node scripts/verify-tauri-desktop-plugins-macos.mjs
```

该脚本会执行环境预检、前端聚焦测试、Tauri capability 安全测试、SFTP 系统文件剪贴板平台测试和前端 production build，并输出：

- `.updeng/docs/verification/tauri-desktop-plugin-macos-validation-automated.json`
- `.updeng/docs/verification/tauri-desktop-plugin-macos-validation-round-log.md`

脚本只覆盖可自动化部分；真实 `tauri:dev`、窗口状态、通知权限、剪贴板 UI 和 SFTP 拖放仍按下面的人工验收执行。

也可以通过 GitHub Actions 手动触发或在相关 PR 中查看自动化门禁：

- workflow：`.github/workflows/tauri-desktop-plugin-macos.yml`
- job：`Automated macOS plugin gates`
- 产物：`tauri-desktop-plugin-macos-validation`

该 workflow 在 `macos-latest` 上运行同一个脚本，并上传 JSON 报告与 Round Log 模板。它只证明自动化命令在 macOS runner 上通过；不能替代下面的真实 `tauri:dev`、single-instance、window-state、notification、clipboard UI 和 SFTP 拖放人工验收。

创建隔离运行目录，避免污染真实 `~/.kerminal`：

```bash
export KERMINAL_CONFIG_ROOT="$(pwd)/.updeng/tmp/tauri-plugin-macos-root"
export CARGO_TARGET_DIR="$(pwd)/src-tauri/target-codex-tauri-plugin-macos"
mkdir -p "$KERMINAL_CONFIG_ROOT"
```

## 自动化前置

如果不使用自动化助手，也可以手动跑最小自动化门禁：

```bash
npm run test:frontend -- src/lib/desktopClipboardApi.test.ts src/lib/desktopNotificationPolicy.test.ts src/lib/desktopNotificationApi.test.ts src/lib/appLog.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --target-dir "$CARGO_TARGET_DIR" --test tauri_security_config
cargo test --manifest-path src-tauri/Cargo.toml --target-dir "$CARGO_TARGET_DIR" --test sftp_service system_file_clipboard -- --nocapture
npm run build
```

通过标准：

- frontend tests 全部 green。
- `tauri_security_config` 全部 green。
- `sftp_service system_file_clipboard` 在 macOS 上应证明系统文件剪贴板是明确降级，不是伪装成功。
- `npm run build` 通过，只允许记录既有 dynamic import 或 chunk size warning。

## 真实启动

启动真实 Tauri dev app：

```bash
KERMINAL_CONFIG_ROOT="$KERMINAL_CONFIG_ROOT" CARGO_TARGET_DIR="$CARGO_TARGET_DIR" npm run tauri:dev
```

验收记录：

- 主窗口出现，首屏不是白屏。
- 设置页、SFTP 工作台、日志工具入口能打开。
- `"$KERMINAL_CONFIG_ROOT/logs/kerminal.log"` 生成。
- 退出本轮 app 前保留终端输出、日志尾部和至少 1 张截图路径。

## Single Instance

在第一个实例运行时，另开一个终端执行：

```bash
KERMINAL_CONFIG_ROOT="$KERMINAL_CONFIG_ROOT" "$CARGO_TARGET_DIR/debug/kerminal" &
```

如果 macOS 构建产物不是该路径，先用下面命令定位：

```bash
find "$CARGO_TARGET_DIR/debug" -maxdepth 3 -type f -name "kerminal*" -print
```

验收场景：

- 主窗口已打开时，第二实例快速退出，主窗口获得焦点。
- 主窗口最小化时，第二实例恢复并聚焦。
- 关闭主窗口但不退出 app 时，第二实例能重新显示主窗口。
- 已有 terminal pane 或 SFTP workbench 时，第二实例不会创建重复 pane、重复 MCP server 或重复默认配置写入。

日志应出现脱敏生命周期记录：

```bash
grep -n "single-instance activation requested" "$KERMINAL_CONFIG_ROOT/logs/kerminal.log"
```

## Window State

执行三组真实操作：

1. 调整主窗口到非默认大小和位置，退出 app，重启后确认 size/position 恢复。
2. 最大化主窗口，退出 app，重启后确认 maximized 恢复。
3. 如果有外接显示器，先把窗口放在副屏，退出 app，断开副屏后重启，确认窗口回落到可见区域。

记录证据：

- 重启前后截图。
- 窗口状态文件路径。macOS Tauri 默认 app data 目录可能在 `~/Library/Application Support` 下；只在 Round Log 记录路径类型，不记录私有用户名。
- 若恢复失败，记录实际位置、显示器数量和缩放信息。

## Notification

不要在启动时主动请求权限。先在设置页启用桌面通知，再用 Web Inspector 或真实事件触发。

Web Inspector console 验证：

```javascript
const n = await import('/node_modules/@tauri-apps/plugin-notification/dist-js/index.js');
await n.requestPermission();
n.sendNotification({ title: 'Kerminal smoke', body: 'macOS notification plugin smoke' });
```

验收场景：

- granted：能看到系统通知。
- denied：系统设置中拒绝 Kerminal 通知后，Kerminal 不反复请求权限；真实事件只记录跳过原因。
- 真实事件至少选择一项：SFTP 传输完成/失败、MCP Server 启动失败、Agent Launcher 进程自然结束。
- 通知正文不包含本地/远端完整路径、prompt、token、端点或凭据。

## Log

检查日志文件：

```bash
ls -lah "$KERMINAL_CONFIG_ROOT/logs"
tail -n 120 "$KERMINAL_CONFIG_ROOT/logs/kerminal.log"
grep -En "password|passwd|token|api[_-]?key|secret|private key|KERMINAL_MCP_ENDPOINT|BEGIN .*PRIVATE KEY" "$KERMINAL_CONFIG_ROOT/logs/kerminal.log" || true
```

通过标准：

- 日志文件在 Kerminal 管理日志目录中，不依赖 OS 默认不可控位置。
- 能看到 `desktop.lifecycle`、single-instance 或 setup 相关记录。
- grep 命中必须逐条解释；真实 secret、token、私钥、prompt、完整命令参数不能落盘。
- 诊断包或日志工具页只展示日志元数据，不把日志正文默认打包给外部 agent。

## Text Clipboard

Web Inspector console 验证官方 `clipboard-manager`：

```javascript
const c = await import('/node_modules/@tauri-apps/plugin-clipboard-manager/dist-js/index.js');
const token = `kerminal-macos-clipboard-${Date.now()}`;
await c.writeText(token);
const value = await c.readText();
({ token, value, ok: value === token });
```

再做真实 UI smoke：

- 终端选中文本复制，再粘贴到同一终端或系统文本编辑器。
- 命令块复制文本。
- tmux quickref 复制命令。
- SFTP 路径或文件名复制。

通过标准：

- Web Inspector direct smoke 返回 `ok: true`。
- UI 复制入口都走项目 facade，用户不再看到浏览器剪贴板权限弹框。
- 临时系统剪贴板占用时，可重试成功；持续失败时 UI 给出失败反馈，不抛未处理异常。

## SFTP File Clipboard And Drag Drop

验证 Kerminal 内部能力：

- 在 SFTP workbench 内部复制本地文件条目并粘贴到另一个 Kerminal pane 或目录。
- 从 Finder 拖入本地文件到 Kerminal SFTP 本地 pane，确认进入传输/选择流程。
- 从 Kerminal 内部复制远端文件，再粘贴到目标目录，确认不依赖 Finder 文件列表 pasteboard。

验证 macOS 系统文件列表剪贴板降级：

- 在 Finder 中复制一个文件。
- 在 Kerminal SFTP 中尝试读取系统文件剪贴板。
- 期望结果：展示或返回“当前平台暂不支持读取系统文件剪贴板，请使用 Kerminal SFTP 内部复制/粘贴或拖放本机文件”等同义降级提示。

通过标准：

- 内部 clipboard 和拖放路径可用。
- Finder 文件列表系统剪贴板没有伪装成功，也不会破坏内部 clipboard。
- 该降级行为和 ADR-0021 一致。

## Packaging

在 macOS 上尝试打包：

```bash
KERMINAL_CONFIG_ROOT="$KERMINAL_CONFIG_ROOT" CARGO_TARGET_DIR="$CARGO_TARGET_DIR" npm run tauri:build
```

通过标准：

- 如果构建通过，记录 `.app` / `.dmg` 产物路径和通知/日志/启动复查结果。
- 如果因为签名、notarization、证书或平台链路失败，记录完整错误摘要和可复现命令；这类外部凭据问题可以作为打包 blocker，但不能替代 `tauri:dev` 运行验收。

## 回填格式

通过或失败后，把结果追加到 active plan 的 Round Log：

```markdown
- YYYY-MM-DDTHH:mm:ss+TZ：macOS Tauri desktop plugin validation <passed|blocked|failed>。
  - 环境：macOS <version>，Node <version>，Rust <version>，Xcode CLT <version>。
  - 自动化：<命令和通过/失败摘要>。
  - 启动：<tauri:dev 是否启动、截图/日志路径>。
  - single-instance：<场景结果>。
  - window-state：<size/position/maximized/显示器变化结果>。
  - notification：<granted/denied/真实事件结果>。
  - log：<日志路径类型、脱敏检查结果>。
  - clipboard：<direct plugin token 结果、UI 复制入口结果>。
  - SFTP：<内部 clipboard、拖放、Finder 文件列表降级结果>。
  - tauri:build：<通过或阻塞原因>。
  - 结论：<macOS 自动化与人工验收是否通过；是否存在发布前残余风险>。
```

通过条件：

- 上述 `tauri:dev`、single-instance、window-state、notification、log、text clipboard、SFTP 内部 clipboard/拖放降级均通过。
- 把结果写回对应计划 Round Log 或发布验证记录。
- 若 CI 或实机失败，记录具体命令、错误摘要和需要重跑的场景。
