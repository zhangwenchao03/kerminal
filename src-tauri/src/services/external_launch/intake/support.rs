//! External launch intake 的策略、worker、日志和租约辅助函数。
//!
//! @author kongweiguang

use super::*;

pub(super) struct ExternalLaunchArgSummary {
    pub(super) arg_count: usize,
    pub(super) raw_hash: String,
    pub(super) cwd_present: bool,
}

impl ExternalLaunchArgSummary {
    pub(super) fn new(argv: &[String], cwd: Option<&str>) -> Self {
        Self {
            arg_count: argv.len(),
            raw_hash: raw_hash(argv),
            cwd_present: cwd.is_some_and(|value| !value.trim().is_empty()),
        }
    }
}

pub(super) fn policy_rejection_message(
    policy: &ExternalLaunchPolicy,
    source_tool: ExternalLaunchSourceTool,
) -> Option<&'static str> {
    if !policy.enabled {
        return Some("external SSH launch disabled by policy");
    }
    if source_tool != ExternalLaunchSourceTool::KerminalNative && !policy.accept_vendor_args {
        return Some("external SSH vendor argument launch disabled by policy");
    }
    if policy.disabled_tools.contains(&source_tool) {
        return Some("external SSH launch tool disabled by policy");
    }
    None
}

pub(super) fn apply_policy_options(
    policy: &ExternalLaunchPolicy,
    request: &mut ExternalSshLaunchRequest,
) {
    if policy.auto_open_sftp {
        request.options.open_sftp = true;
    }
}

/// 限制同时运行的 parser/file worker；timeout 后晚结果会被丢弃并清零。
pub(super) async fn parse_request_bounded(
    input: ExternalLaunchParseInput,
) -> AppResult<ExternalSshLaunchRequest> {
    let permit = tokio::time::timeout(
        EXTERNAL_LAUNCH_WORKER_QUEUE_TIMEOUT,
        EXTERNAL_LAUNCH_WORKERS.acquire(),
    )
    .await
    .map_err(|_| {
        AppError::InvalidInput("external launch worker queue is busy; retry later".to_owned())
    })?
    .map_err(|_| AppError::InvalidInput("external launch worker is shutting down".to_owned()))?;
    let worker = tokio::task::spawn_blocking(move || {
        // timeout 只放弃调用方等待；permit 跟随实际 blocking worker，防止晚任务绕过容量上限。
        let _permit = permit;
        let request = ExternalLaunchParserRegistry::new().parse(&input)?;
        prepare_request_password_file(request)
    });
    tokio::time::timeout(EXTERNAL_LAUNCH_WORKER_TIMEOUT, worker)
        .await
        .map_err(|_| AppError::InvalidInput("external launch parser timed out".to_owned()))?
        .map_err(|error| {
            AppError::InvalidInput(format!("external launch parser worker failed: {error}"))
        })?
}

pub(super) fn log_external_launch_args(
    entrypoint: ExternalLaunchEntrypoint,
    channel: &str,
    source_tool: Option<ExternalLaunchSourceTool>,
    summary: &ExternalLaunchArgSummary,
) {
    tauri_plugin_log::log::info!(
        target: "external_launch.intake",
        "received channel={channel} entrypoint={entrypoint:?} source_tool={source_tool:?} arg_count={} raw_hash={} cwd_present={}",
        summary.arg_count,
        summary.raw_hash,
        summary.cwd_present
    );
}

pub(super) fn log_external_launch_queued(
    entrypoint: ExternalLaunchEntrypoint,
    request: &ExternalSshLaunchRequest,
) {
    let request_hash = super::super::redaction::opaque_id_hash(&request.id);
    tauri_plugin_log::log::info!(
        target: "external_launch.intake",
        "queued request_hash={} entrypoint={entrypoint:?} source_tool={:?} parser={} route_hops={} remote_command_present={} raw_hash={}",
        request_hash,
        request.source.tool,
        request.diagnostics.parser,
        request.target.route.len(),
        request.options.remote_command.is_some(),
        request.diagnostics.raw_hash
    );
}

pub(super) fn sanitize_error_message(error: AppError) -> String {
    match error {
        AppError::InvalidInput(_) => "external SSH launch rejected: invalid arguments".to_owned(),
        _ => "external SSH launch rejected".to_owned(),
    }
}

/// 将过期 claim 按原领取顺序放回队首，确保 WebView 重载后不会永久丢失请求。
pub(super) fn requeue_expired_claims(state: &mut ExternalLaunchIntakeState, now: Instant) -> usize {
    let expired_ids = state
        .active
        .iter()
        .filter_map(|(launch_id, claim)| {
            (claim.lease_expires_at <= now).then_some(launch_id.clone())
        })
        .collect::<Vec<_>>();
    let mut expired = expired_ids
        .into_iter()
        .filter_map(|launch_id| state.active.remove(&launch_id))
        .collect::<Vec<_>>();
    expired.sort_by_key(|claim| claim.sequence);
    let expired_count = expired.len();
    for claim in expired.into_iter().rev() {
        state.pending.push_front(claim.request);
    }
    expired_count
}

/// 清理只用于幂等响应的短期历史，不保留启动参数或 secret。
pub(super) fn prune_delivery_history(state: &mut ExternalLaunchIntakeState, now: Instant) {
    state.acknowledged.retain(|_, expires_at| *expires_at > now);
    while state.acknowledged.len() > EXTERNAL_LAUNCH_DELIVERY_HISTORY_CAPACITY {
        let Some(oldest) = state
            .acknowledged
            .iter()
            .min_by_key(|(_, expires_at)| **expires_at)
            .map(|(id, _)| id.clone())
        else {
            break;
        };
        state.acknowledged.remove(&oldest);
    }
}

fn raw_hash(argv: &[String]) -> String {
    let mut hasher = Sha256::new();
    for arg in argv {
        hash_field(&mut hasher, arg.as_bytes());
    }
    hex_digest(hasher.finalize())
}

fn hash_field(hasher: &mut Sha256, value: &[u8]) {
    hasher.update(u64::try_from(value.len()).unwrap_or(u64::MAX).to_be_bytes());
    hasher.update(value);
}

fn hex_digest(digest: impl AsRef<[u8]>) -> String {
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(super) fn duration_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}
