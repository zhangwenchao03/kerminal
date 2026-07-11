use super::*;

pub(super) fn remote_command_token(prefix: &str) -> Option<RemoteCommandToken> {
    let (start, raw_token) = current_shell_token(prefix)?;
    if raw_token.is_empty() || raw_token.contains('/') {
        return None;
    }
    let (quote, token_body) = split_opening_quote(&raw_token)?;
    if quote != ShellQuote::None {
        return None;
    }
    if !is_command_position(&char_prefix(prefix, start)) {
        return None;
    }
    let name = unescape_path_fragment(token_body, ShellQuote::None)?;
    if !is_cacheable_remote_command(&name) {
        return None;
    }
    Some(RemoteCommandToken { name, start })
}

pub(super) fn is_command_position(prefix_before_token: &str) -> bool {
    let segment = shell_command_segment(prefix_before_token);
    segment.trim().is_empty()
}

pub(super) fn shell_command_segment(prefix_before_token: &str) -> String {
    let segment_start = shell_command_segment_start(prefix_before_token);
    prefix_before_token.chars().skip(segment_start).collect()
}

pub(super) fn shell_command_segment_start(prefix_before_token: &str) -> usize {
    let mut segment_start = 0;
    let mut quote: Option<ShellQuote> = None;
    let mut escaped = false;
    for (index, character) in prefix_before_token.chars().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        match quote {
            Some(ShellQuote::Single) => {
                if character == '\'' {
                    quote = None;
                }
            }
            Some(ShellQuote::Double) => {
                if character == '\\' {
                    escaped = true;
                } else if character == '"' {
                    quote = None;
                }
            }
            _ => {
                if character == '\\' {
                    escaped = true;
                } else if character == '\'' {
                    quote = Some(ShellQuote::Single);
                } else if character == '"' {
                    quote = Some(ShellQuote::Double);
                } else if matches!(character, '|' | '&' | ';') {
                    segment_start = index + 1;
                }
            }
        }
    }
    segment_start
}

pub(super) fn parse_simple_shell_words(
    segment: &str,
    start_offset: usize,
) -> Option<Vec<ShellWord>> {
    if contains_control_character(segment) {
        return None;
    }
    let mut words = Vec::new();
    let mut current = String::new();
    let mut current_start: Option<usize> = None;
    let mut escaped = false;

    for (index, character) in segment.chars().enumerate() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            if current_start.is_none() {
                current_start = Some(start_offset + index);
            }
            escaped = true;
            continue;
        }
        if matches!(character, '\'' | '"') {
            return None;
        }
        if character.is_whitespace() {
            if let Some(start) = current_start.take() {
                words.push(ShellWord {
                    start,
                    text: std::mem::take(&mut current),
                });
            }
            continue;
        }
        if current_start.is_none() {
            current_start = Some(start_offset + index);
        }
        current.push(character);
    }

    if escaped {
        return None;
    }
    if let Some(start) = current_start {
        words.push(ShellWord {
            start,
            text: current,
        });
    }
    Some(words)
}

pub(super) fn remote_path_candidate(
    request: &NormalizedSuggestionRequest,
    token: &RemotePathToken,
    entry: &SftpEntry,
    cache_entry: &RemotePathCacheEntry,
    index: usize,
) -> Option<CommandSuggestionCandidate> {
    let escaped_name = escape_path_component(&entry.name, token.quote)?;
    let trailing_slash = if entry.kind == SftpEntryKind::Directory {
        "/"
    } else {
        ""
    };
    let replacement_token = format!(
        "{}{}{}",
        token.raw_token_prefix, escaped_name, trailing_slash
    );
    let replacement_text = format!(
        "{}{}",
        char_prefix(&request.prefix, token.start),
        replacement_token
    );
    if replacement_text == request.prefix || !replacement_text.starts_with(&request.prefix) {
        return None;
    }
    let suffix = replacement_text.strip_prefix(&request.prefix)?.to_owned();
    let mut metadata = BTreeMap::new();
    metadata.insert("directory".to_owned(), token.lookup_directory.clone());
    metadata.insert(
        "entryKind".to_owned(),
        sftp_entry_kind_name(entry.kind.clone()).to_owned(),
    );
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

    Some(CommandSuggestionCandidate {
        accept_boundaries: Vec::new(),
        allowed_presentations: CommandSuggestionCandidate::presentations_for(
            CommandSuggestionSensitivity::Normal,
        ),
        context_key: request.context_key.clone(),
        id: format!(
            "remotePath:{}:{}:{}",
            request.remote_host_id.as_deref().unwrap_or_default(),
            token.lookup_directory,
            entry.name
        ),
        provider: SuggestionProviderKind::RemotePath,
        display_text: replacement_text.clone(),
        replacement_text,
        replacement_range: CommandSuggestionReplacementRange {
            start: token.start,
            end: request.cursor,
        },
        suffix,
        score: remote_path_score(entry, index),
        sensitivity: CommandSuggestionSensitivity::Normal,
        description: Some(format!("远端路径，来自缓存目录 {}", token.lookup_directory)),
        source_id: Some(entry.path.clone()),
        metadata: Some(metadata),
    })
}

