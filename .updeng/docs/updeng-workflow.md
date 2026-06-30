# Updeng 工作流设计

## 结构判断

当前 Updeng 只保留一个主流程目录 `.updeng/docs/`，所有流程台账、验证证据、审计、指标、自进化事件和 AI 上下文都统一放在这里。`.updeng/data/` 不再作为工作流目录使用；schemas、scripts、artifact templates 和 guard 逻辑由当前 `updeng` CLI 包提供。

## 新流程模型

Updeng 默认采用 **Plan-first, Change-on-demand, Evidence-backed**：

1. **direct**：范围清楚、风险低、可一次收口的小任务。不创建 plan 或 change；直接实现、验证、说明结果。
2. **plan**：默认主流程。普通功能、跨文件修改、缺陷修复、技能维护、持续推进任务都进入 `.updeng/docs/plan/`，由 `plan/INDEX.md` 索引，计划文件按 `next/active/blocked/done` 移动。
3. **lane**：并行和长任务的归属层。多个 active plan、共享文件、脏工作区或 worker-assisted 任务必须在 `.updeng/docs/coordination/lanes.json` 登记，并用 `status.md` 暴露 changed/shared/unclaimed paths。
4. **formal change**：按需审计层。只有数据库/权限/安全/生产/发布/公共契约/迁移/强审计/长期多人协作任务才使用 `.updeng/docs/changes/<change-id>/` 的完整生命周期。
5. **evidence**：所有流程完成声明都必须有验证、评审、截图、checkpoint、commit、发布、审计或明确无法验证原因。长期事实提炼到 `biz/`、`domain/`、`decisions/`、`completed.md`，临时 scratch 不作为唯一证据。

原则：不要为了“流程完整”让所有任务都创建正式 change；也不要让长任务只存在对话里。`plan/` 是默认工作台，`changes/` 是升级后的审计工单。

| 目录 | 定位 | 是否建议提交 |
| --- | --- | --- |
| `.updeng/docs/` | 需求发现、计划、lane 协调、按需正式 change、验证、审计、指标、上下文、业务事实、决策、评审、报告、完成能力和工作流说明 | 是 |
| `.codex/` | Codex hooks、配置和项目内技能映射 | 是 |
| `.claude/` | 可选 Claude Code 项目技能映射 | 是 |
| `.vscode/` | 可选 VS Code tasks 入口 | 是 |
| `.updeng/` | 轻量配置、状态、manifest 和 `docs/` 工作台 | 是 |
| `.updeng/tmp/` | 可清理 scratch；`sdd/` 下放 task brief、worker report、review package 和 progress ledger 临时交接文件 | 否 |

## 推荐目录

```text
.updeng/
  README.md
  docs/
    README.md
    updeng-workflow.md
    in-progress.md
    BLOCKERS.md
    completed.md
    plan/
      INDEX.md
      _template.md
      active/
      next/
      blocked/
      done/
    discovery/
    domain/
    issues/
    biz/
    decisions/
    sql/
    review/
    reports/
    verification/
    config/
    changes/
    specs/
    archive/
    metrics/
    audit/
    context/
      README.md
  config.yaml
  state.yaml
  manifest.json
  skills/              # VS Code or neutral project-scope skills only
  tmp/
    sdd/               # ignored task/review handoff scratch
```

## 文档边界

| 内容 | 位置 |
| --- | --- |
| 模糊需求、头脑风暴、候选方案 | `.updeng/docs/discovery/` |
| 领域术语、业务边界 | `.updeng/docs/domain/` |
| 当前执行人工计划 | `.updeng/docs/plan/INDEX.md`、`.updeng/docs/plan/active/` |
| 并行 lane、共享路径、checkpoint、未归属脏文件 | `.updeng/docs/coordination/` |
| 按需正式 change 台账 | `.updeng/docs/changes/<id>/tasks.md` |
| 低风险默认选择、待确认点、阻塞 | `.updeng/docs/BLOCKERS.md` 或当前 `tasks.md` Round Log |
| PRD、issue、agent brief | `.updeng/docs/issues/` |
| 稳定业务规则 | `.updeng/docs/biz/` |
| 技术取舍 | `.updeng/docs/decisions/` |
| 验证、评审、发布证据 | `.updeng/docs/verification/`、`.updeng/docs/review/`、`.updeng/docs/reports/` 或 `.updeng/docs/changes/<id>/` |
| 指标、自进化候选 | `.updeng/docs/metrics/` |
| 审计记录 | `.updeng/docs/audit/` |
| AI 上下文 | `.updeng/docs/context/` |
| worker 临时交接 | `.updeng/tmp/sdd/` |

