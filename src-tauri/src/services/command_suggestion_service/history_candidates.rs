use super::*;
use crate::models::command_suggestion::SuggestionPresentation;

/// 将有界历史扫描结果压缩为有界唯一候选，并保留重复频率。
///
/// 历史表允许同一命令多次出现；先在内存中按完整 replacement 合并，可以避免
/// 高频命令挤占全部召回槽位，同时不增加 SQLite 查询。
pub(super) fn local_history_candidates(
    request: &NormalizedSuggestionRequest,
    history: Vec<CommandHistoryEntry>,
    recall_limit: usize,
) -> Vec<CommandSuggestionCandidate> {
    let mut positions = HashMap::<String, usize>::new();
    let mut candidates = Vec::<CommandSuggestionCandidate>::new();
    for (index, entry) in history.into_iter().enumerate() {
        let Some(candidate) = history_candidate(request, entry, index) else {
            continue;
        };
        let normalized = normalize_history_replacement(&candidate.replacement_text);
        if let Some(position) = positions.get(&normalized).copied() {
            let metadata = candidates[position]
                .metadata
                .get_or_insert_with(BTreeMap::new);
            let frequency = metadata
                .get("frequency")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(1)
                .saturating_add(1);
            metadata.insert("frequency".to_owned(), frequency.to_string());
            continue;
        }
        if candidates.len() >= recall_limit {
            continue;
        }
        positions.insert(normalized, candidates.len());
        candidates.push(candidate);
    }
    candidates
}

