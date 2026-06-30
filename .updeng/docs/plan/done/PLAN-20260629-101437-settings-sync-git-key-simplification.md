---
id: PLAN-20260629-101437-settings-sync-git-key-simplification
status: done
created_at: 2026-06-29T10:14:37+08:00
started_at: 2026-06-29T10:21:29+08:00
completed_at: 2026-06-29T10:48:45+08:00
updated_at: 2026-06-29T11:09:47+08:00
owner: ai
lane: lane-settings-sync-git-key-simplification
---

# 设置同步页 Git 与密钥极简改造

## 背景

用户要求把设置里的同步界面和逻辑收敛为更小的生产级能力：界面只显示 Git 初始化情况；Git 初始化后展示同步按钮；同步含义是先拉取远程内容，再把本地内容提交；密钥区域显示密钥文件路径，并默认展示密钥文件内容，用户可以直接粘贴修改后保存；保存时做校验；不再提供其它按钮。界面文案使用中文，视觉参考 Apple 风格，整体极简。

当前代码已经有 `WorkspaceSyncService`、`workspace_sync_*` Tauri commands、`workspaceSyncApi.ts` 和设置页 `SyncSettingsSection`，但现有 UI 暴露了 `repair`、`key ops`、`export`、`import`、`rotate`、`dry-run` 等操作，不符合新口径；后端也尚无“同步”命令。

## 目标

- 设置页“同步”分类只保留两个用户可理解区域：Git 初始化/同步状态、密钥文件路径与内容编辑。
- Git 状态只表达初始化情况和必要失败原因；初始化完成后显示唯一 Git 操作按钮“同步”。
- “同步”按钮触发后端受控 Git 流程：临时保护本地修改，拉取远程内容，恢复本地修改，提交本地可追踪变更，并返回中文结果。
- 密钥区域显示 `vault-key.toml` 的绝对路径，打开页面后自动读取并展示当前密钥文件内容。
- 用户可在密钥文本框中粘贴或修改密钥，点击“保存”后后端解析、校验、验证可解密既有 vault，再原子写入并刷新状态。
- 全部可见文案改为中文，视觉保持 Apple-inspired：克制、低噪、系统字体、柔和边界、浅色/深色/跟随系统主题均可读。

## 非目标

- 不在本轮新增远程仓库配置、账号配置、分支切换、冲突解决器或 Git 历史浏览。
- 不提供导出、导入、轮换、dry-run、复制、生成新密钥等额外按钮。
- 不把 `secrets/vault-key.toml` 纳入 Git 跟踪；该文件仍必须被 `.gitignore` 排除。
- 不自动 `git push`。本计划按用户“拉远程内容，把本地内容提交”的字面口径实现为 pull + local commit；推送远端属于外部副作用，后续如需要应另开确认口径。
- 不重构整个设置页或设置分类导航；只改同步分类内部和必要 API/服务边界。

## 产品补充与默认决策

- Git 未初始化或 Git 不可用时：只显示状态、原因和密钥编辑区，不显示“同步”按钮；应用启动和进入同步页仍可复用现有 bootstrap 尝试初始化。
- 已初始化但无远程 upstream 时：允许“同步”执行本地提交，结果提示“未配置远程，已跳过拉取”；不把这视为失败。
- 已初始化且有 upstream 时：先保护本地工作区，再拉取远程，再恢复本地修改并提交。若拉取或恢复出现冲突，停止提交并把冲突状态返回给 UI。
- 无本地变更时：同步成功但不创建空提交，结果提示“没有本地变更需要提交”。
- Git commit 作者缺失时：不自动写入全局配置，返回“需要配置 Git user.name / user.email”。
- 密钥内容属于敏感信息：产品要求默认展示，但实现不得把真实内容写入日志、测试快照、计划文档、错误上报或验收截图；截图验证使用隔离测试工作区或遮挡真实密钥。

## 目标界面

- 顶部区域标题：`同步`
- Git 行：
  - 左侧显示 `Git 状态`
  - 状态值使用 `已初始化` / `未初始化` / `Git 不可用` / `同步冲突` 等中文短句
  - 初始化完成后右侧只显示一个主按钮：`同步`
  - 运行中按钮显示 `同步中...` 并禁用
