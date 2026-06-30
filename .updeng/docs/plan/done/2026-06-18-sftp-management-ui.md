---
id: PLAN-20260618-000031-sftp-management-ui
status: done
created_at: 2026-06-18T00:00:31+08:00
started_at: 2026-06-18T00:00:31+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# SFTP 管理操作 UI 与模块拆分

## 目标
- 将 SFTP 工具面板从 `ToolPanel.tsx` 抽离到独立 feature 模块，避免右侧工具入口文件继续膨胀。
- 在 SFTP 工具面板补齐新建目录、重命名和删除入口，让当前 SSH 主机目录管理形成完整闭环。
- 删除和重命名都必须有中文确认，删除必须展示危险提示，避免误操作。
- SFTP 行为测试迁移到独立测试文件，覆盖浏览、预览、上传下载、新建目录、重命名、删除和错误态。

## 非目标
- 本次不新增 Rust 后端 command，不修改 `sftpApi.ts` 的 Tauri 命令契约。
- 本次不实现递归删除、拖拽上传、传输队列、断点续传或原生文件选择器。
- 本次不触碰 AI Tool Invocation 的 SFTP 执行器。

## 影响范围
- 前端组件：`src/features/sftp/SftpToolContent.tsx`、`src/features/tool-panel/ToolPanel.tsx`
- 前端测试：`src/features/sftp/SftpToolContent.test.tsx`、`src/features/tool-panel/ToolPanel.test.tsx`
- 文档：`.updeng/docs/plan/next/terminal-product-plan.md`、`.updeng/docs/in-progress.md`

## 执行步骤
- [x] 抽离 SFTP 面板组件和本地 helper。
- [x] 实现新建目录、重命名和删除确认 UI，并复用现有 SFTP API。
- [x] 将 SFTP 测试迁移到独立测试文件并补齐管理操作用例。
- [x] 运行 `npm run test:frontend -- SftpToolContent ToolPanel sftpApi`。
- [x] 运行 `npm run check`。
- [x] 使用桌面版做启动冒烟验证，并用 `http://127.0.0.1:1425/` 做补充 UI 预览。
- [x] 更新长期计划并移除 in-progress 条目。

## 验证
- `npm run test:frontend -- SftpToolContent ToolPanel sftpApi`：通过，3 个测试文件、36 个用例。
- `npm run check`：通过，覆盖前端测试、Rust fmt/clippy/test 和生产构建；Vite 输出大 chunk 警告，未阻断构建。
- 桌面版启动冒烟：通过，复用当前 1425 Vite 服务直接启动 `src-tauri` 下的 `cargo run`，确认 `kerminal.exe` 进程和标题为 `Kerminal` 的桌面窗口存在；启动日志无 Tauri/Rust 启动错误。
- 浏览器补充预览 `http://127.0.0.1:1425/`：通过，中文工作台、SFTP 文件浏览、文件传输和目录管理区可见；页面文本不包含 `Next Terminal`；控制台 error 为空。后续涉及 PTY、SFTP、SSH、菜单和本地系统能力的验收以桌面版为准。

## 结果
- SFTP 面板已从 `ToolPanel.tsx` 抽离到 `src/features/sftp/SftpToolContent.tsx`。
- 目录管理已支持新建目录、重命名、删除文件或空目录；重命名和删除均有中文确认，删除有危险提示。
- SFTP 行为测试已迁移到独立测试文件，覆盖浏览、预览、上传、下载、新建目录、重命名和删除确认。

## 风险
- 删除远程路径是破坏性操作，UI 必须通过二次确认并只调用后端已有非递归删除能力。
- 抽离组件可能影响 ToolPanel 现有测试，需保留工具切换和空状态覆盖。



