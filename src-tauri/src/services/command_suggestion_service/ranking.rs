//! 命令建议统一排序、稳定去重与批量反馈策略。
//!
//! @author kongweiguang

use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap, HashSet},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use super::*;
use crate::models::command_suggestion::SuggestionPresentation;
use crate::storage::command_suggestion_feedback::{
    CommandSuggestionFeedbackKey, CommandSuggestionFeedbackScore,
};

const FEEDBACK_ACCEPTED_CAP: u32 = 20;
const FEEDBACK_DISMISSED_CAP: u32 = 20;
const FEEDBACK_ACCEPTED_WEIGHT: f64 = 0.025;
const FEEDBACK_DISMISSED_WEIGHT: f64 = 0.12;
const FREQUENCY_WEIGHT: f64 = 0.08;
const DANGER_PENALTY: f64 = 0.42;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct DedupKey {
    normalized_replacement: String,
    range_end: usize,
    range_start: usize,
}

#[derive(Debug)]
struct RankedGroup {
    candidate: CommandSuggestionCandidate,
    frequency: usize,
    max_score: f64,
    providers: HashSet<SuggestionProviderKind>,
}

/// 对有界召回候选执行一次 feedback 查询、统一评分、稳定去重和最终截断。
///
/// 调用方必须先限制各 provider 的召回数量；本函数不触发 provider IO，也不会扩大候选集。
pub(super) fn rank_candidates(
    storage: &CommandSqliteStore,
    request: &NormalizedSuggestionRequest,
    candidates: Vec<CommandSuggestionCandidate>,
) -> AppResult<Vec<CommandSuggestionCandidate>> {
    let feedback_keys = candidates
        .iter()
        .filter(|candidate| candidate.sensitivity != CommandSuggestionSensitivity::Sensitive)
        .map(|candidate| CommandSuggestionFeedbackKey {
            provider: candidate.provider,
            replacement_text: candidate.replacement_text.clone(),
        })
        .collect::<Vec<_>>();
    let feedback = storage.command_suggestion_feedback_scores(
        request.target,
        request.remote_host_id.as_deref(),
        &feedback_keys,
    )?;
    let now = SystemTime::now();
    let mut groups = HashMap::<DedupKey, RankedGroup>::new();

    for mut candidate in candidates {
        if candidate.sensitivity == CommandSuggestionSensitivity::Sensitive {
            continue;
        }
        enforce_safe_presentations(&mut candidate);
        let feedback_score = feedback
            .get(&CommandSuggestionFeedbackKey {
                provider: candidate.provider,
                replacement_text: candidate.replacement_text.clone(),
            })
            .copied()
            .unwrap_or_default();
        let components = ranking_components(request, &candidate, feedback_score, now);
        candidate.score = components.total;
        write_ranking_metadata(&mut candidate, components, feedback_score);

        let key = DedupKey {
            normalized_replacement: normalize_replacement(&candidate.replacement_text),
            range_end: candidate.replacement_range.end,
            range_start: candidate.replacement_range.start,
        };
        match groups.entry(key) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                let provider = candidate.provider;
                let frequency = candidate_frequency(&candidate);
                entry.insert(RankedGroup {
                    max_score: candidate.score,
                    candidate,
                    frequency,
                    providers: HashSet::from([provider]),
                });
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                let group = entry.get_mut();
                group.frequency = group
                    .frequency
                    .saturating_add(candidate_frequency(&candidate));
                group.max_score = group.max_score.max(candidate.score);
                group.providers.insert(candidate.provider);
                if prefer_dedup_candidate(&candidate, &group.candidate) {
                    group.candidate = candidate;
                }
            }
        }
    }

    let mut ranked = groups.into_values().map(finalize_group).collect::<Vec<_>>();
    ranked.sort_by(compare_ranked_candidates);
    ranked.truncate(request.limit);
    Ok(ranked)
}

#[derive(Debug, Clone, Copy)]
struct RankingComponents {
    base: f64,
    context: f64,
    danger: f64,
    feedback: f64,
    freshness: f64,
    provider: f64,
    text: f64,
    total: f64,
}

