---
id: PLAN-20260625-202008-local-terminal-sidebar-persistence
status: done
created_at: 2026-06-25T20:20:08+08:00
started_at: 2026-06-25T20:20:08+08:00
completed_at: 2026-06-25T20:29:22+08:00
updated_at: 2026-06-25T20:29:22+08:00
owner: ai
---

# 本地终端连接左侧持久显示修复

## 目标
- 用户在主机侧栏分组中新增“本地终端”后，该本地终端应像普通主机一样出现在左侧对应分组中。
- 本地终端连接继续复用 `profiles/*.toml` 作为启动配置，不新增 host TOML 或凭据模型。
- 新增后立即可点击打开本地会话，关闭 tab、刷新主机树或恢复 workspace session 后仍作为 sidebar machine 存在。

## 非目标
- 不改 `profiles/*.toml`、`hosts/*.toml` 的文件格式。
- 不把所有 profile 自动展示到左侧；只持久展示用户通过侧栏添加或已存在于 sidebar/session 的本地连接。
- 不触碰 SSH、Docker、RDP、Telnet、Serial 的创建语义。

## 影响范围
- `src/app/useKerminalShellRemoteActions.ts`：本地连接创建动作。
- `src/app/useKerminalShellRemoteActions.*.test.*` 或相邻测试：创建本地连接后进入 sidebar 的回归信号。
- 可能只读参考 `src/features/workspace/workspaceStore.ts`、`src/features/workspace/workspaceMachineModel.ts`。

## 生产方案
- 数据模型：保持 profile 是本地终端启动配置，sidebar machine 是用户可见连接资产。
- 创建链路：`createProfile` 成功并刷新 profiles 后，调用 `addLocalProfileMachine(savedProfile, groupId)` 固定到目标分组，再选择该 local machine。
- 打开行为：创建时不依赖临时 `addTerminalTab` 留下 sidebar 状态；已有的 `openLocalTerminal(machineId)` 负责用户点击后打开终端。
- 恢复行为：复用现有 `sidebarMachinesForWorkspaceSession` / `addPersistentSidebarMachines` 机制持久化本地 sidebar machine。
- 回归测试：验证本地 profile 创建后调用 `addLocalProfileMachine`，目标分组 id 传递正确，不再只调用 `addTerminalTab`。

## 验证
- 聚焦测试：新增或相邻 hook/store 测试。
- 相邻测试：`npm test -- <相关测试文件>`。
- 构建：`npm run build`。
- 启动冒烟：前端 dev server 启动并检查页面可达；若需要桌面能力，再说明 `npm run tauri:dev` 是否可运行。
- UI 检查：真实界面确认 local 分组创建本地连接后计数和条目可见；至少覆盖深色当前截图语境，必要时补浅色/系统主题。

## 风险
- 当前工作区存在多个并行 lane，`workspaceStore.ts` 是共享热点。本轮优先不改 store；若必须改，先同步相关 lane 的最新文件和 checkpoint。
- 现有用户已经创建但未固定到 sidebar 的旧 `abc` profile 不会自动补挂，避免把所有历史 profile 都展示出来；需要可另开迁移/恢复动作。

## Round Log

### 2026-06-25T20:20:08+08:00
- 诊断结论：`local` 分组存在，但 `hosts/*.toml` 没有本地资产；两个 `abc` 仅存在于 `profiles/*.toml`。创建链路当前执行 `createProfile` 后调用 `addTerminalTab({ groupId, profileId })`，没有调用 `addLocalProfileMachine` 固定为左侧连接。
- 本轮计划：登记 lane，补回归测试，修复创建动作，运行聚焦测试、build 和启动冒烟。

### 2026-06-25T20:29:22+08:00
- 实现结果：`handleCreateLocalProfile` 在自定义本地 profile 创建并刷新后改为调用 `addLocalProfileMachine(savedProfile, groupId)`，再选择 `profile:<id>`；不再依赖 `addTerminalTab` 创建临时 tab 来承载左侧可见状态。
- 新增回归：`src/app/useKerminalShellRemoteActions.localProfile.test.tsx` 覆盖从目标分组新增本地终端后固定为 sidebar machine、选中该 local machine，且不调用 `addTerminalTab`。
- 验证通过：`npx vitest run src/app/useKerminalShellRemoteActions.localProfile.test.tsx`；`npx vitest run src/features/workspace/workspaceStore.test.ts -t "adds a copied local profile card|keeps user-added profile-backed local machines|opens a profile-backed local machine"`；`npm run build`；Vite dev server `http://127.0.0.1:5177/` HTTP 200；`node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --root C:/Users/24052/.kerminal`。
- 已知相邻测试：`npx vitest run src/app/KerminalShell.test.tsx -t "duplicates a profile-backed local terminal from the sidebar context menu"` 失败在既有整壳测试 mock 未给 `createRemoteHostGroup` 返回值，触发 `ensureDefaultRemoteGroup()` 读取 `createdGroup.id`；失败路径是复制本地终端，不是本次新增本地终端创建链路。本轮未改 `KerminalShell.test.tsx`，避免覆盖其它 lane 的拥有文件。
- 剩余口径：产品代码不自动把任意历史 profile 全部展示为左侧连接，避免误挂默认/备用 shell 配置；用户当前两个已确认的 `abc` orphan profile 已在后续 completion audit 中做一次性 session 恢复。

### 2026-06-25T20:37:07+08:00
- Completion audit 补充：仅修未来创建链路不足以恢复用户当前已经创建的两个 `abc` profile；`C:/Users/24052/.kerminal/workspace/session.json` 的 `sidebarMachines` 为空，是截图中 `local 0` 的直接原因。
- 当前用户状态恢复：已备份 `C:/Users/24052/.kerminal/workspace/session.json` 到 `C:/Users/24052/.kerminal/workspace/session.json.bak-local-sidebar-1782391027390`，并把 `profile:775bb619-7f5f-439c-821b-4713c6c5ccdb`、`profile:e3c39643-603f-4f63-89e2-c01574ce578f` 两个 local sidebar machine 写入 `local` 分组 `18e40b63-b636-4827-baa3-8c26e52795b3`。
- 追加验证：当前 `workspace/session.json` 可 JSON parse，`sidebarMachines.length === 2`，两条 machine 均指向 `18e40b63-b636-4827-baa3-8c26e52795b3`；配置 validator 继续通过。
- 运行态提示：检测到 `C:/dev/rust/kerminal/src-tauri/target/debug/kerminal.exe` 正在运行；该旧进程不会自动重新加载已修复的 session 文件，需重启 Kerminal 后恢复的 `abc` 条目才会出现在左侧。
