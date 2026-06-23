//! AI 工具调用受控执行服务。
//!
//! @author kongweiguang

use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use rmcp::model::CallToolResult;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        ai_tool_invocation::{
            AiToolAuditClearResponse, AiToolAuditExport, AiToolAuditListRequest, AiToolAuditRecord,
            AiToolClientAction, AiToolClientActionKind, AiToolConfirmRequest,
            AiToolExecuteIfAllowedRequest, AiToolExecuteIfAllowedResponse, AiToolInvocationStatus,
            AiToolObservation, AiToolObservationStatus, AiToolPendingContextUpdateRequest,
            AiToolPendingInvocation, AiToolPrepareRequest,
        },
        command_history::{
            CommandHistoryListRequest, CommandHistoryRecordRequest, CommandHistorySource,
            CommandHistoryTarget,
        },
        connection::{RdpOpenRequest, RdpOpenResult},
        diagnostics::{DiagnosticBundle, RuntimeHealthSnapshot},
        docker::{
            DockerContainerDirectoryListing, DockerContainerFilePreview,
            DockerContainerListRequest, DockerContainerPathRequest, DockerContainerPreviewRequest,
            DockerContainerSummary,
        },
        llm_provider::{
            LlmProvider, LlmProviderCreateRequest, LlmProviderTestResult, LlmProviderUpdateRequest,
        },
        port_forward::{
            PortForwardCreateRequest, PortForwardEndpoint, PortForwardKind, PortForwardOrigin,
            PortForwardProxyApplyScope, PortForwardProxyProtocol, PortForwardPurpose,
            PortForwardRemoteAccessScope, PortForwardStatus, PortForwardSummary,
        },
        profile::{ProfileCreateRequest, ProfileUpdateRequest, ShellCandidate, TerminalProfile},
        remote_host::{
            RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostGroup,
            RemoteHostGroupCreateRequest, RemoteHostGroupUpdateRequest, RemoteHostGroupWithHosts,
            RemoteHostUpdateRequest,
        },
        server_info::{ServerInfoRequest, ServerInfoSnapshot},
        settings::{
            AiCommandApprovalPolicy, AiSecuritySettings, AppSettings, TerminalAppearance, ThemeMode,
        },
        sftp::{
            SftpChmodRequest, SftpDeleteRequest, SftpDirectoryListing, SftpEntryKind,
            SftpFilePreview, SftpListDirectoryRequest, SftpManagedTransferRequest, SftpPathRequest,
            SftpPreviewRequest, SftpRenameRequest, SftpTransferCancelRequest,
            SftpTransferConflictPolicy, SftpTransferDirection, SftpTransferKind,
            SftpTransferRequest, SftpTransferStatus, SftpTransferSummary,
        },
        snippet::{
            CommandSnippet, SnippetCreateRequest, SnippetListRequest, SnippetScope,
            SnippetUpdateRequest,
        },
        ssh_command::{SshCommandOutput, SshCommandRequest},
        terminal::{
            TerminalResizeRequest, TerminalSessionLogState, TerminalSessionStatus,
            TerminalSessionSummary,
        },
        tool_registry::{ToolConfirmationPolicy, ToolDefinition, ToolRiskLevel},
        workflow::{
            CommandWorkflow, WorkflowCreateRequest, WorkflowListRequest, WorkflowScope,
            WorkflowStepInput, WorkflowUpdateRequest,
        },
    },
    paths::KerminalPaths,
    security::redaction::redact_terminal_text,
    services::{
        command_history_service::CommandHistoryService,
        credential_service::CredentialService,
        diagnostics_service::DiagnosticsService,
        docker_host_service::DockerHostService,
        local_network_proxy_service::{LocalNetworkProxyService, LocalProxyEntryRequest},
        mcp_discovery_service::call_mcp_server_tool,
        mcp_tool_gateway::{custom_mcp_tool_definitions, custom_mcp_tool_id},
        port_forward_service::PortForwardService,
        profile_service::ProfileService,
        remote_host_service::RemoteHostService,
        rig_provider_service::RigProviderService,
        server_info_service::ServerInfoService,
        settings_service::SettingsService,
        sftp_service::SftpService,
        snippet_service::SnippetService,
        ssh_command_service::SshCommandService,
        terminal_manager::TerminalManager,
        terminal_session_binding_service::TerminalSessionBindingService,
        tool_registry_service::ToolRegistryService,
        workflow_service::WorkflowService,
    },
    storage::SqliteStore,
};

