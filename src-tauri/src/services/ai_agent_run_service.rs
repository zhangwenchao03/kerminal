//! In-memory AI Agent run service.
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        ai_agent_run::{
            AiAgentHarnessDecision, AiAgentHarnessModelInput, AiAgentHarnessModelOutput,
            AiAgentHarnessRunRequest, AiAgentHarnessRunResult, AiAgentRemoteHostTarget,
            AiAgentResolvedTargets, AiAgentRun, AiAgentRunLimits, AiAgentRunSnapshot,
            AiAgentRunStatus, AiAgentRunStep, AiAgentRunStepAppendRequest, AiAgentRunStepKind,
            AiAgentRunStepStatus,
        },
        ai_tool_invocation::{
            AiToolAuditRecord, AiToolExecuteIfAllowedRequest, AiToolExecuteIfAllowedResponse,
            AiToolInvocationStatus, AiToolObservation, AiToolObservationStatus,
        },
    },
};

const DEFAULT_MAX_ITERATIONS: u32 = 20;
const DEFAULT_MAX_TOOL_CALLS: u32 = 5;
const MAX_LIMIT: u32 = 100;
const MAX_GOAL_CHARS: usize = 20_000;
const MAX_TEXT_CHARS: usize = 20_000;
const MAX_TOOL_ID_CHARS: usize = 200;

/// Model driver used by the minimal harness loop.
pub trait AiAgentHarnessModel: Send + Sync {
    fn next_turn<'a>(
        &'a self,
        input: AiAgentHarnessModelInput,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiAgentHarnessModelOutput>> + Send + 'a>>;
}

/// Tool execution boundary used by the minimal harness loop.
pub trait AiAgentHarnessToolExecutor: Send + Sync {
    fn execute_tool<'a>(
        &'a self,
        request: AiToolExecuteIfAllowedRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiToolExecuteIfAllowedResponse>> + Send + 'a>>;
}

/// Store-ready Agent run service. The first implementation is in-memory only.
#[derive(Debug, Default)]
pub struct AiAgentRunService {
    inner: Mutex<AiAgentRunState>,
}

