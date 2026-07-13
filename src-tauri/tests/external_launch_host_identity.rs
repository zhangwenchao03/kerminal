//! 外部启动 SSH host key 分类测试。
//!
//! @author kongweiguang

use kerminal_lib::services::external_launch::{
    inspection_for_key, inspection_for_preprovisioned_route, ExternalHostKeyStatus,
};
use russh::keys::{self, Algorithm, PrivateKey};

#[test]
fn host_identity_distinguishes_unknown_known_and_changed_keys() {
    let temp = tempfile::tempdir().expect("temp known_hosts");
    let known_hosts = temp.path().join("known_hosts");
    let trusted = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .expect("generate trusted key")
        .public_key()
        .clone();
    let changed = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .expect("generate changed key")
        .public_key()
        .clone();

    let unknown = inspection_for_key(
        "launch-identity",
        "identity.example.internal",
        22,
        &trusted,
        &known_hosts,
    );
    assert_eq!(unknown.status, ExternalHostKeyStatus::Unknown);
    assert!(unknown.fingerprint.starts_with("SHA256:"));

    keys::known_hosts::learn_known_hosts_path(
        "identity.example.internal",
        22,
        &trusted,
        &known_hosts,
    )
    .expect("learn trusted key");
    assert_eq!(
        inspection_for_key(
            "launch-identity",
            "identity.example.internal",
            22,
            &trusted,
            &known_hosts,
        )
        .status,
        ExternalHostKeyStatus::Known
    );
    assert_eq!(
        inspection_for_key(
            "launch-identity",
            "identity.example.internal",
            22,
            &changed,
            &known_hosts,
        )
        .status,
        ExternalHostKeyStatus::Changed
    );
}

#[test]
fn host_identity_treats_openssh_revoked_key_as_hard_failure() {
    let temp = tempfile::tempdir().expect("temp known_hosts");
    let known_hosts = temp.path().join("known_hosts");
    let revoked = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .expect("generate revoked key")
        .public_key()
        .clone();
    std::fs::write(
        &known_hosts,
        format!(
            "@revoked *.internal {}\n",
            revoked.to_openssh().expect("encode key")
        ),
    )
    .expect("write revoked known_hosts entry");

    let inspection = inspection_for_key(
        "launch-revoked",
        "revoked.example.internal",
        22,
        &revoked,
        &known_hosts,
    );

    assert_eq!(inspection.status, ExternalHostKeyStatus::Changed);
}

#[test]
fn jump_chain_requires_every_hop_and_target_to_be_preprovisioned() {
    let temp = tempfile::tempdir().expect("temp known_hosts");
    let known_hosts = temp.path().join("known_hosts");
    let jump = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .expect("generate jump key")
        .public_key()
        .clone();
    let target = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .expect("generate target key")
        .public_key()
        .clone();

    keys::known_hosts::learn_known_hosts_path("jump.internal", 2222, &jump, &known_hosts)
        .expect("learn jump key");
    let missing_target = inspection_for_preprovisioned_route(
        "launch-route",
        "target.internal",
        22,
        &[("jump.internal".to_owned(), 2222)],
        &known_hosts,
    )
    .expect_err("target key must be preprovisioned");
    assert!(missing_target.to_string().contains("最终目标"));

    keys::known_hosts::learn_known_hosts_path("target.internal", 22, &target, &known_hosts)
        .expect("learn target key");
    let inspection = inspection_for_preprovisioned_route(
        "launch-route",
        "target.internal",
        22,
        &[("jump.internal".to_owned(), 2222)],
        &known_hosts,
    )
    .expect("complete preprovisioned route");
    assert_eq!(inspection.status, ExternalHostKeyStatus::Known);
    assert_eq!(
        inspection.fingerprint,
        target.fingerprint(russh::keys::HashAlg::Sha256).to_string()
    );
}

#[test]
fn jump_chain_rejects_a_missing_intermediate_hop() {
    let temp = tempfile::tempdir().expect("temp known_hosts");
    let known_hosts = temp.path().join("known_hosts");
    let target = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .expect("generate target key")
        .public_key()
        .clone();
    keys::known_hosts::learn_known_hosts_path("target.internal", 22, &target, &known_hosts)
        .expect("learn target key");

    let error = inspection_for_preprovisioned_route(
        "launch-route",
        "target.internal",
        22,
        &[("missing-jump.internal".to_owned(), 2222)],
        &known_hosts,
    )
    .expect_err("missing jump key must fail closed");
    assert!(error.to_string().contains("第 1 跳"));
}

#[test]
fn jump_chain_defensively_rejects_more_than_eight_hops() {
    let temp = tempfile::tempdir().expect("temp known_hosts");
    let jumps = (0..9)
        .map(|index| (format!("jump-{index}.internal"), 22))
        .collect::<Vec<_>>();

    let error = inspection_for_preprovisioned_route(
        "launch-route-limit",
        "target.internal",
        22,
        &jumps,
        &temp.path().join("known_hosts"),
    )
    .expect_err("identity layer must defend against oversized routes");

    assert!(error.to_string().contains("8 跳"));
}

#[test]
fn jump_chain_rejects_revoked_keys_on_every_hop_and_any_target_candidate() {
    let temp = tempfile::tempdir().expect("temp known_hosts");
    let known_hosts = temp.path().join("known_hosts");
    let jump = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .expect("generate jump key")
        .public_key()
        .clone();
    let target = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
        .expect("generate target key")
        .public_key()
        .clone();
    keys::known_hosts::learn_known_hosts_path("jump.internal", 2222, &jump, &known_hosts)
        .expect("learn jump key");
    keys::known_hosts::learn_known_hosts_path("target.internal", 22, &target, &known_hosts)
        .expect("learn target key");
    append_revoked_key(&known_hosts, &jump);

    let jump_error = inspection_for_preprovisioned_route(
        "launch-route",
        "target.internal",
        22,
        &[("jump.internal".to_owned(), 2222)],
        &known_hosts,
    )
    .expect_err("revoked jump key must fail closed");
    assert!(jump_error.to_string().contains("第 1 跳"));
    assert!(jump_error.to_string().contains("revoked"));

    std::fs::write(&known_hosts, "").expect("reset known_hosts");
    keys::known_hosts::learn_known_hosts_path("jump.internal", 2222, &jump, &known_hosts)
        .expect("relearn jump key");
    keys::known_hosts::learn_known_hosts_path("target.internal", 22, &target, &known_hosts)
        .expect("relearn target key");
    append_revoked_key(&known_hosts, &target);
    let target_error = inspection_for_preprovisioned_route(
        "launch-route",
        "target.internal",
        22,
        &[("jump.internal".to_owned(), 2222)],
        &known_hosts,
    )
    .expect_err("any revoked target candidate must fail closed");
    assert!(target_error.to_string().contains("revoked"));
}

fn append_revoked_key(path: &std::path::Path, key: &russh::keys::PublicKey) {
    use std::io::Write;

    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .expect("open known_hosts for revoked marker");
    writeln!(
        file,
        "@revoked *.internal {}",
        key.to_openssh().expect("encode revoked key")
    )
    .expect("append revoked key");
}
