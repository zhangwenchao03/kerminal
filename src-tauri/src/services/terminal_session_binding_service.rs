//! Terminal pane/session binding registry and tracer.
//!
//! This service is intentionally standalone for ADR-0014 P2: it records the
//! backend truth without changing AI chat routing or exposing new commands.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DEFAULT_EVENT_LIMIT: usize = 256;
const DEFAULT_STALE_AFTER: Duration = Duration::from_secs(5 * 60);

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

#[derive(Debug)]
pub struct TerminalSessionBindingService {
    inner: Mutex<TerminalSessionBindingState>,
    event_limit: usize,
    stale_after: Duration,
}

impl Default for TerminalSessionBindingService {
    fn default() -> Self {
        Self::new(DEFAULT_EVENT_LIMIT, DEFAULT_STALE_AFTER)
    }
}

impl TerminalSessionBindingService {
    pub fn new(event_limit: usize, stale_after: Duration) -> Self {
        Self {
            inner: Mutex::new(TerminalSessionBindingState::default()),
            event_limit: event_limit.max(1),
            stale_after,
        }
    }

    pub fn register(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        self.register_with_metadata(pane_id, session_id, None)
    }

    pub fn register_with_metadata(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
        metadata: Option<TerminalSessionBindingMetadata>,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        self.register_at_with_metadata_and_capability(pane_id, session_id, metadata, None, now_ms())
    }

    pub fn register_with_metadata_and_capability(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
        metadata: Option<TerminalSessionBindingMetadata>,
        capability: Option<TerminalSessionBindingCapabilityUse>,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        self.register_at_with_metadata_and_capability(
            pane_id,
            session_id,
            metadata,
            capability,
            now_ms(),
        )
    }

    pub fn register_at(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
        occurred_at_ms: u64,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        self.register_at_with_metadata(pane_id, session_id, None, occurred_at_ms)
    }

    pub fn register_at_with_metadata(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
        metadata: Option<TerminalSessionBindingMetadata>,
        occurred_at_ms: u64,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        self.register_at_with_metadata_and_capability(
            pane_id,
            session_id,
            metadata,
            None,
            occurred_at_ms,
        )
    }

    pub fn register_at_with_metadata_and_capability(
        &self,
        pane_id: impl Into<String>,
        session_id: impl Into<String>,
        metadata: Option<TerminalSessionBindingMetadata>,
        capability: Option<TerminalSessionBindingCapabilityUse>,
        occurred_at_ms: u64,
    ) -> AppResult<TerminalSessionBindingSnapshot> {
        let pane_id = pane_id.into();
        let session_id = session_id.into();
        let metadata = metadata.and_then(TerminalSessionBindingMetadata::normalized);
        let capability = capability.and_then(TerminalSessionBindingCapabilityUse::normalized);
        let mut state = self.lock_state()?;

        if let Some(capability) = &capability {
            state.verify_target_capability(
                self.event_limit,
                &pane_id,
                &session_id,
                capability,
                occurred_at_ms,
            )?;
        }

        if let Some(previous_session_id) = state.by_pane.get(&pane_id).cloned() {
            if previous_session_id != session_id {
                state.by_session.remove(&previous_session_id);
                state
                    .bindings
                    .remove(&binding_key(&pane_id, &previous_session_id));
                state.push_event(
                    self.event_limit,
                    occurred_at_ms,
                    TerminalSessionBindingEventKind::Mismatch,
                    Some(pane_id.clone()),
                    Some(previous_session_id),
                    Some(format!("pane rebound to session {session_id}")),
                );
            }
        }

        if let Some(previous_pane_id) = state.by_session.get(&session_id).cloned() {
            if previous_pane_id != pane_id {
                state.by_pane.remove(&previous_pane_id);
                state
                    .bindings
                    .remove(&binding_key(&previous_pane_id, &session_id));
                state.push_event(
                    self.event_limit,
                    occurred_at_ms,
                    TerminalSessionBindingEventKind::Mismatch,
                    Some(previous_pane_id),
                    Some(session_id.clone()),
                    Some(format!("session rebound to pane {pane_id}")),
                );
            }
        }

        let generation = state.next_generation();
        let binding = TerminalSessionBindingSnapshot {
            pane_id: pane_id.clone(),
            session_id: session_id.clone(),
            generation,
            metadata,
            status: TerminalSessionBindingStatus::Registered,
            registered_at_ms: occurred_at_ms,
            updated_at_ms: occurred_at_ms,
            ready_at_ms: None,
            disconnected_at_ms: None,
            last_snapshot_status: None,
        };
        state.by_pane.insert(pane_id.clone(), session_id.clone());
        state.by_session.insert(session_id.clone(), pane_id.clone());
        state
            .bindings
            .insert(binding_key(&pane_id, &session_id), binding.clone());
        if let Some(capability) = capability {
            state.target_capability_claims.insert(
                capability.jti,
                TerminalTargetCapabilityClaim {
                    pane_id: pane_id.clone(),
                    session_id: session_id.clone(),
                    generation,
                    expires_at_ms: capability.expires_at_ms,
                },
            );
        }
        state.push_event(
            self.event_limit,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Registered,
            Some(pane_id),
            Some(session_id),
            None,
        );
        Ok(binding)
    }

