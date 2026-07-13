use std::collections::BTreeSet;

use serde_json::Value;

const CASES_JSON: &[&str] = &[
    include_str!("fixtures/external_launch/cases.json"),
    include_str!("fixtures/external_launch/cases-putty.json"),
    include_str!("fixtures/external_launch/cases-mobaxterm.json"),
    include_str!("fixtures/external_launch/cases-xshell.json"),
    include_str!("fixtures/external_launch/cases-securecrt.json"),
    include_str!("fixtures/external_launch/cases-openssh.json"),
    include_str!("fixtures/external_launch/cases-kerminal-native.json"),
];

const ALLOWED_PRIORITIES: &[&str] = &["P0", "P1", "P2"];
const ALLOWED_SOURCE_TOOLS: &[&str] = &[
    "putty",
    "mobaxterm",
    "xshell",
    "securecrt",
    "openssh",
    "kerminal-native",
];
const ALLOWED_ENTRYPOINTS: &[&str] = &[
    "direct-argv",
    "single-instance",
    "shim-ipc",
    "protocol",
    "session-file",
];
const FIXTURE_SECRET_MARKER: &str = "KERM_FIXTURE_";

#[test]
fn external_launch_fixtures_have_stable_contract_shape() {
    let cases = fixture_cases();
    assert!(
        cases.len() >= 10,
        "external launch fixture suite should cover every supported persona"
    );

    let mut ids = BTreeSet::new();
    let mut tools = BTreeSet::new();
    let mut tool_counts = std::collections::BTreeMap::new();

    for case in &cases {
        let id = required_text(case, "id");
        assert!(ids.insert(id.to_string()), "duplicate fixture id: {id}");

        let priority = required_text(case, "priority");
        assert!(
            ALLOWED_PRIORITIES.contains(&priority),
            "{id}: unsupported priority {priority}"
        );

        let source_tool = required_text(case, "sourceTool");
        assert!(
            ALLOWED_SOURCE_TOOLS.contains(&source_tool),
            "{id}: unsupported sourceTool {source_tool}"
        );
        tools.insert(source_tool.to_string());
        *tool_counts.entry(source_tool.to_string()).or_insert(0usize) += 1;

        let entrypoint = required_text(case, "entrypoint");
        assert!(
            ALLOWED_ENTRYPOINTS.contains(&entrypoint),
            "{id}: unsupported entrypoint {entrypoint}"
        );

        let argv = required_array_value(case, "argv");
        assert!(!argv.is_empty(), "{id}: argv must not be empty");
        assert!(
            argv.iter().all(|value| value.as_str().is_some()),
            "{id}: argv must be an array of strings"
        );

        validate_expected(id, required_object(case, "expected"));
        validate_redaction_contract(id, case);
    }

    for tool in ALLOWED_SOURCE_TOOLS {
        assert!(tools.contains(*tool), "missing fixture for {tool}");
        assert!(
            tool_counts.get(*tool).copied().unwrap_or_default() >= 10,
            "{tool} must have at least 10 representative fixtures"
        );
    }
}

#[test]
fn external_launch_fixture_secrets_are_fake_and_redacted() {
    let cases = fixture_cases();
    for case in &cases {
        let id = required_text(case, "id");
        let raw = serde_json::to_string(case).expect("serialize fixture case");
        for secret in fixture_secret_values(case) {
            assert!(
                secret.starts_with(FIXTURE_SECRET_MARKER),
                "{id}: fixture secret must use the fake KERM_FIXTURE_ marker"
            );
            let expected = required_object(case, "expected");
            let diagnostics = required_object_map(expected, "diagnostics", id);
            let redacted_argv = required_array(diagnostics, "redactedArgv");
            let redacted = serde_json::to_string(redacted_argv).expect("serialize redacted argv");
            assert!(
                !redacted.contains(&secret),
                "{id}: redacted argv leaked fixture secret {secret}"
            );
            let redacted_not_contains = required_array(diagnostics, "redactedNotContains");
            assert!(
                redacted_not_contains
                    .iter()
                    .any(|value| value.as_str() == Some(secret.as_str())),
                "{id}: redactedNotContains must list fixture secret {secret}; raw={raw}"
            );
        }
    }
}

fn fixture_cases() -> Vec<Value> {
    CASES_JSON
        .iter()
        .flat_map(|source| {
            let root: Value = serde_json::from_str(source).expect("parse external launch fixtures");
            root.as_array()
                .expect("fixture root must be an array")
                .to_vec()
        })
        .collect()
}

