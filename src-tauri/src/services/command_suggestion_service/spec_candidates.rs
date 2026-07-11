use super::spec_registry::{self, StaticSpecItem, StaticSpecSensitivity};
use super::*;
use crate::models::command_suggestion::SuggestionPresentation;

pub(super) fn spec_candidates(
    request: &NormalizedSuggestionRequest,
) -> Vec<CommandSuggestionCandidate> {
    let Some(token) = spec_suggestion_token(&request.prefix) else {
        return Vec::new();
    };
    let items = spec_items_for_token(&token);
    let mut candidates = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if !item.name.starts_with(&token.name) || item.name == token.name.as_str() {
            continue;
        }
        let replacement_text =
            format!("{}{}", char_prefix(&request.prefix, token.start), item.name);
        if !replacement_text.starts_with(&request.prefix) {
            continue;
        }
        let Some(suffix) = replacement_text.strip_prefix(&request.prefix) else {
            continue;
        };
        let suffix = suffix.to_owned();
        let mut metadata = BTreeMap::new();
        metadata.insert(
            "command".to_owned(),
            spec_command_name(&token).unwrap_or_default(),
        );
        metadata.insert("source".to_owned(), "bundled".to_owned());

        let sensitivity = match item.sensitivity {
            StaticSpecSensitivity::Normal => CommandSuggestionSensitivity::Normal,
            StaticSpecSensitivity::Dangerous => CommandSuggestionSensitivity::Dangerous,
            StaticSpecSensitivity::Sensitive => CommandSuggestionSensitivity::Sensitive,
        };
        let mut allowed_presentations = CommandSuggestionCandidate::presentations_for(sensitivity);
        if !item.allow_inline {
            allowed_presentations
                .retain(|presentation| *presentation != SuggestionPresentation::Inline);
        }

        candidates.push(CommandSuggestionCandidate {
            accept_boundaries: Vec::new(),
            allowed_presentations,
            context_key: request.context_key.clone(),
            id: format!("spec:{}:{}", token.completed_words.join(":"), item.name),
            provider: SuggestionProviderKind::Spec,
            display_text: replacement_text.clone(),
            replacement_text,
            replacement_range: CommandSuggestionReplacementRange {
                start: token.start,
                end: request.cursor,
            },
            suffix,
            score: spec_score(&token, item.name, index),
            sensitivity,
            description: Some(item.description.to_owned()),
            source_id: Some(item.name.to_owned()),
            metadata: Some(metadata),
        });
        if candidates.len() >= request.limit {
            break;
        }
    }
    candidates
}

pub(super) fn spec_suggestion_token(prefix: &str) -> Option<SpecSuggestionToken> {
    let segment_start = shell_command_segment_start(prefix);
    let segment = prefix.chars().skip(segment_start).collect::<String>();
    let words = parse_simple_shell_words(&segment, segment_start)?;
    let cursor = prefix.chars().count();
    let ends_with_whitespace = prefix.chars().last().is_some_and(char::is_whitespace);
    let (name, start, completed_words) = if ends_with_whitespace {
        (
            String::new(),
            cursor,
            words.into_iter().map(|word| word.text).collect::<Vec<_>>(),
        )
    } else if words.is_empty() {
        (String::new(), cursor, Vec::new())
    } else {
        let current = words.last()?;
        (
            current.text.clone(),
            current.start,
            words[..words.len().saturating_sub(1)]
                .iter()
                .map(|word| word.text.clone())
                .collect::<Vec<_>>(),
        )
    };
    if !is_cacheable_spec_prefix(&name) {
        return None;
    }
    Some(SpecSuggestionToken {
        completed_words,
        name,
        start,
    })
}

pub(super) fn spec_items_for_token(token: &SpecSuggestionToken) -> &'static [StaticSpecItem] {
    let words = normalized_spec_words(&token.completed_words);
    if words.is_empty() {
        return spec_registry::root_items();
    }
    if token.name.starts_with('-') {
        return spec_options_for_path(&words);
    }
    spec_subcommands_for_path(&words)
}

pub(super) fn normalized_spec_words(words: &[String]) -> Vec<String> {
    let mut index = 0;
    while index < words.len() && matches!(words[index].as_str(), "command" | "doas" | "sudo") {
        index += 1;
    }
    words[index..]
        .iter()
        .map(|word| word.to_ascii_lowercase())
        .collect()
}

pub(super) fn spec_command_name(token: &SpecSuggestionToken) -> Option<String> {
    normalized_spec_words(&token.completed_words)
        .first()
        .cloned()
        .or_else(|| {
            if token.completed_words.is_empty() {
                None
            } else {
                Some(token.completed_words[0].clone())
            }
        })
}

pub(super) fn spec_subcommands_for_path(words: &[String]) -> &'static [StaticSpecItem] {
    let Some((command, path)) = words.split_first() else {
        return &[];
    };
    spec_registry::subcommand_items(command, path)
}

pub(super) fn spec_options_for_path(words: &[String]) -> &'static [StaticSpecItem] {
    let Some((command, path)) = words.split_first() else {
        return &[];
    };
    spec_registry::option_items(command, path)
}

pub(super) fn spec_score(token: &SpecSuggestionToken, item: &str, index: usize) -> f64 {
    let mut score = if token.completed_words.is_empty() {
        0.52
    } else if item.starts_with('-') {
        0.57
    } else {
        0.62
    };
    score += (100usize.saturating_sub(index).min(100) as f64) / 20_000.0;
    score.clamp(0.0, 1.0)
}

pub(super) fn is_cacheable_spec_prefix(prefix: &str) -> bool {
    prefix.chars().count() <= 256
        && !contains_control_character(prefix)
        && prefix.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '_' | '-' | '.' | ':')
        })
}
