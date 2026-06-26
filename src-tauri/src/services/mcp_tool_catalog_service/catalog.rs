//! MCP tools-only catalog 目录。
//!
//! @author kongweiguang

mod automation;
mod container;
mod foundation;
mod remote;
mod sftp;

use crate::models::mcp_server::ToolDefinition;

pub(super) fn registered_tools() -> Vec<ToolDefinition> {
    let mut tools = Vec::new();
    tools.extend(foundation::foundation_tools());
    tools.extend(remote::remote_tools());
    tools.extend(sftp::sftp_tools());
    tools.extend(container::container_tools());
    tools.extend(automation::automation_tools());
    tools
}