原则：只维护 `.updeng/docs/` 一套流程目录。不要复制同一事实；需要复用时用路径链接。

## CLI 入口

主入口是 npm/bin CLI：

```powershell
npm link
updeng init C:\path\to\target-project --yes --preset core
npm run pack:check
npm run publish:dry-run
updeng skills list
updeng init C:\path\to\target-project
updeng init C:\path\to\target-project --yes --preset java --link-mode junction
updeng init C:\path\to\target-project --yes --preset core --platform codex,claude,vscode
updeng init C:\path\to\target-project --yes --preset core --scope user --user-home C:\Users\me\.updeng
updeng upgrade C:\path\to\target-project --dry-run --json
updeng doctor C:\path\to\target-project
```

裸 `updeng init <project>` 进入交互式 wizard，依次选择 AI 工具 adapter、skill scope、link mode 和角色/风格 group，并在确认摘要后写入目标项目。命令里已经给出 `--skills`、`--groups` 或 `--categories` 但没有 `--yes` 时，CLI 不再重新选择技能，只补问 adapter/scope/link mode 并确认；CI、脚本和批量初始化使用 `--yes`。

`package.json` 暴露 `updeng` 一个 bin，默认 `publishConfig.access=restricted`，用于私有 npm registry 或私有 scoped package 发布。发布前先跑 `npm run pack:check`；需要只验证 npm 包清单和发布流程时跑 `npm run publish:dry-run`。

## 能力安装模式

初始化时支持：

- `--preset core|java|full`：按预设安装能力包。
- `--groups core-workflow,frontend,data-ops`：按源分组文件夹安装。
- `--categories governance,frontend,data`：按能力分类安装。
- `--skills bwy-updeng-workflow,bwy-code-review`：按精确 skill 安装。
- `--link-mode junction|symlink|copy`：把模板 skills 连接或复制到目标项目平台 skill 目录。
- `--platform codex,claude,vscode`：生成 Codex、Claude Code、VS Code 对应 adapter；VS Code 使用 `.updeng/skills` 作为中性 skill 目录。
- `--scope project|user|project,user`：选择项目级 skills、用户级共享 skills，或同时安装两者。
- `--user-home C:\Users\me\.updeng`：指定用户级 Updeng home；默认是 `%USERPROFILE%\.updeng` 或 `UPDENG_HOME`。

skills 源目录按角色/风格分组，`--groups` 选择 `skills/<group>` 文件夹并安装其中一层 skill 目录：只读取选中 group 下直接包含 `SKILL.md` 的子目录，不递归扫描更深层目录，也不把 group 目录本身安装到目标项目。目标项目 `.updeng/manifest.json` 记录已安装 skill；每个 skill 自身带 workflow `phase` 的 `capability:` 合同，记录触发、输入、输出、禁区、步骤和质量门禁。
`updeng skills validate <project>` 会校验 `.updeng/manifest.json`、capability 合同、平台 skill 目录和用户级 catalog 的一致性。
`updeng skills add/remove <project>` 会重写 manifest 和各平台项目 skill 目录，并在启用 user scope 时刷新 `<user-home>/skills` 和 `<user-home>/registry/skills.catalog.yaml`；`updeng skills publish <project>` 会把 skill 的 frontmatter、文件清单和 sha256 发布为 `.updeng/docs/registry/published/<skill>.json`，供后续私有 registry 或自进化采纳使用。

## 工作流阶段

