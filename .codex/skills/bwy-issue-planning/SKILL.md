---
name: bwy-issue-planning
description: |
  用于把需求、计划、PRD、架构候选或对话上下文拆成可执行的 PRD、issue、任务切片和 agent brief。触发于“写 PRD、拆 issue、拆任务、ready for agent、AFK、HITL、垂直切片、从方案生成任务、把计划发到 issue tracker”等场景。
---

<!-- @author kongweiguang -->

# PRD 与 Issue 规划

## 使用边界

- 用于把已经讨论过的上下文转成可执行计划，不默认重新采访用户。
- 需要 issue tracker 时，优先使用项目现有 GitHub/GitLab/本地 markdown 约定；没有集成时输出本地 markdown 草案。
- 本技能负责拆分和发布计划；具体实现仍由 `bwy-development-governance`、`bwy-tdd-development` 和专项技能执行。

## 输出类型

| 输出 | 适用场景 | 默认位置 |
| --- | --- | --- |
| PRD | 用户要产品需求说明、需要统一范围 | `.updeng/docs/plan/next/` 并登记 `plan/INDEX.md`，或 issue tracker |
| Issue 切片 | 需要分给 agent 或多人并行 | issue tracker 或 `.updeng/docs/issues/` |
| Agent brief | 某个切片已可独立实现 | issue comment 或 markdown |
| HITL 决策项 | 需要人确认设计、权限、上线或业务取舍 | issue/计划中的阻塞项 |

垂直切片规则见 [vertical-slices.md](references/vertical-slices.md)。

## 工作流

### 1. 收集上下文

- 读取当前对话、已有计划、spec、ADR、领域上下文和相关代码。
- 如果用户给 issue URL、编号或文件路径，读取完整正文和评论。
- 不清楚 issue tracker 时，使用本地 markdown 草案并说明可迁移。

### 2. 生成 PRD

PRD 包含：

```markdown
## Problem Statement
## Solution
## User Stories
## Implementation Decisions
## Testing Decisions
## Out of Scope
## Further Notes
```

要求：

- 从用户视角写问题和方案。
- User story 要覆盖正常、异常、权限、数据、迁移影响和验收。
- Implementation Decisions 记录模块、接口、数据、交互和约束，但避免易过期的具体文件路径。
- Testing Decisions 指出测试缝隙、优先行为和类似先例。

### 3. 拆 vertical slices

每个切片必须能独立验证：

```markdown
| 顺序 | 标题 | 类型 | 依赖 | 覆盖故事 | 验收 |
| --- | --- | --- | --- | --- | --- |
| 1 | <端到端行为> | AFK/HITL | None | US-1 | <可运行验证> |
```

- AFK：信息充足，agent 可以独立实现和验证。
- HITL：需要人工判断、设计确认、生产权限、外部账号或业务取舍。
- 优先拆成薄的端到端行为，不按数据库、后端、前端横向拆。

### 4. 与用户校准

在发布或写入长期计划前，给用户确认：

- 粒度是否过粗或过细。
- 依赖关系是否正确。
- 哪些切片应改为 HITL 或 AFK。
- 是否需要合并、拆分或重排。

用户明确要求“直接生成，不要问”时，可以写草案但标记为待确认。

### 5. 发布或写入

- 使用 issue tracker 时，按依赖顺序先发布 blocker。
- 本地文件时，写入 `.updeng/docs/issues/` 或当前计划状态目录，并同步 `.updeng/docs/plan/INDEX.md`。
- 每个 issue 包含：What to build、Acceptance criteria、Blocked by、Verification。
- 不自动关闭父 issue，不覆盖人工标签。

### 6. 收口

最终说明：

- 生成了哪些 PRD/issue/brief。
- 哪些切片 ready for agent。
- 哪些仍需 HITL。
- 对实现顺序和验证门禁的影响。

## 与 Updeng 的关系

- 复杂需求进入 plan 或 audit package 前，本技能可把范围拆成 `.updeng` plan/审计包能消费的 capability 和任务。
- 切片执行时，每个 AFK issue 仍需按 `bwy-updeng-workflow` 重新分类和验证。
- 如果拆分过程中发现领域词汇不稳定，先回到 `bwy-domain-context`。
