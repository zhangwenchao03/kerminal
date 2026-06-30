# Updeng 文档信息架构

`.updeng/docs/` 是 Updeng 的唯一流程工作台。默认工作方式是 **Plan-first, Change-on-demand, Evidence-backed**：普通持续任务先进入 `plan/`，并行任务用 `coordination/` 暴露归属，只有高风险、强审计、发布或多人长期协作任务才升级到正式 `changes/<change-id>/` 生命周期。不要再维护 `.updeng/data/` 第二套流程目录。

## 快速选择

| 你要记录的是 | 写到 | 不要写到 |
| --- | --- | --- |
| 模糊需求讨论后的目标、候选方案、未决问题 | `.updeng/docs/discovery/` | 聊天记录 |
| 已确认的领域术语、状态、业务边界 | `.updeng/docs/domain/` | `.updeng/docs/plan/` |
| 当前要做的计划、步骤、影响范围、验收方式 | `.updeng/docs/plan/INDEX.md` 和 `plan/active/` | `.updeng/docs/biz/` 或临时聊天 |
| 并行任务、文件归属、共享路径和 checkpoint | `.updeng/docs/coordination/` | 只写在对话里 |
| 低风险默认选择、待确认点、不可逆阻塞索引 | `.updeng/docs/BLOCKERS.md` | 聊天记录或长期业务文档 |
| 高风险、强审计、发布级或长期多人协作 change artifact | `.updeng/docs/changes/<change-id>/` | 为所有普通任务强制创建 |
| 没有外部 issue tracker 时的 PRD、issue、agent brief | `.updeng/docs/issues/` | `.updeng/docs/changes/` |
| 稳定业务规则、行为契约、业务流程 | `.updeng/docs/biz/` | `.updeng/docs/discovery/` |
| 长期技术/架构/流程取舍 | `.updeng/docs/decisions/` | `.updeng/docs/biz/` |
| SQL、迁移、数据修复和执行清单 | `.updeng/docs/sql/` | 临时命令输出 |
| 人工评审结论、人工验收记录 | `.updeng/docs/review/` | 计划 Round Log |
| 周报、阶段汇总、人工读的分析报告 | `.updeng/docs/reports/` | 原始 metrics JSONL |
| 已完成且后续可复用的能力索引 | `.updeng/docs/completed.md` | `.updeng/docs/archive/` |
| 本地配置说明和可提交样例 | `.updeng/docs/config/` | `.updeng/config.yaml` |
| task brief、worker report、review package、progress ledger | `.updeng/tmp/sdd/` | `.updeng/docs/` 长期文档 |

## 目录说明

- `updeng-workflow.md`：Updeng 工作流、命令和门禁说明。
- `updeng-production-runbook.md`：生产使用、升级、策略和运维说明。
- `in-progress.md`：人工维护的当前事项索引；不要写完整任务证据。
- `BLOCKERS.md`：可逆默认选择、待确认点和不可逆阻塞索引；完成或确认后及时关闭。
- `plan/`：默认人工计划工作台；`INDEX.md` 是入口，`active/`、`next/`、`blocked/`、`done/` 分开承载状态。普通功能、跨文件修改、缺陷修复、技能维护优先放这里。
- `coordination/`：lane、共享路径、checkpoint 和当前未归属脏文件视图；多个会话或多个 active plan 同时存在时必须维护。
- `changes/`：按需正式 change 生命周期 artifact，包含 `proposal.md`、`specs/`、`design.md`、`tasks.md`、`verification.md|json`、`review.md`、`release.md` 等。只在高风险、强审计、发布、迁移、公共契约或长期多人协作时使用。
- `.updeng/tmp/sdd/`：worker-assisted 临时交接区，不在 `docs/` 下；默认被 gitignore 忽略，可清理。
- `archive/`：完成 change 的归档副本。
- `metrics/`：hook、成本、验证失败、自进化候选和报告数据。
- `audit/`：审批、策略、升级、自进化采纳等审计记录。
- `context/`：AI 恢复上下文用的项目摘要、测试摘要、handoff 和 context pack。
- `discovery/`：需求发现、头脑风暴和候选方案收敛结果。
- `domain/`：共享语言、业务术语、状态边界和待确认语义。
- `issues/`：本地 PRD、issue 切片和 agent brief。
- `biz/`：稳定业务事实和行为契约。
- `decisions/`：ADR 和长期决策。
- `sql/`：数据库变更文档、脚本说明和回滚清单。
- `review/`：人工评审、验收记录和外部审查摘要。
- `reports/`：人工阅读的阶段报告、复盘和汇总。
- `verification/`：普通 plan 的验证证据入口；formal change 的强审计验证仍链接回 `changes/<id>/verification.md|json`。
- `config/`：可提交配置样例和本地配置说明。
- `completed.md`：已完成、稳定且可复用的能力索引。

## 生命周期

1. **发现**：模糊想法先写 `discovery/`。
2. **澄清**：稳定术语和业务边界提炼到 `domain/`。
3. **成形**：可执行范围默认写 `plan/next/` 并登记 `plan/INDEX.md`，开始执行后移到 `plan/active/`；需要分派时写 `issues/`。
4. **决策**：长期技术取舍写 `decisions/`。
5. **执行归属**：单线任务只维护 plan；并行、共享文件或长任务必须登记 `coordination/lanes.json` 并刷新 `status.md`。脏文件必须能归属到某个 lane、当前 plan，或明确列为未归属风险。
6. **正式化**：如果执行中发现需要审批、回滚、发布、严格审计或长期多人协作，再升级为 `changes/<change-id>/`；升级时保留 plan 作为入口，并链接到正式 change。
7. **实现与验证**：每轮先回读真相源；人工计划在 `plan/active/` 里写 Round Log，正式 change 由 CLI 写入 `.updeng/docs/changes/<change-id>/`；worker 交接文件放 `.updeng/tmp/sdd/`，结论回填到 plan 或正式 artifact。
8. **收口**：计划移到 `plan/done/` 并更新 `plan/INDEX.md`；稳定业务事实进入 `biz/`，完成能力进入 `completed.md`，验证/评审/发布证据进入对应目录或正式 change。

## 写入规则

- 单一事实只放一个拥有目录，其他地方用路径链接。
- `docs/` 可以人工编辑；CLI、hook、CI 或 agent 也只写 `docs/` 下的对应目录。
- 不保存密钥、token、密码、生产地址或 `.env` 内容。
- 不把聊天流水账写进长期文档；只写收敛后的结论、理由和后续入口。
- 临时计划完成后移出 `plan/active/` 和 `plan/next/`，只在 `plan/INDEX.md` 保留近期摘要；长期结论必须提炼到拥有目录，避免过期计划堆积。
- `.updeng/tmp/` 只放可再生成或可清理的 scratch；不要放长期 build output、浏览器 profile、release 包或唯一验收证据。`.updeng/tmp/sdd/` 只用于 task/review 临时交接。
