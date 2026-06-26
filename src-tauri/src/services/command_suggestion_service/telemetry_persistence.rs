use super::*;

pub(super) fn persisted_telemetry_summary(
    storage: &CommandSqliteStore,
    generated_at: SystemTime,
) -> AppResult<CommandSuggestionTelemetrySummary> {
    let rows = storage.command_suggestion_telemetry_rows()?;
    let row_map = rows
        .into_iter()
        .map(|row| (row.provider, row))
        .collect::<HashMap<_, _>>();
    let mut providers = Vec::new();
    let mut started_at_unix_ms = unix_time_millis(generated_at);

    for provider in TELEMETRY_PROVIDER_ORDER {
        let telemetry = if let Some(row) = row_map.get(provider) {
            started_at_unix_ms = started_at_unix_ms.min(row.first_event_unix_ms.max(0) as u128);
            telemetry_from_persisted_row(*provider, row)
        } else {
            CommandSuggestionProviderTelemetry {
                average_elapsed_ms: 0.0,
                cache_hit_count: 0,
                cache_miss_count: 0,
                candidate_count: 0,
                feedback_accepted_count: 0,
                feedback_dismissed_count: 0,
                feedback_skipped_count: 0,
                last_error: None,
                last_event_unix_ms: None,
                provider: *provider,
                query_count: 0,
                refresh_failure_count: 0,
                refresh_success_count: 0,
                total_elapsed_ms: 0,
            }
        };
        providers.push(telemetry);
    }

    let total_query_count = providers.iter().map(|provider| provider.query_count).sum();
    let total_candidate_count = providers
        .iter()
        .map(|provider| provider.candidate_count)
        .sum();

    Ok(CommandSuggestionTelemetrySummary {
        generated_at_unix_ms: unix_time_millis(generated_at),
        providers,
        started_at_unix_ms,
        total_candidate_count,
        total_query_count,
    })
}

pub(super) fn telemetry_from_persisted_row(
    provider: SuggestionProviderKind,
    row: &CommandSuggestionTelemetryRow,
) -> CommandSuggestionProviderTelemetry {
    let average_elapsed_ms = if row.query_count == 0 {
        0.0
    } else {
        row.total_elapsed_ms as f64 / row.query_count as f64
    };

    CommandSuggestionProviderTelemetry {
        average_elapsed_ms,
        cache_hit_count: row.cache_hit_count,
        cache_miss_count: row.cache_miss_count,
        candidate_count: row.candidate_count,
        feedback_accepted_count: row.feedback_accepted_count,
        feedback_dismissed_count: row.feedback_dismissed_count,
        feedback_skipped_count: row.feedback_skipped_count,
        last_error: row.last_error.clone(),
        last_event_unix_ms: Some(row.last_event_unix_ms.max(0) as u128),
        provider,
        query_count: row.query_count,
        refresh_failure_count: row.refresh_failure_count,
        refresh_success_count: row.refresh_success_count,
        total_elapsed_ms: row.total_elapsed_ms,
    }
}

pub(super) fn persist_telemetry_update(
    storage: Option<&CommandSqliteStore>,
    update: CommandSuggestionTelemetryUpdate,
) {
    let Some(storage) = storage else {
        return;
    };
    let _ = storage.add_command_suggestion_telemetry(&update);
}

pub(super) fn merge_telemetry_update(
    target: &mut CommandSuggestionTelemetryUpdate,
    update: &CommandSuggestionTelemetryUpdate,
) {
    target.query_count_delta = target
        .query_count_delta
        .saturating_add(update.query_count_delta);
    target.candidate_count_delta = target
        .candidate_count_delta
        .saturating_add(update.candidate_count_delta);
    target.total_elapsed_ms_delta = target
        .total_elapsed_ms_delta
        .saturating_add(update.total_elapsed_ms_delta);
    target.cache_hit_count_delta = target
        .cache_hit_count_delta
        .saturating_add(update.cache_hit_count_delta);
    target.cache_miss_count_delta = target
        .cache_miss_count_delta
        .saturating_add(update.cache_miss_count_delta);
    target.refresh_success_count_delta = target
        .refresh_success_count_delta
        .saturating_add(update.refresh_success_count_delta);
    target.refresh_failure_count_delta = target
        .refresh_failure_count_delta
        .saturating_add(update.refresh_failure_count_delta);
    target.feedback_accepted_count_delta = target
        .feedback_accepted_count_delta
        .saturating_add(update.feedback_accepted_count_delta);
    target.feedback_dismissed_count_delta = target
        .feedback_dismissed_count_delta
        .saturating_add(update.feedback_dismissed_count_delta);
    target.feedback_skipped_count_delta = target
        .feedback_skipped_count_delta
        .saturating_add(update.feedback_skipped_count_delta);
    target.event_unix_ms = target.event_unix_ms.max(update.event_unix_ms);
    if update.clear_last_error {
        target.clear_last_error = true;
        target.last_error = None;
    } else if update.last_error.is_some() {
        target.last_error = update.last_error.clone();
    }
}
