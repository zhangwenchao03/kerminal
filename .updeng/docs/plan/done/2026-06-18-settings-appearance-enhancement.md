---
id: PLAN-20260618-000029-settings-appearance-enhancement
status: done
created_at: 2026-06-18T00:00:29+08:00
started_at: 2026-06-18T00:00:29+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 设置外观能力增强

## 目标
- 扩展设置里的外观能力，让设置项覆盖界面语言、应用主题、界面密度、主页面背景、终端浅/深主题、终端字体和终端交互。
- 参考截图但不照搬：额外补充背景铺放模式、终端字重、关闭标签确认、标签序号、右键行为、选中复制、自动重连等更完整的实际工作台能力。
- 新增能力要立即影响当前工作台或 xterm 实例，并通过 SQLite 设置持久化。
- 保持旧版本设置 JSON 可加载，缺失字段自动补默认值。

## 非目标
- 不实现完整主题编辑器、任意自定义 CSS 或透明窗口。
- 不重写全应用视觉系统，只在已有设置与终端外观链路上做可验证增强。
- 不实现快捷键编辑，本轮只处理外观能力。

## 影响范围
- React：`settingsModel`、`SettingsToolContent`、`terminalTheme`、`KerminalShell`、`XtermPane`。
- Rust：`models/settings.rs` 设置模型、默认值和校验。
- 测试：设置面板交互、设置模型兼容与归一化、xterm option/theme 应用、Rust 持久化与 legacy JSON。

## 执行步骤
- [x] 扩展前后端设置模型、默认值和兼容归一化。
- [x] 扩展设置 UI，加入可直接操作的外观和终端外观控件。
- [x] 将语言、背景、背景铺放、界面密度应用到工作台根节点，将终端配色/光标/字重/交互设置传给 xterm 与终端工作区。
- [x] 补齐前端和 Rust 测试。
- [x] 运行 `npm run typecheck`、`npm run test:frontend`、`npm run test:rust`、`npm run build`。
- [x] 进行浏览器 smoke，逐项确认新增控件可见、可保存、可影响界面。

## 验证
- `npm run typecheck`：通过。
- `npm run test:frontend`：通过，44 个测试文件 / 321 个用例。
- `npm run build`：通过；保留既有 Mermaid 大 chunk 警告。
- `npm run test:rust`：通过。
- 浏览器 smoke：通过。覆盖设置弹窗打开、界面语言 `enUS`、主页面背景启用、透明度 72%、背景平铺、背景路径样式、终端字重、选中复制、显示标签序号、macOS Option as Meta、右键直接粘贴、光标竖线、自动重连关闭和滚屏缓冲。

## 风险
- xterm option 支持的外观能力有限，避免设计无法落地的设置项。
- 旧 JSON 缺字段必须使用 serde/default 与前端 normalize 双侧兜底，防止加载历史设置失败。
- Tauri asset protocol 已限制在常见图片来源目录；手动输入 scope 外路径会保存，但生产 WebView 可能无法显示该图片。


