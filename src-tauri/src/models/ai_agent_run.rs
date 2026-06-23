//! AI Agent run and step state model.
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ai_tool_invocation::AiToolAuditRecord;
use super::ai_tool_invocation::{AiToolObservation, AiToolPendingInvocation};

/// Agent run lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiAgentRunStatus {
    Running,
    WaitingApproval,
    Completed,
    Blocked,
    Cancelled,
}

impl AiAgentRunStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Blocked | Self::Cancelled)
    }
}

/// Agent run record, shaped so it can later map one-to-one to SQLite columns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRun {
    pub id: String,
    pub goal: String,
    pub status: AiAgentRunStatus,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub conversation_slot_json: Option<String>,
    pub iteration: u32,
    pub max_iterations: u32,
    pub max_tool_calls: u32,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Run loop limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRunLimits {
    pub max_iterations: Option<u32>,
    pub max_tool_calls: Option<u32>,
}

impl Default for AiAgentRunLimits {
    fn default() -> Self {
        Self {
            max_iterations: None,
            max_tool_calls: None,
        }
    }
}

/// Agent run step kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiAgentRunStepKind {
    Plan,
    Model,
    ToolCall,
    Observation,
    Approval,
    Final,
    Error,
}

/// Agent run step lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiAgentRunStepStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    WaitingApproval,
    Blocked,
    Cancelled,
}

/// Agent run step record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRunStep {
    pub id: String,
    pub run_id: String,
    pub kind: AiAgentRunStepKind,
    pub status: AiAgentRunStepStatus,
    pub tool_id: Option<String>,
    pub input_json: Option<Value>,
    pub observation_json: Option<Value>,
    pub summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Request to append a step to an existing run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRunStepAppendRequest {
    pub kind: AiAgentRunStepKind,
    pub status: Option<AiAgentRunStepStatus>,
    pub tool_id: Option<String>,
    pub input_json: Option<Value>,
    pub observation_json: Option<Value>,
    pub summary: Option<String>,
}

/// Run snapshot with its ordered steps.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRunSnapshot {
    pub run: AiAgentRun,
    pub steps: Vec<AiAgentRunStep>,
}

/// Request to start and drive a bounded harness agent loop.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentHarnessRunRequest {
    pub goal: String,
    #[serde(default)]
    pub limits: AiAgentRunLimits,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub conversation_slot_json: Option<String>,
}

/// Immutable input passed to the model for each harness turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentHarnessModelInput {
    pub run_id: String,
    pub goal: String,
    pub steps: Vec<AiAgentRunStep>,
    #[serde(default)]
    pub resolved_targets: AiAgentResolvedTargets,
}

/// Targets resolved from prior run observations for the next model turn.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentResolvedTargets {
    #[serde(default)]
    pub last_remote_host: Option<AiAgentRemoteHostTarget>,
    #[serde(default)]
    pub usage_hints: Vec<String>,
}

/// Stable remote host target extracted from successful tool observations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRemoteHostTarget {
    pub host_id: String,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub production: Option<bool>,
    #[serde(default)]
    pub source_tool_id: Option<String>,
    pub source_step_id: String,
}

/// Tool call requested by a harness model turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentHarnessToolCall {
    pub tool_id: String,
    #[serde(default)]
    pub arguments: Value,
    #[serde(default)]
    pub reason: Option<String>,
}

/// Model decision for one harness turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiAgentHarnessDecision {
    ToolCall { call: AiAgentHarnessToolCall },
    Final { message: String },
    Blocked { reason: String },
}

/// Model output for one harness turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentHarnessModelOutput {
    #[serde(default)]
    pub summary: Option<String>,
    pub decision: AiAgentHarnessDecision,
}

/// Result returned after the harness loop stops.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentHarnessRunResult {
    pub snapshot: AiAgentRunSnapshot,
    #[serde(default)]
    pub final_message: Option<String>,
    #[serde(default)]
    pub pending_invocation: Option<AiToolPendingInvocation>,
    #[serde(default)]
    pub last_observation: Option<AiToolObservation>,
}

/// Request to get an existing agent run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRunGetRequest {
    pub run_id: String,
}

/// Request to cancel an existing agent run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRunCancelRequest {
    pub run_id: String,
}

/// Request to retry the last retryable step in an existing agent run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRunRetryRequest {
    pub run_id: String,
}

/// Request to resume a run after a pending tool approval has produced an audit record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRunResumeRequest {
    pub run_id: String,
    pub audit: AiToolAuditRecord,
}
