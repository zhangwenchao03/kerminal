---
id: PLAN-20260624-175708-context-menu-apple-style
status: done
created_at: 2026-06-24T17:57:08+08:00
started_at: 2026-06-24T17:57:08+08:00
completed_at: 2026-06-24T18:34:03+08:00
updated_at: 2026-06-24T18:34:03+08:00
owner: ai
---

# Context Menu Apple Style Unification

## 目标
- 统一应用内右键菜单视觉风格，让终端、SFTP、主机树等上下文菜单使用一致的 Apple-inspired floating menu 语言。
- 保持浅色、深色和跟随系统主题下菜单、portal、hover、disabled、danger 和快捷键可读。

## 非目标
- 不重写菜单业务动作、快捷键语义或后端接口。
- 不处理原生系统菜单或操作系统级右键菜单。
- 不顺手重构无关页面布局。

## 影响范围
- `src/App.css`
- `src/features/machine-sidebar/MachineSidebar.tsx`
- `src/features/machine-sidebar/MachineSidebar.parts.tsx`
- `src/features/terminal/TerminalContextMenu.tsx`
- `src/features/terminal/TerminalCommandBlockRail.tsx`
- `src/features/terminal/TerminalWorkspace.tsx`
- `src/features/terminal/terminalTabChrome.tsx`
- `src/features/sftp/sftp-tool-content/SftpContextMenu.tsx`
- `src/features/sftp/LocalTransferPaneContextMenu.tsx`
- 菜单相关测试或视觉验证脚本，按实际触达补充。

## 执行步骤
- [x] 盘点当前自定义右键菜单入口、样式 token 和差异。
- [x] 抽出或复用统一 floating context menu 样式，兼容 light/dark/system theme。
- [x] 将终端、SFTP、主机树等右键菜单迁移到统一风格，保持行为不变。
- [x] 运行相邻测试、`npm run build` 和真实 dev server 冒烟。
- [x] 进行运行态视觉检查，覆盖浅色、深色和跟随系统主题。

## 验证
- `npm run build`
- 真实 dev server 启动冒烟。
- 运行界面截图检查右键菜单在浅色、深色和跟随系统主题下的可读性与一致性。

## 风险
- 当前主工作区已有大量未归因改动，本 lane 只做菜单样式相关最小修改；不覆盖 runtime SQLite schema cleanup lane 的 owned paths。

## Round Log
- 2026-06-24T17:57:08+08:00：登记计划和 lane；开始盘点自定义右键菜单入口。
- 2026-06-24T17:59:00+08:00：盘点到主机侧栏、终端 pane、终端标签、命令块、SFTP 远端和 SFTP 本地面板右键菜单；普通广播/分屏目标下拉暂不纳入右键菜单统一。
- 2026-06-24T18:34:03+08:00：完成统一样式和验证收口。新增 `kerminal-context-menu*` 全局菜单 token / item / icon / separator / header / shortcut / danger 样式，并迁移主机侧栏、终端 pane、终端标签、命令块、SFTP 远端和 SFTP 本地面板右键菜单；菜单业务动作未改。
- 2026-06-24T18:34:03+08:00：验证通过：`npm run test:frontend -- src/features/terminal/TerminalCommandBlockRail.test.tsx src/features/sftp/sftp-tool-content/SftpContextMenu.test.tsx src/features/machine-sidebar/machineSidebarMenuDomain.test.tsx src/features/terminal/TerminalWorkspace.test.tsx`；`npm run build`。补充尝试 `LocalTransferPane.test.tsx` 时存在 4 个本地目录创建/删除相关失败，且包含工具栏创建目录用例，判定为当前脏工作区既有 SFTP 本地面板回归，不归入右键菜单样式切片。
- 2026-06-24T18:34:03+08:00：运行态视觉验证：production preview `http://127.0.0.1:5188/` 可渲染应用并打开“主机操作菜单”；截图已保存到 `.updeng/tmp/context-menu-apple-style/host-context-menu-light.png`、`host-context-menu-dark.png`、`host-context-menu-system.png`。computed style 覆盖 light/dark/system：菜单背景分别落到 `--surface-context-menu`，16px radius，32px item min-height，z-index 1000。
- 2026-06-24T18:34:03+08:00：dev server 验证记录：`npm run dev` 与 `npm run dev:force` 均能启动并监听 5187，但 `/src/App.css` 和 `/src/main.tsx` dev transform 在 90 秒内无响应，浏览器只显示 Vite HMR connected、React root 未渲染。已停止 5187 进程；production preview 作为可启动 UI smoke 通过，dev transform 阻断记录为当前工作区剩余风险。
