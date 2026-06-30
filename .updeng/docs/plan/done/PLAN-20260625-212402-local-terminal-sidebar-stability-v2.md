---
id: PLAN-20260625-212402-local-terminal-sidebar-stability-v2
status: done
created_at: 2026-06-25T21:24:02+08:00
started_at: 2026-06-25T21:24:02+08:00
completed_at: 2026-06-25T21:43:41+08:00
updated_at: 2026-06-25T22:06:00+08:00
owner: ai
---

# 本地终端侧栏稳定恢复二次修复

## 目标
- 用户在自建 `local` 分组中添加的本地终端 `abc`，在刷新、重启、workspace session 被写空或残留旧删除标记后，仍由 profile 文件恢复到 `local` 分组。
- 以 `profiles/*.toml` 的 `sidebar_group_id` 作为 profile-backed 本地侧栏连接的事实源，workspace session 只保存运行态缓存。
- 用自动化回归和真实启动验证证明左侧主机树显示 `abc`，而不是只证明配置文件存在。

## 非目标
- 不自动把所有终端 profile 显示到左侧；只有带 `sidebar_group_id` 的 profile 显示。
- 不删除用户未确认的旧同名 `abc` profile。
- 不读取或修改 `~/.kerminal/secrets/`。

## 诊断假设
| 排名 | 假设 | 如果为真应观察到 | 验证方式 |
| --- | --- | --- | --- |
| 1 | `removedSidebarMachineIds` 中的旧 tombstone 会继续过滤带 `sidebar_group_id` 的 profile | profile 文件已固定，但 `setProfiles` 后对应 local machine 仍缺失或留在错误分组 | 增加 workspace store 回归测试：session 带 tombstone，profile 带 `sidebarGroupId`，期望仍恢复 |
| 2 | 启动顺序中 session restore、remote host tree load、profile load 互相覆盖 | 不同加载顺序下 `abc` 有时出现、有时消失 | 增加 profile-before-host、host-before-profile、empty-session 后加载 profile 的测试 |
| 3 | 真实运行的旧 `kerminal.exe` 未加载新代码，继续写旧 session | 文件修好但 UI 不变，进程启动时间早于新构建 | 重新 build 并真实启动 dev/Tauri smoke，检查 session 和 UI |

## 修复方案
1. 调整本地 profile 侧栏恢复模型：`profile.sidebarGroupId` 明确固定时，不能被 session tombstone 过滤；删除本地 profile 卡片时已经会清空 `sidebarGroupId`，因此 tombstone 只用于 session 派生的临时 local/container。
2. 补强 `setProfiles`/`restoreWorkspaceSession` 回归测试，覆盖空 session、旧 tombstone、加载顺序和错误分组覆盖。
3. 保持当前用户配置只固定较新的 `abc` profile 到 `local` 分组，旧同名 profile 不固定，避免重复显示。
4. 运行前端聚焦测试、Rust profile/config 测试、配置 validator、`npm run build`、dev server smoke，并尽力跑真实 `npm run tauri:dev` 或记录无法自动截图的原因。

## 执行步骤
- [x] 写出失败回归测试，证明当前实现对旧 tombstone/加载顺序不稳定。
- [x] 修改恢复逻辑，使 profile metadata 优先于 session tombstone。
- [x] 复查 TypeScript/Rust profile 序列化链路和用户配置。
- [x] 同步修复侧栏本地 profile 连续双击只聚焦旧 tab、不能多开的问题。
- [x] 运行验证命令和启动检查。
- [x] 清理计划、lane 和 Round Log。

