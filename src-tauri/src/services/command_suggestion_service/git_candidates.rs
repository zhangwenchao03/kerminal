use super::*;

pub(super) fn git_ref_candidate(
    request: &NormalizedSuggestionRequest,
    token: &GitSuggestionToken,
    entry: &GitRefEntry,
    cache_entry: &GitCacheEntry,
    index: usize,
) -> Option<CommandSuggestionCandidate> {
    let replacement_text = format!(
        "{}{}",
        char_prefix(&request.prefix, token.start),
        entry.name
    );
    if replacement_text == request.prefix || !replacement_text.starts_with(&request.prefix) {
        return None;
    }
    let suffix = replacement_text.strip_prefix(&request.prefix)?.to_owned();
    let mut metadata = BTreeMap::new();
    metadata.insert(
        "cachedAtUnixMs".to_owned(),
        unix_time_millis(cache_entry.cached_at).to_string(),
    );
    metadata.insert("cwd".to_owned(), cache_entry.cwd.clone());
    metadata.insert("kind".to_owned(), git_ref_kind_name(entry.kind).to_owned());
    metadata.insert("subcommand".to_owned(), token.subcommand.clone());
    metadata.insert("ttlSeconds".to_owned(), cache_entry.ttl_seconds.to_string());
    if let Some(repo_root) = cache_entry.repo_root.as_ref() {
        metadata.insert("repoRoot".to_owned(), repo_root.clone());
    }

    Some(CommandSuggestionCandidate {
        id: format!(
            "git:{}:{}:{}",
            request.remote_host_id.as_deref().unwrap_or_default(),
            git_ref_kind_name(entry.kind),
            entry.name
        ),
        provider: SuggestionProviderKind::Git,
        display_text: replacement_text.clone(),
        replacement_text,
        replacement_range: CommandSuggestionReplacementRange {
            start: token.start,
            end: request.cursor,
        },
        suffix,
        score: git_ref_score(entry.kind, index),
        sensitivity: CommandSuggestionSensitivity::Normal,
        description: Some(format!(
            "Git {}，来自远端仓库缓存",
            git_ref_kind_description(entry.kind)
        )),
        source_id: Some(entry.name.clone()),
        metadata: Some(metadata),
    })
}

pub(super) fn git_ref_score(kind: GitRefKind, index: usize) -> f64 {
    let base = match kind {
        GitRefKind::Branch => 0.68,
        GitRefKind::Remote => 0.67,
        GitRefKind::RemoteBranch => 0.64,
        GitRefKind::Tag => 0.60,
    };
    (base + (100usize.saturating_sub(index).min(100) as f64) / 10_000.0).clamp(0.0, 1.0)
}

pub(super) fn git_ref_kind_matches(expected: GitSuggestionKind, actual: GitRefKind) -> bool {
    match expected {
        GitSuggestionKind::BranchOrRef | GitSuggestionKind::Ref => {
            matches!(
                actual,
                GitRefKind::Branch | GitRefKind::RemoteBranch | GitRefKind::Tag
            )
        }
        GitSuggestionKind::Remote => actual == GitRefKind::Remote,
    }
}

pub(super) fn git_ref_kind_name(kind: GitRefKind) -> &'static str {
    match kind {
        GitRefKind::Branch => "branch",
        GitRefKind::Remote => "remote",
        GitRefKind::RemoteBranch => "remoteBranch",
        GitRefKind::Tag => "tag",
    }
}

pub(super) fn git_ref_kind_description(kind: GitRefKind) -> &'static str {
    match kind {
        GitRefKind::Branch => "分支",
        GitRefKind::Remote => "远端",
        GitRefKind::RemoteBranch => "远端分支",
        GitRefKind::Tag => "标签",
    }
}

pub(super) fn git_suggestion_token(prefix: &str) -> Option<GitSuggestionToken> {
    let segment_start = shell_command_segment_start(prefix);
    let segment = prefix.chars().skip(segment_start).collect::<String>();
    let words = parse_simple_shell_words(&segment, segment_start)?;
    if words.first()?.text != "git" {
        return None;
    }

    let cursor = prefix.chars().count();
    let ends_with_whitespace = prefix.chars().last().is_some_and(char::is_whitespace);
    let (name, start, completed_words) = if ends_with_whitespace {
        (String::new(), cursor, words.clone())
    } else {
        let current = words.last()?;
        (
            current.text.clone(),
            current.start,
            words[..words.len().saturating_sub(1)].to_vec(),
        )
    };
    if name.starts_with('-') || !is_cacheable_git_ref_prefix(&name) {
        return None;
    }

    let subcommand_index = git_subcommand_index(&completed_words)?;
    let subcommand = completed_words
        .get(subcommand_index)?
        .text
        .to_ascii_lowercase();
    let args_before_current = &completed_words[subcommand_index + 1..];
    let kind = git_suggestion_kind(&subcommand, args_before_current)?;
    Some(GitSuggestionToken {
        kind,
        name,
        start,
        subcommand,
    })
}

pub(super) fn git_subcommand_index(words: &[ShellWord]) -> Option<usize> {
    let mut index = 1;
    while index < words.len() {
        let word = words[index].text.as_str();
        if matches!(word, "-C" | "-c" | "--git-dir" | "--work-tree") {
            index += 2;
            continue;
        }
        if word.starts_with("-C") && word.len() > 2 {
            index += 1;
            continue;
        }
        if word.starts_with('-') {
            index += 1;
            continue;
        }
        return Some(index);
    }
    None
}

pub(super) fn git_suggestion_kind(
    subcommand: &str,
    args_before_current: &[ShellWord],
) -> Option<GitSuggestionKind> {
    let args = git_positional_args(args_before_current);
    match subcommand {
        "checkout" | "switch" => {
            if args_before_current
                .iter()
                .any(|word| matches!(word.text.as_str(), "-b" | "-B" | "-c" | "-C" | "--orphan"))
            {
                return None;
            }
            Some(GitSuggestionKind::BranchOrRef)
        }
        "branch" => Some(GitSuggestionKind::BranchOrRef),
        "merge" | "rebase" | "show" | "log" | "diff" => Some(GitSuggestionKind::Ref),
        "fetch" | "pull" | "push" => {
            if args.is_empty() {
                Some(GitSuggestionKind::Remote)
            } else {
                Some(GitSuggestionKind::BranchOrRef)
            }
        }
        _ => None,
    }
}

pub(super) fn git_positional_args(words: &[ShellWord]) -> Vec<&str> {
    let mut args = Vec::new();
    let mut skip_next = false;
    for word in words {
        if skip_next {
            skip_next = false;
            continue;
        }
        let text = word.text.as_str();
        if matches!(
            text,
            "-m" | "--message" | "-t" | "--track" | "-u" | "--set-upstream-to"
        ) {
            skip_next = true;
            continue;
        }
        if text.starts_with('-') {
            continue;
        }
        args.push(text);
    }
    args
}
