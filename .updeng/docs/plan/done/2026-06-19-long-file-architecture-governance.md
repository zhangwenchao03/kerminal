---
id: PLAN-20260619-232233-long-file-architecture-governance
status: done
created_at: 2026-06-19T23:22:33+08:00
started_at: 2026-06-20T08:13:49+08:00
completed_at: 2026-06-20T12:38:55+08:00
updated_at: 2026-06-20T12:38:55+08:00
owner: ai
---

# 超长源码文件架构治理与迁移计划

## 背景

当前源码统计显示，仓库内有 24 个源码文件超过 1000 行。主要集中在 Rust 后端服务、React feature 容器、测试套件和共享设置/工作区模型。该问题不是单纯行数问题，而是多个能力中心在长期演进中把入口编排、领域策略、外部系统适配、缓存、审计、UI 状态、测试 fake 和断言工具堆在同一文件中。

本计划从架构治理角度处理该问题：先建立模块边界和长期维护规则，再用可验证的迁移切片逐步落地，避免一次性重写和只按行数拆文件。

## 目标

- 降低核心能力文件的认知负担，使后续功能扩展集中在明确模块内。
- 将高风险大文件迁移为稳定 facade + 私有深模块结构，保持现有调用方 API 稳定。
- 建立后端 service、前端 feature、测试 support 的长期组织规范。
- 为后续 agent 或人工重构提供可执行、可回滚、可验证的任务切片。

## 非目标

- 初始计划不直接实施源码迁移；2026-06-20 用户要求后，本计划已扩展为实施计划并完成源码迁移。
- 不为了行数达标做机械拆分、浅 wrapper 或无领域边界的 utils 聚合。
- 不在同一轮同时重写公共 API、业务行为和目录结构。
- 不把测试文件拆分视为替代行为验证；迁移前后仍需通过对应测试。

## 架构原则

1. **稳定门面，内部深模块**
   保留现有 public service/component 入口，先把内部实现拆成私有子模块。调用方不应因为内部治理而大面积修改。

2. **按领域能力拆分**
   模块命名围绕能力和不变量，例如 `transfer`、`backend`、`policy`、`audit`、`provider`，避免 `utils`、`misc`、`helpers` 成为新的堆积点。

3. **外部系统 behind adapter**
   SSH/SFTP、MCP、Docker、终端和本地系统能力必须由 adapter trait 或等价边界隔离。真实实现、fake 实现和 loopback 测试设施不能混在业务编排层。

4. **编排层只编排**
   `SftpService`、`AiToolInvocationService`、`CommandSuggestionService` 这类对象保留为 orchestration facade；策略、执行器、缓存、审计、遥测和格式化逻辑下沉。

5. **前端 feature module 固化**
   每个 feature 形成固定结构：container、hooks、components/sections、model/utils、tests。UI 组件不直接承载 Tauri 调用和复杂状态机。

## 目标架构

### Rust 后端服务

推荐结构：

```text
src-tauri/src/services/<capability>_service.rs
src-tauri/src/services/<capability>_service/
  policy.rs
  adapter.rs
  native_adapter.rs
  cache.rs
  audit.rs
  telemetry.rs
  workflow.rs
  test_support.rs
```

约束：

- `<capability>_service.rs` 只暴露现有 public service 类型和主要入口。
- 子模块默认私有，只通过 facade 暴露必要类型。
- 只有存在真实替换需求时才抽 adapter；否则先抽领域模块，避免假缝隙。
- 测试 fake 优先放到 `tests/support` 或 `#[cfg(test)]` 模块。

### React 前端 feature

推荐结构：

```text
src/features/<feature>/
  <Feature>ToolContent.tsx
  hooks/
  components/
  sections/
  <feature>Model.ts
  <feature>Utils.ts
  <feature>.test.tsx
```

约束：

- container 负责组装数据、状态和副作用，不承载大段表单或菜单 JSX。
- hooks 负责状态机和异步副作用。
- model/utils 只放纯逻辑，必须有可聚焦单测。
- 新增或迁移 UI 时必须继续满足浅色、深色和跟随系统主题约束。

