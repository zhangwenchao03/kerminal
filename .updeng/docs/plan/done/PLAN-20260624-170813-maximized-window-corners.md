---
id: PLAN-20260624-170813-maximized-window-corners
status: active
created_at: 2026-06-24T17:08:13+08:00
started_at: 2026-06-24T17:08:13+08:00
completed_at: 2026-06-24T17:27:40+08:00
updated_at: 2026-06-24T17:27:40+08:00
owner: ai
---

# 最大化窗口圆角透明修复

## 目标

- 最大化或全屏后，主窗口四角不再保留透明圆角裁剪，避免看到后方内容。
- 普通窗口仍保留当前透明材质和圆角体验。
- macOS 普通窗口保持 Apple-style 交通灯和圆角；最大化/全屏时同样使用直角填满窗口。

## 非目标

- 不调整业务功能、终端渲染逻辑、主机/工具面板行为。
- 不改 Tauri `freezePrototype` 或安全配置。
- 不重做整体主题系统。

## 影响范围

- `src/App.css`
- `src/app/KerminalShell.tsx`
- `src/lib/useTauriWindowFrameState.ts`
- `src/lib/useTauriWindowFrameState.test.tsx`
- 协作台账：`.updeng/docs/coordination/lanes.json`、`.updeng/docs/in-progress.md`、`.updeng/docs/plan/INDEX.md`

## 执行步骤

- [x] 定位当前透明窗口、根容器圆角、最大化状态入口。
- [x] 增加窗口 frame 状态派生，最大化/全屏时去掉根容器圆角与裁剪。
- [x] 覆盖普通窗口、最大化/全屏、macOS 平台保留体验的测试或可验证断言。
- [x] 运行前端构建和真实 dev server smoke；涉及 Tauri 窗口状态时尝试 `npm run tauri:dev`，无法完整人工验收则记录原因。

## 验证

- `npm run build`
- 真实 `npm run dev` 启动 smoke
- `npm run tauri:dev` 或说明无法完成的原因

## 风险

- 透明窗口和 CSS 裁剪直接影响窗口外观，需同时确认浅色/深色/跟随系统主题不会出现单主题不可读。
- 当前工作区存在大量未归因改动，本轮只修改计划中列出的文件，不回滚或格式化其它文件。

## Round Log

- 2026-06-24T17:08:13+08:00：创建人工计划和 lane。用户反馈最大化后四角透明可见后方内容，判断根因是透明 Tauri 窗口下根容器仍保留圆角裁剪；本轮聚焦窗口 frame 状态和 CSS 半径。
- 2026-06-24T17:27:40+08:00：实现 `useTauriWindowFrameState`，Tauri 桌面端读取 `isFullscreen()` / `isMaximized()` 并监听 resize、scale、focus 变化；`KerminalShell` 根节点新增 `data-window-frame` 和 `data-window-controls-platform`，`src/App.css` 在 `maximized` / `fullscreen` 时将根容器圆角和 clip-path 半径切为 `0px`。普通窗口继续使用 `--app-window-radius: 18px`，macOS 普通窗口保留交通灯和圆角体验。
- 2026-06-24T17:27:40+08:00：验证通过：`npm run test:frontend -- src/lib/useTauriWindowFrameState.test.tsx`（5 passed）、`npm run typecheck`、`npm run build`（通过，保留既有 Vite large chunk 警告）。dev server 默认 1425 被现有进程占用，备用 `npm run dev -- --host 127.0.0.1 --port 1426` 启动并 HTTP 200 后关闭。
- 2026-06-24T17:27:40+08:00：桌面 smoke：直接 `npm run tauri:dev` 因 1425 已占用而失败；使用临时 config 跳过 beforeDevCommand 后又因已有 `target/debug/kerminal.exe` 正在运行导致 Cargo 无法覆盖。为不关闭用户现有窗口，改用隔离 `CARGO_TARGET_DIR=C:\dev\rust\kerminal\src-tauri\target-window-corners` 运行 `npm run tauri -- dev --no-dev-server-wait --config '{"build":{"beforeDevCommand":""}}'`，编译并启动成功；最大化新窗口后截图 `.updeng/docs/verification/window-corners-maximized-20260624.png`，未再看到最大化角落透明裁剪。隔离 target 已通过 `cargo clean --manifest-path src-tauri\Cargo.toml --target-dir src-tauri\target-window-corners` 清理。
