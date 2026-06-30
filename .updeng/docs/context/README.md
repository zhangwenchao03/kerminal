# AI 上下文

这里保存给 agent 恢复工作用的上下文摘要、测试说明、架构摘要、handoff 和 context pack。它属于 docs-first 工作流，和计划、决策、验证证据一样统一维护在 `.updeng/docs/` 下。

它不是领域词汇表，也不是业务文档：

- 领域术语写 `.updeng/docs/domain/`
- 需求发现写 `.updeng/docs/discovery/`
- 稳定业务规则写 `.updeng/docs/biz/`

`project.md` 和 `testing.md` 可以人工维护简短稳定摘要；更细的索引和摘要通常由 `updeng context ...` 命令生成。
