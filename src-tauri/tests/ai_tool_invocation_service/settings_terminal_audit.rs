//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;
use serde_json::json;

#[test]
fn audit_preserves_terminal_write_risk_summary() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "terminal.write",
                json!({ "sessionId": "missing-session", "data": "Remove-Item -Recurse -Force C:\\temp\\old\r" }),
            ),
        )
        .expect("prepare dangerous powershell terminal write");

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
        .expect("reject dangerous terminal write");

    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert_eq!(audit.risk, ToolRiskLevel::Destructive);
    assert_eq!(audit.confirmation, ToolConfirmationPolicy::Always);
    assert!(audit
        .risk_summary
        .expect("audit risk summary")
        .contains("PowerShell 递归强制删除"));
}

#[test]
fn confirm_rejects_pending_invocation_without_execution() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("settings.update_theme", json!({ "themeMode": "light" })),
        )
        .expect("prepare theme update");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id.clone(),
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject pending invocation");

    assert_eq!(audit.invocation_id, pending.id);
    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert_eq!(
        state
            .settings()
            .load_settings(state.storage())
            .expect("load settings")
            .theme_mode,
        ThemeMode::Dark
    );
}

#[test]
fn confirm_persists_audit_context_for_list_and_export() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("settings.update_theme", json!({ "themeMode": "light" })),
        )
        .expect("prepare theme update");
    let audit_context = AiToolAuditContext {
        attachment_ids: vec!["att-ssh-screenshot".to_owned()],
        assistant_message_id: Some("msg-assistant".to_owned()),
        context_snapshot_id: Some("ctx-1".to_owned()),
        conversation_id: Some("conversation-prod".to_owned()),
        host_id: Some("ssh-prod".to_owned()),
        pane_id: Some("pane-prod".to_owned()),
        route_mode: Some("followWorkspaceTarget".to_owned()),
        scope_kind: Some("lockedPane".to_owned()),
        scope_ref_json: Some("{\"paneId\":\"pane-prod\"}".to_owned()),
        tab_id: Some("tab-prod".to_owned()),
        target_key: Some("pane:pane-prod".to_owned()),
        target_ref_json: Some("{\"kind\":\"pane\"}".to_owned()),
        user_message_id: Some("msg-user".to_owned()),
        run_id: Some("run-prod".to_owned()),
        step_id: Some("step-theme".to_owned()),
    };

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id.clone(),
                approved: false,
                audit_context: Some(audit_context.clone()),
            },
        )
        .expect("reject pending invocation with audit context");
    let listed = state
        .ai_tools()
        .list_audits_with_request(
            state.storage(),
            Some(AiToolAuditListRequest { limit: Some(1) }),
        )
        .expect("list audits with context");
    let exported = state
        .ai_tools()
        .export_audits(
            state.storage(),
            Some(AiToolAuditListRequest { limit: Some(1) }),
        )
        .expect("export audits with context");

    assert_eq!(audit.invocation_id, pending.id);
    assert_eq!(audit.audit_context.as_ref(), Some(&audit_context));
    assert_eq!(listed[0].audit_context.as_ref(), Some(&audit_context));
    assert_eq!(
        exported.records[0].audit_context.as_ref(),
        Some(&audit_context)
    );
}

#[test]
fn confirm_updates_theme_setting_after_approval() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("settings.update_theme", json!({ "themeMode": "light" })),
        )
        .expect("prepare theme update");

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
        .expect("approve theme update");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit.result_summary.unwrap().contains("Light"));
    assert_eq!(
        state
            .settings()
            .load_settings(state.storage())
            .expect("load settings")
            .theme_mode,
        ThemeMode::Light
    );
}

#[test]
fn prepare_terminal_appearance_update_uses_write_policy() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "settings.update_terminal_appearance",
                json!({
                    "cursorBlink": false,
                    "fontSize": 15,
                    "lineHeight": 1.45,
                    "scrollback": 9000
                }),
            ),
        )
        .expect("prepare terminal appearance update");

    assert_eq!(pending.tool_id, "settings.update_terminal_appearance");
    assert_eq!(pending.tool_title, "更新终端外观");
    assert_eq!(pending.risk, ToolRiskLevel::Write);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Contextual);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("cursorBlink=false"));
}

#[test]
fn confirm_terminal_appearance_update_persists_patch_and_keeps_other_settings() {
    let (_home, state) = setup_state();
    let mut settings = state
        .settings()
        .load_settings(state.storage())
        .expect("load settings");
    settings.theme_mode = ThemeMode::Light;
    settings.ai.include_command_history = true;
    state
        .settings()
        .update_settings(state.storage(), settings)
        .expect("seed settings");

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "settings.update_terminal_appearance",
                json!({
                    "cursorBlink": false,
                    "fontFamily": "Consolas, monospace",
                    "fontSize": 15,
                    "lineHeight": 1.45,
                    "scrollback": 9000
                }),
            ),
        )
        .expect("prepare terminal appearance update");

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
        .expect("approve terminal appearance update");
    let stored = state
        .settings()
        .load_settings(state.storage())
        .expect("load stored settings");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit
        .result_summary
        .expect("result summary")
        .contains("终端外观已更新"));
    assert_eq!(stored.theme_mode, ThemeMode::Light);
    assert!(stored.ai.include_command_history);
    assert_eq!(stored.terminal.font_family, "Consolas, monospace");
    assert_eq!(stored.terminal.font_size, 15);
    assert_eq!(stored.terminal.line_height, 1.45);
    assert!(!stored.terminal.cursor_blink);
    assert_eq!(stored.terminal.scrollback, 9000);
}

