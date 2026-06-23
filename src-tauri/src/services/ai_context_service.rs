//! AI 上下文服务。
//!
//! @author kongweiguang

use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    error::{AppError, AppResult},
    models::{
        ai_context::{
            AiContextPolicySnapshot, AiTerminalContextRequest, AiTerminalContextSnapshot,
            AiTerminalContextSource,
        },
        llm_provider::{LlmContextStrategy, LlmProvider},
        terminal::TerminalOutputSnapshot,
    },
    security::redaction::redact_terminal_text,
    services::{
        terminal_manager::TerminalManager,
        terminal_session_binding_service::{
            TerminalSessionBindingMetadata, TerminalSessionBindingService,
        },
    },
};

const DEFAULT_CONTEXT_OUTPUT_BYTES: usize = 12 * 1024;
const MIN_CONTEXT_OUTPUT_BYTES: usize = 512;
const MAX_CONTEXT_OUTPUT_BYTES: usize = 24 * 1024;

/// AI 上下文业务入口，负责把终端运行态转换为 Kerminal Agent 可消费的安全上下文。
#[derive(Debug, Default)]
pub struct AiContextService;

/// AI chat 读取终端上下文时的网关行为。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiTerminalContextGatewayBehavior {
    /// Provider 禁用终端上下文，即使请求里带了 terminal_context 也不读取 session。
    DisabledByProvider,
    /// terminal_context 是强约束；session 缺失或过期时直接返回错误。
    Strict,
    /// 尝试读取 terminal_context，失败时降级为无终端快照。
    BestEffort,
}

impl AiContextService {
    /// 创建 AI 上下文服务。
    pub fn new() -> Self {
        Self
    }

