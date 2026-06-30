---
id: PLAN-20260621-093747-updeng-parallel-evolution-workflow
status: done
created_at: 2026-06-21T09:37:47+08:00
started_at: 2026-06-21T09:37:47+08:00
completed_at: 2026-06-21T21:04:20+08:00
updated_at: 2026-06-21T21:04:20+08:00
owner: ai
---

# Updeng 并行任务与自进化工作流生产化计划

## 目标

- 允许多个 Codex 会话同时开发不同目标，例如代码优化和 AI 助手新功能。
- 多个会话修改同一个文件时，不阻塞开发，但必须互相可见、先同步上下文、最小合并。
- 自进化能力必须从“规则里说会记录”变成用户可检查的候选文件和 hook 事件。
- 当前两个 active 会话先登记为 lane，后续新 planned/high-risk/evolution 任务默认走独立 worktree/分支。

## 非目标

- 不在本计划里重写业务代码。
- 不自动提交、push 或强制迁移当前脏工作区。
- 不把完整用户 prompt、密钥、生产日志写入长期记录。
- 不让 hook 自动采纳 skill 修改；正式采纳仍要验证和可审查 diff。

## 影响范围

| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| Updeng workflow | 是 | `.codex/skills/bwy-updeng-workflow/SKILL.md` | skill validate |
| 开发治理 | 是 | `.codex/skills/bwy-development-governance/SKILL.md` | skill validate |
| 自进化 | 是 | `.codex/skills/bwy-skill-evolution/SKILL.md`、`.codex/hooks/skill-forced-eval.cjs` | hook stdin 样例 |
| 写入前门禁 | 是 | `.codex/hooks/pre-tool-use.cjs` | hook stdin 样例 |
| Lane 状态与 checkpoint | 是 | `.codex/hooks/lane-coordination.cjs`、`.updeng/docs/coordination/status.md` | refresh/checkpoint |
| 外部调研 | 是 | `.updeng/docs/coordination/research-2026-06-21.md` | 文档检查 |
| 计划台账 | 是 | `.updeng/docs/plan/INDEX.md`、`in-progress.md`、`coordination/lanes.json` | 文档检查 |
| 业务代码 | 否 | `src/**`、`src-tauri/**` | 不触碰 |

## 设计

### 调研依据

- Git 和 Codex 官方工作流都支持用 worktree 隔离并行任务；本计划采用“新任务默认 worktree，历史脏工作区登记为例外”。
- Git rerere 和 merge driver 可降低重复冲突成本，但会改变仓库/用户 Git 行为或引入语义风险；当前只记录为后续增强，不默认启用。
- OpenAI Agent Improvement Loop 强调 traces、feedback、evals 和人工可审查采纳；本计划采用“候选自动捕获，正式 skill/hook 人工采纳”的自进化边界。
- 详细记录见 `.updeng/docs/coordination/research-2026-06-21.md`。

### 并行 lane

- `lanes.json` 是当前并行事实源。
- 每个 lane 记录 owned paths 和 shared paths。
- shared path 写入前必须读对方计划和 diff。
- 新 lane 默认独立 worktree；历史脏主工作区可临时例外，但必须登记。

### 同文件修改

- 采用 warn-and-sync。
- hook 不默认 deny，因为用户希望两个任务都继续跑。
- warning 要提示命中的 lane、路径和同步动作。
- 大规模格式化共享文件视为高风险，必须拆单独计划。

### 自进化候选

- UserPromptSubmit hook 扩展信号：
  - 用户纠正：不对、不是、应该、纠正。
  - 重复反馈：说了很多遍、反复、又出现、老是、之前说过。
  - 工作流缺口：并行、多个任务、同一个文件、看不到对方、自进化、没有记住。
- 命中后写 `SkillEvolutionSignal` 到 hooks metrics，并写一条候选到 `evolution-candidates.jsonl`。
- 候选只代表需要评估，不代表自动改正式 skill。

## 任务

