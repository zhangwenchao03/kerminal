---
name: bwy-development-governance
description: |
  必载技能。用于开发或修改功能的统一规范，覆盖需求澄清、影响域识别、计划登记、实现顺序、文档记录、验证、评审、git 边界和交付口径；不替代 Java、前端、数据库、运维等专项能力。
---

# 开发治理与文档规范

## 使用边界

- 开发、修改、重构、修复、仓库规则调整或任何需要交付闭环的任务都使用本技能。
- 本技能统一需求澄清、影响域、计划登记、文档记录、验证、git 和收尾口径。
- 需求发现、领域澄清、诊断、TDD、原型、架构深化、PRD/Issue、Java、前端、数据库、GIS、评审、远程运维等专项细节由对应 skill 处理；通用流程不要在专项 skill 重复维护。

## 默认流程

1. 每轮读取入口：`AGENTS.md`、`README.md`、`.updeng/docs/README.md`、`.updeng/docs/in-progress.md`、`.updeng/docs/BLOCKERS.md`、`.updeng/docs/plan/INDEX.md`，再按任务读取 `.updeng/docs/plan/active/*.md`、相关 `next|blocked` 计划、当前 audit package 的 `proposal.md`、`specs/*/spec.md`、`design.md`、`tasks.md`、`verification.md|json`、`.updeng/docs/biz/**` 和专项 skill。
2. 明确需求来源、目标、非目标、验收标准、调用方影响、待确认点和影响域。
3. 根据任务性质加载通用工程技能：需求模糊或用户要求先讨论用 `bwy-requirement-discovery`，术语/验收不清用 `bwy-domain-context`，缺陷排查用 `bwy-diagnose`，复杂或高风险逻辑用 `bwy-tdd-development`，设计未知用 `bwy-prototype`，架构摩擦用 `bwy-architecture-deepening`，拆 PRD/issue 用 `bwy-issue-planning`。
4. 根据 `bwy-updeng-workflow` 判定的流程深度执行：`direct` 简单任务不创建计划、不登记 in-progress；普通持续任务在编码前创建 `.updeng/docs/plan/next/PLAN-YYYYMMDD-HHMMSS-<task>.md`，开始执行时移到 `active/`，并登记 `.updeng/docs/in-progress.md`；高风险、发布、迁移、公共契约或强审计任务在当前 plan 上叠加 `.updeng/docs/changes/<change-id>/` 审计包。
5. 对普通 plan，从 `plan/active/*.md` 选择第一个依赖满足的未勾选 `TASK-*`；如果叠加 audit package，则从 `changes/<change-id>/tasks.md` 读取审计任务台账。一轮只做这个最小可提交单元，完成后写回 Round Log。
6. 按现有模块、文件所有权和最近似实现推进；先识别决策逻辑、UI 状态派生、副作用和高频路径，再做最小完整闭环，最后扩展边界场景。
7. 实施中发现目标、设计、风险或待办变化，先更新计划、任务台账、`BLOCKERS.md` 或对应长期文档，再扩大改动。
8. 运行最窄但有效的验证；没有命令结果或跳过原因，不宣称自动化完成，也不提交完成证据。
9. 完成后做实现评审，按文档承载规则沉淀稳定结论，移除 `.updeng/docs/in-progress.md` 条目，把计划移到 `.updeng/docs/plan/done/` 或删除，并更新 `.updeng/docs/plan/INDEX.md`。

## 生产级实现规则

