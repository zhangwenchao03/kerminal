use std::{
    collections::{HashMap, HashSet, VecDeque},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::error::{AppError, AppResult};

use super::{
    AgentTargetBindingRequest, AgentTargetBindingSnapshot, AgentTargetBindingStatus,
    TerminalSessionBindingCapabilityUse, TerminalSessionBindingEvent,
    TerminalSessionBindingEventKind, TerminalSessionBindingSnapshot,
    TerminalSessionBindingStatus, TerminalSessionSnapshotStatus,
};

impl TerminalSessionBindingCapabilityUse {
    pub(super) fn normalized(self) -> Option<Self> {
        let jti = self.jti.trim().to_owned();
        if jti.is_empty() {
            None
        } else {
            Some(Self {
                jti,
                expires_at_ms: self.expires_at_ms,
            })
        }
    }
}

impl AgentTargetBindingRequest {
    pub(super) fn normalized(self) -> AppResult<Self> {
        Ok(Self {
            agent_session_id: normalize_required_string(self.agent_session_id, "agentSessionId")?,
            target_terminal_session_id: normalize_required_string(
                self.target_terminal_session_id,
                "targetTerminalSessionId",
            )?,
            pane_id: normalize_required_string(self.pane_id, "paneId")?,
            tab_id: normalize_optional_string(self.tab_id),
            target_ref: normalize_optional_string(self.target_ref),
            cwd: normalize_optional_string(self.cwd),
            shell: normalize_optional_string(self.shell),
        })
    }
}

#[derive(Debug, Default)]
pub(super) struct TerminalSessionBindingState {
    pub(super) by_pane: HashMap<String, String>,
    pub(super) by_session: HashMap<String, String>,
    pub(super) bindings: HashMap<String, TerminalSessionBindingSnapshot>,
    pub(super) agent_targets: HashMap<String, AgentTargetBindingSnapshot>,
    pub(super) target_capability_claims: HashMap<String, TerminalTargetCapabilityClaim>,
    pub(super) events: VecDeque<TerminalSessionBindingEvent>,
    next_sequence: u64,
    next_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TerminalTargetCapabilityClaim {
    pub(super) pane_id: String,
    pub(super) session_id: String,
    pub(super) generation: u64,
    pub(super) expires_at_ms: u64,
}

impl TerminalSessionBindingState {
    pub(super) fn next_generation(&mut self) -> u64 {
        self.next_generation += 1;
        self.next_generation
    }

    pub(super) fn verify_target_capability(
        &mut self,
        event_limit: usize,
        pane_id: &str,
        session_id: &str,
        capability: &TerminalSessionBindingCapabilityUse,
        occurred_at_ms: u64,
    ) -> AppResult<()> {
        if let Some(claim) = self.target_capability_claims.get(&capability.jti) {
            if claim.pane_id == pane_id && claim.session_id == session_id {
                return Ok(());
            }
            let message = format!(
                "target capability already claimed by pane {} session {} generation {} expires {}",
                claim.pane_id, claim.session_id, claim.generation, claim.expires_at_ms
            );
            self.push_event(
                event_limit,
                occurred_at_ms,
                TerminalSessionBindingEventKind::Mismatch,
                Some(pane_id.to_owned()),
                Some(session_id.to_owned()),
                Some(message),
            );
            return Err(AppError::InvalidInput(
                "target capability token 已被其它终端绑定使用".to_owned(),
            ));
        }
        if capability.expires_at_ms < occurred_at_ms {
            self.push_event(
                event_limit,
                occurred_at_ms,
                TerminalSessionBindingEventKind::Mismatch,
                Some(pane_id.to_owned()),
                Some(session_id.to_owned()),
                Some("target capability expired before binding".to_owned()),
            );
            return Err(AppError::InvalidInput(
                "target capability token 已过期".to_owned(),
            ));
        }
        Ok(())
    }

    pub(super) fn push_event(
        &mut self,
        event_limit: usize,
        occurred_at_ms: u64,
        kind: TerminalSessionBindingEventKind,
        pane_id: Option<String>,
        session_id: Option<String>,
        message: Option<String>,
    ) {
        self.next_sequence += 1;
        self.events.push_back(TerminalSessionBindingEvent {
            sequence: self.next_sequence,
            occurred_at_ms,
            kind,
            pane_id,
            session_id,
            message,
        });
        while self.events.len() > event_limit {
            self.events.pop_front();
        }
    }
}

pub(super) fn snapshot_status_for_event(
    kind: TerminalSessionBindingEventKind,
) -> Option<TerminalSessionSnapshotStatus> {
    match kind {
        TerminalSessionBindingEventKind::SnapshotResolved => {
            Some(TerminalSessionSnapshotStatus::Resolved)
        }
        TerminalSessionBindingEventKind::SnapshotRejected => {
            Some(TerminalSessionSnapshotStatus::Rejected)
        }
        TerminalSessionBindingEventKind::SnapshotDegraded => {
            Some(TerminalSessionSnapshotStatus::Degraded)
        }
        _ => None,
    }
}

pub(super) fn binding_key(pane_id: &str, session_id: &str) -> String {
    format!("{pane_id}\n{session_id}")
}

pub(super) fn is_active(status: &TerminalSessionBindingStatus) -> bool {
    matches!(
        status,
        TerminalSessionBindingStatus::Registered | TerminalSessionBindingStatus::Ready
    )
}

pub(super) fn resolve_agent_target_snapshot<I, S>(
    mut binding: AgentTargetBindingSnapshot,
    live_terminal_session_ids: I,
) -> AgentTargetBindingSnapshot
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    if binding.status == AgentTargetBindingStatus::Closed {
        binding.live = false;
        binding.stale = false;
        return binding;
    }

    let live_terminal_session_ids: HashSet<String> = live_terminal_session_ids
        .into_iter()
        .filter_map(|session_id| normalize_optional_string(Some(session_id.as_ref().to_owned())))
        .collect();
    let live = live_terminal_session_ids.contains(&binding.target_terminal_session_id);
    binding.live = live;
    binding.stale = !live;
    binding.status = if live {
        AgentTargetBindingStatus::Live
    } else {
        AgentTargetBindingStatus::Stale
    };
    binding
}

pub(super) fn agent_target_not_found(agent_session_id: &str) -> AppError {
    AppError::NotFound(format!(
        "agent target binding not found for agent session {agent_session_id}"
    ))
}

fn normalize_required_string(value: String, field_name: &str) -> AppResult<String> {
    normalize_optional_string(Some(value))
        .ok_or_else(|| AppError::InvalidInput(format!("{field_name} 不能为空")))
}

pub(super) fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