1. **Intake**：识别任务类型、风险和验收口径。
2. **Route**：选择必载技能、通用工程技能、专项技能和是否需要 worker。
3. **Context**：读取 AGENTS、README、`.updeng/docs`、领域上下文、ADR 和最近似实现；有 `.codegraph/` 时优先用 CodeGraph。
4. **Discover**：需求模糊、用户要求先讨论或需要候选方案时使用 `bwy-requirement-discovery`，并把收敛结论写入 `.updeng/docs/discovery/`。
5. **Clarify**：术语、业务边界或验收含糊时使用 `bwy-domain-context`，并把稳定词汇写入 `.updeng/docs/domain/`。
6. **Shape**：复杂需求使用 `bwy-issue-planning` 拆 PRD/issue；设计未知用 `bwy-prototype`；架构摩擦用 `bwy-architecture-deepening`。
7. **Plan**：按 `direct`、`plan`、`lane`、`formal change`、`evolution` 决定流程深度；普通持续任务写入 `plan/INDEX.md` 并按 `next/active/blocked/done` 分状态。
8. **Coordinate**：并行、长任务、共享路径或脏工作区任务登记 lane，刷新 `coordination/status.md`，确保每个 changed path 有归属或被列为 unclaimed。
9. **Escalate**：命中高风险、审计、发布、迁移、公共契约或长期多人协作时，再创建正式 `changes/<change-id>/`；否则继续用 plan 作为主台账。
10. **Build**：先扫描当前 plan 或正式 change 的 task、设计、验收标准和 checkpoint；选择第一个依赖满足的未完成 `TASK-*`，一轮只做一个最小可提交单元。subagent/batch 通过 `updeng sdd task-brief`、worker report 和 `updeng sdd review-package` 做文件交接。
11. **Verify**：运行最窄有效验证，记录无法验证的原因；验证不通过先修复，不写完成证据。
12. **Commit Evidence**：验证通过后只 stage 本轮具体文件，提交或记录未提交原因；正式 change 绑定 task-to-commit，人工计划在 Round Log 记录 commit 或未提交原因。
13. **Review**：非平凡变更做代码评审口径检查；worker-assisted 任务先做 task-scoped spec compliance + code quality 审查，最终再做整体 diff 审查。
14. **Closeout**：更新 Round Log、沉淀业务事实、清理 in-progress、把完成计划移出 `plan/active/` 或 `plan/next/`、删除或吸收原型、说明风险。
15. **Learn**：把可复用流程问题写成自进化候选；需要修改 skill/hook 时先整理边界并等待确认。

## 自主轮次协议

用于 plan、lane、formal change、evolution 和长 direct 任务，目的是把状态留在文件里，而不是留在对话记忆里。

