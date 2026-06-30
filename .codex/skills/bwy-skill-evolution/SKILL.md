---
name: bwy-skill-evolution
description: |
  用于项目 skills、hooks 和 workflow 的自进化管理，覆盖事件采集、候选整理、AI 生成受限 diff、人工确认边界、验证和严格审计。只在维护能力系统或发现可复用流程缺陷时使用，不用于普通业务编码。
---

# Skill 自进化能力

## 使用边界

- 用于发现、整理和验证项目技能体系的改进点。
- 适用于 hooks、skills、workflow、初始化工具、事件日志、评估场景和用户纠正经验。
- 不用于普通业务功能实现；普通业务开发仍按 `bwy-updeng-workflow` 路由到专项技能。
- 默认走轻流程：metrics 产出候选，AI 整理成受限修改边界，用户确认后再改正式 skill 或 hook。
- 严格流程只用于高风险 hook 行为、跨多个 skill 的职责变化、团队需要审计链的规则变更。

## 设计原则

1. 证据优先：每个优化建议必须能追溯到用户纠正、失败日志、评审发现、hook 拦截或重复模式。
2. 边界优先：正式修改前先说明目标文件、要改什么、不改什么和验证命令，等待用户确认。
3. 小步编辑：每次只改一个明确问题，不混入风格重写。
4. 验证门禁：结构校验、脚本测试或受影响 hook 测试通过后才收口。
5. 可回滚：正式 skill 变更要能从 diff、版本记录和确认说明回退。
6. 隐私默认安全：事件日志默认不保存完整 prompt、密钥、生产数据或敏感输出。

## 自进化流水线

| 阶段 | 输入 | 输出 |
| --- | --- | --- |
| Harvest | hook 事件、计划文档、验证结果、review、用户纠正 | `.updeng/docs/metrics/hooks.jsonl` |
| Mine | `updeng metrics evolution` 分析事件、审批、context summaries 和历史任务 | `.updeng/docs/metrics/evolution/current.md|json` |
| Draft | AI 读取候选，合并重复纠正，判断写入 skill 还是 hook | 修改边界说明和最小 diff 草案 |
| Confirm | 用户确认目标、范围、反例和禁止改动 | 可执行的受限修改边界 |
| Apply | 只改确认范围内的 `SKILL.md`、hook 或验证脚本 | 正式文件 diff |
| Validate | skill 自检、受影响 hook/script 测试、必要时正反样例 | 验证结果和残余风险 |
| Strict audit | 仅严格场景使用 `evolution propose/replay/adopt/reject` | 可审计 proposal、replay、adoption 记录 |

## 候选信号

- 用户明确说“以后遇到这种情况先做 X”。
- 用户指出“你漏了计划/验证/文档/权限/回滚”。
- 用户说“我说了很多遍”“反复”“又出现”“还是没修”“没有体验到”，表示同类反馈未被沉淀。
- 用户指出工作流本身的问题，例如多个会话无法同时推进、同文件修改互相不可见、计划状态与实际执行不一致、自进化没有自动记录。
- AI 自己触发的工具失败、构建失败、验证失败或 Stop 阶段缺验证/评审/发布证据。
- hook 多次注入相同提醒但执行仍偏离。
- 某个 skill 触发过宽，导致无关任务也加载。
- 某个 skill 触发过窄，导致相关任务漏加载。
- 同类命令、测试或构建错误重复出现。
- 代码评审反复发现同类缺陷。
- Worker 产物经常越权、漏验证或误改文件。

## 推荐命令

先生成候选报告；这一步只做整理，不直接修改正式 skill：

```powershell
updeng metrics evolution C:\path\to\project --json
updeng metrics evolution C:\path\to\project --format md
```

报告会聚合 `.updeng/docs/metrics/events.jsonl`、`.updeng/docs/audit/decisions.jsonl` 和 `.updeng/docs/context/summaries/`，输出重复验证失败、用户纠正、review/worker/hook 信号、审批压力、高上下文成本和 context lessons。每个 candidate 必须带 evidence、target、recommendation 和 validationPlan。

项目 hook 会额外写入 `.updeng/docs/metrics/evolution-candidates.jsonl`。该文件是可读候选队列，来源包括用户纠正、重复反馈、工作流缺口、AI 工具/验证失败和 Stop 收口缺口。hook 同时刷新 `.updeng/docs/metrics/evolution-current.md|json`，按 target、signal 和 status 聚合候选，方便用户看到“反复说过的问题”和“AI 经常出错的地方”已经被记录。候选只代表“需要评估”，不代表已经采纳；正式修改仍要说明边界、运行验证并保留可回滚 diff。

工作流缺口类候选还要读取 `.updeng/docs/coordination/status.md` 和相关 `checkpoints/<lane-id>.json`，确认问题是静态规则缺失、状态刷新缺失、checkpoint 缺失还是具体 lane 未遵守协议。

为兼顾体验和隐私，hook 可以记录短 redacted excerpt，但不得保存完整 prompt、密钥、token、密码、生产日志或 `.env` 内容。无法安全摘录时只写 hash、长度和关键词。

默认让 AI 继续做一轮整理：读取 `current.md|json`，选择最相关候选，输出“拟改文件、修改边界、不改内容、验证命令”。用户确认后，AI 直接按边界修改 skill 或 hook 并运行验证。

严格场景再使用审计命令：

```powershell
updeng evolution propose C:\path\to\project --candidate <id|rank> --summary "<why>" --json
updeng evolution replay C:\path\to\project --proposal <id> --suite <suite.json> --json
updeng evolution adopt C:\path\to\project --proposal <id> --summary "<validated>" --evidence <replay-report.json> --json
```

## 边界确认格式

```markdown
# <skill 或 hook> 优化边界

## 触发证据
- <事件、会话、用户纠正、失败日志或 review 发现>

## 准备修改
- <目标文件和段落>
- <新增、删除或替换哪条规则>

## 不修改
- <不碰哪些 skill、hook、业务代码或历史数据>

## 验证
- <结构校验、脚本测试、正反样例或人工检查>

## 风险与回滚
- <误触发、漏触发、成本、回滚方式>
```

## 验证门禁

轻流程正式修改前至少满足：

- `bwy-project-skill-maintenance/scripts/validate_skills.js --run-tests` 通过。
- 新增或修改的 hook 有样例 stdin 验证。
- 至少说明一个正向场景会触发新规则。
- 至少说明一个反向场景不会误触发。
- 若改动影响高风险动作，必须说明人工确认点和拒绝条件。
- 严格流程才强制 replay report 和 `evolution adopt` 证据。

## 禁止项

- 不根据单次主观感觉直接改正式 skill；单次用户明确纠正可以先记入 metrics 或整理为边界，等用户确认再改。
- 不把完整敏感 prompt、密钥、生产日志或数据库结果写入长期事件。
- 不用自进化机制绕过用户最新指令。
- 不让 hook 在当前回合自动覆盖正式 `SKILL.md`。
- 不把调研长文、第三方说明或一次性经验塞进 skill。

## 采纳口径

- 小修正文案或触发词：轻流程 patch 级，确认边界后直接改。
- 新增步骤、检查项或 hook 信号：轻流程 minor 级；涉及拦截行为时升级严格流程。
- 改变技能职责、必载关系或门禁逻辑：major 级，使用严格流程。
- 采纳后更新对应 README、catalog 或 `.updeng/docs`，并说明验证结果。
