//! 命令建议 spec 的字段和跨项语义校验。
//!
//! @author kongweiguang

use std::collections::{BTreeMap, BTreeSet};

use super::{
    schema::{
        ArgumentKind, ArgumentSpec, CommandSpec, OptionSpec, RelationshipSpec, SafetySpec,
        Sensitivity, SubcommandSpec,
    },
    LoadedSpec, SpecError, SUPPORTED_SCHEMA_VERSION,
};

const ROOT_FIELDS: &[&str] = &[
    "schema_version",
    "command",
    "aliases",
    "platforms",
    "shells",
    "description",
    "source",
    "tested_version",
    "owner",
    "updated_at",
    "safety",
    "subcommands",
    "options",
    "arguments",
];
const SOURCE_FIELDS: &[&str] = &["name", "url"];
const SAFETY_FIELDS: &[&str] = &["sensitivity", "allow_inline", "warning"];
const SUBCOMMAND_FIELDS: &[&str] = &["name", "aliases", "path", "description", "safety"];
const OPTION_FIELDS: &[&str] = &[
    "name",
    "aliases",
    "path",
    "description",
    "argument",
    "relationships",
    "safety",
];
const ARGUMENT_FIELDS: &[&str] = &[
    "name",
    "path",
    "description",
    "kind",
    "required",
    "values",
    "relationships",
    "safety",
];
const OPTION_ARGUMENT_FIELDS: &[&str] = &["kind", "placeholder", "values"];
const RELATIONSHIP_FIELDS: &[&str] = &["conflicts_with", "requires"];

pub(super) fn validate_known_fields(relative: &str, value: &toml::Value) -> Result<(), SpecError> {
    let root = value
        .as_table()
        .ok_or_else(|| SpecError::new(relative, "schema", "顶层必须是 TOML table"))?;
    check_table_fields(relative, "", root, ROOT_FIELDS)?;
    check_optional_table(relative, root, "source", SOURCE_FIELDS)?;
    check_optional_table(relative, root, "safety", SAFETY_FIELDS)?;
    check_array_tables(relative, root, "subcommands", SUBCOMMAND_FIELDS)?;
    check_array_tables(relative, root, "options", OPTION_FIELDS)?;
    check_array_tables(relative, root, "arguments", ARGUMENT_FIELDS)?;

    for (index, item) in array_tables(relative, root, "subcommands")?
        .iter()
        .enumerate()
    {
        check_optional_table_at(
            relative,
            item,
            &format!("subcommands[{index}].safety"),
            "safety",
            SAFETY_FIELDS,
        )?;
    }
    for (index, item) in array_tables(relative, root, "options")?.iter().enumerate() {
        for (key, fields) in [
            ("argument", OPTION_ARGUMENT_FIELDS),
            ("relationships", RELATIONSHIP_FIELDS),
            ("safety", SAFETY_FIELDS),
        ] {
            check_optional_table_at(
                relative,
                item,
                &format!("options[{index}].{key}"),
                key,
                fields,
            )?;
        }
    }
    for (index, item) in array_tables(relative, root, "arguments")?
        .iter()
        .enumerate()
    {
        for (key, fields) in [
            ("relationships", RELATIONSHIP_FIELDS),
            ("safety", SAFETY_FIELDS),
        ] {
            check_optional_table_at(
                relative,
                item,
                &format!("arguments[{index}].{key}"),
                key,
                fields,
            )?;
        }
    }
    Ok(())
}

fn check_table_fields(
    relative: &str,
    field_path: &str,
    table: &toml::map::Map<String, toml::Value>,
    allowed: &[&str],
) -> Result<(), SpecError> {
    for key in table.keys() {
        if !allowed.contains(&key.as_str()) {
            let path = if field_path.is_empty() {
                key.clone()
            } else {
                format!("{field_path}.{key}")
            };
            return Err(SpecError::new(relative, path, "未知字段"));
        }
    }
    Ok(())
}

fn check_optional_table(
    relative: &str,
    root: &toml::map::Map<String, toml::Value>,
    key: &str,
    allowed: &[&str],
) -> Result<(), SpecError> {
    check_optional_table_at(relative, root, key, key, allowed)
}

fn check_optional_table_at(
    relative: &str,
    root: &toml::map::Map<String, toml::Value>,
    field_path: &str,
    key: &str,
    allowed: &[&str],
) -> Result<(), SpecError> {
    let Some(value) = root.get(key) else {
        return Ok(());
    };
    let table = value
        .as_table()
        .ok_or_else(|| SpecError::new(relative, field_path, "必须是 table"))?;
    check_table_fields(relative, field_path, table, allowed)
}

