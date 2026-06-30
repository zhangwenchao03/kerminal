# Updeng 生产运行手册

本手册偏向初始化、升级、策略、formal change、审计、发布和生产运维命令。日常开发默认先走 `updeng-workflow.md` 里的 plan-first 流程；只有命中高风险、强审计、发布、公共契约、迁移或长期多人协作时，才把 plan 升级为 formal change。

## CLI 安装与发布

```powershell
npm link
updeng init C:\path\to\project --yes --preset core
npm run pack:check
npm run publish:dry-run
npm publish --access restricted --registry https://registry.npmjs.org/
npm install -g @kong/updeng --registry https://registry.npmjs.org/
```

包元数据默认使用 `publishConfig.access=restricted`，适合发布到私有 npm registry 或私有 scoped package。`pack:check` 会先做语法检查并跑 smoke 初始化，确认打包前的 CLI、模板、skills 和 doctor 能在临时项目中跑通。

## 初始化

```powershell
updeng init C:\path\to\project
updeng init C:\path\to\project --yes --preset core --platform codex
updeng init C:\path\to\project --yes --preset java --platform codex,claude --link-mode junction
updeng init C:\path\to\project --yes --preset core --scope user --user-home C:\Users\me\.updeng
updeng init C:\path\to\project --yes --preset full --scope project,user
```

生产手工初始化优先使用裸 `init` wizard，按提示选择 adapter、scope、link mode 和 group；自动化、模板仓库和批量项目初始化必须使用 `--yes` 固定输入。只想选择部分角色能力时使用 `--yes --groups core-workflow,frontend`，不要手动复制整个 group 目录。

初始化后先运行：

```powershell
updeng doctor C:\path\to\project --json
updeng skills validate C:\path\to\project --json
```

`doctor` 使用当前 CLI 包内 schema 校验 `.updeng/config.yaml`，并检查运行时依赖：Node >=20 与 Git 是硬门禁；Bash、jq、yq 和所选平台 CLI（Codex/Claude/VS Code）是 warning。warning 会出现在 JSON/text 报告中，但不会让初始化后的项目检查失败。

## 升级

```powershell
updeng upgrade C:\path\to\project --dry-run --json
updeng upgrade C:\path\to\project --refresh-skills --json
```

先用 dry-run 检查将要刷新的平台 adapter、docs 模板、workflow 和 legacy runtime 清理动作。实际应用后查看 `.updeng/docs/audit/upgrades/*.json`、`.updeng/manifest.json` 的 `lastUpgrade` 和 `.updeng/docs/metrics/events.jsonl` 中的 `updeng.upgrade` 事件。`--to` 只能应用当前已安装的 `@kong/updeng` 版本；如果 dry-run 提示需要其他包版本，先升级 npm 包，再重新执行 `upgrade`。

## 能力管理

```powershell
updeng skills list
updeng skills add C:\path\to\project --groups frontend,data-ops
updeng skills add C:\path\to\project --groups frontend,data-ops --scope project,user
updeng skills add C:\path\to\project --skills bwy-gis-development
updeng skills remove C:\path\to\project --skills bwy-code-review
updeng skills publish C:\path\to\project --skill bwy-updeng-workflow --version 0.1.0
```

源 `skills/` 目录按角色/风格分组；`--groups` 选择 `skills/<group>` 文件夹，并把该 group 下直接包含 `SKILL.md` 的一层 skill 目录安装到各平台 skill 目录。它不是递归同步，也不会把 group 文件夹本身放进 `.codex/skills`、`.claude/skills` 或 `.updeng/skills`。目标项目 `.updeng/manifest.json` 记录已安装 skill，`skills validate` 会检查 skill capability 合同的 `id/version/name/description/phase/triggers/inputs/outputs/forbidden/steps/qualityGate` 等 schema 必填字段。

`--scope project` 是默认模式，会把 skills 安装进项目平台目录。`--scope user` 会写入 `%USERPROFILE%\.updeng` 或 `--user-home` 指定目录下的 `skills/` 与 `registry/`，目标项目只在 manifest 记录 user registry 路径。`--scope project,user` 同时安装项目副本和用户级共享副本。用户级目录可能被多个项目引用，`skills remove --scope project,user` 只会让当前项目不再引用对应 skill，不会清理用户级旧目录。

