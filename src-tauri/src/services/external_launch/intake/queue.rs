//! 外部启动请求的入队、去重和拒绝状态机。

use std::{sync::MutexGuard, time::Instant};

use crate::error::{AppError, AppResult};

use super::{
    apply_policy_options, health, log_external_launch_queued, prune_delivery_history,
    sanitize_error_message, ExternalLaunchAcceptOutcome, ExternalLaunchArgSummary,
    ExternalLaunchDedupRecord, ExternalLaunchEntrypoint, ExternalLaunchIntake,
    ExternalLaunchIntakeState, ExternalLaunchPolicy, ExternalLaunchQueued, ExternalLaunchRejected,
    ExternalLaunchSourceTool, ExternalLaunchTargetSummary, ExternalSshLaunchRequest,
    EXTERNAL_LAUNCH_DEDUP_TTL,
};

impl ExternalLaunchIntake {
    /// 提交 worker 已准备好的请求；本阶段只执行内存策略、secret broker 与队列状态迁移。
    pub(super) fn finish_prepared_request(
        &self,
        mut request: ExternalSshLaunchRequest,
        policy: ExternalLaunchPolicy,
        entrypoint: ExternalLaunchEntrypoint,
        request_id: Option<String>,
        summary: ExternalLaunchArgSummary,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        apply_policy_options(&policy, &mut request);
        let source_tool = request.source.tool;
        let request = match self.inner.secrets.protect_prepared_request(request) {
            Ok(request) => request,
            Err(error) => {
                let rejected =
                    self.record_rejection(entrypoint, Some(source_tool), error, summary)?;
                return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
            }
        };
        log_external_launch_queued(entrypoint, &request);
        self.enqueue_request(request, entrypoint, request_id, summary)
    }

    pub(super) fn duplicate_bridge_request(
        &self,
        request_id: &str,
        raw_hash: &str,
        now: Instant,
    ) -> AppResult<Option<ExternalLaunchQueued>> {
        if request_id.is_empty() {
            return Err(AppError::InvalidInput(
                "external launch bridge request id must not be empty".to_owned(),
            ));
        }
        let mut state = self.state()?;
        prune_delivery_history(&mut state, now);
        let pending_count = state.pending.len();
        let Some(record) = state.request_dedup.get_mut(request_id) else {
            return Ok(None);
        };
        if record.raw_hash != raw_hash {
            return Err(AppError::InvalidInput(
                "external launch bridge request id was reused for another payload".to_owned(),
            ));
        }
        record.last_seen_at = now;
        record.expires_at = now.checked_add(EXTERNAL_LAUNCH_DEDUP_TTL).unwrap_or(now);
        let mut queued = record.queued.clone();
        queued.pending_count = pending_count;
        drop(state);
        let mut health = self.health()?;
        health.snapshot.dedup_count = health.snapshot.dedup_count.saturating_add(1);
        Ok(Some(queued))
    }

    /// 原子检查总在途容量并入队，超限时立即释放刚保护的 session secret。
    pub(super) fn enqueue_request(
        &self,
        request: ExternalSshLaunchRequest,
        entrypoint: ExternalLaunchEntrypoint,
        request_id: Option<String>,
        summary: ExternalLaunchArgSummary,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        let policy = self.policy_snapshot()?;
        let now = Instant::now();
        let request_raw_hash = summary.raw_hash.clone();
        let mut state = self.state()?;
        prune_delivery_history(&mut state, now);
        if let Some(request_id) = request_id.as_deref() {
            if let Some(record) = state.request_dedup.get_mut(request_id) {
                if record.raw_hash != request_raw_hash {
                    drop(state);
                    self.inner.secrets.cancel_launch(&request.id)?;
                    return Err(AppError::InvalidInput(
                        "external launch bridge request id was reused for another payload"
                            .to_owned(),
                    ));
                }
                record.last_seen_at = now;
                record.expires_at = now.checked_add(EXTERNAL_LAUNCH_DEDUP_TTL).unwrap_or(now);
                let mut queued = record.queued.clone();
                queued.pending_count = state.pending.len();
                drop(state);
                self.inner.secrets.cancel_launch(&request.id)?;
                let mut health = self.health()?;
                health.snapshot.dedup_count = health.snapshot.dedup_count.saturating_add(1);
                return Ok(ExternalLaunchAcceptOutcome::Queued(queued));
            }
        }
        if state.pending.len().saturating_add(state.active.len()) >= policy.pending_capacity {
            drop(state);
            self.inner.secrets.cancel_launch(&request.id)?;
            let mut health = self.health()?;
            health.snapshot.backpressure_count =
                health.snapshot.backpressure_count.saturating_add(1);
            let rejected = self.record_policy_rejection(
                entrypoint,
                Some(request.source.tool),
                "external SSH launch queue is busy; retry later",
                summary,
            )?;
            return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
        }
        state.queued_at.insert(request.id.clone(), now);
        state.pending.push_back(request.clone());
        state.accepted_count += 1;
        let queued = ExternalLaunchQueued {
            launch_id: request.id,
            source_tool: request.source.tool,
            entrypoint,
            target: ExternalLaunchTargetSummary::from_target(&request.target),
            pending_count: state.pending.len(),
        };
        if let Some(request_id) = request_id {
            state.request_dedup.insert(
                request_id,
                ExternalLaunchDedupRecord {
                    queued: queued.clone(),
                    raw_hash: request_raw_hash,
                    expires_at: now.checked_add(EXTERNAL_LAUNCH_DEDUP_TTL).unwrap_or(now),
                    last_seen_at: now,
                },
            );
            prune_delivery_history(&mut state, now);
        }
        Ok(ExternalLaunchAcceptOutcome::Queued(queued))
    }

    pub(super) fn policy(&self) -> AppResult<MutexGuard<'_, ExternalLaunchPolicy>> {
        self.inner
            .policy
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external launch policy"))
    }
    pub(super) fn health(&self) -> AppResult<MutexGuard<'_, health::ExternalLaunchRuntimeHealth>> {
        self.inner
            .health
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external launch health"))
    }
    pub(super) fn state(&self) -> AppResult<MutexGuard<'_, ExternalLaunchIntakeState>> {
        self.inner
            .state
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external launch intake"))
    }
    pub(super) fn record_rejection(
        &self,
        entrypoint: ExternalLaunchEntrypoint,
        source_tool: Option<ExternalLaunchSourceTool>,
        error: AppError,
        summary: ExternalLaunchArgSummary,
    ) -> AppResult<ExternalLaunchRejected> {
        let rejected = ExternalLaunchRejected {
            entrypoint,
            source_tool,
            message: sanitize_error_message(error),
            arg_count: summary.arg_count,
            raw_hash: summary.raw_hash,
            cwd_present: summary.cwd_present,
        };
        let mut state = self.state()?;
        state.rejected_count += 1;
        state.last_rejection = Some(rejected.clone());
        Ok(rejected)
    }
    pub(super) fn record_policy_rejection(
        &self,
        entrypoint: ExternalLaunchEntrypoint,
        source_tool: Option<ExternalLaunchSourceTool>,
        message: &'static str,
        summary: ExternalLaunchArgSummary,
    ) -> AppResult<ExternalLaunchRejected> {
        let rejected = ExternalLaunchRejected {
            entrypoint,
            source_tool,
            message: message.to_owned(),
            arg_count: summary.arg_count,
            raw_hash: summary.raw_hash,
            cwd_present: summary.cwd_present,
        };
        let mut state = self.state()?;
        state.rejected_count += 1;
        state.last_rejection = Some(rejected.clone());
        Ok(rejected)
    }
}
