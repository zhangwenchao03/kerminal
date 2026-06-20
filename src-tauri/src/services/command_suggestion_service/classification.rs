pub(super) fn is_sensitive_command(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    [
        "password",
        "passwd",
        "api_key",
        "apikey",
        "access_token",
        "auth_token",
        "secret",
        "private_key",
        "authorization:",
        "bearer ",
        "-----begin",
        "ssh-rsa ",
        "id_rsa",
        "id_ed25519",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

pub(super) fn is_dangerous_command(command: &str) -> bool {
    let lower = command.trim_start().to_ascii_lowercase();
    lower.starts_with("rm -rf /")
        || lower.starts_with("rm -fr /")
        || lower.starts_with("mkfs")
        || lower.starts_with("shutdown")
        || lower.starts_with("reboot")
        || lower.contains(" chmod -r 777 /")
        || lower.contains(" chown -r ")
        || lower.contains(" dd if=")
}