1. **开工回读真相源**：每轮重新读取 `AGENTS.md`、`README.md`、`.updeng/docs/README.md`、`.updeng/docs/in-progress.md`、`.updeng/docs/BLOCKERS.md`、`.updeng/docs/plan/INDEX.md`、当前 `plan/active/*.md`、`coordination/status.md`、必要 checkpoint、正式 change 的 `proposal.md`、`specs/*/spec.md`、`design.md`、`tasks.md`、`verification.md|json` 和当前 diff；有 `.codegraph/` 时先用 CodeGraph。
2. **任务台账驱动**：人工计划以 `.updeng/docs/plan/INDEX.md` 和 `plan/active/*.md` 为默认外部记忆；正式 change 以 `.updeng/docs/changes/<change-id>/tasks.md` 为审计台账。每条 `TASK-*` 保留 files、tests、acceptance、commit_hint，并在完成后写 Round Log。
3. **计划预检**：build 前快速扫描 `tasks.md`、`design.md`、`specs/*/spec.md` 的矛盾、占位符和互相冲突的约束；阻塞项一次性抛给用户。
4. **文件归属**：写入前检查 `coordination/status.md`；命中其他 lane 的 owned/shared paths 时，先读对方 plan、diff 和 checkpoint，再做最小兼容修改。未归属脏文件必须登记到 lane、plan Round Log，或作为风险汇报。
5. **文件交接**：subagent/batch 模式先运行 `updeng sdd task-brief <change-id> <TASK-ID>`；实现者写 report，leader 记录 base commit 后用 `updeng sdd review-package <base> HEAD` 生成 diff 包给 reviewer，审查通过后用 `updeng sdd progress` 写 ledger。`.updeng/tmp/sdd/` 是可清理 scratch，不承载长期事实。
6. **一轮一件事**：选择第一个依赖满足的未勾选 `TASK-*`，只完成这一项；不要把多个独立功能合并到一轮。
7. **验证门先于提交**：先跑任务声明的最窄有效验证，红了先修绿；无法运行时写清环境缺口、替代检查和残余风险。
8. **运行态视觉验证**：UI/前端/桌面窗口变更先运行真实界面并截图；有原型、设计图、参考 HTML 或旧页面时并排比对。关键视觉偏差未消除时，验证失败。
9. **显式 staging**：提交前只 `git add <file>` 本轮具体文件，禁止 `git add -A`、宽泛 `git add .` 或混入未归因改动；正式 change 用 `updeng task complete <change-id> <task-id> --sha <sha|HEAD>` 绑定提交，人工计划在 Round Log 记录 commit 或未提交原因。
10. **风险分流**：可逆、低风险的命名、目录和等价写法按合理默认继续，并记录到 `.updeng/docs/BLOCKERS.md` 或 Round Log；不可逆、合规、安全、架构级、生产、凭据和外部授权问题必须停下询问或 `updeng block`。
11. **熔断与终点**：连续 3 轮没有实质进展，或同一任务连续 2 轮验证修不绿，停止并汇报；全部任务勾选、验证/评审/发布门禁通过后输出完成报告并停止。

## 执行护栏模型

1. **策略由工具执行**：宽泛 `git add -A/.`、敏感文件提交、危险删除、强推主分支和生产写操作必须由 Codex PreToolUse hook、Git hook、CI 或 `updeng approve` 这类门禁承接；普通远端 push 和常规发版不作为默认工具层拦截项。
2. **自主执行受预算约束**：自主执行前明确最大轮数、同一任务修复次数、token 或成本预算。默认配置在 `.updeng/config.yaml` 的 `workflow.guardrails`；超过上限先汇报，不继续消耗。
3. **外部副作用由人拥有**：普通远端 push 和常规发版可按用户明确意图执行；生成签名密钥、删除大量文件、数据库迁移/清空、生产写操作、付费外部服务调用和影响外部状态的不可逆动作，必须先准备命令、影响范围、回滚和验证清单，等待人工授权或人工执行。

## Hook 职责

| Hook | 职责 |
| --- | --- |
| `UserPromptSubmit` | 任务路由、必载 skill 注入、事件采集 |
| `PreToolUse` | 高危命令拦截、敏感文件提醒、破坏性动作阻断 |
| `PostToolUse` | 记录工具执行摘要、失败模式、退出码、路径和耗时，不保留完整输出 |
| `Stop` | 记录会话停止时的 active change、phase 和验证/review/release 收口信号 |

Hook 不直接修改正式 skill；它只采集证据、注入上下文、阻断危险操作。

## 自进化策略

自进化采用“在线采集，AI 整理，人工确认边界”的模式：

- 在线：hook/CLI 记录事件、prompt hash、命中技能、风险分类、安全拦截、工具失败摘要、停止前收口信号、token 和成本。`UserPromptSubmit` 会在识别到用户纠正流程边界、scope、执行范围或“先讨论/现在实施”意图时额外写入 `SkillEvolutionSignal`，例如“不是递归”会落到 `workflow.correction` 候选，而不是直接改 skill。
- 导入：定期运行 `updeng metrics ingest-hooks`，把 `.updeng/docs/metrics/hooks.jsonl` 去重转入 `.updeng/docs/metrics/events.jsonl`。
- 候选：定期运行 `updeng metrics evolution` 分析 `.updeng/docs/metrics/`、`.updeng/docs/audit/` 与 `.updeng/docs/context/summaries/`，生成自进化候选和 dashboard。
- 整理：AI 读取 `current.md|json`，把用户纠正、多次说明和重复失败整理成“拟改文件、修改边界、不改内容、验证命令”。
- 修改：用户确认边界后，AI 只改确认范围内的 `skills/` 或 `.codex/hooks/`，然后运行 skill 自检或受影响 hook/script 测试。
- 严格审计：高风险 hook 行为、跨多个 skill 的职责变化或团队需要审计链时，才使用 `evolution propose/replay/adopt/reject` 写入 `.updeng/docs/audit/evolution/*.json`。

