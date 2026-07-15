//! External launch intake 的实例级脱敏健康计数。
//!
//! @author kongweiguang

/// 不包含 host、username、path、command、secret 或 launch id 的运行健康快照。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExternalLaunchRuntimeHealthSnapshot {
    pub backpressure_count: u64,
    pub expiry_count: u64,
    pub cancel_count: u64,
    pub oldest_launch_age_ms: u64,
    pub last_intake_latency_ms: Option<u64>,
}

#[derive(Debug, Default)]
pub(super) struct ExternalLaunchRuntimeHealth {
    pub(super) snapshot: ExternalLaunchRuntimeHealthSnapshot,
}

impl super::ExternalLaunchIntake {
    pub(super) fn record_intake_latency(&self, started_at: std::time::Instant) {
        if let Ok(mut health) = self.health() {
            health.snapshot.last_intake_latency_ms =
                Some(super::support::duration_ms(started_at.elapsed()));
        }
    }

    pub(super) fn record_expiry(&self, count: usize) {
        if count == 0 {
            return;
        }
        if let Ok(mut health) = self.health() {
            health.snapshot.expiry_count = health
                .snapshot
                .expiry_count
                .saturating_add(u64::try_from(count).unwrap_or(u64::MAX));
        }
    }
}