## Change 生命周期

```powershell
updeng new <change-id> C:\path\to\project --title "Change title" --capability auth
updeng explore <change-id> C:\path\to\project --summary "Context reviewed"
updeng spec <change-id> C:\path\to\project --summary "Requirements approved"
updeng design <change-id> C:\path\to\project --summary "Design approved"
updeng plan <change-id> C:\path\to\project --summary "Tasks ready" --build-mode inline
updeng guard <change-id> plan C:\path\to\project --json
updeng transition <change-id> build-ready C:\path\to\project
updeng pause <change-id> C:\path\to\project --reason "Waiting for product answer"
updeng block <change-id> C:\path\to\project --reason "API contract missing"
updeng unblock <change-id> C:\path\to\project --reason "Blocker resolved"
updeng cancel <change-id> C:\path\to\project --reason "Superseded by another change"
updeng fail <change-id> C:\path\to\project --reason "Verification cannot be recovered safely"
```

`explore/spec/design/plan` 会写入对应 artifact evidence，并按顺序推进 `intake -> explore -> spec -> design -> plan`。不要用 `transition plan-ready` 从 intake 跳过前置证据；`guard --apply` 不会自动跨 artifact 阶段，只在 plan/build/verify 这些纯状态门上执行 transition。

生产项目建议使用默认 `policy_profile: balanced` 或 `strict`。`balanced` 下 direct build 需要 `direct-mode` 审批证据；`strict` 同样要求 `direct-mode` 审批，并在 build-complete 前强制 RED/GREEN TDD 与 task-to-commit evidence；`solo` 只用于个人探索项目。doctor 会校验 `policy_profile`、`policy_direct_mode`、`policy_tdd` 和 `policy_high_risk_approval` 是否有效。

多项目复用策略用 policy bundle：

```powershell
updeng policy show C:\path\to\project --json
updeng policy export C:\path\to\project --output C:\policies\org-strict.json --name org-strict --json
updeng policy validate C:\path\to\project --source C:\policies\org-strict.json --json
updeng policy validate C:\path\to\project --registry https://policies.example.test/updeng.json --policy org-strict --json
updeng policy import C:\path\to\project --source C:\policies\org-strict.json --dry-run --json
updeng policy import C:\path\to\project --registry https://policies.example.test/updeng.json --policy org-strict --dry-run --json
updeng policy import C:\path\to\project --source C:\policies\org-strict.json --json
```

`--source` 支持本地 JSON 或 `http(s)://` policy bundle；`--registry <json|url> --policy <id>` 支持从组织 `PolicyRegistry` 选择策略，registry 中的相对路径会按 registry 所在位置解析。导入会写入 `.updeng/config.yaml`、`.updeng/docs/audit/policies/*.json` 和 `policy.import` metrics。把策略放宽默认会阻断，例如 `strict -> solo` 必须加 `--force` 并留下审计记录。

团队 skill registry 安装：

```powershell
updeng skills install C:\path\to\project --package C:\skills\team-review.package.json --dry-run --json
updeng skills install C:\path\to\project --registry https://skills.example.test/updeng.json --skill team-review --dry-run --json
updeng skills install C:\path\to\project --registry https://skills.example.test/updeng.json --skill team-review --json
updeng skills validate C:\path\to\project --json
```

`SkillPackage` 安装会校验 package checksum 与每个文件的 sha256，并把外部 skill 缓存到 `.updeng/docs/registry/external/skills/<id>/<version>/source`。安装后会同步 `.updeng/manifest.json`、平台 skill 目录和 `skill.installed` metrics。生产 registry 建议先走 `--dry-run --json`，再执行正式安装；需要鉴权、签名或 npm 包发布时，先通过企业 registry/CI 做外层控制。

`pause/block/unblock/cancel/fail` 是一等状态门。paused/blocked change 不允许继续 artifact phase 或 transition；`resume --json` 会返回 blocker 和对应 `unblock` 命令。cancelled/failed 是终态，不允许 unblock 或继续推进，只保留 blocker 和审计证据。所有状态动作都要求 `--reason`，并同步写入 `state.yaml`、`state.json` 和 metrics event。

