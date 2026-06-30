# `#[doc(hidden)] rules` 入口评估

生成时间：2026-06-25T11:35:00+08:00。

## 结论

- 已去掉 `doc(hidden)`：`file_dialog::path_model`、`command_suggestion_service::{classification, discovery}`、`port_forward_service::plan`、`port_forward_service::plan::build_forward_plan`。这些是有清晰模块名的正式运行时模型/计划入口，不应再伪装成测试缝隙。
- 暂时保留 `doc(hidden) pub mod rules`：剩余 12 个入口都只被 `src-tauri/tests/**` 调用，用来覆盖运行时纯规则、参数归一化、shell/路径安全和启动计划，不参与前端 IPC 或 Kerminal MCP public tool contract。
- 本轮不把所有 `rules` 机械改名为 public 模块：这些入口来自测试边界迁移，直接改名会扩大 Rust crate public API 面，并牵动大量集成测试 import；更合适的后续切片是按领域抽出小型 `plan` / `policy` / `parser` 模块，再逐个删除 `rules` 聚合。

## 已收敛项

| 文件 | 处理 |
| --- | --- |
| `src-tauri/src/commands/file_dialog.rs` | `path_model` 是正式路径模型模块，去掉 `doc(hidden)`。 |
| `src-tauri/src/services/command_suggestion_service.rs` | `classification` / `discovery` 是正式建议分类与发现模块，去掉 `doc(hidden)`。 |
| `src-tauri/src/services/port_forward_service.rs` | `plan` 是正式端口转发计划模块，去掉 `doc(hidden)`。 |
| `src-tauri/src/services/port_forward_service/plan.rs` | `build_forward_plan` 是正式计划构造入口，去掉 `doc(hidden)`。 |

## 保留项

| 文件 | 当前用途 | 保留理由 | 后续建议 |
| --- | --- | --- | --- |
| `src-tauri/src/commands/connection.rs` | RDP 内容、地址和保存密码规则测试 | command 函数带 Tauri/状态副作用；rules 只暴露纯规则给集成测试 | 抽 `commands/connection/rdp_plan.rs` 后删除 rules 聚合 |
| `src-tauri/src/services/diagnostics_service.rs` | Windows GPU JSON 解析测试 | 解析规则是运行时行为，但当前只需测试入口 | 抽 `diagnostics_service/gpu_parser.rs` |
| `src-tauri/src/services/docker_host_service.rs` | Docker/container 目标、传输和命令计划测试 | 运行时计划规则仍由 service 私有函数承载 | 抽 `docker_host_service/plan.rs` |
| `src-tauri/src/services/external_agent_workspace.rs` | agent 可执行名解析测试 | 只暴露无副作用解析规则，不暴露 workspace 写入实现 | 抽 `external_agent_workspace/executable_resolver.rs` |
| `src-tauri/src/services/mcp_streamable_http_server.rs` | loopback、端口扫描和 tool callable 规则测试 | MCP tools-only server 安全边界需要保留测试，但不应作为公开 API | 抽 `mcp_streamable_http_server/policy.rs` |
| `src-tauri/src/services/mcp_tool_executor_service.rs` | MCP tool 参数解析测试 | 仅覆盖真实参数解析，避免恢复旧 MCP CRUD | 抽 `mcp_tool_executor_service/arguments.rs` |
| `src-tauri/src/services/serial_terminal_service.rs` | plink serial 请求计划测试 | CLI 请求计划是运行时规则，当前 public service 只返回完整 request | 抽 `serial_terminal_service/plan.rs` |
| `src-tauri/src/services/sftp_service.rs` | SFTP 路径、冲突、ZIP、host-key、queue scope 规则测试 | 覆盖安全/路径规则，直接公开会扩大 SFTP API 面 | 按 `validation`、`transfer_io`、`transfer_registry` 拆正式模块 |
| `src-tauri/src/services/ssh_command_service.rs` | native auth、命令归一化、输出截断测试 | native SSH 运行时细节不适合作为 crate public contract | 抽 `ssh_command_service/native_plan.rs` 与 `output_limit.rs` |
| `src-tauri/src/services/ssh_terminal_service.rs` | SSH terminal launch、secret input、临时 key 清理测试 | 计划规则仍依赖 service 内部结构，当前仅测试使用 | 抽 `ssh_terminal_service/launch_plan.rs` |
| `src-tauri/src/services/telnet_terminal_service.rs` | telnet 请求计划测试 | 简单运行时请求计划，当前只为集成测试访问 | 抽 `telnet_terminal_service/plan.rs` |
| `src-tauri/src/services/terminal_manager.rs` | secret prompt 匹配规则测试 | PTY 自动输入安全规则需要直接覆盖，非外部 API | 抽 `terminal_manager/secret_input.rs` |

## 验证

- 扫描命令：`rg -n "#\\[doc\\(hidden\\)\\]|pub mod rules" src-tauri/src --glob "!**/tests/**"`。
- 当前剩余命中全部为 `pub mod rules`，无 `path_model`、`classification`、`discovery`、`port_forward_service::plan` 的 `doc(hidden)` 残留。
