use super::*;
use crate::{
    models::{
        command_suggestion::{SuggestionPresentation, SuggestionQueryMode},
        snippet::{SnippetCatalogItem, SnippetCatalogOrigin, SnippetContextBindingKind},
    },
    services::snippet_catalog_registry::{self, StaticSnippetCatalogItem},
};

pub(super) fn snippet_candidates(
    request: &NormalizedSuggestionRequest,
) -> Vec<CommandSuggestionCandidate> {
    let query = request.prefix.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }
    snippet_catalog_registry::all()
        .iter()
        .filter(|item| item_matches_context(item, request))
        .filter_map(|item| match request.mode {
            SuggestionQueryMode::Inline => inline_candidate(item, request),
            SuggestionQueryMode::Menu => menu_candidate(item, request, &query),
        })
        .take(request.limit)
        .collect()
}

/// 从右栏和 Quick Open 共用的目录投影生成候选，避免用户片段形成第二套搜索语义。
pub(super) fn snippet_catalog_candidates(
    items: &[SnippetCatalogItem],
    request: &NormalizedSuggestionRequest,
) -> Vec<CommandSuggestionCandidate> {
    let query = request.prefix.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }
    items
        .iter()
        .filter(|item| catalog_item_matches_context(item, request))
        .filter_map(|item| match request.mode {
            SuggestionQueryMode::Inline => catalog_inline_candidate(item, request),
            SuggestionQueryMode::Menu => catalog_menu_candidate(item, request, &query),
        })
        .collect()
}

fn catalog_inline_candidate(
    item: &SnippetCatalogItem,
    request: &NormalizedSuggestionRequest,
) -> Option<CommandSuggestionCandidate> {
    if !catalog_inline_eligible(item, request) || !item.template.starts_with(&request.prefix) {
        return None;
    }
    let suffix = item.template.strip_prefix(&request.prefix)?.to_owned();
    Some(catalog_candidate(
        item,
        request,
        CommandSuggestionActivation::Insert,
        vec![SuggestionPresentation::Inline, SuggestionPresentation::Menu],
        suffix,
        0.72,
    ))
}

fn catalog_menu_candidate(
    item: &SnippetCatalogItem,
    request: &NormalizedSuggestionRequest,
    query: &str,
) -> Option<CommandSuggestionCandidate> {
    let matches = item.title.to_lowercase().contains(query)
        || item.description.to_lowercase().contains(query)
        || item.template.to_lowercase().contains(query)
        || item.category.to_lowercase().contains(query)
        || item
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(query))
        || item
            .capabilities
            .iter()
            .any(|capability| capability.to_lowercase().contains(query));
    matches.then(|| {
        let origin_boost = if item.origin == SnippetCatalogOrigin::User {
            0.03
        } else {
            0.0
        };
        let favorite_boost = if item.favorite { 0.05 } else { 0.0 };
        catalog_candidate(
            item,
            request,
            CommandSuggestionActivation::OpenSnippetPanel,
            vec![SuggestionPresentation::Menu],
            String::new(),
            if item.title.to_lowercase().starts_with(query) {
                0.78
            } else {
                0.66
            } + origin_boost
                + favorite_boost,
        )
    })
}

fn catalog_candidate(
    item: &SnippetCatalogItem,
    request: &NormalizedSuggestionRequest,
    activation: CommandSuggestionActivation,
    allowed_presentations: Vec<SuggestionPresentation>,
    suffix: String,
    score: f64,
) -> CommandSuggestionCandidate {
    let origin = match item.origin {
        SnippetCatalogOrigin::Builtin => "builtin",
        SnippetCatalogOrigin::User => "user",
    };
    let mut metadata = BTreeMap::new();
    metadata.insert("category".to_owned(), item.category.clone());
    metadata.insert("origin".to_owned(), origin.to_owned());
    metadata.insert("pack".to_owned(), item.pack.clone());
    CommandSuggestionCandidate {
        activation,
        candidate_kind: CommandSuggestionCandidateKind::Snippet,
        merged_source_explanations: Vec::new(),
        source_explanation: Some(format!(
            "{}片段 · {}",
            if item.origin == SnippetCatalogOrigin::User {
                "我的"
            } else {
                "内置"
            },
            item.category
        )),
        accept_boundaries: Vec::new(),
        allowed_presentations,
        context_key: request.context_key.clone(),
        id: format!("snippet:{origin}:{}", item.id),
        provider: SuggestionProviderKind::Snippet,
        display_text: item.title.clone(),
        replacement_text: item.template.clone(),
        replacement_range: CommandSuggestionReplacementRange {
            start: 0,
            end: request.cursor,
        },
        suffix,
        score,
        sensitivity: if item.sensitive {
            CommandSuggestionSensitivity::Sensitive
        } else if item.risk == "destructive" {
            CommandSuggestionSensitivity::Dangerous
        } else {
            CommandSuggestionSensitivity::Normal
        },
        description: Some(item.description.clone()),
        source_id: Some(item.id.clone()),
        metadata: Some(metadata),
    }
}

fn catalog_inline_eligible(
    item: &SnippetCatalogItem,
    request: &NormalizedSuggestionRequest,
) -> bool {
    item.risk == "inspect"
        && item.duration == "instant"
        && !item.sensitive
        && item.variables.is_empty()
        && request.target == CommandHistoryTarget::Local
        && (item.platforms.is_empty() || item.platforms.iter().any(|value| current_platform(value)))
        && (item.shells.is_empty()
            || item
                .shells
                .iter()
                .any(|value| shell_name_matches(value, request.shell.as_deref())))
}

