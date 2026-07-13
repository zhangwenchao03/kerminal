//! External launch intake/bridge 的实例级脱敏健康计数。
//!
//! @author kongweiguang

/// 不包含 host、username、path、command、secret 或 launch id 的运行健康快照。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExternalLaunchRuntimeHealthSnapshot {
    pub bridge_listening: bool,
    pub bridge_generation_tag: Option<String>,
    pub bridge_restart_count: u64,
    pub bridge_active_clients: usize,
    pub dedup_count: u64,
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

impl ExternalLaunchRuntimeHealth {
    pub(super) fn set_bridge_listening(&mut self, listening: bool, generation: Option<&str>) {
        self.snapshot.bridge_listening = listening;
        if let Some(generation) = generation {
            self.snapshot.bridge_generation_tag = Some(generation.chars().take(12).collect());
        }
    }
}

impl super::ExternalLaunchIntake {
    pub(crate) fn set_bridge_listening(
        &self,
        listening: bool,
        generation: Option<&str>,
    ) -> crate::error::AppResult<()> {
        self.health()?.set_bridge_listening(listening, generation);
        Ok(())
    }

    pub(crate) fn record_bridge_restart(&self) -> crate::error::AppResult<()> {
        let mut health = self.health()?;
        health.snapshot.bridge_restart_count =
            health.snapshot.bridge_restart_count.saturating_add(1);
        Ok(())
    }

    pub(crate) fn bridge_client_started(&self) -> crate::error::AppResult<()> {
        let mut health = self.health()?;
        health.snapshot.bridge_active_clients =
            health.snapshot.bridge_active_clients.saturating_add(1);
        Ok(())
    }

    pub(crate) fn bridge_client_finished(&self) -> crate::error::AppResult<()> {
        let mut health = self.health()?;
        health.snapshot.bridge_active_clients =
            health.snapshot.bridge_active_clients.saturating_sub(1);
        Ok(())
    }

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
