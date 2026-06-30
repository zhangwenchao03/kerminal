---
id: PLAN-20260618-000040-terminal-output-throughput
status: done
created_at: 2026-06-18T00:00:40+08:00
started_at: 2026-06-18T00:00:40+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# 终端输出吞吐保护

## 目标

- 为本地 PTY 和 SSH 终端输出增加前端批处理写入，降低大量小块输出时对 xterm 的同步写入压力。
- 保证输出顺序不变，关闭、错误和重连等中文状态提示不会越过已排队的终端输出。
- 把吞吐逻辑放到独立模块，并补充独立单元测试，避免 `XtermPane` 继续膨胀。

## 非目标

- 本次不实现完整 benchmark 仪表盘、帧率采样 UI 或跨平台真实 PTY 压测。
- 本次不修改 Rust `TerminalManager` 的 PTY 读取线程和 Channel 协议。
- 本次不自研终端渲染器，继续基于 `@xterm/xterm`。

## 影响范围

- 前端模块：`src/features/terminal/terminalOutputWriter.ts`、`src/features/terminal/XtermPane.tsx`。
- 测试：`src/features/terminal/terminalOutputWriter.test.ts`、`src/features/terminal/XtermPane.test.tsx`。
- 文档：本计划、`.updeng/docs/in-progress.md`、总计划 slice 21 状态。

## 执行步骤

- [x] 新增可注入调度器的 terminal output writer，支持小块合并、大块分帧、立即写入前 flush 和 dispose。
- [x] 在 `XtermPane` 中把 `TerminalOutputEvent.kind === "data"` 接入批处理 writer。
- [x] 将关闭、错误、重连等状态提示改为顺序安全的立即写入。
- [x] 补充独立单元测试，覆盖合并、分帧、顺序和 dispose。
- [x] 更新组件测试，确认 channel 输出仍写入 xterm。
- [x] 运行相关前端测试、`npm run check` 和 `http://127.0.0.1:1425/` 浏览器 smoke。
- [x] 更新总计划和本计划状态。

## 验证

- `npm run test:frontend -- terminalOutputWriter XtermPane`：通过，2 个测试文件 / 18 个用例。
- `npm run check`：通过，前端 32 个测试文件 / 212 个用例、Rust fmt、clippy、test 和生产构建全部通过。
- 浏览器打开 `http://127.0.0.1:1425/`：通过，终端工作区可加载，日志面板可打开，运行体检和诊断包入口可见，页面无 `Next Terminal` 文案，控制台无 error 日志。

## 风险

- 前端批处理只能降低小块事件写入频率，不能替代真实 PTY/SSH 吞吐 benchmark。
- 如果上游一次性发送超大字符串，仍需要按 xterm 能力分帧写入；本切片只在前端控制每帧最大写入字符数。
- 真实本地 PTY 和 SSH 的大输出压测仍需后续在 Tauri 窗口和目标平台上人工验收。


