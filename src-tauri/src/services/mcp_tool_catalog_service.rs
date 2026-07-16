//! Kerminal MCP tool catalog 服务。
//!
//! @author kongweiguang

use crate::models::mcp_server::ToolDefinition;

mod catalog;
mod registry;
mod schema;

use self::catalog::registered_tools;
pub use self::registry::{ToolDescriptor, ToolId};

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
        self.list_descriptors()
            .into_iter()
            .map(ToolDescriptor::into_definition)
            .collect()
    }

    /// 返回全部强类型工具描述，顺序与公开 catalog 一致。
    pub fn list_descriptors(&self) -> Vec<ToolDescriptor> {
        registered_tools()
    }
}