pub(super) fn remote_path_score(entry: &SftpEntry, index: usize) -> f64 {
    let mut score = 0.70;
    if entry.kind == SftpEntryKind::Directory {
        score += 0.05;
    }
    score += (100usize.saturating_sub(index).min(100) as f64) / 5_000.0;
    score.clamp(0.0, 1.0)
}

pub(super) fn remote_path_token(prefix: &str, cwd: Option<&str>) -> Option<RemotePathToken> {
    let (start, raw_token) = current_shell_token(prefix)?;
    if raw_token.is_empty() {
        return None;
    }
    let command = shell_command_name(&char_prefix(prefix, start));
    let (quote, token_body) = split_opening_quote(&raw_token)?;
    if quote
        .closing_char()
        .is_some_and(|closing| token_body.contains(closing))
    {
        return None;
    }

    let last_slash = token_body.rfind('/');
    let raw_base = last_slash.map_or(token_body, |index| &token_body[index + 1..]);
    let base_name = unescape_path_fragment(raw_base, quote)?;
    let path_like = token_body.contains('/')
        || token_body.starts_with('.')
        || token_body.starts_with('~')
        || command
            .as_deref()
            .is_some_and(command_accepts_path_without_slash);
    if !path_like || (base_name.is_empty() && last_slash.is_none()) {
        return None;
    }

    let (lookup_directory, raw_token_prefix) = if let Some(index) = last_slash {
        let raw_directory_body = &token_body[..=index];
        let directory = unescape_path_fragment(raw_directory_body, quote)?;
        let lookup_directory = lookup_directory_for_path_token(cwd, &directory)?;
        (
            lookup_directory,
            format!("{}{}", quote.opening(), raw_directory_body),
        )
    } else {
        (
            normalize_remote_cache_path(cwd?),
            quote.opening().to_owned(),
        )
    };

    Some(RemotePathToken {
        base_name,
        lookup_directory,
        quote,
        raw_token_prefix,
        start,
    })
}

pub(super) fn current_shell_token(prefix: &str) -> Option<(usize, String)> {
    let mut start = 0;
    let mut quote: Option<ShellQuote> = None;
    let mut escaped = false;
    for (index, character) in prefix.chars().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        match quote {
            Some(ShellQuote::Single) => {
                if character == '\'' {
                    quote = None;
                }
            }
            Some(ShellQuote::Double) => {
                if character == '\\' {
                    escaped = true;
                } else if character == '"' {
                    quote = None;
                }
            }
            _ => {
                if character == '\\' {
                    escaped = true;
                } else if character == '\'' {
                    quote = Some(ShellQuote::Single);
                } else if character == '"' {
                    quote = Some(ShellQuote::Double);
                } else if character.is_whitespace() {
                    start = index + 1;
                }
            }
        }
    }
    Some((start, prefix.chars().skip(start).collect()))
}

pub(super) fn split_opening_quote(raw_token: &str) -> Option<(ShellQuote, &str)> {
    if let Some(rest) = raw_token.strip_prefix('\'') {
        return Some((ShellQuote::Single, rest));
    }
    if let Some(rest) = raw_token.strip_prefix('"') {
        return Some((ShellQuote::Double, rest));
    }
    if raw_token.contains('\'') || raw_token.contains('"') {
        return None;
    }
    Some((ShellQuote::None, raw_token))
}

pub(super) fn shell_command_name(prefix_before_token: &str) -> Option<String> {
    let segment = shell_command_segment(prefix_before_token);
    let trimmed = segment.trim_start();
    let mut command = String::new();
    let mut escaped = false;
    for character in trimmed.chars() {
        if escaped {
            command.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if character.is_whitespace() {
            break;
        }
        command.push(character);
    }
    let command = command.trim();
    if command.is_empty() {
        None
    } else {
        command
            .rsplit('/')
            .next()
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase())
    }
}

