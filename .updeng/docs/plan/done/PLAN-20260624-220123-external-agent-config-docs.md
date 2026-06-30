---
id: PLAN-20260624-220123-external-agent-config-docs
status: done
created_at: 2026-06-24T22:01:23+08:00
started_at: 2026-06-24T22:01:23+08:00
completed_at: 2026-06-24T22:26:06+08:00
updated_at: 2026-06-24T22:31:03+08:00
owner: ai
---

# 外部 Agent 配置文件编辑规则加固

## 目标

- 外部 Codex、Claude 和自定义 Agent 在 `~/.kerminal` 工作目录修改配置前，能看到配置文件用途、关联关系、字段含义、示例、禁止项和 validator 入口。
- `AGENTS.md` / `CLAUDE.md` 保持入口规则，指向本地生成的 `Kerminal-config.md`，避免只靠几条概述让 Agent 猜字段。
- 继续保持 MCP tools-only：配置文件不恢复 MCP CRUD。

## 非目标

- 不改配置文件解析模型。
- 不改 MCP tools catalog。
- 不迁移用户真实 `~/.kerminal` 数据。
- 不恢复旧内置 AI/provider/custom MCP/skills。

## 影响范围

- `AGENTS.md`、`CLAUDE.md`。
- `.updeng/docs/config/kerminal-config-files.md` 和 `.updeng/docs/config/external-agent-workspace.md`。
- `src-tauri/src/services/external_agent_workspace.rs` 生成的外部 Agent workspace 文件。
- `cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace` 覆盖生成文件断言。

## 执行步骤

- [x] 补充 AGENTS/CLAUDE 入口规则，要求 Agent 改配置前先读配置手册。
- [x] 让 ExternalAgentWorkspaceService 在 `~/.kerminal` 生成 `Kerminal-config.md`。
- [x] 补充 `Kerminal-config.md` 内容到字段/关系/示例/禁止项可直接使用的程度。
- [x] 更新外部 workspace 文档，说明入口文件和配置手册关系。
- [x] 运行格式化、相关 Rust 测试和文档残留扫描。

## 验证

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace`
- `rg "Kerminal-config.md|Before editing Kerminal configuration" AGENTS.md CLAUDE.md .updeng/docs/config src-tauri/src/services/external_agent_workspace.rs`

## 风险

- `external_agent_workspace.rs` 是 active `lane-agent-session-file-restore` shared path；本轮只追加生成配置手册和入口指引，不改 session-scoped target/MCP 逻辑。
- `AGENTS.md` / `CLAUDE.md` 是共享规则入口；本轮只加强已有 file-first 规则，不改变 Updeng 托管块。

## Round Log

- 2026-06-24T22:01:23+08:00：用户指出仅告诉 AI “改哪些文件”不够，必须说明配置文件用途、关联、字段含义、示例和禁止项。读取当前 AGENTS/CLAUDE、外部 workspace 模板、`kerminal-config-files.md`、配置操作 skill 和 active lane 状态后，建立本高风险加固计划。
- 2026-06-24T22:26:06+08:00：完成配置编辑规则加固并收口。`AGENTS.md` / `CLAUDE.md` 已要求修改 Kerminal 配置前先读配置手册；`.updeng/docs/config/kerminal-config-files.md` 增加 AI 助手操作协议、文件关系速查、字段/关联/禁止项说明；`.updeng/docs/config/external-agent-workspace.md` 增加 `Kerminal-config.md` 的入口关系和职责；`ExternalAgentWorkspaceService` 生成全局 `Kerminal-config.md`，并让全局与会话级 AGENTS/CLAUDE 指向该手册。验证：`cargo fmt --manifest-path src-tauri/Cargo.toml --check` 通过；`cargo test --manifest-path src-tauri/Cargo.toml --lib external_agent_workspace -j 1` 通过 16 个相关单测；原计划中的 `cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace` 曾尝试执行，但 Cargo 会同时编译全部 integration tests，在当前 Windows 环境因页文件/内存不足和 rustc metadata mmap 失败中止，非本切片断言失败；`rg "Kerminal-config.md|Before editing Kerminal configuration|file purposes|配置手册|AI 助手操作协议|文件关系速查" AGENTS.md CLAUDE.md .updeng/docs/config src-tauri/src/services/external_agent_workspace.rs` 通过；`git diff --check -- <本 lane 文件>` 通过。当前工作区仍有其它 lane 和未归因脏改动，本 lane 未提交。
- 2026-06-24T22:31:03+08:00：因主工作区仍有其它 active lane 和大量未归因改动，本轮不提交；已生成并行 checkpoint：`.updeng/docs/coordination/checkpoints/lane-external-agent-config-docs-hardening.json` 和 `.updeng/docs/coordination/checkpoints/lane-external-agent-config-docs-hardening.untracked.json`。checkpoint 覆盖 9 个本 lane 路径；tracked patch 数为 0，因为该 lane 主要路径当前在本工作区表现为未跟踪或忽略文档/模板路径。
