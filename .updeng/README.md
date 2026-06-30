# Updeng Workspace

本目录保存项目级 Updeng 工作台。根目录只放轻量配置和状态文件；流程台账、验证证据、审计、指标、上下文和长期知识都统一放在 `docs/` 下。schemas、scripts、artifact templates 和 guard 逻辑由当前 `updeng` CLI 包提供，不复制到项目里。

- `docs/`：plan-first 工作台、lane 协调、按需 formal change、验证证据、归档、指标、审计、AI 上下文、业务事实、决策、SQL、完成能力、阻塞索引和工作流说明。
- `tmp/sdd/`：task brief、worker report、review package 和 progress ledger 的临时交接区；默认被 gitignore 忽略，可清理，不作为长期知识库。
- `docs/plan/INDEX.md`：人工计划入口，并按 `next/active/blocked/done` 分状态。
- `docs/BLOCKERS.md`：低风险默认选择、待确认点和不可逆阻塞。
- `docs/changes/<change-id>/`：高风险、强审计、发布、公共契约、迁移或长期多人协作时才使用的 formal change artifact。
