//! External SSH launch parser tests.
//!
//! @author kongweiguang

use serde_json::Value;

use kerminal_lib::services::external_launch::{
    ExternalLaunchEntrypoint, ExternalLaunchParseInput, ExternalLaunchParserRegistry,
    ExternalLaunchSourceTool, ExternalSshLaunchRequest,
};

const CASES_JSON: &str = include_str!("fixtures/external_launch/cases.json");

#[test]
fn registry_parses_p0_external_launch_fixtures() {
    let registry = ExternalLaunchParserRegistry::new();
    for case in fixture_cases()
        .into_iter()
        .filter(|case| required_text(case, "priority") == "P0")
    {
        let id = required_text(&case, "id");
        let source_tool =
            ExternalLaunchSourceTool::from_external_name(required_text(&case, "sourceTool"))
                .unwrap_or_else(|error| panic!("{id}: unsupported source tool: {error}"));
        let argv = required_array_value(&case, "argv")
            .iter()
            .map(|value| value.as_str().expect("argv string").to_owned())
            .collect::<Vec<_>>();
        let request = registry
            .parse(&fixture_parse_input(&case, source_tool, argv))
            .unwrap_or_else(|error| panic!("{id}: parse failed: {error}"));

        assert_eq!(request.source.tool, source_tool, "{id}: source tool");
        assert_expected_target(id, &request, required_object(&case, "expected"));
        assert_expected_auth(id, &request, required_object(&case, "expected"));
        assert_expected_options(id, &request, required_object(&case, "expected"));
        assert_expected_diagnostics(id, &request, required_object(&case, "expected"));
        assert_debug_redacted(id, &request, required_object(&case, "expected"));
    }
}

#[test]
fn registry_can_infer_persona_from_argv0() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::inferred_direct_argv(vec![
            "C:\\Program Files\\PuTTY\\putty.exe".to_owned(),
            "-ssh".to_owned(),
            "ops@example.internal".to_owned(),
            "-P".to_owned(),
            "2222".to_owned(),
        ]))
        .expect("parse inferred PuTTY argv");

    assert_eq!(request.source.tool, ExternalLaunchSourceTool::Putty);
    assert_eq!(request.target.host, "example.internal");
    assert_eq!(request.target.port, 2222);
    assert_eq!(request.target.username.as_deref(), Some("ops"));
}

#[test]
fn registry_accepts_vendor_style_args_when_argv0_is_kerminal() {
    let registry = ExternalLaunchParserRegistry::new();
    for case in fixture_cases()
        .into_iter()
        .filter(|case| required_text(case, "priority") == "P0")
        .filter(|case| required_text(case, "sourceTool") != "kerminal-native")
    {
        let id = required_text(&case, "id");
        let source_tool =
            ExternalLaunchSourceTool::from_external_name(required_text(&case, "sourceTool"))
                .unwrap_or_else(|error| panic!("{id}: unsupported source tool: {error}"));
        let mut argv = required_array_value(&case, "argv")
            .iter()
            .map(|value| value.as_str().expect("argv string").to_owned())
            .collect::<Vec<_>>();
        argv[0] = "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned();

        let request = registry
            .parse(&ExternalLaunchParseInput::inferred_direct_argv(argv))
            .unwrap_or_else(|error| panic!("{id}: kerminal argv0 parse failed: {error}"));

        assert_eq!(request.source.tool, source_tool, "{id}: source tool");
        assert_eq!(
            request.source.argv0.as_deref(),
            Some("C:\\Program Files\\Kerminal\\kerminal.exe"),
            "{id}: source argv0"
        );
        assert_eq!(
            request
                .diagnostics
                .argv_redacted
                .first()
                .map(String::as_str),
            Some("C:\\Program Files\\Kerminal\\kerminal.exe"),
            "{id}: redacted argv0"
        );
        assert_expected_target(id, &request, required_object(&case, "expected"));
        assert_expected_auth(id, &request, required_object(&case, "expected"));
        assert_expected_options(id, &request, required_object(&case, "expected"));
        assert_debug_redacted(id, &request, required_object(&case, "expected"));
    }
}

#[test]
fn registry_keeps_kerminal_argv0_native_flags_native() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::inferred_direct_argv(vec![
            "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
            "--external-ssh".to_owned(),
            "--host".to_owned(),
            "native.internal".to_owned(),
            "--port".to_owned(),
            "2244".to_owned(),
            "--user".to_owned(),
            "native".to_owned(),
        ]))
        .expect("parse Kerminal native argv");

    assert_eq!(
        request.source.tool,
        ExternalLaunchSourceTool::KerminalNative
    );
    assert_eq!(request.target.host, "native.internal");
    assert_eq!(request.target.port, 2244);
    assert_eq!(request.target.username.as_deref(), Some("native"));
}

