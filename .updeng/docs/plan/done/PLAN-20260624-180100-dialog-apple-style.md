---
id: PLAN-20260624-180100-dialog-apple-style
status: done
created_at: 2026-06-24T18:01:00+08:00
started_at: 2026-06-24T18:01:00+08:00
completed_at: 2026-06-24T18:32:28+08:00
updated_at: 2026-06-24T18:32:28+08:00
owner: ai
---

# Dialog Apple Style Unification

## 目标
- 替换应用内残留的浏览器原生 `window.prompt` / `window.confirm` 弹框，统一为 Kerminal 自有 `ModalShell` 风格。
- 保持浅色、深色和跟随系统主题下弹框、输入框、确认按钮、危险动作和状态文案可读。
- 优先修复截图中的 SFTP 本地新建文件夹弹框，并顺带覆盖同类容器文件操作和未保存关闭确认。

## 非目标
- 不重写 SFTP、容器文件或本地文件操作的业务动作。
- 不修改原生系统文件选择器、Tauri 系统弹窗或操作系统级菜单。
- 不顺手改右键菜单样式；右键菜单已有独立 lane。

## 影响范围
- `src/features/sftp/LocalTransferPane.tsx`
- `src/features/sftp/LocalDeleteConfirmDialog.tsx`
- `src/features/sftp/ContainerFilesToolContent.tsx`
- `src/features/sftp/SftpToolContent.tsx`
- `src/features/sftp/sftp-tool-content/useSftpWorkspaceDialogActions.ts`
- `src/components/ui/*`
- 相关前端测试。

## 执行步骤
- [x] 抽出或复用 Apple-inspired 输入/确认弹框组件。
- [x] 迁移 SFTP 本地新建文件夹，删除 `window.prompt` 依赖。
- [x] 迁移容器文件新建、重命名、chmod、删除弹框。
- [x] 迁移 SFTP 工作区未保存关闭确认。
- [x] 更新相关测试并确认没有残留应用内 `window.prompt` / `window.confirm`。
- [x] 运行 `npm run build`、真实 dev server 冒烟和运行态视觉检查。

## 验证
- `npm run test:frontend -- src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/sftp-tool-content/useSftpWorkspaceDialogActions.test.ts`
- `npm run build`
- 真实 dev server 启动冒烟。
- 运行界面检查自有弹框在浅色、深色和跟随系统主题下可读。

## 风险
- 当前主工作区已有大量未归因改动，本 lane 只做弹框相关最小修改。
- `LocalTransferPane.tsx` 已有虚拟列表改动，本轮保留并避开无关重排。

## Round Log
- 2026-06-24T18:01:00+08:00：登记计划和 lane；已确认截图问题来自浏览器原生 prompt，范围收敛到残留 prompt/confirm 入口。
- 2026-06-24T18:32:28+08:00：新增 `PromptDialog` 复用 `ModalShell`、项目主题 token、紧凑按钮和输入校验；SFTP 本地新建文件夹、容器文件 mkdir/rename/chmod/delete、远程工作区未保存关闭确认均改为应用内弹框。验证：`npm run test:frontend -- src/components/ui/prompt-dialog.test.tsx src/features/sftp/LocalTransferPane.test.tsx src/features/sftp/SftpToolContent.workspaceDialog.test.tsx src/features/sftp/sftp-tool-content/useSftpWorkspaceDialogActions.test.ts` 通过 39/39；`npm run build` 通过，仅保留既有 Vite chunk size warning；真实 dev server `http://127.0.0.1:1425` 返回 HTTP 200；浅色、深色、跟随系统主题截图见 `.updeng/docs/verification/dialog-style/prompt-light.png`、`prompt-dark.png`、`prompt-system.png`。`rg` 复查 `window.prompt/window.confirm/window.alert` 无应用内残留；唯一 `confirm()` 为 `RemoteHostCreateDialog.tsx` 的本地提交函数。未运行 `npm run tauri:dev`，本切片未改 Rust、Tauri 窗口或权限配置，启动验证以真实 Vite dev server 冒烟覆盖。
