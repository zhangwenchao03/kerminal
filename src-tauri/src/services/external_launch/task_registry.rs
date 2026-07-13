//! External SSH 创建任务的排队、取消、deadline 与晚结果清理状态。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};

/// External SSH 创建任务的运行阶段。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalLaunchTaskStage {
    Queued,
    InFlight,
    Cancelling,
    Connected,
}

/// 取消结果；completed session 由 command 层立即关闭。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchTaskCancellation {
    pub found: bool,
    pub session_id: Option<String>,
}

/// 不包含 launch/session id 的任务健康快照。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExternalLaunchTaskSnapshot {
    pub queued_count: usize,
    pub in_flight_count: usize,
    pub connected_count: usize,
    pub cancelled_count: u64,
    pub deadline_count: u64,
    pub late_cleanup_count: u64,
    pub completed_count: u64,
    pub oldest_task_age_ms: u64,
    pub last_connect_latency_ms: Option<u64>,
}

/// App 实例级 external SSH 创建任务注册表。
#[derive(Clone, Default)]
pub struct ExternalLaunchTaskRegistry {
    inner: Arc<ExternalLaunchTaskRegistryInner>,
}

impl fmt::Debug for ExternalLaunchTaskRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchTaskRegistry")
            .field("snapshot", &self.snapshot().ok())
            .finish()
    }
}

#[derive(Default)]
struct ExternalLaunchTaskRegistryInner {
    state: Mutex<ExternalLaunchTaskRegistryState>,
}

#[derive(Default)]
struct ExternalLaunchTaskRegistryState {
    entries: HashMap<String, ExternalLaunchTaskEntry>,
    cancelled_count: u64,
    completed_count: u64,
    deadline_count: u64,
    last_connect_latency_ms: Option<u64>,
    late_cleanup_count: u64,
}

struct ExternalLaunchTaskEntry {
    created_at: Instant,
    session_id: Option<String>,
    stage: ExternalLaunchTaskStage,
    token: CancellationToken,
}

