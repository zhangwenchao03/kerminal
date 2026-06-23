//! 终端 IPC 模型安全边界测试。
//!
//! @author kongweiguang

use kerminal_lib::models::terminal::{
    docker_container_terminal_target_ref, host_terminal_target_ref, local_terminal_target_ref,
    TerminalCreateRequest, TerminalSecretInputEntry, TerminalSecretInputPlan,
    TerminalSecretInputResponse,
};
use std::path::PathBuf;

#[test]
fn terminal_cleanup_paths_are_internal_only() {
    let request = TerminalCreateRequest {
        cleanup_paths: vec![PathBuf::from("C:/kerminal/secret.key")],
        ..TerminalCreateRequest::default()
    };

    let json = serde_json::to_string(&request).expect("serialize terminal request");
    assert!(!json.contains("cleanupPaths"));
    assert!(!json.contains("secret.key"));

    let decoded: TerminalCreateRequest = serde_json::from_str(
        r#"{
            "shell": "ssh",
            "args": [],
            "cols": 80,
            "rows": 24,
            "env": {},
            "cleanupPaths": ["C:/outside/secret.key"]
        }"#,
    )
    .expect("deserialize terminal request");

    assert!(decoded.cleanup_paths.is_empty());
}

#[test]
fn terminal_secret_input_response_is_internal_only() {
    let request = TerminalCreateRequest {
        secret_input_response: Some(TerminalSecretInputResponse {
            prompt_markers: vec!["password:".to_owned()],
            response: "super-secret-password".to_owned(),
            redact_values: vec!["super-secret-password".to_owned()],
            max_responses: 1,
        }),
        ..TerminalCreateRequest::default()
    };

    let json = serde_json::to_string(&request).expect("serialize terminal request");
    assert!(!json.contains("secretInputResponse"));
    assert!(!json.contains("super-secret-password"));

    let decoded: TerminalCreateRequest = serde_json::from_str(
        r#"{
            "shell": "ssh",
            "args": [],
            "cols": 80,
            "rows": 24,
            "env": {},
            "secretInputResponse": {
                "promptMarkers": ["password:"],
                "response": "malicious",
                "redactValues": ["malicious"],
                "maxResponses": 10
            }
        }"#,
    )
    .expect("deserialize terminal request");

    assert!(decoded.secret_input_response.is_none());
}

#[test]
fn terminal_secret_input_response_converts_to_single_entry_plan() {
    let response = TerminalSecretInputResponse {
        prompt_markers: vec!["password:".to_owned()],
        response: "legacy-secret".to_owned(),
        redact_values: vec!["legacy-secret".to_owned()],
        max_responses: 2,
    };

    let plan = TerminalSecretInputPlan::from(response);

    assert_eq!(plan.entries.len(), 1);
    assert_eq!(plan.entries[0].id, "legacy-secret");
    assert_eq!(plan.entries[0].prompt_markers, vec!["password:"]);
    assert_eq!(plan.entries[0].response, "legacy-secret");
    assert_eq!(plan.entries[0].max_responses, 2);
}

#[test]
fn terminal_secret_input_plan_redaction_values_include_responses_and_explicit_values() {
    let plan = TerminalSecretInputPlan {
        entries: vec![
            TerminalSecretInputEntry {
                id: "jump".to_owned(),
                label: "Jump".to_owned(),
                prompt_markers: vec!["password:".to_owned()],
                response: "jump-secret".to_owned(),
                redact_values: vec!["jump-secret".to_owned(), "jump-token".to_owned()],
                max_responses: 1,
            },
            TerminalSecretInputEntry {
                id: "target".to_owned(),
                label: "Target".to_owned(),
                prompt_markers: vec!["target password:".to_owned()],
                response: "target-secret".to_owned(),
                redact_values: vec!["target-extra".to_owned()],
                max_responses: 1,
            },
        ],
    };

    assert_eq!(
        plan.redact_values(),
        vec![
            "jump-secret".to_owned(),
            "jump-token".to_owned(),
            "target-secret".to_owned(),
            "target-extra".to_owned(),
        ],
    );
}

#[test]
fn terminal_target_refs_are_backend_stable() {
    assert_eq!(local_terminal_target_ref(), "local");
    assert_eq!(host_terminal_target_ref(" ssh ", " host-a "), "ssh:host-a");
    assert_eq!(
        docker_container_terminal_target_ref(" host-a ", " container-a "),
        "dockerContainer:host-a:container-a"
    );
}
