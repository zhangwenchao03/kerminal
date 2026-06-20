//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;
use serde_json::json;

#[test]
fn confirm_new_local_management_tools_execute_through_ai_gateway() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| ai.allow_destructive_tools = true);

    let audit = confirm_tool(&state, "settings.get", json!({}));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit
        .result_summary
        .expect("settings summary")
        .contains("当前设置"));

    let audit = confirm_tool(
        &state,
        "settings.update_ai_security",
        json!({
            "contextMaxOutputBytes": 600,
            "includeCommandHistory": true,
            "requireRemoteApproval": true,
            "allowDestructiveTools": true,
            "commandApprovalPolicy": "risky",
            "commandTimeoutSeconds": 45,
            "terminalTailLines": 80,
            "customInstructions": "  AI 测试策略  "
        }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let settings = state.settings().load_settings(state.storage()).unwrap();
    assert_eq!(settings.ai.context_max_output_bytes, 600);
    assert_eq!(settings.ai.custom_instructions, "AI 测试策略");

    let summary = state
        .terminals()
        .create_session(interactive_shell_request(), |_| true)
        .expect("create terminal session for AI log tools");
    let audit = confirm_tool(&state, "terminal.list", json!({}));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit.result_summary.unwrap().contains("本地终端会话"));

    let audit = confirm_tool(
        &state,
        "terminal.log.start",
        json!({ "sessionId": summary.id }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit.result_summary.unwrap().contains("记录中"));

    let audit = confirm_tool(
        &state,
        "terminal.log.state",
        json!({ "sessionId": summary.id }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit.result_summary.unwrap().contains("终端日志状态"));

    let audit = confirm_tool(
        &state,
        "terminal.log.stop",
        json!({ "sessionId": summary.id }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit.result_summary.unwrap().contains("未记录"));

    let audit = confirm_tool(&state, "terminal.close", json!({ "sessionId": summary.id }));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);

    let audit = confirm_tool(
        &state,
        "llm_provider.create",
        json!({
            "name": "AI Provider",
            "kind": "openAiChat",
            "baseUrl": "https://api.example.com/v1",
            "model": "gpt-test",
            "modelList": ["gpt-test"],
            "temperature": 0.2,
            "contextStrategy": "currentTerminal",
            "contextWindowTokens": 128000,
            "reasoningEffort": "modelDefault",
            "maxRetries": 3,
            "enabled": true,
            "isDefault": false
        }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let provider = state
        .rig_providers()
        .list_providers(state.storage())
        .unwrap()
        .into_iter()
        .find(|provider| provider.name == "AI Provider")
        .expect("created provider");

    let audit = confirm_tool(&state, "llm_provider.list", json!({}));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit.result_summary.unwrap().contains("AI Provider"));

    let audit = confirm_tool(
        &state,
        "llm_provider.update",
        json!({
            "id": provider.id,
            "name": "AI Provider Updated",
            "kind": "openAiChat",
            "baseUrl": "https://api.example.com/v1",
            "model": "gpt-test-2",
            "modelList": ["gpt-test-2"],
            "temperature": 0.3,
            "contextStrategy": "currentWorkspace",
            "contextWindowTokens": 128000,
            "reasoningEffort": "low",
            "maxRetries": 2,
            "enabled": true,
            "isDefault": false,
            "clearApiKey": false
        }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let provider = state
        .rig_providers()
        .list_providers(state.storage())
        .unwrap()
        .into_iter()
        .find(|provider| provider.name == "AI Provider Updated")
        .expect("updated provider");

    let audit = confirm_tool(&state, "llm_provider.test", json!({ "id": provider.id }));
    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert!(audit.error.expect("missing key error").contains("API key"));

    let audit = confirm_tool(&state, "llm_provider.delete", json!({ "id": provider.id }));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);

    let audit = confirm_tool(&state, "profile.list", json!({}));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(&state, "profile.detect_shells", json!({}));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);

    let audit = confirm_tool(
        &state,
        "profile.create",
        json!({ "name": "AI Extra Profile", "shell": "pwsh.exe", "setDefault": false }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let profile = state
        .profiles()
        .list_profiles(state.storage())
        .unwrap()
        .into_iter()
        .find(|profile| profile.name == "AI Extra Profile")
        .expect("created profile");
    let audit = confirm_tool(
        &state,
        "profile.update",
        json!({
            "id": profile.id,
            "name": "AI Extra Profile Updated",
            "shell": profile.shell,
            "args": profile.args,
            "cwd": profile.cwd,
            "env": profile.env,
            "setDefault": false,
            "sortOrder": profile.sort_order
        }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(&state, "profile.delete", json!({ "profileId": profile.id }));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);

    let audit = confirm_tool(&state, "remote_host.group_list", json!({}));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(&state, "remote_host.tree", json!({}));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(
        &state,
        "remote_host.group_create",
        json!({ "name": "AI Hosts" }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let group = state
        .remote_hosts()
        .list_groups(state.storage())
        .unwrap()
        .into_iter()
        .find(|group| group.name == "AI Hosts")
        .expect("created group");
    let audit = confirm_tool(
        &state,
        "remote_host.group_update",
        json!({ "id": group.id, "name": "AI Hosts Updated", "sortOrder": group.sort_order }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let group = state
        .remote_hosts()
        .list_groups(state.storage())
        .unwrap()
        .into_iter()
        .find(|group| group.name == "AI Hosts Updated")
        .expect("updated group");
    let audit = confirm_tool(
        &state,
        "remote_host.create",
        json!({
            "groupId": group.id,
            "name": "AI SSH Host",
            "host": "dev.internal",
            "port": 22,
            "username": "deploy",
            "authType": "agent",
            "tags": ["ai"],
            "production": false
        }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let host = state
        .remote_hosts()
        .list_tree(state.storage())
        .unwrap()
        .into_iter()
        .flat_map(|group| group.hosts)
        .find(|host| host.name == "AI SSH Host")
        .expect("created host");
    let audit = confirm_tool(
        &state,
        "remote_host.update",
        json!({
            "id": host.id,
            "groupId": group.id,
            "name": "AI SSH Host Updated",
            "host": host.host,
            "port": host.port,
            "username": host.username,
            "authType": "agent",
            "credentialRef": host.credential_ref,
            "tags": host.tags,
            "production": false,
            "sortOrder": host.sort_order
        }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(&state, "remote_host.delete", json!({ "hostId": host.id }));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(
        &state,
        "remote_host.group_delete",
        json!({ "groupId": group.id }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);

    let audit = confirm_tool(&state, "sftp.transfer.list", json!({}));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit.result_summary.unwrap().contains("SFTP 传输任务"));
    let audit = confirm_tool(&state, "sftp.transfer.clear_completed", json!({}));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit.result_summary.unwrap().contains("已清理结束"));

    let audit = confirm_tool(
        &state,
        "snippet.create",
        json!({ "title": "AI Snippet", "command": "echo ai", "scope": "local" }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let snippet = state
        .snippets()
        .list_snippets(state.storage(), Default::default())
        .unwrap()
        .into_iter()
        .find(|snippet| snippet.title == "AI Snippet")
        .expect("created snippet");
    let audit = confirm_tool(&state, "snippet.list", json!({ "query": "AI" }));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(
        &state,
        "snippet.update",
        json!({
            "id": snippet.id,
            "title": "AI Snippet Updated",
            "command": snippet.command,
            "description": snippet.description,
            "tags": snippet.tags,
            "scope": "local",
            "sortOrder": snippet.sort_order
        }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(&state, "snippet.delete", json!({ "snippetId": snippet.id }));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);

    let audit = confirm_tool(
        &state,
        "workflow.create",
        json!({
            "title": "AI Workflow",
            "scope": "local",
            "steps": [{ "title": "one", "command": "echo one" }]
        }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let workflow = state
        .workflows()
        .list_workflows(state.storage(), Default::default())
        .unwrap()
        .into_iter()
        .find(|workflow| workflow.title == "AI Workflow")
        .expect("created workflow");
    let audit = confirm_tool(&state, "workflow.list", json!({ "query": "AI" }));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(
        &state,
        "workflow.update",
        json!({
            "id": workflow.id,
            "title": "AI Workflow Updated",
            "description": workflow.description,
            "tags": workflow.tags,
            "scope": "local",
            "sortOrder": workflow.sort_order,
            "steps": [{ "title": "one", "command": "echo one" }]
        }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(
        &state,
        "workflow.delete",
        json!({ "workflowId": workflow.id }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);

    let audit = confirm_tool(
        &state,
        "history.record",
        json!({ "command": "echo ai history", "source": "tool", "target": "local" }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let entry = state
        .command_history()
        .list_history(state.storage(), Default::default())
        .unwrap()
        .into_iter()
        .find(|entry| entry.command == "echo ai history")
        .expect("recorded history");
    let audit = confirm_tool(&state, "history.delete", json!({ "entryId": entry.id }));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(
        &state,
        "history.record",
        json!({ "command": "echo ai history clear", "source": "tool", "target": "local" }),
    );
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let audit = confirm_tool(&state, "history.clear", json!({}));
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
}
