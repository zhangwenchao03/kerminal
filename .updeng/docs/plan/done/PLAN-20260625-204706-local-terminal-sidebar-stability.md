---
id: PLAN-20260625-204706-local-terminal-sidebar-stability
status: done
created_at: 2026-06-25T20:47:06+08:00
started_at: 2026-06-25T20:47:06+08:00
completed_at: 2026-06-25T21:16:51+08:00
updated_at: 2026-06-25T21:16:51+08:00
owner: ai
---

# 本地终端侧栏稳定恢复修复

## 目标
- 用户在任意左侧分组中新建的本地终端连接，刷新、重启或 workspace session 被覆盖后仍显示在对应分组。
- 当前 `~/.kerminal` 中已存在但未显示的 `abc` 本地终端恢复到用户创建的 `local` 分组。

## 非目标
- 不把所有终端 profile 自动显示为左侧连接。
- 不读取或修改 `~/.kerminal/secrets/`。
- 不清理用户未确认的重复 profile 文件。

## 影响范围
- 前端 profile API 类型与本地连接动作。
- workspace store 的本地 profile 侧栏恢复逻辑。
- Rust profile 模型、profile TOML 序列化和服务保存逻辑。
- 当前用户普通 profile TOML 的一次性元数据补全。

## 执行步骤
- [x] 在 profile 模型中增加可选侧栏分组归属，并让创建、复制、移动、编辑、移除本地侧栏连接同步该字段。
- [x] 在 `setProfiles` 恢复链路中从已标记 profile 重建本地侧栏机器。
- [x] 给创建、恢复、移动和移除行为补聚焦回归测试。
- [x] 给当前 `abc` profile 补 `sidebar_group_id`，并运行 Kerminal 配置 validator。

## 验证
- `npx vitest run` 覆盖新增/相邻前端测试。
- Rust profile service 测试覆盖 TOML 字段持久化。
- `npm run build`。
- Vite dev server HTTP smoke。
- `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --root C:/Users/24052/.kerminal`。

## 风险
- 当前有运行中的 `kerminal.exe`，可能用旧内存状态再次写空 workspace session；修复后应重启应用再验收实际 UI。

## Round Log
- 2026-06-25T20:47:06+08:00：复查用户截图与本机配置，确认 `local` 分组和两个 `abc` profile 均存在，但 `workspace/session.json.sidebarMachines` 被运行中应用写回 0；根因是侧栏分组归属只存在于易丢的 workspace session。
- 2026-06-25T21:16:51+08:00：完成代码修复和当前配置修复。新增 profile `sidebar_group_id`/`sidebarGroupId` 可选字段，创建、复制、移动、移除本地侧栏连接会同步字段；`setProfiles` 会从带分组标记的 profile 恢复本地机器。当前只将较新的 `e3c39643-603f-4f63-89e2-c01574ce578f` 标记到用户 `local` 分组，保留旧同名 profile 但不固定，避免重复显示。验证：前端聚焦测试 49 个通过；Rust `profile_service` 6 个、`config_file_store` 7 个、`external_agent_workspace` 19 个通过；`cargo fmt --check`、`npm run build`、Vite `HTTP 200`、配置 validator 和 validator self-test 均通过。运行中的旧 `kerminal.exe` 仍需重启/重跑后才能加载代码修复。
