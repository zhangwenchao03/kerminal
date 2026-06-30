---
name: bwy-domain-context
description: |
  用于建立和维护项目共享语言、领域词汇、需求追问和上下文文档。触发于业务术语混乱、需求含糊、用户要求“拷问/追问/澄清/统一语言”、需要沉淀 CONTEXT、ADR 前置语义或避免 agent 反复解释项目概念的场景。
---

<!-- @author kongweiguang -->

# 领域上下文与共享语言

## 使用边界

- 用于需求、业务规则、术语和项目上下文不稳定时，先形成共同语言。
- 本技能维护“词汇和语义”，不替代 `bwy-development-governance` 的计划，也不替代 `bwy-tech-decision` 的 ADR。
- 代码能回答的问题先读代码；不能只靠追问用户。
- 简单明确任务不要强行进入长问答；只在术语或决策会影响实现时使用。

## 文档位置

优先按项目已有约定；没有时使用 Updeng 默认位置：

1. `.updeng/docs/domain/context.md`：领域词汇、概念边界、同义词和反例。
2. `.updeng/docs/biz/**`：稳定业务规则、流程和验收入口。
3. `.updeng/docs/decisions/`：需要 ADR 时交给 `bwy-tech-decision`。

格式见 [context-document.md](references/context-document.md)。

## 工作流

### 1. 找现有语言

按顺序读取：

- `AGENTS.md`、`README.md`、`.updeng/docs/**`。
- 代码中的领域类型、接口名、路由、数据库表、权限标识和测试名。
- 现有 ADR 或计划文档。

如果仓库有 `.codegraph/`，先用 CodeGraph 理解概念入口；否则用 `rg` 搜索术语。

### 2. 识别语言问题

记录以下信号：

- 一个词在不同上下文含义不同。
- 用户说法与代码事实冲突。
- 业务概念被技术实现名替代，导致需求难读。
- 同一概念有多个候选命名。
- 验收场景缺少 actor、触发条件、状态变化或边界。

### 3. 逐问逐答澄清

一次只问一个高影响问题，并给出推荐答案：

```markdown
问题：<具体冲突或缺口>
推荐：<基于代码和现有文档的建议>
影响：<这个回答会改变哪些实现、测试或文档>
```

如果问题能通过代码确认，先自己查证，再向用户报告发现。

### 4. 即时沉淀

当用户确认术语或规则后，立即写入最小拥有位置：

- 词汇和边界写 `.updeng/docs/domain/context.md`。
- 业务流程或验收规则写 `.updeng/docs/biz/**`。
- 长期技术取舍触发 `bwy-tech-decision` 写 ADR。

不要把实现路径、临时计划、调研笔记放进领域词汇文档。

### 5. 给后续技能可用输出

收口时提供：

- 已确认术语。
- 仍未确认的问题。
- 对测试命名、接口命名、切片计划的影响。
- 需要后续 ADR 或架构评估的点。

## 触发升级

- 澄清后需要正式实现：回到 `bwy-development-governance`。
- 出现长期架构/依赖/数据模型选择：使用 `bwy-tech-decision`。
- 术语暴露模块边界混乱：使用 `bwy-architecture-deepening`。
- 需要拆 PRD/issue：使用 `bwy-issue-planning`。
