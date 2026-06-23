//! AI Agent run service integration tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    error::{AppError, AppResult},
    models::{
        ai_agent_run::{
            AiAgentHarnessDecision, AiAgentHarnessModelInput, AiAgentHarnessModelOutput,
            AiAgentHarnessRunRequest, AiAgentHarnessToolCall, AiAgentRunLimits, AiAgentRunStatus,
            AiAgentRunStepAppendRequest, AiAgentRunStepKind, AiAgentRunStepStatus,
        },
        ai_tool_invocation::{
            AiToolAuditContext, AiToolAuditRecord, AiToolExecuteIfAllowedRequest,
            AiToolExecuteIfAllowedResponse, AiToolInvocationStatus, AiToolObservation,
            AiToolObservationStatus, AiToolPendingInvocation,
        },
        tool_registry::{ToolAuditPolicy, ToolConfirmationPolicy, ToolRiskLevel},
    },
    services::ai_agent_run_service::{
        AiAgentHarnessModel, AiAgentHarnessToolExecutor, AiAgentRunService,
    },
};
use serde_json::json;
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

#[test]
fn start_run_creates_initial_running_state() {
    let service = AiAgentRunService::new();

    let snapshot = service
        .start_run(
            "列出远程主机分组",
            AiAgentRunLimits {
                max_iterations: Some(7),
                max_tool_calls: Some(3),
            },
        )
        .expect("start run");

    assert!(!snapshot.run.id.is_empty());
    assert_eq!(snapshot.run.goal, "列出远程主机分组");
    assert_eq!(snapshot.run.status, AiAgentRunStatus::Running);
    assert_eq!(snapshot.run.conversation_id, None);
    assert_eq!(snapshot.run.conversation_slot_json, None);
    assert_eq!(snapshot.run.iteration, 0);
    assert_eq!(snapshot.run.max_iterations, 7);
    assert_eq!(snapshot.run.max_tool_calls, 3);
    assert!(snapshot.steps.is_empty());
}

#[test]
fn append_observation_step_records_structured_observation() {
    let service = AiAgentRunService::new();
    let run = service
        .start_run("找到 bwy 分组", AiAgentRunLimits::default())
        .expect("start run")
        .run;

    let step = service
        .append_step(
            &run.id,
            AiAgentRunStepAppendRequest {
                kind: AiAgentRunStepKind::Observation,
                status: Some(AiAgentRunStepStatus::Succeeded),
                tool_id: Some("remote_host.group_list".to_owned()),
                input_json: Some(json!({ "query": "bwy" })),
                observation_json: Some(json!({
                    "status": "succeeded",
                    "entities": [{ "groupId": "group-bwy", "name": "bwy" }]
                })),
                summary: Some("找到 bwy 分组".to_owned()),
            },
        )
        .expect("append observation");

    assert_eq!(step.run_id, run.id);
    assert_eq!(step.kind, AiAgentRunStepKind::Observation);
    assert_eq!(step.status, AiAgentRunStepStatus::Succeeded);
    assert_eq!(step.tool_id.as_deref(), Some("remote_host.group_list"));

    let snapshot = service.get_run(&run.id).expect("get run");
    assert_eq!(snapshot.run.iteration, 1);
    assert_eq!(snapshot.steps, vec![step]);
}

#[test]
fn mark_waiting_approval_pauses_running_run() {
    let service = AiAgentRunService::new();
    let run = service
        .start_run("创建远程主机", AiAgentRunLimits::default())
        .expect("start run")
        .run;

    let snapshot = service
        .mark_waiting_approval(&run.id)
        .expect("mark waiting approval");

    assert_eq!(snapshot.run.status, AiAgentRunStatus::WaitingApproval);
    assert_eq!(snapshot.run.iteration, 0);
}

#[test]
fn cancel_is_idempotent_for_cancelled_run() {
    let service = AiAgentRunService::new();
    let run = service
        .start_run("可以取消的任务", AiAgentRunLimits::default())
        .expect("start run")
        .run;

    let first = service.cancel(&run.id).expect("cancel first");
    let second = service.cancel(&run.id).expect("cancel second");

    assert_eq!(first.run.status, AiAgentRunStatus::Cancelled);
    assert_eq!(second.run.status, AiAgentRunStatus::Cancelled);
    assert_eq!(first.run.id, second.run.id);
}

