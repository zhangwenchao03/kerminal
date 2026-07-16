//! 构建期编译命令 spec 的只读运行时适配器。
//!
//! @author kongweiguang

/// 静态 spec 项的安全等级。
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum StaticSpecSensitivity {
    Normal,
    Dangerous,
    Sensitive,
}

/// 编译后的命令元数据；全部字段直接借用生成产物。
#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub(super) struct StaticCommandSpec {
    pub(super) name: &'static str,
    pub(super) aliases: &'static [&'static str],
    pub(super) description: &'static str,
    pub(super) source_name: &'static str,
    pub(super) source_url: &'static str,
    pub(super) tested_version: &'static str,
    pub(super) owner: &'static str,
    pub(super) updated_at: &'static str,
    pub(super) platform_mask: u8,
    pub(super) shell_mask: u8,
}

/// 编译后的候选项。
#[derive(Debug, Clone, Copy)]
pub(super) struct StaticSpecItem {
    pub(super) name: &'static str,
    pub(super) description: &'static str,
    pub(super) sensitivity: StaticSpecSensitivity,
    pub(super) allow_inline: bool,
}

/// 静态 bucket 类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum StaticSpecBucketKind {
    Subcommand,
    Option,
}

/// 一级命令、相对路径与候选切片的静态映射。
#[derive(Debug, Clone, Copy)]
pub(super) struct StaticSpecBucket {
    pub(super) command: &'static str,
    pub(super) path: &'static [&'static str],
    pub(super) kind: StaticSpecBucketKind,
    pub(super) items: &'static [StaticSpecItem],
}

include!(concat!(
    env!("OUT_DIR"),
    "/command_spec_registry_generated.rs"
));

/// 返回根命令候选。
pub(super) fn root_items() -> &'static [StaticSpecItem] {
    STATIC_SPEC_ROOT_ITEMS
}

/// 返回命令元数据；canonical command 使用二分查找，alias 只做冷路径线性匹配。
pub(super) fn command(command_or_alias: &str) -> Option<&'static StaticCommandSpec> {
    STATIC_SPEC_COMMANDS
        .binary_search_by_key(&command_or_alias, |spec| spec.name)
        .ok()
        .map(|index| &STATIC_SPEC_COMMANDS[index])
        .or_else(|| {
            STATIC_SPEC_COMMANDS
                .iter()
                .find(|spec| spec.aliases.contains(&command_or_alias))
        })
}

/// 返回指定命令路径的 subcommand 或 argument value。
pub(super) fn subcommand_items(
    command_or_alias: &str,
    path: &[String],
) -> &'static [StaticSpecItem] {
    bucket_items(
        command_or_alias,
        path,
        StaticSpecBucketKind::Subcommand,
        false,
    )
}

/// 返回指定命令路径的 option；没有专属 bucket 时回退到命令级 option。
pub(super) fn option_items(command_or_alias: &str, path: &[String]) -> &'static [StaticSpecItem] {
    bucket_items(command_or_alias, path, StaticSpecBucketKind::Option, true)
}

fn bucket_items(
    command_or_alias: &str,
    path: &[String],
    kind: StaticSpecBucketKind,
    fallback_to_root: bool,
) -> &'static [StaticSpecItem] {
    let Some(command) = command(command_or_alias) else {
        return &[];
    };
    let exact = STATIC_SPEC_BUCKETS.iter().find(|bucket| {
        bucket.command == command.name
            && bucket.kind == kind
            && bucket.path.len() == path.len()
            && bucket
                .path
                .iter()
                .zip(path)
                .all(|(left, right)| left == right)
    });
    if let Some(bucket) = exact {
        return bucket.items;
    }
    if fallback_to_root {
        return STATIC_SPEC_BUCKETS
            .iter()
            .find(|bucket| {
                bucket.command == command.name && bucket.kind == kind && bucket.path.is_empty()
            })
            .map_or(&[], |bucket| bucket.items);
    }
    &[]
}
