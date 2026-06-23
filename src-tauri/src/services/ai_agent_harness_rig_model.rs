//! Rig-backed model adapter for the minimal AI Agent harness loop.
//!
//! @author kongweiguang

use std::{future::Future, pin::Pin};

use rig_core::{
    agent::{Agent, PromptHook},
    client::CompletionClient,
    completion::{message::Message, CompletionModel, Prompt},
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    models::{
        ai_agent_run::{
            AiAgentHarnessDecision, AiAgentHarnessModelInput, AiAgentHarnessModelOutput,
            AiAgentHarnessToolCall,
        },
        llm_provider::{LlmProvider, LlmProviderKind},
        tool_registry::ToolDefinition,
    },
    services::{
        ai_agent_run_service::AiAgentHarnessModel,
        rig_provider_service::{
            build_anthropic_client, build_openai_chat_client, build_openai_responses_client,
        },
    },
};

const HARNESS_MAX_TOKENS: u64 = 2048;
const HARNESS_MAX_TURNS: usize = 1;
const MAX_PROMPT_TOOLS: usize = 80;
const MAX_STEP_SUMMARY_CHARS: usize = 900;
const HARNESS_PREAMBLE: &str = r#"你是 Kerminal 的极简 harness agent 决策模型。
你不能声称已经执行工具。你只能基于目标和已有 observation 做下一步决策。
每次只输出一个 JSON object，不要 Markdown，不要解释，不要包裹代码块。
输出 schema:
{"summary":"简短中文摘要","decision":{"kind":"toolCall","call":{"toolId":"terminal.list","arguments":{},"reason":"为什么调用"}}}
{"summary":"简短中文摘要","decision":{"kind":"final","message":"最终给用户的中文回复"}}
{"summary":"简短中文摘要","decision":{"kind":"blocked","reason":"无法继续的具体原因"}}
如果 goal 要求创建、添加、更新、移动、连接、打开、执行、写入、保存、上传、下载或删除，必须先选择合适工具并等待 succeeded observation；没有 succeeded observation 时不能 final 宣称完成。
如果缺少 id 或参数，优先调用只读 list/resolve 类工具获取，不要要求用户手工粘贴工具返回。"#;

/// Rig-backed harness model. Tool execution remains owned by Kerminal.
#[derive(Debug, Clone)]
pub struct RigHarnessModel {
    provider: LlmProvider,
    api_key: String,
    tools: Vec<ToolDefinition>,
}

impl RigHarnessModel {
    pub fn new(provider: LlmProvider, api_key: String, tools: Vec<ToolDefinition>) -> Self {
        Self {
            provider,
            api_key,
            tools,
        }
    }
}

impl AiAgentHarnessModel for RigHarnessModel {
    fn next_turn<'a>(
        &'a self,
        input: AiAgentHarnessModelInput,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiAgentHarnessModelOutput>> + Send + 'a>> {
        Box::pin(async move {
            let prompt = build_harness_prompt(&input, &self.tools)?;
            let response = match self.provider.kind {
                LlmProviderKind::OpenAiResponses => {
                    let client = build_openai_responses_client(&self.provider, &self.api_key)?;
                    let agent = client
                        .agent(self.provider.model.clone())
                        .preamble(HARNESS_PREAMBLE)
                        .temperature(self.provider.temperature)
                        .max_tokens(HARNESS_MAX_TOKENS)
                        .build();
                    prompt_text_with_retries(agent, prompt, self.provider.max_retries).await?
                }
                LlmProviderKind::OpenAiChat => {
                    let client = build_openai_chat_client(&self.provider, &self.api_key)?;
                    let agent = client
                        .agent(self.provider.model.clone())
                        .preamble(HARNESS_PREAMBLE)
                        .temperature(self.provider.temperature)
                        .max_tokens(HARNESS_MAX_TOKENS)
                        .build();
                    prompt_text_with_retries(agent, prompt, self.provider.max_retries).await?
                }
                LlmProviderKind::Anthropic => {
                    let client = build_anthropic_client(&self.provider, &self.api_key)?;
                    let agent = client
                        .agent(self.provider.model.clone())
                        .preamble(HARNESS_PREAMBLE)
                        .temperature(self.provider.temperature)
                        .max_tokens(HARNESS_MAX_TOKENS)
                        .build();
                    prompt_text_with_retries(agent, prompt, self.provider.max_retries).await?
                }
            };
            parse_harness_model_output(&response)
        })
    }
}