#[test]
fn retry_last_step_truncates_failed_tail_and_restores_running_state() {
    let service = AiAgentRunService::new();
    let run = service
        .start_run("重试失败的工具调用", AiAgentRunLimits::default())
        .expect("start run")
        .run;
    service
        .append_step(
            &run.id,
            AiAgentRunStepAppendRequest {
                kind: AiAgentRunStepKind::Model,
                status: Some(AiAgentRunStepStatus::Succeeded),
                tool_id: None,
                input_json: None,
                observation_json: None,
                summary: Some("准备调用工具".to_owned()),
            },
        )
        .expect("append model");
    service
        .append_step(
            &run.id,
            AiAgentRunStepAppendRequest {
                kind: AiAgentRunStepKind::ToolCall,
                status: Some(AiAgentRunStepStatus::Failed),
                tool_id: Some("remote_host.ensure".to_owned()),
                input_json: Some(json!({ "groupName": "bwy" })),
                observation_json: None,
                summary: Some("缺少主机地址".to_owned()),
            },
        )
        .expect("append failed tool");
    service.mark_blocked(&run.id).expect("mark blocked");

    let snapshot = service.retry_last_step(&run.id).expect("retry last step");

    assert_eq!(snapshot.run.status, AiAgentRunStatus::Running);
    assert_eq!(snapshot.run.iteration, 1);
    assert_eq!(snapshot.steps.len(), 1);
    assert_eq!(snapshot.steps[0].kind, AiAgentRunStepKind::Model);
}

#[test]
fn retry_last_step_removes_failed_observation_with_matching_tool_call() {
    let service = AiAgentRunService::new();
    let run = service
        .start_run("重试失败的工具结果", AiAgentRunLimits::default())
        .expect("start run")
        .run;
    service
        .append_step(
            &run.id,
            AiAgentRunStepAppendRequest {
                kind: AiAgentRunStepKind::Model,
                status: Some(AiAgentRunStepStatus::Succeeded),
                tool_id: None,
                input_json: None,
                observation_json: None,
                summary: Some("准备调用工具".to_owned()),
            },
        )
        .expect("append model");
    service
        .append_step(
            &run.id,
            AiAgentRunStepAppendRequest {
                kind: AiAgentRunStepKind::ToolCall,
                status: Some(AiAgentRunStepStatus::Running),
                tool_id: Some("ssh.command_on_resolved_host".to_owned()),
                input_json: Some(json!({ "command": "uptime" })),
                observation_json: None,
                summary: Some("执行远程命令".to_owned()),
            },
        )
        .expect("append tool call");
    service
        .append_step(
            &run.id,
            AiAgentRunStepAppendRequest {
                kind: AiAgentRunStepKind::Observation,
                status: Some(AiAgentRunStepStatus::Failed),
                tool_id: Some("ssh.command_on_resolved_host".to_owned()),
                input_json: None,
                observation_json: Some(json!({
                    "status": "failed",
                    "summary": "SSH 命令失败"
                })),
                summary: Some("SSH 命令失败".to_owned()),
            },
        )
        .expect("append failed observation");
    service.mark_blocked(&run.id).expect("mark blocked");

    let snapshot = service.retry_last_step(&run.id).expect("retry last step");

    assert_eq!(snapshot.run.status, AiAgentRunStatus::Running);
    assert_eq!(snapshot.run.iteration, 1);
    assert_eq!(snapshot.steps.len(), 1);
    assert!(
        snapshot
            .steps
            .iter()
            .all(|step| step.kind != AiAgentRunStepKind::ToolCall),
        "retry must not leave a dangling tool call without its observation"
    );
}

#[test]
fn retry_last_step_rejects_completed_runs() {
    let service = AiAgentRunService::new();
    let run = service
        .start_run("已完成任务", AiAgentRunLimits::default())
        .expect("start run")
        .run;
    service.mark_completed(&run.id).expect("mark completed");

    let error = service
        .retry_last_step(&run.id)
        .expect_err("completed run cannot retry");

    assert!(error.to_string().contains("已完成"));
}

#[test]
fn resume_after_approval_records_audit_observation_and_returns_to_running() {
    let service = AiAgentRunService::new();
    let run = service
        .start_run("创建主机后继续连接", AiAgentRunLimits::default())
        .expect("start run")
        .run;
    service
        .mark_waiting_approval(&run.id)
        .expect("mark waiting approval");

    let snapshot = service
        .resume_after_approval(
            &run.id,
            audit_record("remote_host.create", AiToolInvocationStatus::Succeeded),
        )
        .expect("resume run");

    assert_eq!(snapshot.run.status, AiAgentRunStatus::Running);
    let observation = snapshot
        .steps
        .iter()
        .find(|step| step.kind == AiAgentRunStepKind::Observation)
        .expect("audit observation step");
    assert_eq!(observation.status, AiAgentRunStepStatus::Succeeded);
    assert_eq!(observation.tool_id.as_deref(), Some("remote_host.create"));
    assert_eq!(
        observation
            .observation_json
            .as_ref()
            .and_then(|value| value.get("auditId"))
            .and_then(|value| value.as_str()),
        Some("audit-remote_host.create")
    );
}