impl AiAgentRunService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start_run(
        &self,
        goal: impl Into<String>,
        limits: AiAgentRunLimits,
    ) -> AppResult<AiAgentRunSnapshot> {
        let goal = normalize_required_text("Agent 目标", goal.into(), MAX_GOAL_CHARS)?;
        let now = unix_time_millis()?;
        let run = AiAgentRun {
            id: Uuid::new_v4().to_string(),
            goal,
            status: AiAgentRunStatus::Running,
            conversation_id: None,
            conversation_slot_json: None,
            iteration: 0,
            max_iterations: normalize_limit(limits.max_iterations, DEFAULT_MAX_ITERATIONS),
            max_tool_calls: normalize_limit(limits.max_tool_calls, DEFAULT_MAX_TOOL_CALLS),
            created_at: now,
            updated_at: now,
        };
        let snapshot = AiAgentRunSnapshot {
            run: run.clone(),
            steps: Vec::new(),
        };

        self.lock_state()?.runs.insert(
            run.id.clone(),
            StoredRun {
                run,
                steps: Vec::new(),
            },
        );

        Ok(snapshot)
    }

    pub fn get_run(&self, run_id: &str) -> AppResult<AiAgentRunSnapshot> {
        let run_id = normalize_required_text("Run ID", run_id.to_owned(), MAX_TOOL_ID_CHARS)?;
        let state = self.lock_state()?;
        state.snapshot(&run_id)
    }

    pub fn append_step(
        &self,
        run_id: &str,
        request: AiAgentRunStepAppendRequest,
    ) -> AppResult<AiAgentRunStep> {
        let run_id = normalize_required_text("Run ID", run_id.to_owned(), MAX_TOOL_ID_CHARS)?;
        let now = unix_time_millis()?;
        let mut state = self.lock_state()?;
        let stored = state.run_mut(&run_id)?;
        ensure_mutable_run(&stored.run)?;

        if stored.run.iteration >= stored.run.max_iterations {
            return Err(AppError::AiAgent(format!(
                "Agent run 已达到最大迭代次数: {}",
                stored.run.max_iterations
            )));
        }

        let status = request.status.unwrap_or(AiAgentRunStepStatus::Succeeded);
        let step = AiAgentRunStep {
            id: Uuid::new_v4().to_string(),
            run_id: stored.run.id.clone(),
            kind: request.kind,
            status,
            tool_id: normalize_optional_text("Tool ID", request.tool_id, MAX_TOOL_ID_CHARS)?,
            input_json: request.input_json,
            observation_json: request.observation_json,
            summary: normalize_optional_text("Step 摘要", request.summary, MAX_TEXT_CHARS)?,
            created_at: now,
            updated_at: now,
        };

        stored.run.iteration += 1;
        stored.run.updated_at = now;
        stored.steps.push(step.clone());
        Ok(step)
    }

    pub fn mark_waiting_approval(&self, run_id: &str) -> AppResult<AiAgentRunSnapshot> {
        self.transition(run_id, AiAgentRunStatus::WaitingApproval)
    }

    pub fn mark_completed(&self, run_id: &str) -> AppResult<AiAgentRunSnapshot> {
        self.transition(run_id, AiAgentRunStatus::Completed)
    }

    pub fn mark_blocked(&self, run_id: &str) -> AppResult<AiAgentRunSnapshot> {
        self.transition(run_id, AiAgentRunStatus::Blocked)
    }

    pub fn cancel(&self, run_id: &str) -> AppResult<AiAgentRunSnapshot> {
        let run_id = normalize_required_text("Run ID", run_id.to_owned(), MAX_TOOL_ID_CHARS)?;
        let now = unix_time_millis()?;
        let mut state = self.lock_state()?;
        let stored = state.run_mut(&run_id)?;

        if stored.run.status == AiAgentRunStatus::Cancelled {
            return Ok(stored.snapshot());
        }
        if matches!(
            stored.run.status,
            AiAgentRunStatus::Completed | AiAgentRunStatus::Blocked
        ) {
            return Err(AppError::AiAgent(format!(
                "Agent run 已结束，不能取消: {}",
                stored.run.id
            )));
        }

        stored.run.status = AiAgentRunStatus::Cancelled;
        stored.run.updated_at = now;
        Ok(stored.snapshot())
    }

    /// Drop the latest retryable step and following trace, then make the run resumable.
    pub fn retry_last_step(&self, run_id: &str) -> AppResult<AiAgentRunSnapshot> {
        let run_id = normalize_required_text("Run ID", run_id.to_owned(), MAX_TOOL_ID_CHARS)?;
        let now = unix_time_millis()?;
        let mut state = self.lock_state()?;
        let stored = state.run_mut(&run_id)?;

        if stored.run.status == AiAgentRunStatus::Completed {
            return Err(AppError::AiAgent(format!(
                "Agent run 已完成，不能重试: {}",
                stored.run.id
            )));
        }

        let retry_step_index = stored
            .steps
            .iter()
            .rposition(is_retryable_step)
            .or_else(|| stored.steps.len().checked_sub(1))
            .ok_or_else(|| AppError::AiAgent("Agent run 没有可重试步骤".to_owned()))?;
        let truncate_index = retry_truncate_index(&stored.steps, retry_step_index);
        stored.steps.truncate(truncate_index);
        stored.run.iteration = stored.steps.len() as u32;
        stored.run.status = AiAgentRunStatus::Running;
        stored.run.updated_at = now;
        Ok(stored.snapshot())
    }

    /// Append an approved tool audit as an observation and make the run resumable.
    pub fn resume_after_approval(
        &self,
        run_id: &str,
        audit: AiToolAuditRecord,
    ) -> AppResult<AiAgentRunSnapshot> {
        let run_id = normalize_required_text("Run ID", run_id.to_owned(), MAX_TOOL_ID_CHARS)?;
        let observation = observation_from_audit(&audit);
        let status = step_status_for_observation(observation.status);
        self.append_step(
            &run_id,
            AiAgentRunStepAppendRequest {
                kind: AiAgentRunStepKind::Observation,
                status: Some(status),
                tool_id: Some(audit.tool_id),
                input_json: None,
                observation_json: Some(serde_json::to_value(&observation)?),
                summary: observation.summary.clone(),
            },
        )?;
        if observation.status == AiToolObservationStatus::Succeeded {
            self.transition(&run_id, AiAgentRunStatus::Running)
        } else {
            self.transition(&run_id, AiAgentRunStatus::Blocked)
        }
    }

    /// Drive a minimal ReAct-style harness loop until final, approval, blocked, or limits.
    pub async fn run_harness<M, T>(
        &self,
        request: AiAgentHarnessRunRequest,
        model: &M,
        tools: &T,
    ) -> AppResult<AiAgentHarnessRunResult>
    where
        M: AiAgentHarnessModel,
        T: AiAgentHarnessToolExecutor,
    {
        let conversation_id = normalize_optional_text(
            "Conversation ID",
            request.conversation_id,
            MAX_TOOL_ID_CHARS,
        )?;
        let conversation_slot_json = normalize_optional_text(
            "Conversation slot JSON",
            request.conversation_slot_json,
            MAX_TEXT_CHARS,
        )?;
        let initial = self.start_run_with_context(
            request.goal,
            request.limits,
            conversation_id,
            conversation_slot_json,
        )?;
        let run_id = initial.run.id.clone();
        self.continue_harness(&run_id, model, tools).await
    }

    /// Continue an existing running harness after an approved observation was appended.
    pub async fn continue_harness<M, T>(
        &self,
        run_id: &str,
        model: &M,
        tools: &T,
    ) -> AppResult<AiAgentHarnessRunResult>
    where
        M: AiAgentHarnessModel,
        T: AiAgentHarnessToolExecutor,
    {
        let run_id = normalize_required_text("Run ID", run_id.to_owned(), MAX_TOOL_ID_CHARS)?;
        let snapshot = self.get_run(&run_id)?;
        let conversation_id = snapshot.run.conversation_id.clone();
        let conversation_slot_json = snapshot.run.conversation_slot_json.clone();
        let mut tool_call_count = count_tool_calls(&snapshot.steps);
        let mut last_observation = last_observation_from_steps(&snapshot.steps);

        loop {
            let snapshot = self.get_run(&run_id)?;
            if snapshot.run.status.is_terminal()
                || snapshot.run.status == AiAgentRunStatus::WaitingApproval
            {
                return Ok(AiAgentHarnessRunResult {
                    snapshot,
                    final_message: None,
                    pending_invocation: None,
                    last_observation,
                });
            }

            let model_output = model
                .next_turn(AiAgentHarnessModelInput {
                    run_id: run_id.clone(),
                    goal: snapshot.run.goal.clone(),
                    resolved_targets: resolved_targets_from_steps(&snapshot.steps),
                    steps: snapshot.steps.clone(),
                })
                .await?;
            self.append_step(
                &run_id,
                AiAgentRunStepAppendRequest {
                    kind: AiAgentRunStepKind::Model,
                    status: Some(AiAgentRunStepStatus::Succeeded),
                    tool_id: None,
                    input_json: None,
                    observation_json: Some(serde_json::to_value(&model_output)?),
                    summary: model_output.summary.clone(),
                },
            )?;

            match model_output.decision {
                AiAgentHarnessDecision::Final { message } => {
                    if let Some(reason) =
                        unsafe_final_reason(&snapshot.run.goal, &snapshot.steps, &message)
                    {
                        self.append_step(
                            &run_id,
                            AiAgentRunStepAppendRequest {
                                kind: AiAgentRunStepKind::Error,
                                status: Some(AiAgentRunStepStatus::Blocked),
                                tool_id: None,
                                input_json: None,
                                observation_json: None,
                                summary: Some(reason.clone()),
                            },
                        )?;
                        let snapshot = self.mark_blocked(&run_id)?;
                        return Ok(AiAgentHarnessRunResult {
                            snapshot,
                            final_message: Some(reason),
                            pending_invocation: None,
                            last_observation,
                        });
                    }
                    self.append_step(
                        &run_id,
                        AiAgentRunStepAppendRequest {
                            kind: AiAgentRunStepKind::Final,
                            status: Some(AiAgentRunStepStatus::Succeeded),
                            tool_id: None,
                            input_json: None,
                            observation_json: None,
                            summary: Some(message.clone()),
                        },
                    )?;
                    let snapshot = self.mark_completed(&run_id)?;
                    return Ok(AiAgentHarnessRunResult {
                        snapshot,
                        final_message: Some(message),
                        pending_invocation: None,
                        last_observation,
                    });
                }
                AiAgentHarnessDecision::Blocked { reason } => {
                    self.append_step(
                        &run_id,
                        AiAgentRunStepAppendRequest {
                            kind: AiAgentRunStepKind::Error,
                            status: Some(AiAgentRunStepStatus::Blocked),
                            tool_id: None,
                            input_json: None,
                            observation_json: None,
                            summary: Some(reason.clone()),
                        },
                    )?;
                    let snapshot = self.mark_blocked(&run_id)?;
                    return Ok(AiAgentHarnessRunResult {
                        snapshot,
                        final_message: Some(reason),
                        pending_invocation: None,
                        last_observation,
                    });
                }
                AiAgentHarnessDecision::ToolCall { call } => {
                    if tool_call_count >= snapshot.run.max_tool_calls {
                        let reason = format!(
                            "Agent run 已达到最大工具调用次数: {}",
                            snapshot.run.max_tool_calls
                        );
                        self.append_step(
                            &run_id,
                            AiAgentRunStepAppendRequest {
                                kind: AiAgentRunStepKind::Error,
                                status: Some(AiAgentRunStepStatus::Blocked),
                                tool_id: Some(call.tool_id),
                                input_json: None,
                                observation_json: None,
                                summary: Some(reason.clone()),
                            },
                        )?;
                        let snapshot = self.mark_blocked(&run_id)?;
                        return Ok(AiAgentHarnessRunResult {
                            snapshot,
                            final_message: Some(reason),
                            pending_invocation: None,
                            last_observation,
                        });
                    }
                    tool_call_count += 1;
                    let tool_step = self.append_step(
                        &run_id,
                        AiAgentRunStepAppendRequest {
                            kind: AiAgentRunStepKind::ToolCall,
                            status: Some(AiAgentRunStepStatus::Running),
                            tool_id: Some(call.tool_id.clone()),
                            input_json: Some(tool_call_input_json(&call.arguments, &call.reason)),
                            observation_json: None,
                            summary: call.reason.clone(),
                        },
                    )?;
                    let response = tools
                        .execute_tool(AiToolExecuteIfAllowedRequest {
                            tool_id: call.tool_id.clone(),
                            arguments: call.arguments,
                            requested_by: Some("kerminal-agent-run".to_owned()),
                            reason: call.reason,
                            conversation_id: conversation_id.clone(),
                            conversation_slot_json: conversation_slot_json.clone(),
                            run_id: Some(run_id.clone()),
                            step_id: Some(tool_step.id.clone()),
                            audit_context: None,
                        })
                        .await?;
                    let observation = response.observation.clone();
                    let observation_status = step_status_for_observation(observation.status);
                    self.append_step(
                        &run_id,
                        AiAgentRunStepAppendRequest {
                            kind: AiAgentRunStepKind::Observation,
                            status: Some(observation_status),
                            tool_id: Some(call.tool_id),
                            input_json: None,
                            observation_json: Some(serde_json::to_value(&observation)?),
                            summary: observation.summary.clone(),
                        },
                    )?;
                    last_observation = Some(observation.clone());

                    if observation.status == AiToolObservationStatus::NeedsApproval {
                        let snapshot = self.mark_waiting_approval(&run_id)?;
                        return Ok(AiAgentHarnessRunResult {
                            snapshot,
                            final_message: None,
                            pending_invocation: response.pending_invocation,
                            last_observation,
                        });
                    }
                    if matches!(
                        observation.status,
                        AiToolObservationStatus::Failed | AiToolObservationStatus::Blocked
                    ) && !observation.recoverable
                    {
                        let snapshot = self.mark_blocked(&run_id)?;
                        return Ok(AiAgentHarnessRunResult {
                            snapshot,
                            final_message: observation.summary,
                            pending_invocation: None,
                            last_observation,
                        });
                    }
                }
            }
        }
    }

    fn transition(&self, run_id: &str, status: AiAgentRunStatus) -> AppResult<AiAgentRunSnapshot> {
        let run_id = normalize_required_text("Run ID", run_id.to_owned(), MAX_TOOL_ID_CHARS)?;
        let now = unix_time_millis()?;
        let mut state = self.lock_state()?;
        let stored = state.run_mut(&run_id)?;
        ensure_mutable_run(&stored.run)?;
        stored.run.status = status;
        stored.run.updated_at = now;
        Ok(stored.snapshot())
    }

    fn start_run_with_context(
        &self,
        goal: impl Into<String>,
        limits: AiAgentRunLimits,
        conversation_id: Option<String>,
        conversation_slot_json: Option<String>,
    ) -> AppResult<AiAgentRunSnapshot> {
        let snapshot = self.start_run(goal, limits)?;
        let now = unix_time_millis()?;
        let mut state = self.lock_state()?;
        let stored = state.run_mut(&snapshot.run.id)?;
        stored.run.conversation_id = conversation_id;
        stored.run.conversation_slot_json = conversation_slot_json;
        stored.run.updated_at = now;
        Ok(stored.snapshot())
    }

    fn lock_state(&self) -> AppResult<MutexGuard<'_, AiAgentRunState>> {
        self.inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ai agent run state"))
    }
}