- 密钥区域：
  - 标题：`密钥文件`
  - 路径：显示完整 `vault-key.toml` 路径，支持长路径截断但保留 hover/title 或可选择文本
  - 文本框：默认填充密钥文件内容，使用等宽字体，支持多行编辑
  - 操作：只保留 `保存` 按钮；保存中显示 `保存中...`
  - 校验反馈：保存成功、格式错误、无法解密既有 vault、写入失败均用中文内联提示

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 前端页面 | 是 | `src/features/settings/settings-tool-content/sync-section.tsx`、`src/features/settings/SettingsToolContent.tsx` | `npm run test -- SettingsToolContent.sync.test.tsx`、真实 dev server 三主题截图 |
| 前端 API | 是 | `src/lib/workspaceSyncApi.ts` | API mock 测试、Tauri invoke 参数断言 |
| Tauri command | 是 | `src-tauri/src/commands/workspace_sync.rs`、`src-tauri/src/commands/registry.rs` | Rust command/service 编译与测试 |
| Rust 服务 | 是 | `src-tauri/src/services/workspace_sync_service.rs`、`src-tauri/src/services/encrypted_vault_service.rs` | `cargo test --test workspace_sync_service`、Git 可用时临时仓库集成测试 |
| 主题/视觉 | 是 | 同步设置页样式与现有主题变量 | 浅色、深色、跟随系统主题真实界面验证 |
| Git 外部副作用 | 是 | 用户 `~/.kerminal` Git 仓库 | 默认不 push；冲突/缺远程/缺作者配置返回可解释结果 |
| 密钥安全 | 是 | `secrets/vault-key.toml` | 不记录真实密钥；保存前校验；写入前备份 |

## 接口与模型设计

### 前端 API

- 保留 `getWorkspaceSyncStatus()`，但 UI 只消费 Git 初始化状态和密钥路径。
- 将内部“读取密钥内容”能力命名为 `readVaultKeyContent()`，可复用现有 `workspace_sync_export_key` 或新增语义更清晰的 command。
- 新增 `saveVaultKeyContent(keyToml: string)`，不暴露 dry-run；后端负责先校验再写入。
- 新增 `runWorkspaceSync()`，返回 `WorkspaceSyncRunResult`：
  - `pulled: boolean`
  - `committed: boolean`
  - `skippedRemote: boolean`
  - `commitHash?: string`
  - `message: string`
  - `status: "success" | "warning" | "conflict" | "error"`

### 后端 command

- 新增 `workspace_sync_read_key`：读取并校验当前 key TOML，返回字符串。
- 新增 `workspace_sync_save_key`：接收 `keyToml`，解析、校验、验证可解密既有 vault，原子写入并备份旧 key。
- 新增 `workspace_sync_run`：执行受控 Git 同步流程，返回结构化结果。
- 旧的 `workspace_sync_export_key`、`workspace_sync_import_key`、`workspace_sync_rotate_key` 可以先保留为内部/兼容命令，但设置页不再调用、不再展示按钮；后续清理另开小切片。

## Git 同步算法

1. 确认 `git` 可执行，确认 `~/.kerminal` 已是 Git 仓库；否则返回中文错误或警告。
2. 确保 `.gitignore` 包含 Kerminal local-only 规则，尤其不能跟踪 `secrets/vault-key.toml`。
3. 检查当前分支和 upstream：
   - 有 upstream：继续拉取。
   - 无 upstream：跳过拉取，只做本地提交。
4. 如果工作区有未提交改动，创建临时 stash（包含未跟踪文件，不包含 ignored 文件），用于避免 pull 与本地脏工作区互相阻塞。
5. 有 upstream 时执行 `git pull --rebase`，失败则尝试恢复 stash，返回拉取失败原因。
6. 恢复临时 stash；如果发生冲突，保留 Git 冲突现场，返回“需要手动处理冲突”，不继续提交。
7. 执行 `git add --all -- .`，由 `.gitignore` 保护密钥和本地缓存不进入提交。
8. 若 `git diff --cached --quiet` 表示无变更，返回成功但 `committed=false`。
9. 执行 `git commit -m "sync: update kerminal workspace"`；失败时区分作者缺失、hook 失败和其它错误。
10. 返回 commit hash、是否拉取、是否提交、是否跳过远程和中文摘要；不执行 push。