#[test]
fn resume_after_approval_prefers_structured_audit_observation() {
    let service = AiAgentRunService::new();
    let run = service
        .start_run("创建主机后继续连接", AiAgentRunLimits::default())
        .expect("start run")
        .run;
    service
        .mark_waiting_approval(&run.id)
        .expect("mark waiting approval");

    let mut audit = audit_record("remote_host.ensure", AiToolInvocationStatus::Succeeded);
    audit.observation_json = Some(json!({
        "status": "succeeded",
        "summary": "远程主机已可用。",
        "data": {
            "hostId": "host-bwy",
            "groupId": "group-bwy",
            "host": "172.16.40.104"
        },
        "entities": [
            {
                "type": "remoteHost",
                "id": "host-bwy",
                "label": "172.16.40.104",
                "metadata": {
                    "groupId": "group-bwy",
                    "host": "172.16.40.104"
                }
            }
        ],
        "recoverable": false,
        "errorKind": null,
        "nextHints": ["继续调用 ssh.ensure_connected。"],
        "pendingInvocationId": null,
        "auditId": "stale-audit-id"
    }));

    let snapshot = service
        .resume_after_approval(&run.id, audit)
        .expect("resume run");

    assert_eq!(snapshot.run.status, AiAgentRunStatus::Running);
    let observation_json = snapshot
        .steps
        .iter()
        .find(|step| step.kind == AiAgentRunStepKind::Observation)
        .and_then(|step| step.observation_json.as_ref())
        .expect("structured observation json");
    assert_eq!(observation_json["data"]["hostId"], "host-bwy");
    assert_eq!(observation_json["entities"][0]["id"], "host-bwy");
    assert_eq!(
        observation_json["auditId"], "audit-remote_host.ensure",
        "resume should rewrite stale audit ids to the persisted audit id"
    );
}

#[test]
fn resume_after_rejected_approval_blocks_run() {
    let service = AiAgentRunService::new();
    let run = service
        .start_run("创建主机后继续连接", AiAgentRunLimits::default())
        .expect("start run")
        .run;
    service
        .mark_waiting_approval(&run.id)
        .expect("mark waiting approval");

    let snapshot = service
        .resume_after_approval(
            &run.id,
            audit_record("remote_host.create", AiToolInvocationStatus::Rejected),
        )
        .expect("resume run");

    assert_eq!(snapshot.run.status, AiAgentRunStatus::Blocked);
    assert!(snapshot.steps.iter().any(|step| {
        step.kind == AiAgentRunStepKind::Observation && step.status == AiAgentRunStepStatus::Blocked
    }));
}

#[test]
fn harness_executes_tool_and_feeds_observation_back_to_model() {
    let service = AiAgentRunService::new();
    let model = ScriptedHarnessModel::new(vec![
        AiAgentHarnessModelOutput {
            summary: Some("先列出终端".to_owned()),
            decision: AiAgentHarnessDecision::ToolCall {
                call: AiAgentHarnessToolCall {
                    tool_id: "terminal.list".to_owned(),
                    arguments: json!({}),
                    reason: Some("确认当前终端会话".to_owned()),
                },
            },
        },
        AiAgentHarnessModelOutput {
            summary: Some("已拿到 observation".to_owned()),
            decision: AiAgentHarnessDecision::Final {
                message: "当前没有终端会话。".to_owned(),
            },
        },
    ]);
    let tools = RecordingToolExecutor::new(AiToolExecuteIfAllowedResponse {
        observation: AiToolObservation {
            status: AiToolObservationStatus::Succeeded,
            summary: Some("找到 0 个终端会话".to_owned()),
            data: json!({ "sessionCount": 0 }),
            entities: Vec::new(),
            recoverable: false,
            error_kind: None,
            next_hints: Vec::new(),
            pending_invocation_id: None,
            audit_id: Some("audit-terminal-list".to_owned()),
        },
        pending_invocation: None,
        audit: None,
    });

    let result = tauri::async_runtime::block_on(service.run_harness(
        AiAgentHarnessRunRequest {
            goal: "看看当前终端".to_owned(),
            limits: AiAgentRunLimits {
                max_iterations: Some(8),
                max_tool_calls: Some(2),
            },
            conversation_id: Some("conv-run".to_owned()),
            conversation_slot_json: Some("{\"slotKey\":\"ai\"}".to_owned()),
        },
        &model,
        &tools,
    ))
    .expect("run harness");

    assert_eq!(result.snapshot.run.status, AiAgentRunStatus::Completed);
    assert_eq!(
        result.snapshot.run.conversation_id.as_deref(),
        Some("conv-run")
    );
    assert_eq!(
        result.snapshot.run.conversation_slot_json.as_deref(),
        Some("{\"slotKey\":\"ai\"}")
    );
    assert_eq!(result.final_message.as_deref(), Some("当前没有终端会话。"));
    assert_eq!(result.snapshot.steps.len(), 5);
    assert!(model
        .inputs()
        .get(1)
        .expect("second model input")
        .steps
        .iter()
        .any(|step| step.kind == AiAgentRunStepKind::Observation
            && step.tool_id.as_deref() == Some("terminal.list")));

    let requests = tools.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].tool_id, "terminal.list");
    assert_eq!(requests[0].conversation_id.as_deref(), Some("conv-run"));
    assert_eq!(
        requests[0].run_id.as_deref(),
        Some(result.snapshot.run.id.as_str())
    );
    assert!(requests[0].step_id.as_deref().is_some());
}

