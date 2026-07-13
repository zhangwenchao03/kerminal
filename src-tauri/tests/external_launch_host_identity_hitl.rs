//! 外部启动 SSH 主机密钥真实 loopback 轮换验证。
//!
//! @author kongweiguang

use std::{env, path::PathBuf};

use kerminal_lib::{
    paths::KerminalPaths,
    services::{
        external_launch::{
            inspect_external_host_key, trust_external_host_key, ExternalHostKeyStatus,
            ExternalLaunchEntrypoint, ExternalLaunchIntake, ExternalSessionMaterializer,
        },
        ssh_runtime::auth_broker::SshAuthBroker,
    },
};

/// 由本地验证脚本显式启用；普通 CI 不依赖 WSL、OpenSSH server 或固定端口。
#[tokio::test]
#[ignore = "requires an explicitly managed loopback OpenSSH server"]
async fn loopback_host_key_state_matches_expected_rotation_phase() {
    let root = PathBuf::from(
        env::var("KERMINAL_EXTERNAL_HOST_KEY_HITL_ROOT")
            .expect("set KERMINAL_EXTERNAL_HOST_KEY_HITL_ROOT"),
    );
    let host =
        env::var("KERMINAL_EXTERNAL_HOST_KEY_HITL_HOST").unwrap_or_else(|_| "127.0.0.1".to_owned());
    let port = env::var("KERMINAL_EXTERNAL_HOST_KEY_HITL_PORT")
        .unwrap_or_else(|_| "22229".to_owned())
        .parse::<u16>()
        .expect("valid loopback port");
    let phase = env::var("KERMINAL_EXTERNAL_HOST_KEY_HITL_PHASE")
        .expect("set KERMINAL_EXTERNAL_HOST_KEY_HITL_PHASE");
    let paths = KerminalPaths::from_root(root);
    paths.ensure_directories().expect("ensure HITL root");
    let intake = ExternalLaunchIntake::new();
    intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                format!("probe@{host}"),
                "-P".to_owned(),
                port.to_string(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue loopback launch");
    let request = intake
        .take_pending()
        .expect("claim loopback launch")
        .into_iter()
        .next()
        .expect("one loopback launch");
    let materializer = ExternalSessionMaterializer::new(intake, SshAuthBroker::new());
    let target = materializer
        .materialize(&paths, &request.id, None)
        .expect("materialize loopback target");
    let inspection = inspect_external_host_key(&paths, &target)
        .await
        .expect("inspect real loopback key");

    match phase.as_str() {
        "trust" => {
            assert_eq!(inspection.status, ExternalHostKeyStatus::Unknown);
            let trusted = trust_external_host_key(&paths, &target, &inspection.fingerprint)
                .await
                .expect("trust real loopback key");
            assert_eq!(trusted.status, ExternalHostKeyStatus::Known);
            assert_eq!(trusted.fingerprint, inspection.fingerprint);
        }
        "known" => assert_eq!(inspection.status, ExternalHostKeyStatus::Known),
        "changed" => assert_eq!(inspection.status, ExternalHostKeyStatus::Changed),
        other => panic!("unsupported HITL phase: {other}"),
    }
}
