---
id: PLAN-20260618-000034-snippet-execution-variables
status: done
created_at: 2026-06-18T00:00:34+08:00
started_at: 2026-06-18T00:00:34+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 片段执行与变量填参

## 目标
- 让右侧“片段”工具从保存/复制升级为可执行：支持识别 `{{变量名}}`、填写变量、预览最终命令并发送到当前聚焦终端分屏。
- 无变量片段可直接发送到当前分屏；有变量片段先展示填参面板和预览，再由用户确认发送。
- 发送成功后命令历史记录来源为 `snippet`，复用当前 pane/session 的 target、cwd、shell、profile、remote host 元数据。

## 非目标
- 不实现多步 workflow、条件分支、确认点编排或批量主机执行。
- 不让 AI 自动执行片段；本次只提供 UI 用户手动执行链路，后续 AI 工具可复用同一能力。
- 不新增 SQLite migration；片段变量沿用现有 `command` 模板文本。
- 不做破坏性命令二次确认策略扩展；变量片段通过预览降低误发风险，统一风险策略留给 workflow/security 切片。

## 影响范围
- 前端页面：`src/features/tool-panel/ToolPanel.tsx`
- 前端片段领域 helper：`src/features/snippets/snippetVariables.ts`
- 终端写入链路：`src/features/terminal/terminalSessionRegistry.ts`
- 测试：`src/features/snippets/snippetVariables.test.ts`、`src/features/terminal/terminalSessionRegistry.test.ts`、`src/features/tool-panel/ToolPanel.test.tsx`
- 文档：`.updeng/docs/plan/next/terminal-product-plan.md`、`.updeng/docs/in-progress.md`

## 执行步骤
- [x] 增加片段变量解析/渲染 helper，覆盖去重、空变量忽略、变量替换和保留命令主体格式。
- [x] 在 terminal session registry 增加当前分屏写入 helper，缺失 session 返回结构化失败，成功写入 `command + "\r"` 并记录 `snippet` 历史。
- [x] 在片段工具 UI 接入 `focusedPane`、作用域匹配、填参面板、命令预览、发送状态和错误提示。
- [x] 增加单元测试和组件测试，覆盖变量片段、作用域不匹配、缺少当前分屏和历史来源。
- [x] 更新长期计划 slice 18 状态，标记 snippet 执行/变量子能力已完成。

## 验证
- `npm run test:frontend -- snippetVariables terminalSessionRegistry ToolPanel`
- `npm run check`
- 浏览器 smoke：打开 `http://127.0.0.1:1425/`，进入“片段”，创建或使用 `echo {{name}}`，填写变量并发送到当前分屏，确认终端预览收到命令且控制台无错误。

## 验证结果
- `npm run test:frontend -- snippetVariables terminalSessionRegistry ToolPanel`：通过，3 个测试文件、26 个测试。
- `npm run check`：通过，前端 26 个测试文件、158 个测试；Rust fmt/clippy/test 通过；生产构建通过。仍保留既有 Vite 大 chunk 警告。
- 1425 浏览器 smoke：通过。右侧“片段”面板可打开；SSH 片段在本地 pane 下被作用域提示拦截；新建含 `{{name}}` 的变量片段后可填参并显示最终命令；发送后“日志”面板出现 `片段` 来源历史记录；console error 为空。

## 风险
- 当前真实终端会话由前端注册；如果分屏尚未连接，片段发送必须明确提示“当前没有可发送的终端分屏”。
- 片段作用域要避免本地片段误发 SSH、SSH 片段误发本地；`any` 允许两端。
- 变量替换不做 shell 转义，用户可见预览必须展示最终命令，后续 workflow/security 切片再引入更严格的执行策略。