#[test]
fn harness_resume_continues_same_run_after_approval() {
    let service = AiAgentRunService::new();
    let model = ScriptedHarnessModel::new(vec![
        AiAgentHarnessModelOutput {
            summary: Some("创建远程主机".to_owned()),
            decision: AiAgentHarnessDecision::ToolCall {
                call: AiAgentHarnessToolCall {
                    tool_id: "remote_host.create".to_owned(),
                    arguments: json!({ "host": "172.16.40.104" }),
                    reason: Some("添加 bwy 主机".to_owned()),
                },
            },
        },
        AiAgentHarnessModelOutput {
            summary: Some("审批结果已进入上下文".to_owned()),
            decision: AiAgentHarnessDecision::Final {
                message: "主机已创建，下一步可以连接。".to_owned(),
            },
        },
    ]);
    let pending = pending_invocation("remote_host.create");
    let approval_tools = RecordingToolExecutor::new(AiToolExecuteIfAllowedResponse {
        observation: AiToolObservation {
            status: AiToolObservationStatus::NeedsApproval,
            summary: Some("需要批准创建远程主机".to_owned()),
            data: json!({}),
            entities: Vec::new(),
            recoverable: true,
            error_kind: None,
            next_hints: Vec::new(),
            pending_invocation_id: Some(pending.id.clone()),
            audit_id: None,
        },
        pending_invocation: Some(pending),
        audit: None,
    });
    let noop_tools = RecordingToolExecutor::new(succeeded_observation("unused"));

    let paused = tauri::async_runtime::block_on(service.run_harness(
        AiAgentHarnessRunRequest {
            goal: "添加主机后继续".to_owned(),
            limits: AiAgentRunLimits {
                max_iterations: Some(12),
                max_tool_calls: Some(2),
            },
            conversation_id: Some("conv-resume".to_owned()),
            conversation_slot_json: Some("{\"slotKey\":\"ai\"}".to_owned()),
        },
        &model,
        &approval_tools,
    ))
    .expect("run pauses for approval");
    let run_id = paused.snapshot.run.id.clone();

    let mut audit = audit_record("remote_host.ensure", AiToolInvocationStatus::Succeeded);
    audit.observation_json = Some(json!({
        "status": "succeeded",
        "summary": "远程主机已可用。",
        "data": {
            "hostId": "host-created",
            "groupId": "group-bwy",
            "host": {
                "id": "host-created",
                "groupId": "group-bwy",
                "name": "172.16.40.104",
                "host": "172.16.40.104",
                "port": 22,
                "username": "root",
                "production": false
            }
        },
        "entities": [{
            "type": "remoteHost",
            "id": "host-created",
            "groupId": "group-bwy",
            "name": "172.16.40.104",
            "host": "172.16.40.104",
            "port": 22,
            "username": "root",
            "production": false
        }],
        "recoverable": false,
        "errorKind": null,
        "nextHints": ["继续调用 ssh.ensure_connected。"],
        "pendingInvocationId": null,
        "auditId": "audit-remote_host.ensure"
    }));
    service
        .resume_after_approval(&run_id, audit)
        .expect("write approval observation");
    let completed =
        tauri::async_runtime::block_on(service.continue_harness(&run_id, &model, &noop_tools))
            .expect("continue harness");

    assert_eq!(completed.snapshot.run.id, run_id);
    assert_eq!(completed.snapshot.run.status, AiAgentRunStatus::Completed);
    assert_eq!(
        completed.final_message.as_deref(),
        Some("主机已创建，下一步可以连接。")
    );
    let inputs = model.inputs();
    let resolved_remote_host = inputs
        .get(1)
        .expect("resume model input")
        .resolved_targets
        .last_remote_host
        .as_ref()
        .expect("last remote host target");
    assert_eq!(resolved_remote_host.host_id, "host-created");
    assert_eq!(resolved_remote_host.group_id.as_deref(), Some("group-bwy"));
    assert_eq!(resolved_remote_host.host.as_deref(), Some("172.16.40.104"));
    assert_eq!(
        resolved_remote_host.source_tool_id.as_deref(),
        Some("remote_host.ensure")
    );
    assert!(model
        .inputs()
        .get(1)
        .expect("resume model input")
        .steps
        .iter()
        .any(|step| step.kind == AiAgentRunStepKind::Observation
            && step.tool_id.as_deref() == Some("remote_host.ensure")
            && step
                .observation_json
                .as_ref()
                .and_then(|value| value.get("auditId"))
                .and_then(|value| value.as_str())
                == Some("audit-remote_host.ensure")));
}