    /// 生成当前终端上下文快照。
    pub fn terminal_context_snapshot(
        &self,
        terminals: &TerminalManager,
        request: AiTerminalContextRequest,
    ) -> AppResult<AiTerminalContextSnapshot> {
        let session_id = request.session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::InvalidInput(
                "当前 pane 尚未绑定终端 session".to_owned(),
            ));
        }

        let max_output_bytes = normalize_output_limit(request.max_output_bytes);
        let (session, output) = terminals.output_snapshot(session_id, max_output_bytes)?;
        let (output, redacted) = redact_output_snapshot(output);

        Ok(AiTerminalContextSnapshot {
            generated_at: current_unix_timestamp(),
            session,
            source: AiTerminalContextSource {
                pane_id: request.pane_id,
                pane_title: request.pane_title,
                tab_id: request.tab_id,
                tab_title: request.tab_title,
                machine_id: request.machine_id,
                machine_name: request.machine_name,
                machine_kind: request.machine_kind,
            },
            output,
            redacted,
            policy: AiContextPolicySnapshot {
                mode: "currentTerminal".to_owned(),
                includes_recent_output: true,
                includes_full_history: false,
                secret_redaction: true,
                max_output_bytes,
            },
        })
    }

    /// 根据 provider 策略为 AI chat 收集终端上下文。
    pub fn terminal_context_snapshot_for_chat(
        &self,
        terminals: &TerminalManager,
        bindings: Option<&TerminalSessionBindingService>,
        provider: &LlmProvider,
        request: Option<AiTerminalContextRequest>,
    ) -> AppResult<Option<AiTerminalContextSnapshot>> {
        match terminal_context_gateway_behavior(provider) {
            AiTerminalContextGatewayBehavior::DisabledByProvider => Ok(None),
            AiTerminalContextGatewayBehavior::Strict => {
                let Some(terminal_context) = request else {
                    return Ok(None);
                };
                match self.terminal_context_snapshot_with_binding(
                    terminals,
                    bindings,
                    terminal_context,
                    TerminalSnapshotFailureTrace::Rejected,
                ) {
                    Ok(snapshot) => Ok(Some(snapshot)),
                    Err(error) => Err(error),
                }
            }
            AiTerminalContextGatewayBehavior::BestEffort => {
                let Some(terminal_context) = request else {
                    return Ok(None);
                };
                match self.terminal_context_snapshot_with_binding(
                    terminals,
                    bindings,
                    terminal_context,
                    TerminalSnapshotFailureTrace::Degraded,
                ) {
                    Ok(snapshot) => Ok(Some(snapshot)),
                    Err(_) => Ok(None),
                }
            }
        }
    }

    fn terminal_context_snapshot_with_binding(
        &self,
        terminals: &TerminalManager,
        bindings: Option<&TerminalSessionBindingService>,
        request: AiTerminalContextRequest,
        failure_trace: TerminalSnapshotFailureTrace,
    ) -> AppResult<AiTerminalContextSnapshot> {
        let pane_id = request.pane_id.clone();
        let session_id = request.session_id.clone();
        if let Err(error) = validate_terminal_binding(bindings, &request) {
            record_snapshot_failure(
                bindings,
                pane_id.as_deref(),
                Some(session_id.as_str()),
                error.to_string(),
                failure_trace,
            );
            return Err(error);
        }
        let request_for_target_validation = request.clone();
        match self.terminal_context_snapshot(terminals, request) {
            Ok(snapshot) => {
                if let Err(message) = validate_session_target_ref(
                    snapshot.session.target_ref.as_deref(),
                    &request_for_target_validation,
                ) {
                    record_snapshot_failure(
                        bindings,
                        pane_id.as_deref(),
                        Some(session_id.as_str()),
                        message.clone(),
                        failure_trace,
                    );
                    return Err(AppError::InvalidInput(message));
                }
                record_snapshot_resolved(bindings, pane_id.as_deref(), Some(session_id.as_str()));
                Ok(snapshot)
            }
            Err(error) => {
                record_snapshot_failure(
                    bindings,
                    pane_id.as_deref(),
                    Some(session_id.as_str()),
                    error.to_string(),
                    failure_trace,
                );
                Err(error)
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum TerminalSnapshotFailureTrace {
    Rejected,
    Degraded,
}

fn validate_terminal_binding(
    bindings: Option<&TerminalSessionBindingService>,
    request: &AiTerminalContextRequest,
) -> AppResult<()> {
    let Some(bindings) = bindings else {
        return Ok(());
    };
    let Some(pane_id) = request
        .pane_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Ok(());
    }

    match bindings.active_binding_for_pane(pane_id)? {
        Some(binding) if binding.session_id == session_id => {
            if let Some(metadata) = binding.metadata.as_ref() {
                validate_terminal_metadata(metadata, request).map_err(|message| {
                    let _ =
                        bindings.record_mismatch(Some(pane_id), Some(session_id), message.clone());
                    AppError::InvalidInput(message)
                })?;
            }
            Ok(())
        }
        Some(binding) => {
            let message = format!(
                "终端 pane 绑定的 session 已变化: pane {pane_id}, request {session_id}, active {}",
                binding.session_id
            );
            let _ = bindings.record_mismatch(Some(pane_id), Some(session_id), message.clone());
            Err(AppError::InvalidInput(message))
        }
        None => {
            let message = format!(
                "终端 pane 尚未注册 active session binding: pane {pane_id}, session {session_id}"
            );
            let _ = bindings.record_mismatch(Some(pane_id), Some(session_id), message.clone());
            Err(AppError::InvalidInput(message))
        }
    }
}

fn validate_terminal_metadata(
    metadata: &TerminalSessionBindingMetadata,
    request: &AiTerminalContextRequest,
) -> Result<(), String> {
    if let Some(active_target_ref) = normalized_ref(metadata.target_ref.as_deref()) {
        let request_target_refs = request_equivalent_target_refs(request);
        if !request_target_refs.is_empty()
            && !request_target_refs
                .iter()
                .any(|target_ref| target_refs_match(target_ref, active_target_ref))
        {
            return Err(format!(
                "终端 pane 绑定的 targetRef 已变化: request {}, active {}",
                request_target_refs.join("/"),
                active_target_ref
            ));
        }
    }

    if values_conflict(request.tab_id.as_deref(), metadata.tab_id.as_deref()) {
        return Err(format!(
            "终端 pane 绑定的 tab 已变化: request {}, active {}",
            request.tab_id.as_deref().unwrap_or_default(),
            metadata.tab_id.as_deref().unwrap_or_default()
        ));
    }

    if values_conflict(
        request.machine_kind.as_deref(),
        metadata.target_kind.as_deref(),
    ) {
        return Err(format!(
            "终端 pane 绑定的 target kind 已变化: request {}, active {}",
            request.machine_kind.as_deref().unwrap_or_default(),
            metadata.target_kind.as_deref().unwrap_or_default()
        ));
    }

    if let Some(request_machine_id) = normalized_ref(request.machine_id.as_deref()) {
        let stable_target_ids = [
            metadata.remote_host_id.as_deref(),
            metadata.profile_id.as_deref(),
        ];
        let known_target_ids: Vec<&str> = stable_target_ids
            .into_iter()
            .filter_map(normalized_ref)
            .collect();
        if !known_target_ids.is_empty()
            && !known_target_ids
                .iter()
                .any(|target_id| target_ids_match(request_machine_id, target_id))
        {
            return Err(format!(
                "终端 pane 绑定的 machine id 已变化: request {}, active {}",
                request_machine_id,
                known_target_ids.join("/")
            ));
        }
    }

    Ok(())
}

fn validate_session_target_ref(
    session_target_ref: Option<&str>,
    request: &AiTerminalContextRequest,
) -> Result<(), String> {
    let Some(active_target_ref) = normalized_ref(session_target_ref) else {
        return Ok(());
    };
    let request_target_refs = request_equivalent_target_refs(request);
    if request_target_refs.is_empty()
        || request_target_refs
            .iter()
            .any(|target_ref| target_refs_match(target_ref, active_target_ref))
    {
        return Ok(());
    }
    Err(format!(
        "终端 session 的 targetRef 与请求不一致: request {}, active {}",
        request_target_refs.join("/"),
        active_target_ref
    ))
}

fn request_equivalent_target_refs(request: &AiTerminalContextRequest) -> Vec<String> {
    let mut refs = Vec::new();
    if let Some(machine_kind) = normalized_ref(request.machine_kind.as_deref()) {
        if machine_kind.eq_ignore_ascii_case("local") {
            refs.push("local".to_owned());
        }
    }
    if let Some(machine_id) = normalized_ref(request.machine_id.as_deref()) {
        refs.push(machine_id.to_owned());
        if let Some(machine_kind) = normalized_ref(request.machine_kind.as_deref()) {
            if !machine_id.contains(':') {
                refs.push(format!(
                    "{}:{machine_id}",
                    normalize_target_kind(machine_kind)
                ));
            }
        }
    }
    refs
}

fn normalize_target_kind(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "dockercontainer" | "docker-container" | "container" => "dockerContainer".to_owned(),
        other => other.to_owned(),
    }
}

fn target_refs_match(request_target_ref: &str, active_target_ref: &str) -> bool {
    request_target_ref.eq_ignore_ascii_case(active_target_ref)
        || active_target_ref
            .strip_prefix(request_target_ref)
            .is_some_and(|suffix| suffix.starts_with(':'))
}

fn target_ids_match(request_target_id: &str, active_target_id: &str) -> bool {
    request_target_id.eq_ignore_ascii_case(active_target_id)
        || request_target_id
            .strip_prefix("profile:")
            .is_some_and(|profile_id| profile_id.eq_ignore_ascii_case(active_target_id))
        || active_target_id
            .strip_prefix("profile:")
            .is_some_and(|profile_id| profile_id.eq_ignore_ascii_case(request_target_id))
}

fn values_conflict(request_value: Option<&str>, metadata_value: Option<&str>) -> bool {
    match (
        normalized_ref(request_value),
        normalized_ref(metadata_value),
    ) {
        (Some(request_value), Some(metadata_value)) => {
            !request_value.eq_ignore_ascii_case(metadata_value)
        }
        _ => false,
    }
}

fn normalized_ref(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn record_snapshot_resolved(
    bindings: Option<&TerminalSessionBindingService>,
    pane_id: Option<&str>,
    session_id: Option<&str>,
) {
    if let (Some(bindings), Some(pane_id), Some(session_id)) = (bindings, pane_id, session_id) {
        let _ = bindings.record_snapshot_resolved(pane_id, session_id);
    }
}

fn record_snapshot_failure(
    bindings: Option<&TerminalSessionBindingService>,
    pane_id: Option<&str>,
    session_id: Option<&str>,
    message: String,
    failure_trace: TerminalSnapshotFailureTrace,
) {
    if let Some(bindings) = bindings {
        match failure_trace {
            TerminalSnapshotFailureTrace::Rejected => {
                let _ = bindings.record_snapshot_rejected_event(pane_id, session_id, message);
            }
            TerminalSnapshotFailureTrace::Degraded => {
                let _ = bindings.record_snapshot_degraded_event(pane_id, session_id, message);
            }
        }
    }
}

fn terminal_context_gateway_behavior(provider: &LlmProvider) -> AiTerminalContextGatewayBehavior {
    match provider.context_strategy {
        LlmContextStrategy::Minimal => AiTerminalContextGatewayBehavior::DisabledByProvider,
        LlmContextStrategy::CurrentTerminal => AiTerminalContextGatewayBehavior::Strict,
        LlmContextStrategy::CurrentWorkspace => AiTerminalContextGatewayBehavior::BestEffort,
    }
}

fn normalize_output_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_CONTEXT_OUTPUT_BYTES)
        .clamp(MIN_CONTEXT_OUTPUT_BYTES, MAX_CONTEXT_OUTPUT_BYTES)
}

fn redact_output_snapshot(mut output: TerminalOutputSnapshot) -> (TerminalOutputSnapshot, bool) {
    let (data, redacted) = redact_terminal_text(&output.data);
    output.captured_bytes = data.len();
    output.data = data;
    (output, redacted)
}

fn current_unix_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}