- [x] TASK-001 登记当前三个 lane：代码质量、AI 助手、工作流生产化。
- [x] TASK-002 增加并行任务和同文件写入协议文档。
- [x] TASK-003 扩展 UserPromptSubmit 自进化信号采集。
- [x] TASK-004 扩展 PreToolUse 同文件 lane warning。
- [x] TASK-005 更新 Updeng skills，使后续会话必须按 lane 协议执行。
- [x] TASK-006 更新计划索引和 in-progress，使 AI 助手不再“实际 active 但文档 next”。
- [x] TASK-007 验证 hook 样例和 skill 自检。
- [x] TASK-008 通知当前两个 active 会话读取新 lane 协议并收敛 checkpoint。
- [x] TASK-009 增加 lane status/checkpoint 脚本，覆盖 tracked diff、ignored workflow assets 和 untracked 文本快照。
- [x] TASK-010 将 lane status 刷新接入 PostToolUse/Stop，并让 UserPromptSubmit 注入真实 changed/shared/unclaimed 摘要。
- [x] TASK-011 更新 coordination README 和相关 skills，要求并行会话先读 status/checkpoint 再写 shared path。
- [x] TASK-012 补外部调研记录，说明 worktree、checkpoint、rerere/merge driver 和自进化闭环的采用取舍。
- [x] TASK-013 为当前两个业务 lane 主动生成 checkpoint，并让 `status.md` 展示最近 checkpoint 摘要。
- [x] TASK-014 自进化候选除 JSONL 外自动生成 `evolution-current.md|json` 聚合视图，让重复反馈可见。
- [x] TASK-015 自进化增加 AI 自错信号：PostToolUse 工具/构建/验证失败和 Stop 收口缺口自动进入候选池。
- [x] TASK-016 增加 hooks 配置自检，确保 `.codex/hooks.json` 真正绑定并覆盖不同 Codex 工具名别名。

## 验证

```powershell
node .codex/skills/bwy-project-skill-maintenance/scripts/validate_skills.js --run-tests
```

```powershell
node .codex/hooks/skill-forced-eval.cjs < <UserPromptSubmit sample>
node .codex/hooks/pre-tool-use.cjs < <PreToolUse shared path sample>
node .codex/hooks/workflow-event.cjs < <PostToolUse sample>
node .codex/hooks/validate-hooks.cjs
node .codex/hooks/lane-coordination.cjs refresh C:\dev\rust\kerminal
node .codex/hooks/lane-coordination.cjs checkpoint lane-updeng-parallel-evolution C:\dev\rust\kerminal
```

## 风险

- hook 过度提醒：先 warn，不 deny，避免阻塞用户期望的并行开发。
- prompt 记录泄露：只保存 redacted excerpt，不保存完整 prompt。
- 当前脏工作区无法马上拆 worktree：先登记 lane 和共享文件，后续切片完成后再 checkpoint。

## Round Log

