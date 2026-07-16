//! AppState 的 MCP 能力组合。

use crate::services::{
    mcp_streamable_http_server::McpStreamableHttpServerService,
    mcp_tool_catalog_service::McpToolCatalogService,
    mcp_tool_executor_service::McpToolExecutorService,
};

/// MCP catalog、executor 与 HTTP 生命周期能力集合。
#[derive(Debug)]
pub(super) struct McpCapabilities {
    pub(super) http_server: McpStreamableHttpServerService,
    pub(super) tool_catalog: McpToolCatalogService,
    pub(super) tool_executor: McpToolExecutorService,
}

impl McpCapabilities {
    pub(super) fn new() -> Self {
        Self {
            http_server: McpStreamableHttpServerService::new(),
            tool_catalog: McpToolCatalogService::new(),
            tool_executor: McpToolExecutorService::new(),
        }
    }
}