fn ranking_components(
    request: &NormalizedSuggestionRequest,
    candidate: &CommandSuggestionCandidate,
    feedback: CommandSuggestionFeedbackScore,
    now: SystemTime,
) -> RankingComponents {
    let base = candidate.score.clamp(0.0, 1.0) * 0.20;
    let text = text_match_score(request, candidate) * 0.20;
    let context = context_score(request, candidate) * 0.18;
    let freshness = freshness_score(candidate, now) * 0.22;
    let provider = provider_reliability(candidate.provider) * 0.13;
    let feedback = feedback_delta(feedback);
    let danger = if candidate.sensitivity == CommandSuggestionSensitivity::Dangerous {
        -DANGER_PENALTY
    } else {
        0.0
    };
    let total = (base + text + context + freshness + provider + feedback + danger).clamp(0.0, 1.0);
    RankingComponents {
        base,
        context,
        danger,
        feedback,
        freshness,
        provider,
        text,
        total,
    }
}

fn text_match_score(
    request: &NormalizedSuggestionRequest,
    candidate: &CommandSuggestionCandidate,
) -> f64 {
    let prefix = normalize_replacement(&request.prefix);
    let replacement = normalize_replacement(&candidate.replacement_text);
    if replacement == prefix {
        return 0.0;
    }
    if replacement.starts_with(&prefix) {
        let prefix_chars = prefix.chars().count();
        let replacement_chars = replacement.chars().count().max(1);
        return (0.75 + prefix_chars as f64 / replacement_chars as f64 * 0.25).clamp(0.0, 1.0);
    }
    if replacement
        .to_lowercase()
        .starts_with(&prefix.to_lowercase())
    {
        return 0.68;
    }
    0.35
}

fn context_score(
    request: &NormalizedSuggestionRequest,
    candidate: &CommandSuggestionCandidate,
) -> f64 {
    let metadata = candidate.metadata.as_ref();
    let mut score: f64 = 0.0;
    if metadata_flag(metadata, "contextHostMatch") {
        score += 0.42;
    } else if request.remote_host_id.is_some()
        && matches!(
            candidate.provider,
            SuggestionProviderKind::RemotePath
                | SuggestionProviderKind::RemoteCommand
                | SuggestionProviderKind::Git
        )
    {
        score += 0.34;
    }
    if metadata_flag(metadata, "contextCwdMatch") {
        score += 0.36;
    }
    if metadata_flag(metadata, "contextSessionMatch") {
        score += 0.16;
    }
    if metadata
        .and_then(|values| values.get("source"))
        .is_some_and(|source| source == "user")
    {
        score += 0.06;
    }
    score.clamp(0.0, 1.0)
}

fn freshness_score(candidate: &CommandSuggestionCandidate, now: SystemTime) -> f64 {
    let metadata = candidate.metadata.as_ref();
    if let Some(score) = metadata_number(metadata, "historyRecency") {
        return score.clamp(0.0, 1.0);
    }
    let Some(cached_at) = metadata_integer(metadata, "cachedAtUnixMs") else {
        return 0.55;
    };
    let now_ms = unix_time_millis(now);
    let age_ms = now_ms.saturating_sub(cached_at);
    let ttl_ms = metadata_integer(metadata, "ttlSeconds")
        .unwrap_or(60)
        .saturating_mul(1_000)
        .max(1);
    (1.0 / (1.0 + age_ms as f64 / ttl_ms as f64)).clamp(0.0, 1.0)
}

fn feedback_delta(feedback: CommandSuggestionFeedbackScore) -> f64 {
    feedback.accepted_count.min(FEEDBACK_ACCEPTED_CAP) as f64 * FEEDBACK_ACCEPTED_WEIGHT
        - feedback.dismissed_count.min(FEEDBACK_DISMISSED_CAP) as f64 * FEEDBACK_DISMISSED_WEIGHT
}

fn finalize_group(mut group: RankedGroup) -> CommandSuggestionCandidate {
    let frequency_bonus =
        ((group.frequency.min(32) as f64).ln_1p() / 33.0_f64.ln()) * FREQUENCY_WEIGHT;
    group.candidate.score = (group.max_score + frequency_bonus).clamp(0.0, 1.0);
    let metadata = group.candidate.metadata.get_or_insert_with(BTreeMap::new);
    metadata.insert("frequency".to_owned(), group.frequency.to_string());
    metadata.insert("rankingFrequency".to_owned(), format_score(frequency_bonus));
    let mut providers = group
        .providers
        .into_iter()
        .map(SuggestionProviderKind::as_str)
        .collect::<Vec<_>>();
    providers.sort_unstable();
    metadata.insert("deduplicatedProviders".to_owned(), providers.join(","));
    group.candidate
}

fn candidate_frequency(candidate: &CommandSuggestionCandidate) -> usize {
    candidate
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("frequency"))
        .and_then(|value| value.parse().ok())
        .unwrap_or(1)
}