#[test]
fn mobaxterm_nested_ssh_preserves_windows_identity_path() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "-newtab".to_owned(),
                "ssh -p 2200 -i C:\\Users\\alice\\.ssh\\id_ed25519 dev@devbox.internal".to_owned(),
            ],
        ))
        .expect("parse MobaXterm nested SSH command");

    assert_eq!(
        request.auth.identity_file.as_deref(),
        Some("C:\\Users\\alice\\.ssh\\id_ed25519")
    );
    assert_eq!(
        request.diagnostics.argv_redacted[2],
        "ssh -p 2200 -i <path:fingerprint> dev@devbox.internal"
    );
}

#[test]
fn mobaxterm_newtab_accepts_split_ssh_arguments() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "-newtab".to_owned(),
                "ssh".to_owned(),
                "-p".to_owned(),
                "2200".to_owned(),
                "-i".to_owned(),
                "C:\\Users\\alice\\.ssh\\id_ed25519".to_owned(),
                "dev@devbox.internal".to_owned(),
            ],
        ))
        .expect("parse MobaXterm split SSH command");

    assert_eq!(request.target.host, "devbox.internal");
    assert_eq!(request.target.port, 2200);
    assert_eq!(request.target.username.as_deref(), Some("dev"));
    assert_eq!(
        request.auth.identity_file.as_deref(),
        Some("C:\\Users\\alice\\.ssh\\id_ed25519")
    );
    assert_eq!(
        request.diagnostics.argv_redacted[2],
        "ssh -p 2200 -i <path:fingerprint> dev@devbox.internal"
    );
}

#[test]
fn mobaxterm_accepts_openssh_args_without_newtab_exec() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "-p".to_owned(),
                "2201".to_owned(),
                "ops@moba-direct.internal".to_owned(),
            ],
        ))
        .expect("parse MobaXterm direct OpenSSH args");

    assert_eq!(request.target.host, "moba-direct.internal");
    assert_eq!(request.target.port, 2201);
    assert_eq!(request.target.username.as_deref(), Some("ops"));
    assert_eq!(request.diagnostics.parser, "mobaxterm-argv");
}

#[test]
fn mobaxterm_accepts_direct_ssh_command_without_newtab_exec() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "ssh".to_owned(),
                "-p".to_owned(),
                "2202".to_owned(),
                "ops@moba-ssh.internal".to_owned(),
            ],
        ))
        .expect("parse MobaXterm direct ssh command");

    assert_eq!(request.target.host, "moba-ssh.internal");
    assert_eq!(request.target.port, 2202);
    assert_eq!(request.target.username.as_deref(), Some("ops"));
    assert_eq!(request.diagnostics.parser, "mobaxterm-argv");
}

#[test]
fn mobaxterm_accepts_field_style_ssh_arguments() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "-newtab".to_owned(),
                "-ssh".to_owned(),
                "-remotehost".to_owned(),
                "10.11.0.75".to_owned(),
                "-username".to_owned(),
                "root".to_owned(),
                "-port".to_owned(),
                "22".to_owned(),
            ],
        ))
        .expect("parse MobaXterm field-style SSH args");

    assert_eq!(request.target.host, "10.11.0.75");
    assert_eq!(request.target.port, 22);
    assert_eq!(request.target.username.as_deref(), Some("root"));
    assert_eq!(request.diagnostics.parser, "mobaxterm-fields");
}

#[test]
fn mobaxterm_accepts_ssh_url_destination() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "-newtab".to_owned(),
                "ssh".to_owned(),
                "ssh://ops@moba-url.internal:2203".to_owned(),
            ],
        ))
        .expect("parse MobaXterm ssh URL destination");

    assert_eq!(request.target.host, "moba-url.internal");
    assert_eq!(request.target.port, 2203);
    assert_eq!(request.target.username.as_deref(), Some("ops"));
}

#[test]
fn mobaxterm_session_file_is_not_misparsed_as_host() {
    let registry = ExternalLaunchParserRegistry::new();
    let error = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "C:\\Users\\alice\\Documents\\MobaXterm\\sessions\\prod.moba".to_owned(),
            ],
        ))
        .expect_err("unsupported session file should not parse as a host");

    assert!(error
        .to_string()
        .contains("unsupported external SSH launch arguments"));
}