mod arguments;
mod audit_text;
mod client_actions;
mod clock;
mod container_tools;
mod content_tools;
mod diagnostics_tools;
mod execution;
mod execution_result;
mod policy;
mod port_forward_tools;
mod profile_remote_tools;
mod provider_tools;
mod risk;
mod settings_tools;
mod sftp_tools;
mod ssh_tools;
mod terminal_tools;

pub use self::{
    diagnostics_tools::summarize_server_info_snapshot_for_ai,
    sftp_tools::{summarize_sftp_listing_for_ai, summarize_sftp_preview_for_ai},
    ssh_tools::summarize_ssh_command_output_for_ai,
};

use self::{
    arguments::*, audit_text::*, client_actions::*, clock::*, container_tools::*, content_tools::*,
    diagnostics_tools::*, execution::*, execution_result::*, policy::*, port_forward_tools::*,
    profile_remote_tools::*, provider_tools::*, risk::*, settings_tools::*, sftp_tools::*,
    ssh_tools::*, terminal_tools::*,
};

const MAX_AUDIT_RECORDS: usize = 100;

/// AI 工具调用执行结果。
#[derive(Debug, Clone)]
struct ToolExecutionResult {
    pub(super) status: AiToolInvocationStatus,
    pub(super) result_summary: Option<String>,
    pub(super) error: Option<String>,
    pub(super) structured_result: Option<Value>,
    pub(super) entities: Vec<Value>,
    pub(super) error_kind: Option<String>,
    pub(super) recoverable: bool,
    pub(super) next_hints: Vec<String>,
}

impl Default for ToolExecutionResult {
    fn default() -> Self {
        Self {
            status: AiToolInvocationStatus::Failed,
            result_summary: None,
            error: None,
            structured_result: None,
            entities: Vec::new(),
            error_kind: None,
            recoverable: false,
            next_hints: Vec::new(),
        }
    }
}

/// AI tool invocation 受控入口。
#[derive(Debug, Clone, Default)]
pub struct AiToolInvocationService {
    inner: Arc<AiToolInvocationState>,
}

#[derive(Debug, Default)]
struct AiToolInvocationState {
    pending: Mutex<HashMap<String, PendingInvocationState>>,
    audits: Mutex<VecDeque<AiToolAuditRecord>>,
}

/// AI 工具确认执行时需要访问的运行时服务集合。
#[derive(Debug, Clone, Copy)]
pub struct AiToolExecutionContext<'a> {
    /// 终端会话管理服务。
    pub terminals: &'a TerminalManager,
    /// 前端 pane 与后端 terminal session 的可信绑定旁路。
    pub terminal_session_bindings: &'a TerminalSessionBindingService,
    /// 命令历史服务。
    pub command_history: &'a CommandHistoryService,
    /// 本地凭据服务。
    pub credentials: &'a CredentialService,
    /// 应用设置服务。
    pub settings: &'a SettingsService,
    /// 本地终端配置服务。
    pub profiles: &'a ProfileService,
    /// 远程主机配置服务。
    pub remote_hosts: &'a RemoteHostService,
    /// Rig LLM Provider 配置服务。
    pub rig_providers: &'a RigProviderService,
    /// 服务器信息采集服务。
    pub server_info: &'a ServerInfoService,
    /// 本地诊断服务。
    pub diagnostics: &'a DiagnosticsService,
    /// SFTP 文件工具服务。
    pub sftp: &'a SftpService,
    /// Docker/Podman 容器服务。
    pub docker_hosts: &'a DockerHostService,
    /// SSH 端口转发服务。
    pub port_forwards: &'a PortForwardService,
    /// 本机共享网络代理服务。
    pub local_network_proxy: &'a LocalNetworkProxyService,
    /// 脚本片段服务。
    pub snippets: &'a SnippetService,
    /// 命令工作流服务。
    pub workflows: &'a WorkflowService,
    /// SSH 非交互命令服务。
    pub ssh_commands: &'a SshCommandService,
    /// 本地数据目录集合。
    pub paths: &'a KerminalPaths,
    /// SQLite 存储入口。
    pub storage: &'a SqliteStore,
}