fn validate_expected(id: &str, expected: &serde_json::Map<String, Value>) {
    let target = required_object_map(expected, "target", id);
    let host = required_text_map(target, "host", id);
    assert!(
        !host.trim().is_empty(),
        "{id}: target.host must not be empty"
    );
    let port = required_u64_map(target, "port", id);
    assert!(
        (1..=65535).contains(&port),
        "{id}: target.port must be within 1..=65535"
    );
    if let Some(username) = target.get("username") {
        assert!(
            username
                .as_str()
                .is_some_and(|value| !value.trim().is_empty()),
            "{id}: target.username must be a non-empty string when present"
        );
    }

    let auth = required_object_map(expected, "auth", id);
    if let Some(password_ref) = auth.get("passwordRef") {
        assert!(
            password_ref.as_bool().is_some(),
            "{id}: auth.passwordRef must be boolean"
        );
    }
    if let Some(identity_file) = auth.get("identityFile") {
        assert!(
            identity_file
                .as_str()
                .is_some_and(|value| !value.trim().is_empty()),
            "{id}: auth.identityFile must be a non-empty string"
        );
    }

    required_object_map(expected, "options", id);
    let diagnostics = required_object_map(expected, "diagnostics", id);
    let redacted_argv = required_array_map(diagnostics, "redactedArgv", id);
    assert!(
        !redacted_argv.is_empty(),
        "{id}: diagnostics.redactedArgv must not be empty"
    );
    assert!(
        redacted_argv.iter().all(|value| value.as_str().is_some()),
        "{id}: diagnostics.redactedArgv must be an array of strings"
    );
    let redacted_not_contains = required_array_map(diagnostics, "redactedNotContains", id);
    assert!(
        redacted_not_contains
            .iter()
            .all(|value| value.as_str().is_some()),
        "{id}: diagnostics.redactedNotContains must be an array of strings"
    );
}

fn validate_redaction_contract(id: &str, case: &Value) {
    let expected = required_object(case, "expected");
    let diagnostics = required_object_map(expected, "diagnostics", id);
    let redacted_argv = required_array(diagnostics, "redactedArgv");
    let redacted = serde_json::to_string(redacted_argv).expect("serialize redacted argv");
    for forbidden in required_array(diagnostics, "redactedNotContains") {
        let Some(forbidden) = forbidden.as_str() else {
            panic!("{id}: redactedNotContains entries must be strings");
        };
        assert!(
            !redacted.contains(forbidden),
            "{id}: redacted argv contains forbidden value {forbidden}"
        );
    }
}

fn fixture_secret_values(case: &Value) -> Vec<String> {
    let mut secrets = Vec::new();
    collect_fixture_secret_values(case, &mut secrets);
    secrets.sort();
    secrets.dedup();
    secrets
}

fn collect_fixture_secret_values(value: &Value, output: &mut Vec<String>) {
    match value {
        Value::String(text) if text.contains(FIXTURE_SECRET_MARKER) => {
            for token in
                text.split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'))
            {
                if token.starts_with(FIXTURE_SECRET_MARKER) {
                    output.push(token.to_string());
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_fixture_secret_values(item, output);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_fixture_secret_values(item, output);
            }
        }
        _ => {}
    }
}

fn required_text<'a>(value: &'a Value, key: &str) -> &'a str {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("{key} must be a string"))
}

fn required_array<'a>(value: &'a serde_json::Map<String, Value>, key: &str) -> &'a Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("{key} must be an array"))
}

fn required_array_value<'a>(value: &'a Value, key: &str) -> &'a Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("{key} must be an array"))
}

fn required_object<'a>(value: &'a Value, key: &str) -> &'a serde_json::Map<String, Value> {
    value
        .get(key)
        .and_then(Value::as_object)
        .unwrap_or_else(|| panic!("{key} must be an object"))
}

fn required_object_map<'a>(
    value: &'a serde_json::Map<String, Value>,
    key: &str,
    id: &str,
) -> &'a serde_json::Map<String, Value> {
    value
        .get(key)
        .and_then(Value::as_object)
        .unwrap_or_else(|| panic!("{id}: {key} must be an object"))
}

fn required_text_map<'a>(
    value: &'a serde_json::Map<String, Value>,
    key: &str,
    id: &str,
) -> &'a str {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("{id}: {key} must be a string"))
}

fn required_u64_map(value: &serde_json::Map<String, Value>, key: &str, id: &str) -> u64 {
    value
        .get(key)
        .and_then(Value::as_u64)
        .unwrap_or_else(|| panic!("{id}: {key} must be an unsigned integer"))
}

fn required_array_map<'a>(
    value: &'a serde_json::Map<String, Value>,
    key: &str,
    id: &str,
) -> &'a Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("{id}: {key} must be an array"))
}