fn check_array_tables(
    relative: &str,
    root: &toml::map::Map<String, toml::Value>,
    key: &str,
    allowed: &[&str],
) -> Result<(), SpecError> {
    for (index, table) in array_tables(relative, root, key)?.iter().enumerate() {
        check_table_fields(relative, &format!("{key}[{index}]"), table, allowed)?;
    }
    Ok(())
}

fn array_tables<'a>(
    relative: &str,
    root: &'a toml::map::Map<String, toml::Value>,
    key: &str,
) -> Result<Vec<&'a toml::map::Map<String, toml::Value>>, SpecError> {
    let Some(value) = root.get(key) else {
        return Ok(Vec::new());
    };
    let array = value
        .as_array()
        .ok_or_else(|| SpecError::new(relative, key, "必须是 array"))?;
    array
        .iter()
        .enumerate()
        .map(|(index, item)| {
            item.as_table()
                .ok_or_else(|| SpecError::new(relative, format!("{key}[{index}]"), "必须是 table"))
        })
        .collect()
}

pub(super) fn validate_spec(relative: &str, spec: &CommandSpec) -> Result<(), SpecError> {
    if spec.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(SpecError::new(
            relative,
            "schema_version",
            format!(
                "仅支持版本 {SUPPORTED_SCHEMA_VERSION}，实际为 {}",
                spec.schema_version
            ),
        ));
    }
    validate_name(relative, "command", &spec.command, false)?;
    require_text(relative, "description", &spec.description)?;
    require_text(relative, "source.name", &spec.source.name)?;
    require_text(relative, "source.url", &spec.source.url)?;
    require_text(relative, "tested_version", &spec.tested_version)?;
    require_text(relative, "owner", &spec.owner)?;
    require_text(relative, "updated_at", &spec.updated_at)?;
    validate_date(relative, "updated_at", &spec.updated_at)?;
    if spec.platforms.is_empty() {
        return Err(SpecError::new(relative, "platforms", "至少声明一个平台"));
    }
    if spec.shells.is_empty() {
        return Err(SpecError::new(relative, "shells", "至少声明一个 shell"));
    }
    validate_safety(relative, "safety", &spec.safety)?;
    validate_aliases(relative, "aliases", &spec.command, &spec.aliases, false)?;

    let subcommand_paths = validate_subcommands(relative, &spec.subcommands)?;
    validate_options(relative, &spec.options, &subcommand_paths)?;
    validate_arguments(relative, &spec.arguments, &subcommand_paths)?;
    validate_relationships(relative, spec)?;
    Ok(())
}

fn require_text(relative: &str, field: &str, value: &str) -> Result<(), SpecError> {
    if value.trim().is_empty() {
        return Err(SpecError::new(relative, field, "不能为空"));
    }
    Ok(())
}

fn validate_date(relative: &str, field: &str, value: &str) -> Result<(), SpecError> {
    let valid_shape = value.len() == 10
        && value.as_bytes()[4] == b'-'
        && value.as_bytes()[7] == b'-'
        && value
            .chars()
            .enumerate()
            .all(|(index, character)| matches!(index, 4 | 7) || character.is_ascii_digit());
    if !valid_shape {
        return Err(SpecError::new(
            relative,
            field,
            "必须是有效的 YYYY-MM-DD 日期",
        ));
    }

    let year = value[0..4].parse::<u16>().unwrap_or_default();
    let month = value[5..7].parse::<u8>().unwrap_or_default();
    let day = value[8..10].parse::<u8>().unwrap_or_default();
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    };
    if year == 0 || day == 0 || day > days_in_month {
        return Err(SpecError::new(
            relative,
            field,
            "必须是有效的 YYYY-MM-DD 日期",
        ));
    }

    Ok(())
}

fn is_leap_year(year: u16) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

fn validate_name(relative: &str, field: &str, value: &str, option: bool) -> Result<(), SpecError> {
    require_text(relative, field, value)?;
    if option && !value.starts_with('-') {
        return Err(SpecError::new(relative, field, "option 必须以 '-' 开头"));
    }
    if value.chars().any(char::is_whitespace) {
        return Err(SpecError::new(relative, field, "不得包含空白字符"));
    }
    Ok(())
}

