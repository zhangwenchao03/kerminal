//! 命令建议远端发现与历史解析模型。
//!
//! @author kongweiguang

use super::*;

/// POSIX sh 兼容的远端命令发现脚本。
pub const REMOTE_COMMAND_DISCOVERY_SCRIPT: &str = r#"
PATH_VALUE=${PATH:-}
OLD_IFS=$IFS
IFS=:
for dir in $PATH_VALUE; do
  [ -d "$dir" ] || continue
  for item in "$dir"/*; do
    [ -f "$item" ] && [ -x "$item" ] && printf '%s\n' "${item##*/}"
  done
done
IFS=$OLD_IFS
"#;

pub(super) fn parse_remote_command_names(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|command| is_cacheable_remote_command(command))
        .map(ToOwned::to_owned)
        .collect()
}

/// 解析远端 shell history 输出，保留最近的安全去重命令。
pub fn parse_remote_history_commands(output: &str, max_entries: usize) -> Vec<String> {
    let commands = output
        .lines()
        .rev()
        .filter_map(normalize_remote_history_line)
        .collect::<Vec<_>>();
    normalize_remote_history_commands(commands, max_entries)
}

pub(super) fn normalize_remote_history_commands(
    commands: Vec<String>,
    max_entries: usize,
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for command in commands {
        let Some(command) = normalize_remote_history_line(&command) else {
            continue;
        };
        if seen.insert(command.clone()) {
            normalized.push(command);
        }
        if normalized.len() >= max_entries {
            break;
        }
    }
    normalized
}

pub(super) fn normalize_remote_history_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let command = if let Some(command) = parse_zsh_extended_history_line(trimmed) {
        command
    } else {
        trimmed
    };
    let command = command.trim();
    if is_cacheable_remote_history_command(command) {
        Some(command.to_owned())
    } else {
        None
    }
}

pub(super) fn parse_zsh_extended_history_line(line: &str) -> Option<&str> {
    if !line.starts_with(": ") {
        return None;
    }
    let (_, command) = line.split_once(';')?;
    Some(command)
}

/// 构造 POSIX sh 兼容的 Git 引用发现脚本。
pub fn git_discovery_script(cwd: &str) -> AppResult<String> {
    let cwd = shell_single_quote(cwd)?;
    Ok(format!(
        r#"cd {cwd} 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
printf 'repo\t%s\n' "$repo_root"
git for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null | while IFS= read -r ref; do
  [ -n "$ref" ] && printf 'branch\t%s\n' "$ref"
done
git for-each-ref --format='%(refname:short)' refs/remotes 2>/dev/null | while IFS= read -r ref; do
  [ -n "$ref" ] && printf 'remoteBranch\t%s\n' "$ref"
done
git for-each-ref --format='%(refname:short)' refs/tags 2>/dev/null | while IFS= read -r ref; do
  [ -n "$ref" ] && printf 'tag\t%s\n' "$ref"
done
git remote 2>/dev/null | while IFS= read -r remote; do
  [ -n "$remote" ] && printf 'remote\t%s\n' "$remote"
done
"#
    ))
}

pub(super) fn shell_single_quote(value: &str) -> AppResult<String> {
    if contains_control_character(value) {
        return Err(AppError::InvalidInput(
            "Shell 参数不能包含控制字符".to_owned(),
        ));
    }
    Ok(format!("'{}'", value.replace('\'', "'\"'\"'")))
}

pub(super) fn parse_git_discovery_output(output: &str) -> GitDiscoveryOutput {
    let mut repo_root = None;
    let mut entries = Vec::new();
    for line in output.lines() {
        let Some((kind, value)) = line.split_once('\t') else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match kind {
            "repo" => repo_root = Some(normalize_remote_cache_path(value)),
            "branch" if is_cacheable_git_ref_name(value) => entries.push(GitRefEntry {
                kind: GitRefKind::Branch,
                name: value.to_owned(),
            }),
            "remote" if is_cacheable_git_ref_name(value) => entries.push(GitRefEntry {
                kind: GitRefKind::Remote,
                name: value.to_owned(),
            }),
            "remoteBranch" if !value.ends_with("/HEAD") && is_cacheable_git_ref_name(value) => {
                entries.push(GitRefEntry {
                    kind: GitRefKind::RemoteBranch,
                    name: value.to_owned(),
                });
            }
            "tag" if is_cacheable_git_ref_name(value) => entries.push(GitRefEntry {
                kind: GitRefKind::Tag,
                name: value.to_owned(),
            }),
            _ => {}
        }
    }
    GitDiscoveryOutput { entries, repo_root }
}

pub(super) fn is_cacheable_remote_command(command: &str) -> bool {
    let char_count = command.chars().count();
    !command.is_empty()
        && char_count <= 128
        && !command.contains('/')
        && !contains_control_character(command)
        && command
            .chars()
            .all(|character| !character.is_whitespace() && !matches!(character, '\'' | '"'))
}

pub(super) fn is_cacheable_remote_history_command(command: &str) -> bool {
    let char_count = command.chars().count();
    !command.is_empty()
        && char_count <= MAX_INPUT_CHARS
        && !command.trim_start().starts_with('#')
        && !contains_control_character(command)
        && !is_sensitive_command(command)
}

pub(super) fn is_cacheable_git_ref_prefix(prefix: &str) -> bool {
    prefix.chars().count() <= 256
        && !contains_control_character(prefix)
        && prefix.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '_' | '-' | '.')
        })
}

pub(super) fn is_cacheable_git_ref_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && !name.starts_with('/')
        && !name.ends_with('/')
        && !name.contains("..")
        && !name.contains("@{")
        && is_cacheable_git_ref_prefix(name)
}