#[test]
fn confirm_terminal_appearance_update_invalid_value_records_failed_audit() {
    let (_home, state) = setup_state();
    let original_font_size = state
        .settings()
        .load_settings(state.storage())
        .expect("load original settings")
        .terminal
        .font_size;
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "settings.update_terminal_appearance",
                json!({ "fontSize": 4 }),
            ),
        )
        .expect("prepare invalid terminal appearance update");

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
        .expect("invalid setting should become failed audit");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert!(audit.error.expect("error").contains("字号"));
    assert_eq!(
        state
            .settings()
            .load_settings(state.storage())
            .expect("load settings")
            .terminal
            .font_size,
        original_font_size
    );
}

#[test]
fn confirm_terminal_appearance_update_rejection_does_not_change_settings() {
    let (_home, state) = setup_state();
    let original_font_size = state
        .settings()
        .load_settings(state.storage())
        .expect("load original settings")
        .terminal
        .font_size;
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "settings.update_terminal_appearance",
                json!({ "fontSize": 16 }),
            ),
        )
        .expect("prepare terminal appearance update");

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
        .expect("reject terminal appearance update");

    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert_eq!(
        state
            .settings()
            .load_settings(state.storage())
            .expect("load settings")
            .terminal
            .font_size,
        original_font_size
    );
}

#[test]
fn confirm_terminal_write_missing_session_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "terminal.write",
                json!({ "sessionId": "missing-session", "data": "echo test\r" }),
            ),
        )
        .expect("prepare terminal write");

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
        .expect("terminal execution failure should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert!(audit
        .error
        .expect("failure error")
        .contains("终端会话不存在"));
}

#[test]
fn audit_list_returns_newest_records_first() {
    let (_home, state) = setup_state();
    let first = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("settings.update_theme", json!({ "themeMode": "light" })),
        )
        .expect("prepare first");
    let first_audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: first.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject first");

    let second = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("settings.update_theme", json!({ "themeMode": "system" })),
        )
        .expect("prepare second");
    let second_audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: second.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject second");

    let audits = state
        .ai_tools()
        .list_audits(state.storage())
        .expect("list audits");

    assert_eq!(audits[0].id, second_audit.id);
    assert_eq!(audits[1].id, first_audit.id);
}

#[test]
fn audit_list_respects_requested_limit() {
    let (_home, state) = setup_state();
    let first = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("settings.update_theme", json!({ "themeMode": "light" })),
        )
        .expect("prepare first");
    state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: first.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject first");

    let second = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("settings.update_theme", json!({ "themeMode": "system" })),
        )
        .expect("prepare second");
    let second_audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: second.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject second");

    let limited = state
        .ai_tools()
        .list_audits_with_request(
            state.storage(),
            Some(AiToolAuditListRequest { limit: Some(1) }),
        )
        .expect("list limited audits");
    let empty = state
        .ai_tools()
        .list_audits_with_request(
            state.storage(),
            Some(AiToolAuditListRequest { limit: Some(0) }),
        )
        .expect("list zero audits");

    assert_eq!(limited.len(), 1);
    assert_eq!(limited[0].id, second_audit.id);
    assert!(empty.is_empty());
}

#[test]
fn audit_export_returns_newest_records_and_metadata() {
    let (_home, state) = setup_state();
    let first = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("settings.update_theme", json!({ "themeMode": "light" })),
        )
        .expect("prepare first");
    let first_audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: first.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject first");

    let second = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("settings.update_theme", json!({ "themeMode": "system" })),
        )
        .expect("prepare second");
    let second_audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: second.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject second");

    let exported = state
        .ai_tools()
        .export_audits(
            state.storage(),
            Some(AiToolAuditListRequest { limit: Some(2) }),
        )
        .expect("export audits");

    assert_eq!(exported.count, 2);
    assert!(!exported.exported_at.is_empty());
    assert_eq!(exported.records[0].id, second_audit.id);
    assert_eq!(exported.records[1].id, first_audit.id);
}

#[test]
fn audit_clear_removes_persisted_records() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("settings.update_theme", json!({ "themeMode": "light" })),
        )
        .expect("prepare audit");
    state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: false,
                audit_context: None,
            },
        )
        .expect("reject audit");

    let cleared = state
        .ai_tools()
        .clear_audits(state.storage())
        .expect("clear audits");
    let audits = state
        .ai_tools()
        .list_audits(state.storage())
        .expect("list audits after clear");
    let cleared_again = state
        .ai_tools()
        .clear_audits(state.storage())
        .expect("clear empty audits");

    assert_eq!(cleared.cleared_count, 1);
    assert!(audits.is_empty());
    assert_eq!(cleared_again.cleared_count, 0);
}

#[test]
fn audit_list_survives_app_state_reopen() {
    let (_home, state) = setup_state();
    let paths = state.paths().clone();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "terminal.write",
                json!({ "sessionId": "missing-session", "data": "sudo echo kerminal\r" }),
            ),
        )
        .expect("prepare risky terminal write");
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
        .expect("reject risky terminal write");

    drop(state);

    let reopened = AppState::initialize_with_paths(paths).expect("reopen app state");
    let audits = reopened
        .ai_tools()
        .list_audits(reopened.storage())
        .expect("list persisted audits");

    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].id, audit.id);
    assert_eq!(audits[0].status, AiToolInvocationStatus::Rejected);
    assert_eq!(audits[0].risk, ToolRiskLevel::Destructive);
    assert!(audits[0]
        .risk_summary
        .as_ref()
        .expect("risk summary")
        .contains("权限提升"));
}