impl AiToolInvocationService {
    /// 创建 AI 工具调用服务。
    pub fn new() -> Self {
        Self::default()
    }

    /// 准备一次 AI 工具调用，返回待确认记录。
    pub fn prepare(
        &self,
        tools: &ToolRegistryService,
        request: AiToolPrepareRequest,
    ) -> AppResult<AiToolPendingInvocation> {
        self.prepare_with_ai_policy(
            &tools.list_tools(),
            &AiSecuritySettings::legacy_tool_policy(),
            request,
        )
    }

    /// 按当前应用 AI 安全策略准备一次 AI 工具调用，返回待确认记录。
    pub fn prepare_with_settings(
        &self,
        tools: &ToolRegistryService,
        settings: &SettingsService,
        storage: &SqliteStore,
        request: AiToolPrepareRequest,
    ) -> AppResult<AiToolPendingInvocation> {
        let settings = settings.load_settings(storage)?;
        let mut definitions = tools.list_tools();
        definitions.extend(custom_mcp_tool_definitions(&settings.ai.mcp));
        let pending = self.prepare_with_ai_policy(&definitions, &settings.ai, request)?;
        self.persist_pending_invocation(storage, &pending.id)?;
        Ok(pending)
    }

    /// 按指定工具定义快照和 AI 安全策略准备一次 AI 工具调用。
    pub fn prepare_with_ai_policy(
        &self,
        tools: &[ToolDefinition],
        ai_policy: &AiSecuritySettings,
        request: AiToolPrepareRequest,
    ) -> AppResult<AiToolPendingInvocation> {
        let tool_id = request.tool_id.trim();
        if tool_id.is_empty() {
            return Err(AppError::InvalidInput("工具 id 不能为空".to_owned()));
        }

        let tool = find_enabled_tool(tools, tool_id)?;
        let arguments = normalized_arguments(request.arguments)?;
        validate_required_arguments(&tool, &arguments)?;
        let client_action = client_action_for_invocation(&tool, &arguments)?;

        let policy_overlay = invocation_policy_overlay(&tool, &arguments);
        let effective_risk = policy_overlay.risk.unwrap_or(tool.risk);
        let effective_confirmation = effective_confirmation_policy(
            tool.confirmation,
            effective_risk,
            policy_overlay.confirmation,
            ai_policy,
        )?;
        let effective_audit = policy_overlay.audit.unwrap_or(tool.audit);

        let pending = AiToolPendingInvocation {
            id: format!("tool-call-{}", Uuid::new_v4()),
            tool_id: tool.id.clone(),
            tool_title: tool.title.clone(),
            risk: effective_risk,
            confirmation: effective_confirmation,
            audit: effective_audit,
            arguments_summary: summarize_arguments(&arguments),
            risk_summary: policy_overlay.risk_summary,
            client_action,
            reason: request.reason,
            requested_by: request.requested_by,
            requires_confirmation: effective_confirmation != ToolConfirmationPolicy::Auto,
            status: AiToolInvocationStatus::Pending,
            created_at: current_unix_timestamp(),
            conversation_id: normalize_optional_text(request.conversation_id),
            conversation_slot_json: normalize_optional_text(request.conversation_slot_json),
            run_id: normalize_optional_text(request.run_id),
            step_id: normalize_optional_text(request.step_id),
        };

        self.inner
            .pending
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ai_tool_pending"))?
            .insert(
                pending.id.clone(),
                PendingInvocationState {
                    arguments,
                    pending: pending.clone(),
                },
            );

        Ok(pending)
    }

