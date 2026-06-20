//! Kerminal Tool Registry 服务。
//!
//! @author kongweiguang

use crate::models::tool_registry::ToolDefinition;

mod catalog;
mod schema;

use self::catalog::registered_tools;

/// 返回 Kerminal 内部稳定工具目录。
#[derive(Debug, Default)]
pub struct ToolRegistryService;

impl ToolRegistryService {
    /// 创建工具目录服务。
    pub fn new() -> Self {
        Self
    }

    /// 返回全部已登记工具定义。
    pub fn list_tools(&self) -> Vec<ToolDefinition> {
        registered_tools()
    }
}
