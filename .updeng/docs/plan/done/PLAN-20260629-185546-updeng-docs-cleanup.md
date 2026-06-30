---
id: PLAN-20260629-185546-updeng-docs-cleanup
status: done
created_at: 2026-06-29T18:55:46+08:00
started_at: 2026-06-29T18:55:46+08:00
completed_at: 2026-06-29T19:06:00+08:00
updated_at: 2026-06-29T19:06:00+08:00
owner: ai
---

# Updeng 文档清理整理

## 目标
- 清理 `.updeng/docs` 中过期、已完成、无效或状态不一致的文档记录。
- 保持当前仍有效的 active、blocked、next 入口可见。
- 用归档、移动和索引更新代替不可逆批量删除。

## 非目标
- 不修改业务代码、运行时配置或用户本机 `~/.kerminal` 数据。
- 不删除大量历史验证图片或审计数据；只标注归档口径或移动明显错误状态的计划。
- 不改变 Updeng skill/hook 规则。

## 影响范围
- `.updeng/docs/plan/INDEX.md`
- `.updeng/docs/in-progress.md`
- `.updeng/docs/BLOCKERS.md`
- `.updeng/docs/coordination/lanes.json`
- `.updeng/docs/coordination/status.md`
- `.updeng/docs/plan/{active,next,blocked,done}/`
- `.updeng/docs/reports/`

## 执行步骤
- [x] 登记本轮 lane，避免与其它会话静默冲突。
- [x] 盘点 active/next/blocked/done、changes/specs/archive 和根目录入口。
- [x] 将已完成或不应继续作为当前事项的文档移到正确目录或更新索引。
- [x] 补一份清理报告，记录本轮没有物理删除哪些历史资料及原因。
- [x] 运行文档结构和 git 状态检查。

## 验证
- `node .codex/hooks/lane-coordination.cjs refresh C:\dev\rust\kerminal`
- `git status --short -- .updeng/docs`
- 人工核对 `plan/INDEX.md`、`in-progress.md`、`BLOCKERS.md` 和 `lanes.json` 一致。

## 风险
- 当前工作区已有大量未归因改动；本轮只触碰 `.updeng/docs` 内文件，避免混入其它 lane。
- 不做批量删除，避免误删历史验证、审计和长期证据。

## Round Log

### 2026-06-29T18:55:46+08:00
- 创建本轮计划并准备登记 lane。

### 2026-06-29T19:06:00+08:00
- 完成整理：TUI rail 修复和 SSH vault 计划移到 `done/`，Agent terminal 真实 CLI HITL 移到 `blocked/`，无效 auto claim 和空顶层 `specs/.gitkeep` 已清理。
- 更新 `plan/INDEX.md`、`in-progress.md`、`BLOCKERS.md`、`completed.md`、`coordination/lanes.json` 和清理报告。
- 验证通过：Markdown 链接/lanes 计划存在性检查无问题；`npm run test -- --run src/features/terminal/terminalCommandBlocks.test.ts` 通过；`npm run build` 通过。
- 未删除历史截图、metrics、audit、context、checkpoint 或 legacy archive 证据。
