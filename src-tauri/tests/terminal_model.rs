//! 终端 IPC 模型安全边界测试。
//!
//! @author kongweiguang

use kerminal_lib::models::terminal::{TerminalCreateRequest, TerminalSecretInputResponse};
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