## 验证
- `npx vitest run src/features/workspace/workspaceStore.test.ts src/app/useWorkspaceSessionPersistence.test.ts src/app/useKerminalShellRemoteActions.localProfile.test.tsx src/lib/profileApi.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-local-sidebar-v2 --test profile_service`
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-local-sidebar-v2 --test config_file_store`
- `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --root C:/Users/24052/.kerminal`
- `npm run build`
- dev server HTTP smoke；涉及 Tauri/Rust 后尽力执行 `npm run tauri:dev` 启动冒烟。

## 风险
- 当前工作区存在多个并行 active lane，`workspaceStore.ts` 与 layout restore lane 共享；本轮只改本地 profile/sidebar 恢复逻辑，不格式化共享文件。
- 当前仍有旧 `kerminal.exe` 运行进程，真实 UI 验收前需要避免旧进程继续写入旧 session。

## Round Log
- 2026-06-25T21:24:02+08:00：用户反馈上轮没有稳定修复。复查当前事实源：`hosts/groups.toml` 中 `local` 分组存在，较新的 `abc` profile 已有 `sidebar_group_id`，`workspace/session.json` 当前也有 `abc` sidebar machine；但用户截图显示 `local` 分组数量为 0。重新开 active 计划，优先验证 session tombstone 和加载顺序是否会遮蔽 profile 事实源。
- 2026-06-25T21:43:41+08:00：完成二次修复。根因是 `setProfiles` 仍让旧 `removedSidebarMachineIds` tombstone 过滤当前 profile 明确声明的 `sidebarGroupId`，导致文件事实源存在但 UI 侧栏可被旧 session 删除状态遮蔽；已改为 profile-backed local sidebar machine 由 `profiles/*.toml` 的 `sidebar_group_id` 优先，且同步清掉对应 stale tombstone。另修复用户追加反馈：侧栏双击本地 profile 之前会走 `focusExistingMachineTabState`，第二次只聚焦已有 tab；已改成本地 profile 每次打开新 tab/pane，容器入口仍保留聚焦已有 tab 语义。
- 2026-06-25T21:43:41+08:00：验证通过：`npx vitest run src/features/workspace/workspaceStore.test.ts -t "stale local tombstone"` 红绿复现；`npx vitest run src/features/workspace/workspaceStore.terminalOpen.test.ts -t "repeated local profile"` 红绿复现；`npx vitest run src/features/workspace/workspaceStore.terminalOpen.test.ts src/features/workspace/workspaceStore.test.ts src/app/useWorkspaceSessionPersistence.test.ts src/app/useKerminalShellRemoteActions.localProfile.test.tsx src/lib/profileApi.test.ts` 通过 76 tests；`cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-local-sidebar-v2 --test profile_service` 通过 6 tests；`cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-local-sidebar-v2 --test config_file_store` 通过 7 tests；`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --root C:/Users/24052/.kerminal` 通过；`node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --self-test` 通过；`npm run build` 通过。启动冒烟：独立 Vite `http://127.0.0.1:1535/` + system Chrome 通过，页面无 errors，侧栏包含 `abc`，连续打开生成 `tab-local-1`/`tab-local-2` 和 `pane-local-1`/`pane-local-2`；截图见 `.updeng/tmp/local-sidebar-smoke.png`。`npm run tauri:dev` 未直接重启，因为已有旧 `kerminal.exe` 和 `1425` dev server 正在运行，避免打断用户当前窗口。
- 2026-06-25T22:06:00+08:00：用户继续追问双击多开，追加事件层回归测试：`MachineSidebar` 对同一本地机器连续两次 `dblClick` 会两次调用 `onOpenLocalTerminal("local-powershell")`，配合 store 层 `openLocalTerminal` 每次新增 `tab-local-*` / `pane-local-*` 证明左侧双击不会复用旧 tab。真实配置复查：`C:/Users/24052/.kerminal/profiles/e3c39643-603f-4f63-89e2-c01574ce578f.toml` 为 `abc` 且 `sidebar_group_id = "18e40b63-b636-4827-baa3-8c26e52795b3"`；旧同名 `775bb619-7f5f-439c-821b-4713c6c5ccdb.toml` 无 `sidebar_group_id`，因此不显示为第二个侧栏项。真实 session 摘要：`sidebarMachines` 含 `profile:e3c39643-603f-4f63-89e2-c01574ce578f|abc|18e40b63-b636-4827-baa3-8c26e52795b3`，`terminalTabs` 中同一 profile 已有 3 个本地 tab；真实 Tauri dev 进程 PID `45148` 与 `127.0.0.1:1425` 正在运行，窗口截图曾捕获 `local / abc` 和 `abc` 标签组数量 3，见 `.updeng/tmp/local-sidebar-tauri-before.png`。坐标双击自动化因 Windows 透明 WebView/DPI 虚拟坐标无法稳定命中，不作为通过证据。
- 2026-06-25T22:06:00+08:00：追加验证通过：`npx vitest run src/features/machine-sidebar/MachineSidebar.test.tsx src/features/workspace/workspaceStore.terminalOpen.test.ts` 通过 46 tests；`npx vitest run src/app/useKerminalShellRemoteActions.localProfile.test.tsx src/features/workspace/workspaceStore.test.ts src/app/useWorkspaceSessionPersistence.test.ts src/lib/profileApi.test.ts` 通过 64 tests；`node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --root C:/Users/24052/.kerminal` 通过；`node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --self-test` 通过；`cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-local-sidebar-v2 --test profile_service` 通过 6 tests；`cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-local-sidebar-v2 --test config_file_store` 通过 7 tests；`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`npm run build` 通过。
