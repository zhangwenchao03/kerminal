//! SSH auth broker tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    services::{
        ssh_credential_resolver::{
            ResolvedSshAuthMaterial, ResolvedSshCredentialSource, ResolvedSshHopAuth,
            ResolvedSshHopRole, ResolvedSshRouteAuth, ResolvedSshRouteAuthSummary,
        },
        ssh_runtime::{
            auth_broker::{SshAuthBroker, SshAuthBrokerResolution, SshSessionSecretInput},
            SshAuthSecretKind,
        },
    },
};

#[test]
fn broker_reports_prompt_for_missing_password_without_secret_material() {
    let broker = SshAuthBroker::new();
    let route = prompt_only_password_route();

    let resolution = broker.resolve_route_auth(&route).expect("resolution");

    let SshAuthBrokerResolution::PromptRequired {
        partial_auth,
        prompt_plan,
    } = resolution
    else {
        panic!("expected prompt-required resolution");
    };
    assert_eq!(prompt_plan.prompts.len(), 1);
    assert_eq!(
        prompt_plan.prompts[0].prompt_id,
        "ssh-auth:target:deploy@example.com:22:password"
    );
    assert_eq!(
        prompt_plan.prompts[0].secret_kind,
        SshAuthSecretKind::Password
    );
    assert!(partial_auth.summary.target.prompt_required);
    assert_redacted(&prompt_plan, "session-password");
}

#[test]
fn broker_uses_session_only_password_and_keeps_debug_output_redacted() {
    let broker = SshAuthBroker::new();
    let route = prompt_only_password_route();
    let prompt_id = "ssh-auth:target:deploy@example.com:22:password";

    broker
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: prompt_id.to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "session-password".to_owned(),
        })
        .expect("remember session secret");

    let resolution = broker.resolve_route_auth(&route).expect("resolution");

    let SshAuthBrokerResolution::Ready { auth } = resolution else {
        panic!("expected ready resolution");
    };
    match &auth.target.material {
        ResolvedSshAuthMaterial::Password { value, source } => {
            assert_eq!(value, "session-password");
            assert_eq!(
                source,
                &ResolvedSshCredentialSource::SessionOnly {
                    prompt_id: prompt_id.to_owned()
                }
            );
        }
        other => panic!("expected session-only password, got {other:?}"),
    }
    assert!(!auth.summary.target.prompt_required);
    assert!(auth.summary.target.has_secret_material);
    assert_redacted(&auth.target.material, "session-password");
    assert_redacted(&broker, "session-password");

    let snapshot = broker.snapshot().expect("snapshot");
    assert_eq!(snapshot.session_only_secret_count, 1);
    assert_eq!(snapshot.session_only_secrets[0].prompt_id, prompt_id);
    assert_redacted(&snapshot, "session-password");
}

#[test]
fn broker_can_clear_session_only_secret() {
    let broker = SshAuthBroker::new();
    let prompt_id = "ssh-auth:target:deploy@example.com:22:password";
    broker
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: prompt_id.to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "session-password".to_owned(),
        })
        .expect("remember");

    assert!(broker
        .forget_session_secret(prompt_id, SshAuthSecretKind::Password)
        .expect("forget"));
    assert_eq!(
        broker
            .snapshot()
            .expect("snapshot")
            .session_only_secret_count,
        0
    );
    assert!(!broker
        .forget_session_secret(prompt_id, SshAuthSecretKind::Password)
        .expect("forget again"));
}

#[test]
fn stale_receipt_cannot_delete_a_newer_session_secret() {
    let broker = SshAuthBroker::new();
    let route = prompt_only_password_route();
    let prompt_id = "ssh-auth:target:deploy@example.com:22:password";
    let stale = broker
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: prompt_id.to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "first-session-password".to_owned(),
        })
        .expect("remember first generation");
    broker
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: prompt_id.to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "second-session-password".to_owned(),
        })
        .expect("remember replacement generation");

    assert!(!broker
        .forget_session_secret_receipt(&stale)
        .expect("stale receipt cleanup"));
    let SshAuthBrokerResolution::Ready { auth } = broker
        .resolve_route_auth(&route)
        .expect("resolve newer secret")
    else {
        panic!("newer secret must remain available");
    };
    let ResolvedSshAuthMaterial::Password { value, .. } = auth.target.material else {
        panic!("expected password material");
    };
    assert_eq!(value, "second-session-password");
}

#[test]
fn broker_rejects_empty_or_invalid_session_secret_input() {
    let broker = SshAuthBroker::new();

    let empty = broker
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: "ssh-auth:target:deploy@example.com:22:password".to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "   ".to_owned(),
        })
        .expect_err("empty secret");
    assert!(matches!(empty, AppError::InvalidInput(_)));

    let newline = broker
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: "bad\nprompt".to_owned(),
            secret_kind: SshAuthSecretKind::Password,
            value: "session-password".to_owned(),
        })
        .expect_err("invalid prompt id");
    assert!(matches!(newline, AppError::InvalidInput(_)));
}

#[test]
fn broker_supports_session_only_private_key_material() {
    let broker = SshAuthBroker::new();
    let route = prompt_only_private_key_route();
    let prompt_id = "ssh-auth:target:deploy@example.com:22:private-key";
    broker
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: prompt_id.to_owned(),
            secret_kind: SshAuthSecretKind::PrivateKey,
            value: "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-key\n".to_owned(),
        })
        .expect("remember");

    let resolution = broker.resolve_route_auth(&route).expect("resolution");

    let SshAuthBrokerResolution::Ready { auth } = resolution else {
        panic!("expected ready resolution");
    };
    match &auth.target.material {
        ResolvedSshAuthMaterial::PrivateKeyPem {
            content, source, ..
        } => {
            assert!(content.contains("secret-key"));
            assert_eq!(
                source,
                &ResolvedSshCredentialSource::SessionOnly {
                    prompt_id: prompt_id.to_owned()
                }
            );
        }
        other => panic!("expected session-only private key, got {other:?}"),
    }
    assert_redacted(&auth.target.material, "secret-key");
}

fn prompt_only_password_route() -> ResolvedSshRouteAuth {
    route_with_material(ResolvedSshAuthMaterial::PromptOnly {
        source: ResolvedSshCredentialSource::PromptOnly,
        reason: "target password is not stored".to_owned(),
    })
}

fn prompt_only_private_key_route() -> ResolvedSshRouteAuth {
    route_with_material(ResolvedSshAuthMaterial::PromptOnly {
        source: ResolvedSshCredentialSource::PromptOnly,
        reason: "private key material is not configured".to_owned(),
    })
}

fn route_with_material(material: ResolvedSshAuthMaterial) -> ResolvedSshRouteAuth {
    let target = ResolvedSshHopAuth::from_material(
        ResolvedSshHopRole::Target,
        "example.com".to_owned(),
        22,
        "deploy".to_owned(),
        material,
    );
    ResolvedSshRouteAuth {
        summary: ResolvedSshRouteAuthSummary {
            target: target.summary.clone(),
            jumps: Vec::new(),
        },
        target,
        jumps: Vec::new(),
    }
}

fn assert_redacted(value: &impl std::fmt::Debug, secret: &str) {
    assert!(
        !format!("{value:?}").contains(secret),
        "debug output leaked secret"
    );
}