#[test]
fn harness_resolved_targets_ignore_failed_remote_host_candidates() {
    let service = AiAgentRunService::new();
    let model = ScriptedHarnessModel::new(vec![
        AiAgentHarnessModelOutput {
            summary: Some("尝试连接主机".to_owned()),
            decision: AiAgentHarnessDecision::ToolCall {
                call: AiAgentHarnessToolCall {
                    tool_id: "ssh.ensure_connected".to_owned(),
                    arguments: json!({ "host": "172.16.40.104", "cols": 100, "rows": 30 }),
                    reason: Some("解析并连接主机".to_owned()),
                },
            },
        },
        AiAgentHarnessModelOutput {
            summary: Some("需要补目标".to_owned()),
            decision: AiAgentHarnessDecision::Final {
                message: "找到了多个候选，需要更具体的主机。".to_owned(),
            },
        },
    ]);
    let tools = RecordingToolExecutor::new(AiToolExecuteIfAllowedResponse {
        observation: AiToolObservation {
            status: AiToolObservationStatus::Failed,
            summary: Some("找到多个匹配的 SSH 主机。".to_owned()),
            data: json!({
                "errorKind": "ambiguousTarget",
                "candidates": [
                    { "hostId": "host-a", "host": "172.16.40.104", "username": "root" },
                    { "hostId": "host-b", "host": "172.16.40.104", "username": "deploy" }
                ]
            }),
            entities: vec![
                json!({
                    "type": "remoteHost",
                    "id": "host-a",
                    "host": "172.16.40.104",
                    "username": "root"
                }),
                json!({
                    "type": "remoteHost",
                    "id": "host-b",
                    "host": "172.16.40.104",
                    "username": "deploy"
                }),
            ],
            recoverable: true,
            error_kind: Some("ambiguousTarget".to_owned()),
            next_hints: vec!["请补 hostId。".to_owned()],
            pending_invocation_id: None,
            audit_id: Some("audit-ambiguous".to_owned()),
        },
        pending_invocation: None,
        audit: None,
    });

    let result = tauri::async_runtime::block_on(service.run_harness(
        AiAgentHarnessRunRequest {
            goal: "连接 172.16.40.104".to_owned(),
            limits: AiAgentRunLimits {
                max_iterations: Some(8),
                max_tool_calls: Some(2),
            },
            conversation_id: None,
            conversation_slot_json: None,
        },
        &model,
        &tools,
    ))
    .expect("run harness");

    assert_eq!(result.snapshot.run.status, AiAgentRunStatus::Completed);
    assert!(model
        .inputs()
        .get(1)
        .expect("second model input")
        .resolved_targets
        .last_remote_host
        .is_none());
}