## 初始化方式

在本仓库运行：

```powershell
updeng init C:\path\to\target-project
```

常用参数：

```powershell
updeng init C:\path\to\target-project --dry-run
updeng init C:\path\to\target-project --yes --preset core
updeng init C:\path\to\target-project --groups core-workflow,frontend,data-ops --link-mode copy
updeng init C:\path\to\target-project --yes --preset core --platform codex,claude,vscode
updeng init C:\path\to\target-project --yes --preset full --scope project,user
updeng upgrade C:\path\to\target-project --refresh-skills --json
updeng init C:\path\to\target-project --force
```

`update` 用于刷新当前托管文件；`upgrade` 用于版本化升级，先用 `--dry-run --json` 看计划，再实际应用。应用后会写 `.updeng/docs/audit/upgrades/*.json`、manifest `lastUpgrade` 和 `updeng.upgrade` metrics 事件。`--refresh-skills` 会重装当前 manifest 引用的项目级或用户级受管 skills。

## 证据与门禁命令

```powershell
updeng new <change-id> C:\path\to\target-project --title "Change title"
updeng explore <change-id> C:\path\to\target-project --summary "Context reviewed"
updeng spec <change-id> C:\path\to\target-project --summary "Requirements approved"
updeng design <change-id> C:\path\to\target-project --summary "Design approved"
updeng plan <change-id> C:\path\to\target-project --summary "Tasks ready" --build-mode inline
updeng approve <change-id> high-risk C:\path\to\target-project --reason "Reviewed rollback and verification plan"
updeng ci protect C:\path\to\target-project --repo owner/repo --branch main --json
updeng pause <change-id> C:\path\to\target-project --reason "Waiting for product answer"
updeng block <change-id> C:\path\to\target-project --reason "API contract missing"
updeng unblock <change-id> C:\path\to\target-project --reason "Blocker resolved"
updeng cancel <change-id> C:\path\to\target-project --reason "Superseded by another change"
updeng fail <change-id> C:\path\to\target-project --reason "Verification cannot be recovered safely"
updeng dirty record <change-id> TASK-001 C:\path\to\target-project --files src/app.js --reason "Implementation in progress"
updeng state set <change-id> tdd_mode enforce C:\path\to\target-project
updeng tdd record <change-id> failing C:\path\to\target-project --command "npm test"
updeng tdd record <change-id> passing C:\path\to\target-project --command "npm test"
updeng build <change-id> C:\path\to\target-project --mode subagent
updeng sdd task-brief <change-id> TASK-001 C:\path\to\target-project
updeng sdd review-package <base-sha> HEAD C:\path\to\target-project
updeng sdd progress <change-id> C:\path\to\target-project --task TASK-001 --base <base-sha> --head HEAD --review clean
updeng worker launch <change-id> C:\path\to\target-project --worker all --adapter codex --cwd sandbox
updeng worker status <change-id> C:\path\to\target-project --json
updeng worker collect <change-id> <worker-id> C:\path\to\target-project --result C:\path\to\result.json
updeng build record <change-id> subagent-task-001 DONE C:\path\to\target-project --summary "Implemented task"
updeng task complete <change-id> TASK-001 C:\path\to\target-project --sha HEAD
updeng hooks install C:\path\to\target-project
updeng hooks check C:\path\to\target-project --json
updeng policy show C:\path\to\target-project --json
updeng policy export C:\path\to\target-project --output C:\policies\org-strict.json --name org-strict --json
updeng policy import C:\path\to\target-project --source C:\policies\org-strict.json --dry-run --json
updeng policy import C:\path\to\target-project --registry https://policies.example.test/updeng.json --policy org-strict --dry-run --json
updeng skills install C:\path\to\target-project --registry https://skills.example.test/updeng.json --skill team-review --dry-run --json
updeng isolate <change-id> C:\path\to\target-project --mode sandbox
updeng sandbox run <change-id> C:\path\to\target-project --exec npm --args '["test"]' --allow-fail
updeng context index C:\path\to\target-project
updeng context report C:\path\to\target-project --json
updeng context summarize C:\path\to\target-project --change <change-id> --keep 5 --json
updeng context pack <change-id> C:\path\to\target-project --mode balanced
updeng context pack <change-id> C:\path\to\target-project --use-index --budget 12000 --query "health check"
updeng rollback <change-id> C:\path\to\target-project --scope task --task TASK-001
updeng verify <change-id> C:\path\to\target-project --suite C:\path\to\verify-suite.json --strict
updeng review <change-id> C:\path\to\target-project --summary "Review complete" --status approved
updeng review import <change-id> C:\path\to\target-project --source C:\path\to\review-threads.json --json
updeng release <change-id> C:\path\to\target-project --summary "API users get the approved behavior; rollback is to revert the synced spec." --status approved
updeng isolate cleanup <change-id> C:\path\to\target-project --remove-branch
updeng archive reopen <change-id> C:\path\to\target-project
updeng metrics record C:\path\to\target-project --event llm.usage --change <change-id> --prompt-tokens 1200 --completion-tokens 300 --cost-usd 0.02
updeng metrics report C:\path\to\target-project --json
updeng metrics report C:\path\to\target-project --change <change-id> --json
updeng metrics dashboard C:\path\to\target-project --json
updeng metrics ingest-hooks C:\path\to\target-project --json
updeng metrics evolution C:\path\to\target-project --json
# 默认轻流程：让 AI 读取 .updeng/docs/metrics/evolution/current.md|json，整理修改边界，用户确认后直接做受限 diff 并验证。
# 严格审计流程：
updeng evolution propose C:\path\to\target-project --candidate user-correction-pattern --summary "Promote repeated correction into a reviewed skill update" --json
updeng evolution list C:\path\to\target-project --status proposed --json
updeng evolution replay C:\path\to\target-project --proposal user-correction-pattern --suite .updeng/docs/metrics/evolution/replay-suite.json --output .updeng/docs/metrics/evolution/replays/user-correction-pattern/replay-report.json --json
updeng evolution adopt C:\path\to\target-project --proposal user-correction-pattern --summary "Validated positive and negative replay" --evidence .updeng/docs/metrics/evolution/replays/user-correction-pattern/replay-report.json --json
updeng evolution reject C:\path\to\target-project --proposal verification-failure-loop --reason "Covered by current verification gate" --json
updeng audit decisions C:\path\to\target-project --gate high-risk --status approved --json
updeng skills validate C:\path\to\target-project
updeng doctor C:\path\to\target-project --json
```

