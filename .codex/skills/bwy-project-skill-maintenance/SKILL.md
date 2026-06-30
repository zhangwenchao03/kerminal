---
name: bwy-project-skill-maintenance
description: |
  用于创建、更新、整理或评审技能模板及实际项目 `.codex/skills` 下的仓库级技能、引用资料、脚本和触发边界。不要用于普通业务编码，除非任务明确要求维护 skills。
---

# 项目技能维护能力

## 使用边界

- 用于维护技能模板、实际项目 `.codex/skills`、skill references、scripts、agents/openai.yaml 和 hook 触发边界。
- 通用开发流程、文档沉淀、completed 判断、git 和交付口径按 `bwy-development-governance`；本技能只补 skill 专属规则。
- 能扩充已有 skill 时不新建目录；只有边界清楚、长期复用、反复触发的能力才新增 skill。

## 默认流程

1. 读取现有技能触发描述：实际项目读 `.codex/skills/*/SKILL.md`，维护本模板仓库时读当前根目录 `*/SKILL.md`。
2. 明确本次维护的来源、目标、非目标、触发词、适用文件、验证方式和沉淀位置。
3. 用压力场景筛选规则：没有这条规则时 AI 会犯什么错、触发后必须怎么做、如何验证它起作用。
4. 判断承载方式：确定性限制优先放 hook、脚本或验证命令；需要工程判断的流程才写入 skill；一次性经验只写计划或最终回复。
5. 对照已有边界去重：通用流程归治理，Java/前端/数据库/评审/运维归专项，跨技能协作或项目特有复杂流程才新增。
6. 修改后运行自检；仅 skill 文案、格式或目录整理通常不写入 `.updeng/docs/completed.md`。
7. 涉及并行任务、同文件冲突、自进化采集或 hook 提醒时，同步更新 `.updeng/docs/coordination/`、受影响 hook 样例和 `bwy-skill-evolution` 采集口径；并验证 `lane-coordination.cjs refresh/checkpoint` 能生成可读状态和 checkpoint。

## 结构与写法

```text
.codex/skills/bwy-<skill-name>/
├── SKILL.md
├── agents/openai.yaml
└── references/ | scripts/ | assets/  # 仅在确实需要时创建
```

- `name` 使用小写字母、数字和连字符，带 `bwy-` 前缀，并和目录名一致。
- `description` 写短触发条件；正文写任务协议、边界、检查清单和验证入口。
- 不写泛泛理念、角色扮演提示词、调研过程、第三方长文摘录或业务知识。
- 强约束必须写清触发条件、停止条件、反例或常见误判。
- 脚本单一职责、参数化、可失败可解释；只允许 `.js`、`.mjs`、`.cjs`。
- `agents/openai.yaml` 与 `SKILL.md` 保持一致，包含 `display_name`、`short_description`、`default_prompt`。

## 自检

实际项目：

```powershell
node .codex/skills/bwy-project-skill-maintenance/scripts/validate_skills.js --run-tests
node .codex/hooks/validate-hooks.cjs
node .codex/hooks/lane-coordination.cjs refresh <project>
node .codex/hooks/lane-coordination.cjs checkpoint <lane-id> <project>
```

模板仓库：

```powershell
node bwy-project-skill-maintenance/scripts/validate_skills.js --run-tests
```

自检覆盖 frontmatter、`agents/openai.yaml`、脚本后缀、JSON reference 和各 skill 的脚本单测。
