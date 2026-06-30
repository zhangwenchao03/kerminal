---
id: PLAN-20260625-231115-external-agent-prompt-config-redesign
status: done
created_at: 2026-06-25T23:11:15+08:00
started_at: 2026-06-25T23:11:15+08:00
completed_at: 2026-06-26T00:16:42+08:00
updated_at: 2026-06-26T00:16:42+08:00
owner: ai
lane: lane-external-agent-prompt-config-redesign
---

# 外部 Agent Prompt 与配置手册重设计

## 目标
- 调研 Codex、Claude Code、Cursor、GitHub Copilot、MCP 等外部 agent 指令/配置文件实践，形成可追溯的研究文档。
- 重新设计 Kerminal 外部 Agent workspace 的提示词分层：全局 `AGENTS.md`、会话级 `AGENTS.md` / `CLAUDE.md`、`kerminal-config.md` 详细手册、validator 的职责边界。
- 让 `kerminal-config.md` 足够详细，Agent 可以按手册正确新增/修改主机、profile、snippet、workflow，并明确何时用 MCP、何时直接改文件。
- 补强 validator，使“文档要求”和“运行时代码必填字段”一致，避免 validator 通过但 Kerminal 加载失败。

## 非目标
- 不重新引入 settings/profile/host/snippet/workflow 的 MCP CRUD。
- 不修改用户 `~/.kerminal` 中的真实凭据或 `secrets/`。
- 不改 Docker、终端布局、tmux、SFTP 等与本任务无关的并行 lane 文件。

## 影响范围
- `.updeng/docs/reports/`：外部实践调研文档。
- `.updeng/docs/decisions/`：长期流程/架构取舍 ADR。
- `.updeng/docs/config/external-agent-workspace.md`、`.updeng/docs/config/kerminal-config-files.md`：设计文档和配置手册源。
- `src-tauri/src/services/external_agent_workspace.rs`：生成的 `AGENTS.md`、`CLAUDE.md`、`kerminal-config.md` 模板。
- `.codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs`：配置 validator。
- `src-tauri/src/services/mcp_tool_executor_service/config_tools.rs`：运行时 MCP 只读 validator，作为外部 Agent 默认校验入口。
- `src-tauri/tests/mcp_streamable_http_server.rs`：通过真实 MCP `tools/call` 断言缺 `production` 的 host 会被 validator 拦住。
- `src-tauri/tests/external_agent_workspace.rs` 和相关 validator 自测：验证生成内容与配置规则。

## 执行步骤
- [x] 读取当前外部 agent workspace 生成逻辑、配置文档、validator 和测试。
- [x] 调研外部 agent 指令文件/配置文件最佳实践并记录来源。
- [x] 写入详细研究报告，提炼 Kerminal 设计原则。
- [x] 写入 ADR 或设计决策，明确分层和回滚策略。
- [x] 更新生成模板和配置手册源，确保 session 入口规则自包含且 `kerminal-config.md` 详细。
- [x] 更新 validator 覆盖运行时必填字段和关键引用关系。
- [x] 运行相关测试和 validator，自检生成内容。

## 验证
- `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --self-test`
- 针对 `external_agent_workspace` 的 Rust 测试。
- 必要时运行 `cargo test --manifest-path src-tauri/Cargo.toml external_agent_workspace config_file_store`
- 文档人工检查：研究报告有外部来源链接，`kerminal-config.md` 字段规则覆盖 host 缺 `production` 这类失败。

## 风险
- 当前工作区已有大量未归因改动；本 lane 只改 owned paths，避免格式化或覆盖他人热点文件。
- 外部来源可能变化；研究文档记录访问日期和链接，最终决策以 Kerminal 本地运行约束为准。
- validator 补强可能暴露现有 `~/.kerminal` 示例配置不完整；需要把错误信息写清楚，避免误判为应用启动失败。

## Round Log

### 2026-06-25T23:11:15+08:00
- 建立计划，目标是先调研再改 prompts/config/validator。
- 当前工作区非常脏；本 lane 声明只触碰外部 Agent workspace 和配置文件验证相关路径。

### 2026-06-25T23:22:00+08:00
- 按用户要求将生成的配置手册文件名统一为 `kerminal-config.md`，覆盖生成服务、测试常量、入口说明和当前设计文档。

### 2026-06-25T23:45:00+08:00
- 写入外部 Agent 指令/配置实践调研报告和 ADR-0019，决策采用短入口、详细 `kerminal-config.md`、validator 硬门禁的三层结构。
- 同步读取 `lane-agent-launch-pwsh` 计划：该 lane 已新增 MCP 只读工具 `kerminal.config.validate` 并把 Node validator 从运行时提示中移除；本 lane 后续只补严格 schema/手册部分，避免回退它的分发用户路径口径。
- `src-tauri/src/services/mcp_tool_executor_service/config_tools.rs` 是 `lane-agent-launch-pwsh` owned path；本 lane 需要最小兼容修改其 host explicit field 校验，并在 Round Log 记录同步原因。

### 2026-06-26T00:16:42+08:00
- 按用户要求确认生成文件名统一为小写 `kerminal-config.md`；当前入口说明、生成模板、测试和正向文档没有旧大写文件名残留。
- `kerminal.config.validate` 对 Agent-authored `hosts/*.toml` 缺少 `production` 改为 error；运行时旧文件兼容仍由 `config_file_store` 测试确认缺省加载为 `false`。
- 更新 `.updeng/docs/config/kerminal-config-files.md`、ADR-0019 和调研报告，明确运行态默认 validator 是 MCP `kerminal.config.validate`，Node 脚本只用于源码维护和 self-test。
- 修正 `.updeng/docs/coordination/lanes.json` 中本 lane 的重复 `sharedPaths` 键。
- 验证通过：
  - `node .codex/skills/bwy-kerminal-config-files/scripts/validate-kerminal-config.mjs --self-test`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - `git diff --check -- <本 lane 相关文件>`
  - `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-external-agent-prompt-config --test external_agent_workspace -j 1`
  - `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-external-agent-prompt-config --test mcp_streamable_http_server generated_codex_and_claude_configs_connect_to_tools_list -j 1`
  - `cargo test --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target-codex-external-agent-prompt-config --test config_file_store remote_host_toml_defaults_missing_production_to_false -j 1`
- 对当前用户配置只读运行脚本 validator，发现 `C:\Users\24052\.kerminal\hosts\bwy-172.16.41.60.toml` 缺少布尔 `production`，以及 `workflows/` 目录不存在 warning；本计划不修改用户真实 `~/.kerminal` 配置。
