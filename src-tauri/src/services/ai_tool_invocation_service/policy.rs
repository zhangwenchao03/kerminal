use super::*;

#[derive(Debug, Clone, Default)]
pub(super) struct InvocationPolicyOverlay {
    pub(super) confirmation: Option<ToolConfirmationPolicy>,
    pub(super) risk: Option<ToolRiskLevel>,
    pub(super) audit: Option<crate::models::tool_registry::ToolAuditPolicy>,
    pub(super) risk_summary: Option<String>,
}

pub(super) fn invocation_policy_overlay(
    tool: &ToolDefinition,
    arguments: &serde_json::Map<String, Value>,
) -> InvocationPolicyOverlay {
    match tool.id.as_str() {
        "terminal.write" => {
            let Some(data) = arguments.get("data").and_then(Value::as_str) else {
                return InvocationPolicyOverlay::default();
            };
            let Some(risk_summary) = terminal_write_risk_summary(data) else {
                return InvocationPolicyOverlay::default();
            };

            InvocationPolicyOverlay {
                confirmation: Some(ToolConfirmationPolicy::Always),
                risk: Some(ToolRiskLevel::Destructive),
                audit: None,
                risk_summary: Some(risk_summary),
            }
        }
        "ssh.command" => {
            let Some(command) = arguments.get("command").and_then(Value::as_str) else {
                return InvocationPolicyOverlay::default();
            };
            let Some(risk_summary) = ssh_command_risk_summary(command) else {
                return InvocationPolicyOverlay::default();
            };

            InvocationPolicyOverlay {
                confirmation: Some(ToolConfirmationPolicy::Always),
                risk: Some(ToolRiskLevel::Destructive),
                audit: Some(crate::models::tool_registry::ToolAuditPolicy::Full),
                risk_summary: Some(risk_summary),
            }
        }
        _ => InvocationPolicyOverlay::default(),
    }
}

pub(super) fn effective_confirmation_policy(
    base_confirmation: ToolConfirmationPolicy,
    effective_risk: ToolRiskLevel,
    overlay_confirmation: Option<ToolConfirmationPolicy>,
    ai_policy: &AiSecuritySettings,
) -> AppResult<ToolConfirmationPolicy> {
    if effective_risk == ToolRiskLevel::Destructive && !ai_policy.allow_destructive_tools {
        return Err(AppError::InvalidInput(
            "AI 破坏性工具已被安全策略禁用，请先在设置中显式允许。".to_owned(),
        ));
    }

    match ai_policy.command_approval_policy {
        AiCommandApprovalPolicy::Always => return Ok(ToolConfirmationPolicy::Always),
        AiCommandApprovalPolicy::Relaxed => return Ok(ToolConfirmationPolicy::Auto),
        AiCommandApprovalPolicy::Risky => {}
    }

    if effective_risk == ToolRiskLevel::Remote && !ai_policy.require_remote_approval {
        return Ok(ToolConfirmationPolicy::Auto);
    }

    Ok(overlay_confirmation.unwrap_or(base_confirmation))
}

pub(super) fn find_enabled_tool(
    tools: &[ToolDefinition],
    tool_id: &str,
) -> AppResult<ToolDefinition> {
    let tool = tools
        .iter()
        .find(|tool| tool.id == tool_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("工具不存在: {tool_id}")))?;

    if !tool.enabled {
        return Err(AppError::InvalidInput(format!("工具未启用: {tool_id}")));
    }

    Ok(tool)
}

pub(super) fn normalized_arguments(value: Value) -> AppResult<serde_json::Map<String, Value>> {
    match value {
        Value::Object(map) => Ok(map),
        Value::Null => Ok(serde_json::Map::new()),
        _ => Err(AppError::InvalidInput(
            "工具参数必须是 JSON object".to_owned(),
        )),
    }
}

pub(super) fn validate_required_arguments(
    tool: &ToolDefinition,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<()> {
    let required = tool
        .input_schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str);

    for key in required {
        if !arguments.contains_key(key) || arguments.get(key).is_some_and(Value::is_null) {
            return Err(AppError::InvalidInput(format!(
                "工具 {} 缺少必填参数: {}",
                tool.id, key
            )));
        }
    }

    Ok(())
}