async fn prompt_text_with_retries<M, P>(
    agent: Agent<M, P>,
    prompt: String,
    max_retries: u8,
) -> AppResult<String>
where
    M: CompletionModel + 'static,
    P: PromptHook<M> + 'static,
{
    let max_attempts = usize::from(max_retries) + 1;
    let mut last_error = None;
    let message: Message = prompt.into();
    for _attempt in 0..max_attempts {
        match agent
            .prompt(message.clone())
            .max_turns(HARNESS_MAX_TURNS)
            .await
        {
            Ok(text) => return Ok(text),
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    Err(AppError::AiAgent(format!(
        "Agent harness 模型调用失败: {}",
        last_error.unwrap_or_else(|| "未知错误".to_owned())
    )))
}

pub(crate) fn parse_harness_model_output(text: &str) -> AppResult<AiAgentHarnessModelOutput> {
    let json_text = extract_json_object(text)?;
    let value: Value = serde_json::from_str(&json_text).map_err(|error| {
        AppError::AiAgent(format!("无法解析 Agent harness 模型 JSON 输出: {error}"))
    })?;
    parse_harness_value(value)
}

fn parse_harness_value(value: Value) -> AppResult<AiAgentHarnessModelOutput> {
    if value.get("decision").is_some() {
        return serde_json::from_value(value).map_err(|error| {
            AppError::AiAgent(format!("Agent harness 模型输出不符合协议: {error}"))
        });
    }

    let raw: TopLevelDecision = serde_json::from_value(value)
        .map_err(|error| AppError::AiAgent(format!("Agent harness 模型输出不符合协议: {error}")))?;
    let kind = raw.kind.trim();
    let decision = match kind {
        "toolCall" | "tool_call" => AiAgentHarnessDecision::ToolCall {
            call: raw.call.ok_or_else(|| {
                AppError::AiAgent("Agent harness toolCall 缺少 call 字段".to_owned())
            })?,
        },
        "final" => AiAgentHarnessDecision::Final {
            message: raw
                .message
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::AiAgent("Agent harness final 缺少 message 字段".to_owned())
                })?,
        },
        "blocked" => AiAgentHarnessDecision::Blocked {
            reason: raw
                .reason
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::AiAgent("Agent harness blocked 缺少 reason 字段".to_owned())
                })?,
        },
        other => {
            return Err(AppError::AiAgent(format!(
                "Agent harness 模型输出了未知 decision kind: {other}"
            )))
        }
    };
    Ok(AiAgentHarnessModelOutput {
        summary: raw.summary,
        decision,
    })
}