新 change 的需求 delta 默认写入 `.updeng/docs/changes/<id>/specs/core/spec.md`。使用 `--capability auth` 或 `--capability auth,billing` 可以按能力拆分需求；归档时会同步到 `.updeng/docs/specs/<capability>/spec.md`。根目录 `spec.md` 不再参与 change 生命周期。

## 本地门禁

```powershell
updeng hooks install C:\path\to\project
updeng hooks check C:\path\to\project --json
```

Git hooks 通过 `core.hooksPath=.githooks` 接入。已有非托管 hooksPath 时，先人工确认，再使用 `--force`。

## CI 与分支保护

```powershell
updeng ci protect C:\path\to\project --repo owner/repo --branch main --json
updeng ci protect C:\path\to\project --repo owner/repo --branch main --apply --json
```

默认只生成 `.updeng/docs/audit/branch-protection/<branch>.json` 计划和 metrics 事件；加 `--apply` 后才调用 `gh api` 配置 GitHub branch protection。required status checks 默认从 `.github/workflows/updeng-validate.yml` 的 job name 推断，也可以用 `--checks "Updeng project checks,npm test"` 显式指定。该 workflow 会在有 active/latest change 时运行 `updeng verify <change> --strict`，并检查 `verification.json` 的 passing evidence；没有 change 时只跑 scaffold/schema/artifact 自检。

上线前用 live integration test 验证真实 GitHub 权限和 API 行为：

```powershell
$env:UPDENG_GITHUB_INTEGRATION="1"
$env:UPDENG_GITHUB_REPO="owner/repo"
$env:UPDENG_GITHUB_CHECKS="Updeng project checks"
npm run test:live
```

测试会在目标仓库创建临时分支，应用 protection，GET 回读 required checks/admin/force-push/delete 策略，然后删除 protection 和临时分支。使用有 admin 权限的 `gh auth` 登录态。

## 隔离与沙箱

```powershell
updeng isolate <change-id> C:\path\to\project --mode worktree
updeng isolate <change-id> C:\path\to\project --mode sandbox
updeng sandbox run <change-id> C:\path\to\project --exec npm --args '["test"]' --allow-fail
updeng sandbox cleanup <change-id> C:\path\to\project
```

高风险变更优先使用 worktree 或 sandbox。sandbox cleanup 只删除带 Updeng marker 的目录。

## Dirty Worktree 归因

```powershell
updeng status C:\path\to\project --json
updeng dirty record <change-id> TASK-001 C:\path\to\project --files src/app.js --reason "Implementation in progress"
updeng guard <change-id> build C:\path\to\project --json
```

`status`、`resume`、`doctor` 会输出 Git dirty worktree 归因。当前 change 下的 `.updeng/docs/changes/<id>/...` 证据文件自动归因；普通项目文件在 `transition` 或 `guard` 前必须记录到当前 task 的 `dirty.json`，并保持 status/hash 一致。`.env`、`secrets/**`、私钥/证书类文件会作为 secret-looking dirty file 直接失败。创建 sandbox 时默认拒绝从未归因的 dirty 源工作区复制，确认风险后才使用 `--force`。

## Worker 执行

```powershell
updeng build <change-id> C:\path\to\project --mode subagent
updeng sdd task-brief <change-id> TASK-001 C:\path\to\project
updeng worker launch <change-id> C:\path\to\project --worker all --adapter codex --cwd sandbox
updeng worker launch <change-id> C:\path\to\project --worker <worker-id> --adapter local --exec npm --args '["test"]' --execute --allow-project
updeng worker status <change-id> C:\path\to\project --json
updeng worker collect <change-id> <worker-id> C:\path\to\project --result C:\path\to\result.json
updeng sdd review-package <base-sha> HEAD C:\path\to\project
updeng sdd progress <change-id> C:\path\to\project --task TASK-001 --base <base-sha> --head HEAD --review clean
```