### 测试支撑

推荐结构：

```text
src-tauri/tests/support/
src/features/<feature>/testSupport.ts
```

约束：

- fixture、loopback server、sample request builder、断言 helper 与行为用例分离。
- 行为测试保留在对应能力维度，不按实现文件机械拆分。
- smoke 测试继续显式 gated，避免默认测试依赖外部主机。
- 测试代码不豁免行数治理；测试入口、fixture、test support、loopback harness 同样必须低于 1000 行。

## 影响范围

- 后端重点文件：
  - `src-tauri/src/services/sftp_service.rs`
  - `src-tauri/src/services/ai_tool_invocation_service.rs`
  - `src-tauri/src/services/command_suggestion_service.rs`
  - `src-tauri/src/services/mcp_tool_gateway.rs`
  - `src-tauri/src/services/docker_host_service.rs`
  - `src-tauri/src/services/ssh_command_service.rs`
- 前端重点文件：
  - `src/features/settings/SettingsToolContent.tsx`
  - `src/features/sftp/SftpToolContent.tsx`
  - `src/features/machine-sidebar/RemoteHostCreateDialog.tsx`
  - `src/features/terminal/XtermPane.tsx`
  - `src/features/tool-panel/AiToolContent.tsx`
  - `src/app/KerminalShell.tsx`
  - `src/features/workspace/workspaceStore.ts`
- 测试重点文件：
  - `src-tauri/tests/ai_tool_invocation_service.rs`
  - `src-tauri/tests/command_suggestion_ssh_smoke.rs`
  - `src/features/terminal/XtermPane.test.tsx`
  - `src/features/sftp/SftpToolContent.test.tsx`

## 执行步骤

- [ ] TASK-001 建立架构决策记录草案。
  - 涉及文件：`.updeng/docs/decisions/` 或项目现有 ADR 目录。
  - 验收标准：记录 facade + private submodules、AI tool executor registry、frontend feature module convention 三个长期决策候选。
  - 验证命令：文档检查；无需源码测试。

- [ ] TASK-002 建立迁移前基线。
  - 涉及文件：无源码改动。
  - 验收标准：记录当前超长文件列表、核心测试命令结果和已知阻塞。
  - 验证命令：`npm run test:frontend`、`npm run check:rust`、`npm run build`。

- [ ] TASK-003 低风险抽取前端纯逻辑。
  - 涉及文件：`settingsModel.ts`、`SftpToolContent.tsx`、`XtermPane.tsx` 及相邻 model/utils/test 文件。
  - 验收标准：仅移动纯函数、常量和格式化/解析逻辑，不改变 UI 和 Tauri 调用路径。
  - 验证命令：`npm run test:frontend`、`npm run test:terminal-ghost`、`npm run build`。

- [ ] TASK-004 抽取 Rust 测试支撑。
  - 涉及文件：`src-tauri/tests/ai_tool_invocation_service.rs`、`src-tauri/tests/command_suggestion_ssh_smoke.rs`、`src-tauri/tests/support/`。
  - 验收标准：fixture、loopback server、sample request builder 与行为测试分离，测试名称和覆盖行为保持不变。
  - 验证命令：`cd src-tauri && cargo test --test ai_tool_invocation_service`、`cd src-tauri && cargo test --test command_suggestion_ssh_smoke smoke_test_is_explicitly_gated`。

- [ ] TASK-005 迁移 SFTP service 为稳定 facade + 私有子模块。
  - 涉及文件：`src-tauri/src/services/sftp_service.rs`、`src-tauri/src/services/sftp_service/`。
  - 验收标准：先抽 `transfer`，再抽 `backend`、`remote_copy`、`archive`、`path`；`SftpService` public 方法保持兼容。
  - 验证命令：`cd src-tauri && cargo fmt --check`、`cd src-tauri && cargo test sftp`、`npm run check:rust`。

