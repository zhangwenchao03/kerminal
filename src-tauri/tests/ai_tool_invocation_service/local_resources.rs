//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;
use serde_json::json;

#[test]
fn prepare_workspace_focus_tab_rejects_blank_tab_id() {
    let (_home, state) = setup_state();

    let error = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("workspace.focus_tab", json!({ "tabId": "   " })),
        )
        .expect_err("blank tab id should be rejected");

    assert!(error.to_string().contains("tabId 不能为空"));
}

#[test]
fn prepare_workspace_open_tool_rejects_unknown_tool_id() {
    let (_home, state) = setup_state();

    let error = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("workspace.open_tool", json!({ "toolId": "unknown" })),
        )
        .expect_err("unknown tool id should be rejected");

    assert!(error.to_string().contains("toolId 只支持"));
}

#[test]
fn confirm_profile_create_persists_profile_and_audit_after_approval() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "profile.create",
                json!({
                    "name": "AI PowerShell",
                    "shell": "pwsh.exe",
                    "args": ["-NoLogo"],
                    "env": { "TERM": "xterm-256color" },
                    "setDefault": false
                }),
            ),
        )
        .expect("prepare profile create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("approve profile create");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "profile.create");
    assert!(audit
        .result_summary
        .expect("profile result summary")
        .contains("AI PowerShell"));

    let profiles = state
        .profiles()
        .list_profiles(state.storage())
        .expect("list profiles");
    let created = profiles
        .iter()
        .find(|profile| profile.name == "AI PowerShell")
        .expect("created profile");
    assert_eq!(created.shell, "pwsh.exe");
    assert_eq!(created.args, vec!["-NoLogo"]);
    assert_eq!(created.env.get("TERM"), Some(&"xterm-256color".to_owned()));
}

#[test]
fn confirm_profile_create_rejection_does_not_persist_profile() {
    let (_home, state) = setup_state();
    let before_count = state
        .profiles()
        .list_profiles(state.storage())
        .expect("list profiles before")
        .len();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "profile.create",
                json!({ "name": "不应创建", "shell": "pwsh.exe" }),
            ),
        )
        .expect("prepare profile create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject profile create");
    let after_count = state
        .profiles()
        .list_profiles(state.storage())
        .expect("list profiles after")
        .len();

    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert_eq!(before_count, after_count);
}

#[test]
fn confirm_profile_create_invalid_env_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "profile.create",
                json!({
                    "name": "非法 env Profile",
                    "shell": "pwsh.exe",
                    "env": { "TERM": 256 }
                }),
            ),
        )
        .expect("prepare invalid profile create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("invalid profile create should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert!(audit
        .error
        .expect("profile failure error")
        .contains("env 必须是字符串值对象"));
}

#[test]
fn confirm_snippet_create_persists_snippet_and_audit_after_approval() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "snippet.create",
                json!({
                    "title": "检查 Git 状态",
                    "command": "git status --short",
                    "description": "日常开发检查",
                    "tags": [" git ", "GIT", "daily"],
                    "scope": "local"
                }),
            ),
        )
        .expect("prepare snippet create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("approve snippet create");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "snippet.create");
    assert!(audit
        .result_summary
        .expect("snippet summary")
        .contains("检查 Git 状态"));

    let snippets = state
        .snippets()
        .list_snippets(state.storage(), Default::default())
        .expect("list snippets");
    let created = snippets
        .iter()
        .find(|snippet| snippet.title == "检查 Git 状态")
        .expect("created snippet");
    assert_eq!(created.command, "git status --short");
    assert_eq!(created.tags, vec!["git", "daily"]);
    assert_eq!(created.scope, SnippetScope::Local);
}

#[test]
fn confirm_snippet_create_rejection_does_not_persist_snippet() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "snippet.create",
                json!({ "title": "不应创建", "command": "echo nope" }),
            ),
        )
        .expect("prepare snippet create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject snippet create");

    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert!(state
        .snippets()
        .list_snippets(state.storage(), Default::default())
        .expect("list snippets")
        .is_empty());
}

#[test]
fn confirm_snippet_create_invalid_scope_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "snippet.create",
                json!({
                    "title": "非法片段",
                    "command": "echo bad",
                    "scope": "remote"
                }),
            ),
        )
        .expect("prepare invalid snippet create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("invalid snippet create should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "snippet.create");
    assert!(audit
        .error
        .expect("snippet failure error")
        .contains("未知脚本片段作用域"));
}