#[test]
fn harness_resume_preserves_context_and_tool_call_count() {
    let service = AiAgentRunService::new();
    let model = ScriptedHarnessModel::new(vec![
        AiAgentHarnessModelOutput {
            summary: Some("先创建主机".to_owned()),
            decision: AiAgentHarnessDecision::ToolCall {
                call: AiAgentHarnessToolCall {
                    tool_id: "remote_host.create".to_owned(),
                    arguments: json!({ "host": "172.16.40.104" }),
                    reason: Some("添加主机".to_owned()),
                },
            },
        },
        AiAgentHarnessModelOutput {
            summary: Some("继续连接主机".to_owned()),
            decision: AiAgentHarnessDecision::ToolCall {
                call: AiAgentHarnessToolCall {
                    tool_id: "ssh.connect".to_owned(),
                    arguments: json!({ "hostId": "host-created" }),
                    reason: Some("连接刚创建的主机".to_owned()),
                },
            },
        },
    ]);
    let pending = pending_invocation("remote_host.create");
    let approval_tools = RecordingToolExecutor::new(AiToolExecuteIfAllowedResponse {
        observation: AiToolObservation {
            status: AiToolObservationStatus::NeedsApproval,
            summary: Some("需要批准创建远程主机".to_owned()),
            data: json!({}),
            entities: Vec::new(),
            recoverable: true,
            error_kind: None,
            next_hints: Vec::new(),
            pending_invocation_id: Some(pending.id.clone()),
            audit_id: None,
        },
        pending_invocation: Some(pending),
        audit: None,
    });
    let second_tools = RecordingToolExecutor::new(succeeded_observation("ssh connected"));

    let paused = tauri::async_runtime::block_on(service.run_harness(
        AiAgentHarnessRunRequest {
            goal: "添加主机后连接".to_owned(),
            limits: AiAgentRunLimits {
                max_iterations: Some(12),
                max_tool_calls: Some(1),
            },
            conversation_id: Some("conv-preserved".to_owned()),
            conversation_slot_json: Some("{\"slotKey\":\"ai\"}".to_owned()),
        },
        &model,
        &approval_tools,
    ))
    .expect("run pauses for approval");
    let run_id = paused.snapshot.run.id.clone();

    service
        .resume_after_approval(
            &run_id,
            audit_record("remote_host.create", AiToolInvocationStatus::Succeeded),
        )
        .expect("write approval observation");
    let blocked =
        tauri::async_runtime::block_on(service.continue_harness(&run_id, &model, &second_tools))
            .expect("continue harness");

    assert_eq!(blocked.snapshot.run.status, AiAgentRunStatus::Blocked);
    assert!(blocked
        .final_message
        .as_deref()
        .unwrap_or_default()
        .contains("最大工具调用次数"));
    assert!(
        second_tools.requests().is_empty(),
        "resume must not reset existing tool call count and execute a second tool"
    );
    assert_eq!(
        blocked.snapshot.run.conversation_id.as_deref(),
        Some("conv-preserved")
    );
    assert_eq!(
        blocked.snapshot.run.conversation_slot_json.as_deref(),
        Some("{\"slotKey\":\"ai\"}")
    );
}

#[test]
fn harness_continue_passes_original_context_to_next_tool() {
    let service = AiAgentRunService::new();
    let model = ScriptedHarnessModel::new(vec![
        AiAgentHarnessModelOutput {
            summary: Some("先创建主机".to_owned()),
            decision: AiAgentHarnessDecision::ToolCall {
                call: AiAgentHarnessToolCall {
                    tool_id: "remote_host.create".to_owned(),
                    arguments: json!({ "host": "172.16.40.104" }),
                    reason: Some("添加主机".to_owned()),
                },
            },
        },
        AiAgentHarnessModelOutput {
            summary: Some("继续连接主机".to_owned()),
            decision: AiAgentHarnessDecision::ToolCall {
                call: AiAgentHarnessToolCall {
                    tool_id: "ssh.connect".to_owned(),
                    arguments: json!({ "hostId": "host-created" }),
                    reason: Some("连接刚创建的主机".to_owned()),
                },
            },
        },
        AiAgentHarnessModelOutput {
            summary: Some("连接完成".to_owned()),
            decision: AiAgentHarnessDecision::Final {
                message: "主机已创建并连接。".to_owned(),
            },
        },
    ]);
    let pending = pending_invocation("remote_host.create");
    let approval_tools = RecordingToolExecutor::new(AiToolExecuteIfAllowedResponse {
        observation: AiToolObservation {
            status: AiToolObservationStatus::NeedsApproval,
            summary: Some("需要批准创建远程主机".to_owned()),
            data: json!({}),
            entities: Vec::new(),
            recoverable: true,
            error_kind: None,
            next_hints: Vec::new(),
            pending_invocation_id: Some(pending.id.clone()),
            audit_id: None,
        },
        pending_invocation: Some(pending),
        audit: None,
    });
    let second_tools = RecordingToolExecutor::new(succeeded_observation("ssh connected"));

    let paused = tauri::async_runtime::block_on(service.run_harness(
        AiAgentHarnessRunRequest {
            goal: "添加主机后连接".to_owned(),
            limits: AiAgentRunLimits {
                max_iterations: Some(14),
                max_tool_calls: Some(3),
            },
            conversation_id: Some("conv-tool".to_owned()),
            conversation_slot_json: Some("{\"slotKey\":\"ai\"}".to_owned()),
        },
        &model,
        &approval_tools,
    ))
    .expect("run pauses for approval");
    let run_id = paused.snapshot.run.id.clone();

    service
        .resume_after_approval(
            &run_id,
            audit_record("remote_host.create", AiToolInvocationStatus::Succeeded),
        )
        .expect("write approval observation");
    let completed =
        tauri::async_runtime::block_on(service.continue_harness(&run_id, &model, &second_tools))
            .expect("continue harness");

    assert_eq!(completed.snapshot.run.status, AiAgentRunStatus::Completed);
    let requests = second_tools.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].tool_id, "ssh.connect");
    assert_eq!(requests[0].conversation_id.as_deref(), Some("conv-tool"));
    assert_eq!(
        requests[0].conversation_slot_json.as_deref(),
        Some("{\"slotKey\":\"ai\"}")
    );
    assert_eq!(requests[0].run_id.as_deref(), Some(run_id.as_str()));
}