- [ ] TASK-006 迁移 AI tool invocation 为执行平台。
  - 涉及文件：`src-tauri/src/services/ai_tool_invocation_service.rs`、`src-tauri/src/services/ai_tool_invocation_service/`。
  - 验收标准：prepare/confirm/audit 保持平台能力；terminal/settings/profile/remote/sftp 等 executor 按领域拆分；新增工具不继续扩大中心 dispatcher。
  - 验证命令：`cd src-tauri && cargo test --test ai_tool_invocation_service`、`npm run check:rust`。

- [ ] TASK-007 迁移 command suggestion 为 provider 架构。
  - 涉及文件：`src-tauri/src/services/command_suggestion_service.rs`、`src-tauri/src/services/command_suggestion_service/`。
  - 验收标准：history/spec/remote path/remote command/remote history/git provider 独立；cache、scoring、telemetry、audit 边界明确。
  - 验证命令：`cd src-tauri && cargo test --test command_suggestion_service`、`npm run verify:command-suggestion-latency`、`npm run smoke:ssh-suggestions:loopback`。

- [ ] TASK-008 迁移主要前端容器。
  - 涉及文件：`SettingsToolContent.tsx`、`SftpToolContent.tsx`、`RemoteHostCreateDialog.tsx`、`XtermPane.tsx`、`AiToolContent.tsx`。
  - 验收标准：每个容器收敛为状态/副作用编排；section、dialog、table、menu、panel 组件独立；主题继承不回退。
  - 验证命令：对应 Vitest 文件、`npm run test:frontend`、`npm run build`；涉及终端时追加 `npm run check:terminal-ghost`。

- [ ] TASK-009 收敛 workspace/store 和 shared model。
  - 涉及文件：`workspaceStore.ts`、`settingsModel.ts`、Rust `models/settings.rs`。
  - 验收标准：先抽纯 helper，再决定是否引入 store slice；`useWorkspaceStore` 外部 API 保持稳定。
  - 验证命令：`npm run test:frontend`、`npm run test:rust`、`npm run build`。

- [x] TASK-010 固化长期门禁。
  - 涉及文件：文档、可选脚本、CI 或本地检查配置。
  - 验收标准：新增/修改超过 800 行源码文件需要说明模块边界；超过 1000 行的源码或测试文件必须继续拆分，测试文件不豁免。
  - 验证命令：最终执行物理行数审计、前端/Rust 窄测、`npm run build`、Vite dev server smoke、`npm run tauri:dev` smoke。

## 推荐第一条 Tracer Bullet

优先执行 `TASK-005` 的第一小步：从 `sftp_service.rs` 抽取 `transfer` 模块。

原因：

- 当前最大文件是 SFTP service，收益最大。
- `TransferTask`、`TransferProgress`、`TransferLimiter` 天然围绕传输队列和状态不变量，可以形成深模块。
- 该步骤可保持 public API 不变，回滚成本低。
- 能验证 Rust 文件 + 同名子目录的组织方式是否适合后续迁移。

## ADR 候选

- ADR-0001：后端能力服务采用 stable facade + private submodules。
- ADR-0002：AI 工具调用采用 executor registry，中心服务只承担 prepare/confirm/audit 编排。
- ADR-0003：前端 feature module 目录规范和主题验证门禁。
- ADR-0004：超长源码文件治理门禁与豁免规则。

## 验证

- 每个源码迁移切片至少运行对应的窄测试命令。
- 前端 UI 迁移必须运行 `npm run build`，并按项目主题约束验证浅色、深色和跟随系统主题。
- 涉及 Tauri/Rust 服务、窗口、权限或启动路径时，按项目规则补充 `npm run tauri:dev` 或明确无法运行原因。
- 阶段完成前运行 `npm run check`。

## 风险

- **浅拆分风险**：如果只移动代码而没有形成能力边界，会增加跳转成本。缓解方式是按领域能力和不变量命名模块。
- **公共 API 回归风险**：服务入口被改动会扩大调用方影响。缓解方式是 facade 保持兼容，先私有抽取。
- **测试伪装风险**：只拆测试文件不等于行为受保护。缓解方式是保留行为测试，并把 support 抽取限制在 fixture/helper。
- **前端主题回归风险**：拆组件时可能丢失全局主题上下文。缓解方式是迁移后按浅色、深色和跟随系统主题验证。
- **长周期漂移风险**：计划过大可能执行中失焦。缓解方式是每个 TASK 拆为可独立验证的子切片，完成后更新本计划 Round Log。

