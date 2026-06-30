---
id: PLAN-20260624-223554-external-agent-workspace-operation-guide
status: done
created_at: 2026-06-24T22:35:54+08:00
started_at: 2026-06-24T22:35:54+08:00
completed_at: 2026-06-24T22:45:59+08:00
updated_at: 2026-06-24T22:45:59+08:00
owner: ai
---

# 外部 Agent 工作空间操作指南纠偏

## 目标

- 修正上一轮偏差：不是仓库根 `AGENTS.md`，而是 Kerminal 生成给外部 AI 打开的 `~/.kerminal/AGENTS.md` 和会话目录 `AGENTS.md`。
- 让外部 AI 打开 Kerminal 工作空间后知道这是 Kerminal runtime workspace，不是普通源码仓库。
- 让 AI 明确什么时候用 Kerminal MCP 操作 live app 能力，什么时候直接改文件。
- 让 AI 能按规则操作终端、SSH/SFTP、容器、端口转发、服务器信息、命令历史和诊断等 Kerminal 功能。

## 非目标

- 不恢复旧内置 AI/provider/custom MCP/skills。
- 不增加配置 CRUD tools。
- 不改 MCP catalog 或 runtime tool 实现。
- 不修改用户真实 `~/.kerminal` 数据。

## 影响范围

- `src-tauri/src/services/external_agent_workspace.rs` 生成的全局与会话级 Agent 指令模板。
- `.updeng/docs/config/external-agent-workspace.md` 的生成文件说明。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace -j 1` 覆盖生成模板断言。

## 执行步骤

- [x] 明确生成 `~/.kerminal/AGENTS.md` 的职责：操作 Kerminal runtime workspace。
- [x] 补充全局 Agent 工作目录的 Kerminal 功能操作协议。
- [x] 补充会话级 Agent 指令里的 session-scoped target 操作协议。
- [x] 更新相关测试和文档，避免再次只覆盖配置文件规则。
- [x] 运行格式化、相关 Rust 测试、残留扫描和 diff-check。

## 验证

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace -j 1`
- `rg "Kerminal runtime workspace|Operate Kerminal through MCP|session-scoped target|terminal.write|kerminal.agent.target_context" src-tauri/src/services/external_agent_workspace.rs .updeng/docs/config/external-agent-workspace.md`
- `git diff --check -- src-tauri/src/services/external_agent_workspace.rs .updeng/docs/config/external-agent-workspace.md .updeng/docs/plan/active/PLAN-20260624-223554-external-agent-workspace-operation-guide.md .updeng/docs/plan/INDEX.md .updeng/docs/in-progress.md .updeng/docs/coordination/lanes.json`

## 风险

- `src-tauri/src/services/external_agent_workspace.rs` 是 `lane-agent-session-file-restore` shared path；本轮只修改生成说明和相邻断言，不改 agent session runtime 逻辑。
- 当前工作区大量未提交改动；本轮不提交，完成后生成 checkpoint 或在 Round Log 说明未提交原因。

## Round Log

- 2026-06-24T22:35:54+08:00：用户纠正上一轮目标：重点不是当前项目根 `AGENTS.md`，而是 AI 助手打开 Kerminal 工作空间时读取的生成 `AGENTS.md`，需要让 AI 能在 Kerminal 里操作功能。读取当前 active lane、外部 workspace 生成代码和文档后建立本计划。
- 2026-06-24T22:45:59+08:00：补强 `src-tauri/src/services/external_agent_workspace.rs` 生成的全局 `~/.kerminal/AGENTS.md`、`CLAUDE.md`、会话级 `AGENTS.md` 和 `CLAUDE.md`：明确这是 Kerminal runtime workspace，AI 应通过 MCP 操作 terminal、SSH/SFTP、container、port forward、server info、history 和 diagnostics；MCP host 负责 confirmation/approval/hooks/audit；会话写 `terminal.write` 前必须用 `kerminal.agent.target_context` / `terminal.resolve_agent_target` 获取 live target 和 `bindingGeneration`，stale/closed/missing/generation mismatch 时要求用户在 Kerminal rebind。同步更新 `.updeng/docs/config/external-agent-workspace.md`，并补测试断言锁住这些生成规则。验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace -j 1` 16 passed；目标 `rg` 扫描通过；`git diff --check` 通过。当前工作区仍有大量未归因/并行改动，本轮不提交。
