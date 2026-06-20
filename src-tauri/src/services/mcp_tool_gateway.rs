//! rmcp 工具网关基础服务。
//!
//! @author kongweiguang

use std::{
    collections::BTreeSet,
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use rmcp::model::{
    object, GetPromptRequestParams, GetPromptResult, ListToolsResult, PromptMessage,
    PromptMessageContent, PromptMessageRole, Tool, ToolAnnotations,
};
use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    models::{
        ai_agent::AiApplicationContextRequest,
        ai_context::AiTerminalContextSnapshot,
        ai_tool_invocation::AiToolAuditRecord,
        settings::{
            AiMcpSettings, AiSecuritySettings, CustomMcpServerSetting, CustomMcpServerToolSetting,
            CustomMcpTransportKind,
        },
        tool_registry::{
            McpAgentCapability, McpAgentProfile, McpDefinitionOrigin, McpGatewayManifest,
            McpPromptArgument, McpPromptDefinition, McpPromptMessage, McpPromptRenderRequest,
            McpPromptRenderResult, McpResourceDefinition, McpResourceReadRequest,
            McpResourceReadResult, McpSecurityPolicy, McpServerInfo, McpSkillDefinition,
            McpToolAnnotations, McpToolDefinition, McpToolList, McpTransportDefinition,
            McpTransportStatus, ToolCategory, ToolConfirmationPolicy, ToolDefinition,
            ToolRiskLevel,
        },
    },
    services::skills_repository::{
        expand_user_path, skill_instructions_from_markdown, SkillCatalog, SkillsRepository,
    },
};

/// Agent profile resource URI。
pub const AGENT_PROFILE_RESOURCE_URI: &str = "kerminal://agent/profile";
/// Agent skills catalog resource URI。
pub const AGENT_SKILLS_RESOURCE_URI: &str = "kerminal://agent/skills";
/// 单个用户自定义 Agent Skill 详情 resource URI 前缀。
pub const AGENT_SKILL_DETAIL_RESOURCE_URI_PREFIX: &str = "kerminal://agent/skills/";
/// 单个用户自定义 Agent Skill 详情 resource URI template。
pub const AGENT_SKILL_DETAIL_RESOURCE_URI_TEMPLATE: &str = "kerminal://agent/skills/{skillId}";
/// Agent system prompt resource URI。
pub const AGENT_SYSTEM_PROMPT_RESOURCE_URI: &str = "kerminal://agent/system-prompt";
/// 当前应用工作台上下文 resource URI。
pub const APPLICATION_CONTEXT_RESOURCE_URI: &str = "kerminal://application/context/current";
/// 工具目录 resource URI。
pub const TOOL_REGISTRY_RESOURCE_URI: &str = "kerminal://tool-registry";
/// 当前终端上下文 resource URI。
pub const TERMINAL_CONTEXT_RESOURCE_URI: &str = "kerminal://terminal-context/current";
/// AI 工具审计摘要 resource URI。
pub const AI_AUDIT_SUMMARY_RESOURCE_URI: &str = "kerminal://ai/audit-summary";
/// AI 安全策略 resource URI。
pub const AI_POLICY_RESOURCE_URI: &str = "kerminal://settings/ai-policy";
/// 用户自定义 MCP 扩展 resource URI。
pub const CUSTOM_MCP_RESOURCE_URI: &str = "kerminal://settings/custom-mcp";

const MAX_SKILL_DETAIL_INSTRUCTION_CHARS: usize = 80_000;

mod agent_catalog;
mod prompt_catalog;
mod resource_catalog;
mod tool_views;
mod transport_catalog;

pub use self::{
    agent_catalog::{agent_profile, agent_skills, agent_skills_with_custom, agent_system_prompt},
    tool_views::{custom_mcp_tool_definitions, custom_mcp_tool_id, tool_definition_to_rmcp_tool},
};