fn prefer_dedup_candidate(
    candidate: &CommandSuggestionCandidate,
    current: &CommandSuggestionCandidate,
) -> bool {
    provider_reliability(candidate.provider)
        .total_cmp(&provider_reliability(current.provider))
        .then_with(|| candidate.score.total_cmp(&current.score))
        .then_with(|| current.id.cmp(&candidate.id))
        == Ordering::Greater
}

fn compare_ranked_candidates(
    left: &CommandSuggestionCandidate,
    right: &CommandSuggestionCandidate,
) -> Ordering {
    right
        .score
        .total_cmp(&left.score)
        .then_with(|| provider_priority(left.provider).cmp(&provider_priority(right.provider)))
        .then_with(|| {
            normalize_replacement(&left.replacement_text)
                .cmp(&normalize_replacement(&right.replacement_text))
        })
        .then_with(|| {
            left.replacement_range
                .start
                .cmp(&right.replacement_range.start)
        })
        .then_with(|| left.replacement_range.end.cmp(&right.replacement_range.end))
        .then_with(|| left.id.cmp(&right.id))
}

fn enforce_safe_presentations(candidate: &mut CommandSuggestionCandidate) {
    if candidate.sensitivity == CommandSuggestionSensitivity::Dangerous {
        candidate
            .allowed_presentations
            .retain(|presentation| *presentation == SuggestionPresentation::Menu);
        if candidate.allowed_presentations.is_empty() {
            candidate
                .allowed_presentations
                .push(SuggestionPresentation::Menu);
        }
    }
}

fn write_ranking_metadata(
    candidate: &mut CommandSuggestionCandidate,
    components: RankingComponents,
    feedback: CommandSuggestionFeedbackScore,
) {
    let metadata = candidate.metadata.get_or_insert_with(BTreeMap::new);
    metadata.insert("feedbackBatchQueryCount".to_owned(), "1".to_owned());
    metadata.insert(
        "feedbackAcceptedCount".to_owned(),
        feedback.accepted_count.to_string(),
    );
    metadata.insert(
        "feedbackDismissedCount".to_owned(),
        feedback.dismissed_count.to_string(),
    );
    metadata.insert("rankingBase".to_owned(), format_score(components.base));
    metadata.insert(
        "rankingContext".to_owned(),
        format_score(components.context),
    );
    metadata.insert("rankingDanger".to_owned(), format_score(components.danger));
    metadata.insert(
        "rankingFeedback".to_owned(),
        format_score(components.feedback),
    );
    metadata.insert(
        "rankingFreshness".to_owned(),
        format_score(components.freshness),
    );
    metadata.insert(
        "rankingProvider".to_owned(),
        format_score(components.provider),
    );
    metadata.insert("rankingText".to_owned(), format_score(components.text));
}

fn provider_reliability(provider: SuggestionProviderKind) -> f64 {
    match provider {
        SuggestionProviderKind::Spec => 0.96,
        SuggestionProviderKind::History => 0.92,
        SuggestionProviderKind::RemotePath => 0.90,
        SuggestionProviderKind::Git => 0.88,
        SuggestionProviderKind::RemoteCommand => 0.84,
    }
}

fn provider_priority(provider: SuggestionProviderKind) -> u8 {
    match provider {
        SuggestionProviderKind::Spec => 0,
        SuggestionProviderKind::History => 1,
        SuggestionProviderKind::RemotePath => 2,
        SuggestionProviderKind::Git => 3,
        SuggestionProviderKind::RemoteCommand => 4,
    }
}

fn normalize_replacement(value: &str) -> String {
    value.trim().replace("\r\n", "\n").replace('\r', "\n")
}

fn metadata_flag(metadata: Option<&BTreeMap<String, String>>, key: &str) -> bool {
    metadata
        .and_then(|values| values.get(key))
        .is_some_and(|value| value == "true")
}

fn metadata_number(metadata: Option<&BTreeMap<String, String>>, key: &str) -> Option<f64> {
    metadata
        .and_then(|values| values.get(key))
        .and_then(|value| value.parse().ok())
}

fn metadata_integer(metadata: Option<&BTreeMap<String, String>>, key: &str) -> Option<u128> {
    metadata
        .and_then(|values| values.get(key))
        .and_then(|value| value.parse().ok())
}

fn unix_time_millis(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis()
}

fn format_score(value: f64) -> String {
    format!("{value:.6}")
}
