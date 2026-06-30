# Plaintext SSH Credentials Verification Evidence Redaction

Date: 2026-06-30

The previous PNG screenshots with `plaintext-ssh-credentials` in the filename were moved out of `.updeng/docs/verification/` because verification evidence under `docs/` is now intended to be commit-visible. The filenames are secret-looking and may represent sensitive UI evidence.

Moved originals:

- `.updeng/tmp/verification-sensitive/2026-06-30-plaintext-ssh-credentials/plaintext-ssh-credentials-dev-smoke-cdp.png`
- `.updeng/tmp/verification-sensitive/2026-06-30-plaintext-ssh-credentials/plaintext-ssh-credentials-dev-smoke.png`
- `.updeng/tmp/verification-sensitive/2026-06-30-plaintext-ssh-credentials/plaintext-ssh-credentials-final-dev-smoke-cdp.png`

Follow-up: regenerate sanitized screenshots or a short manual verification record that proves the behavior without exposing credential-like content.
