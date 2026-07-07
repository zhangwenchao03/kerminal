//! External launch intake queue and startup bridge model.
//!
//! @author kongweiguang

use std::{
    borrow::Cow,
    collections::{HashMap, VecDeque},
    fmt,
    sync::{Arc, Mutex, MutexGuard},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::models::settings::{ExternalLaunchSettings, ExternalLaunchToolSetting};

use super::{
    bridge::{ExternalLaunchBridgeEnvelope, EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION},
    classifier::infer_source_tool_from_args,
    model::{
        ExternalLaunchEntrypoint, ExternalLaunchParseInput, ExternalLaunchSourceTool,
        ExternalSshLaunchRequest, ExternalSshTarget,
    },
    parser::ExternalLaunchParserRegistry,
    secret::ExternalLaunchSecretBroker,
};

pub const EXTERNAL_SSH_LAUNCH_EVENT: &str = "kerminal-external-ssh-launch";

/// Accepts launch argv from cold start, single-instance, shim, or future protocol entrypoints.
#[derive(Clone)]
pub struct ExternalLaunchIntake {
    inner: Arc<ExternalLaunchIntakeInner>,
}

struct ExternalLaunchIntakeInner {
    parser: ExternalLaunchParserRegistry,
    policy: Mutex<ExternalLaunchPolicy>,
    secrets: ExternalLaunchSecretBroker,
    state: Mutex<ExternalLaunchIntakeState>,
}

#[derive(Debug, Default)]
struct ExternalLaunchIntakeState {
    pending: VecDeque<ExternalSshLaunchRequest>,
    active: HashMap<String, ExternalSshLaunchRequest>,
    accepted_count: u64,
    rejected_count: u64,
    noop_count: u64,
    last_rejection: Option<ExternalLaunchRejected>,
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
        log_external_launch_args(entrypoint, "direct", None, &summary, &argv);
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
                let queued = {
                    let mut state = self.state()?;
                    state.pending.push_back(request.clone());
                    state.accepted_count += 1;
                    ExternalLaunchQueued {
                        launch_id: request.id.clone(),
                        source_tool: request.source.tool,
                        entrypoint,
                        target: ExternalLaunchTargetSummary::from_target(&request.target),
                        pending_count: state.pending.len(),
                    }
                };
                Ok(ExternalLaunchAcceptOutcome::Queued(queued))
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

    pub fn accept_bridge_envelope(
        &self,
        envelope: ExternalLaunchBridgeEnvelope,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        let summary = ExternalLaunchArgSummary::new(&envelope.argv, envelope.cwd.as_deref());
        log_external_launch_args(
            ExternalLaunchEntrypoint::ShimIpc,
            "shim",
            Some(envelope.persona),
            &summary,
            &envelope.redacted_argv(),
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
                let queued = {
                    let mut state = self.state()?;
                    state.pending.push_back(request.clone());
                    state.accepted_count += 1;
                    ExternalLaunchQueued {
                        launch_id: request.id.clone(),
                        source_tool: request.source.tool,
                        entrypoint: ExternalLaunchEntrypoint::ShimIpc,
                        target: ExternalLaunchTargetSummary::from_target(&request.target),
                        pending_count: state.pending.len(),
                    }
                };
                Ok(ExternalLaunchAcceptOutcome::Queued(queued))
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

    pub fn take_pending(&self) -> AppResult<Vec<ExternalSshLaunchRequest>> {
        let mut state = self.state()?;
        let requests = state.pending.drain(..).collect::<Vec<_>>();
        for request in &requests {
            state.active.insert(request.id.clone(), request.clone());
        }
        Ok(requests)
    }

    pub fn active_request(&self, launch_id: &str) -> AppResult<Option<ExternalSshLaunchRequest>> {
        Ok(self.state()?.active.get(launch_id).cloned())
    }

    pub fn forget_active(&self, launch_id: &str) -> AppResult<bool> {
        Ok(self.state()?.active.remove(launch_id).is_some())
    }

    pub fn snapshot(&self) -> AppResult<ExternalLaunchIntakeSnapshot> {
        let state = self.state()?;
        Ok(ExternalLaunchIntakeSnapshot {
            pending_count: state.pending.len(),
            pending_launch_ids: state
                .pending
                .iter()
                .map(|request| request.id.clone())
                .collect(),
            accepted_count: state.accepted_count,
            rejected_count: state.rejected_count,
            noop_count: state.noop_count,
            last_rejection: state.last_rejection.clone(),
            policy: self.policy_snapshot()?,
        })
    }

    fn policy(&self) -> AppResult<MutexGuard<'_, ExternalLaunchPolicy>> {
        self.inner
            .policy
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external launch policy"))
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalLaunchAcceptOutcome {
    Noop(ExternalLaunchNoop),
    Queued(ExternalLaunchQueued),
    Rejected(ExternalLaunchRejected),
}

impl ExternalLaunchAcceptOutcome {
    pub fn event_payload(&self) -> Option<ExternalLaunchEventPayload> {
        match self {
            Self::Noop(_) => None,
            Self::Queued(queued) => Some(ExternalLaunchEventPayload {
                kind: ExternalLaunchEventKind::Queued,
                launch_id: Some(queued.launch_id.clone()),
                source_tool: Some(queued.source_tool),
                entrypoint: queued.entrypoint,
                target: Some(queued.target.clone()),
                pending_count: queued.pending_count,
                message: None,
            }),
            Self::Rejected(rejected) => Some(ExternalLaunchEventPayload {
                kind: ExternalLaunchEventKind::Rejected,
                launch_id: None,
                source_tool: rejected.source_tool,
                entrypoint: rejected.entrypoint,
                target: None,
                pending_count: 0,
                message: Some(rejected.message.clone()),
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchNoop {
    pub entrypoint: ExternalLaunchEntrypoint,
    pub reason: String,
    pub arg_count: usize,
    pub cwd_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchQueued {
    pub launch_id: String,
    pub source_tool: ExternalLaunchSourceTool,
    pub entrypoint: ExternalLaunchEntrypoint,
    pub target: ExternalLaunchTargetSummary,
    pub pending_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchRejected {
    pub entrypoint: ExternalLaunchEntrypoint,
    pub source_tool: Option<ExternalLaunchSourceTool>,
    pub message: String,
    pub arg_count: usize,
    pub raw_hash: String,
    pub cwd_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchIntakeSnapshot {
    pub pending_count: usize,
    pub pending_launch_ids: Vec<String>,
    pub accepted_count: u64,
    pub rejected_count: u64,
    pub noop_count: u64,
    pub last_rejection: Option<ExternalLaunchRejected>,
    pub policy: ExternalLaunchPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchPolicy {
    pub enabled: bool,
    pub accept_vendor_args: bool,
    pub shim_bridge_enabled: bool,
    pub auto_open_sftp: bool,
    #[serde(default)]
    pub disabled_tools: Vec<ExternalLaunchSourceTool>,
}

impl Default for ExternalLaunchPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            accept_vendor_args: true,
            shim_bridge_enabled: true,
            auto_open_sftp: false,
            disabled_tools: Vec::new(),
        }
    }
}

impl From<&ExternalLaunchSettings> for ExternalLaunchPolicy {
    fn from(settings: &ExternalLaunchSettings) -> Self {
        Self {
            enabled: settings.enabled,
            accept_vendor_args: settings.accept_vendor_args,
            shim_bridge_enabled: settings.shim_bridge.enabled,
            auto_open_sftp: settings.auto_open_sftp,
            disabled_tools: settings
                .disabled_tools
                .iter()
                .copied()
                .map(ExternalLaunchSourceTool::from)
                .collect(),
        }
    }
}

impl From<ExternalLaunchToolSetting> for ExternalLaunchSourceTool {
    fn from(tool: ExternalLaunchToolSetting) -> Self {
        match tool {
            ExternalLaunchToolSetting::Putty => Self::Putty,
            ExternalLaunchToolSetting::Mobaxterm => Self::Mobaxterm,
            ExternalLaunchToolSetting::Xshell => Self::Xshell,
            ExternalLaunchToolSetting::Securecrt => Self::Securecrt,
            ExternalLaunchToolSetting::Openssh => Self::Openssh,
            ExternalLaunchToolSetting::KerminalNative => Self::KerminalNative,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchEventPayload {
    pub kind: ExternalLaunchEventKind,
    pub launch_id: Option<String>,
    pub source_tool: Option<ExternalLaunchSourceTool>,
    pub entrypoint: ExternalLaunchEntrypoint,
    pub target: Option<ExternalLaunchTargetSummary>,
    pub pending_count: usize,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalLaunchEventKind {
    Queued,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchTargetSummary {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub display_name: String,
}

impl ExternalLaunchTargetSummary {
    fn from_target(target: &ExternalSshTarget) -> Self {
        Self {
            host: target.host.clone(),
            port: target.port,
            username: target.username.clone(),
            display_name: target.display_name(),
        }
    }
}

struct ExternalLaunchArgSummary {
    arg_count: usize,
    raw_hash: String,
    cwd_present: bool,
}

impl ExternalLaunchArgSummary {
    fn new(argv: &[String], cwd: Option<&str>) -> Self {
        Self {
            arg_count: argv.len(),
            raw_hash: raw_hash(argv),
            cwd_present: cwd.is_some_and(|value| !value.trim().is_empty()),
        }
    }
}

fn policy_rejection_message(
    policy: &ExternalLaunchPolicy,
    entrypoint: ExternalLaunchEntrypoint,
    source_tool: ExternalLaunchSourceTool,
) -> Option<&'static str> {
    if !policy.enabled {
        return Some("external SSH launch disabled by policy");
    }
    if entrypoint == ExternalLaunchEntrypoint::ShimIpc && !policy.shim_bridge_enabled {
        return Some("external SSH shim bridge disabled by policy");
    }
    if source_tool != ExternalLaunchSourceTool::KerminalNative && !policy.accept_vendor_args {
        return Some("external SSH vendor argument launch disabled by policy");
    }
    if policy.disabled_tools.contains(&source_tool) {
        return Some("external SSH launch tool disabled by policy");
    }
    None
}

fn apply_policy_options(policy: &ExternalLaunchPolicy, request: &mut ExternalSshLaunchRequest) {
    if policy.auto_open_sftp {
        request.options.open_sftp = true;
    }
}

fn log_external_launch_args(
    entrypoint: ExternalLaunchEntrypoint,
    channel: &str,
    source_tool: Option<ExternalLaunchSourceTool>,
    summary: &ExternalLaunchArgSummary,
    argv: &[String],
) {
    tauri_plugin_log::log::info!(
        target: "external_launch.intake",
        "received channel={channel} entrypoint={entrypoint:?} source_tool={source_tool:?} arg_count={} raw_hash={} cwd_present={} argv_redacted={:?}",
        summary.arg_count,
        summary.raw_hash,
        summary.cwd_present,
        redact_intake_argv(argv)
    );
}

fn log_external_launch_queued(
    entrypoint: ExternalLaunchEntrypoint,
    request: &ExternalSshLaunchRequest,
) {
    tauri_plugin_log::log::info!(
        target: "external_launch.intake",
        "queued launch_id={} entrypoint={entrypoint:?} source_tool={:?} parser={} target={}@{}:{} raw_hash={} argv_redacted={:?}",
        request.id,
        request.source.tool,
        request.diagnostics.parser,
        redacted_log_username(request.target.username.as_deref()),
        request.target.host,
        request.target.port,
        request.diagnostics.raw_hash,
        request.diagnostics.argv_redacted
    );
}

fn redacted_log_username(username: Option<&str>) -> Cow<'_, str> {
    let Some(username) = username else {
        return Cow::Borrowed("<prompt>");
    };
    if username
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("b64>>"))
    {
        Cow::Borrowed("b64>><redacted>")
    } else if looks_like_opaque_external_username(username) {
        Cow::Borrowed("<redacted-external-user>")
    } else {
        Cow::Borrowed(username)
    }
}

fn looks_like_opaque_external_username(username: &str) -> bool {
    let username = username.trim();
    if username.len() < 32 || username.contains('@') {
        return false;
    }
    let token_chars = username
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '+' | '/' | '='))
        .count();
    token_chars * 100 / username.len() >= 80
}

fn sanitize_error_message(error: AppError) -> String {
    match error {
        AppError::InvalidInput(_) => "external SSH launch rejected: invalid arguments".to_owned(),
        _ => "external SSH launch rejected".to_owned(),
    }
}

fn redact_intake_argv(argv: &[String]) -> Vec<String> {
    let mut redacted = argv.to_vec();
    let mut redact_next = false;
    for token in &mut redacted {
        if redact_next {
            *token = "<redacted>".to_owned();
            redact_next = false;
            continue;
        }
        let lower = token.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "-pw" | "-password" | "-pass" | "-pwd" | "/password" | "--password"
        ) {
            redact_next = true;
            continue;
        }
        if lower.starts_with("ssh://")
            || lower.starts_with("b64%3e%3e")
            || lower.starts_with("b64>>")
        {
            *token = "<redacted-external-url>".to_owned();
        }
    }
    redacted
}

fn raw_hash(argv: &[String]) -> String {
    let mut hasher = Sha256::new();
    for arg in argv {
        hasher.update(arg.as_bytes());
        hasher.update([0]);
    }
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