fn catalog_item_matches_context(
    item: &SnippetCatalogItem,
    request: &NormalizedSuggestionRequest,
) -> bool {
    let scope_matches = match item.scope {
        crate::models::snippet::SnippetScope::Local => {
            request.target == CommandHistoryTarget::Local
        }
        crate::models::snippet::SnippetScope::Ssh => request.target == CommandHistoryTarget::Ssh,
        crate::models::snippet::SnippetScope::Any => true,
    };
    scope_matches
        && (item.context_bindings.is_empty()
            || item
                .context_bindings
                .iter()
                .any(|binding| binding.kind == SnippetContextBindingKind::Global)
            || item.context_bindings.iter().any(|binding| {
                binding.kind == SnippetContextBindingKind::Host
                    && binding.target_id.as_deref() == request.remote_host_id.as_deref()
            }))
}

fn current_platform(value: &str) -> bool {
    (cfg!(target_os = "windows") && value == "windows")
        || (cfg!(target_os = "macos") && value == "macos")
        || (cfg!(target_os = "linux") && value == "linux")
}

fn shell_name_matches(expected: &str, shell: Option<&str>) -> bool {
    let shell = shell.unwrap_or_default().to_lowercase();
    match expected {
        "powerShell" => shell.contains("powershell") || shell.contains("pwsh"),
        "cmd" => shell.contains("cmd"),
        "bash" => shell.contains("bash") || shell.ends_with("/sh"),
        "zsh" => shell.contains("zsh"),
        "fish" => shell.contains("fish"),
        _ => false,
    }
}

fn inline_candidate(
    item: &StaticSnippetCatalogItem,
    request: &NormalizedSuggestionRequest,
) -> Option<CommandSuggestionCandidate> {
    if !inline_eligible(item, request) || !item.template.starts_with(&request.prefix) {
        return None;
    }
    let suffix = item.template.strip_prefix(&request.prefix)?.to_owned();
    Some(candidate(
        item,
        request,
        CommandSuggestionActivation::Insert,
        vec![SuggestionPresentation::Inline, SuggestionPresentation::Menu],
        suffix,
        0.72,
    ))
}

fn menu_candidate(
    item: &StaticSnippetCatalogItem,
    request: &NormalizedSuggestionRequest,
    query: &str,
) -> Option<CommandSuggestionCandidate> {
    let matches = item.title.to_lowercase().contains(query)
        || item.description.to_lowercase().contains(query)
        || item.template.to_lowercase().contains(query)
        || item
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(query));
    matches.then(|| {
        candidate(
            item,
            request,
            CommandSuggestionActivation::OpenSnippetPanel,
            vec![SuggestionPresentation::Menu],
            String::new(),
            if item.title.to_lowercase().starts_with(query) {
                0.78
            } else {
                0.66
            },
        )
    })
}

fn candidate(
    item: &StaticSnippetCatalogItem,
    request: &NormalizedSuggestionRequest,
    activation: CommandSuggestionActivation,
    allowed_presentations: Vec<SuggestionPresentation>,
    suffix: String,
    score: f64,
) -> CommandSuggestionCandidate {
    let mut metadata = BTreeMap::new();
    metadata.insert("category".to_owned(), item.category.to_owned());
    metadata.insert("pack".to_owned(), item.pack.to_owned());
    CommandSuggestionCandidate {
        activation,
        candidate_kind: CommandSuggestionCandidateKind::Snippet,
        merged_source_explanations: Vec::new(),
        source_explanation: Some(format!("内置片段 · {}", item.category)),
        accept_boundaries: Vec::new(),
        allowed_presentations,
        context_key: request.context_key.clone(),
        id: format!("snippet:{}", item.id),
        provider: SuggestionProviderKind::Snippet,
        display_text: item.title.to_owned(),
        replacement_text: item.template.to_owned(),
        replacement_range: CommandSuggestionReplacementRange {
            start: 0,
            end: request.cursor,
        },
        suffix,
        score,
        sensitivity: if item.sensitive {
            CommandSuggestionSensitivity::Sensitive
        } else if item.risk == "destructive" {
            CommandSuggestionSensitivity::Dangerous
        } else {
            CommandSuggestionSensitivity::Normal
        },
        description: Some(item.description.to_owned()),
        source_id: Some(item.id.to_owned()),
        metadata: Some(metadata),
    }
}

fn inline_eligible(item: &StaticSnippetCatalogItem, request: &NormalizedSuggestionRequest) -> bool {
    item.risk == "inspect"
        && item.duration == "instant"
        && !item.sensitive
        && item.variables.is_empty()
        && request.target == CommandHistoryTarget::Local
        && current_platform_matches(item.platform_mask)
        && shell_matches(item.shell_mask, request.shell.as_deref())
}

fn item_matches_context(
    item: &StaticSnippetCatalogItem,
    request: &NormalizedSuggestionRequest,
) -> bool {
    match item.scope {
        "local" => request.target == CommandHistoryTarget::Local,
        "ssh" => request.target == CommandHistoryTarget::Ssh,
        _ => true,
    }
}

fn current_platform_matches(mask: u8) -> bool {
    let platform = if cfg!(target_os = "windows") {
        1
    } else if cfg!(target_os = "macos") {
        2
    } else {
        4
    };
    mask & platform != 0
}

fn shell_matches(mask: u8, shell: Option<&str>) -> bool {
    let shell = shell.unwrap_or_default().to_lowercase();
    let bit = if shell.contains("powershell") || shell.contains("pwsh") {
        8
    } else if shell.contains("cmd") {
        16
    } else if shell.contains("bash") || shell.ends_with("/sh") {
        1
    } else if shell.contains("zsh") {
        2
    } else if shell.contains("fish") {
        4
    } else {
        0
    };
    bit != 0 && mask & bit != 0
}
