---
id: PLAN-20260617-000031-workbench-foundation
status: done
created_at: 2026-06-17T00:00:31+08:00
started_at: 2026-06-17T00:00:31+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# Kerminal 工作台基础壳与测试基座

## 目标

- 替换 Tauri 模板欢迎页，建立符合产品计划的工作台基础壳。
- 引入 React 19 + Vite + Tailwind CSS + shadcn/ui 风格组件 + lucide-react。
- 按领域拆分前端文件，不把代码堆在单个 `App.tsx`。
- 建立 Vitest + Testing Library 测试基座，测试文件与功能文件分离。
- 提供 `npm run check` 一行命令运行前端测试、Rust 测试和生产构建。
- 覆盖左侧主机树、右侧工具面板、中间终端工作区和 workspace 状态的基础测试。

## 非目标

- 本轮不接入真实 PTY、SSH、SFTP、SQLite 或 AI LLM 调用。
- 本轮不实现生产级主题编辑、凭据管理和 MCP。
- 本轮不保证最终视觉完全定稿，只建立可迭代的产品壳和测试边界。

## 影响范围

- 前端入口：`src/App.tsx`、`src/App.css`、`src/main.tsx`
- 工作台模块：`src/app/`、`src/features/`、`src/components/ui/`、`src/lib/`
- 测试基座：`vitest.config.ts`、`src/test/setup.ts`、各 `*.test.tsx` / `*.test.ts`
- 构建脚本：`package.json`、`tsconfig*.json`、`vite.config.ts`
- 文档状态：`.updeng/docs/in-progress.md`

## 执行步骤

- [x] 读取产品计划、ADR、领域上下文和当前模板代码。
- [x] 引入 Tailwind CSS、shadcn/ui 风格依赖、lucide-react、zustand、Vitest 和 Testing Library。
- [x] 增加 `npm run check` 一行验证命令。
- [x] 拆分工作台壳、左侧主机树、中间终端区、右侧工具面板和 workspace store。
- [x] 为左侧、右侧、中间和 store 增加独立测试文件。
- [x] 运行前端测试并修复失败。
- [x] 运行 `npm run check` 并修复失败。
- [x] 根据 subagent 反馈补齐明显缺口：默认窗口尺寸、严格检查脚本、AI Rig/rmcp 决策和过期产品事实已同步。
- [x] 浏览器验证工作台基础布局和控制台错误。
- [x] 清理 in-progress 状态并收口。

## 验证

- `npm run check`：通过。包含 `vitest run`、`cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`、`cargo test`、`tsc` 和 `vite build`。
- 浏览器验证：`http://127.0.0.1:1420/` 可打开，页面标题为 Kerminal；左侧主机栏、中间终端区、右侧工具面板均渲染；console warning/error 为空；1280x720 视口下中间区域约 609px 宽。

## 风险

- Tailwind CSS v4 与 Vite/TypeScript 配置可能需要按当前版本调整。
- React Testing Library 在 jsdom 下无法验证真实 xterm/PTY 行为，本轮只验证工作台壳和交互状态。
- `npm audit` 当前报告 high severity，需要后续单独评估依赖链，不在本切片内强制升级破坏性依赖。
- Rust 侧仍是模板级实现，当前 `cargo test` 为 0 个 Rust 测试；真实 PTY/SQLite/SSH/SFTP/AI 切片必须补 Rust 单元和集成测试。