`doctor` 会用当前 CLI 包内的 config schema 校验 `.updeng/config.yaml`，并把 Node >=20 与 Git 当成硬门禁；Bash、jq、yq 和所选平台 CLI 只作为 warning，便于项目先完成初始化，再按使用场景补齐可选工具。

`.updeng/config.yaml` 的 `policy_profile` 控制门禁强度：`balanced` 是默认日常开发策略，direct build 需要 `updeng approve <change> direct-mode --reason ...` 审批；`strict` 同样要求 `direct-mode` 审批并强制 RED/GREEN TDD + task-to-commit evidence；`solo` 放宽 direct/high-risk build 审批，适合个人探索。可用 `policy_direct_mode`、`policy_tdd`、`policy_high_risk_approval` 做显式覆盖。`guard` 和 doctor 会输出当前 profile。
`policy export|validate|import` 用于多项目复用门禁策略。导出的 `PolicyBundle` 带 checksum；`validate/import --source` 支持本地 JSON 或 `http(s)://` bundle，`--registry <json|url> --policy <id>` 支持从组织 `PolicyRegistry` 选择策略。导入会更新 `.updeng/config.yaml`、写入 `.updeng/docs/audit/policies/*.json` 并记录 metrics。把目标项目策略放宽时默认阻断，必须显式 `--force`。
`skills install --package <json|url>` 或 `--registry <json|url> --skill <id>` 用于安装团队/远程 `SkillPackage`。安装前会校验 package checksum 和每个文件的 sha256，随后把外部 skill 缓存到 `.updeng/docs/registry/external/skills/<id>/<version>/source`，同步 `.updeng/manifest.json`、平台 skill 目录和 capability 合同，并记录 `skill.installed` metrics。外部 skill 不要求进入 bundled `skills/` 分组目录。

