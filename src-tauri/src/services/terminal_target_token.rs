//! Terminal target capability token helpers。
//!
//! @author kongweiguang

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const TARGET_TOKEN_VERSION: &str = "v1";
const TARGET_TOKEN_SCOPE_BINDING_REGISTER: &str = "terminal.binding.register";

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
pub struct TerminalTargetTokenSigner {
    secret: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalTargetCapability {
    pub token: String,
    pub jti: String,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
}

impl TerminalTargetCapability {
    pub fn token(&self) -> String {
        self.token.clone()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalTargetTokenClaims {
    pub jti: String,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
}

impl Default for TerminalTargetTokenSigner {
    fn default() -> Self {
        Self {
            secret: Uuid::new_v4().to_string(),
        }
    }
}

impl TerminalTargetTokenSigner {
    pub fn sign_binding_register(
        &self,
        session_id: &str,
        target_ref: &str,
        issued_at_ms: u64,
        ttl_ms: u64,
    ) -> TerminalTargetCapability {
        let jti = Uuid::new_v4().to_string();
        let expires_at_ms = issued_at_ms.saturating_add(ttl_ms);
        let signature = self.sign(session_id, target_ref, &jti, issued_at_ms, expires_at_ms);
        let token = format!(
            "{TARGET_TOKEN_VERSION}.{jti}.{issued_at_ms}.{expires_at_ms}.{}",
            URL_SAFE_NO_PAD.encode(signature)
        );
        TerminalTargetCapability {
            token,
            jti,
            issued_at_ms,
            expires_at_ms,
        }
    }

    pub fn sign_binding_register_now(
        &self,
        session_id: &str,
        target_ref: &str,
        ttl_ms: u64,
    ) -> TerminalTargetCapability {
        self.sign_binding_register(session_id, target_ref, now_ms(), ttl_ms)
    }

    pub fn verify_binding_register(
        &self,
        session_id: &str,
        target_ref: &str,
        token: &str,
        now_ms: u64,
    ) -> Option<TerminalTargetTokenClaims> {
        let parsed = parse_token(token)?;
        if parsed.expires_at_ms < now_ms {
            return None;
        }
        let expected_signature = self.sign(
            session_id,
            target_ref,
            &parsed.jti,
            parsed.issued_at_ms,
            parsed.expires_at_ms,
        );
        if constant_time_eq(
            URL_SAFE_NO_PAD.encode(expected_signature).as_bytes(),
            parsed.signature.as_bytes(),
        ) {
            Some(TerminalTargetTokenClaims {
                jti: parsed.jti,
                issued_at_ms: parsed.issued_at_ms,
                expires_at_ms: parsed.expires_at_ms,
            })
        } else {
            None
        }
    }

    pub fn verify_binding_register_now(
        &self,
        session_id: &str,
        target_ref: &str,
        token: &str,
    ) -> Option<TerminalTargetTokenClaims> {
        self.verify_binding_register(session_id, target_ref, token, now_ms())
    }

    fn sign(
        &self,
        session_id: &str,
        target_ref: &str,
        jti: &str,
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> hmac::digest::Output<HmacSha256> {
        let mut mac =
            HmacSha256::new_from_slice(self.secret.as_bytes()).expect("HMAC accepts any key size");
        mac.update(TARGET_TOKEN_VERSION.as_bytes());
        mac.update(b"\0");
        mac.update(TARGET_TOKEN_SCOPE_BINDING_REGISTER.as_bytes());
        mac.update(b"\0");
        mac.update(session_id.as_bytes());
        mac.update(b"\0");
        mac.update(target_ref.as_bytes());
        mac.update(b"\0");
        mac.update(jti.as_bytes());
        mac.update(b"\0");
        mac.update(issued_at_ms.to_string().as_bytes());
        mac.update(b"\0");
        mac.update(expires_at_ms.to_string().as_bytes());
        mac.finalize().into_bytes()
    }

    pub fn matches(expected: &str, provided: &str) -> bool {
        constant_time_eq(expected.as_bytes(), provided.as_bytes())
    }
}

struct ParsedTerminalTargetToken {
    jti: String,
    issued_at_ms: u64,
    expires_at_ms: u64,
    signature: String,
}

fn parse_token(token: &str) -> Option<ParsedTerminalTargetToken> {
    let mut parts = token.split('.');
    let version = parts.next()?;
    if version != TARGET_TOKEN_VERSION {
        return None;
    }
    let jti = parts.next()?.to_owned();
    let issued_at_ms = parts.next()?.parse().ok()?;
    let expires_at_ms = parts.next()?.parse().ok()?;
    let signature = parts.next()?.to_owned();
    if parts.next().is_some() || jti.is_empty() || signature.is_empty() {
        return None;
    }
    Some(ParsedTerminalTargetToken {
        jti,
        issued_at_ms,
        expires_at_ms,
        signature,
    })
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0u8, |acc, (left, right)| acc | (left ^ right))
        == 0
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
