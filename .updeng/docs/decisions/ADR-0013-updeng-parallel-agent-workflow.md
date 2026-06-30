# ADR-0013: Updeng 并行 Agent Lane 与自进化候选采集

日期：2026-06-21

## 状态

Accepted

## 背景

Kerminal 当前同时存在“代码规范、设计模式与性能治理”和“AI 助手终端上下文与会话绑定”两个 Codex 会话。两者都在同一个 `main` 工作区推进，且会修改 `commands/registry.rs`、`services/mod.rs`、`state.rs`、`storage/migrations.rs`、`AiToolContent` 等共享热点文件。

原 Updeng 规则写了 `isolation: worktree` 和 `commitPolicy: task`，但缺少运行时 lane 台账、同文件写入提示和计划状态同步规则，导致实际执行可以并行，流程视角却只看到一个 active 计划。

用户还反馈自进化能力“没有体验到”：多次重复的工作流纠正没有自动记录成候选。现有 hook 只记录哈希和少量窄匹配纠正，难以把“说了很多遍”“又出现”“自进化没记住”等信号沉淀为可采纳候选。

## 决策

1. 引入并行 lane 注册表 `.updeng/docs/coordination/lanes.json`。
2. planned/high-risk/evolution 任务可以并行 active，但必须登记 lane、计划、worktree/branch、owner thread/session、owned paths、shared paths 和同步协议。
3. 新任务默认使用独立 worktree/分支；历史脏工作区任务先登记 lane 和共享文件，完成可验证切片后再切 checkpoint 或提交。
4. 同文件并行修改采用 warn-and-sync，不默认阻塞：hook 看到写入其他 active lane 的 owned/shared path 时注入提醒，要求先读对方计划和最新 diff，再最小合并。
5. 自进化仍不自动改正式 skill；UserPromptSubmit hook 负责把重复反馈、用户纠正、工作流缺口写成 `.updeng/docs/metrics/evolution-candidates.jsonl` 候选。
6. 候选允许保存短 redacted excerpt，默认不保存完整 prompt；密钥、token、密码等高风险文本必须被替换。

## 替代方案

- 只允许一个 active 计划：冲突少，但不能满足用户同时要新功能和代码优化的目标。
- 完全依赖 git merge/rebase：代码层可行，但 agent 在写入前仍看不到对方意图、计划和热点文件。
- 自动采纳自进化：体验更强，但风险过高，容易把单次反馈写进正式规则。

## 后果

- 并行能力从“靠会话自觉”升级为“台账 + hook 提醒 + 计划同步”。
- 同文件修改不再静默覆盖，但仍允许继续开发。
- 自进化会有候选文件和证据，用户可以看到为什么没有直接改正式 skill。
- 需要维护 lane 状态；完成计划时必须清理或标记 lane done。

## 验证

- `node .codex/skills/bwy-project-skill-maintenance/scripts/validate_skills.js --run-tests`
- `node .codex/hooks/skill-forced-eval.cjs` 使用重复反馈样例，确认生成 `SkillEvolutionSignal` 和候选。
- `node .codex/hooks/pre-tool-use.cjs` 使用共享路径写入样例，确认输出并行 lane warning 而不是 deny。
