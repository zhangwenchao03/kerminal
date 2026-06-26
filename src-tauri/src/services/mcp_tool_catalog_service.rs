//! Kerminal MCP tool catalog 服务。
//!
//! @author kongweiguang

use crate::models::mcp_server::ToolDefinition;

mod catalog;
mod schema;

use self::catalog::registered_tools;

/// 返回 Kerminal MCP tools-only 目录。
#[derive(Debug, Default)]
pub struct McpToolCatalogService;

impl McpToolCatalogService {
    /// 创建工具目录服务。
    pub fn new() -> Self {
        Self
    }

    /// 返回全部已登记工具定义。
    pub fn list_tools(&self) -> Vec<ToolDefinition> {
        registered_tools()
    }
}