impl ExternalLaunchTaskRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// 注册唯一 launch task；重复 create 必须先取消旧任务，避免两个 worker 竞争同一 target。
    pub fn register(&self, launch_id: &str) -> AppResult<CancellationToken> {
        let mut state = self.state()?;
        if state.entries.contains_key(launch_id) {
            return Err(AppError::InvalidInput(
                "external SSH launch already has an active create task".to_owned(),
            ));
        }
        let token = CancellationToken::new();
        state.entries.insert(
            launch_id.to_owned(),
            ExternalLaunchTaskEntry {
                created_at: Instant::now(),
                session_id: None,
                stage: ExternalLaunchTaskStage::Queued,
                token: token.clone(),
            },
        );
        Ok(token)
    }

    pub fn mark_in_flight(&self, launch_id: &str) -> AppResult<bool> {
        let mut state = self.state()?;
        let Some(entry) = state.entries.get_mut(launch_id) else {
            return Ok(false);
        };
        if entry.token.is_cancelled() {
            return Ok(false);
        }
        entry.stage = ExternalLaunchTaskStage::InFlight;
        Ok(true)
    }

    /// 成功 session 只在 token 仍有效时登记；false 表示调用方必须立即关闭晚到 session。
    pub fn complete(&self, launch_id: &str, session_id: &str) -> AppResult<bool> {
        let mut state = self.state()?;
        let Some(entry) = state.entries.get_mut(launch_id) else {
            return Ok(false);
        };
        if entry.token.is_cancelled() {
            return Ok(false);
        }
        let latency = entry.created_at.elapsed();
        entry.stage = ExternalLaunchTaskStage::Connected;
        entry.session_id = Some(session_id.to_owned());
        state.completed_count = state.completed_count.saturating_add(1);
        state.last_connect_latency_ms = Some(duration_ms(latency));
        Ok(true)
    }

    /// 失败任务无需保留；connected task 由 explicit close/cancel 移除。
    pub fn finish_failed(&self, launch_id: &str) -> AppResult<bool> {
        Ok(self.state()?.entries.remove(launch_id).is_some())
    }

    pub fn connected_session_id(&self, launch_id: &str) -> AppResult<Option<String>> {
        Ok(self
            .state()?
            .entries
            .get(launch_id)
            .filter(|entry| entry.stage == ExternalLaunchTaskStage::Connected)
            .and_then(|entry| entry.session_id.clone()))
    }

    /// terminal reconnect 关闭旧 session 后只释放连接绑定，保留 materialized target 与凭据。
    pub fn release_connected_session(&self, launch_id: &str, session_id: &str) -> AppResult<bool> {
        let mut state = self.state()?;
        let matches = state.entries.get(launch_id).is_some_and(|entry| {
            entry.stage == ExternalLaunchTaskStage::Connected
                && entry.session_id.as_deref() == Some(session_id)
        });
        if matches {
            if let Some(entry) = state.entries.remove(launch_id) {
                entry.token.cancel();
            }
        }
        Ok(matches)
    }

    pub fn cancel(&self, launch_id: &str) -> AppResult<ExternalLaunchTaskCancellation> {
        let mut state = self.state()?;
        let Some(stage) = state.entries.get(launch_id).map(|entry| entry.stage) else {
            return Ok(ExternalLaunchTaskCancellation {
                found: false,
                session_id: None,
            });
        };
        if stage == ExternalLaunchTaskStage::Connected {
            let mut entry = state
                .entries
                .remove(launch_id)
                .expect("connected task entry disappeared while locked");
            entry.token.cancel();
            state.cancelled_count = state.cancelled_count.saturating_add(1);
            return Ok(ExternalLaunchTaskCancellation {
                found: true,
                session_id: entry.session_id.take(),
            });
        }
        let entry = state
            .entries
            .get_mut(launch_id)
            .expect("task entry disappeared while locked");
        let first_cancel = !entry.token.is_cancelled();
        entry.token.cancel();
        entry.stage = ExternalLaunchTaskStage::Cancelling;
        if first_cancel {
            state.cancelled_count = state.cancelled_count.saturating_add(1);
        }
        Ok(ExternalLaunchTaskCancellation {
            found: true,
            session_id: None,
        })
    }

    pub fn mark_deadline(&self, launch_id: &str) -> AppResult<()> {
        let mut state = self.state()?;
        if !state.entries.contains_key(launch_id) {
            return Ok(());
        }
        if let Some(entry) = state.entries.get_mut(launch_id) {
            entry.token.cancel();
            entry.stage = ExternalLaunchTaskStage::Cancelling;
        }
        state.deadline_count = state.deadline_count.saturating_add(1);
        Ok(())
    }

    pub fn record_late_cleanup(&self) -> AppResult<()> {
        let mut state = self.state()?;
        state.late_cleanup_count = state.late_cleanup_count.saturating_add(1);
        Ok(())
    }

    pub fn snapshot(&self) -> AppResult<ExternalLaunchTaskSnapshot> {
        let state = self.state()?;
        let now = Instant::now();
        let mut snapshot = ExternalLaunchTaskSnapshot {
            cancelled_count: state.cancelled_count,
            deadline_count: state.deadline_count,
            late_cleanup_count: state.late_cleanup_count,
            completed_count: state.completed_count,
            last_connect_latency_ms: state.last_connect_latency_ms,
            ..ExternalLaunchTaskSnapshot::default()
        };
        for entry in state.entries.values() {
            match entry.stage {
                ExternalLaunchTaskStage::Queued => snapshot.queued_count += 1,
                ExternalLaunchTaskStage::InFlight | ExternalLaunchTaskStage::Cancelling => {
                    snapshot.in_flight_count += 1
                }
                ExternalLaunchTaskStage::Connected => snapshot.connected_count += 1,
            }
            snapshot.oldest_task_age_ms = snapshot
                .oldest_task_age_ms
                .max(duration_ms(now.saturating_duration_since(entry.created_at)));
        }
        Ok(snapshot)
    }

    fn state(&self) -> AppResult<MutexGuard<'_, ExternalLaunchTaskRegistryState>> {
        self.inner
            .state
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external launch task registry"))
    }
}

fn duration_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}
