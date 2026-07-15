//! 外部启动请求的领取、租约和确认状态机。

use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};

use super::{
    duration_ms, prune_delivery_history, requeue_expired_claims, ExternalLaunchClaim,
    ExternalLaunchIntake, ExternalLaunchIntakeSnapshot, ExternalSshLaunchRequest,
    EXTERNAL_LAUNCH_DEDUP_TTL,
};

impl ExternalLaunchIntake {
    /// 领取所有待处理请求，并为每个请求建立可过期租约。
    pub fn take_pending(&self) -> AppResult<Vec<ExternalSshLaunchRequest>> {
        self.claim_pending_at(Instant::now())
    }

    /// 为新建或重载的 WebView 返回全部可恢复 claim，并续租避免处理期间被过早回收。
    pub fn recover_pending(&self) -> AppResult<Vec<ExternalSshLaunchRequest>> {
        let now = Instant::now();
        let lease = Duration::from_millis(self.policy_snapshot()?.claim_lease_ms);
        let lease_expires_at = now.checked_add(lease).unwrap_or(now);
        let mut state = self.state()?;
        let expired_count = requeue_expired_claims(&mut state, now);
        let mut requests = state
            .active
            .values_mut()
            .map(|claim| {
                claim.lease_expires_at = lease_expires_at;
                (claim.sequence, claim.request.clone())
            })
            .collect::<Vec<_>>();
        requests.sort_by_key(|(sequence, _)| *sequence);
        let mut requests = requests
            .into_iter()
            .map(|(_, request)| request)
            .collect::<Vec<_>>();
        let pending = state.pending.drain(..).collect::<Vec<_>>();
        for request in &pending {
            state.claim_sequence = state.claim_sequence.saturating_add(1);
            let sequence = state.claim_sequence;
            state.active.insert(
                request.id.clone(),
                ExternalLaunchClaim {
                    request: request.clone(),
                    lease_expires_at,
                    sequence,
                },
            );
        }
        requests.extend(pending);
        drop(state);
        self.record_expiry(expired_count);
        Ok(requests)
    }

    /// 使用调用方提供的时钟领取请求，供租约状态机和无等待测试复用。
    #[doc(hidden)]
    pub fn claim_pending_at(&self, now: Instant) -> AppResult<Vec<ExternalSshLaunchRequest>> {
        let lease = Duration::from_millis(self.policy_snapshot()?.claim_lease_ms);
        let mut state = self.state()?;
        let expired_count = requeue_expired_claims(&mut state, now);
        let requests = state.pending.drain(..).collect::<Vec<_>>();
        for request in &requests {
            state.claim_sequence = state.claim_sequence.saturating_add(1);
            let sequence = state.claim_sequence;
            state.active.insert(
                request.id.clone(),
                ExternalLaunchClaim {
                    request: request.clone(),
                    lease_expires_at: now.checked_add(lease).unwrap_or(now),
                    sequence,
                },
            );
        }
        drop(state);
        self.record_expiry(expired_count);
        Ok(requests)
    }

    pub fn active_request(&self, launch_id: &str) -> AppResult<Option<ExternalSshLaunchRequest>> {
        Ok(self
            .state()?
            .active
            .get(launch_id)
            .map(|claim| claim.request.clone()))
    }

    pub fn forget_active(&self, launch_id: &str) -> AppResult<bool> {
        let mut state = self.state()?;
        state.queued_at.remove(launch_id);
        Ok(state.active.remove(launch_id).is_some())
    }

    /// 确认已经领取并成功打开的请求；重复 ACK 在去重窗口内返回 `false`。
    pub fn acknowledge(&self, launch_id: &str) -> AppResult<bool> {
        let now = Instant::now();
        let mut state = self.state()?;
        prune_delivery_history(&mut state, now);
        if state.acknowledged.contains_key(launch_id) {
            return Ok(false);
        }
        if state.active.remove(launch_id).is_none() {
            return Err(AppError::InvalidInput(format!(
                "外部 SSH 启动请求尚未被领取: request_hash={}",
                crate::services::external_launch::redaction::opaque_id_hash(launch_id)
            )));
        }
        state.queued_at.remove(launch_id);
        state.acknowledged.insert(
            launch_id.to_owned(),
            now.checked_add(EXTERNAL_LAUNCH_DEDUP_TTL).unwrap_or(now),
        );
        prune_delivery_history(&mut state, now);
        Ok(true)
    }

    /// 取消 pending 或 claimed 请求，重复取消保持幂等。
    pub fn cancel(&self, launch_id: &str) -> AppResult<bool> {
        let mut state = self.state()?;
        let pending_removed = state
            .pending
            .iter()
            .position(|request| request.id == launch_id)
            .and_then(|index| state.pending.remove(index))
            .is_some();
        let active_removed = state.active.remove(launch_id).is_some();
        state.queued_at.remove(launch_id);
        if pending_removed || active_removed {
            let mut health = self.health()?;
            health.snapshot.cancel_count = health.snapshot.cancel_count.saturating_add(1);
        }
        Ok(pending_removed || active_removed)
    }

    pub fn snapshot(&self) -> AppResult<ExternalLaunchIntakeSnapshot> {
        let (
            pending_count,
            pending_launch_ids,
            claimed_count,
            mut claimed_launch_ids,
            accepted_count,
            rejected_count,
            noop_count,
            last_rejection,
            oldest_launch_age_ms,
        ) = {
            let state = self.state()?;
            (
                state.pending.len(),
                state
                    .pending
                    .iter()
                    .map(|request| request.id.clone())
                    .collect(),
                state.active.len(),
                state.active.keys().cloned().collect::<Vec<_>>(),
                state.accepted_count,
                state.rejected_count,
                state.noop_count,
                state.last_rejection.clone(),
                state
                    .queued_at
                    .values()
                    .map(|queued_at| duration_ms(queued_at.elapsed()))
                    .max()
                    .unwrap_or(0),
            )
        };
        claimed_launch_ids.sort();
        let mut health = self.health()?.snapshot.clone();
        health.oldest_launch_age_ms = oldest_launch_age_ms;
        Ok(ExternalLaunchIntakeSnapshot {
            pending_count,
            pending_launch_ids,
            claimed_count,
            claimed_launch_ids,
            accepted_count,
            rejected_count,
            noop_count,
            last_rejection,
            policy: self.policy_snapshot()?,
            health,
        })
    }
}
