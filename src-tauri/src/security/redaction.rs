//! 终端、AI 上下文和审计摘要共用的敏感信息脱敏工具。
//!
//! @author kongweiguang

use std::sync::OnceLock;

use regex::Regex;

/// 对终端文本做基础密钥脱敏，避免日志、AI 上下文和审计摘要暴露常见 token。
pub fn redact_terminal_text(input: &str) -> (String, bool) {
    let secret_assignment = secret_assignment_regex()
        .replace_all(input, |captures: &regex::Captures<'_>| {
            format!("{}=[已脱敏]", &captures[1])
        })
        .to_string();
    let bearer = bearer_regex()
        .replace_all(&secret_assignment, "${1}[已脱敏]")
        .to_string();
    let api_key = api_key_regex()
        .replace_all(&bearer, |captures: &regex::Captures<'_>| {
            format!("{}[已脱敏:api-key]{}", &captures[1], &captures[3])
        })
        .to_string();

    let redacted = api_key != input;
    (api_key, redacted)
}

fn secret_assignment_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?i)\b(api[_-]?key|token|password|passwd|secret)\b\s*[:=]\s*["']?[^\s"']+"#)
            .expect("secret assignment regex must be valid")
    })
}

fn bearer_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(bearer\s+)[a-z0-9._~+/\-=]{10,}").expect("bearer regex must be valid")
    })
}

fn api_key_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)(^|[^A-Za-z0-9_-])(sk-[A-Za-z0-9_-]{10,})([^A-Za-z0-9_-]|$)")
            .expect("api key regex must be valid")
    })
}

#[cfg(test)]
mod tests {
    use super::redact_terminal_text;

    #[test]
    fn redacts_hyphenated_sk_tokens() {
        let (redacted, changed) = redact_terminal_text("prefix sk-terminal-secret-12345 suffix");

        assert!(changed);
        assert!(!redacted.contains("sk-terminal-secret-12345"));
        assert!(redacted.contains("prefix [已脱敏:api-key] suffix"));
    }
}