fn validate_aliases(
    relative: &str,
    field: &str,
    canonical: &str,
    aliases: &[String],
    option: bool,
) -> Result<(), SpecError> {
    let mut seen = BTreeSet::new();
    for (index, alias) in aliases.iter().enumerate() {
        validate_name(relative, &format!("{field}[{index}]"), alias, option)?;
        if alias == canonical || !seen.insert(alias) {
            return Err(SpecError::new(
                relative,
                format!("{field}[{index}]"),
                "alias 与 canonical 或同级 alias 冲突",
            ));
        }
    }
    Ok(())
}

fn validate_safety(relative: &str, field: &str, safety: &SafetySpec) -> Result<(), SpecError> {
    if safety.sensitivity != Sensitivity::Normal && safety.allow_inline {
        return Err(SpecError::new(
            relative,
            format!("{field}.allow_inline"),
            "危险或敏感项不得进入 inline",
        ));
    }
    if safety.sensitivity == Sensitivity::Dangerous
        && safety
            .warning
            .as_deref()
            .is_none_or(|warning| warning.trim().is_empty())
    {
        return Err(SpecError::new(
            relative,
            format!("{field}.warning"),
            "危险项必须提供 warning",
        ));
    }
    Ok(())
}

fn validate_subcommands(
    relative: &str,
    subcommands: &[SubcommandSpec],
) -> Result<BTreeSet<Vec<String>>, SpecError> {
    let mut known_paths = BTreeSet::new();
    let mut scoped_names = BTreeSet::new();
    let mut pending = subcommands.iter().enumerate().collect::<Vec<_>>();
    pending.sort_by_key(|(_, item)| item.path.len());
    for (index, item) in pending {
        let base = format!("subcommands[{index}]");
        validate_name(relative, &format!("{base}.name"), &item.name, false)?;
        require_text(relative, &format!("{base}.description"), &item.description)?;
        validate_aliases(
            relative,
            &format!("{base}.aliases"),
            &item.name,
            &item.aliases,
            false,
        )?;
        validate_safety(relative, &format!("{base}.safety"), &item.safety)?;
        if !item.path.is_empty() && !known_paths.contains(&item.path) {
            return Err(SpecError::new(
                relative,
                format!("{base}.path"),
                "父 subcommand path 不存在",
            ));
        }
        for name in std::iter::once(&item.name).chain(item.aliases.iter()) {
            if !scoped_names.insert((item.path.clone(), name.clone())) {
                return Err(SpecError::new(
                    relative,
                    format!("{base}.name"),
                    "同一路径下 subcommand/alias 冲突",
                ));
            }
        }
        let mut full_path = item.path.clone();
        full_path.push(item.name.clone());
        known_paths.insert(full_path);
    }
    Ok(known_paths)
}

fn validate_options(
    relative: &str,
    options: &[OptionSpec],
    subcommand_paths: &BTreeSet<Vec<String>>,
) -> Result<(), SpecError> {
    let mut scoped_names = BTreeSet::new();
    for (index, item) in options.iter().enumerate() {
        let base = format!("options[{index}]");
        validate_item_path(relative, &base, &item.path, subcommand_paths)?;
        validate_name(relative, &format!("{base}.name"), &item.name, true)?;
        require_text(relative, &format!("{base}.description"), &item.description)?;
        validate_aliases(
            relative,
            &format!("{base}.aliases"),
            &item.name,
            &item.aliases,
            true,
        )?;
        validate_safety(relative, &format!("{base}.safety"), &item.safety)?;
        if let Some(argument) = &item.argument {
            if argument.placeholder.trim().is_empty() {
                return Err(SpecError::new(
                    relative,
                    format!("{base}.argument.placeholder"),
                    "option argument 必须提供 placeholder",
                ));
            }
            if matches!(argument.kind, ArgumentKind::Enum) && argument.values.is_empty() {
                return Err(SpecError::new(
                    relative,
                    format!("{base}.argument.values"),
                    "enum argument 必须提供 values",
                ));
            }
        }
        for name in std::iter::once(&item.name).chain(item.aliases.iter()) {
            if !scoped_names.insert((item.path.clone(), name.clone())) {
                return Err(SpecError::new(
                    relative,
                    format!("{base}.name"),
                    "同一路径下 option/alias 冲突",
                ));
            }
        }
    }
    Ok(())
}

