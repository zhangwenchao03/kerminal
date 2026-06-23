//! AI Agent final success guard regression tests.
//!
//! @author kongweiguang

use std::{future::Future, pin::Pin, sync::Arc};

use kerminal_lib::{
    error::{AppError, AppResult},
    models::{
        ai_agent_run::{
            AiAgentHarnessDecision, AiAgentHarnessModelInput, AiAgentHarnessModelOutput,
            AiAgentHarnessRunRequest, AiAgentRunLimits, AiAgentRunStatus, AiAgentRunStepKind,
            AiAgentRunStepStatus,
        },
        ai_tool_invocation::{AiToolExecuteIfAllowedRequest, AiToolExecuteIfAllowedResponse},
    },
    services::ai_agent_run_service::{
        AiAgentHarnessModel, AiAgentHarnessToolExecutor, AiAgentRunService,
    },
};
use serde_json::json;

struct FinalOnlyModel;

impl AiAgentHarnessModel for FinalOnlyModel {
    fn next_turn<'a>(
        &'a self,
        _input: AiAgentHarnessModelInput,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiAgentHarnessModelOutput>> + Send + 'a>> {
        Box::pin(async move {
            Ok(AiAgentHarnessModelOutput {
                summary: Some("报告已加入".to_owned()),
                decision: AiAgentHarnessDecision::Final {
                    message: "已将主机加入 bwy 分组。".to_owned(),
                },
            })
        })
    }
}

#[derive(Default)]
struct RejectingToolExecutor;

impl AiAgentHarnessToolExecutor for RejectingToolExecutor {
    fn execute_tool<'a>(
        &'a self,
        _request: AiToolExecuteIfAllowedRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiToolExecuteIfAllowedResponse>> + Send + 'a>> {
        Box::pin(async move { Err(AppError::AiAgent("unexpected tool call".to_owned())) })
    }
}

#[test]
fn harness_blocks_action_final_without_successful_tool_observation() {
    let service = AiAgentRunService::new();
    let tools = Arc::new(RejectingToolExecutor);

    let result = tauri::async_runtime::block_on(service.run_harness(
        AiAgentHarnessRunRequest {
            goal: "把 172.16.40.105 主机放到 bwy 分组".to_owned(),
            limits: AiAgentRunLimits {
                max_iterations: Some(4),
                max_tool_calls: Some(1),
            },
            conversation_id: None,
            conversation_slot_json: None,
        },
        &FinalOnlyModel,
        tools.as_ref(),
    ))
    .expect("run harness");

    assert_eq!(result.snapshot.run.status, AiAgentRunStatus::Blocked);
    assert!(result
        .final_message
        .as_deref()
        .unwrap_or_default()
        .contains("没有成功工具观察结果"));
    assert!(result.snapshot.steps.iter().any(|step| {
        step.kind == AiAgentRunStepKind::Error && step.status == AiAgentRunStepStatus::Blocked
    }));
}

#[test]
fn harness_allows_action_final_after_successful_action_observation() {
    let service = AiAgentRunService::new();
    let run = service
        .start_run(
            "把 172.16.40.105 主机放到 bwy 分组",
            AiAgentRunLimits::default(),
        )
        .expect("start run");
    service
        .append_step(
            &run.run.id,
            kerminal_lib::models::ai_agent_run::AiAgentRunStepAppendRequest {
                kind: AiAgentRunStepKind::Observation,
                status: Some(AiAgentRunStepStatus::Succeeded),
                tool_id: Some("remote_host.ensure".to_owned()),
                input_json: None,
                observation_json: Some(json!({
                    "status": "succeeded",
                    "summary": "远程主机已可用。"
                })),
                summary: Some("远程主机已可用。".to_owned()),
            },
        )
        .expect("append observation");

    let result = tauri::async_runtime::block_on(service.continue_harness(
        &run.run.id,
        &FinalOnlyModel,
        &RejectingToolExecutor,
    ))
    .expect("continue harness");

    assert_eq!(result.snapshot.run.status, AiAgentRunStatus::Completed);
    assert_eq!(
        result.final_message.as_deref(),
        Some("已将主机加入 bwy 分组。")
    );
}
