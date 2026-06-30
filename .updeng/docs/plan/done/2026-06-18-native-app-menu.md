---
id: PLAN-20260618-000023-native-app-menu
status: done
created_at: 2026-06-18T00:00:23+08:00
started_at: 2026-06-18T00:00:23+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 原生应用菜单

## 目标

- 为 Tauri 桌面端创建中文原生应用菜单，覆盖终端工作台常用动作。
- 菜单动作通过统一事件桥进入 React，复用现有工作台 action，不单独复制业务逻辑。
- 浏览器预览环境保持可运行：非 Tauri 时不注册事件监听，不影响 `http://127.0.0.1:1425/` smoke。

## 非目标

- 不实现完整可配置快捷键系统；本切片只提供原生菜单和少量固定 accelerator。
- 不实现系统托盘、全局热键、命令面板或多窗口。
- 不直接从 Rust 操作前端 store；Rust 只负责创建菜单和发出 action event。

## 影响范围

- Rust/Tauri 启动：`src-tauri/src/lib.rs`
- Rust 菜单模块：`src-tauri/src/app_menu.rs`
- 前端事件桥：`src/lib/nativeMenuApi.ts`
- 工作台动作绑定：`src/app/KerminalShell.tsx`
- 测试：`src-tauri/tests/app_menu.rs`、`src/lib/nativeMenuApi.test.ts`、`src/app/KerminalShell.test.tsx`
- 长期计划：`.updeng/docs/plan/next/terminal-product-plan.md`

## 菜单结构

- Kerminal：关于 Kerminal、退出。
- 文件：新建本地终端、关闭当前分屏、打开设置。
- 终端：左右分屏、上下分屏、打开日志、打开 AI 助手。
- 视图：系统、SFTP、端口、主机、片段。

## 执行步骤

- [x] 新增 Rust `app_menu` 模块，定义稳定菜单 action id、payload 和菜单构建函数。
- [x] 在 Tauri builder setup 中创建菜单并监听 `on_menu_event`，把 action 通过窗口事件发给前端。
- [x] 新增前端 `nativeMenuApi`，封装 Tauri `listen`，浏览器预览自动 no-op。
- [x] `KerminalShell` 监听原生菜单 action，映射到现有新建终端、关闭分屏、打开工具面板、分屏等动作。
- [x] 补充 Rust/TypeScript/组件测试。
- [x] 运行 `npm run check` 和 `1425` 浏览器 smoke。

## 验证

- `cd src-tauri && cargo test --test app_menu`：通过，3 个 Rust 菜单测试通过。
- `npm run test:frontend -- nativeMenuApi KerminalShell`：通过，9 个前端聚焦测试通过。
- `npm run check`：通过，前端 29 个测试文件/194 个测试、Rust fmt/clippy/test 和生产构建均通过；Vite 仍提示单 chunk 超过 500 kB。
- 浏览器 smoke：`http://127.0.0.1:1425/` 页面正常加载，控制台错误数为 0。
- 历史名称关键词仓库扫描：无匹配。

## 风险

- 原生菜单 accelerator 在 Windows/macOS/Linux 显示和冲突规则不同；本切片只使用常见组合，并让终端输入优先级问题留给快捷键配置切片。
- Tauri 菜单 action 是异步发给前端的，如果窗口未就绪，事件可能被忽略；这是可接受的桌面菜单行为，后续命令面板可补更强反馈。