#[test]
fn xshell_url_decodes_percent_encoded_userinfo_and_b64_payload() {
    let registry = ExternalLaunchParserRegistry::new();
    let payload = "anVtcDpLRVJNX0ZJWFRVUkVfWFNIRUxMX0I2NF9QQVNTV09SRF9ET19OT1RfVVNFQHJvb3RAMTAuMTEuMC43NToyMjpTU0gy";
    let raw_url = format!("ssh://b64%3E%3E{payload}@172.21.195.223:222");
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Xshell,
            vec!["Xshell.exe".to_owned(), "-url".to_owned(), raw_url],
        ))
        .expect("parse Xshell URL with b64 payload in userinfo");

    assert_eq!(request.target.host, "10.11.0.75");
    assert_eq!(request.target.port, 22);
    assert_eq!(request.target.username.as_deref(), Some("root"));
    assert!(request.auth.has_password());
    assert_eq!(request.diagnostics.parser, "xshell-b64");
    assert_eq!(
        request.diagnostics.argv_redacted[2],
        "ssh://b64>><redacted>@172.21.195.223:222"
    );
    let debug = format!("{request:?}");
    assert!(!debug.contains(payload));
    assert!(!debug.contains("KERM_FIXTURE_XSHELL_B64_PASSWORD_DO_NOT_USE"));
}

#[test]
fn xshell_accepts_newwin_and_direct_url_forms() {
    let registry = ExternalLaunchParserRegistry::new();
    let newwin = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Xshell,
            vec![
                "Xshell.exe".to_owned(),
                "-newwin".to_owned(),
                "ssh://root@10.11.0.75:22".to_owned(),
            ],
        ))
        .expect("parse Xshell -newwin URL");
    assert_eq!(newwin.target.host, "10.11.0.75");
    assert_eq!(newwin.target.port, 22);
    assert_eq!(newwin.target.username.as_deref(), Some("root"));

    let direct = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Xshell,
            vec![
                "Xshell.exe".to_owned(),
                "ssh://deploy@direct-xshell.internal:2022".to_owned(),
            ],
        ))
        .expect("parse Xshell direct URL");
    assert_eq!(direct.target.host, "direct-xshell.internal");
    assert_eq!(direct.target.port, 2022);
    assert_eq!(direct.target.username.as_deref(), Some("deploy"));
}

#[test]
fn xshell_url_percent_decodes_regular_user_and_password() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Xshell,
            vec![
                "Xshell.exe".to_owned(),
                "-url".to_owned(),
                "ssh://ops%2Badmin:KERM_FIXTURE_XSHELL%2520URL_SECRET@db.internal:2201".to_owned(),
            ],
        ))
        .expect("parse percent-encoded Xshell URL");

    assert_eq!(request.target.host, "db.internal");
    assert_eq!(request.target.port, 2201);
    assert_eq!(request.target.username.as_deref(), Some("ops+admin"));
    assert!(request.auth.has_password());
    assert!(!format!("{request:?}").contains("KERM_FIXTURE_XSHELL%20URL_SECRET"));
}

#[test]
fn kerminal_protocol_url_redacts_secret_query_values() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::KerminalNative,
            vec![
                "kerminal.exe".to_owned(),
                "kerminal://ssh?host=proto.internal&port=2201&user=proto&password=KERM_FIXTURE_PROTOCOL_PASSWORD_DO_NOT_USE&identityFile=C%3A%5CUsers%5Calice%5C.ssh%5Cproto.key&keyPassphrase=KERM_FIXTURE_PROTOCOL_PASSPHRASE_DO_NOT_USE&openSftp=true".to_owned(),
            ],
        ))
        .expect("parse Kerminal protocol URL");

    assert_eq!(
        request.source.tool,
        ExternalLaunchSourceTool::KerminalNative
    );
    assert_eq!(request.target.host, "proto.internal");
    assert_eq!(request.target.port, 2201);
    assert_eq!(request.target.username.as_deref(), Some("proto"));
    assert_eq!(
        request.auth.identity_file.as_deref(),
        Some("C:\\Users\\alice\\.ssh\\proto.key")
    );
    assert!(request.auth.has_password());
    assert!(request.auth.key_passphrase.is_some());
    assert!(request.options.open_sftp);
    assert_eq!(
        request.options.display_name.as_deref(),
        Some("proto@proto.internal")
    );
    assert_eq!(request.diagnostics.parser, "kerminal-native-protocol");
    let redacted_url = &request.diagnostics.argv_redacted[1];
    assert!(redacted_url.contains("password=%3Credacted%3E"));
    assert!(redacted_url.contains("keyPassphrase=%3Credacted%3E"));
    assert!(redacted_url.contains("identityFile=%3Cpath%3Afingerprint%3E"));
    let debug = format!("{request:?}");
    assert!(!debug.contains("KERM_FIXTURE_PROTOCOL_PASSWORD_DO_NOT_USE"));
    assert!(!debug.contains("KERM_FIXTURE_PROTOCOL_PASSPHRASE_DO_NOT_USE"));
    assert!(!debug.contains("proto.key"));
}