#[test]
fn harness_pauses_when_tool_needs_approval() {
    let service = AiAgentRunService::new();
    let model = ScriptedHarnessModel::new(vec![AiAgentHarnessModelOutput {
        summary: Some("创建远程主机".to_owned()),
        decision: AiAgentHarnessDecision::ToolCall {
            call: AiAgentHarnessToolCall {
                tool_id: "remote_host.create".to_owned(),
                arguments: json!({ "host": "172.16.40.104" }),
                reason: Some("添加 bwy 主机".to_owned()),
            },
        },
    }]);
    let pending = pending_invocation("remote_host.create");
    let tools = RecordingToolExecutor::new(AiToolExecuteIfAllowedResponse {
        observation: AiToolObservation {
            status: AiToolObservationStatus::NeedsApproval,
            summary: Some("需要批准创建远程主机".to_owned()),
            data: json!({}),
            entities: Vec::new(),
            recoverable: true,
            error_kind: None,
            next_hints: vec!["用户批准后继续 run".to_owned()],
            pending_invocation_id: Some(pending.id.clone()),
            audit_id: None,
        },
        pending_invocation: Some(pending.clone()),
        audit: None,
    });

    let result = tauri::async_runtime::block_on(service.run_harness(
        AiAgentHarnessRunRequest {
            goal: "添加远程主机".to_owned(),
            limits: AiAgentRunLimits {
                max_iterations: Some(5),
                max_tool_calls: Some(1),
            },
            conversation_id: None,
            conversation_slot_json: None,
        },
        &model,
        &tools,
    ))
    .expect("run harness");

    assert_eq!(
        result.snapshot.run.status,
        AiAgentRunStatus::WaitingApproval
    );
    assert_eq!(result.pending_invocation.as_ref(), Some(&pending));
    assert!(result.snapshot.steps.iter().any(|step| {
        step.kind == AiAgentRunStepKind::Observation
            && step.status == AiAgentRunStepStatus::WaitingApproval
    }));
}

fn succeeded_observation(summary: &str) -> AiToolExecuteIfAllowedResponse {
    AiToolExecuteIfAllowedResponse {
        observation: AiToolObservation {
            status: AiToolObservationStatus::Succeeded,
            summary: Some(summary.to_owned()),
            data: json!({}),
            entities: Vec::new(),
            recoverable: false,
            error_kind: None,
            next_hints: Vec::new(),
            pending_invocation_id: None,
            audit_id: Some(format!("audit-{summary}")),
        },
        pending_invocation: None,
        audit: None,
    }
}

#[test]
fn harness_blocks_after_max_tool_calls() {
    let service = AiAgentRunService::new();
    let model = ScriptedHarnessModel::new(vec![tool_call_output(), tool_call_output()]);
    let tools = RecordingToolExecutor::new(AiToolExecuteIfAllowedResponse {
        observation: AiToolObservation {
            status: AiToolObservationStatus::Succeeded,
            summary: Some("ok".to_owned()),
            data: json!({}),
            entities: Vec::new(),
            recoverable: false,
            error_kind: None,
            next_hints: Vec::new(),
            pending_invocation_id: None,
            audit_id: None,
        },
        pending_invocation: None,
        audit: None,
    });

    let result = tauri::async_runtime::block_on(service.run_harness(
        AiAgentHarnessRunRequest {
            goal: "一直调工具".to_owned(),
            limits: AiAgentRunLimits {
                max_iterations: Some(8),
                max_tool_calls: Some(1),
            },
            conversation_id: None,
            conversation_slot_json: None,
        },
        &model,
        &tools,
    ))
    .expect("run harness");

    assert_eq!(result.snapshot.run.status, AiAgentRunStatus::Blocked);
    assert_eq!(tools.requests().len(), 1);
    assert!(result
        .final_message
        .as_deref()
        .unwrap_or_default()
        .contains("最大工具调用次数"));
}