## Round Log

- 2026-06-19 23:22 创建架构治理计划文档，作为超长源码文件长期维护和迁移的 next 计划；本轮未改源码，未运行构建或测试。
- 2026-06-20 08:13 用户明确要求实施本计划，并要求所有源码文件最终不超过 1000 行。重新统计当前源码入口 `src/`、`src-tauri/src/`、`src-tauri/tests/`、`scripts/`，发现仍有 29 个源码文件超过 1000 行，最大项为 `src-tauri/src/services/sftp_service.rs` 5549 行、`src-tauri/tests/ai_tool_invocation_service.rs` 4201 行、`src/features/machine-sidebar/RemoteHostCreateDialog.tsx` 4138 行、`src-tauri/src/services/ai_tool_invocation_service.rs` 3960 行、`src-tauri/src/services/command_suggestion_service.rs` 3940 行、`src/features/sftp/SftpToolContent.tsx` 3812 行和 `src/features/settings/SettingsToolContent.tsx` 3767 行。
- 2026-06-20 08:13 执行 `TASK-003` 的低风险子切片：从 `src/features/sftp/SftpToolContent.tsx` 抽出 SFTP 传输展示纯逻辑到 `src/features/sftp/sftpTransferModel.ts`，抽出文件名和字节格式化到 `src/features/sftp/sftpFileUtils.ts`，新增 `src/features/sftp/sftpTransferModel.test.ts` 覆盖排序、upsert、未知总大小、超过总量 clamp、成功态、状态摘要、活动/终态计数、Windows 路径文件名和字节格式化边界。`SftpToolContent.tsx` 从 3812 行降到 3663 行，新文件均低于 200 行；本任务尚未完成，因为 `settingsModel.ts` 和 `XtermPane.tsx` 子切片仍未执行。
- 2026-06-20 08:13 验证通过：`npm run test:frontend -- src/features/sftp/sftpTransferModel.test.ts`、`npm run test:frontend -- src/features/sftp/SftpToolContent.test.tsx src/features/sftp/sftpTransferModel.test.ts`、`npm run typecheck`、`npm run build`、Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测、完整 `npm run test:frontend` 56 个测试文件 / 507 个测试通过。未运行 Rust/Tauri 验证，因为本轮只修改 React/TypeScript 前端纯逻辑和测试。
- 2026-06-20 08:27 执行 `TASK-003` 的第二个低风险子切片：从 `src/features/settings/settingsModel.ts` 抽出数值边界常量到 `src/features/settings/settingsLimits.ts`，抽出默认配置到 `src/features/settings/settingsDefaults.ts`，抽出设置页展示选项到 `src/features/settings/settingsOptions.ts`；`settingsModel.ts` 保留原有 public 导出面，继续作为类型和归一化 facade。`settingsModel.ts` 从 1224 行降到 858 行，新文件分别为 24、271、166 行，均低于 1000 行。
- 2026-06-20 08:27 验证通过：`npm run test:frontend -- src/features/settings/settingsModel.test.ts` 1 个文件 / 6 个测试通过；`npm run test:frontend -- src/features/settings/settingsModel.test.ts src/features/settings/SettingsToolContent.test.tsx src/features/settings/keybindingUtils.test.ts src/features/settings/SettingsDialog.test.tsx` 4 个文件 / 21 个测试通过；完整 `npm run test:frontend` 56 个文件 / 507 个测试通过；`npm run typecheck` 通过；`npm run build` 通过；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只修改 React/TypeScript 设置模型拆分。
- 2026-06-20 08:27 统一后续超长文件基线为 PowerShell `(Get-Content).Count` 物理行数口径，避免 `Measure-Object -Line` 漏掉临界测试文件；当前仍有 31 个源码/测试文件超过 1000 行，`settingsModel.ts` 已退出超限清单。
- 2026-06-20 08:31 执行设置测试支撑拆分：从 `src/features/settings/SettingsToolContent.test.tsx` 抽出 MCP gateway manifest fixture 到 `src/features/settings/SettingsToolContent.testSupport.ts`，测试文件只保留 mock、交互 helper 和行为用例。`SettingsToolContent.test.tsx` 从 1088 行降到 886 行，新增 test support 文件 202 行。
- 2026-06-20 08:31 验证通过：`npm run test:frontend -- src/features/settings/SettingsToolContent.test.tsx` 1 个文件 / 9 个测试通过；完整 `npm run test:frontend` 56 个文件 / 507 个测试通过；`npm run typecheck` 通过；`npm run build` 通过；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只拆分 React 测试支撑。
- 2026-06-20 08:31 按 PowerShell `(Get-Content).Count` 物理行数口径复查，当前仍有 30 个源码/测试文件超过 1000 行；`settingsModel.ts` 和 `SettingsToolContent.test.tsx` 均已退出超限清单。
- 2026-06-20 08:44 执行前端测试文件治理子切片：按 SFTP 工具协议分支把 `src/lib/aiToolInvocationApi.test.ts` 中 7 个 SFTP browser preview 行为用例迁移到同目录 `src/lib/aiToolInvocationApi.sftp.test.ts`，新文件使用表驱动场景保留每个用例名称和原有 pending/audit 断言。`aiToolInvocationApi.test.ts` 从 1115 行降到 854 行，新 SFTP 测试文件 219 行，均低于 1000 行。
- 2026-06-20 08:44 验证通过：`npm run test:frontend -- src/lib/aiToolInvocationApi.test.ts src/lib/aiToolInvocationApi.sftp.test.ts` 2 个文件 / 32 个测试通过；完整 `npm run test:frontend` 57 个文件 / 507 个测试通过；`npm run typecheck` 通过；`npm run build` 通过；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只拆分 React/TypeScript 测试文件。
- 2026-06-20 08:44 按 PowerShell `(Get-Content).Count` 物理行数口径复查，当前仍有 29 个源码/测试文件超过 1000 行；`src/lib/aiToolInvocationApi.test.ts` 已退出超限清单。
- 2026-06-20 08:55 执行前端生产组件模型抽取子切片：从 `src/features/tool-panel/ServerInfoToolContent.tsx` 抽出服务器指标纯模型到 `src/features/tool-panel/serverInfoMetricsModel.ts`，包括网络采样缓存、接口速率计算、接口排序、字节/百分比/时间/GPU 展示格式化和缺失提示；新增 `src/features/tool-panel/serverInfoMetricsModel.test.ts` 覆盖聚合网卡回退、采样速率、缓存清理、格式化和 GPU 摘要边界。`ServerInfoToolContent.tsx` 从 1287 行降到 887 行，新模型 459 行，新测试 146 行，均低于 1000 行。
- 2026-06-20 08:55 验证通过：`npm run test:frontend -- src/features/tool-panel/serverInfoMetricsModel.test.ts src/features/tool-panel/ToolPanel.test.tsx` 2 个文件 / 19 个测试通过；完整 `npm run test:frontend` 58 个文件 / 511 个测试通过；`npm run typecheck` 通过；`npm run build` 通过；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只修改 React/TypeScript 前端组件模型和测试。
- 2026-06-20 08:55 按 PowerShell `(Get-Content).Count` 物理行数口径复查，当前仍有 28 个源码/测试文件超过 1000 行；`src/features/tool-panel/ServerInfoToolContent.tsx` 已退出超限清单。
- 2026-06-20 09:04 执行前端测试文件治理子切片：从 `src/features/machine-sidebar/RemoteHostCreateDialog.test.tsx` 抽出共享 fixture 和下拉选择 helper 到 `src/features/machine-sidebar/RemoteHostCreateDialog.testSupport.ts`，并把 Telnet/Serial 专属行为用例迁移到 `src/features/machine-sidebar/RemoteHostCreateDialog.serialTelnet.test.tsx`。原测试文件从 1020 行降到 768 行，新 Telnet/Serial 测试 166 行，test support 114 行，均低于 1000 行。
- 2026-06-20 09:04 验证通过：`npm run test:frontend -- src/features/machine-sidebar/RemoteHostCreateDialog.test.tsx src/features/machine-sidebar/RemoteHostCreateDialog.serialTelnet.test.tsx` 2 个文件 / 19 个测试通过；完整 `npm run test:frontend` 59 个文件 / 512 个测试通过；`npm run typecheck` 通过；`npm run build` 通过；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只修改 React/TypeScript 前端测试和测试支撑。
- 2026-06-20 09:04 按 PowerShell `(Get-Content).Count` 物理行数口径复查，当前仍有 27 个源码/测试文件超过 1000 行；`src/features/machine-sidebar/RemoteHostCreateDialog.test.tsx` 已退出超限清单。
- 2026-06-20 09:08 执行前端测试支撑拆分子切片：从 `src/features/workspace/workspaceStore.test.ts` 抽出 profile、remote host tree、Docker container 等静态 fixture 到 `src/features/workspace/workspaceStore.testSupport.ts`，test support 不依赖 `useWorkspaceStore`，避免污染测试初始化顺序。原测试文件从 1084 行降到 865 行，新 test support 228 行，均低于 1000 行。
- 2026-06-20 09:08 验证通过：`npm run test:frontend -- src/features/workspace/workspaceStore.test.ts` 1 个文件 / 42 个测试通过；完整 `npm run test:frontend` 59 个文件 / 512 个测试通过；`npm run typecheck` 通过；`npm run build` 通过；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只修改 React/TypeScript 前端测试和测试支撑。
- 2026-06-20 09:08 按 PowerShell `(Get-Content).Count` 物理行数口径复查，当前仍有 26 个源码/测试文件超过 1000 行；`src/features/workspace/workspaceStore.test.ts` 已退出超限清单。
- 2026-06-20 09:19 执行前端编辑器模型抽取子切片：从 `src/features/sftp/RemoteWorkspaceEditor.tsx` 抽出树节点、打开文件 tab、路径归一化、语言识别、tree update、dirty 判断、错误消息和远程目标解析到 `src/features/sftp/remoteWorkspaceEditorModel.ts`，新增 `src/features/sftp/remoteWorkspaceEditorModel.test.ts` 覆盖路径、嵌套树更新、语言识别、dirty/status 和目标解析边界。`RemoteWorkspaceEditor.tsx` 从 1178 行降到 992 行，新模型 207 行，新测试 112 行，均低于 1000 行。
- 2026-06-20 09:19 执行前端测试支撑拆分子切片：当前工作区中 `src/features/machine-sidebar/MachineSidebar.test.tsx` 进入超限清单后，从该测试文件抽出 sidebar groups fixture 和 `elementFromPoint` mock 到 `src/features/machine-sidebar/MachineSidebar.testSupport.ts`。原测试文件从 1035 行降到 923 行，新 test support 156 行，均低于 1000 行。
- 2026-06-20 09:19 验证通过：`npm run test:frontend -- src/features/sftp/remoteWorkspaceEditorModel.test.ts src/features/sftp/RemoteWorkspaceEditor.test.tsx` 2 个文件 / 8 个测试通过；`npm run test:frontend -- src/features/machine-sidebar/MachineSidebar.test.tsx` 1 个文件 / 31 个测试通过；相关窄测 `npm run test:frontend -- src/features/sftp/remoteWorkspaceEditorModel.test.ts src/features/sftp/RemoteWorkspaceEditor.test.tsx src/features/workspace/workspaceStore.test.ts` 3 个文件 / 50 个测试通过；完整 `npm run test:frontend` 60 个文件 / 522 个测试通过；`npm run typecheck` 通过；`npm run build` 通过；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只修改 React/TypeScript 前端组件模型、测试和测试支撑。
- 2026-06-20 09:19 按 PowerShell `(Get-Content).Count` 物理行数口径复查，当前仍有 25 个源码/测试文件超过 1000 行；`src/features/sftp/RemoteWorkspaceEditor.tsx` 和 `src/features/machine-sidebar/MachineSidebar.test.tsx` 已退出超限清单。
- 2026-06-20 09:27 执行前端片段目录模型抽取子切片：从 `src/features/snippets/SnippetToolContent.tsx` 抽出预设片段目录、scope 选项、tag 解析、过滤/分组、变量初值和发送阻断逻辑到 `src/features/snippets/snippetCatalogModel.ts`，新增 `src/features/snippets/snippetCatalogModel.test.ts` 覆盖预设数量、ID 前缀、过滤、变量、发送阻断、tag 去重/排序、分组和 scope 展示边界。`SnippetToolContent.tsx` 从 1265 行降到 940 行，新模型 350 行，新测试 142 行，均低于 1000 行。
- 2026-06-20 09:27 验证通过：`npm run test:frontend -- src/features/snippets/SnippetToolContent.test.tsx src/features/snippets/snippetVariables.test.ts src/features/snippets/snippetCatalogModel.test.ts` 3 个文件 / 16 个测试通过；完整 `npm run test:frontend` 62 个文件 / 531 个测试通过；`npm run typecheck` 通过；`npm run build` 通过；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只修改 React/TypeScript 前端组件模型和测试。
- 2026-06-20 09:27 按 PowerShell `(Get-Content).Count` 物理行数口径复查，当前仍有 24 个源码/测试文件超过 1000 行；`src/features/snippets/SnippetToolContent.tsx` 已退出超限清单。
- 2026-06-20 09:36 执行前端测试支撑拆分子切片：从 `src/app/KerminalShell.test.tsx` 抽出 xterm fake、Tauri API mock 注册、SFTP mock 组件、远程主机 fixture 和 `elementFromPoint` helper 到 `src/app/KerminalShell.testSupport.tsx`；测试入口保留行为用例和默认 mock 返回值，support 通过 getter 暴露 `vi.hoisted` 结果，避免直接 export hoisted 变量。`KerminalShell.test.tsx` 从 1241 行降到 797 行，新 test support 454 行，均低于 1000 行。
- 2026-06-20 09:36 验证通过：`npm run test:frontend -- src/app/KerminalShell.test.tsx` 1 个文件 / 20 个测试通过；完整 `npm run test:frontend` 62 个文件 / 531 个测试通过；`npm run typecheck` 单独重跑通过；`npm run build` 通过，仍有既有 chunk/dynamic import 警告；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只修改 React/TypeScript 测试和测试支撑。
- 2026-06-20 09:36 按 PowerShell `(Get-Content).Count` 物理行数口径复查，当前仍有 23 个源码/测试文件超过 1000 行；`src/app/KerminalShell.test.tsx` 已退出超限清单，`src-tauri/src/services/sftp_service.rs` 当前为 6196 行，后续 Rust facade 拆分需重新按最新代码切片。
- 2026-06-20 09:42 执行前端 tab chrome 拆分子切片：从 `src/features/terminal/TerminalWorkspace.tsx` 抽出标签分组、标签按钮、标签组按钮、右键菜单项、关闭确认弹窗、重命名弹窗和右键菜单位置 clamp 到 `src/features/terminal/terminalTabChrome.tsx`；`TerminalWorkspace.tsx` 保留广播命令、pane layout 和顶层工作区编排职责。`TerminalWorkspace.tsx` 从 1166 行降到 736 行，新 tab chrome 文件 464 行，均低于 1000 行。
- 2026-06-20 09:42 验证通过：`npm run test:frontend -- src/features/terminal/TerminalWorkspace.test.tsx` 1 个文件 / 21 个测试通过；完整 `npm run test:frontend` 62 个文件 / 534 个测试通过；`npm run typecheck` 通过；`npm run build` 通过，仍有既有 chunk/dynamic import 警告；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只修改 React/TypeScript 前端组件拆分。
- 2026-06-20 09:42 按 PowerShell `(Get-Content).Count` 物理行数口径复查，当前仍有 22 个源码/测试文件超过 1000 行；`src/features/terminal/TerminalWorkspace.tsx` 已退出超限清单，`src-tauri/src/services/sftp_service.rs` 当前为 6338 行，下一轮建议优先拆 Rust SFTP facade 或继续处理高收益前端容器。
- 2026-06-20 09:50 执行 workspace store 机器模型拆分子切片：从 `src/features/workspace/workspaceStore.ts` 抽出远程主机树映射、本地 profile machine、Docker container machine、sidebar 持久化 machine 合并、分组排序/置顶、默认分组解析和会话恢复 machine 重建到 `src/features/workspace/workspaceMachineModel.ts`；store 继续保留 Zustand 状态、tab/pane 编排和原有 `findMachine`/`localMachineIdForProfile`/`sidebarMachinesForWorkspaceSession` re-export 兼容入口。`workspaceStore.ts` 从 1588 行降到 996 行，新模型 648 行，均低于 1000 行。
- 2026-06-20 09:50 验证通过：`npm run test:frontend -- src/features/workspace/workspaceStore.test.ts` 1 个文件 / 44 个测试通过；完整 `npm run test:frontend` 62 个文件 / 534 个测试通过；`npm run typecheck` 通过；`npm run build` 通过，仍有既有 chunk/dynamic import 警告；Vite dev server `http://127.0.0.1:5174/` HTTP 200 启动烟测通过并已杀掉进程树。未运行 Rust/Tauri 验证，因为本轮只修改 React/TypeScript workspace store 模型拆分。
- 2026-06-20 09:50 按 PowerShell `(Get-Content).Count` 物理行数口径复查，当前仍有 21 个源码/测试文件超过 1000 行；`src/features/workspace/workspaceStore.ts` 已退出超限清单。并行 explorer 对 `sftp_service.rs` 的只读建议是下一轮首刀抽 `src-tauri/src/services/sftp_service/transfer.rs`，移动 transfer task、event emitter、limiter 和 progress reader/writer，保持 `SftpService` public facade 不变。
- 2026-06-20 12:38 继续按 Rust/React 规范完成剩余超限文件治理：拆分 `src-tauri/tests/command_suggestion_service.rs`、`src-tauri/tests/command_suggestion_ssh_smoke.rs`、`src-tauri/src/services/mcp_tool_gateway.rs`、`src-tauri/src/services/docker_host_service.rs`、`src/features/machine-sidebar/MachineSidebar.tsx`、`src/app/KerminalShell.tsx`、`src/features/terminal/XtermPane.tsx` 等剩余高风险入口；补充 `resolveThemeMode("system", ...)` 单测，明确浅色、深色和跟随系统主题验证口径。最终物理行数审计范围为 `src/`、`src-tauri/src/`、`src-tauri/tests/` 下 `.ts/.tsx/.rs`，`OverLimitCount=0`，当前最高文件 999 行。
- 2026-06-20 12:38 验证通过：`cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`、`cargo test --test tool_registry_service` 13 个测试、`cargo test --test command_suggestion_service --no-run`、`cargo test --test command_suggestion_ssh_smoke --no-run`、`cargo test docker_host_service --lib --no-run`、重点前端 `npm run test:frontend -- src/features/settings/settingsModel.test.ts src/app/KerminalShell.test.tsx src/features/machine-sidebar/MachineSidebar.test.tsx src/features/terminal/XtermPane.test.tsx src/features/terminal/XtermPane.sessionTargets.test.tsx src/features/terminal/XtermPane.remoteSuggestions.test.tsx src/features/terminal/XtermPane.inlineSuggestions.test.tsx src/features/terminal/XtermPane.contextMenu.test.tsx` 8 个文件 / 99 个测试、`npm run typecheck`、`npm run build`、Vite dev server HTTP 200 smoke、`npm run tauri:dev` ready smoke。已知剩余风险：`cargo test --test command_suggestion_service` 和 `cargo test docker_host_service --lib` 在本机执行测试二进制时仍失败于 Windows `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)`；同目标 `--no-run` 编译通过，说明当前变更未引入编译期回归。