#[test]
fn parser_rejects_missing_destination() {
    let registry = ExternalLaunchParserRegistry::new();
    let error = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Openssh,
            vec!["ssh".to_owned(), "-p".to_owned(), "22".to_owned()],
        ))
        .expect_err("missing destination should fail");

    assert!(error.to_string().contains("destination is required"));
}

fn fixture_parse_input(
    case: &Value,
    source_tool: ExternalLaunchSourceTool,
    argv: Vec<String>,
) -> ExternalLaunchParseInput {
    let entrypoint = match case.get("entrypoint").and_then(Value::as_str) {
        Some("protocol") => ExternalLaunchEntrypoint::Protocol,
        Some("session-file") => ExternalLaunchEntrypoint::SessionFile,
        Some("shim-ipc") => ExternalLaunchEntrypoint::ShimIpc,
        Some("single-instance") => ExternalLaunchEntrypoint::SingleInstance,
        _ => ExternalLaunchEntrypoint::DirectArgv,
    };
    ExternalLaunchParseInput::from_args(
        entrypoint,
        Some(source_tool),
        Some(source_tool.as_str().to_owned()),
        argv,
    )
}

fn assert_expected_target(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let target = required_object_map(expected, "target", id);
    assert_eq!(request.target.host, required_text_map(target, "host", id));
    assert_eq!(
        u64::from(request.target.port),
        required_u64_map(target, "port", id)
    );
    let expected_username = target.get("username").and_then(Value::as_str);
    assert_eq!(
        request.target.username.as_deref(),
        expected_username,
        "{id}: username"
    );
}

fn assert_expected_auth(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let auth = required_object_map(expected, "auth", id);
    let expect_password = auth
        .get("passwordRef")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    assert_eq!(
        request.auth.has_password(),
        expect_password,
        "{id}: password"
    );
    let expected_identity = auth.get("identityFile").and_then(Value::as_str);
    assert_eq!(
        request.auth.identity_file.as_deref(),
        expected_identity,
        "{id}: identity file"
    );
}

fn assert_expected_options(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let options = required_object_map(expected, "options", id);
    let expected_display_name = options.get("displayName").and_then(Value::as_str);
    assert_eq!(
        request.options.display_name.as_deref(),
        expected_display_name,
        "{id}: display name"
    );
    let expected_remote_command = options.get("remoteCommand").and_then(Value::as_str);
    assert_eq!(
        request.options.remote_command.as_deref(),
        expected_remote_command,
        "{id}: remote command"
    );
    let expected_open_sftp = options
        .get("openSftp")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    assert_eq!(
        request.options.open_sftp, expected_open_sftp,
        "{id}: open SFTP"
    );
}

fn assert_expected_diagnostics(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let diagnostics = required_object_map(expected, "diagnostics", id);
    let expected_redacted = required_array_map(diagnostics, "redactedArgv", id)
        .iter()
        .map(|value| value.as_str().expect("redacted argv string").to_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        request.diagnostics.argv_redacted, expected_redacted,
        "{id}: redacted argv"
    );
    assert_eq!(request.diagnostics.raw_hash.len(), 64, "{id}: raw hash");
}

fn assert_debug_redacted(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let diagnostics = required_object_map(expected, "diagnostics", id);
    let debug = format!("{request:?}");
    for forbidden in required_array_map(diagnostics, "redactedNotContains", id) {
        let forbidden = forbidden.as_str().expect("forbidden string");
        assert!(
            !debug.contains(forbidden),
            "{id}: debug output leaked forbidden value"
        );
    }
}

fn fixture_cases() -> Vec<Value> {
    let root: Value = serde_json::from_str(CASES_JSON).expect("parse external launch fixtures");
    root.as_array()
        .expect("fixture root must be an array")
        .to_vec()
}

fn required_text<'a>(value: &'a Value, key: &str) -> &'a str {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("{key} must be a string"))
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