use self::{
    agent_catalog::{custom_skill_catalog, server_info},
    prompt_catalog::{
        prompt_by_name, prompts, render_agent_route_prompt, render_remote_safe_ops_prompt,
        render_terminal_explain_prompt, render_terminal_suggest_prompt, to_prompt_message_view,
        validate_prompt_arguments,
    },
    resource_catalog::{
        agent_profile_resource, agent_skill_detail_id, agent_skill_detail_resource,
        agent_skill_detail_resource_definition, agent_skills_resource,
        agent_system_prompt_resource, ai_policy_resource, application_context_resource,
        audit_summary_resource, custom_mcp_resource, resource_by_uri, resources,
        terminal_context_resource,
    },
    tool_views::{custom_tool_id, custom_tool_view, enabled_mcp_tools, to_mcp_view},
    transport_catalog::{
        confirmation_policy_label, custom_transport_kind, origin_label, risk_level_label,
        security_policy, transports_with_custom, unix_timestamp,
    },
};

/// 把 Kerminal Tool Registry 映射为 rmcp/MCP 工具描述。
#[derive(Debug, Default)]
pub struct McpToolGateway;

/// MCP resource 读取时由 Command 层注入的运行时数据。
#[derive(Debug, Clone, Default)]
pub struct McpResourceReadRuntime {
    /// 当前应用工作台上下文。
    pub application_context: Option<AiApplicationContextRequest>,
    /// 当前终端上下文快照。
    pub terminal_context: Option<AiTerminalContextSnapshot>,
    /// 终端上下文不可用时的用户可读原因。
    pub terminal_context_error: Option<String>,
    /// 最近 AI 工具调用审计。
    pub audit_records: Vec<AiToolAuditRecord>,
    /// 当前 AI 安全策略。
    pub ai_policy: Option<AiSecuritySettings>,
    /// 用户自定义 MCP 扩展。
    pub custom_mcp: AiMcpSettings,
}

/// MCP prompt 渲染时由 Command 层注入的运行时数据。
#[derive(Debug, Clone, Default)]
pub struct McpPromptRenderRuntime {
    /// 当前应用工作台上下文。
    pub application_context: Option<AiApplicationContextRequest>,
    /// 当前终端上下文快照。
    pub terminal_context: Option<AiTerminalContextSnapshot>,
    /// 终端上下文不可用时的用户可读原因。
    pub terminal_context_error: Option<String>,
    /// 用户自定义 MCP 扩展。
    pub custom_mcp: AiMcpSettings,
}

impl McpToolGateway {
    /// 创建 rmcp 工具网关。
    pub fn new() -> Self {
        Self
    }

    /// 返回前端和后续 AI 面板可读的 MCP-compatible 工具列表。
    pub fn list_tools(&self, definitions: &[ToolDefinition]) -> McpToolList {
        let exposed = enabled_mcp_tools(definitions);
        let rmcp_result = ListToolsResult::with_all_items(
            exposed
                .iter()
                .map(tool_definition_to_rmcp_tool)
                .collect::<Vec<_>>(),
        );
        let tools = rmcp_result
            .tools
            .iter()
            .zip(exposed.iter())
            .map(|(tool, definition)| to_mcp_view(tool, definition))
            .collect();

        McpToolList {
            protocol: "mcp-tools/list".to_string(),
            tools,
        }
    }

    /// 返回合并内置工具和用户 MCP Server 已发现工具的列表。
    pub fn list_tools_with_custom(
        &self,
        definitions: &[ToolDefinition],
        custom_mcp: &AiMcpSettings,
    ) -> McpToolList {
        let mut list = self.list_tools(definitions);
        for server in custom_mcp.servers.iter().filter(|server| server.enabled) {
            list.tools.extend(
                server
                    .tools
                    .iter()
                    .filter_map(|tool| custom_tool_view(server, tool)),
            );
        }
        list
    }

    /// 返回 Kerminal 本地 MCP 清单。
    pub fn manifest(
        &self,
        definitions: &[ToolDefinition],
        custom_mcp: &AiMcpSettings,
    ) -> McpGatewayManifest {
        McpGatewayManifest {
            protocol: "kerminal-mcp/manifest".to_owned(),
            generated_at: unix_timestamp(),
            server: server_info(),
            agent: agent_profile(),
            tools: self.list_tools_with_custom(definitions, custom_mcp),
            skills: agent_skills_with_custom(custom_mcp),
            resources: resources(),
            prompts: prompts(),
            transports: transports_with_custom(custom_mcp),
            security: security_policy(),
        }
    }

