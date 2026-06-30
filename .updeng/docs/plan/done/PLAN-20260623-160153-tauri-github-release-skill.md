---
id: PLAN-20260623-160153-tauri-github-release-skill
status: done
created_at: 2026-06-23T16:01:53+08:00
started_at: 2026-06-23T16:01:53+08:00
completed_at: 2026-06-23T16:08:30+08:00
updated_at: 2026-06-23T16:08:30+08:00
owner: ai
lane_id: lane-tauri-github-release-skill
---

# Tauri GitHub 发版技能与流程优化

## 目标
- 解释并固化 GitHub Actions 发版慢、误打 tag/release、打包报错的常见原因。
- 优化 `.github/workflows/release.yml`，降低重复发版和误触发发布的概率。
- 扩充 `.codex/skills/release-publish/SKILL.md`，形成 GitHub 发版 Tauri 应用的项目技能规则。

## 非目标
- 不生成真实 release tag，不推送远端，不发布 GitHub Release。
- 不修改签名密钥、GitHub secrets、生产分发端点或 updater 公钥。
- 不覆盖当前未归因的 `src-tauri/tauri.conf.json` 图标配置改动。

## 影响范围
- `.github/workflows/release.yml`
- `.codex/skills/release-publish/SKILL.md`
- `.updeng/docs/coordination/lanes.json`
- `.updeng/docs/in-progress.md`
- `.updeng/docs/plan/INDEX.md`

## 执行步骤
- [x] 登记 lane 和计划。
- [x] 审视 release workflow 与现有 release skill。
- [x] 为 workflow 增加 tag/version preflight、重复发布并发保护和 Rust cache。
- [x] 在 release skill 增加 GitHub + Tauri 发版协议、耗时解释、误 tag 防线和失败诊断。
- [x] 运行 YAML/JSON/skill 结构校验，记录未运行真实 CI 的残余风险。

## 验证
- `node .codex/skills/bwy-project-skill-maintenance/scripts/validate_skills.js --run-tests`
- `node .codex/hooks/lane-coordination.cjs refresh C:\dev\rust\kerminal`
- YAML/JSON 解析检查。

## 风险
- CI 行为只有推送 tag 或 workflow_dispatch 后才能完全验证；本轮不触发远端发布。
- `tauri-action` 对既有 published release 和 draft release 的行为需要以真实 GitHub run 为准。

## Round Log
- 2026-06-23T16:01:53+08:00：创建计划和 lane，准备只改 release workflow 与 release skill。
- 2026-06-23T16:08:30+08:00：完成 workflow 和 skill 更新。workflow 新增 `preflight` job、按 tag checkout、同 tag 并发保护、Rust cache 和 draft release；`release-publish` skill 新增 GitHub Actions + Tauri 发布协议、慢构建解释、误 tag 防线和失败诊断顺序。验证：`validate_skills.js --run-tests` 通过，JSON 解析通过，`npx --yes js-yaml .github\workflows\release.yml` 解析通过，版本一致性检查输出 `0.1.8` 三处一致。未触发真实 GitHub Actions，不推送 tag，不发布 release。