fn step_status_for_observation(status: AiToolObservationStatus) -> AiAgentRunStepStatus {
    match status {
        AiToolObservationStatus::Succeeded => AiAgentRunStepStatus::Succeeded,
        AiToolObservationStatus::Failed => AiAgentRunStepStatus::Failed,
        AiToolObservationStatus::NeedsApproval => AiAgentRunStepStatus::WaitingApproval,
        AiToolObservationStatus::Blocked => AiAgentRunStepStatus::Blocked,
    }
}

fn tool_call_input_json(arguments: &Value, reason: &Option<String>) -> Value {
    json!({
        "arguments": arguments,
        "reason": reason,
    })
}

fn unsafe_final_reason(goal: &str, steps: &[AiAgentRunStep], message: &str) -> Option<String> {
    if !goal_requires_action_observation(goal)
        || !final_claims_action_completed(message)
        || has_successful_action_observation(steps)
    {
        return None;
    }
    Some(
        "Agent 不能在没有成功工具观察结果的情况下宣称已修改、创建、移动、连接或保存。请先调用合适的 Kerminal 工具并等待成功 observation。"
            .to_owned(),
    )
}

fn final_claims_action_completed(message: &str) -> bool {
    let message = message.trim().to_lowercase();
    [
        "已将",
        "已经",
        "已创建",
        "已添加",
        "已加入",
        "已归入",
        "已放到",
        "已移动",
        "已连接",
        "已打开",
        "已执行",
        "已运行",
        "已写入",
        "已保存",
        "已上传",
        "已下载",
        "已删除",
        "完成",
        "成功",
        "done",
        "completed",
        "successfully",
    ]
    .iter()
    .any(|keyword| message.contains(keyword))
}