/// 对候选菜单执行有界词级召回；模糊结果永远不进入 inline。
pub(super) fn menu_history_candidates(
    request: &NormalizedSuggestionRequest,
    history: Vec<CommandHistoryEntry>,
    recall_limit: usize,
) -> Vec<CommandSuggestionCandidate> {
    let query_words = menu_query_words(&request.prefix);
    if query_words.is_empty() {
        return Vec::new();
    }

    let mut positions = HashMap::<String, usize>::new();
    let mut candidates = Vec::<CommandSuggestionCandidate>::new();
    for (index, entry) in history.into_iter().enumerate() {
        if candidates.len() >= recall_limit {
            break;
        }
        let Some((match_score, matched_word_index)) =
            menu_history_match_score(&query_words, &entry.command)
        else {
            continue;
        };
        if is_sensitive_command(&entry.command) {
            continue;
        }
        let normalized = normalize_history_replacement(&entry.command);
        if let Some(position) = positions.get(&normalized).copied() {
            let metadata = candidates[position]
                .metadata
                .get_or_insert_with(BTreeMap::new);
            let frequency = metadata
                .get("frequency")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(1)
                .saturating_add(1);
            metadata.insert("frequency".to_owned(), frequency.to_string());
            continue;
        }
        positions.insert(normalized, candidates.len());
        candidates.push(menu_history_candidate(
            request,
            entry,
            index,
            match_score,
            matched_word_index,
        ));
    }
    candidates
}

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
    metadata.insert(
        "contextHostMatch".to_owned(),
        request
            .remote_host_id
            .as_deref()
            .is_some_and(|host_id| entry.remote_host_id.as_deref() == Some(host_id))
            .to_string(),
    );
    metadata.insert(
        "contextCwdMatch".to_owned(),
        request
            .cwd
            .as_deref()
            .is_some_and(|cwd| entry.cwd.as_deref() == Some(cwd))
            .to_string(),
    );
    metadata.insert(
        "contextSessionMatch".to_owned(),
        request
            .session_id
            .as_deref()
            .is_some_and(|session_id| entry.session_id.as_deref() == Some(session_id))
            .to_string(),
    );
    metadata.insert(
        "historyRecency".to_owned(),
        reciprocal_rank(index, 12.0).to_string(),
    );

    Some(CommandSuggestionCandidate {
        activation: CommandSuggestionActivation::Insert,
        candidate_kind: CommandSuggestionCandidateKind::Command,
        merged_source_explanations: Vec::new(),
        source_explanation: None,
        accept_boundaries: Vec::new(),
        allowed_presentations: CommandSuggestionCandidate::presentations_for(sensitivity),
        context_key: request.context_key.clone(),
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

fn reciprocal_rank(index: usize, scale: f64) -> f64 {
    scale / (scale + index as f64)
}

fn normalize_history_replacement(value: &str) -> String {
    value.trim().replace("\r\n", "\n").replace('\r', "\n")
}

fn menu_query_words(prefix: &str) -> Vec<String> {
    parse_simple_shell_words(prefix, 0)
        .unwrap_or_default()
        .into_iter()
        .map(|word| word.text.to_lowercase())
        .filter(|word| !word.is_empty())
        .collect()
}

fn menu_history_match_score(query_words: &[String], command: &str) -> Option<(f64, usize)> {
    let command_words = parse_simple_shell_words(command, 0)?
        .into_iter()
        .map(|word| word.text.to_lowercase())
        .collect::<Vec<_>>();
    let mut search_from = 0;
    let mut matched_word_index = 0;
    let mut score = 0.0;
    for query in query_words {
        let (relative_index, word_score) = command_words[search_from..]
            .iter()
            .enumerate()
            .find_map(|(index, candidate)| {
                word_match_score(query, candidate).map(|value| (index, value))
            })?;
        matched_word_index = search_from + relative_index;
        search_from = matched_word_index + 1;
        score += word_score;
    }
    Some((score / query_words.len() as f64, matched_word_index))
}

fn word_match_score(query: &str, candidate: &str) -> Option<f64> {
    if candidate == query {
        return Some(1.0);
    }
    if candidate.starts_with(query) {
        return Some(0.88);
    }
    let mut query_chars = query.chars();
    let mut current = query_chars.next();
    for character in candidate.chars() {
        if current == Some(character) {
            current = query_chars.next();
            if current.is_none() {
                return Some(0.62);
            }
        }
    }
    None
}

fn menu_history_candidate(
    request: &NormalizedSuggestionRequest,
    entry: CommandHistoryEntry,
    index: usize,
    match_score: f64,
    matched_word_index: usize,
) -> CommandSuggestionCandidate {
    let sensitivity = if is_dangerous_command(&entry.command) {
        CommandSuggestionSensitivity::Dangerous
    } else {
        CommandSuggestionSensitivity::Normal
    };
    let mut metadata = BTreeMap::new();
    metadata.insert("createdAt".to_owned(), entry.created_at.clone());
    metadata.insert("source".to_owned(), entry.source.as_str().to_owned());
    metadata.insert("historyMenuMatch".to_owned(), format!("{match_score:.6}"));
    metadata.insert(
        "historyMenuMatchedWordIndex".to_owned(),
        matched_word_index.to_string(),
    );
    metadata.insert(
        "historyRecency".to_owned(),
        reciprocal_rank(index, 20.0).to_string(),
    );
    metadata.insert(
        "contextHostMatch".to_owned(),
        request
            .remote_host_id
            .as_deref()
            .is_some_and(|host_id| entry.remote_host_id.as_deref() == Some(host_id))
            .to_string(),
    );
    metadata.insert(
        "contextCwdMatch".to_owned(),
        request
            .cwd
            .as_deref()
            .is_some_and(|cwd| entry.cwd.as_deref() == Some(cwd))
            .to_string(),
    );
    metadata.insert(
        "contextSessionMatch".to_owned(),
        request
            .session_id
            .as_deref()
            .is_some_and(|session_id| entry.session_id.as_deref() == Some(session_id))
            .to_string(),
    );
    CommandSuggestionCandidate {
        activation: CommandSuggestionActivation::Insert,
        candidate_kind: CommandSuggestionCandidateKind::Command,
        merged_source_explanations: Vec::new(),
        source_explanation: None,
        accept_boundaries: Vec::new(),
        allowed_presentations: vec![SuggestionPresentation::Menu],
        context_key: request.context_key.clone(),
        id: format!("history-menu:{}", entry.id),
        provider: SuggestionProviderKind::History,
        display_text: entry.command.clone(),
        replacement_text: entry.command.clone(),
        replacement_range: CommandSuggestionReplacementRange {
            start: 0,
            end: request.cursor,
        },
        suffix: String::new(),
        score: (history_score(request, &entry, index, sensitivity) * 0.75 + match_score * 0.25)
            .clamp(0.0, 1.0),
        sensitivity,
        description: Some(history_description(request, &entry, sensitivity)),
        source_id: Some(entry.id),
        metadata: Some(metadata),
    }
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
    insert_provider_cache_freshness_metadata(
        &mut metadata,
        cache_entry.expires_at,
        SystemTime::now(),
    );
    metadata.insert("contextHostMatch".to_owned(), true.to_string());
    metadata.insert(
        "historyRecency".to_owned(),
        reciprocal_rank(index, 20.0).to_string(),
    );

    Some(CommandSuggestionCandidate {
        activation: CommandSuggestionActivation::Insert,
        candidate_kind: CommandSuggestionCandidateKind::Command,
        merged_source_explanations: Vec::new(),
        source_explanation: None,
        accept_boundaries: Vec::new(),
        allowed_presentations: CommandSuggestionCandidate::presentations_for(sensitivity),
        context_key: request.context_key.clone(),
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
    insert_provider_cache_freshness_metadata(
        &mut metadata,
        cache_entry.expires_at,
        SystemTime::now(),
    );
    let source = remote_command_source(command);
    metadata.insert("source".to_owned(), source.to_owned());
    let description = if source == "posixBuiltin" {
        "远端 shell 内建命令，来自 POSIX sh 默认集合"
    } else {
        "远端命令，来自 PATH 缓存"
    };

    Some(CommandSuggestionCandidate {
        activation: CommandSuggestionActivation::Insert,
        candidate_kind: CommandSuggestionCandidateKind::Command,
        merged_source_explanations: Vec::new(),
        source_explanation: None,
        accept_boundaries: Vec::new(),
        allowed_presentations: CommandSuggestionCandidate::presentations_for(
            CommandSuggestionSensitivity::Normal,
        ),
        context_key: request.context_key.clone(),
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