## 实施步骤

- [x] TASK-001：前置同步与确认。刷新 `.updeng/docs/coordination/status.md`，读取设置通知入口修复的完成计划、最新设置页 diff 和当前工作区状态；确认同步页文件当前归属和共享修改边界。
- [x] TASK-002：后端密钥读写收敛。为 `WorkspaceSyncService` 增加 read/save key 语义，复用 `EncryptedVaultService` 的 TOML 校验、现有 vault 解密校验、原子写入和备份能力。
- [x] TASK-003：后端 Git 同步能力。实现 `workspace_sync_run` 的结构化结果和受控 Git 命令执行；覆盖无 Git、未初始化、无 upstream、无变更、有变更、冲突/失败分支。
- [x] TASK-004：前端 API 收敛。更新 `workspaceSyncApi.ts` 类型和函数，移除设置页对 export/import/rotate/dry-run 的直接依赖。
- [x] TASK-005：设置页 UI 极简改造。重写 `SyncSettingsSection` 为 Git 状态 + 密钥路径/内容编辑两块；只保留 `同步` 和 `保存` 两个按钮；所有文案中文化。
- [x] TASK-006：视觉与主题打磨。使用现有 `kerminal-solid-surface`、主题 CSS 变量和 Apple-inspired 间距/圆角/边界规则，验证浅色、深色、跟随系统主题；避免嵌套卡片和高噪声徽章。
- [x] TASK-007：测试更新。删除旧 key console/export/import/rotate UI 断言，补同步按钮可见性、默认加载密钥、保存校验、错误反馈和中文文案测试；补 Rust 服务测试。
- [x] TASK-008：启动与真实界面验证。运行聚焦测试、Rust 测试、`npm run build`、真实 dev server 冒烟截图；涉及 Tauri command 后运行 `npm run tauri:dev` 或记录无法运行原因。

## 验证计划

- `npm run test -- SettingsToolContent.sync.test.tsx`
- `npm run test -- workspaceSyncApi`
- `cd src-tauri && cargo test --test workspace_sync_service`
- `cd src-tauri && cargo test workspace_sync`
- `npm run build`
- `npm run dev -- --host 127.0.0.1 --port <free-port>`
- 真实界面验证：
  - 设置页进入“同步”
  - 浅色、深色、跟随系统主题均可读
  - Git 未初始化时不显示“同步”按钮
  - Git 已初始化时只显示“同步”按钮
  - 密钥路径可见，密钥内容默认加载
  - 输入非法 TOML 保存失败且不写入
  - 输入合法 key 保存成功并刷新状态
- `npm run tauri:dev`：因为新增/调整 Tauri command，必须跑；若端口或已有窗口占用，记录具体原因和替代 `cargo run`/dev server 证据。

## 风险与回滚

- Git pull/rebase 可能产生冲突：实现必须在冲突时停止提交，并返回清晰中文状态；不得吞掉冲突或自动覆盖远端/本地内容。
- Git stash/恢复失败会影响用户工作区：必须只在 `~/.kerminal` 工作区内执行，记录 stash 名称，并在失败结果里提示用户如何处理。
- 密钥默认展示有泄露风险：遵循用户要求展示，但不写入日志、文档、测试快照或截图；验证时使用隔离工作区。
- 保存密钥可能导致 vault 无法解密：保存前必须验证可解密既有 vault；不通过时不写入。
- 现有工作区有并行未归因改动：后续实现必须先读最新 diff，不宽泛格式化共享设置页文件，不回滚其它 lane 改动。
- 回滚方式：前端可恢复旧 `SyncSettingsSection`；后端新增 command 可暂不注册；密钥保存已有 `.bak.<timestamp>` 备份可人工恢复。

## 并行协作

