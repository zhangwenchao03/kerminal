use super::*;

pub(super) fn history_candidate(
    request: &NormalizedSuggestionRequest,
    entry: CommandHistoryEntry,
    index: usize,
) -> Option<CommandSuggestionCandidate> {
    if entry.command == request.prefix || !entry.command.starts_with(&request.prefix) {
        return None;
    }
    if is_sensitive_command(&entry.command) {
        return None;
    }

    let suffix = entry.command.strip_prefix(&request.prefix)?.to_owned();
    let sensitivity = if is_dangerous_command(&entry.command) {
        CommandSuggestionSensitivity::Dangerous
    } else {
        CommandSuggestionSensitivity::Normal
    };
    let score = history_score(request, &entry, index, sensitivity);
    let description = history_description(request, &entry, sensitivity);
    let source_id = entry.id.clone();
    let mut metadata = BTreeMap::new();
    metadata.insert("createdAt".to_owned(), entry.created_at.clone());
    metadata.insert("source".to_owned(), entry.source.as_str().to_owned());

    Some(CommandSuggestionCandidate {
        id: format!("history:{}", entry.id),
        provider: SuggestionProviderKind::History,
        display_text: entry.command.clone(),
        replacement_text: entry.command.clone(),
        replacement_range: CommandSuggestionReplacementRange {
            start: 0,
            end: request.cursor,
        },
        suffix,
        score,
        sensitivity,
        description: Some(description),
        source_id: Some(source_id),
        metadata: Some(metadata),
    })
}

pub(super) fn history_score(
    request: &NormalizedSuggestionRequest,
    entry: &CommandHistoryEntry,
    index: usize,
    sensitivity: CommandSuggestionSensitivity,
) -> f64 {
    let mut score = 0.55;
    if request
        .remote_host_id
        .as_deref()
        .is_some_and(|host_id| entry.remote_host_id.as_deref() == Some(host_id))
    {
        score += 0.20;
    }
    if request
        .cwd
        .as_deref()
        .is_some_and(|cwd| entry.cwd.as_deref() == Some(cwd))
    {
        score += 0.15;
    }
    if request
        .session_id
        .as_deref()
        .is_some_and(|session_id| entry.session_id.as_deref() == Some(session_id))
    {
        score += 0.08;
    }
    if entry.source == CommandHistorySource::User {
        score += 0.04;
    }
    score += (HISTORY_SCAN_LIMIT.saturating_sub(index).min(100) as f64) / 5_000.0;
    if sensitivity == CommandSuggestionSensitivity::Dangerous {
        score -= 0.35;
    }
    score.clamp(0.0, 1.0)
}

pub(super) fn history_description(
    request: &NormalizedSuggestionRequest,
    entry: &CommandHistoryEntry,
    sensitivity: CommandSuggestionSensitivity,
) -> String {
    if sensitivity == CommandSuggestionSensitivity::Dangerous {
        return "历史命令，包含危险操作，已降权".to_owned();
    }
    if request
        .cwd
        .as_deref()
        .is_some_and(|cwd| entry.cwd.as_deref() == Some(cwd))
    {
        return "历史命令，匹配当前目录".to_owned();
    }
    if request
        .remote_host_id
        .as_deref()
        .is_some_and(|host_id| entry.remote_host_id.as_deref() == Some(host_id))
    {
        return "历史命令，匹配当前主机".to_owned();
    }
    "历史命令".to_owned()
}

