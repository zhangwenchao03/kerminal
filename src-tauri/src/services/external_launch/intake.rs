//! External launch intake queue and startup bridge model.
//!
//! @author kongweiguang

use std::{
    collections::{HashMap, VecDeque},
    fmt,
    sync::{Arc, LazyLock, Mutex, MutexGuard},
    time::{Duration, Instant},
};

use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;

use super::{
    bridge::{ExternalLaunchBridgeEnvelope, EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION},
    classifier::infer_source_tool_from_args,
    model::{
        ExternalLaunchEntrypoint, ExternalLaunchParseInput, ExternalLaunchSourceTool,
        ExternalSshLaunchRequest,
    },
    parser::ExternalLaunchParserRegistry,
    secret::{prepare_request_password_file, ExternalLaunchSecretBroker},
};
use crate::error::{AppError, AppResult};

mod health;
mod support;
mod types;
pub use health::ExternalLaunchRuntimeHealthSnapshot;
use support::*;
pub use types::*;

pub const EXTERNAL_SSH_LAUNCH_EVENT: &str = "kerminal-external-ssh-launch";
pub const EXTERNAL_LAUNCH_PENDING_CAPACITY: usize = 128;
pub const EXTERNAL_LAUNCH_CLAIM_LEASE: Duration = Duration::from_secs(30);
pub const EXTERNAL_LAUNCH_DEDUP_TTL: Duration = Duration::from_secs(10 * 60);
const EXTERNAL_LAUNCH_DELIVERY_HISTORY_CAPACITY: usize = 512;
const EXTERNAL_LAUNCH_WORKER_TIMEOUT: Duration = Duration::from_secs(5);
const EXTERNAL_LAUNCH_WORKER_QUEUE_TIMEOUT: Duration = Duration::from_millis(500);
const EXTERNAL_LAUNCH_WORKER_CAPACITY: usize = 4;
static EXTERNAL_LAUNCH_WORKERS: LazyLock<Semaphore> =
    LazyLock::new(|| Semaphore::new(EXTERNAL_LAUNCH_WORKER_CAPACITY));

/// Accepts launch argv from cold start, single-instance, shim, or future protocol entrypoints.
#[derive(Clone)]
pub struct ExternalLaunchIntake {
    inner: Arc<ExternalLaunchIntakeInner>,
}

struct ExternalLaunchIntakeInner {
    health: Mutex<health::ExternalLaunchRuntimeHealth>,
    parser: ExternalLaunchParserRegistry,
    policy: Mutex<ExternalLaunchPolicy>,
    secrets: ExternalLaunchSecretBroker,
    state: Mutex<ExternalLaunchIntakeState>,
}

#[derive(Debug, Default)]
struct ExternalLaunchIntakeState {
    pending: VecDeque<ExternalSshLaunchRequest>,
    active: HashMap<String, ExternalLaunchClaim>,
    acknowledged: HashMap<String, Instant>,
    request_dedup: HashMap<String, ExternalLaunchDedupRecord>,
    queued_at: HashMap<String, Instant>,
    claim_sequence: u64,
    accepted_count: u64,
    rejected_count: u64,
    noop_count: u64,
    last_rejection: Option<ExternalLaunchRejected>,
}

#[derive(Debug)]
struct ExternalLaunchClaim {
    request: ExternalSshLaunchRequest,
    lease_expires_at: Instant,
    sequence: u64,
}

#[derive(Debug, Clone)]
struct ExternalLaunchDedupRecord {
    queued: ExternalLaunchQueued,
    raw_hash: String,
    expires_at: Instant,
    last_seen_at: Instant,
}

impl Default for ExternalLaunchIntake {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for ExternalLaunchIntake {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchIntake")
            .field("snapshot", &self.snapshot().ok())
            .finish()
    }
}

