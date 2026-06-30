# 并行任务协调台账

本目录记录多个 plan/lane/Codex 会话同时开发时的归属、共享文件和同步规则。它解决三个问题：

- 多个任务可以同时跑，但不能互相看不见。
- 多个任务需要改同一个文件时，不阻塞开发，但必须先暴露冲突、同步上下文、最小合并。
- 脏工作区里的 changed paths 必须能归属到某个 lane、当前 plan，或被明确列为 unclaimed 风险。

## 文件

- `lanes.json`：当前并行 lane 注册表，供人、agent 和 hook 读取。
- `.updeng/docs/in-progress.md`：hook 会把短会话写入路径渲染到其中的“自动会话占用”区块，作为人工 lane 之外的轻量台账。
- `status.json` / `status.md`：由 `lane-coordination.cjs refresh` 生成的当前变更、共享路径和未归属路径视图。
- `checkpoints/<lane-id>.json`：某个 lane 当前可复核切片的路径、共享冲突和 patch/snapshot 索引。
- `checkpoints/<lane-id>.patch`：该 lane 涉及的 tracked 文件 diff。
- `checkpoints/<lane-id>.untracked.json`：该 lane 涉及的 untracked/ignored 文本文件快照；大文件会只记录 hash 和省略原因。

## 命令

```powershell
node .codex/hooks/lane-coordination.cjs refresh <project>
node .codex/hooks/lane-coordination.cjs summary <project>
node .codex/hooks/lane-coordination.cjs checkpoint <lane-id> <project>
node .codex/hooks/validate-hooks.cjs
```

`workflow-event.cjs` 会在 `PostToolUse` 和 `Stop` 后静默刷新 `status.json`/`status.md`。手动运行 `refresh` 用于开始一轮并行开发前重新同步事实源；完成一个可验证切片后运行 `checkpoint`，让其他 lane 能看到 tracked patch、ignored workflow 资产快照和最近 checkpoint 摘要。

## Lane 规则

多个 active plan、长任务、共享路径、脏工作区、worker-assisted、evolution 或 formal change 开始实现前必须人工登记。短会话如果来不及登记，Codex `PreToolUse` hook 会在首次写入前自动把会话和路径写入 `lanes.json`，并同步到 `.updeng/docs/in-progress.md` 的受管区块；自动登记不能替代高风险任务的人工计划，只用于防止并发会话互相看不见。

人工 lane 字段：

- `id`：稳定 lane id。
- `status`：`active`、`paused`、`integrating`、`done`。
- `threadIds` / `sessionIds`：对应 Codex thread 或 hook session。
- `plan`：计划文件路径。
- `formalChange`：可选，升级到 `.updeng/docs/changes/<id>/` 后填写。
- `branch` / `worktree`：推荐使用独立 worktree；现有脏主工作区可先填当前路径并写明例外。
- `ownedPaths`：本 lane 主要负责的文件或目录。
- `sharedPaths`：多个 lane 都可能改的热点文件。
- `syncProtocol`：继续开发前要做的同步动作。

## 同文件并行修改协议

1. 写入前读取 `lanes.json`，确认目标路径是否属于其他 active lane 或 shared path。
2. 写入前读取 `status.md`；命中共享路径时，先读对方计划、最新文件、当前 diff 和最近 checkpoint。
3. 保留对方 public API、迁移版本、command 注册、测试入口和文档状态。
4. 修改后记录验证命令和剩余风险；必要时在计划 Round Log 写“同步了哪个 lane 的哪些改动”。
5. 完成一个可验证切片后优先提交或产出 patch/checkpoint，让其他 lane 可以 rebase、merge 或人工复核。