`explore/spec/design/plan` 是标准 artifact 生命周期命令，按顺序写入探索、需求、设计和任务证据，再推进 `intake -> explore -> spec -> design -> plan`。直接 `transition plan-ready` 不能从 intake 跳过前置证据；`guard --apply` 不会自动跨 artifact 阶段，避免状态变化和文档证据脱节。`tasks.md` 使用 `TASK-*` checkbox 作为当前任务协议，每个任务必须包含 `depends_on`、`parallelizable`、`files`、`tests`、`acceptance` 和 `commit_hint`，否则 `plan`/build transition 会阻断。任务完成后继续使用同一文件的 Round Log 记录实际修改、验证结果、提交 SHA、踩坑和后续待办。
高风险或 critical 变更进入 build 前需要 `high-risk` 审批。任务完成可以绑定 commit SHA，后续 `state.json`、`verification.json` 和 doctor 都会消费这份证据。
`pause/block/unblock/cancel/fail` 会改变 workflow status，不改变 phase。paused/blocked 状态会阻断 artifact phase command 和 `transition`，直到用 `unblock --reason` 恢复 active；cancelled/failed 是终态，只能作为 blocker 和审计证据保留，不允许 unblock 后继续推进。状态原因与时间戳会进入 `state.json`，同时记录 metrics event。
普通项目文件处于 dirty 状态时，`transition` 和 `guard` 要求它们能归因到当前 task：使用 `dirty record` 写入 `dirty.json` 后才能推进，并且后续文件 hash/status 变化需要重新记录。当前 change 下的证据文件自动归因；`.env`、`secrets/**`、私钥/证书类文件会直接阻断 doctor 和阶段推进。
当 `tdd_mode=enforce` 时，`build-complete` 前必须同时具备 failing TDD 证据、passing TDD 证据和 task-to-commit 证据。
`build --mode subagent|batch` 会生成 `execution.json`、每个 task 的 worker prompt 和对应 task brief。`sdd task-brief`、`sdd review-package` 和 `sdd progress` 把任务文本、worker report、diff 包和恢复 ledger 放到被忽略的 `.updeng/tmp/sdd/`，避免大段上下文常驻对话；正式结论仍写回 `tasks.md`、`review.md`、`verification.md|json`。`worker launch/status/collect` 负责受控启动 local/Codex/Claude worker、记录启动证据，并把外部结果收集回 worker status。`build-complete` 前所有 worker 必须是 `DONE` 或 `DONE_WITH_CONCERNS`。
`updeng verify --exec <file> --args <json-array>` 用于单命令验证；`updeng verify --suite <json>` 可一次运行 lint/test/build 等多条命令。suite 的 `commands[]` 默认必须使用 `executable` + `args`，只有显式 `shell: true` 才允许 `command` 字符串。验证会写入 manual checks、requirement mappings、coverage、stdout/stderr evidence，以及带 `shell/executable/args` 的 command evidence。suite 可用 `coverageReports` 指向 Istanbul `coverage-summary.json`、LCOV `lcov.info`、Cobertura XML、JaCoCo XML 或 JUnit XML；系统会解析并写入 `coverage` 与 `coverageSources`，JUnit 失败会作为 synthetic manual check 影响 strict outcome。`verify` 会从 `.updeng/docs/changes/<id>/specs/<capability>/spec.md` 自动抽取需求 ID 并生成 requirement mapping gate；缺少通过 mapping 时，非 strict 只能得到 `partial`，strict 会失败。`verify-pass` 会读取 `verification.json`，要求当前 change 的 `VerificationReport` outcome 为 pass，且 required 命令、manual check、每个已抽取需求的 requirement mapping 都通过；`archive` 还要求 approved `Review Evidence` 和 approved `Release Evidence`，release summary 通过内容 lint，open critical/high findings 必须为 0。`updeng review import --source <json>` 可导入本地 review thread 报告并写入 `review-threads.json`；open critical/high thread 会让 review 变成 `needs-work` 并阻断归档。`updeng release` 会把 release-note 审查写入 `release.md`；approved summary 不能是占位文案，必须说明用户/API/配置/风险/回滚或行为影响。
初始化生成的 GitHub Actions workflow 会在检测到 active/latest change 时运行 `updeng verify <change> --strict`，并检查 `verification.json` 的 `VerificationReport`、changeId、passing outcome 和 command evidence；没有 change 时只执行 scaffold/schema/artifact 自检。
`hooks install` 使用 `core.hooksPath=.githooks` 安装 pre-commit/pre-push；已有非托管 hooksPath 时需要人工确认后使用 `--force`。
`isolate --mode sandbox` 创建带 marker 的本地项目副本；默认拒绝从未归因的 dirty 源工作区复制，确认风险后才使用 `--force`。`sandbox run` 默认使用 `--exec/--args` 结构化执行，显式 `--shell --command` 才进入 shell；stdout/stderr 和结果写入 `sandbox.json`，cleanup 只删除受管目录。
`context index/report` 维护 `.updeng/docs/context/index`，能发现 stale 文件；`context pack` 支持 `off|balanced|aggressive`，输出 project/change/execution/code 分层上下文、文件摘要、摘录、稳定 checksum、索引 checksum 和预算控制。
`rollback --scope task|change` 会基于 `commits.json` 执行 `git revert --no-edit`，并写入 `rollback.json`；默认不带 scope 时只做 state-only rollback。
`archive reopen` 会把 `.updeng/docs/archive/<date>-<change-id>` 恢复到 `.updeng/docs/changes/<change-id>`，状态回到 `verify`，用于归档后发现遗漏或需要补充验证的场景。
`archive` 同步主规格时会按 requirement ID 做安全合并：缺少的新需求追加到 `Synced Requirements`，同 ID 内容不同输出 `spec-requirement-diverged` 并阻断，无法解析的文件级差异输出 `spec-target-diverged`；只有显式 `--force` 才整体覆盖主规格。
`metrics ingest-hooks` 会读取 `.updeng/docs/metrics/hooks.jsonl`，用 source line hash 去重后转成 `skill.route`、`pretool.denied`、`hook.tool.failed`、`hook.stop.missing-closeout` 等标准 metrics；不会复制完整 prompt、command、stdout 或 stderr。`metrics report` 会聚合 `.updeng/docs/metrics/events.jsonl`，输出 change/day 维度的事件、状态、verify failure、reopen 和 lead time；`metrics evolution` 会生成 `.updeng/docs/metrics/evolution/current.md|json`，把重复验证失败、用户纠正、review/worker/hook 信号、工具失败、收口缺口、审批压力、成本和 context lessons 转为可审查候选，并附带验证计划。默认轻流程由 AI 读取候选，整理成受限修改边界，用户确认后直接修改 skill 或 hook 并验证。`evolution propose/list/replay/adopt/reject` 只作为严格审计漏斗：proposal 写入 `.updeng/docs/metrics/evolution/proposals/`，`replay` 用正反场景生成 schema 校验的 `EvolutionReplayReport`，采纳/拒绝写入 `.updeng/docs/audit/evolution/` 和 metrics event。`audit decisions` 会查询 `.updeng/docs/audit/decisions.jsonl` 中的审批、拒绝和豁免记录；新写入的 decision record 带 `previousHash/hash` 链，目标项目 doctor 会校验 audit JSONL 的 schema 和 hash chain。
worktree 清理默认要求工作区干净；删除分支必须显式加 `--remove-branch`，未合并或脏 worktree 需要人工确认后再加 `--force`。
