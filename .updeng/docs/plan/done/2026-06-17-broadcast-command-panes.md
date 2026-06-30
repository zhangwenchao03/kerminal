---
id: PLAN-20260617-000017-broadcast-command-panes
status: done
created_at: 2026-06-17T00:00:17+08:00
started_at: 2026-06-17T00:00:17+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 批量命令与多分屏发送

## 目标
- 让中间终端工作区顶部批量命令栏能向当前 tab 内所有真实终端分屏发送命令。
- 对多目标、SSH 远程目标和破坏性命令显示确认面板，避免批量误操作。
- 建立前端 paneId -> terminal sessionId registry，为后续 AI terminal tools、命令面板和批量 SSH 工具复用。

## 非目标
- 本切片不实现左侧主机组的非交互 SSH 批量命令执行结果表。
- 本切片不实现命令历史、片段参数化或审计持久化。
- 本切片不让 AI 自动调用该能力，后续接入 tool registry 和 rmcp 后再开放。

## 影响范围
- React：`TerminalWorkspace`、`XtermPane`、终端批量发送策略与 session registry。
- Zustand：本切片仅使用现有 tab/pane 状态，不扩展 store。
- 测试：批量策略、session registry、TerminalWorkspace 用户交互测试。
- 文档：主计划 slice 11 状态更新和进行中索引。

## 执行步骤
- [x] 新增批量命令风险策略，识别空命令、多目标、SSH 目标和破坏性命令。
- [x] 新增终端分屏 session registry，支持按 paneId 写入命令并报告成功/未连接数量。
- [x] 让 `XtermPane` 注册/注销自身 session，避免聚焦变化重建 PTY/SSH session。
- [x] 让 `TerminalWorkspace` 执行发送、确认、取消、错误和成功状态。
- [x] 补充独立测试，覆盖策略、registry、发送按钮、确认面板和空目标状态。
- [x] 运行 `npm run check`、旧品牌残留扫描和浏览器 smoke。

## 验证
- `npm run test:frontend`：15 个测试文件、71 个测试通过。
- `npm run check`：前端测试、Rust fmt/clippy/test、生产构建通过。
- 旧品牌残留扫描无命中：历史品牌关键词、Tauri 模板文案和模板 svg 引用均无命中。
- 浏览器 smoke：`http://127.0.0.1:1420/` 标题为 Kerminal，`lang=zh-CN`，终端工作区和批量命令栏可见。

## 风险
- 已存在的 `XtermPane` effect 会因 `focused` 变化重建 session，本切片会一并修复，避免批量发送时 session 映射不稳定。
- 浏览器预览或尚未连接的 pane 没有后端 session，需要清晰提示跳过数量。
- 真实远程主机高风险命令必须先确认；后续接入生产主机策略时还需要更细粒度审计。


