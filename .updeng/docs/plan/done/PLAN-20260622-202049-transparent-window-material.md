---
status: done
created_at: 2026-06-22T20:20:49+08:00
started_at: 2026-06-22T20:20:49+08:00
completed_at: 2026-06-22T20:25:20+08:00
owner: codex
lane: lane-transparent-window-material
---

# 透明窗口与材质统一生产级计划

## 背景

用户在启用主页背景和窗口透明后，连续反馈了三个视觉问题：

- 左侧栏展开时，左侧栏和终端之间出现一条亮色竖缝，像布局没接上。
- 左侧栏、右侧背板和顶部导航的透明材质不一致，顶部/右侧看起来仍像不透明黑块。
- 左上 title strip 与顶部导航之间存在一条不属于布局语义的竖线。

本计划把问题拆成三层处理：Tauri 窗口透明、WebView 根节点透明、应用内 CSS 材质与边界语义。

## 外部调研结论

1. Tauri 透明窗口不是单靠 CSS 完成：窗口配置需要开启 `transparent`，WebView 内 `html, body` 也必须透明，否则 OS 透明窗口会被页面背景盖住。
   - 参考：Tauri Window Customization 文档；`tauri-apps/window-vibrancy` README。
2. 原生 blur/acrylic/mica 是平台能力，不是通用 CSS 效果。
   - Windows Mica 更适合作为长期窗口底层材质，性能较稳，但它是动态不透明材质，不等同于“看穿桌面”的透明。
   - Windows Acrylic 更适合短生命周期或局部弹层，大面积背景和多个相邻 Acrylic pane 容易产生性能和接缝问题。
   - Linux blur/vibrancy 取决于 compositor，不能作为生产一致体验的默认前提。
   - 参考：Microsoft Mica、Microsoft Acrylic、`window-vibrancy`。
3. Electron 等桌面框架也强调启动和显示阶段要避免透明/背景不一致导致的闪烁或错色；Kerminal 这里应避免让不同 chrome 区域各自独立“猜背景”。
   - 参考：Electron `BrowserWindow`。

## 生产决策

- P0 不引入 `window-vibrancy` 原生依赖。当前问题是应用内材质和边界不一致，不是 OS 级 blur 缺失；贸然上 Acrylic/Mica 会引入平台差异、性能退化和额外启动验证风险。
- 保留 Tauri `transparent: true`，保持 `html/body/#root` 透明。
- 建立应用内语义材质：
  - `kerminal-material-nav`：顶部导航、左侧栏、右侧工具栏等 shell chrome 统一使用。
  - `kerminal-terminal-surface`：终端工作区背板和左右 resize seam 使用。
  - 根容器负责背景图、背景透明度和窗口底色。
- React 侧预计算 `--app-nav-surface-opacity` / `--app-terminal-surface-opacity`，避免依赖复杂 CSS alpha 计算造成兼容和测试不确定性。
- 无布局语义的边框不保留。左上 title strip 只提供拖拽区域，不需要右边框。

## 实施范围

### 已纳入本轮

- Tauri 配置核对：`src-tauri/tauri.conf.json` 已有 `decorations: false` 与 `transparent: true`，`freezePrototype` 保持 `false`。
- WebView 根透明：`html/body/#root` 透明，不覆盖 OS 透明窗口。
- 材质 token：新增/使用 `--surface-nav-rgb`、`--app-nav-surface-opacity`、`--app-terminal-surface-opacity`。
- Shell chrome 统一：左上拖拽条、顶部导航、左侧/右侧 chrome 使用同一 nav material。
- 终端接缝统一：左侧 resize separator 使用 terminal surface，不再形成亮色竖缝。
- 无语义竖线移除：左上 title strip 去掉 `border-r`，保留 `data-tauri-drag-region`。
- 回归测试：锁定 title strip 无 `border-r`、overlay titlebar 透明、resize seam 材质、背景 opacity 变量。
- 真实 UI 验证：启动 dev server，用浏览器截图和 computed style 验证。

### 后续可选

- P1：如果用户明确要 Windows 原生 Mica/Acrylic，再单独引入 `window-vibrancy`，按平台 gate 实现 Windows/macOS/Linux fallback。
- P1 验证必须包含：Windows 透明效果、非激活窗口、系统“关闭透明效果”、电池/低性能 fallback、浅色/深色/跟随系统、Tauri debug 启动。

## 验证口径

- `npm run test -- src/app/KerminalShell.test.tsx`
- `npm run build`
- dev server smoke：真实渲染首页，截图检查左侧展开状态下无亮色竖缝、顶部无多余竖线、左右/top chrome 材质一致。
- 若后续引入原生 vibrancy 或改 Rust/Tauri window 运行逻辑，再追加 `npm run tauri:dev`。

## 回滚口径

- 若透明材质影响可读性，优先回滚 CSS opacity 变量和材质 class 分配，不回滚 Tauri `transparent: true`。
- 若某平台 WebView 对 `backdrop-filter` 支持异常，保留半透明 solid fallback，降低 blur/saturate，不改业务布局。

## Round Log

- 2026-06-22T20:20:49+08:00：完成外部调研，采用 CSS/WebView 材质统一作为 P0；确认当前 Tauri window 已是 transparent/decorations false。已实现左侧 seam 匹配终端背板、顶部/左右 chrome 统一 nav material、左上 title strip 去掉无语义 `border-r`。下一步补齐计划登记后重跑验证。
- 2026-06-22T20:25:20+08:00：验证完成并归档。`lanes.json` JSON 校验通过；`npm run test -- src/app/KerminalShell.test.tsx` 通过，26 tests；`npm run build` 通过，仅保留既有 Vite chunk-size warning；临时 dev server `http://127.0.0.1:1440/` 使用系统 Edge 完成真实渲染检查，左上 title strip `borderRightWidth=0px`，左上/顶部标签栏/右侧 rail 背景均为 `rgba(17, 17, 19, 0.78)`，左侧 resize seam 为 terminal surface `rgba(24, 24, 26, 0.78)`，`html/body` 背景透明。截图：`C:/Users/24052/AppData/Local/Temp/kerminal-transparent-material-plan-verify.png`。