#[derive(Clone)]
struct ScriptedHarnessModel {
    outputs: Arc<Mutex<Vec<AiAgentHarnessModelOutput>>>,
    inputs: Arc<Mutex<Vec<AiAgentHarnessModelInput>>>,
}

impl ScriptedHarnessModel {
    fn new(outputs: Vec<AiAgentHarnessModelOutput>) -> Self {
        Self {
            outputs: Arc::new(Mutex::new(outputs.into_iter().rev().collect())),
            inputs: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn inputs(&self) -> Vec<AiAgentHarnessModelInput> {
        self.inputs.lock().expect("inputs lock").clone()
    }
}

impl AiAgentHarnessModel for ScriptedHarnessModel {
    fn next_turn<'a>(
        &'a self,
        input: AiAgentHarnessModelInput,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiAgentHarnessModelOutput>> + Send + 'a>> {
        Box::pin(async move {
            self.inputs.lock().expect("inputs lock").push(input);
            self.outputs
                .lock()
                .expect("outputs lock")
                .pop()
                .ok_or_else(|| AppError::AiAgent("scripted model exhausted".to_owned()))
        })
    }
}

#[derive(Clone)]
struct RecordingToolExecutor {
    response: AiToolExecuteIfAllowedResponse,
    requests: Arc<Mutex<Vec<AiToolExecuteIfAllowedRequest>>>,
}

impl RecordingToolExecutor {
    fn new(response: AiToolExecuteIfAllowedResponse) -> Self {
        Self {
            response,
            requests: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn requests(&self) -> Vec<AiToolExecuteIfAllowedRequest> {
        self.requests.lock().expect("requests lock").clone()
    }
}

impl AiAgentHarnessToolExecutor for RecordingToolExecutor {
    fn execute_tool<'a>(
        &'a self,
        request: AiToolExecuteIfAllowedRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiToolExecuteIfAllowedResponse>> + Send + 'a>> {
        Box::pin(async move {
            self.requests.lock().expect("requests lock").push(request);
            Ok(self.response.clone())
        })
    }
}

fn tool_call_output() -> AiAgentHarnessModelOutput {
    AiAgentHarnessModelOutput {
        summary: Some("调工具".to_owned()),
        decision: AiAgentHarnessDecision::ToolCall {
            call: AiAgentHarnessToolCall {
                tool_id: "terminal.list".to_owned(),
                arguments: json!({}),
                reason: None,
            },
        },
    }
}

fn pending_invocation(tool_id: &str) -> AiToolPendingInvocation {
    AiToolPendingInvocation {
        id: format!("pending-{tool_id}"),
        tool_id: tool_id.to_owned(),
        tool_title: "创建远程主机".to_owned(),
        risk: ToolRiskLevel::Remote,
        confirmation: ToolConfirmationPolicy::Always,
        audit: ToolAuditPolicy::Summary,
        arguments_summary: "host=172.16.40.104".to_owned(),
        risk_summary: None,
        client_action: None,
        reason: Some("添加 bwy 主机".to_owned()),
        requested_by: Some("test-agent-run".to_owned()),
        requires_confirmation: true,
        status: AiToolInvocationStatus::Pending,
        created_at: "1".to_owned(),
        conversation_id: None,
        conversation_slot_json: None,
        run_id: None,
        step_id: None,
    }
}

fn audit_record(tool_id: &str, status: AiToolInvocationStatus) -> AiToolAuditRecord {
    AiToolAuditRecord {
        id: format!("audit-{tool_id}"),
        invocation_id: format!("pending-{tool_id}"),
        tool_id: tool_id.to_owned(),
        tool_title: "创建远程主机".to_owned(),
        risk: ToolRiskLevel::Remote,
        confirmation: ToolConfirmationPolicy::Always,
        arguments_summary: "host=172.16.40.104".to_owned(),
        risk_summary: None,
        status,
        result_summary: Some("工具确认完成".to_owned()),
        error: None,
        created_at: "1".to_owned(),
        completed_at: "2".to_owned(),
        audit_context: Some(AiToolAuditContext {
            run_id: Some("run-test".to_owned()),
            ..AiToolAuditContext::default()
        }),
        observation_json: None,
    }
}