    pub fn ready(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.ready_at(pane_id, session_id, now_ms())
    }

    pub fn ready_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.update_binding(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Ready,
            |binding| {
                binding.status = TerminalSessionBindingStatus::Ready;
                binding.ready_at_ms = Some(occurred_at_ms);
                binding.disconnected_at_ms = None;
            },
        )
    }

    pub fn disconnected(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.disconnected_at(pane_id, session_id, now_ms())
    }

    pub fn disconnected_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.update_binding(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Disconnected,
            |binding| {
                binding.status = TerminalSessionBindingStatus::Disconnected;
                binding.disconnected_at_ms = Some(occurred_at_ms);
            },
        )
    }

    pub fn reconnected(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.reconnected_at(pane_id, session_id, now_ms())
    }

    pub fn reconnected_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.update_binding(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Reconnected,
            |binding| {
                binding.status = TerminalSessionBindingStatus::Ready;
                binding.ready_at_ms = Some(occurred_at_ms);
                binding.disconnected_at_ms = None;
            },
        )
    }

    pub fn closed(&self, pane_id: &str, session_id: &str) -> AppResult<bool> {
        self.closed_at(pane_id, session_id, now_ms())
    }

    pub fn closed_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<bool> {
        let mut state = self.lock_state()?;
        let removed = state
            .bindings
            .remove(&binding_key(pane_id, session_id))
            .is_some();
        if removed {
            state.by_pane.remove(pane_id);
            state.by_session.remove(session_id);
        }
        state.push_event(
            self.event_limit,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Closed,
            Some(pane_id.to_owned()),
            Some(session_id.to_owned()),
            None,
        );
        Ok(removed)
    }

    pub fn record_mismatch_at(
        &self,
        pane_id: Option<&str>,
        session_id: Option<&str>,
        message: impl Into<String>,
        occurred_at_ms: u64,
    ) -> AppResult<()> {
        let mut state = self.lock_state()?;
        state.push_event(
            self.event_limit,
            occurred_at_ms,
            TerminalSessionBindingEventKind::Mismatch,
            pane_id.map(str::to_owned),
            session_id.map(str::to_owned),
            Some(message.into()),
        );
        Ok(())
    }

    pub fn record_mismatch(
        &self,
        pane_id: Option<&str>,
        session_id: Option<&str>,
        message: impl Into<String>,
    ) -> AppResult<()> {
        self.record_mismatch_at(pane_id, session_id, message, now_ms())
    }

    pub fn record_snapshot_resolved(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_resolved_at(pane_id, session_id, now_ms())
    }

    pub fn record_snapshot_resolved_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_at(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionSnapshotStatus::Resolved,
        )
    }

    pub fn record_snapshot_rejected(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_rejected_at(pane_id, session_id, now_ms())
    }

    pub fn record_snapshot_rejected_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_at(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionSnapshotStatus::Rejected,
        )
    }

    pub fn record_snapshot_degraded(
        &self,
        pane_id: &str,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_degraded_at(pane_id, session_id, now_ms())
    }

    pub fn record_snapshot_degraded_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        self.record_snapshot_at(
            pane_id,
            session_id,
            occurred_at_ms,
            TerminalSessionSnapshotStatus::Degraded,
        )
    }

    pub fn record_snapshot_rejected_event(
        &self,
        pane_id: Option<&str>,
        session_id: Option<&str>,
        message: impl Into<String>,
    ) -> AppResult<()> {
        self.record_snapshot_event(
            TerminalSessionBindingEventKind::SnapshotRejected,
            pane_id,
            session_id,
            Some(message.into()),
            now_ms(),
        )
    }

    pub fn record_snapshot_degraded_event(
        &self,
        pane_id: Option<&str>,
        session_id: Option<&str>,
        message: impl Into<String>,
    ) -> AppResult<()> {
        self.record_snapshot_event(
            TerminalSessionBindingEventKind::SnapshotDegraded,
            pane_id,
            session_id,
            Some(message.into()),
            now_ms(),
        )
    }

    pub fn active_binding_for_pane(
        &self,
        pane_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        let state = self.lock_state()?;
        Ok(state
            .by_pane
            .get(pane_id)
            .and_then(|session_id| state.bindings.get(&binding_key(pane_id, session_id)))
            .filter(|binding| is_active(&binding.status))
            .cloned())
    }

    pub fn active_binding_for_session(
        &self,
        session_id: &str,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        let state = self.lock_state()?;
        Ok(state
            .by_session
            .get(session_id)
            .and_then(|pane_id| state.bindings.get(&binding_key(pane_id, session_id)))
            .filter(|binding| is_active(&binding.status))
            .cloned())
    }

    pub fn stale_sessions_at(
        &self,
        occurred_at_ms: u64,
    ) -> AppResult<Vec<TerminalSessionBindingSnapshot>> {
        let stale_after_ms = self.stale_after.as_millis() as u64;
        let state = self.lock_state()?;
        Ok(state
            .bindings
            .values()
            .filter(|binding| {
                binding.status == TerminalSessionBindingStatus::Disconnected
                    && binding.disconnected_at_ms.is_some_and(|disconnected_at| {
                        occurred_at_ms.saturating_sub(disconnected_at) >= stale_after_ms
                    })
            })
            .cloned()
            .collect())
    }

    pub fn stale_sessions(&self) -> AppResult<Vec<TerminalSessionBindingSnapshot>> {
        self.stale_sessions_at(now_ms())
    }

    pub fn events(&self) -> AppResult<Vec<TerminalSessionBindingEvent>> {
        Ok(self.lock_state()?.events.iter().cloned().collect())
    }

    fn record_snapshot_event(
        &self,
        kind: TerminalSessionBindingEventKind,
        pane_id: Option<&str>,
        session_id: Option<&str>,
        message: Option<String>,
        occurred_at_ms: u64,
    ) -> AppResult<()> {
        let mut state = self.lock_state()?;
        if let (Some(pane_id), Some(session_id), Some(snapshot_status)) =
            (pane_id, session_id, snapshot_status_for_event(kind))
        {
            let key = binding_key(pane_id, session_id);
            if state.bindings.contains_key(&key) {
                let generation = state.next_generation();
                if let Some(binding) = state.bindings.get_mut(&key) {
                    binding.generation = generation;
                    binding.updated_at_ms = occurred_at_ms;
                    binding.last_snapshot_status = Some(snapshot_status);
                }
            }
        }
        state.push_event(
            self.event_limit,
            occurred_at_ms,
            kind,
            pane_id.map(str::to_owned),
            session_id.map(str::to_owned),
            message,
        );
        Ok(())
    }

    fn record_snapshot_at(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
        snapshot_status: TerminalSessionSnapshotStatus,
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        let kind = match snapshot_status {
            TerminalSessionSnapshotStatus::Resolved => {
                TerminalSessionBindingEventKind::SnapshotResolved
            }
            TerminalSessionSnapshotStatus::Rejected => {
                TerminalSessionBindingEventKind::SnapshotRejected
            }
            TerminalSessionSnapshotStatus::Degraded => {
                TerminalSessionBindingEventKind::SnapshotDegraded
            }
        };
        self.update_binding(pane_id, session_id, occurred_at_ms, kind, |binding| {
            binding.last_snapshot_status = Some(snapshot_status);
        })
    }

    fn update_binding(
        &self,
        pane_id: &str,
        session_id: &str,
        occurred_at_ms: u64,
        kind: TerminalSessionBindingEventKind,
        update: impl FnOnce(&mut TerminalSessionBindingSnapshot),
    ) -> AppResult<Option<TerminalSessionBindingSnapshot>> {
        let mut state = self.lock_state()?;
        let key = binding_key(pane_id, session_id);
        if !state.bindings.contains_key(&key) {
            state.push_event(
                self.event_limit,
                occurred_at_ms,
                TerminalSessionBindingEventKind::Mismatch,
                Some(pane_id.to_owned()),
                Some(session_id.to_owned()),
                Some("binding not registered".to_owned()),
            );
            return Ok(None);
        };
        let generation = state.next_generation();
        let binding = state
            .bindings
            .get_mut(&key)
            .expect("binding exists after contains_key");
        update(binding);
        binding.generation = generation;
        binding.updated_at_ms = occurred_at_ms;
        let snapshot = binding.clone();
        state.push_event(
            self.event_limit,
            occurred_at_ms,
            kind,
            Some(pane_id.to_owned()),
            Some(session_id.to_owned()),
            None,
        );
        Ok(Some(snapshot))
    }

    fn lock_state(&self) -> AppResult<std::sync::MutexGuard<'_, TerminalSessionBindingState>> {
        self.inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_session_binding_registry"))
    }
}