pub(super) fn command_accepts_path_without_slash(command: &str) -> bool {
    matches!(
        command,
        "cd" | "cat"
            | "chmod"
            | "chown"
            | "cp"
            | "du"
            | "file"
            | "grep"
            | "head"
            | "less"
            | "ls"
            | "mkdir"
            | "mv"
            | "nano"
            | "rm"
            | "rmdir"
            | "sed"
            | "tail"
            | "tar"
            | "touch"
            | "vi"
            | "vim"
            | "zcat"
    )
}

pub(super) fn lookup_directory_for_path_token(
    cwd: Option<&str>,
    directory: &str,
) -> Option<String> {
    let directory = normalize_remote_cache_path(directory);
    if directory.starts_with('/') || directory.starts_with('~') {
        return Some(clean_remote_path(&directory));
    }
    let cwd = cwd?;
    Some(join_remote_paths(cwd, &directory))
}

pub(super) fn join_remote_paths(cwd: &str, relative: &str) -> String {
    let cwd = normalize_remote_cache_path(cwd);
    let relative = normalize_remote_cache_path(relative);
    if relative == "." || relative.is_empty() {
        return clean_remote_path(&cwd);
    }
    if relative.starts_with('/') || relative.starts_with('~') {
        return clean_remote_path(&relative);
    }
    if cwd == "/" {
        clean_remote_path(&format!("/{relative}"))
    } else {
        clean_remote_path(&format!("{cwd}/{relative}"))
    }
}

pub(super) fn clean_remote_path(path: &str) -> String {
    let path = normalize_remote_cache_path(path);
    if path.starts_with('~') {
        return path;
    }
    let absolute = path.starts_with('/');
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            if !segments.is_empty() {
                segments.pop();
            } else if !absolute {
                segments.push(segment);
            }
            continue;
        }
        segments.push(segment);
    }
    if absolute {
        if segments.is_empty() {
            "/".to_owned()
        } else {
            format!("/{}", segments.join("/"))
        }
    } else if segments.is_empty() {
        ".".to_owned()
    } else {
        segments.join("/")
    }
}

pub(super) fn normalize_remote_cache_path(path: &str) -> String {
    let mut normalized = path.trim().replace('\\', "/");
    if normalized.is_empty() {
        normalized = "/".to_owned();
    }
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    normalized
}

pub(super) fn unescape_path_fragment(value: &str, quote: ShellQuote) -> Option<String> {
    if contains_control_character(value) {
        return None;
    }
    match quote {
        ShellQuote::Single => {
            if value.contains('\'') {
                None
            } else {
                Some(value.to_owned())
            }
        }
        ShellQuote::Double | ShellQuote::None => {
            let mut output = String::new();
            let mut escaped = false;
            for character in value.chars() {
                if escaped {
                    output.push(character);
                    escaped = false;
                    continue;
                }
                if character == '\\' {
                    escaped = true;
                } else {
                    output.push(character);
                }
            }
            if escaped {
                None
            } else {
                Some(output)
            }
        }
    }
}

pub(super) fn escape_path_component(name: &str, quote: ShellQuote) -> Option<String> {
    if contains_control_character(name) || name.contains('/') {
        return None;
    }
    match quote {
        ShellQuote::Single => {
            if name.contains('\'') {
                None
            } else {
                Some(name.to_owned())
            }
        }
        ShellQuote::Double => {
            let mut output = String::new();
            for character in name.chars() {
                if matches!(character, '\\' | '"' | '$' | '`') {
                    output.push('\\');
                }
                output.push(character);
            }
            Some(output)
        }
        ShellQuote::None => {
            let mut output = String::new();
            for character in name.chars() {
                if character.is_whitespace()
                    || matches!(
                        character,
                        '\\' | '\''
                            | '"'
                            | '$'
                            | '`'
                            | ';'
                            | '&'
                            | '|'
                            | '<'
                            | '>'
                            | '('
                            | ')'
                            | '['
                            | ']'
                            | '{'
                            | '}'
                            | '*'
                            | '?'
                            | '!'
                            | '#'
                    )
                {
                    output.push('\\');
                }
                output.push(character);
            }
            Some(output)
        }
    }
}

pub(super) fn contains_control_character(value: &str) -> bool {
    value.chars().any(char::is_control)
}