- **先建模再接线**：复杂判断、状态派生、菜单/按钮/快捷键动作、权限开关、展示文案和边界规则，优先进入 `xxxModel`、`xxxPolicy`、`xxxResolver` 或小型纯函数；React 组件、Tauri command 和运行时 glue 层不要堆叠不可测试分支。
- **副作用靠边界**：外部 API、文件/网络 IO、Tauri 平台能力、定时器、队列、缓存和环境探测，优先通过 `adapter`、`facade` 或可注入函数隔离；生产代码只依赖窄接口，测试用 fake 覆盖成功、失败和取消路径。
- **设计模式按需使用**：Strategy/Policy 用于可替换决策，Facade/Adapter 用于隔离外部能力，Presenter/View Model 用于 UI 派生状态，Command Model 用于菜单、按钮和快捷键；只有能减少耦合、提升测试性或隔离变化点时才使用。
- **性能优化先证明契约**：只优化高频路径、明显瓶颈或复杂度热点；修改队列、缓存、批处理、懒加载和字符串/数组处理前，先写清必须保持的同步可见性、顺序、回调次数、错误传播和资源释放语义。
- **测试跟随边界**：纯模型补单测，副作用边界补 fake/adapter 测试，UI 补关键桥接和可见性测试，性能路径补批量、顺序、空输入、重复触发和释放测试；不要用宽泛快照替代行为断言。
- **不确定候选先搁置**：如果某个重构或性能优化无法证明语义安全，先记录为候选和风险，不在当前切片落地；优先修复重构中暴露的真实缺陷，但不顺手扩大功能范围。
- **大文件低冲突治理**：接近上限或多人共享的大文件，优先抽局部 model、parts、policy 或 helper；保持 public 契约和导出兼容，禁止无关格式化、重排和跨域顺手修。

## 智能轻流程

- `direct` 适用：只读解释、单文件小修复、文案/样式/配置微调、明确的测试补充、无接口/数据/权限/发布契约变化的小调整。
- `direct` 执行：先做最小上下文读取和 `git status --short`，需求明确就直接改；不要强行追问、不要创建 plan 或 audit package。
- `direct` 文档：只有当 README、AGENTS、业务契约、启动方式、长期运维说明或用户可见行为发生稳定变化时才更新对应文档；纯内部实现小修不写长期文档。
- 升级条件：涉及多模块协调或验收口径不清时，立即创建或更新 plan；涉及公共 API、数据库、权限、生产远程、删除/迁移、回滚风险或用户明确要求完整审计时，在当前 plan 上叠加 audit package。
- 收口要求不降低：即使是 `direct`，最终也要说明改动、验证命令或跳过验证原因、剩余风险。

## 通用工程技能升级规则

| 信号 | 升级技能 | 必要证据 |
| --- | --- | --- |
| 用户给的是想法、目标或问题，尚未形成明确需求 | `bwy-requirement-discovery` | 发现画布、候选方案、推荐下一步 |
| 需求术语、业务边界或验收语义不稳定 | `bwy-domain-context` | 已确认术语、待确认点、写入位置 |
| 用户报告 bug、失败、偶发或性能回退 | `bwy-diagnose` | 反馈回路、复现结果、假设和回归信号 |
| 用户要求 TDD，或复杂逻辑/回归风险高 | `bwy-tdd-development` | 失败测试、绿色实现、测试命令 |
| 方案未知，需要试逻辑/UI/技术可行性 | `bwy-prototype` | 原型问题、运行命令、删除/吸收条件 |
| 难测试、耦合重、模块浅或重构方向不清 | `bwy-architecture-deepening` | 候选评估、推荐强度、第一切片 |
| 需要 PRD、issue、agent brief 或并行切片 | `bwy-issue-planning` | PRD/切片、AFK/HITL、验收标准 |

## 文档承载