impl ExternalLaunchIntake {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ExternalLaunchIntakeInner {
                health: Mutex::new(health::ExternalLaunchRuntimeHealth::default()),
                parser: ExternalLaunchParserRegistry::new(),
                policy: Mutex::new(ExternalLaunchPolicy::default()),
                secrets: ExternalLaunchSecretBroker::new(),
                state: Mutex::new(ExternalLaunchIntakeState::default()),
            }),
        }
    }

    pub fn with_policy(policy: ExternalLaunchPolicy) -> Self {
        Self {
            inner: Arc::new(ExternalLaunchIntakeInner {
                health: Mutex::new(health::ExternalLaunchRuntimeHealth::default()),
                parser: ExternalLaunchParserRegistry::new(),
                policy: Mutex::new(policy),
                secrets: ExternalLaunchSecretBroker::new(),
                state: Mutex::new(ExternalLaunchIntakeState::default()),
            }),
        }
    }

    pub fn secret_broker(&self) -> &ExternalLaunchSecretBroker {
        &self.inner.secrets
    }

    pub fn configure_policy(&self, policy: ExternalLaunchPolicy) -> AppResult<()> {
        *self.policy()? = policy;
        Ok(())
    }

    pub fn policy_snapshot(&self) -> AppResult<ExternalLaunchPolicy> {
        Ok(self.policy()?.clone())
    }

    pub fn accept_args(
        &self,
        argv: Vec<String>,
        cwd: Option<String>,
        entrypoint: ExternalLaunchEntrypoint,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        self.accept_args_with_parent_command_line(argv, cwd, entrypoint, None)
    }

    pub fn accept_args_with_parent_command_line(
        &self,
        argv: Vec<String>,
        cwd: Option<String>,
        entrypoint: ExternalLaunchEntrypoint,
        parent_command_line: Option<String>,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        let summary = ExternalLaunchArgSummary::new(&argv, cwd.as_deref());
        log_external_launch_args(entrypoint, "direct", None, &summary);
        let Some(source_tool) = infer_source_tool_from_args(&argv) else {
            let outcome = ExternalLaunchAcceptOutcome::Noop(ExternalLaunchNoop {
                entrypoint,
                reason: "no external SSH launch arguments detected".to_owned(),
                arg_count: argv.len(),
                cwd_present: cwd.as_ref().is_some_and(|value| !value.trim().is_empty()),
            });
            self.state()?.noop_count += 1;
            tauri_plugin_log::log::info!(
                target: "external_launch.intake",
                "noop entrypoint={entrypoint:?} arg_count={} raw_hash={} cwd_present={}",
                summary.arg_count,
                summary.raw_hash,
                summary.cwd_present
            );
            return Ok(outcome);
        };
        let policy = self.policy_snapshot()?;
        if let Some(message) = policy_rejection_message(&policy, entrypoint, source_tool) {
            let rejected =
                self.record_policy_rejection(entrypoint, Some(source_tool), message, summary)?;
            return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
        }

        let input = ExternalLaunchParseInput::from_args(
            entrypoint,
            Some(source_tool),
            Some(source_tool.as_str().to_owned()),
            argv,
        );
        let input = ExternalLaunchParseInput::from_args_with_parent_command_line(
            input.entrypoint,
            input.source_tool,
            input.persona,
            input.argv,
            parent_command_line,
        );
        match self.inner.parser.parse(&input) {
            Ok(mut request) => {
                apply_policy_options(&policy, &mut request);
                let request = match self.inner.secrets.protect_request(request) {
                    Ok(request) => request,
                    Err(error) => {
                        let rejected =
                            self.record_rejection(entrypoint, Some(source_tool), error, summary)?;
                        return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
                    }
                };
                log_external_launch_queued(entrypoint, &request);
                self.enqueue_request(request, entrypoint, None, summary)
            }
            Err(error) => {
                tauri_plugin_log::log::warn!(
                    target: "external_launch.intake",
                    "rejected entrypoint={entrypoint:?} source_tool={source_tool:?} arg_count={} raw_hash={} cwd_present={} reason=parse",
                    summary.arg_count,
                    summary.raw_hash,
                    summary.cwd_present
                );
                let rejected =
                    self.record_rejection(entrypoint, Some(source_tool), error, summary)?;
                Ok(ExternalLaunchAcceptOutcome::Rejected(rejected))
            }
        }
    }

    /// 在有界 blocking worker 中完成父进程发现、parser 和文件读取，避免阻塞窗口线程。
    pub async fn accept_args_bounded(
        &self,
        argv: Vec<String>,
        cwd: Option<String>,
        entrypoint: ExternalLaunchEntrypoint,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        let parent_command_line =
            super::bridge::direct_parent_command_line_for_args_bounded(argv.clone()).await;
        self.accept_args_with_parent_command_line_bounded(
            argv,
            cwd,
            entrypoint,
            parent_command_line,
        )
        .await
    }

    /// 接收调用方已捕获的父进程命令行，其余潜在阻塞工作仍在有界 worker 中执行。
    pub async fn accept_args_with_parent_command_line_bounded(
        &self,
        argv: Vec<String>,
        cwd: Option<String>,
        entrypoint: ExternalLaunchEntrypoint,
        parent_command_line: Option<String>,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        let intake_started_at = Instant::now();
        let summary = ExternalLaunchArgSummary::new(&argv, cwd.as_deref());
        log_external_launch_args(entrypoint, "direct", None, &summary);
        let Some(source_tool) = infer_source_tool_from_args(&argv) else {
            let outcome = ExternalLaunchAcceptOutcome::Noop(ExternalLaunchNoop {
                entrypoint,
                reason: "no external SSH launch arguments detected".to_owned(),
                arg_count: argv.len(),
                cwd_present: cwd.as_ref().is_some_and(|value| !value.trim().is_empty()),
            });
            self.state()?.noop_count += 1;
            return Ok(outcome);
        };
        let policy = self.policy_snapshot()?;
        if let Some(message) = policy_rejection_message(&policy, entrypoint, source_tool) {
            let rejected =
                self.record_policy_rejection(entrypoint, Some(source_tool), message, summary)?;
            return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
        }
        let input = ExternalLaunchParseInput::from_args_with_parent_command_line(
            entrypoint,
            Some(source_tool),
            Some(source_tool.as_str().to_owned()),
            argv,
            parent_command_line,
        );
        let request = match parse_request_bounded(input).await {
            Ok(request) => request,
            Err(error) => {
                let rejected =
                    self.record_rejection(entrypoint, Some(source_tool), error, summary)?;
                return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
            }
        };
        let outcome = self.finish_prepared_request(request, policy, entrypoint, None, summary);
        self.record_intake_latency(intake_started_at);
        outcome
    }

    pub fn accept_bridge_envelope(
        &self,
        envelope: ExternalLaunchBridgeEnvelope,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        let request_id = envelope.request_id.trim().to_owned();
        let summary = ExternalLaunchArgSummary::for_bridge(&envelope);
        log_external_launch_args(
            ExternalLaunchEntrypoint::ShimIpc,
            "shim",
            Some(envelope.persona),
            &summary,
        );
        let policy = self.policy_snapshot()?;
        if let Some(message) =
            policy_rejection_message(&policy, ExternalLaunchEntrypoint::ShimIpc, envelope.persona)
        {
            let rejected = self.record_policy_rejection(
                ExternalLaunchEntrypoint::ShimIpc,
                Some(envelope.persona),
                message,
                summary,
            )?;
            return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
        }
        if envelope.schema_version != EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION {
            let rejected = self.record_rejection(
                ExternalLaunchEntrypoint::ShimIpc,
                Some(envelope.persona),
                AppError::InvalidInput(
                    "external launch bridge envelope schema version is unsupported".to_owned(),
                ),
                summary,
            )?;
            return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
        }
        if let Some(queued) =
            self.duplicate_bridge_request(&request_id, &summary.raw_hash, Instant::now())?
        {
            return Ok(ExternalLaunchAcceptOutcome::Queued(queued));
        }

        let source_tool = envelope.persona;
        match self.inner.parser.parse(&envelope.parse_input()) {
            Ok(mut request) => {
                apply_policy_options(&policy, &mut request);
                let request = match self.inner.secrets.protect_request(request) {
                    Ok(request) => request,
                    Err(error) => {
                        let rejected = self.record_rejection(
                            ExternalLaunchEntrypoint::ShimIpc,
                            Some(source_tool),
                            error,
                            summary,
                        )?;
                        return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
                    }
                };
                log_external_launch_queued(ExternalLaunchEntrypoint::ShimIpc, &request);
                self.enqueue_request(
                    request,
                    ExternalLaunchEntrypoint::ShimIpc,
                    Some(request_id),
                    summary,
                )
            }
            Err(error) => {
                tauri_plugin_log::log::warn!(
                    target: "external_launch.intake",
                    "rejected entrypoint=ShimIpc source_tool={source_tool:?} arg_count={} raw_hash={} cwd_present={} reason=parse",
                    summary.arg_count,
                    summary.raw_hash,
                    summary.cwd_present
                );
                let rejected = self.record_rejection(
                    ExternalLaunchEntrypoint::ShimIpc,
                    Some(source_tool),
                    error,
                    summary,
                )?;
                Ok(ExternalLaunchAcceptOutcome::Rejected(rejected))
            }
        }
    }

    /// Bridge handler 专用的异步入口，保证 session/password 文件不会阻塞 async executor。
    pub async fn accept_bridge_envelope_bounded(
        &self,
        envelope: ExternalLaunchBridgeEnvelope,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        let intake_started_at = Instant::now();
        let request_id = envelope.request_id.trim().to_owned();
        let summary = ExternalLaunchArgSummary::for_bridge(&envelope);
        log_external_launch_args(
            ExternalLaunchEntrypoint::ShimIpc,
            "shim",
            Some(envelope.persona),
            &summary,
        );
        let policy = self.policy_snapshot()?;
        if let Some(message) =
            policy_rejection_message(&policy, ExternalLaunchEntrypoint::ShimIpc, envelope.persona)
        {
            let rejected = self.record_policy_rejection(
                ExternalLaunchEntrypoint::ShimIpc,
                Some(envelope.persona),
                message,
                summary,
            )?;
            return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
        }
        if envelope.schema_version != EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION {
            let rejected = self.record_rejection(
                ExternalLaunchEntrypoint::ShimIpc,
                Some(envelope.persona),
                AppError::InvalidInput(
                    "external launch bridge envelope schema version is unsupported".to_owned(),
                ),
                summary,
            )?;
            return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
        }
        if let Some(queued) =
            self.duplicate_bridge_request(&request_id, &summary.raw_hash, Instant::now())?
        {
            return Ok(ExternalLaunchAcceptOutcome::Queued(queued));
        }
        let source_tool = envelope.persona;
        let request = match parse_request_bounded(envelope.parse_input()).await {
            Ok(request) => request,
            Err(error) => {
                let rejected = self.record_rejection(
                    ExternalLaunchEntrypoint::ShimIpc,
                    Some(source_tool),
                    error,
                    summary,
                )?;
                return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
            }
        };
        let outcome = self.finish_prepared_request(
            request,
            policy,
            ExternalLaunchEntrypoint::ShimIpc,
            Some(request_id),
            summary,
        );
        self.record_intake_latency(intake_started_at);
        outcome
    }

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
                super::redaction::opaque_id_hash(launch_id)
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

    /// 提交 worker 已准备好的请求；本阶段只执行内存策略、secret broker 与队列状态迁移。
    fn finish_prepared_request(
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

    fn duplicate_bridge_request(
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
    fn enqueue_request(
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

    fn policy(&self) -> AppResult<MutexGuard<'_, ExternalLaunchPolicy>> {
        self.inner
            .policy
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external launch policy"))
    }

    fn health(&self) -> AppResult<MutexGuard<'_, health::ExternalLaunchRuntimeHealth>> {
        self.inner
            .health
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external launch health"))
    }

    fn state(&self) -> AppResult<MutexGuard<'_, ExternalLaunchIntakeState>> {
        self.inner
            .state
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external launch intake"))
    }

    fn record_rejection(
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

    fn record_policy_rejection(
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