impl TerminalSessionBindingCapabilityUse {
    fn normalized(self) -> Option<Self> {
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

#[derive(Debug, Default)]
struct TerminalSessionBindingState {
    by_pane: HashMap<String, String>,
    by_session: HashMap<String, String>,
    bindings: HashMap<String, TerminalSessionBindingSnapshot>,
    target_capability_claims: HashMap<String, TerminalTargetCapabilityClaim>,
    events: VecDeque<TerminalSessionBindingEvent>,
    next_sequence: u64,
    next_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TerminalTargetCapabilityClaim {
    pane_id: String,
    session_id: String,
    generation: u64,
    expires_at_ms: u64,
}

impl TerminalSessionBindingState {
    fn next_generation(&mut self) -> u64 {
        self.next_generation += 1;
        self.next_generation
    }

    fn verify_target_capability(
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
            self.push_event(
                event_limit,
                occurred_at_ms,
                TerminalSessionBindingEventKind::Mismatch,
                Some(pane_id.to_owned()),
                Some(session_id.to_owned()),
                Some(format!(
                    "target capability already claimed by pane {} session {} generation {} expires {}",
                    claim.pane_id, claim.session_id, claim.generation, claim.expires_at_ms
                )),
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

    fn push_event(
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

fn snapshot_status_for_event(
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

fn binding_key(pane_id: &str, session_id: &str) -> String {
    format!("{pane_id}\n{session_id}")
}

fn is_active(status: &TerminalSessionBindingStatus) -> bool {
    matches!(
        status,
        TerminalSessionBindingStatus::Registered | TerminalSessionBindingStatus::Ready
    )
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
