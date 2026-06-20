//! AI 工具调用受控执行服务集成测试。
//!
//! @author kongweiguang

mod ai_tool_invocation_service {
    mod diagnostics_client;
    mod local_management_gateway;
    mod local_resources;
    mod port_forward_protocol;
    mod prepare_policy;
    mod registry_contract;
    mod settings_terminal_audit;
    mod sftp_path_mutations;
    mod sftp_read_protocol;
    mod sftp_transfer_delete;
    pub(crate) mod support;
}