    /// 确认并执行一次待确认工具调用。
    ///
    /// 该同步包装保留给既有 Rust 测试和非 IPC 调用方；Tauri Command 应使用
    /// [`Self::confirm_async`]，避免 SFTP 等异步本机能力阻塞 IPC worker。
    pub fn confirm(
        &self,
        context: AiToolExecutionContext<'_>,
        request: AiToolConfirmRequest,
    ) -> AppResult<AiToolAuditRecord> {
        tauri::async_runtime::block_on(self.confirm_async(context, request))
    }

    /// 异步确认并执行一次待确认工具调用。
    pub async fn confirm_async(
        &self,
        context: AiToolExecutionContext<'_>,
        request: AiToolConfirmRequest,
    ) -> AppResult<AiToolAuditRecord> {
        let invocation_id = request.invocation_id.trim();
        if invocation_id.is_empty() {
            return Err(AppError::InvalidInput("待确认调用 id 不能为空".to_owned()));
        }

        let state = self.take_pending_state(context.storage, invocation_id)?;

        let execution = if request.approved {
            execute_tool(&context, &state.pending.tool_id, &state.arguments).await
        } else {
            ToolExecutionResult {
                status: AiToolInvocationStatus::Rejected,
                result_summary: Some("用户已拒绝执行。".to_owned()),
                error: None,
                ..ToolExecutionResult::default()
            }
        };

        let audit_id = format!("tool-audit-{}", Uuid::new_v4());
        let observation = observation_from_execution(&execution, Some(audit_id.clone()));
        let audit = AiToolAuditRecord {
            id: audit_id,
            invocation_id: state.pending.id,
            tool_id: state.pending.tool_id,
            tool_title: state.pending.tool_title,
            risk: state.pending.risk,
            confirmation: state.pending.confirmation,
            arguments_summary: state.pending.arguments_summary,
            risk_summary: state.pending.risk_summary,
            status: execution.status,
            result_summary: execution.result_summary.clone(),
            error: execution.error.clone(),
            created_at: state.pending.created_at,
            completed_at: current_unix_timestamp(),
            audit_context: request.audit_context,
            observation_json: Some(serde_json::to_value(observation)?),
        };

        context.storage.insert_ai_tool_audit(&audit)?;
        context.storage.delete_ai_tool_pending(invocation_id)?;
        self.push_audit(audit.clone())?;
        Ok(audit)
    }

    /// 按当前设置和工具策略执行一次工具调用：可自动执行则执行，否则返回待审批 observation。
    pub async fn execute_if_allowed(
        &self,
        context: AiToolExecutionContext<'_>,
        tools: &ToolRegistryService,
        request: AiToolExecuteIfAllowedRequest,
    ) -> AppResult<AiToolExecuteIfAllowedResponse> {
        let audit_context = request.audit_context.clone();
        let pending = self.prepare_with_settings(
            tools,
            context.settings,
            context.storage,
            AiToolPrepareRequest::from(request),
        )?;

        if pending.requires_confirmation {
            return Ok(AiToolExecuteIfAllowedResponse {
                observation: observation_from_pending(&pending),
                pending_invocation: Some(pending),
                audit: None,
            });
        }

        let invocation_id = pending.id.clone();
        let state = self.take_pending_state(context.storage, &invocation_id)?;
        let execution = execute_tool(&context, &state.pending.tool_id, &state.arguments).await;
        let audit_id = format!("tool-audit-{}", Uuid::new_v4());
        let observation = observation_from_execution(&execution, Some(audit_id.clone()));
        let audit = AiToolAuditRecord {
            id: audit_id,
            invocation_id: state.pending.id,
            tool_id: state.pending.tool_id,
            tool_title: state.pending.tool_title,
            risk: state.pending.risk,
            confirmation: state.pending.confirmation,
            arguments_summary: state.pending.arguments_summary,
            risk_summary: state.pending.risk_summary,
            status: execution.status,
            result_summary: execution.result_summary.clone(),
            error: execution.error.clone(),
            created_at: state.pending.created_at,
            completed_at: current_unix_timestamp(),
            audit_context,
            observation_json: Some(serde_json::to_value(observation.clone())?),
        };

        context.storage.insert_ai_tool_audit(&audit)?;
        context.storage.delete_ai_tool_pending(&invocation_id)?;
        self.push_audit(audit.clone())?;

        Ok(AiToolExecuteIfAllowedResponse {
            observation,
            pending_invocation: None,
            audit: Some(audit),
        })
    }

