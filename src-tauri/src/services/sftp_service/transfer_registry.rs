//! SFTP transfer registry facade methods.
//!
//! @author kongweiguang

use super::*;

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
        let mut summaries = self
            .transfers()?
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
    #[cfg(not(test))]
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
        let mut summaries = transfers
            .values()
            .filter(|task| transfer_matches_scope(&task.summary, request.view_scope.as_deref()))
            .map(|task| task.summary.clone())
            .collect::<Vec<_>>();
        summaries.sort_by_key(|summary| summary.created_at);
        Ok(summaries)
    }
}

fn transfer_matches_scope(summary: &SftpTransferSummary, view_scope: Option<&str>) -> bool {
    view_scope
        .map(|scope| summary.view_scope.as_deref() == Some(scope))
        .unwrap_or(true)
}