fn extract_json_object(text: &str) -> AppResult<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(AppError::AiAgent("Agent harness 模型输出为空".to_owned()));
    }

    let without_fence = if trimmed.starts_with("```") {
        trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```JSON")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        trimmed
    };

    if without_fence.starts_with('{') && without_fence.ends_with('}') {
        return Ok(without_fence.to_owned());
    }

    let start = without_fence.find('{').ok_or_else(|| {
        AppError::AiAgent("Agent harness 模型输出中找不到 JSON object".to_owned())
    })?;
    let end = without_fence.rfind('}').ok_or_else(|| {
        AppError::AiAgent("Agent harness 模型输出中找不到 JSON object 结束符".to_owned())
    })?;
    if start >= end {
        return Err(AppError::AiAgent(
            "Agent harness 模型输出 JSON object 边界无效".to_owned(),
        ));
    }
    Ok(without_fence[start..=end].to_owned())
}

fn build_harness_prompt(
    input: &AiAgentHarnessModelInput,
    tools: &[ToolDefinition],
) -> AppResult<String> {
    let tool_catalog = tools
        .iter()
        .filter(|tool| tool.enabled && tool.exposed_to_mcp)
        .take(MAX_PROMPT_TOOLS)
        .map(tool_prompt_entry)
        .collect::<AppResult<Vec<_>>>()?;
    let steps = input
        .steps
        .iter()
        .map(|step| {
            json!({
                "kind": step.kind,
                "status": step.status,
                "toolId": step.tool_id,
                "summary": step.summary.as_ref().map(|value| truncate(value, MAX_STEP_SUMMARY_CHARS)),
                "observation": summarize_step_observation(step.observation_json.as_ref()),
            })
        })
        .collect::<Vec<_>>();

    serde_json::to_string_pretty(&json!({
        "instruction": "根据 goal、availableTools 和 priorSteps 决定下一步。只返回一个符合 system schema 的 JSON object。带副作用的目标必须调用工具并等待 succeeded observation 后才能 final 宣称完成。",
        "runId": input.run_id,
        "goal": input.goal,
        "resolvedTargets": input.resolved_targets,
        "availableTools": tool_catalog,
        "priorSteps": steps,
    }))
    .map_err(AppError::from)
}

fn tool_prompt_entry(tool: &ToolDefinition) -> AppResult<Value> {
    Ok(json!({
        "toolId": tool.id,
        "title": tool.title,
        "description": tool.description,
        "category": tool.category,
        "risk": tool.risk,
        "confirmation": tool.confirmation,
        "inputSchema": tool.input_schema,
    }))
}

fn summarize_step_observation(value: Option<&Value>) -> Option<Value> {
    let value = value?;
    Some(match value {
        Value::Object(object) => {
            let mut summary = serde_json::Map::new();
            for key in [
                "status",
                "summary",
                "data",
                "entities",
                "recoverable",
                "errorKind",
                "nextHints",
                "pendingInvocationId",
                "auditId",
            ] {
                if let Some(item) = object.get(key) {
                    summary.insert(key.to_owned(), item.clone());
                }
            }
            Value::Object(summary)
        }
        other => other.clone(),
    })
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_owned();
    }
    value.chars().take(max_chars).collect::<String>()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TopLevelDecision {
    #[serde(default)]
    summary: Option<String>,
    kind: String,
    #[serde(default)]
    call: Option<AiAgentHarnessToolCall>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ai_agent_run::AiAgentRunStepKind;

    #[test]
    fn parses_protocol_decision_json() {
        let output = parse_harness_model_output(
            r#"{"summary":"先看终端","decision":{"kind":"toolCall","call":{"toolId":"terminal.list","arguments":{},"reason":"确认会话"}}}"#,
        )
        .expect("parse output");

        assert_eq!(output.summary.as_deref(), Some("先看终端"));
        match output.decision {
            AiAgentHarnessDecision::ToolCall { call } => {
                assert_eq!(call.tool_id, "terminal.list");
                assert_eq!(call.reason.as_deref(), Some("确认会话"));
            }
            other => panic!("unexpected decision: {other:?}"),
        }
    }

    #[test]
    fn parses_fenced_top_level_final_json() {
        let output = parse_harness_model_output(
            "```json\n{\"kind\":\"final\",\"message\":\"已经完成\",\"summary\":\"结束\"}\n```",
        )
        .expect("parse output");

        assert_eq!(output.summary.as_deref(), Some("结束"));
        assert_eq!(
            output.decision,
            AiAgentHarnessDecision::Final {
                message: "已经完成".to_owned()
            }
        );
    }

    #[test]
    fn rejects_invalid_json() {
        let error = parse_harness_model_output("不是 JSON").expect_err("parse should fail");

        assert!(error
            .to_string()
            .contains("Agent harness 模型输出中找不到 JSON object"));
    }

    #[test]
    fn rejects_unknown_kind() {
        let error =
            parse_harness_model_output(r#"{"kind":"handoff"}"#).expect_err("parse should fail");

        assert!(error.to_string().contains("未知 decision kind"));
    }

    #[test]
    fn prompt_includes_observations_and_tools() {
        use crate::models::ai_agent_run::{AiAgentRemoteHostTarget, AiAgentResolvedTargets};

        let input = AiAgentHarnessModelInput {
            run_id: "run-1".to_owned(),
            goal: "看看终端".to_owned(),
            resolved_targets: AiAgentResolvedTargets {
                last_remote_host: Some(AiAgentRemoteHostTarget {
                    host_id: "host-bwy".to_owned(),
                    group_id: None,
                    name: None,
                    host: Some("172.16.40.104".to_owned()),
                    port: None,
                    username: None,
                    production: None,
                    source_tool_id: None,
                    source_step_id: "step-remote-host".to_owned(),
                }),
                usage_hints: Vec::new(),
            },
            steps: vec![crate::models::ai_agent_run::AiAgentRunStep {
                id: "step-1".to_owned(),
                run_id: "run-1".to_owned(),
                kind: AiAgentRunStepKind::Observation,
                status: crate::models::ai_agent_run::AiAgentRunStepStatus::Succeeded,
                tool_id: Some("terminal.list".to_owned()),
                input_json: None,
                observation_json: Some(json!({
                    "status": "succeeded",
                    "summary": "找到 1 个终端",
                    "data": { "sessionCount": 1 },
                    "ignored": "large"
                })),
                summary: Some("找到 1 个终端".to_owned()),
                created_at: 1,
                updated_at: 1,
            }],
        };
        let tool = ToolDefinition {
            id: "terminal.list".to_owned(),
            title: "列出终端".to_owned(),
            description: "返回终端会话列表".to_owned(),
            category: crate::models::tool_registry::ToolCategory::Terminal,
            risk: crate::models::tool_registry::ToolRiskLevel::Read,
            confirmation: crate::models::tool_registry::ToolConfirmationPolicy::Auto,
            audit: crate::models::tool_registry::ToolAuditPolicy::Summary,
            enabled: true,
            exposed_to_mcp: true,
            input_schema: json!({ "type": "object" }),
        };

        let prompt = build_harness_prompt(&input, &[tool]).expect("build prompt");

        assert!(prompt.contains("terminal.list"));
        assert!(prompt.contains("lastRemoteHost"));
        assert!(prompt.contains("host-bwy"));
        assert!(prompt.contains("sessionCount"));
        assert!(prompt.contains("带副作用的目标必须调用工具"));
        assert!(!prompt.contains("ignored"));
    }
}