    /// 持久化一条已准备的待确认调用，供应用重启后恢复。
    pub fn persist_pending_invocation(
        &self,
        storage: &SqliteStore,
        invocation_id: &str,
    ) -> AppResult<()> {
        let state = self
            .inner
            .pending
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ai_tool_pending"))?
            .get(invocation_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("待确认工具调用不存在: {invocation_id}")))?;
        storage.upsert_ai_tool_pending(&state.pending, &state.arguments)
    }

    /// 返回可恢复的待确认调用列表。
    pub fn list_pending(&self, storage: &SqliteStore) -> AppResult<Vec<AiToolPendingInvocation>> {
        storage.list_ai_tool_pending(MAX_AUDIT_RECORDS)
    }

    /// 更新待确认调用的 AI 会话归属信息。
    pub fn update_pending_context(
        &self,
        storage: &SqliteStore,
        request: AiToolPendingContextUpdateRequest,
    ) -> AppResult<AiToolPendingInvocation> {
        let invocation_id = request.invocation_id.trim();
        if invocation_id.is_empty() {
            return Err(AppError::InvalidInput("待确认调用 id 不能为空".to_owned()));
        }
        let conversation_id = normalize_optional_text(request.conversation_id);
        let conversation_slot_json = normalize_optional_text(request.conversation_slot_json);
        storage.update_ai_tool_pending_context(
            invocation_id,
            conversation_id.as_deref(),
            conversation_slot_json.as_deref(),
        )?;
        if let Some(state) = self
            .inner
            .pending
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ai_tool_pending"))?
            .get_mut(invocation_id)
        {
            state.pending.conversation_id = conversation_id.clone();
            state.pending.conversation_slot_json = conversation_slot_json.clone();
        }
        storage
            .ai_tool_pending_state(invocation_id)?
            .map(|(pending, _)| pending)
            .ok_or_else(|| AppError::NotFound(format!("待确认工具调用不存在: {invocation_id}")))
    }

    /// 返回最近 AI 工具调用审计记录。
    pub fn list_audits(&self, storage: &SqliteStore) -> AppResult<Vec<AiToolAuditRecord>> {
        self.list_audits_with_request(storage, None)
    }

    /// 按请求返回最近 AI 工具调用审计记录。
    pub fn list_audits_with_request(
        &self,
        storage: &SqliteStore,
        request: Option<AiToolAuditListRequest>,
    ) -> AppResult<Vec<AiToolAuditRecord>> {
        storage.list_ai_tool_audits(audit_limit(request))
    }

    /// 导出最近 AI 工具调用审计记录。
    pub fn export_audits(
        &self,
        storage: &SqliteStore,
        request: Option<AiToolAuditListRequest>,
    ) -> AppResult<AiToolAuditExport> {
        let records = self.list_audits_with_request(storage, request)?;
        Ok(AiToolAuditExport {
            exported_at: current_unix_timestamp(),
            count: records.len(),
            records,
        })
    }

    /// 清空 AI 工具调用审计记录。
    pub fn clear_audits(&self, storage: &SqliteStore) -> AppResult<AiToolAuditClearResponse> {
        let cleared_count = storage.clear_ai_tool_audits()?;
        self.inner
            .audits
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ai_tool_audits"))?
            .clear();
        Ok(AiToolAuditClearResponse { cleared_count })
    }

    fn push_audit(&self, audit: AiToolAuditRecord) -> AppResult<()> {
        let mut audits = self
            .inner
            .audits
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ai_tool_audits"))?;
        audits.push_back(audit);
        while audits.len() > MAX_AUDIT_RECORDS {
            audits.pop_front();
        }
        Ok(())
    }

    fn take_pending_state(
        &self,
        storage: &SqliteStore,
        invocation_id: &str,
    ) -> AppResult<PendingInvocationState> {
        if let Some(state) = self
            .inner
            .pending
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ai_tool_pending"))?
            .remove(invocation_id)
        {
            return Ok(state);
        }

        storage
            .ai_tool_pending_state(invocation_id)?
            .map(|(pending, arguments)| PendingInvocationState { pending, arguments })
            .ok_or_else(|| AppError::NotFound(format!("待确认工具调用不存在: {invocation_id}")))
    }
}

