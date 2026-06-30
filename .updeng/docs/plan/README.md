# 计划文档

用于保存仍在执行或即将执行的人工计划，包括目标、非目标、影响范围、步骤、验证、风险和证据。普通持续任务默认使用 plan；只有高风险、强审计、发布、公共契约、迁移或长期多人协作才升级到 formal change。入口只看 `INDEX.md`，不要靠目录文件名猜当前状态。

## 目录

| 路径 | 用途 |
| --- | --- |
| `INDEX.md` | 人工计划总览：当前做什么、谁先谁后、哪些完成或阻塞 |
| `active/` | 正在执行的计划；默认最多 1 个，需要并行时必须登记 lane |
| `next/` | 已确认但还没开始的近期计划 |
| `blocked/` | 等人工确认、外部凭据、合规或不可逆决策的计划 |
| `done/` | 已完成、取消或被替代的计划历史；稳定结论必须另行提炼 |

## 命名和元数据

计划文件名使用可排序时间戳：

```text
PLAN-YYYYMMDD-HHMMSS-<short-slug>.md
```

文件头保留状态和时间：

```yaml
---
id: PLAN-YYYYMMDD-HHMMSS-short-slug
status: active
flow: plan
lane:
formal_change:
created_at: 2026-06-19T10:30:00+08:00
started_at: 2026-06-19T10:35:00+08:00
completed_at:
updated_at: 2026-06-19T10:35:00+08:00
owner: ai
---
```

`created_at` 表示生成顺序，`started_at` 表示实际开始顺序，`completed_at` 表示收口时间。状态变化时，移动文件到对应目录，并同步更新 `INDEX.md`。

`status` 只使用 `next`、`active`、`blocked`、`done`。取消、废弃或被替代的计划也归入 `done`，在结果摘要里写明原因。

## 生命周期

1. 新计划先放 `next/`，写入 `INDEX.md` 的“排队计划”。
2. 开始执行时移到 `active/`，更新 `status: active`、`started_at` 和 `.updeng/docs/in-progress.md`。
3. 多个 active、共享路径、长任务或脏工作区任务登记 `.updeng/docs/coordination/lanes.json`，并把 lane id 写入计划 frontmatter。
4. 遇到不可逆、合规、安全、架构、生产、凭据或外部授权问题，移到 `blocked/`，并在 `BLOCKERS.md` 建索引。
5. 执行中发现需要审批、回滚、发布、严格审计或长期多人协作时，升级为 `.updeng/docs/changes/<change-id>/`，并把路径写入 `formal_change`；不要为普通任务补建空 change。
6. 完成、取消或被替代时移到 `done/`，更新 `completed_at`，从 `in-progress.md` 移除。
7. 稳定业务事实提炼到 `biz/`，长期决策提炼到 `decisions/`，完成能力按限制写入 `completed.md`；不要把完成计划继续留在 `active/` 或 `next/`。

计划文件可以承载普通任务的逐轮 task 和 Round Log。formal change 的审计任务台账写在 `.updeng/docs/changes/<change-id>/tasks.md`；计划文件保留入口、策略和链接，不复制 CLI 生成的 change 状态。