- `AGENTS.md`：稳定、短小、全仓适用的入口规则和项目变量。
- `README.md`：启动、构建、联调和验证方式。
- `.codex/skills/`：实际项目的通用工程规则和专项开发规范；模板仓库根目录只是源模板。
- `.updeng/docs/plan/INDEX.md`：人工计划总览，说明哪个当前执行、哪个排队、哪个阻塞、哪个完成。
- `.updeng/docs/plan/active/`：正在执行的人工计划；允许多个并行 lane 同时 active，但必须同步登记 `.updeng/docs/coordination/lanes.json` 和 `.updeng/docs/in-progress.md`。
- `.updeng/docs/plan/next/`：已确认但还没开始的近期计划。
- `.updeng/docs/plan/blocked/`：等待人工确认、凭据、外部授权或不可逆决策的计划。
- `.updeng/docs/plan/done/`：已完成、取消或被替代的计划历史；稳定事实必须另行提炼。
- `.updeng/docs/BLOCKERS.md`：低风险默认选择、待确认点和不可逆阻塞索引。
- `.updeng/docs/discovery/`：模糊需求发现记录、候选方案、未决问题和下一步。
- `.updeng/docs/domain/`：共享语言、术语边界、业务状态和待确认语义。
- `.updeng/docs/issues/`：没有外部 issue tracker 时的本地 PRD、issue 切片和 agent brief。
- `.updeng/docs/in-progress.md`：当前进行中事项索引。
- `.updeng/docs/coordination/`：并行 Codex 会话、lane、worktree/branch、owned/shared paths、`status.md`、checkpoint 和同文件同步协议。
- `.updeng/docs/biz/`：稳定业务规则、行为契约、业务流程、实现入口和验证口径。
- `.updeng/docs/decisions/`：长期技术、架构、流程和协作决策。
- `.updeng/docs/review/`：人工评审、验收记录和外部审查摘要。
- `.updeng/docs/reports/`：阶段汇总、复盘和人工分析报告。
- `.updeng/docs/changes|archive|metrics|audit|context/`：审计包、验证证据、归档、指标、审计和 AI 上下文。
- `.updeng/docs/completed.md`：符合写入限制的稳定已完成能力索引。
- 同一事实只写在最小且拥有该信息的位置；需要复用时用链接，不复制多份。

## 文档写入

- 行为变更按新增、修改、移除和迁移口径写清触发条件、结果、调用方影响和验证入口。
- 技术决策只记录最终采用方案、替代方案、风险和回滚口径；调研过程不进长期文档。
- 新增或修改业务文档时，按 `references/business-doc-template.md`；新增文档后同步 `.updeng/docs/biz/README.md`。
- 新增 completed 记录时，按 `references/completed-doc-template.md`。
- `.updeng/docs/completed.md` 只记录当前仓库已经完成且稳定、后续可复用、且不能由 `.updeng/docs/biz/`、`.updeng/docs/domain/`、`.codex/skills/`、`README.md`、`.updeng/docs/plan/` 或 `.updeng/docs/in-progress.md` 更准确承载的能力。
- 仅调整 skill 文案、提示词、格式、命名、目录整理或计划清理时，默认不写入 `.updeng/docs/completed.md`。
- 生产级实现或重构的 Round Log 应记录：抽出的 model/policy/facade/adapter、保持不变的行为契约、新增边界测试、验证命令、失败与修复、不落地候选及原因。

## 执行约束