fn audit_limit(request: Option<AiToolAuditListRequest>) -> usize {
    request
        .and_then(|request| request.limit)
        .unwrap_or(MAX_AUDIT_RECORDS)
        .min(MAX_AUDIT_RECORDS)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

fn observation_from_pending(pending: &AiToolPendingInvocation) -> AiToolObservation {
    AiToolObservation {
        status: AiToolObservationStatus::NeedsApproval,
        summary: Some(format!("工具“{}”需要人工批准后执行。", pending.tool_title)),
        data: json!({
            "toolId": pending.tool_id,
            "risk": pending.risk,
            "confirmation": pending.confirmation,
            "argumentsSummary": pending.arguments_summary,
            "riskSummary": pending.risk_summary,
        }),
        entities: Vec::new(),
        recoverable: true,
        error_kind: None,
        next_hints: vec!["等待用户批准 pending invocation 后再继续 agent run。".to_owned()],
        pending_invocation_id: Some(pending.id.clone()),
        audit_id: None,
    }
}

fn observation_from_execution(
    execution: &ToolExecutionResult,
    audit_id: Option<String>,
) -> AiToolObservation {
    let failed = execution.status == AiToolInvocationStatus::Failed;
    let error_kind = execution
        .error_kind
        .clone()
        .or_else(|| execution.error.as_deref().map(classify_error_kind));
    AiToolObservation {
        status: match execution.status {
            AiToolInvocationStatus::Succeeded => AiToolObservationStatus::Succeeded,
            AiToolInvocationStatus::Failed => AiToolObservationStatus::Failed,
            AiToolInvocationStatus::Pending => AiToolObservationStatus::NeedsApproval,
            AiToolInvocationStatus::Rejected => AiToolObservationStatus::Blocked,
        },
        summary: execution
            .result_summary
            .clone()
            .or_else(|| execution.error.clone()),
        data: execution
            .structured_result
            .clone()
            .unwrap_or_else(|| json!({})),
        entities: execution.entities.clone(),
        recoverable: execution.recoverable
            || failed && error_kind_is_recoverable(error_kind.as_deref()),
        error_kind,
        next_hints: if execution.next_hints.is_empty() && failed {
            vec!["检查工具参数、目标 id、凭据或远程连接状态后重试。".to_owned()]
        } else {
            execution.next_hints.clone()
        },
        pending_invocation_id: None,
        audit_id,
    }
}

fn classify_error_kind(message: &str) -> String {
    if message.contains("缺少必填参数") || message.contains("参数") || message.contains("必须")
    {
        "invalidInput".to_owned()
    } else if message.contains("不存在")
        || message.contains("not found")
        || message.contains("No such")
    {
        "targetNotFound".to_owned()
    } else if message.contains("凭据") || message.contains("credential") || message.contains("认证")
    {
        "credentialRequired".to_owned()
    } else if message.contains("SFTP") || message.contains("SSH") || message.contains("远程") {
        "remoteFailure".to_owned()
    } else {
        "executionFailed".to_owned()
    }
}

fn error_kind_is_recoverable(error_kind: Option<&str>) -> bool {
    matches!(
        error_kind,
        Some("targetNotFound" | "credentialRequired" | "remoteFailure" | "executionFailed")
    )
}

#[derive(Debug, Clone)]
struct PendingInvocationState {
    pending: AiToolPendingInvocation,
    arguments: serde_json::Map<String, Value>,
}
