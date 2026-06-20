use super::*;

impl CommandSuggestionService {
    pub(super) fn remote_history_candidates(
        &self,
        storage: &SqliteStore,
        request: &NormalizedSuggestionRequest,
    ) -> AppResult<Vec<CommandSuggestionCandidate>> {
        let Some(host_id) = request.remote_host_id.as_deref() else {
            return Ok(Vec::new());
        };
        if request.target != CommandHistoryTarget::Ssh {
            return Ok(Vec::new());
        }

        let now = SystemTime::now();
        let Some(cache_entry) = self.remote_history_cache_entry(storage, host_id, now)? else {
            return Ok(Vec::new());
        };

        let mut candidates = Vec::new();
        for (index, command) in cache_entry.commands.iter().enumerate() {
            if command == &request.prefix || !command.starts_with(&request.prefix) {
                continue;
            }
            let Some(candidate) = remote_history_candidate(request, command, &cache_entry, index)
            else {
                continue;
            };
            candidates.push(candidate);
        }
        candidates.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.display_text.cmp(&right.display_text))
        });
        candidates.truncate(request.limit);
        Ok(candidates)
    }

    pub(super) fn remote_path_candidates(
        &self,
        storage: &SqliteStore,
        request: &NormalizedSuggestionRequest,
    ) -> AppResult<Vec<CommandSuggestionCandidate>> {
        let Some(host_id) = request.remote_host_id.as_deref() else {
            return Ok(Vec::new());
        };
        if request.target != CommandHistoryTarget::Ssh {
            return Ok(Vec::new());
        }
        let Some(token) = remote_path_token(&request.prefix, request.cwd.as_deref()) else {
            return Ok(Vec::new());
        };

        let cache_key = RemotePathCacheKey {
            directory: token.lookup_directory.clone(),
            host_id: host_id.to_owned(),
        };
        let now = SystemTime::now();
        let Some(cache_entry) = self.remote_path_cache_entry(storage, &cache_key, now)? else {
            return Ok(Vec::new());
        };

        let mut candidates = Vec::new();
        for (index, entry) in cache_entry.entries.iter().enumerate() {
            if !entry.name.starts_with(&token.base_name) {
                continue;
            }
            let Some(candidate) =
                remote_path_candidate(request, &token, entry, &cache_entry, index)
            else {
                continue;
            };
            candidates.push(candidate);
            if candidates.len() >= request.limit {
                break;
            }
        }
        Ok(candidates)
    }

    pub(super) fn remote_command_candidates(
        &self,
        storage: &SqliteStore,
        request: &NormalizedSuggestionRequest,
    ) -> AppResult<Vec<CommandSuggestionCandidate>> {
        let Some(host_id) = request.remote_host_id.as_deref() else {
            return Ok(Vec::new());
        };
        if request.target != CommandHistoryTarget::Ssh {
            return Ok(Vec::new());
        }
        let Some(token) = remote_command_token(&request.prefix) else {
            return Ok(Vec::new());
        };

        let now = SystemTime::now();
        let Some(cache_entry) = self.remote_command_cache_entry(storage, host_id, now)? else {
            return Ok(Vec::new());
        };

        let mut candidates = Vec::new();
        for (index, command) in cache_entry.commands.iter().enumerate() {
            if !command.starts_with(&token.name) || command == &token.name {
                continue;
            }
            let Some(candidate) =
                remote_command_candidate(request, &token, command, &cache_entry, index)
            else {
                continue;
            };
            candidates.push(candidate);
            if candidates.len() >= request.limit {
                break;
            }
        }
        Ok(candidates)
    }

    pub(super) fn git_candidates(
        &self,
        storage: &SqliteStore,
        request: &NormalizedSuggestionRequest,
    ) -> AppResult<Vec<CommandSuggestionCandidate>> {
        let Some(host_id) = request.remote_host_id.as_deref() else {
            return Ok(Vec::new());
        };
        if request.target != CommandHistoryTarget::Ssh {
            return Ok(Vec::new());
        }
        let Some(cwd) = request.cwd.as_deref() else {
            return Ok(Vec::new());
        };
        let Some(token) = git_suggestion_token(&request.prefix) else {
            return Ok(Vec::new());
        };

        let cache_key = GitCacheKey {
            cwd: normalize_remote_cache_path(cwd),
            host_id: host_id.to_owned(),
        };
        let now = SystemTime::now();
        let Some(cache_entry) = self.git_cache_entry(storage, &cache_key, now)? else {
            return Ok(Vec::new());
        };

        let mut candidates = Vec::new();
        for (index, entry) in cache_entry.entries.iter().enumerate() {
            if !git_ref_kind_matches(token.kind, entry.kind) || !entry.name.starts_with(&token.name)
            {
                continue;
            }
            let Some(candidate) = git_ref_candidate(request, &token, entry, &cache_entry, index)
            else {
                continue;
            };
            candidates.push(candidate);
            if candidates.len() >= request.limit {
                break;
            }
        }
        Ok(candidates)
    }

    pub(super) fn remote_path_cache_entry(
        &self,
        storage: &SqliteStore,
        key: &RemotePathCacheKey,
        now: SystemTime,
    ) -> AppResult<Option<RemotePathCacheEntry>> {
        {
            let mut cache = self.remote_path_cache()?;
            prune_remote_path_cache(&mut cache, now);
            if let Some(entry) = cache.get(key).cloned() {
                self.record_cache_result(Some(storage), SuggestionProviderKind::RemotePath, true);
                return Ok(Some(entry));
            }
        }

        let Some(row) = storage.command_suggestion_provider_cache_entry(
            SuggestionProviderKind::RemotePath,
            &key.host_id,
            &key.directory,
            unix_time_millis_i64(now),
        )?
        else {
            self.record_cache_result(Some(storage), SuggestionProviderKind::RemotePath, false);
            return Ok(None);
        };
        let mut entries = serde_json::from_str::<Vec<SftpEntry>>(&row.payload_json)?;
        entries.retain(is_cacheable_remote_entry);
        entries.sort_by(compare_sftp_entries);
        let entry = RemotePathCacheEntry {
            cached_at: system_time_from_unix_millis(row.cached_at_unix_ms),
            entries,
            expires_at: system_time_from_unix_millis(row.expires_at_unix_ms),
            ttl_seconds: row.ttl_seconds,
        };
        let mut cache = self.remote_path_cache()?;
        prune_remote_path_cache(&mut cache, now);
        if !cache.contains_key(key) && cache.len() >= MAX_REMOTE_PATH_CACHE_DIRECTORIES {
            remove_oldest_remote_path_cache_entry(&mut cache);
        }
        cache.insert(key.clone(), entry.clone());
        self.record_cache_result(Some(storage), SuggestionProviderKind::RemotePath, true);
        Ok(Some(entry))
    }

    pub(super) fn remote_command_cache_entry(
        &self,
        storage: &SqliteStore,
        host_id: &str,
        now: SystemTime,
    ) -> AppResult<Option<RemoteCommandCacheEntry>> {
        {
            let mut cache = self.remote_command_cache()?;
            prune_remote_command_cache(&mut cache, now);
            if let Some(entry) = cache.get(host_id).cloned() {
                self.record_cache_result(
                    Some(storage),
                    SuggestionProviderKind::RemoteCommand,
                    true,
                );
                return Ok(Some(entry));
            }
        }

        let Some(row) = storage.command_suggestion_provider_cache_entry(
            SuggestionProviderKind::RemoteCommand,
            host_id,
            REMOTE_COMMAND_CACHE_SCOPE_KEY,
            unix_time_millis_i64(now),
        )?
        else {
            self.record_cache_result(Some(storage), SuggestionProviderKind::RemoteCommand, false);
            return Ok(None);
        };
        let mut commands = serde_json::from_str::<Vec<String>>(&row.payload_json)?
            .into_iter()
            .filter(|command| is_cacheable_remote_command(command))
            .collect::<Vec<_>>();
        commands.sort();
        commands.dedup();
        let entry = RemoteCommandCacheEntry {
            cached_at: system_time_from_unix_millis(row.cached_at_unix_ms),
            commands,
            expires_at: system_time_from_unix_millis(row.expires_at_unix_ms),
            ttl_seconds: row.ttl_seconds,
        };
        let mut cache = self.remote_command_cache()?;
        prune_remote_command_cache(&mut cache, now);
        cache.insert(host_id.to_owned(), entry.clone());
        self.record_cache_result(Some(storage), SuggestionProviderKind::RemoteCommand, true);
        Ok(Some(entry))
    }

    pub(super) fn remote_history_cache_entry(
        &self,
        storage: &SqliteStore,
        host_id: &str,
        now: SystemTime,
    ) -> AppResult<Option<RemoteHistoryCacheEntry>> {
        {
            let mut cache = self.remote_history_cache()?;
            prune_remote_history_cache(&mut cache, now);
            if let Some(entry) = cache.get(host_id).cloned() {
                self.record_cache_result(Some(storage), SuggestionProviderKind::History, true);
                return Ok(Some(entry));
            }
        }

        let Some(row) = storage.command_suggestion_provider_cache_entry(
            SuggestionProviderKind::History,
            host_id,
            REMOTE_HISTORY_CACHE_SCOPE_KEY,
            unix_time_millis_i64(now),
        )?
        else {
            self.record_cache_result(Some(storage), SuggestionProviderKind::History, false);
            return Ok(None);
        };
        let commands = normalize_remote_history_commands(
            serde_json::from_str::<Vec<String>>(&row.payload_json)?,
            MAX_REMOTE_HISTORY_MAX_ENTRIES,
        );
        let entry = RemoteHistoryCacheEntry {
            cached_at: system_time_from_unix_millis(row.cached_at_unix_ms),
            commands,
            expires_at: system_time_from_unix_millis(row.expires_at_unix_ms),
            ttl_seconds: row.ttl_seconds,
        };
        let mut cache = self.remote_history_cache()?;
        prune_remote_history_cache(&mut cache, now);
        cache.insert(host_id.to_owned(), entry.clone());
        self.record_cache_result(Some(storage), SuggestionProviderKind::History, true);
        Ok(Some(entry))
    }

    pub(super) fn git_cache_entry(
        &self,
        storage: &SqliteStore,
        key: &GitCacheKey,
        now: SystemTime,
    ) -> AppResult<Option<GitCacheEntry>> {
        {
            let mut cache = self.git_ref_cache()?;
            prune_git_cache(&mut cache, now);
            if let Some(entry) = cache.get(key).cloned() {
                self.record_cache_result(Some(storage), SuggestionProviderKind::Git, true);
                return Ok(Some(entry));
            }
        }

        let Some(row) = storage.command_suggestion_provider_cache_entry(
            SuggestionProviderKind::Git,
            &key.host_id,
            &key.cwd,
            unix_time_millis_i64(now),
        )?
        else {
            self.record_cache_result(Some(storage), SuggestionProviderKind::Git, false);
            return Ok(None);
        };
        let mut seen = HashSet::new();
        let mut entries = serde_json::from_str::<Vec<GitRefEntry>>(&row.payload_json)?
            .into_iter()
            .filter(|entry| is_cacheable_git_ref_name(&entry.name))
            .filter(|entry| seen.insert((entry.kind, entry.name.clone())))
            .collect::<Vec<_>>();
        entries.sort_by(compare_git_ref_entries);
        let entry = GitCacheEntry {
            cached_at: system_time_from_unix_millis(row.cached_at_unix_ms),
            cwd: key.cwd.clone(),
            entries,
            expires_at: system_time_from_unix_millis(row.expires_at_unix_ms),
            repo_root: row.repo_root,
            ttl_seconds: row.ttl_seconds,
        };
        let mut cache = self.git_ref_cache()?;
        prune_git_cache(&mut cache, now);
        if !cache.contains_key(key) && cache.len() >= MAX_GIT_CACHE_REPOSITORIES {
            remove_oldest_git_cache_entry(&mut cache);
        }
        cache.insert(key.clone(), entry.clone());
        self.record_cache_result(Some(storage), SuggestionProviderKind::Git, true);
        Ok(Some(entry))
    }

    pub(super) fn git_ref_cache(
        &self,
    ) -> AppResult<MutexGuard<'_, HashMap<GitCacheKey, GitCacheEntry>>> {
        self.git_ref_cache
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("command suggestion git ref cache"))
    }

    pub(super) fn remote_command_cache(
        &self,
    ) -> AppResult<MutexGuard<'_, HashMap<String, RemoteCommandCacheEntry>>> {
        self.remote_command_cache
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("command suggestion remote command cache"))
    }

    pub(super) fn remote_history_cache(
        &self,
    ) -> AppResult<MutexGuard<'_, HashMap<String, RemoteHistoryCacheEntry>>> {
        self.remote_history_cache
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("command suggestion remote history cache"))
    }

    pub(super) fn remote_path_cache(
        &self,
    ) -> AppResult<MutexGuard<'_, HashMap<RemotePathCacheKey, RemotePathCacheEntry>>> {
        self.remote_path_cache
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("command suggestion remote path cache"))
    }

    pub(super) fn telemetry(&self) -> AppResult<MutexGuard<'_, CommandSuggestionTelemetryState>> {
        self.telemetry
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("command suggestion telemetry"))
    }

    pub(super) fn pending_telemetry_updates(
        &self,
    ) -> AppResult<MutexGuard<'_, HashMap<SuggestionProviderKind, CommandSuggestionTelemetryUpdate>>>
    {
        self.pending_telemetry_updates
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("command suggestion telemetry queue"))
    }

    pub(super) fn queue_telemetry_update(&self, update: CommandSuggestionTelemetryUpdate) {
        let Ok(mut pending) = self.pending_telemetry_updates() else {
            return;
        };
        pending
            .entry(update.provider)
            .and_modify(|pending_update| merge_telemetry_update(pending_update, &update))
            .or_insert(update);
    }

    pub(super) fn flush_pending_telemetry(&self, storage: &SqliteStore) -> AppResult<()> {
        let updates = {
            let mut pending = self.pending_telemetry_updates()?;
            pending
                .drain()
                .map(|(_, update)| update)
                .collect::<Vec<_>>()
        };
        for update in updates {
            persist_telemetry_update(Some(storage), update);
        }
        Ok(())
    }

    pub(super) fn record_provider_query(
        &self,
        storage: Option<&SqliteStore>,
        provider: SuggestionProviderKind,
        elapsed: Duration,
        candidate_count: usize,
    ) {
        let event_time = SystemTime::now();
        let elapsed_ms = elapsed_millis(elapsed);
        let Ok(mut telemetry) = self.telemetry() else {
            return;
        };
        let provider_state = telemetry.provider_mut(provider);
        provider_state.query_count = provider_state.query_count.saturating_add(1);
        provider_state.candidate_count = provider_state
            .candidate_count
            .saturating_add(candidate_count as u64);
        provider_state.total_elapsed_ms =
            provider_state.total_elapsed_ms.saturating_add(elapsed_ms);
        provider_state.mark_event_at(event_time);
        drop(telemetry);
        let _ = storage;
        self.queue_telemetry_update(CommandSuggestionTelemetryUpdate {
            provider,
            query_count_delta: 1,
            candidate_count_delta: candidate_count as u64,
            total_elapsed_ms_delta: elapsed_ms,
            event_unix_ms: unix_time_millis_i64(event_time),
            ..CommandSuggestionTelemetryUpdate::new(provider)
        });
    }

    pub(super) fn record_cache_result(
        &self,
        storage: Option<&SqliteStore>,
        provider: SuggestionProviderKind,
        hit: bool,
    ) {
        let event_time = SystemTime::now();
        let Ok(mut telemetry) = self.telemetry() else {
            return;
        };
        let provider_state = telemetry.provider_mut(provider);
        if hit {
            provider_state.cache_hit_count = provider_state.cache_hit_count.saturating_add(1);
        } else {
            provider_state.cache_miss_count = provider_state.cache_miss_count.saturating_add(1);
        }
        provider_state.mark_event_at(event_time);
        drop(telemetry);
        let mut update = CommandSuggestionTelemetryUpdate::new(provider);
        update.event_unix_ms = unix_time_millis_i64(event_time);
        if hit {
            update.cache_hit_count_delta = 1;
        } else {
            update.cache_miss_count_delta = 1;
        }
        let _ = storage;
        self.queue_telemetry_update(update);
    }

    pub(super) fn record_refresh_success(
        &self,
        storage: Option<&SqliteStore>,
        provider: SuggestionProviderKind,
    ) {
        let event_time = SystemTime::now();
        let Ok(mut telemetry) = self.telemetry() else {
            return;
        };
        let provider_state = telemetry.provider_mut(provider);
        provider_state.refresh_success_count =
            provider_state.refresh_success_count.saturating_add(1);
        provider_state.last_error = None;
        provider_state.mark_event_at(event_time);
        drop(telemetry);
        let mut update = CommandSuggestionTelemetryUpdate::new(provider);
        update.event_unix_ms = unix_time_millis_i64(event_time);
        update.refresh_success_count_delta = 1;
        update.clear_last_error = true;
        persist_telemetry_update(storage, update);
    }

    pub(super) fn record_refresh_failure(
        &self,
        storage: Option<&SqliteStore>,
        provider: SuggestionProviderKind,
        error: String,
    ) {
        let event_time = SystemTime::now();
        let Ok(mut telemetry) = self.telemetry() else {
            return;
        };
        let provider_state = telemetry.provider_mut(provider);
        provider_state.refresh_failure_count =
            provider_state.refresh_failure_count.saturating_add(1);
        provider_state.last_error = Some(error.clone());
        provider_state.mark_event_at(event_time);
        drop(telemetry);
        let mut update = CommandSuggestionTelemetryUpdate::new(provider);
        update.event_unix_ms = unix_time_millis_i64(event_time);
        update.refresh_failure_count_delta = 1;
        update.last_error = Some(error);
        persist_telemetry_update(storage, update);
    }

    pub(super) fn record_feedback_event(
        &self,
        storage: Option<&SqliteStore>,
        provider: SuggestionProviderKind,
        action: CommandSuggestionFeedbackAction,
        recorded: bool,
    ) {
        let event_time = SystemTime::now();
        let Ok(mut telemetry) = self.telemetry() else {
            return;
        };
        let provider_state = telemetry.provider_mut(provider);
        let mut update = CommandSuggestionTelemetryUpdate::new(provider);
        update.event_unix_ms = unix_time_millis_i64(event_time);
        if !recorded {
            provider_state.feedback_skipped_count =
                provider_state.feedback_skipped_count.saturating_add(1);
            update.feedback_skipped_count_delta = 1;
        } else if action == CommandSuggestionFeedbackAction::Accepted {
            provider_state.feedback_accepted_count =
                provider_state.feedback_accepted_count.saturating_add(1);
            update.feedback_accepted_count_delta = 1;
        } else {
            provider_state.feedback_dismissed_count =
                provider_state.feedback_dismissed_count.saturating_add(1);
            update.feedback_dismissed_count_delta = 1;
        }
        provider_state.mark_event_at(event_time);
        drop(telemetry);
        persist_telemetry_update(storage, update);
    }
}
