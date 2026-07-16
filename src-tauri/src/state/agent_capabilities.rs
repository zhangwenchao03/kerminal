//! AppState 的 Agent 与命令辅助能力组合。

use crate::{
    error::AppResult,
    paths::KerminalPaths,
    services::{
        agent_context_service::AgentContextService, agent_session_service::AgentSessionService,
        command_history_service::CommandHistoryService,
        command_suggestion_service::CommandSuggestionService,
    },
};

use super::AppStateExternalPorts;

/// Agent workspace/session 与命令辅助能力集合。
#[derive(Debug)]
pub(super) struct AgentCapabilities {
    pub(super) agent_context: AgentContextService,
    pub(super) agent_sessions: AgentSessionService,
    pub(super) command_history: CommandHistoryService,
    pub(super) command_suggestions: CommandSuggestionService,
}

impl AgentCapabilities {
    /// 准备外部 Agent workspace 后再暴露依赖该目录的进程内服务。
    pub(super) fn initialize(
        paths: &KerminalPaths,
        external_ports: &dyn AppStateExternalPorts,
    ) -> AppResult<Self> {
        external_ports.prepare_agent_workspace(paths)?;
        Ok(Self {
            agent_context: AgentContextService::new(),
            agent_sessions: AgentSessionService::new(paths.root.clone()),
            command_history: CommandHistoryService::new(),
            command_suggestions: CommandSuggestionService::new(),
        })
    }
}
