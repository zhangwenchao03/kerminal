---
id: PLAN-20260629-100410-settings-notification-nav-fix
status: done
created_at: 2026-06-29T10:04:10+08:00
started_at: 2026-06-29T10:04:10+08:00
completed_at: 2026-06-29T10:32:59+08:00
updated_at: 2026-06-29T10:32:59+08:00
owner: ai
lane: lane-settings-notification-nav-fix
---

# 设置通知入口点击修复

## 目标
- 修复设置页左侧“桌面/通知”分类无法点击或点击后不显示通知设置的问题。
- 修复桌面通知开关点击后被后端设置响应冲回默认值的问题。
- 补一个聚焦回归信号，确保左侧设置分类能切换到桌面通知面板。
- 完成前运行前端构建和真实 dev server 冒烟；若无法运行桌面壳，记录原因。

## 非目标
- 不重构整个设置页布局。
- 不调整通知发送策略、系统权限策略或后端 Tauri 通知插件。
- 不回滚当前工作区已有的同步设置入口等未归因改动。

## 影响范围
- `src/features/settings/SettingsToolContent.tsx`
- `src/features/settings/settings-tool-content/*`
- `src/features/settings/SettingsToolContent*.test.tsx`
- `src-tauri/src/models/settings.rs`
- `src-tauri/tests/settings_service.rs`
- `.updeng/docs/plan/INDEX.md`
- `.updeng/docs/in-progress.md`
- `.updeng/docs/coordination/lanes.json`

## 执行步骤
- [x] TASK-001：复现并定位左侧通知入口点击失败根因，优先用聚焦 React 交互测试和真实页面冒烟确认。
- [x] TASK-002：实施最小修复，确保“桌面/通知”分类可点击、可聚焦，并显示 `settings-desktop-panel`。
- [x] TASK-003：运行相关测试、`npm run build` 和 dev server 真实启动/截图验证；记录无法覆盖项。
- [x] TASK-004：补修桌面通知开关设置的 Rust 持久化模型，确保 `settings_update` 返回值保留 `desktopNotifications`。

## 验证
- `npm run test -- SettingsToolContent`
- `cargo test --manifest-path src-tauri\Cargo.toml --test settings_service`
- `npm run build`
- `npm run dev -- --host 127.0.0.1 --port <free-port>`
- `npm run tauri:dev`
- 浏览器打开 dev server，进入设置页，点击左侧“桌面/通知”分类并确认桌面通知面板显示；按浅色、深色和跟随系统主题做冒烟。

## 风险
- 当前工作区已有大量未归因改动，包含设置页同步入口；本计划只做最小兼容修改，不覆盖其它改动。
- 若 dev server 或 Tauri 壳被既有进程占用，记录占用情况和替代验证。

## Round Log

### 2026-06-29T10:15:15+08:00

- 根因：真实浏览器中左侧设置分类“桌面/通知”能切换；不可点击的是桌面通知面板里 `PolicyToggle` 行的左侧文案区域。旧实现把行渲染成普通 `div`，只有右侧 `Switch` 小按钮响应点击。
- 修改：`PolicyToggle` 改为整行 `role="switch"` 的按钮，图标、文案和右侧滑块共用同一点击目标；保留 `aria-label`、`aria-checked`、`data-state` 和浅/深主题变量样式。
- 回归：`SettingsToolContent.controls.test.tsx` 增加点击“启用桌面通知”文字应切换 `desktopNotifications.enabled` 的断言，先红后绿。
- 验证：
  - `npm run test -- src/features/settings/SettingsToolContent.controls.test.tsx --run` 通过。
  - `npm run test -- src/features/settings --run` 通过，10 个文件 / 39 个测试。
  - `npm run build` 通过；保留既有 Vite 大 chunk 与动态导入提示。
  - `npm run dev -- --host 127.0.0.1 --port 5174` 启动通过；真实浏览器刷新后点击“启用桌面通知”文字，`aria-checked` 从 `false` 变为 `true`。
  - 浅色、深色、跟随系统主题下均能显示 `settings-desktop-panel`，通知行左侧命中点落在同一 switch 行内。
- 运行态截图：`.updeng/docs/verification/settings-notification-toggle-fixed.png`。
- 未执行：`npm run tauri:dev`；本轮未改 Rust、Tauri capability、窗口创建或系统通知插件注册，前端 dev server 冒烟已覆盖本缺陷路径。

### 2026-06-29T10:32:59+08:00

- 用户追问现象：桌面通知面板里的开关“点了没反应”。进一步排查发现前端点击会先改变本地状态，但保存后 `settings_update` 返回的 Rust `AppSettings` 没有 `desktopNotifications` 字段，前端 `normalizeAppSettings` 随即回落默认值，看起来像开关没有生效。
- 修改：`src-tauri/src/models/settings.rs` 增加 `DesktopNotificationSettings`，在 `AppSettings` 中通过 `desktop_notifications` 保存并序列化为 `desktopNotifications`；默认值与前端一致，并对 `minDurationMs`、`throttleMs` 做同范围归一化。
- 回归：`src-tauri/tests/settings_service.rs` 在 `settings_service_persists_settings_in_toml` 中覆盖启用桌面通知、后台策略、重要通知、最小时长和节流值，断言写入 TOML 后重新加载仍保留。
- 验证：
  - `cargo test --manifest-path src-tauri\Cargo.toml --test settings_service settings_service_persists_settings_in_toml -- --exact` 通过。
  - `cargo test --manifest-path src-tauri\Cargo.toml --test settings_service` 通过，5 个测试全绿。
  - `npm run test -- src/features/settings/SettingsToolContent.controls.test.tsx --run` 通过。
  - `npm run build` 通过；保留既有 Vite 大 chunk 与动态导入提示。
  - `npm run tauri:dev` 启动到 `Kerminal desktop setup completed`。
  - Chrome 打开 `http://localhost:1425/`，进入设置页桌面面板，点击“启用桌面通知”文字后 `aria-checked` 从 `false` 变为 `true`。
- 运行态截图：`.updeng/docs/verification/settings-desktop-notification-toggle-backend-fix.png`。