`build --mode subagent|batch` 会生成 worker prompt 和 task brief。`worker launch` 只记录启动证据；外部进程成功不等于任务完成。用 `worker collect` 或 `build record` 把结果映射为 `DONE`、`DONE_WITH_CONCERNS`、`BLOCKED` 或 `NEEDS_CONTEXT`。leader 记录 base commit，用 `sdd review-package` 生成任务 diff 包，并在 task-scoped spec compliance + code quality 审查通过后用 `sdd progress` 写 ledger；正式结论仍要回填 `tasks.md`、`review.md` 和 `verification.md|json`。真实执行优先使用 sandbox/worktree；项目根执行必须显式 `--allow-project`。

上线前用 live integration test 验证本机 Codex/Claude CLI 登录态和 bridge 协议：

```powershell
$env:UPDENG_CODEX_INTEGRATION="1"
$env:UPDENG_CLAUDE_INTEGRATION="1"
$env:UPDENG_WORKER_LIVE_TIMEOUT_SEC="180"
npm run test:live
```

测试会初始化 collaboration skills，创建 sandbox，覆盖 worker prompt 为只读 smoke prompt，经 Codex/Claude bridge 执行，并校验 stdout JSON 中 `success=true` 和预期回复。若只验证其中一个平台，只设置对应环境变量。

## 上下文索引

```powershell
updeng context index C:\path\to\project
updeng context report C:\path\to\project --json
updeng context summarize C:\path\to\project --change <change-id> --keep 5 --json
updeng context pack <change-id> C:\path\to\project --use-index --budget 12000 --query "health check"
updeng context handoff <change-id> C:\path\to\project --refresh-pack --use-index --summary "Ready for implementation handoff" --json
```

改动代码后若 `context report` 报 stale，重新运行 `context index`。跨阶段或跨 agent 交接前运行 `context handoff`，生成带 checksum 的 `context/handoff.json|md` 并写回 state。验证、沙箱或 worker 失败后运行 `context summarize`，把失败事件和证据沉淀到 `.updeng/docs/context/summaries/current.md|json`；旧摘要会旋转到 `.updeng/docs/context/summaries/history/`，后续 `context pack` 会自动包含当前摘要。

## Metrics 与审计

```powershell
updeng metrics report C:\path\to\project --json
updeng metrics report C:\path\to\project --change <change-id> --json
updeng metrics record C:\path\to\project --event llm.usage --change <change-id> --prompt-tokens 1200 --completion-tokens 300 --cost-usd 0.02
updeng metrics dashboard C:\path\to\project --json
updeng metrics ingest-hooks C:\path\to\project --json
updeng metrics evolution C:\path\to\project --json
updeng evolution propose C:\path\to\project --candidate user-correction-pattern --summary "Promote repeated correction into a reviewed skill update" --json
updeng evolution replay C:\path\to\project --proposal user-correction-pattern --suite .updeng/docs/metrics/evolution/replay-suite.json --output .updeng/docs/metrics/evolution/replays/user-correction-pattern/replay-report.json --json
updeng evolution adopt C:\path\to\project --proposal user-correction-pattern --summary "Validated positive and negative replay" --evidence .updeng/docs/metrics/evolution/replays/user-correction-pattern/replay-report.json --json
updeng audit decisions C:\path\to\project --change <change-id> --json
updeng audit decisions C:\path\to\project --gate high-risk --status approved --json
```