pub(super) fn remote_history_candidate(
    request: &NormalizedSuggestionRequest,
    command: &str,
    cache_entry: &RemoteHistoryCacheEntry,
    index: usize,
) -> Option<CommandSuggestionCandidate> {
    if command == request.prefix || !command.starts_with(&request.prefix) {
        return None;
    }
    if !is_cacheable_remote_history_command(command) {
        return None;
    }

    let suffix = command.strip_prefix(&request.prefix)?.to_owned();
    let sensitivity = if is_dangerous_command(command) {
        CommandSuggestionSensitivity::Dangerous
    } else {
        CommandSuggestionSensitivity::Normal
    };
    let mut metadata = BTreeMap::new();
    metadata.insert(
        "cachedAtUnixMs".to_owned(),
        unix_time_millis(cache_entry.cached_at).to_string(),
    );
    metadata.insert("source".to_owned(), "remoteShellHistory".to_owned());
    metadata.insert("ttlSeconds".to_owned(), cache_entry.ttl_seconds.to_string());

    Some(CommandSuggestionCandidate {
        id: format!(
            "remoteHistory:{}:{}",
            request.remote_host_id.as_deref().unwrap_or_default(),
            index
        ),
        provider: SuggestionProviderKind::History,
        display_text: command.to_owned(),
        replacement_text: command.to_owned(),
        replacement_range: CommandSuggestionReplacementRange {
            start: 0,
            end: request.cursor,
        },
        suffix,
        score: remote_history_score(index, sensitivity),
        sensitivity,
        description: Some(if sensitivity == CommandSuggestionSensitivity::Dangerous {
            "远端 shell history，包含危险操作，已降权".to_owned()
        } else {
            "远端 shell history，匹配当前主机".to_owned()
        }),
        source_id: Some(format!(
            "remoteHistory:{}:{}",
            request.remote_host_id.as_deref().unwrap_or_default(),
            index
        )),
        metadata: Some(metadata),
    })
}

pub(super) fn remote_history_score(index: usize, sensitivity: CommandSuggestionSensitivity) -> f64 {
    let mut score = 0.68 + (HISTORY_SCAN_LIMIT.saturating_sub(index).min(100) as f64) / 10_000.0;
    if sensitivity == CommandSuggestionSensitivity::Dangerous {
        score -= 0.35;
    }
    score.clamp(0.0, 1.0)
}

pub(super) fn remote_command_candidate(
    request: &NormalizedSuggestionRequest,
    token: &RemoteCommandToken,
    command: &str,
    cache_entry: &RemoteCommandCacheEntry,
    index: usize,
) -> Option<CommandSuggestionCandidate> {
    let replacement_text = format!("{}{}", char_prefix(&request.prefix, token.start), command);
    if replacement_text == request.prefix || !replacement_text.starts_with(&request.prefix) {
        return None;
    }
    let suffix = replacement_text.strip_prefix(&request.prefix)?.to_owned();
    let mut metadata = BTreeMap::new();
    metadata.insert(
        "cachedAtUnixMs".to_owned(),
        unix_time_millis(cache_entry.cached_at).to_string(),
    );
    metadata.insert("ttlSeconds".to_owned(), cache_entry.ttl_seconds.to_string());
    let source = remote_command_source(command);
    metadata.insert("source".to_owned(), source.to_owned());
    let description = if source == "posixBuiltin" {
        "远端 shell 内建命令，来自 POSIX sh 默认集合"
    } else {
        "远端命令，来自 PATH 缓存"
    };

    Some(CommandSuggestionCandidate {
        id: format!(
            "remoteCommand:{}:{}",
            request.remote_host_id.as_deref().unwrap_or_default(),
            command
        ),
        provider: SuggestionProviderKind::RemoteCommand,
        display_text: replacement_text.clone(),
        replacement_text,
        replacement_range: CommandSuggestionReplacementRange {
            start: token.start,
            end: request.cursor,
        },
        suffix,
        score: remote_command_score(command, index),
        sensitivity: CommandSuggestionSensitivity::Normal,
        description: Some(description.to_owned()),
        source_id: Some(command.to_owned()),
        metadata: Some(metadata),
    })
}

pub(super) fn remote_command_source(command: &str) -> &'static str {
    if POSIX_SHELL_BUILTINS.contains(&command) {
        "posixBuiltin"
    } else {
        "path"
    }
}

pub(super) fn remote_command_score(command: &str, index: usize) -> f64 {
    let mut score = 0.58;
    if POSIX_SHELL_BUILTINS.contains(&command) {
        score += 0.04;
    }
    score += (100usize.saturating_sub(index).min(100) as f64) / 10_000.0;
    score.clamp(0.0, 1.0)
}