#[test]
fn confirm_workflow_create_persists_workflow_and_audit_after_approval() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "workflow.create",
                json!({
                    "title": "本地质量检查",
                    "description": "由 AI 保存的多步骤质量检查流程。",
                    "tags": [" quality ", "QUALITY", "ai"],
                    "scope": "local",
                    "steps": [
                        {
                            "title": "检查 Git 状态",
                            "command": "git status --short",
                            "description": "确认仓库状态",
                            "scope": "local",
                            "requiresConfirmation": false
                        },
                        {
                            "title": "运行质量门禁",
                            "command": "echo token=secret-value && npm run check",
                            "requiresConfirmation": true
                        }
                    ]
                }),
            ),
        )
        .expect("prepare workflow create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("approve workflow create");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "workflow.create");
    let summary = audit.result_summary.expect("workflow summary");
    assert!(summary.contains("本地质量检查"));
    assert!(summary.contains("2 个步骤"));
    assert!(!summary.contains("secret-value"));

    let workflows = state
        .workflows()
        .list_workflows(state.storage(), Default::default())
        .expect("list workflows");
    let created = workflows
        .iter()
        .find(|workflow| workflow.title == "本地质量检查")
        .expect("created workflow");
    assert_eq!(
        created.description.as_deref(),
        Some("由 AI 保存的多步骤质量检查流程。")
    );
    assert_eq!(created.tags, vec!["quality", "ai"]);
    assert_eq!(created.scope, WorkflowScope::Local);
    assert_eq!(created.steps.len(), 2);
    assert_eq!(created.steps[0].title, "检查 Git 状态");
    assert_eq!(created.steps[0].command, "git status --short");
    assert_eq!(created.steps[0].scope, Some(WorkflowScope::Local));
    assert!(!created.steps[0].requires_confirmation);
    assert_eq!(created.steps[1].title, "运行质量门禁");
    assert!(created.steps[1].requires_confirmation);
}

#[test]
fn confirm_workflow_create_rejection_does_not_persist_workflow() {
    let (_home, state) = setup_state();
    let before_count = state
        .workflows()
        .list_workflows(state.storage(), Default::default())
        .expect("list workflows before rejection")
        .len();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "workflow.create",
                json!({
                    "title": "不应创建",
                    "steps": [
                        { "title": "跳过", "command": "echo nope" }
                    ]
                }),
            ),
        )
        .expect("prepare workflow create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject workflow create");
    let after_count = state
        .workflows()
        .list_workflows(state.storage(), Default::default())
        .expect("list workflows after rejection")
        .len();

    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert_eq!(before_count, after_count);
}

#[test]
fn confirm_workflow_create_invalid_steps_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "workflow.create",
                json!({
                    "title": "非法工作流",
                    "steps": []
                }),
            ),
        )
        .expect("prepare invalid workflow create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("invalid workflow create should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "workflow.create");
    assert!(audit
        .error
        .expect("workflow failure error")
        .contains("工作流至少需要一个命令步骤"));
    assert!(state
        .workflows()
        .list_workflows(state.storage(), Default::default())
        .expect("list workflows")
        .is_empty());
}

#[test]
fn prepare_remote_host_create_omits_credential_ref_summary() {
    let (_home, state) = setup_state();
    let group = create_test_remote_host_group(&state);

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "remote_host.create",
                json!({
                    "authType": "agent",
                    "groupId": group.id,
                    "host": "ai-dev.internal",
                    "name": "AI Dev",
                    "port": 22,
                    "production": true,
                    "tags": ["ai", "dev"],
                    "username": "deploy"
                }),
            ),
        )
        .expect("prepare remote host create");

    assert_eq!(pending.tool_id, "remote_host.create");
    assert_eq!(pending.tool_title, "创建远程主机");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("name=AI Dev"));
    assert!(!pending.arguments_summary.contains("credentialRef"));
}

#[test]
fn confirm_remote_host_create_persists_host_and_audit_after_approval() {
    let (_home, state) = setup_state();
    let group = create_test_remote_host_group(&state);

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "remote_host.create",
                json!({
                    "authType": "agent",
                    "groupId": group.id,
                    "host": "ai-dev.internal",
                    "name": "AI Dev",
                    "port": 2222,
                    "production": true,
                    "tags": [" ai ", "AI", "dev"],
                    "username": "deploy"
                }),
            ),
        )
        .expect("prepare remote host create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("approve remote host create");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "remote_host.create");
    let result_summary = audit.result_summary.expect("remote host summary");
    assert!(result_summary.contains("AI Dev"));
    assert!(result_summary.contains("deploy@ai-dev.internal:2222"));
    assert!(result_summary.contains("生产主机"));

    let tree = state
        .remote_hosts()
        .list_tree(state.storage())
        .expect("list remote host tree");
    let created = tree
        .iter()
        .flat_map(|group| group.hosts.iter())
        .find(|host| host.name == "AI Dev")
        .expect("created remote host");
    assert_eq!(created.host, "ai-dev.internal");
    assert_eq!(created.port, 2222);
    assert_eq!(created.username, "deploy");
    assert_eq!(created.auth_type, RemoteHostAuthType::Agent);
    assert_eq!(created.credential_ref.as_deref(), None);
    assert_eq!(created.tags, vec!["ai", "dev"]);
    assert!(created.production);
}

#[test]
fn confirm_remote_host_create_resolves_group_name_without_group_id() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "remote_host.create",
                json!({
                    "authType": "agent",
                    "groupName": "bwy",
                    "host": "172.16.40.104",
                    "name": "172.16.40.104",
                    "port": 22,
                    "username": "root"
                }),
            ),
        )
        .expect("prepare remote host create with group name");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("approve remote host create with group name");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let tree = state
        .remote_hosts()
        .list_tree(state.storage())
        .expect("list remote host tree");
    let group = tree
        .iter()
        .find(|group| group.name == "bwy")
        .expect("auto-created remote host group");
    let created = group
        .hosts
        .iter()
        .find(|host| host.name == "172.16.40.104")
        .expect("created remote host in named group");
    assert_eq!(created.host, "172.16.40.104");
    assert_eq!(created.username, "root");
    assert_eq!(created.auth_type, RemoteHostAuthType::Agent);
}

