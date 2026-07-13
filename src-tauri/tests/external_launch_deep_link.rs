//! 外部启动 deep-link 安全合同测试。
//!
//! @author kongweiguang

use kerminal_lib::services::external_launch::{
    accept_external_launch_protocol_args, external_launch_protocol_url_from_args,
    ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchIntake,
};

fn argv(url: &str) -> Vec<String> {
    vec!["kerminal.exe".to_owned(), url.to_owned()]
}

#[test]
fn accepts_allowlisted_protocol_through_protocol_entrypoint() {
    let intake = ExternalLaunchIntake::new();
    let outcome = accept_external_launch_protocol_args(
        &intake,
        argv("kerminal://ssh?host=server.example&port=2202&user=deploy"),
        None,
    )
    .expect("allowlisted URL should be accepted");

    let ExternalLaunchAcceptOutcome::Queued(queued) = outcome else {
        panic!("allowlisted URL should be queued");
    };
    assert_eq!(queued.entrypoint, ExternalLaunchEntrypoint::Protocol);
}

#[test]
fn rejects_invalid_action_and_authority_credentials() {
    for url in [
        "kerminal://settings?host=server.example",
        "kerminal://user:secret@ssh?host=server.example",
        "kerminal://ssh:2202?host=server.example",
        "kerminal://ssh/path?host=server.example",
    ] {
        let error =
            accept_external_launch_protocol_args(&ExternalLaunchIntake::new(), argv(url), None)
                .expect_err("unsafe authority or action must fail closed");
        assert!(!error.to_string().contains("secret"));
    }
}

#[test]
fn parser_rejects_secret_command_and_local_file_query_parameters() {
    for key in [
        "password",
        "passphrase",
        "remoteCommand",
        "identityFile",
        "file",
    ] {
        let url = format!("kerminal://ssh?host=server.example&{key}=canary");
        let outcome =
            accept_external_launch_protocol_args(&ExternalLaunchIntake::new(), argv(&url), None)
                .expect("parser rejection should be represented as a redacted outcome");
        let ExternalLaunchAcceptOutcome::Rejected(rejected) = outcome else {
            panic!("non-allowlisted query must fail closed");
        };
        assert_eq!(rejected.entrypoint, ExternalLaunchEntrypoint::Protocol);
        assert!(!rejected.message.contains("canary"));
    }
}

#[test]
fn recognizes_exactly_one_kerminal_url_without_claiming_other_schemes() {
    assert_eq!(
        external_launch_protocol_url_from_args(&argv("kerminal://ssh?host=server.example")),
        Some("kerminal://ssh?host=server.example")
    );
    assert_eq!(
        external_launch_protocol_url_from_args(&argv("https://example.com")),
        None
    );
    assert_eq!(
        external_launch_protocol_url_from_args(&[
            "kerminal.exe".to_owned(),
            "kerminal://ssh?host=a".to_owned(),
            "kerminal://ssh?host=b".to_owned(),
        ]),
        None
    );
}