fn goal_requires_action_observation(goal: &str) -> bool {
    let goal = goal.trim().to_lowercase();
    if goal.is_empty() || looks_informational_goal(&goal) {
        return false;
    }
    [
        "把",
        "放到",
        "加入",
        "归入",
        "移到",
        "移入",
        "添加",
        "创建",
        "新建",
        "更新",
        "修改",
        "删除",
        "连接",
        "打开",
        "执行",
        "运行",
        "写入",
        "保存",
        "上传",
        "下载",
        "重命名",
        "add ",
        "create ",
        "move ",
        "update ",
        "modify ",
        "delete ",
        "connect ",
        "open ",
        "run ",
        "execute ",
        "write ",
        "save ",
        "upload ",
        "download ",
        "rename ",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn looks_informational_goal(goal: &str) -> bool {
    [
        "怎么",
        "如何",
        "怎样",
        "为什么",
        "说明",
        "解释",
        "教程",
        "给我方案",
        "帮我想",
        "what ",
        "why ",
        "how ",
        "explain",
        "show me how",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn has_successful_action_observation(steps: &[AiAgentRunStep]) -> bool {
    steps.iter().any(|step| {
        step.kind == AiAgentRunStepKind::Observation
            && step.status == AiAgentRunStepStatus::Succeeded
            && step
                .tool_id
                .as_deref()
                .map(is_action_tool_id)
                .unwrap_or(false)
    })
}

fn is_action_tool_id(tool_id: &str) -> bool {
    ![
        ".list",
        ".get",
        ".read",
        ".snapshot",
        ".resolve",
        ".resolve_current",
        ".last_used",
        ".search",
        ".preview",
        ".history",
        ".events",
    ]
    .iter()
    .any(|read_marker| tool_id.contains(read_marker))
}

fn observation_from_audit(audit: &AiToolAuditRecord) -> AiToolObservation {
    if let Some(observation_json) = &audit.observation_json {
        if let Ok(mut observation) =
            serde_json::from_value::<AiToolObservation>(observation_json.clone())
        {
            observation.audit_id = Some(audit.id.clone());
            return observation;
        }
    }

    AiToolObservation {
        status: match audit.status {
            AiToolInvocationStatus::Succeeded => AiToolObservationStatus::Succeeded,
            AiToolInvocationStatus::Failed => AiToolObservationStatus::Failed,
            AiToolInvocationStatus::Pending => AiToolObservationStatus::NeedsApproval,
            AiToolInvocationStatus::Rejected => AiToolObservationStatus::Blocked,
        },
        summary: audit
            .result_summary
            .clone()
            .or_else(|| audit.error.clone())
            .or_else(|| Some(format!("工具“{}”已完成确认流程。", audit.tool_title))),
        data: json!({
            "auditId": audit.id,
            "invocationId": audit.invocation_id,
            "toolId": audit.tool_id,
            "toolTitle": audit.tool_title,
            "status": audit.status,
            "argumentsSummary": audit.arguments_summary,
            "riskSummary": audit.risk_summary,
        }),
        entities: Vec::new(),
        recoverable: audit.status == AiToolInvocationStatus::Failed,
        error_kind: audit.error.as_deref().map(classify_audit_error_kind),
        next_hints: if audit.status == AiToolInvocationStatus::Failed {
            vec!["检查工具参数、目标 id、凭据或远程连接状态后重试。".to_owned()]
        } else {
            Vec::new()
        },
        pending_invocation_id: None,
        audit_id: Some(audit.id.clone()),
    }
}

fn count_tool_calls(steps: &[AiAgentRunStep]) -> u32 {
    steps
        .iter()
        .filter(|step| step.kind == AiAgentRunStepKind::ToolCall)
        .count()
        .try_into()
        .unwrap_or(u32::MAX)
}

fn last_observation_from_steps(steps: &[AiAgentRunStep]) -> Option<AiToolObservation> {
    steps
        .iter()
        .rev()
        .filter(|step| step.kind == AiAgentRunStepKind::Observation)
        .filter_map(|step| step.observation_json.as_ref())
        .find_map(|value| serde_json::from_value(value.clone()).ok())
}

fn resolved_targets_from_steps(steps: &[AiAgentRunStep]) -> AiAgentResolvedTargets {
    AiAgentResolvedTargets {
        last_remote_host: last_remote_host_target_from_steps(steps),
        usage_hints: vec![
            "When the user refers to the just-created or last remote host, use resolvedTargets.lastRemoteHost.hostId for SSH, SFTP, server info, and diagnostics tools."
                .to_owned(),
        ],
    }
}

fn last_remote_host_target_from_steps(steps: &[AiAgentRunStep]) -> Option<AiAgentRemoteHostTarget> {
    steps
        .iter()
        .rev()
        .filter(|step| step.kind == AiAgentRunStepKind::Observation)
        .find_map(|step| {
            let observation: AiToolObservation =
                serde_json::from_value(step.observation_json.as_ref()?.clone()).ok()?;
            if observation.status != AiToolObservationStatus::Succeeded {
                return None;
            }
            remote_host_from_observation(&step.id, step.tool_id.as_deref(), &observation)
        })
}

fn remote_host_from_observation(
    step_id: &str,
    tool_id: Option<&str>,
    observation: &AiToolObservation,
) -> Option<AiAgentRemoteHostTarget> {
    observation
        .entities
        .iter()
        .find_map(|entity| remote_host_from_entity(step_id, tool_id, entity))
        .or_else(|| remote_host_from_data(step_id, tool_id, &observation.data))
}

fn remote_host_from_entity(
    step_id: &str,
    tool_id: Option<&str>,
    entity: &Value,
) -> Option<AiAgentRemoteHostTarget> {
    let object = entity.as_object()?;
    if object.get("type").and_then(Value::as_str) != Some("remoteHost") {
        return None;
    }
    let host_id = object
        .get("id")
        .or_else(|| object.get("hostId"))
        .and_then(Value::as_str)?;
    Some(AiAgentRemoteHostTarget {
        host_id: host_id.to_owned(),
        group_id: string_from_object_or_metadata(object, "groupId"),
        name: string_from_object_or_metadata(object, "name"),
        host: string_from_object_or_metadata(object, "host"),
        port: u16_from_object_or_metadata(object, "port"),
        username: string_from_object_or_metadata(object, "username"),
        production: bool_from_object_or_metadata(object, "production"),
        source_tool_id: tool_id.map(str::to_owned),
        source_step_id: step_id.to_owned(),
    })
}

fn remote_host_from_data(
    step_id: &str,
    tool_id: Option<&str>,
    data: &Value,
) -> Option<AiAgentRemoteHostTarget> {
    let object = data.as_object()?;
    let host_object = object.get("host").and_then(Value::as_object);
    let host_id = object
        .get("hostId")
        .or_else(|| host_object.and_then(|host| host.get("id")))
        .and_then(Value::as_str)?;
    Some(AiAgentRemoteHostTarget {
        host_id: host_id.to_owned(),
        group_id: string_from_object(object, "groupId")
            .or_else(|| host_object.and_then(|host| string_from_object(host, "groupId"))),
        name: host_object.and_then(|host| string_from_object(host, "name")),
        host: host_object.and_then(|host| string_from_object(host, "host")),
        port: host_object.and_then(|host| u16_from_object(host, "port")),
        username: host_object.and_then(|host| string_from_object(host, "username")),
        production: host_object.and_then(|host| bool_from_object(host, "production")),
        source_tool_id: tool_id.map(str::to_owned),
        source_step_id: step_id.to_owned(),
    })
}

fn string_from_object_or_metadata(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Option<String> {
    string_from_object(object, key).or_else(|| {
        object
            .get("metadata")
            .and_then(Value::as_object)
            .and_then(|metadata| string_from_object(metadata, key))
    })
}

fn u16_from_object_or_metadata(object: &serde_json::Map<String, Value>, key: &str) -> Option<u16> {
    u16_from_object(object, key).or_else(|| {
        object
            .get("metadata")
            .and_then(Value::as_object)
            .and_then(|metadata| u16_from_object(metadata, key))
    })
}

fn bool_from_object_or_metadata(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Option<bool> {
    bool_from_object(object, key).or_else(|| {
        object
            .get("metadata")
            .and_then(Value::as_object)
            .and_then(|metadata| bool_from_object(metadata, key))
    })
}

fn string_from_object(object: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn u16_from_object(object: &serde_json::Map<String, Value>, key: &str) -> Option<u16> {
    let value = object.get(key)?.as_u64()?;
    u16::try_from(value).ok()
}

fn bool_from_object(object: &serde_json::Map<String, Value>, key: &str) -> Option<bool> {
    object.get(key).and_then(Value::as_bool)
}

fn classify_audit_error_kind(message: &str) -> String {
    if message.contains("不存在") || message.contains("找不到") {
        "targetNotFound".to_owned()
    } else if message.contains("参数") || message.contains("不能为空") || message.contains("必须")
    {
        "invalidInput".to_owned()
    } else if message.contains("权限") || message.contains("拒绝") {
        "permissionDenied".to_owned()
    } else {
        "toolFailure".to_owned()
    }
}

#[derive(Debug, Default)]
struct AiAgentRunState {
    runs: HashMap<String, StoredRun>,
}

impl AiAgentRunState {
    fn run_mut(&mut self, run_id: &str) -> AppResult<&mut StoredRun> {
        self.runs
            .get_mut(run_id)
            .ok_or_else(|| AppError::NotFound(format!("AI Agent run 不存在: {run_id}")))
    }

    fn snapshot(&self, run_id: &str) -> AppResult<AiAgentRunSnapshot> {
        self.runs
            .get(run_id)
            .map(StoredRun::snapshot)
            .ok_or_else(|| AppError::NotFound(format!("AI Agent run 不存在: {run_id}")))
    }
}

#[derive(Debug, Clone)]
struct StoredRun {
    run: AiAgentRun,
    steps: Vec<AiAgentRunStep>,
}

impl StoredRun {
    fn snapshot(&self) -> AiAgentRunSnapshot {
        AiAgentRunSnapshot {
            run: self.run.clone(),
            steps: self.steps.clone(),
        }
    }
}

fn ensure_mutable_run(run: &AiAgentRun) -> AppResult<()> {
    if run.status.is_terminal() {
        Err(AppError::AiAgent(format!(
            "Agent run 已结束，不能继续修改: {}",
            run.id
        )))
    } else {
        Ok(())
    }
}

fn is_retryable_step(step: &AiAgentRunStep) -> bool {
    matches!(
        step.status,
        AiAgentRunStepStatus::Failed
            | AiAgentRunStepStatus::Blocked
            | AiAgentRunStepStatus::Cancelled
            | AiAgentRunStepStatus::WaitingApproval
    ) || step.kind == AiAgentRunStepKind::Error
}

fn retry_truncate_index(steps: &[AiAgentRunStep], retry_step_index: usize) -> usize {
    let retry_step = &steps[retry_step_index];
    if retry_step.kind == AiAgentRunStepKind::Observation {
        if let Some(tool_id) = retry_step.tool_id.as_deref() {
            if let Some(tool_call_index) = steps[..retry_step_index].iter().rposition(|step| {
                step.kind == AiAgentRunStepKind::ToolCall
                    && step.tool_id.as_deref() == Some(tool_id)
            }) {
                return tool_call_index;
            }
        }
    }
    retry_step_index
}

fn normalize_limit(value: Option<u32>, default_value: u32) -> u32 {
    value.unwrap_or(default_value).clamp(1, MAX_LIMIT)
}

fn normalize_required_text(label: &str, value: String, max_chars: usize) -> AppResult<String> {
    let normalized = value.trim().to_owned();
    if normalized.is_empty() {
        return Err(AppError::InvalidInput(format!("{label}不能为空")));
    }
    if normalized.chars().count() > max_chars {
        return Err(AppError::InvalidInput(format!(
            "{label}长度不能超过 {max_chars} 个字符"
        )));
    }
    Ok(normalized)
}

fn normalize_optional_text(
    label: &str,
    value: Option<String>,
    max_chars: usize,
) -> AppResult<Option<String>> {
    value
        .map(|value| normalize_required_text(label, value, max_chars))
        .transpose()
}

fn unix_time_millis() -> AppResult<i64> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::AiAgent(format!("系统时间早于 Unix epoch: {error}")))?;
    Ok(elapsed.as_millis() as i64)
}
