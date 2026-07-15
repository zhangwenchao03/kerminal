//! 终端 session binding 对外 DTO 和事件类型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use super::state::normalize_optional_string;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSessionBindingStatus {
    Registered,
    Ready,
    Disconnected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSessionSnapshotStatus {
    Resolved,
    Rejected,
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSessionBindingEventKind {
    Registered,
    Ready,
    Disconnected,
    Reconnected,
    Closed,
    Mismatch,
    SnapshotResolved,
    SnapshotRejected,
    SnapshotDegraded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionBindingSnapshot {
    pub pane_id: String,
    pub session_id: String,
    pub generation: u64,
    pub metadata: Option<TerminalSessionBindingMetadata>,
    pub status: TerminalSessionBindingStatus,
    pub registered_at_ms: u64,
    pub updated_at_ms: u64,
    pub ready_at_ms: Option<u64>,
    pub disconnected_at_ms: Option<u64>,
    pub last_snapshot_status: Option<TerminalSessionSnapshotStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionBindingMetadata {
    pub tab_id: Option<String>,
    pub target_ref: Option<String>,
    pub target_kind: Option<String>,
    pub remote_host_id: Option<String>,
    pub profile_id: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
}

impl TerminalSessionBindingMetadata {
    pub fn with_authoritative_target_ref(
        metadata: Option<Self>,
        authoritative_target_ref: Option<String>,
    ) -> Option<Self> {
        let mut metadata = metadata.unwrap_or(Self {
            tab_id: None,
            target_ref: None,
            target_kind: None,
            remote_host_id: None,
            profile_id: None,
            cwd: None,
            shell: None,
        });
        metadata.target_ref = authoritative_target_ref;
        metadata.normalized()
    }

    pub fn normalized(self) -> Option<Self> {
        let metadata = Self {
            tab_id: normalize_optional_string(self.tab_id),
            target_ref: normalize_optional_string(self.target_ref),
            target_kind: normalize_optional_string(self.target_kind),
            remote_host_id: normalize_optional_string(self.remote_host_id),
            profile_id: normalize_optional_string(self.profile_id),
            cwd: normalize_optional_string(self.cwd),
            shell: normalize_optional_string(self.shell),
        };
        if metadata.tab_id.is_none()
            && metadata.target_ref.is_none()
            && metadata.target_kind.is_none()
            && metadata.remote_host_id.is_none()
            && metadata.profile_id.is_none()
            && metadata.cwd.is_none()
            && metadata.shell.is_none()
        {
            None
        } else {
            Some(metadata)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentTargetBindingStatus {
    Live,
    Stale,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTargetBindingRequest {
    pub agent_session_id: String,
    pub target_terminal_session_id: String,
    pub pane_id: String,
    pub tab_id: Option<String>,
    pub target_ref: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTargetBindingSnapshot {
    pub agent_session_id: String,
    pub target_terminal_session_id: String,
    pub pane_id: String,
    pub tab_id: Option<String>,
    pub target_ref: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub binding_id: String,
    pub generation: u64,
    pub status: AgentTargetBindingStatus,
    pub live: bool,
    pub stale: bool,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionBindingEvent {
    pub sequence: u64,
    pub occurred_at_ms: u64,
    pub kind: TerminalSessionBindingEventKind,
    pub pane_id: Option<String>,
    pub session_id: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalSessionBindingCapabilityUse {
    pub jti: String,
    pub expires_at_ms: u64,
}
