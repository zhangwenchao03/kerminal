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
use serde_json::Value;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        ai_tool_invocation::{
            AiToolAuditClearResponse, AiToolAuditExport, AiToolAuditListRequest, AiToolAuditRecord,
            AiToolClientAction, AiToolClientActionKind, AiToolConfirmRequest,
            AiToolInvocationStatus, AiToolPendingInvocation, AiToolPrepareRequest,
        },
        command_history::{
            CommandHistoryListRequest, CommandHistoryRecordRequest, CommandHistorySource,
            CommandHistoryTarget,
        },
        connection::{RdpOpenRequest, RdpOpenResult},
        diagnostics::{DiagnosticBundle, RuntimeHealthSnapshot},
        llm_provider::{
            LlmProvider, LlmProviderCreateRequest, LlmProviderTestResult, LlmProviderUpdateRequest,
        },
        port_forward::{
            PortForwardCreateRequest, PortForwardKind, PortForwardStatus, PortForwardSummary,
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
            SftpTransferDirection, SftpTransferKind, SftpTransferRequest, SftpTransferStatus,
            SftpTransferSummary,
        },
        snippet::{
            CommandSnippet, SnippetCreateRequest, SnippetListRequest, SnippetScope,
            SnippetUpdateRequest,
        },
        ssh_command::{SshCommandOutput, SshCommandRequest},
        terminal::{TerminalResizeRequest, TerminalSessionLogState, TerminalSessionSummary},
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
        tool_registry_service::ToolRegistryService,
        workflow_service::WorkflowService,
    },
    storage::SqliteStore,
};

mod arguments;
mod audit_text;
mod client_actions;
mod clock;
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
    arguments::*, audit_text::*, client_actions::*, clock::*, content_tools::*,
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
    /// SSH 端口转发服务。
    pub port_forwards: &'a PortForwardService,
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
        self.prepare_with_ai_policy(&definitions, &settings.ai, request)
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

        let state = self
            .inner
            .pending
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ai_tool_pending"))?
            .remove(invocation_id)
            .ok_or_else(|| AppError::NotFound(format!("待确认工具调用不存在: {invocation_id}")))?;

        let execution = if request.approved {
            execute_tool(&context, &state.pending.tool_id, &state.arguments).await
        } else {
            ToolExecutionResult {
                status: AiToolInvocationStatus::Rejected,
                result_summary: Some("用户已拒绝执行。".to_owned()),
                error: None,
            }
        };

        let audit = AiToolAuditRecord {
            id: format!("tool-audit-{}", Uuid::new_v4()),
            invocation_id: state.pending.id,
            tool_id: state.pending.tool_id,
            tool_title: state.pending.tool_title,
            risk: state.pending.risk,
            confirmation: state.pending.confirmation,
            arguments_summary: state.pending.arguments_summary,
            risk_summary: state.pending.risk_summary,
            status: execution.status,
            result_summary: execution.result_summary,
            error: execution.error,
            created_at: state.pending.created_at,
            completed_at: current_unix_timestamp(),
        };

        context.storage.insert_ai_tool_audit(&audit)?;
        self.push_audit(audit.clone())?;
        Ok(audit)
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
}

fn audit_limit(request: Option<AiToolAuditListRequest>) -> usize {
    request
        .and_then(|request| request.limit)
        .unwrap_or(MAX_AUDIT_RECORDS)
        .min(MAX_AUDIT_RECORDS)
}

#[derive(Debug, Clone)]
struct PendingInvocationState {
    pending: AiToolPendingInvocation,
    arguments: serde_json::Map<String, Value>,
}
