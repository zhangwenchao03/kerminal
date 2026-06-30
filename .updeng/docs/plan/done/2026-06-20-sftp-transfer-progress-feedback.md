---
id: PLAN-20260620-004519-sftp-transfer-progress-feedback
status: done
created_at: 2026-06-20T00:45:19+08:00
started_at: 2026-06-20T00:45:19+08:00
completed_at: 2026-06-20T00:57:57+08:00
updated_at: 2026-06-20T00:57:57+08:00
owner: ai
---

# SFTP 上传下载进度与结果反馈

## 目标
- 修复 SFTP 上传/下载“像卡住一样无反馈”的体验。
- 让 SFTP 面板在传输入队、运行、完成、失败、取消时都能看到明确状态。
- 让传输进度条包含百分比、字节数、任务数量和失败原因。

## 非目标
- 不改 SSH/SFTP 凭据模型和主机保存流程。
- 不引入外部传输客户端或替换现有 russh SFTP 后端。
- 不改容器文件传输的同步执行模型。

## 影响范围
- Rust SFTP 服务队列和进度更新。
- Tauri SFTP command 入队/取消/清理接口。
- React SFTP 工具面板的传输状态栏。
- SFTP API/组件测试和 Rust 服务测试。

## 执行步骤
- [x] 后端传输任务状态更新时推送 `sftp-transfer-updated` 事件，保留轮询兜底。
- [x] 前端监听传输事件并即时更新当前主机传输列表。
- [x] 强化传输状态栏：明确百分比、总任务、失败数、取消/清理操作和错误文本。
- [x] 补充前端事件/进度/失败显示测试；Rust 服务测试已完成编译验证，运行受本机测试二进制入口点错误阻断。

## 验证
- `npm run test:frontend -- src/features/sftp/SftpToolContent.test.tsx`：通过，47 tests。
- `cd src-tauri; cargo test sftp --lib --no-run`：通过。
- `cd src-tauri; cargo test sftp --lib`：测试二进制运行失败，Windows 返回 `STATUS_ENTRYPOINT_NOT_FOUND`；编译已通过。
- `cd src-tauri; cargo check`：通过，保留既有 `SerialClient::{Picocom, Screen}` dead code warning。
- `cd src-tauri; cargo clippy --all-targets --all-features -- -D warnings`：失败于既有非 SFTP 警告，未修改无关模块。
- `npm run build`：通过。
- `npm run dev -- --host 127.0.0.1 --port 5174` + HTTP 200：通过。
- `npm run tauri:dev`：Tauri app 启动到 `target\debug\kerminal.exe`，附带 Vite 服务 HTTP 200。

## 风险
- 真实 SFTP 端到端依赖外部测试主机；本轮未对真实远端服务器做大文件上传/下载人工验收。
- 事件推送是体验增强，前端轮询仍保留，避免事件不可用时失去进度。