- 2026-06-21T09:37:47+08:00 创建本计划，新增 coordination README、lanes.json、ADR-0013 和首条 evolution candidate。业务源码未改。
- 2026-06-21T09:49:10+08:00 修复 `.codex/skills` junction/symlink 下 UserPromptSubmit hook 和 skill 自检脚本看不见项目 skills 的问题；`node .codex/skills/bwy-project-skill-maintenance/scripts/validate_skills.js --run-tests` 真实检查 64 个 skill 且无发现。
- 2026-06-21T09:49:10+08:00 扩展 `skill-forced-eval.cjs`：每轮输出当前 active lanes；命中“说了很多遍/反复/自进化没体验到/多个任务/同一个文件/看不到对方”等信号时写入 `SkillEvolutionSignal` 和 `evolution-candidates.jsonl`。
- 2026-06-21T09:49:10+08:00 扩展 `pre-tool-use.cjs`：写入其他 active lane 的 owned/shared path 时输出 warn-and-sync 提醒，不阻断执行。样例写入 `src-tauri/src/commands/registry.rs` 时正确提示 code-quality 和 ai-assistant 两个 lane。
- 2026-06-21T09:49:10+08:00 AI 助手计划已从 `plan/next/` 移到 `plan/active/`，`INDEX.md`、`in-progress.md` 和 `lanes.json` 已同步。业务源码未改。
- 2026-06-21T09:50:30+08:00 已向 `019ee45e-0fb5-7052-8d59-706a7f77d794` 和 `019ee77c-5e2b-7a20-82f1-dbc974c6b4dc` 发送同步消息，要求各自读取 lane 台账、写 shared paths 前同步对方计划/diff，并优先收敛可验证 checkpoint。
- 2026-06-21T09:59:28+08:00 增加 `lane-coordination.cjs`：`refresh` 生成 `status.json/status.md`，`checkpoint` 生成 tracked patch 和 untracked/ignored 文本快照；修复 `.codex/.updeng/AGENTS.md` 被 git ignore 后 workflow lane 不可见的问题。`refresh` 当前显示 changed=242、shared/conflict=17、unclaimed=109，三个 active lane 均可见。
- 2026-06-21T09:59:28+08:00 `workflow-event.cjs` 已在 `PostToolUse`/`Stop` 后静默刷新 lane status；`skill-forced-eval.cjs` 每轮注入 changed/shared/unclaimed 摘要和共享路径样例。
- 2026-06-21T09:59:28+08:00 已生成 `lane-updeng-parallel-evolution` checkpoint：26 个路径、0 个 tracked patch 路径、26 个 untracked/ignored 快照；`.updeng/docs/metrics/hooks.jsonl` 因超过 1MB 只记录 hash/省略原因。
- 2026-06-21T09:59:28+08:00 已再次通知 `019ee45e-0fb5-7052-8d59-706a7f77d794` 和 `019ee77c-5e2b-7a20-82f1-dbc974c6b4dc`：继续前读取 `status.md`、coordination README 和最近 checkpoint；完成可验证切片后各自生成 lane checkpoint。
- 2026-06-21T10:09:08+08:00 补充外部调研记录 `coordination/research-2026-06-21.md`，采用 worktree 隔离、status/checkpoint 可见性和候选式自进化；暂不默认启用 `git rerere` 或 merge driver。
- 2026-06-21T10:09:08+08:00 `status.md` 已展示每个 lane 的最近 checkpoint；已主动生成 `lane-code-quality` checkpoint（101 路径、54 tracked patch 路径）和 `lane-ai-assistant-context` checkpoint（18 路径、8 tracked patch 路径），让两个业务会话能直接读取对方当前 patch/snapshot。
- 2026-06-21T10:09:08+08:00 `skill-forced-eval.cjs` 在捕获自进化候选后会刷新 `evolution-current.md|json`，按 target/signal/status 聚合重复反馈，避免只追加 JSONL 但用户看不到当前候选状态。样例验证后当前报告为 5 条候选、2 个聚合组，其中 `bwy-skill-evolution` 的 `repeated-feedback,workflow-gap` 候选累计 4 次。
- 2026-06-21T10:09:08+08:00 根据用户补充“AI 回答经常出错也应自进化”，新增 `evolution-metrics.cjs` 共享低泄露候选汇总 helper；`workflow-event.cjs` 已将 PostToolUse 非零退出分类为 `tool-error/build-failure/verification-failure`，Stop 缺证据分类为 `closeout-gap`，统一写入 `evolution-candidates.jsonl` 并刷新 `evolution-current.md|json`。样例 `npm test` 非零退出已生成 `ai-error,verification-failure` 候选；当前报告为 6 条候选、3 个聚合组。
- 2026-06-21T10:22:14+08:00 审计发现 hooks 配置已开启但 matcher 只覆盖部分工具名；已扩展 `.codex/hooks.json` 到 `exec_command/functions.exec_command/functions.apply_patch` 等别名，并新增 `validate-hooks.cjs` 验证 hook 文件存在、全部 `.cjs` 语法和 matcher 覆盖。`node .codex/hooks/validate-hooks.cjs` 输出 `Hooks config OK.`。
- 2026-06-21T10:22:14+08:00 用 `functions.exec_command` 模拟失败验证命令、用 `functions.apply_patch` 模拟 shared path 写入、再用 UserPromptSubmit 触发候选刷新，均通过。`evolution-current.json` 当前为 8 条候选、3 个聚合组，`ai-error,verification-failure` 累计 2 次且保留 `failureKinds=verification-failure`。
- 2026-06-21T21:04:20+08:00 状态收口：TASK-001 到 TASK-016 已全部完成，前序 Round Log 已记录 skill 自检、hook 样例、lane refresh/checkpoint 和 hooks 配置自检证据；计划从 `active/` 归档到 `done/`，并同步 `in-progress.md`、`plan/INDEX.md` 和 `coordination/lanes.json`。