#[test]
fn confirm_remote_host_create_from_ocr_attachment_context_persists_host_and_audit_linkage() {
    let (_home, state) = setup_state();
    let group = create_test_remote_host_group(&state);

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "remote_host.create",
                json!({
                    "authType": "agent",
                    "groupId": group.id,
                    "host": "prod.example.com",
                    "name": "OCR prod.example.com",
                    "port": 2222,
                    "production": true,
                    "tags": ["ocr", "ai"],
                    "username": "deploy"
                }),
            ),
        )
        .expect("prepare remote host create from OCR candidate");
    assert_eq!(pending.tool_id, "remote_host.create");
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert!(pending.arguments_summary.contains("host=prod.example.com"));
    assert!(pending.arguments_summary.contains("username=deploy"));

    let audit_context = AiToolAuditContext {
        conversation_id: Some("conversation-image-ssh".to_owned()),
        user_message_id: Some("msg-user-image".to_owned()),
        assistant_message_id: Some("msg-assistant-tool".to_owned()),
        context_snapshot_id: Some("ctx-image-ssh".to_owned()),
        scope_kind: Some("lockedPane".to_owned()),
        scope_ref_json: Some("{\"paneId\":\"pane-prod\"}".to_owned()),
        target_key: Some("pane:pane-prod".to_owned()),
        host_id: None,
        tab_id: Some("tab-prod".to_owned()),
        pane_id: Some("pane-prod".to_owned()),
        route_mode: Some("followWorkspaceTarget".to_owned()),
        target_ref_json: Some("{\"kind\":\"pane\",\"id\":\"pane-prod\"}".to_owned()),
        run_id: Some("run-image-ssh".to_owned()),
        step_id: Some("step-remote-host-create".to_owned()),
        attachment_ids: vec!["att-ssh-image".to_owned()],
    };

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: Some(audit_context.clone()),
            },
        )
        .expect("approve OCR remote host create");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "remote_host.create");
    assert_eq!(audit.audit_context.as_ref(), Some(&audit_context));

    let tree = state
        .remote_hosts()
        .list_tree(state.storage())
        .expect("list remote host tree");
    let created = tree
        .iter()
        .flat_map(|group| group.hosts.iter())
        .find(|host| host.name == "OCR prod.example.com")
        .expect("created remote host from OCR candidate");
    assert_eq!(created.host, "prod.example.com");
    assert_eq!(created.port, 2222);
    assert_eq!(created.username, "deploy");
    assert_eq!(created.auth_type, RemoteHostAuthType::Agent);
    assert_eq!(created.tags, vec!["ocr", "ai"]);
    assert!(created.production);

    let audits = state
        .ai_tools()
        .list_audits(state.storage())
        .expect("list persisted audits");
    let persisted = audits
        .iter()
        .find(|record| record.invocation_id == audit.invocation_id)
        .expect("persisted OCR remote host audit");
    assert_eq!(persisted.audit_context.as_ref(), Some(&audit_context));
}

#[test]
fn confirm_remote_host_create_rejection_does_not_persist_host() {
    let (_home, state) = setup_state();
    let group = create_test_remote_host_group(&state);
    let before_count = state
        .remote_hosts()
        .list_tree(state.storage())
        .expect("list before")
        .iter()
        .map(|group| group.hosts.len())
        .sum::<usize>();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "remote_host.create",
                json!({
                    "groupId": group.id,
                    "host": "reject.internal",
                    "name": "不应创建",
                    "port": 22,
                    "username": "deploy"
                }),
            ),
        )
        .expect("prepare remote host create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject remote host create");
    let after_count = state
        .remote_hosts()
        .list_tree(state.storage())
        .expect("list after")
        .iter()
        .map(|group| group.hosts.len())
        .sum::<usize>();

    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert_eq!(before_count, after_count);
}

#[test]
fn confirm_remote_host_create_invalid_args_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "remote_host.create",
                json!({
                    "authType": "oauth",
                    "groupId": "missing-group",
                    "host": "bad.internal",
                    "name": "Bad Host",
                    "port": 22,
                    "username": "deploy"
                }),
            ),
        )
        .expect("prepare invalid remote host create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("invalid remote host create should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert!(audit
        .error
        .expect("remote host failure error")
        .contains("未知 SSH 认证方式"));
}

#[test]
fn confirm_remote_host_create_unknown_group_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "remote_host.create",
                json!({
                    "groupId": "missing-group",
                    "host": "missing.internal",
                    "name": "Missing Group",
                    "port": 22,
                    "username": "deploy"
                }),
            ),
        )
        .expect("prepare remote host with unknown group");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("unknown group should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert!(audit
        .error
        .expect("remote host failure error")
        .contains("远程主机分组不存在"));
}
