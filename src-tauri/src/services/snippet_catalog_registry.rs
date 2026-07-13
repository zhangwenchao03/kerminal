//! 构建期编译片段目录的只读运行时适配器。
//!
//! @author kongweiguang

/// 编译后的变量声明；所有文本均借用生成产物，不在运行时解析 TOML。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaticSnippetVariable {
    pub name: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub kind: &'static str,
    pub required: bool,
    pub default_value: Option<&'static str>,
    pub suggestions: &'static [&'static str],
    pub validation: Option<&'static str>,
    pub render_strategy: &'static str,
    pub sensitive: bool,
}

/// 编译后的内置片段目录项。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaticSnippetCatalogItem {
    pub id: &'static str,
    pub catalog_version: &'static str,
    pub pack: &'static str,
    pub category: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub template: &'static str,
    pub command_spec: &'static str,
    pub owner: &'static str,
    pub tested_version: &'static str,
    pub updated_at: &'static str,
    pub sort_order: i64,
    pub capabilities: &'static [&'static str],
    pub tags: &'static [&'static str],
    pub sensitive: bool,
    pub deprecated: bool,
    pub source_name: &'static str,
    pub source_url: &'static str,
    pub scope: &'static str,
    pub platform_mask: u8,
    pub shell_mask: u8,
    pub risk: &'static str,
    pub duration: &'static str,
    pub default_action: &'static str,
    pub variables: &'static [StaticSnippetVariable],
}

include!(concat!(env!("OUT_DIR"), "/snippet_catalog_generated.rs"));

/// 返回按 pack/category/order/id 稳定排序的只读目录。
pub fn all() -> &'static [StaticSnippetCatalogItem] {
    STATIC_SNIPPET_CATALOG
}

/// 按稳定 ID 查找片段。目录规模有界，首版线性扫描避免额外运行时索引状态。
pub fn by_id(id: &str) -> Option<&'static StaticSnippetCatalogItem> {
    STATIC_SNIPPET_CATALOG.iter().find(|item| item.id == id)
}
