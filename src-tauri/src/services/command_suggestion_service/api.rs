use super::*;

impl CommandSuggestionService {
    pub fn new() -> Self {
        Self::default()
    }

    /// 列出当前输入上下文下的命令建议。
    pub fn list_suggestions(
        &self,
        storage: &CommandSqliteStore,
        command_history: &CommandHistoryService,
        request: CommandSuggestionRequest,
    ) -> AppResult<Vec<CommandSuggestionCandidate>> {
        let request = NormalizedSuggestionRequest::try_from(request)?;
        if request.prefix.trim().is_empty() {
            return Ok(Vec::new());
        }

        let mut seen_replacements = HashSet::new();
        let mut candidates = Vec::new();

        if request.provider_enabled(SuggestionProviderKind::History) {
            let started = Instant::now();
            let before_count = candidates.len();
            let result = (|| -> AppResult<()> {
                let history = command_history.list_history_by_command_prefix(
                    storage,
                    request.target,
                    request.remote_host_id.as_deref(),
                    request.prefix.trim(),
                    HISTORY_SCAN_LIMIT,
                )?;

                for (index, entry) in history.into_iter().enumerate() {
                    if candidates.len() >= request.limit {
                        break;
                    }
                    let Some(candidate) = history_candidate(&request, entry, index) else {
                        continue;
                    };
                    if seen_replacements.insert(candidate.replacement_text.clone()) {
                        candidates.push(candidate);
                    }
                }
                if candidates.len() < request.limit {
                    for candidate in self.remote_history_candidates(storage, &request)? {
                        if candidates.len() >= request.limit {
                            break;
                        }
                        if seen_replacements.insert(candidate.replacement_text.clone()) {
                            candidates.push(candidate);
                        }
                    }
                }
                Ok(())
            })();
            self.record_provider_query(
                Some(storage),
                SuggestionProviderKind::History,
                started.elapsed(),
                candidates.len().saturating_sub(before_count),
            );
            result?;
        }

        if request.provider_enabled(SuggestionProviderKind::RemotePath) {
            let started = Instant::now();
            let before_count = candidates.len();
            let result = (|| -> AppResult<()> {
                for candidate in self.remote_path_candidates(storage, &request)? {
                    if seen_replacements.insert(candidate.replacement_text.clone()) {
                        candidates.push(candidate);
                    }
                }
                Ok(())
            })();
            self.record_provider_query(
                Some(storage),
                SuggestionProviderKind::RemotePath,
                started.elapsed(),
                candidates.len().saturating_sub(before_count),
            );
            result?;
        }

        if request.provider_enabled(SuggestionProviderKind::RemoteCommand) {
            let started = Instant::now();
            let before_count = candidates.len();
            let result = (|| -> AppResult<()> {
                for candidate in self.remote_command_candidates(storage, &request)? {
                    if seen_replacements.insert(candidate.replacement_text.clone()) {
                        candidates.push(candidate);
                    }
                }
                Ok(())
            })();
            self.record_provider_query(
                Some(storage),
                SuggestionProviderKind::RemoteCommand,
                started.elapsed(),
                candidates.len().saturating_sub(before_count),
            );
            result?;
        }

        if request.provider_enabled(SuggestionProviderKind::Git) {
            let started = Instant::now();
            let before_count = candidates.len();
            let result = (|| -> AppResult<()> {
                for candidate in self.git_candidates(storage, &request)? {
                    if seen_replacements.insert(candidate.replacement_text.clone()) {
                        candidates.push(candidate);
                    }
                }
                Ok(())
            })();
            self.record_provider_query(
                Some(storage),
                SuggestionProviderKind::Git,
                started.elapsed(),
                candidates.len().saturating_sub(before_count),
            );
            result?;
        }

        if request.provider_enabled(SuggestionProviderKind::Spec) {
            let started = Instant::now();
            let before_count = candidates.len();
            for candidate in spec_candidates(&request) {
                if seen_replacements.insert(candidate.replacement_text.clone()) {
                    candidates.push(candidate);
                }
            }
            self.record_provider_query(
                Some(storage),
                SuggestionProviderKind::Spec,
                started.elapsed(),
                candidates.len().saturating_sub(before_count),
            );
        }

        apply_feedback_scores(storage, &request, &mut candidates)?;

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

    /// 记录用户对命令建议的反馈，用于后续排序调权。
    pub fn record_feedback(
        &self,
        storage: &CommandSqliteStore,
        request: CommandSuggestionFeedbackRecordRequest,
    ) -> AppResult<CommandSuggestionFeedbackRecordResult> {
        let action = request.action;
        let provider = request.provider;
        let replacement_text =
            normalize_required_text("建议替换文本", request.replacement_text, MAX_INPUT_CHARS)?;
        let input = normalize_required_text("建议输入文本", request.input, MAX_INPUT_CHARS)?;
        let cwd = normalize_optional_text("当前工作目录", request.cwd, MAX_CONTEXT_CHARS)?;
        let pane_id = normalize_optional_text("Pane ID", request.pane_id, MAX_CONTEXT_CHARS)?;
        let profile_id =
            normalize_optional_text("Profile ID", request.profile_id, MAX_CONTEXT_CHARS)?;
        let remote_host_id =
            normalize_optional_text("SSH 主机 ID", request.remote_host_id, MAX_CONTEXT_CHARS)?;
        let session_id =
            normalize_optional_text("Session ID", request.session_id, MAX_CONTEXT_CHARS)?;
        let shell = normalize_optional_text("Shell", request.shell, MAX_CONTEXT_CHARS)?;
        let source_id =
            normalize_optional_text("建议来源 ID", request.source_id, MAX_CONTEXT_CHARS)?;
        let target = request.target;
        if is_sensitive_command(&replacement_text) || is_sensitive_command(&input) {
            self.record_feedback_event(Some(storage), provider, action, false);
            self.record_feedback_audit(
                Some(storage),
                provider,
                action,
                target,
                remote_host_id.clone(),
                cwd.clone(),
                pane_id.clone(),
                session_id.clone(),
                false,
                "sensitive-command",
            );
            return Ok(CommandSuggestionFeedbackRecordResult {
                id: None,
                recorded: false,
                skip_reason: Some("sensitive-command".to_owned()),
            });
        }

        let id = Uuid::new_v4().to_string();
        let created_at = SystemTime::now();
        storage.insert_command_suggestion_feedback(&CommandSuggestionFeedbackWrite {
            action: request.action,
            created_at_unix_ms: unix_time_millis_i64(created_at),
            cwd: cwd.clone(),
            id: id.clone(),
            input,
            pane_id: pane_id.clone(),
            profile_id,
            provider,
            remote_host_id: remote_host_id.clone(),
            replacement_text,
            session_id: session_id.clone(),
            shell,
            source_id,
            target,
        })?;

        self.record_feedback_event(Some(storage), provider, action, true);
        self.record_feedback_audit(
            Some(storage),
            provider,
            action,
            target,
            remote_host_id,
            cwd,
            pane_id,
            session_id,
            true,
            "feedback-recorded",
        );

        Ok(CommandSuggestionFeedbackRecordResult {
            id: Some(id),
            recorded: true,
            skip_reason: None,
        })
    }

    /// 返回当前应用运行期间的命令建议观测汇总。
    pub fn telemetry_summary(&self) -> AppResult<CommandSuggestionTelemetrySummary> {
        let generated_at = SystemTime::now();
        let telemetry = self.telemetry()?;
        let mut providers = Vec::new();
        for provider in TELEMETRY_PROVIDER_ORDER {
            let state = telemetry
                .providers
                .get(provider)
                .cloned()
                .unwrap_or_default();
            let average_elapsed_ms = if state.query_count == 0 {
                0.0
            } else {
                state.total_elapsed_ms as f64 / state.query_count as f64
            };
            providers.push(CommandSuggestionProviderTelemetry {
                provider: *provider,
                query_count: state.query_count,
                candidate_count: state.candidate_count,
                total_elapsed_ms: state.total_elapsed_ms,
                average_elapsed_ms,
                cache_hit_count: state.cache_hit_count,
                cache_miss_count: state.cache_miss_count,
                refresh_success_count: state.refresh_success_count,
                refresh_failure_count: state.refresh_failure_count,
                feedback_accepted_count: state.feedback_accepted_count,
                feedback_dismissed_count: state.feedback_dismissed_count,
                feedback_skipped_count: state.feedback_skipped_count,
                last_event_unix_ms: state.last_event_unix_ms,
                last_error: state.last_error,
            });
        }
        let total_query_count = providers.iter().map(|provider| provider.query_count).sum();
        let total_candidate_count = providers
            .iter()
            .map(|provider| provider.candidate_count)
            .sum();

        Ok(CommandSuggestionTelemetrySummary {
            generated_at_unix_ms: unix_time_millis(generated_at),
            providers,
            started_at_unix_ms: unix_time_millis(telemetry.started_at),
            total_candidate_count,
            total_query_count,
        })
    }

    /// 导出当前进程和持久化命令建议观测数据，便于长期排障。
    pub fn telemetry_export(
        &self,
        storage: &CommandSqliteStore,
    ) -> AppResult<CommandSuggestionTelemetryExport> {
        self.flush_pending_telemetry(storage)?;
        let generated_at = SystemTime::now();
        Ok(CommandSuggestionTelemetryExport {
            audit_events: storage.command_suggestion_audit_events(MAX_AUDIT_EVENTS_EXPORT)?,
            generated_at_unix_ms: unix_time_millis(generated_at),
            runtime: self.telemetry_summary()?,
            persisted: persisted_telemetry_summary(storage, generated_at)?,
        })
    }

    /// 清理命令建议诊断数据，避免长期使用时本地库无限增长。
    pub fn cleanup_diagnostics(
        &self,
        storage: &CommandSqliteStore,
        request: CommandSuggestionDiagnosticsCleanupRequest,
    ) -> AppResult<CommandSuggestionDiagnosticsCleanupResult> {
        self.flush_pending_telemetry(storage)?;
        let generated_at = SystemTime::now();
        let generated_at_unix_ms = unix_time_millis_i64(generated_at);
        let audit_retention_days =
            normalize_retention_days(request.audit_retention_days, DEFAULT_AUDIT_RETENTION_DAYS);
        let feedback_retention_days = normalize_retention_days(
            request.feedback_retention_days,
            DEFAULT_FEEDBACK_RETENTION_DAYS,
        );
        let audit_cutoff_unix_ms =
            retention_cutoff_unix_ms(generated_at_unix_ms, audit_retention_days);
        let feedback_cutoff_unix_ms =
            retention_cutoff_unix_ms(generated_at_unix_ms, feedback_retention_days);

        let audit_events_deleted = if request.prune_audit_events.unwrap_or(true) {
            storage.delete_command_suggestion_audit_events_before(audit_cutoff_unix_ms)?
        } else {
            0
        };
        let feedback_deleted = if request.prune_feedback.unwrap_or(true) {
            storage.delete_command_suggestion_feedback_before(feedback_cutoff_unix_ms)?
        } else {
            0
        };
        let provider_cache_deleted = if request.prune_expired_provider_cache {
            storage.delete_expired_command_suggestion_provider_cache(generated_at_unix_ms)?
        } else {
            0
        };
        let telemetry_rows_deleted = if request.reset_persisted_telemetry {
            storage.clear_command_suggestion_telemetry()?
        } else {
            0
        };

        Ok(CommandSuggestionDiagnosticsCleanupResult {
            audit_cutoff_unix_ms: Some(audit_cutoff_unix_ms.max(0) as u128),
            audit_events_deleted,
            feedback_cutoff_unix_ms: Some(feedback_cutoff_unix_ms.max(0) as u128),
            feedback_deleted,
            generated_at_unix_ms: unix_time_millis(generated_at),
            provider_cache_deleted,
            telemetry_rows_deleted,
        })
    }

    /// 记录一条命令建议审计事件。
    pub fn record_audit_event(
        &self,
        storage: &CommandSqliteStore,
        request: CommandSuggestionAuditRecordRequest,
    ) -> AppResult<CommandSuggestionAuditRecordResult> {
        let event_id = Uuid::new_v4().to_string();
        let created_at = SystemTime::now();
        storage.insert_command_suggestion_audit_event(
            &command_suggestion_event_store::CommandSuggestionAuditEventWrite {
                created_at_unix_ms: unix_time_millis_i64(created_at),
                cwd: normalize_optional_text("当前工作目录", request.cwd, MAX_CONTEXT_CHARS)?,
                decision: request.decision,
                event_kind: request.event_kind,
                id: event_id.clone(),
                metadata_json: serde_json::to_string(&normalize_audit_metadata(request.metadata)?)?,
                pane_id: normalize_optional_text("Pane ID", request.pane_id, MAX_CONTEXT_CHARS)?,
                path: normalize_optional_text("远端目录", request.path, MAX_CONTEXT_CHARS)?,
                provider: request.provider,
                reason: normalize_optional_text("审计原因", request.reason, MAX_CONTEXT_CHARS)?,
                remote_host_id: normalize_optional_text(
                    "SSH 主机 ID",
                    request.remote_host_id,
                    MAX_CONTEXT_CHARS,
                )?,
                session_id: normalize_optional_text(
                    "Session ID",
                    request.session_id,
                    MAX_CONTEXT_CHARS,
                )?,
                target: request.target,
            },
        )?;

        Ok(CommandSuggestionAuditRecordResult {
            event_id,
            recorded: true,
        })
    }

    pub(super) fn record_audit_event_best_effort(
        &self,
        storage: Option<&CommandSqliteStore>,
        request: CommandSuggestionAuditRecordRequest,
    ) {
        let Some(storage) = storage else {
            return;
        };
        let _ = self.record_audit_event(storage, request);
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn record_remote_probe_refresh_audit(
        &self,
        storage: Option<&CommandSqliteStore>,
        provider: SuggestionProviderKind,
        remote_host_id: String,
        cwd: Option<String>,
        path: Option<String>,
        succeeded: bool,
        max_entries: usize,
        ttl_seconds: u64,
    ) {
        let mut metadata = BTreeMap::new();
        metadata.insert("maxEntries".to_owned(), max_entries.to_string());
        metadata.insert("ttlSeconds".to_owned(), ttl_seconds.to_string());
        self.record_audit_event_best_effort(
            storage,
            CommandSuggestionAuditRecordRequest {
                cwd,
                decision: if succeeded {
                    CommandSuggestionAuditDecision::Succeeded
                } else {
                    CommandSuggestionAuditDecision::Failed
                },
                event_kind: CommandSuggestionAuditEventKind::RemoteProbeRefresh,
                metadata,
                pane_id: None,
                path,
                provider: Some(provider),
                reason: Some(if succeeded {
                    "refresh-succeeded".to_owned()
                } else {
                    "refresh-failed".to_owned()
                }),
                remote_host_id: Some(remote_host_id),
                session_id: None,
                target: CommandHistoryTarget::Ssh,
            },
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn record_remote_probe_schedule_skip_audit(
        &self,
        storage: Option<&CommandSqliteStore>,
        provider: SuggestionProviderKind,
        remote_host_id: String,
        cwd: Option<String>,
        path: Option<String>,
        skip: &RemoteProbePolicySkip,
        max_entries: usize,
        ttl_seconds: u64,
    ) {
        let mut metadata = BTreeMap::new();
        metadata.insert("maxEntries".to_owned(), max_entries.to_string());
        metadata.insert("ttlSeconds".to_owned(), ttl_seconds.to_string());
        metadata.insert(
            "productionHost".to_owned(),
            skip.production_host.to_string(),
        );
        metadata.insert(
            "productionHostPolicy".to_owned(),
            production_host_policy_label(&skip.production_host_policy).to_owned(),
        );
        metadata.insert(
            "remoteProbeEnabled".to_owned(),
            skip.remote_probe_enabled.to_string(),
        );
        self.record_audit_event_best_effort(
            storage,
            CommandSuggestionAuditRecordRequest {
                cwd,
                decision: CommandSuggestionAuditDecision::Skipped,
                event_kind: CommandSuggestionAuditEventKind::RemoteProbeSchedule,
                metadata,
                pane_id: None,
                path,
                provider: Some(provider),
                reason: Some(skip.reason.to_owned()),
                remote_host_id: Some(remote_host_id),
                session_id: None,
                target: CommandHistoryTarget::Ssh,
            },
        );
    }

    pub(super) fn remote_probe_policy_skip(
        &self,
        storage: &CommandSqliteStore,
        paths: &KerminalPaths,
        host_id: &str,
        inline_settings: &TerminalInlineSuggestionSettings,
    ) -> AppResult<Option<RemoteProbePolicySkip>> {
        let _ = storage;
        let Some(host) = ConfigFileStore::new(paths.root.clone())
            .remote_host_by_id(host_id)
            .map_err(config_file_error)?
        else {
            return Ok(None);
        };
        let production_host_policy = inline_settings.production_host_policy.clone();
        if !inline_settings.remote_probe_enabled {
            return Ok(Some(RemoteProbePolicySkip {
                production_host: host.production,
                production_host_policy,
                remote_probe_enabled: false,
                reason: "remote-probe-disabled",
            }));
        }
        if host.production
            && matches!(
                &production_host_policy,
                TerminalInlineSuggestionProductionHostPolicy::Restricted
            )
        {
            return Ok(Some(RemoteProbePolicySkip {
                production_host: true,
                production_host_policy,
                remote_probe_enabled: true,
                reason: "production-host-restricted",
            }));
        }
        Ok(None)
    }

    pub(super) fn skipped_remote_path_refresh_result(
        request: NormalizedRemotePathRefreshRequest,
    ) -> CommandSuggestionRemotePathRefreshResult {
        CommandSuggestionRemotePathRefreshResult {
            cached_at_unix_ms: unix_time_millis(SystemTime::now()),
            entry_count: 0,
            host_id: request.host_id,
            path: request.path,
            ttl_seconds: request.ttl_seconds,
        }
    }

    pub(super) fn skipped_remote_command_refresh_result(
        request: NormalizedRemoteCommandRefreshRequest,
    ) -> CommandSuggestionRemoteCommandRefreshResult {
        CommandSuggestionRemoteCommandRefreshResult {
            cached_at_unix_ms: unix_time_millis(SystemTime::now()),
            command_count: 0,
            host_id: request.host_id,
            ttl_seconds: request.ttl_seconds,
        }
    }

    pub(super) fn skipped_remote_history_refresh_result(
        request: NormalizedRemoteHistoryRefreshRequest,
    ) -> CommandSuggestionRemoteHistoryRefreshResult {
        CommandSuggestionRemoteHistoryRefreshResult {
            cached_at_unix_ms: unix_time_millis(SystemTime::now()),
            command_count: 0,
            host_id: request.host_id,
            ttl_seconds: request.ttl_seconds,
        }
    }

    pub(super) fn skipped_git_refresh_result(
        request: NormalizedGitRefreshRequest,
    ) -> CommandSuggestionGitRefreshResult {
        CommandSuggestionGitRefreshResult {
            cached_at_unix_ms: unix_time_millis(SystemTime::now()),
            cwd: request.cwd,
            entry_count: 0,
            host_id: request.host_id,
            repo_root: None,
            ttl_seconds: request.ttl_seconds,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn record_feedback_audit(
        &self,
        storage: Option<&CommandSqliteStore>,
        provider: SuggestionProviderKind,
        action: CommandSuggestionFeedbackAction,
        target: CommandHistoryTarget,
        remote_host_id: Option<String>,
        cwd: Option<String>,
        pane_id: Option<String>,
        session_id: Option<String>,
        recorded: bool,
        reason: &str,
    ) {
        let mut metadata = BTreeMap::new();
        metadata.insert("action".to_owned(), action.as_str().to_owned());
        self.record_audit_event_best_effort(
            storage,
            CommandSuggestionAuditRecordRequest {
                cwd,
                decision: if recorded {
                    CommandSuggestionAuditDecision::Recorded
                } else {
                    CommandSuggestionAuditDecision::Skipped
                },
                event_kind: CommandSuggestionAuditEventKind::Feedback,
                metadata,
                pane_id,
                path: None,
                provider: Some(provider),
                reason: Some(reason.to_owned()),
                remote_host_id,
                session_id,
                target,
            },
        );
    }
}

fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}