- lane：`lane-settings-sync-git-key-simplification`
- 状态：`active`
- 计划开工前必须刷新 lane status，并读取设置通知入口修复完成计划、最新文件和当前 diff。
- 设置页文件仍是潜在共享热点；实现时优先在 `sync-section.tsx` 内局部替换，不重排 `SettingsToolContent.tsx` 和分类配置。
- 每完成一个可验证切片后，运行 checkpoint 或提交具体文件，并在 Round Log 写入 touched paths、验证和剩余风险。

## Round Log

- 2026-06-29T10:14:37+08:00：创建 next 计划。已基于 CodeGraph 读取 `SyncSettingsSection`、`workspaceSyncApi.ts`、`WorkspaceSyncService`、`EncryptedVaultService` 和现有 sync 测试；确认当前 UI 仍有 export/import/rotate/dry-run，后端已有 bootstrap/key import/export/rotate 但没有 sync run。
- 2026-06-29T10:21:29+08:00：开始实施，计划从 `next` 移到 `active`，本轮先执行 TASK-001 前置同步与确认，再做后端和前端最小闭环。
- 2026-06-29T10:48:45+08:00：完成实施与验证。主要修改 `src/features/settings/settings-tool-content/sync-section.tsx`、`src/lib/workspaceSyncApi.ts`、`src-tauri/src/services/workspace_sync_service.rs`、`src-tauri/src/services/encrypted_vault_service.rs`、`src-tauri/src/commands/workspace_sync.rs`、`src-tauri/src/commands/registry.rs`、`src/features/settings/settings-tool-content/options.ts`、`src/features/settings/SettingsToolContent.sync.test.tsx` 和 `src-tauri/tests/workspace_sync_service.rs`。同步页已收敛为 Git 初始化状态、初始化后同步按钮、密钥路径、密钥内容 textarea 和保存按钮；浏览器预览因非 Tauri 环境显示 `Git 不可用`，Git 已初始化显示同步按钮由组件测试覆盖。验证通过：`cargo fmt`；`npm run test -- SettingsToolContent.sync.test.tsx`；`npm run test -- SettingsToolContent`；`cd src-tauri && cargo test --test workspace_sync_service --target-dir target\codex-workspace-sync`；`cd src-tauri && cargo test workspace_sync --target-dir target\codex-workspace-sync`；`npm run build`；`npm run dev -- --host 127.0.0.1 --port 14713` + Playwright/Edge 截图检查；`npm run tauri:dev -- --no-watch --config '{"build":{"beforeDevCommand":""}}'` 使用既有 1425 Kerminal Vite 服务和隔离 `CARGO_TARGET_DIR=src-tauri\target\codex-tauri-dev` 成功编译并启动。截图证据位于 `.updeng/tmp/verification/settings-sync-git-key/settings-sync-light.png`、`settings-sync-dark.png`、`settings-sync-system-dark.png`、`settings-sync-narrow-light.png`；验证时未记录真实密钥内容，仅使用浏览器 fallback 示例。当前工作区仍有其它 lane 的既有脏改和未跟踪文件，本计划未提交。
- 2026-06-29T11:09:47+08:00：交付前审查补强 `workspace_sync_run`：`git add --all -- .` 后显式 `git reset --` 本地专用路径，避免 `secrets/vault-key.toml` 等文件即使历史上被误跟踪也进入同步提交；新增 `workspace_sync_run_does_not_commit_tracked_vault_key_changes`。加固后验证通过：`cargo fmt`、`cd src-tauri && cargo test --test workspace_sync_service --target-dir target\codex-workspace-sync`（10 passed）、`npm run tauri:dev -- --no-watch --config '{"build":{"beforeDevCommand":""}}'` 使用既有 1425 Kerminal Vite 服务和隔离 `CARGO_TARGET_DIR=src-tauri\target\codex-tauri-dev` 成功增量编译并启动。加固后再次尝试 `cd src-tauri && cargo test workspace_sync --target-dir target\codex-workspace-sync` 触发 Windows 页面文件不足 / mmap 元数据失败（os error 1455），随后用新 target 串行 `cargo test workspace_sync --target-dir target\codex-workspace-sync-serial -j 1` 复跑但长时间卡在编译/链接无输出后中断；该宽过滤不作为通过证据，最新代码的有效 Rust 证据以聚焦集成测试和 Tauri 增量启动为准。
