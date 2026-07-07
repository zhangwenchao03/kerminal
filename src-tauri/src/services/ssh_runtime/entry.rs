//! Managed SSH session entry internals.
//!
//! @author kongweiguang

use std::{collections::BTreeMap, sync::Arc};

use super::{
    ManagedSshSessionSnapshot, ManagedSshSessionState, SshChannelKind, SshRuntimeConnection,
    SshSessionKey,
};

pub(super) struct ManagedSshSessionEntry {
    pub(super) active_channels: u64,
    pub(super) channel_counts: BTreeMap<SshChannelKind, u64>,
    pub(super) connection: Arc<dyn SshRuntimeConnection>,
    pub(super) created_at: String,
    pub(super) last_error: Option<String>,
    pub(super) last_used_at: String,
    pub(super) opened_channels: u64,
    pub(super) pending_exec_requests: u64,
    pub(super) ref_count: u64,
    pub(super) session_id: String,
    pub(super) state: ManagedSshSessionState,
}

impl ManagedSshSessionEntry {
    pub(super) fn snapshot(
        &self,
        key: &SshSessionKey,
        max_concurrent_exec_channels: usize,
    ) -> ManagedSshSessionSnapshot {
        ManagedSshSessionSnapshot {
            active_channels: self.active_channels,
            channel_counts: self.channel_counts.clone(),
            created_at: self.created_at.clone(),
            key: key.summary(),
            last_error: self.last_error.clone(),
            last_used_at: self.last_used_at.clone(),
            max_concurrent_exec_channels,
            opened_channels: self.opened_channels,
            pending_exec_requests: self.pending_exec_requests,
            ref_count: self.ref_count,
            session_id: self.session_id.clone(),
            state: self.state,
        }
    }
}