fn validate_arguments(
    relative: &str,
    arguments: &[ArgumentSpec],
    subcommand_paths: &BTreeSet<Vec<String>>,
) -> Result<(), SpecError> {
    let mut scoped_names = BTreeSet::new();
    for (index, item) in arguments.iter().enumerate() {
        let base = format!("arguments[{index}]");
        validate_item_path(relative, &base, &item.path, subcommand_paths)?;
        validate_name(relative, &format!("{base}.name"), &item.name, false)?;
        require_text(relative, &format!("{base}.description"), &item.description)?;
        validate_safety(relative, &format!("{base}.safety"), &item.safety)?;
        if !scoped_names.insert((item.path.clone(), item.name.clone())) {
            return Err(SpecError::new(
                relative,
                format!("{base}.name"),
                "同一路径下 argument 重复",
            ));
        }
        if matches!(item.kind, ArgumentKind::Enum) && item.values.is_empty() {
            return Err(SpecError::new(
                relative,
                format!("{base}.values"),
                "enum argument 必须提供 values",
            ));
        }
        let mut values = BTreeSet::new();
        for (value_index, value) in item.values.iter().enumerate() {
            if value.trim().is_empty() || !values.insert(value) {
                return Err(SpecError::new(
                    relative,
                    format!("{base}.values[{value_index}]"),
                    "argument value 不能为空或重复",
                ));
            }
        }
        let _ = item.required;
    }
    Ok(())
}

fn validate_item_path(
    relative: &str,
    base: &str,
    path: &[String],
    subcommand_paths: &BTreeSet<Vec<String>>,
) -> Result<(), SpecError> {
    if !path.is_empty() && !subcommand_paths.contains(path) {
        return Err(SpecError::new(
            relative,
            format!("{base}.path"),
            "引用的 subcommand path 不存在",
        ));
    }
    Ok(())
}

fn validate_relationships(relative: &str, spec: &CommandSpec) -> Result<(), SpecError> {
    for (index, item) in spec.options.iter().enumerate() {
        validate_item_relationships(
            relative,
            &format!("options[{index}]"),
            &item.name,
            &item.aliases,
            &item.path,
            &item.relationships,
            &spec.options,
        )?;
    }
    for (index, item) in spec.arguments.iter().enumerate() {
        validate_item_relationships(
            relative,
            &format!("arguments[{index}]"),
            &item.name,
            &[],
            &item.path,
            &item.relationships,
            &spec.options,
        )?;
    }
    Ok(())
}

fn validate_item_relationships(
    relative: &str,
    base: &str,
    item_name: &str,
    item_aliases: &[String],
    path: &[String],
    relationships: &RelationshipSpec,
    options: &[OptionSpec],
) -> Result<(), SpecError> {
    let available = options
        .iter()
        .filter(|option| option.path.is_empty() || option.path == path)
        .flat_map(|option| std::iter::once(&option.name).chain(option.aliases.iter()))
        .collect::<BTreeSet<_>>();
    let conflicts = relationships.conflicts_with.iter().collect::<BTreeSet<_>>();
    for (kind, targets) in [
        ("conflicts_with", &relationships.conflicts_with),
        ("requires", &relationships.requires),
    ] {
        let mut seen = BTreeSet::new();
        for (index, target) in targets.iter().enumerate() {
            let field = format!("{base}.relationships.{kind}[{index}]");
            if target == item_name || item_aliases.contains(target) {
                return Err(SpecError::new(relative, field, "关系不得引用自身"));
            }
            if !seen.insert(target) {
                return Err(SpecError::new(relative, field, "关系目标重复"));
            }
            if !available.contains(target) {
                return Err(SpecError::new(
                    relative,
                    field,
                    "关系目标不存在或路径不可见",
                ));
            }
            if kind == "requires" && conflicts.contains(target) {
                return Err(SpecError::new(
                    relative,
                    field,
                    "同一目标不能同时 requires 与 conflicts_with",
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_registry(specs: &[LoadedSpec]) -> Result<(), SpecError> {
    let mut identities = BTreeMap::<String, (&str, String)>::new();
    for loaded in specs {
        insert_registry_identity(&mut identities, loaded, "command", &loaded.spec.command)?;
        for (index, alias) in loaded.spec.aliases.iter().enumerate() {
            insert_registry_identity(&mut identities, loaded, &format!("aliases[{index}]"), alias)?;
        }
    }
    Ok(())
}

fn insert_registry_identity<'a>(
    identities: &mut BTreeMap<String, (&'a str, String)>,
    loaded: &'a LoadedSpec,
    field: &str,
    identity: &str,
) -> Result<(), SpecError> {
    if let Some((existing_path, existing_field)) = identities.insert(
        identity.to_owned(),
        (&loaded.relative_path, field.to_owned()),
    ) {
        return Err(SpecError::new(
            &loaded.relative_path,
            field,
            format!("命令或 alias 与 {existing_path}: {existing_field} 冲突"),
        ));
    }
    Ok(())
}