- 技能评估只看实际项目 `.codex/skills/`；不要引用项目目录外插件、全局技能或模板源目录作为规则来源。
- 优先相信当前仓库真实代码、公共基建、最近似实现和业务文档，不用通用习惯覆盖项目强约定。
- 规则冲突按“用户最新指令 > 当前目录文档 > 项目文档 > 项目技能 > 通用经验”处理。
- 不覆盖别人正在改的代码；遇到同文件并行修改，先读最新文件和 diff，再做最小合并。
- plan、audit package、evolution 任务如果和其他会话并行，开始实现前先登记或更新 `.updeng/docs/coordination/lanes.json`，刷新并读取 `.updeng/docs/coordination/status.md`；写入 shared path 前读取对方 lane 计划、最新 diff 和最近 checkpoint。
- 新并行任务默认使用独立 worktree/分支；当前脏主工作区只能作为历史例外继续，且必须有 lane 台账和 checkpoint 计划。
- 完成一个可验证并行切片后，运行 `node .codex/hooks/lane-coordination.cjs checkpoint <lane-id> <project>` 或提交具体文件，并在 Round Log 写明 checkpoint 路径、验证命令和剩余风险。
- 如果当前目录是 Git 仓库，修改前查看 `git status --short`；提交前只 add 本任务实际修改的具体文件，不用 `git add -A`、`git add .` 或宽泛目录 staging。
- 关键风险进入工具层门禁：`git push`、宽泛 staging、敏感文件提交、危险删除、强推主分支、生产写操作必须依赖 hook、git guard、CI 或审批记录，不靠提示词自律。
- 长循环开始前设定轮数、token 或成本上限；同一任务连续 2 轮验证不绿或连续 3 轮没有实质进展，停止汇报阻塞。
- 可逆、低风险的命名、目录和等价写法按合理默认继续，并记录到 `BLOCKERS.md` 或任务 Round Log；不可逆、合规、安全、架构级、生产、凭据缺失和外部授权问题必须停下询问。
- 生成签名密钥、对外发布、推送远端、删除大量文件、数据库迁移/清空、生产写操作和付费外部服务调用属于外部副作用，由 AI 准备清单，等待人工授权或人工执行。
- 不使用 `git reset --hard`、`git stash`、宽泛 checkout 覆盖本地改动。
- 可写注释的配置文件，文件头标注 `@author kongweiguang`。
- `.codex/config.toml` 只放连接方式和环境变量名，不写真实密钥；生产写操作需要明确授权和回滚方案。
- 交付时说明改了什么、执行了哪些验证、哪些风险或未覆盖项仍存在。

## 常用模板

影响域快速表：

```markdown
| 影响域 | 是否涉及 | 入口/文件 | 验证方式 |
| --- | --- | --- | --- |
| 后端接口 | 是/否 | <Controller/Service> | <compile/test/API> |
| 前端页面 | 是/否 | <page/service/types> | <typecheck/browser> |
| 数据库 | 是/否 | <table/sql> | <dry-run/校验 SQL> |
| 权限/审计 | 是/否 | <permission/log> | <权限用例> |
| 需求发现 | 是/否 | <.updeng/docs/discovery> | <候选方案/下一步确认> |
| 领域上下文 | 是/否 | <.updeng/docs/domain> | <术语/场景确认> |
| 诊断/TDD | 是/否 | <test/repro/harness> | <红绿/回归命令> |
| 原型/架构 | 是/否 | <prototype/report/ADR> | <运行命令/评估报告> |
| 文档/发布 | 是/否 | <.updeng/docs/readme> | <文档检查/交付清单> |
```

计划群组规则：

- 文件名使用 `PLAN-YYYYMMDD-HHMMSS-<short-slug>.md`；靠文件名排序看生成先后。
- 文件头使用 `status`、`created_at`、`started_at`、`completed_at`、`updated_at`；`status` 只用 `next`、`active`、`blocked`、`done`，靠时间字段区分生成顺序、执行顺序和收口时间。
- 状态变化时同时移动文件、更新 frontmatter、更新 `.updeng/docs/plan/INDEX.md` 和必要的 `in-progress.md`/`BLOCKERS.md`。
- 并行 active 时，同时更新 `.updeng/docs/coordination/lanes.json`，写清 owned/shared paths 和同步协议。
- 完成计划不得继续留在 `active/` 或 `next/`；近期摘要留在 `INDEX.md`，长期结论提炼到拥有目录。

计划文件骨架：

```markdown
---
id: PLAN-YYYYMMDD-HHMMSS-short-slug
status: next
created_at: YYYY-MM-DDTHH:MM:SS+/-HH:MM
started_at:
completed_at:
updated_at: YYYY-MM-DDTHH:MM:SS+/-HH:MM
owner: ai
---

# <任务名称>

## 目标
- <要实现的用户可见结果>

## 非目标
- <本次明确不做的内容>

## 影响范围
- <模块、接口、表、页面、配置>

## 执行步骤
- [ ] <步骤和完成标准>

## 验证
- <命令或人工验证步骤>

## 风险
- <数据、权限、发布、调用方影响>
```