    /// 读取本地 MCP resource 内容。
    pub fn read_resource(
        &self,
        definitions: &[ToolDefinition],
        request: McpResourceReadRequest,
        runtime: McpResourceReadRuntime,
    ) -> AppResult<McpResourceReadResult> {
        let uri = request.uri.trim();
        if uri.is_empty() {
            return Err(AppError::InvalidInput(
                "MCP resource URI 不能为空".to_owned(),
            ));
        }

        let (resource, content) = if let Some(skill_id) = agent_skill_detail_id(uri) {
            (
                agent_skill_detail_resource_definition(skill_id),
                agent_skill_detail_resource(skill_id, &runtime.custom_mcp)?,
            )
        } else {
            let resource = resource_by_uri(uri)
                .ok_or_else(|| AppError::NotFound(format!("未知 MCP resource: {uri}")))?;
            let content = match uri {
                AGENT_PROFILE_RESOURCE_URI => agent_profile_resource(),
                AGENT_SKILLS_RESOURCE_URI => {
                    agent_skills_resource(definitions, &runtime.custom_mcp, self)
                }
                AGENT_SYSTEM_PROMPT_RESOURCE_URI => agent_system_prompt_resource(),
                APPLICATION_CONTEXT_RESOURCE_URI => application_context_resource(runtime),
                TOOL_REGISTRY_RESOURCE_URI => {
                    self.tool_registry_resource(definitions, &runtime.custom_mcp)
                }
                TERMINAL_CONTEXT_RESOURCE_URI => terminal_context_resource(runtime),
                AI_AUDIT_SUMMARY_RESOURCE_URI => {
                    audit_summary_resource(runtime, request.audit_limit)
                }
                AI_POLICY_RESOURCE_URI => ai_policy_resource(runtime),
                CUSTOM_MCP_RESOURCE_URI => custom_mcp_resource(runtime),
                _ => unreachable!("resource_by_uri only returns allowlisted MCP resources"),
            };
            (resource, content)
        };

        Ok(McpResourceReadResult {
            uri: resource.uri,
            name: resource.name,
            title: resource.title,
            mime_type: resource.mime_type,
            generated_at: unix_timestamp(),
            content,
        })
    }

    fn tool_registry_resource(
        &self,
        definitions: &[ToolDefinition],
        custom_mcp: &AiMcpSettings,
    ) -> Value {
        let tools = self.list_tools_with_custom(definitions, custom_mcp);
        json!({
            "protocol": "kerminal-mcp/resource/tool-registry",
            "toolCount": tools.tools.len(),
            "tools": tools.tools,
        })
    }

    /// 渲染 Kerminal 本地 MCP prompt，不调用 LLM，也不执行工具。
    pub fn render_prompt(
        &self,
        request: McpPromptRenderRequest,
        runtime: McpPromptRenderRuntime,
    ) -> AppResult<McpPromptRenderResult> {
        let name = request.name.trim();
        if name.is_empty() {
            return Err(AppError::InvalidInput(
                "MCP prompt name 不能为空".to_owned(),
            ));
        }

        let rmcp_request =
            GetPromptRequestParams::new(name.to_owned()).with_arguments(request.arguments);
        let prompt = prompt_by_name(&rmcp_request.name)
            .ok_or_else(|| AppError::NotFound(format!("未知 MCP prompt: {name}")))?;
        let arguments = rmcp_request.arguments.unwrap_or_default();
        validate_prompt_arguments(&prompt, &arguments)?;

        let rmcp_result = match prompt.name.as_str() {
            "kerminal.agent.route" => render_agent_route_prompt(&arguments, &runtime),
            "kerminal.terminal.explain" => render_terminal_explain_prompt(&arguments, &runtime),
            "kerminal.terminal.suggest" => render_terminal_suggest_prompt(&arguments, &runtime),
            "kerminal.remote.safe_ops" => render_remote_safe_ops_prompt(&arguments, &runtime),
            _ => unreachable!("prompt_by_name only returns allowlisted MCP prompts"),
        };
        let description = rmcp_result
            .description
            .clone()
            .unwrap_or_else(|| prompt.description.clone());

        Ok(McpPromptRenderResult {
            protocol: "kerminal-mcp/prompts/get".to_owned(),
            name: prompt.name,
            title: prompt.title,
            description,
            generated_at: unix_timestamp(),
            arguments: Value::Object(arguments),
            messages: rmcp_result
                .messages
                .into_iter()
                .map(to_prompt_message_view)
                .collect(),
        })
    }
}
