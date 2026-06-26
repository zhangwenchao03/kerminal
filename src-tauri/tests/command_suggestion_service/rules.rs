//! 命令建议规则模型集成测试。
//!
//! @author kongweiguang

use kerminal_lib::services::command_suggestion_service::{
    classification::{is_dangerous_command, is_sensitive_command},
    discovery::{
        git_discovery_script, parse_remote_history_commands, REMOTE_COMMAND_DISCOVERY_SCRIPT,
    },
};

#[test]
fn sensitive_and_dangerous_patterns_are_classified() {
    assert!(is_sensitive_command(
        "curl -H 'Authorization: Bearer token'"
    ));
    assert!(!is_sensitive_command("git status --short"));
    assert!(is_dangerous_command("rm -rf /tmp/build"));
    assert!(!is_dangerous_command("rm -rf target"));
}

#[test]
fn remote_history_parser_keeps_recent_unique_safe_commands() {
    let commands = parse_remote_history_commands(
        "\
git status --short
: 1760000000:0;deploy --dry-run --target staging
export API_TOKEN=secret-value
deploy --force
deploy --dry-run --target staging
",
        10,
    );

    assert_eq!(
        commands,
        vec![
            "deploy --dry-run --target staging",
            "deploy --force",
            "git status --short"
        ]
    );
}

#[test]
fn remote_command_discovery_script_stays_posix_sh_compatible() {
    for forbidden in [
        "bash",
        "zsh",
        "fish",
        "compgen",
        "declare",
        "typeset",
        "function ",
        "[[",
        "]]",
        "mapfile",
        "readarray",
    ] {
        assert!(
            !REMOTE_COMMAND_DISCOVERY_SCRIPT.contains(forbidden),
            "remote command discovery script should not require {forbidden}"
        );
    }
    assert!(REMOTE_COMMAND_DISCOVERY_SCRIPT.contains("PATH_VALUE=${PATH:-}"));
    assert!(REMOTE_COMMAND_DISCOVERY_SCRIPT.contains("printf '%s\\n'"));
}

#[test]
fn git_discovery_script_uses_shell_printf_tabs_for_real_git() {
    let script = git_discovery_script("/tmp/repo").expect("build git discovery script");

    assert!(script.contains("printf 'branch\\t%s\\n'"));
    assert!(script.contains("printf 'remoteBranch\\t%s\\n'"));
    assert!(script.contains("printf 'tag\\t%s\\n'"));
    assert!(!script.contains("--format='branch\\t"));
    assert!(!script.contains("--format='remoteBranch\\t"));
    assert!(!script.contains("--format='tag\\t"));
}