`metrics record` 用于显式记录 LLM token、成本、tool calls 和文件读写量。`metrics ingest-hooks` 用于把 Codex hooks 写入的 `.updeng/docs/metrics/hooks.jsonl` 去重导入 `.updeng/docs/metrics/events.jsonl`，默认只保留 hash、长度、退出码、路径、失败摘要和收口信号，不复制完整 prompt/command/output。`UserPromptSubmit` 发现用户纠正流程边界、执行范围或 scope 时会写入 `SkillEvolutionSignal`；ingest 后映射为 `workflow.correction`，再由 `metrics evolution` 聚合为 `user-correction-pattern` 这类候选。`metrics report` 用于查看 day/change 维度的事件量、状态、verify failure、reopen、lead time、token 和成本。`metrics dashboard` 默认写入 `.updeng/docs/metrics/dashboard.md`。`metrics evolution` 默认写入 `.updeng/docs/metrics/evolution/current.md|json`，用于把重复失败、用户纠正、review/worker/hook 信号、工具失败、收口缺口、审批压力、成本和 context lessons 聚合成 skill 自进化候选。候选必须先用 `evolution propose` 固化为 `.updeng/docs/metrics/evolution/proposals/<id>.json|md`，再用 `evolution replay --suite ...` 生成正反场景 `EvolutionReplayReport`，最后用 `evolution adopt --evidence <replay-report>` 或 `evolution reject --reason ...` 写入审计。它不会自动修改正式 skill 或 hooks。`audit decisions` 用于查询审批、拒绝和豁免记录。新审批记录写入 `previousHash/hash`，项目 doctor 会检查 audit hash chain，发现篡改会失败。

## 验收与归档

```powershell
updeng tdd record <change-id> failing C:\path\to\project --command "npm test"
updeng tdd record <change-id> passing C:\path\to\project --command "npm test"
updeng dirty record <change-id> TASK-001 C:\path\to\project --files src/app.js --reason "Implementation in progress"
updeng verify <change-id> C:\path\to\project --exec npm --args '["test"]'
updeng verify <change-id> C:\path\to\project --suite C:\path\to\verify-suite.json --strict
updeng review <change-id> C:\path\to\project --summary "Review complete" --status approved
updeng review import <change-id> C:\path\to\project --source C:\path\to\review-threads.json --json
updeng release <change-id> C:\path\to\project --summary "API users get the approved behavior; rollback is to revert the synced spec." --status approved
updeng archive <change-id> C:\path\to\project
updeng archive <change-id> C:\path\to\project --dry-run --json
updeng archive <change-id> C:\path\to\project --force
```

不要口头标记完成；用 `verification.json`、`commits.json`、`review.md`、`review-threads.json`、`release.md`、metrics/audit JSONL 留下证据。生产变更优先使用 `verify --suite --strict`，把 lint/test/build、manual checks、requirement mappings 和 coverage 写入同一份验证报告。suite 可用 `coverageReports` 指向 Istanbul `coverage-summary.json`、LCOV `lcov.info`、Cobertura XML、JaCoCo XML 或 JUnit XML；系统会解析并写入 `coverage` 与 `coverageSources`，JUnit 失败会作为 synthetic manual check 影响 strict outcome。`verify` 会从 change spec 自动抽取需求 ID；有需求但缺少通过的 mapping 时，非 strict 结果为 `partial`，strict 结果为 `fail`。`verify-pass` 要求 `verification.json` 中的 required 命令、manual check 和每个已抽取需求的 mapping 证据都为 pass；`archive` 要求 review evidence 和 release evidence 状态均为 approved，release summary 通过内容 lint，且 open critical/high findings 为 0。`review import` 会把本地 review thread JSON 标准化为 `ReviewThreads` schema，open critical/high thread 会保持 `needs-work` 并阻断归档。`release` 会把 release-note 审查写入 `release.md`；approved summary 不能是占位文案，必须说明用户/API/配置/风险/回滚或行为影响。

`archive` 会先检查目标 `.updeng/docs/archive/YYYY-MM-DD-<change-id>` 是否已存在，避免覆盖旧归档或在 move 阶段才失败。同步主规格前会比较目标 hash。若 `.updeng/docs/specs/<capability>/spec.md` 已存在且与 change spec 不同，系统会先按 requirement ID 做语义合并：主规格缺少的新需求会追加到 `Synced Requirements`；同一 requirement ID 内容不同会阻断并在 `--dry-run --json` 中输出 `spec-requirement-diverged`；无法解析为需求块的差异会回退为 `spec-target-diverged`。确认要用本次 change 整体覆盖主规格时才加 `--force`。

## 回滚

```powershell
updeng rollback <change-id> C:\path\to\project --scope task --task TASK-001
updeng archive reopen <change-id> C:\path\to\project
```

优先使用 `git revert` 产生可审计回滚。不要使用 destructive reset 处理已记录的交付证据。
