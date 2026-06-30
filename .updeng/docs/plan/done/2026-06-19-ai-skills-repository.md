---
id: PLAN-20260619-000001-ai-skills-repository
status: done
created_at: 2026-06-19T00:00:01+08:00
started_at: 2026-06-19T00:00:01+08:00
completed_at: 2026-06-19T21:21:25+08:00
updated_at: 2026-06-19T21:24:12+08:00
owner: ai
---
# AI Skills Repository

## 目标
- 剖析当前 Kerminal AI 助手的 Rig、rmcp/MCP、Tool Registry 和 skills 能力边界。
- 在不替换现有 Rig + rmcp 架构的前提下，补齐标准 `SKILL.md` 文件夹扫描与 catalog 能力。
- 让用户把标准 skill 文件夹放入约定目录后，Kerminal Agent 和本地 MCP manifest/resource 都能发现。

## 非目标
- 不把 skill 变成自动执行插件；工具执行仍走 Kerminal Tool Registry、确认和审计。
- 不新增外部 agent 框架依赖，不替换 Rig。
- 不实现完整外部 MCP Server 网络监听；本次只改现有本地 MCP 形状和 Agent 上下文。

## 影响范围
- Rust AI/MCP 服务：`src-tauri/src/services/ai_agent_service.rs`、`src-tauri/src/services/mcp_tool_gateway.rs`。
- Rust 模型/服务新增：标准 skill 元数据、repository 扫描、测试。
- 文档：AI 技术决策或完成能力说明。

## 执行步骤
- [x] 调研 MCP、OpenAI/Claude skills、Rig、Pydantic AI、LangChain、AgentScope 的当前做法。
- [x] 抽出 `SkillsRepository`，支持标准 `SKILL.md` frontmatter、目录扫描、去重和预算化摘要。
- [x] 接入 Agent 上下文、MCP manifest、skills resource 和 custom MCP 摘要。
- [x] 通过 `resources/templates/list` 暴露 `kerminal://agent/skills/{skillId}`，支持外部 MCP agent 按 id 读取完整 `SKILL.md` 正文。
- [x] 补充单元测试覆盖标准目录、frontmatter、多行 description、无效目录和资源输出。
- [x] 运行 `cargo fmt` 与相关 `cargo test`。

## 验证
- 通过：`cd src-tauri && cargo fmt --check`
- 通过：`cd src-tauri && cargo test --lib`
- 通过：`cd src-tauri && cargo test --test tool_registry_service`
- 通过：`cd src-tauri && cargo test --test skills_repository --test mcp_tool_gateway`
- 通过：`cd src-tauri && cargo test --test ai_agent_service`
- 通过：`cd src-tauri && cargo test --test command_suggestion_service`
- 未完整复跑：`cd src-tauri && cargo test --tests` 当前会被正在运行的 `target/debug/kerminal.exe` 占用阻断，Windows 返回 `os error 5`；本轮已用 lib 测试和相关集成测试覆盖变更面。

## 风险
- Skill 内容如果一次性全部放入 LLM 上下文会撑爆 prompt；当前 catalog 仍只给摘要，完整正文需通过 skill detail resource 按需读取。
- 自定义 skill 来自本地文件系统，内容必须视为不受信任指令；执行能力仍由 MCP 工具目录和 Kerminal 确认控制。
- 未来若要给其他 agent 直接调用，需要把当前本地 manifest/resource 再封装成真正的 MCP Server transport。


