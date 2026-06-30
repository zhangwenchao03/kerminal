# Verification Evidence

本目录保存人工计划和 formal change 的验证证据入口。

## 写入规则

- 普通 plan 的验证证据可以写到 `verification/<plan-id>/`，并从 `plan/active/*.md` 或 `plan/done/*.md` 的 Evidence 区链接。
- formal change 的强审计验证仍以 `.updeng/docs/changes/<change-id>/verification.md|json` 为主；需要跨 change 汇总时再链接到这里。
- UI、桌面窗口、截图、日志、测试报告、覆盖率摘要和人工验收记录都应有路径、时间、命令或无法验证原因。
- 不保存密钥、token、生产凭据、完整 `.env` 或无法清理的大型缓存。
- `.updeng/tmp/` 里的 scratch 不是唯一验证来源；重要结论必须回填到 plan、change、review 或 reports。
