//! SFTP transfer registry facade methods.
//!
//! @author kongweiguang

use super::*;

pub(super) const RECENT_COMPLETED_TRANSFER_LIMIT: usize = 200;
pub(super) const RECENT_COMPLETED_TRANSFER_SECONDS: u64 = 24 * 60 * 60;

impl SftpService {
    /// 列出传输任务。
    pub fn list_transfers(&self) -> AppResult<Vec<SftpTransferSummary>> {
        self.list_transfers_for_scope(SftpTransferScopeRequest::default())
    }

    /// 按前端视图 scope 列出传输任务。
    pub fn list_transfers_for_scope(
        &self,
        request: SftpTransferScopeRequest,
    ) -> AppResult<Vec<SftpTransferSummary>> {
        let mut transfers = self.transfers()?;
        prune_completed_transfers(&mut transfers, unix_timestamp());
        let mut summaries = transfers
            .values()
            .filter(|task| transfer_matches_scope(&task.summary, request.view_scope.as_deref()))
            .map(|task| task.summary.clone())
            .collect::<Vec<_>>();
        summaries.sort_by_key(|summary| summary.created_at);
        Ok(summaries)
    }

    /// 取消传输任务。
    pub fn cancel_transfer(
        &self,
        request: SftpTransferCancelRequest,
    ) -> AppResult<SftpTransferSummary> {
        self.cancel_transfer_with_events(request, None)
    }

    /// 取消传输任务，并向当前窗口推送状态更新。
    pub fn cancel_transfer_for_window(
        &self,
        request: SftpTransferCancelRequest,
        window: Window,
    ) -> AppResult<SftpTransferSummary> {
        self.cancel_transfer_with_events(request, Some(TransferEventEmitter::new(window)))
    }

    fn cancel_transfer_with_events(
        &self,
        request: SftpTransferCancelRequest,
        event_emitter: Option<TransferEventEmitter>,
    ) -> AppResult<SftpTransferSummary> {
        let mut transfers = self.transfers()?;
        let Some(task) = transfers.get_mut(&request.transfer_id) else {
            return Err(AppError::NotFound(format!(
                "SFTP 传输任务不存在: {}",
                request.transfer_id
            )));
        };
        if !transfer_matches_scope(&task.summary, request.view_scope.as_deref()) {
            return Err(AppError::NotFound(format!(
                "SFTP 传输任务不属于当前视图: {}",
                request.transfer_id
            )));
        }

        task.cancel_requested.store(true, Ordering::SeqCst);
        task.summary.cancel_requested = true;
        task.summary.updated_at = unix_timestamp();
        if task.summary.status == SftpTransferStatus::Queued {
            task.summary.status = SftpTransferStatus::Canceled;
        }
        let summary = task.summary.clone();
        if is_completed_transfer_status(summary.status) {
            prune_completed_transfers(&mut transfers, unix_timestamp());
        }
        drop(transfers);
        if let Some(emitter) = &event_emitter {
            emitter.emit(&summary, true);
        }
        Ok(summary)
    }

    /// 清理已经完成的传输任务。
    pub fn clear_completed_transfers(&self) -> AppResult<Vec<SftpTransferSummary>> {
        self.clear_completed_transfers_for_scope(SftpTransferScopeRequest::default())
    }

    /// 按前端视图 scope 清理已经完成的传输任务。
    pub fn clear_completed_transfers_for_scope(
        &self,
        request: SftpTransferScopeRequest,
    ) -> AppResult<Vec<SftpTransferSummary>> {
        let mut transfers = self.transfers()?;
        transfers.retain(|_, task| {
            !transfer_matches_scope(&task.summary, request.view_scope.as_deref())
                || !matches!(
                    task.summary.status,
                    SftpTransferStatus::Succeeded
                        | SftpTransferStatus::Failed
                        | SftpTransferStatus::Canceled
                )
        });
        prune_completed_transfers(&mut transfers, unix_timestamp());
        let mut summaries = transfers
            .values()
            .filter(|task| transfer_matches_scope(&task.summary, request.view_scope.as_deref()))
            .map(|task| task.summary.clone())
            .collect::<Vec<_>>();
        summaries.sort_by_key(|summary| summary.created_at);
        Ok(summaries)
    }
}

pub(super) fn transfer_matches_scope(
    summary: &SftpTransferSummary,
    view_scope: Option<&str>,
) -> bool {
    view_scope
        .map(|scope| summary.view_scope.as_deref() == Some(scope))
        .unwrap_or(true)
}

pub(super) fn prune_completed_transfers(
    transfers: &mut HashMap<String, TransferTask>,
    now: u64,
) -> usize {
    let prune_ids = completed_transfer_prune_ids(transfers.values().map(|task| &task.summary), now);
    let pruned = prune_ids.len();
    for id in prune_ids {
        transfers.remove(&id);
    }
    pruned
}

pub(super) fn completed_transfer_prune_ids<'a>(
    summaries: impl IntoIterator<Item = &'a SftpTransferSummary>,
    now: u64,
) -> HashSet<String> {
    let min_updated_at = now.saturating_sub(RECENT_COMPLETED_TRANSFER_SECONDS);
    let mut prune_ids = HashSet::new();
    let mut recent_completed = Vec::new();

    for summary in summaries {
        if !is_completed_transfer_status(summary.status) {
            continue;
        }
        if summary.updated_at < min_updated_at {
            prune_ids.insert(summary.id.clone());
            continue;
        }
        recent_completed.push((summary.updated_at, summary.created_at, summary.id.clone()));
    }

    if recent_completed.len() > RECENT_COMPLETED_TRANSFER_LIMIT {
        recent_completed.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.cmp(&right.1))
                .then_with(|| left.2.cmp(&right.2))
        });
        let excess_completed = recent_completed.len() - RECENT_COMPLETED_TRANSFER_LIMIT;
        for (_, _, id) in recent_completed.into_iter().take(excess_completed) {
            prune_ids.insert(id);
        }
    }

    prune_ids
}

pub(super) fn is_completed_transfer_status(status: SftpTransferStatus) -> bool {
    matches!(
        status,
        SftpTransferStatus::Succeeded | SftpTransferStatus::Failed | SftpTransferStatus::Canceled
    )
}
