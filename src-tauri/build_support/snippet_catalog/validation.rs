//! 内置片段目录的构建期业务校验。

use std::collections::{BTreeMap, BTreeSet};

use super::{
    schema::{DefaultAction, Duration, RenderStrategy, Risk, VariableKind},
    CatalogError, LoadedSpec,
};

pub(super) fn validate_spec(
    loaded: &LoadedSpec,
    commands: &BTreeSet<String>,
) -> Result<(), CatalogError> {
    let path = &loaded.relative_path;
    let spec = &loaded.spec;
    if spec.schema_version != super::SUPPORTED_SCHEMA_VERSION {
        return fail(path, "schema_version", "仅支持版本 1");
    }
    for (field, value) in [
        ("id", &spec.id),
        ("catalog_version", &spec.catalog_version),
        ("pack", &spec.pack),
        ("category", &spec.category),
        ("title", &spec.title),
        ("description", &spec.description),
        ("template", &spec.template),
        ("command_spec", &spec.command_spec),
        ("source.name", &spec.source.name),
        ("source.url", &spec.source.url),
        ("owner", &spec.owner),
        ("tested_version", &spec.tested_version),
        ("updated_at", &spec.updated_at),
    ] {
        if value.trim().is_empty() {
            return fail(path, field, "不能为空");
        }
    }
    if !valid_id(&spec.id) {
        return fail(
            path,
            "id",
            "必须以 snippet.builtin. 开头且仅含小写字母、数字、点、下划线或连字符",
        );
    }
    if spec.sort_order == 0 {
        return fail(path, "sort_order", "必须大于 0");
    }
    if !valid_date(&spec.updated_at) {
        return fail(path, "updated_at", "必须是有效的 YYYY-MM-DD 日期");
    }
    if !commands.contains(&spec.command_spec) {
        return fail(path, "command_spec", "引用的 command spec 不存在");
    }
    if spec.platforms.is_empty() {
        return fail(path, "platforms", "至少声明一个平台");
    }
    if spec.shells.is_empty() {
        return fail(path, "shells", "至少声明一个 shell");
    }
    validate_unique_tokens(path, "capabilities", &spec.capabilities, valid_capability)?;
    validate_unique_tokens(path, "tags", &spec.tags, valid_tag)?;
    if spec.risk == Risk::Destructive {
        return fail(path, "risk", "内置目录禁止 destructive 片段");
    }
    if matches!(spec.risk, Risk::Change | Risk::Unknown)
        && spec.default_action == DefaultAction::Run
    {
        return fail(path, "default_action", "非 inspect 片段不得默认运行");
    }
    if spec.sensitive && spec.default_action == DefaultAction::Run {
        return fail(path, "default_action", "敏感片段不得默认运行");
    }
    if spec.template.contains("sudo ") && spec.risk == Risk::Inspect {
        return fail(path, "risk", "含 sudo 的片段风险不得为 inspect");
    }
    if contains_dangerous_pipe(&spec.template) {
        return fail(path, "template", "禁止下载内容直接管道到 shell");
    }
    if matches!(spec.duration, Duration::Instant)
        && (spec.template.contains("tail -f") || spec.template.contains("journalctl -f"))
    {
        return fail(path, "duration", "持续输出命令必须标记 streaming");
    }
    if contains_secret_literal(&spec.template) {
        return fail(path, "template", "疑似包含凭据或私钥字面量");
    }
    validate_variables(loaded)
}

pub(super) fn validate_registry(specs: &[LoadedSpec]) -> Result<(), CatalogError> {
    let mut ids = BTreeMap::new();
    let mut orders = BTreeMap::new();
    for loaded in specs {
        if let Some(existing) = ids.insert(&loaded.spec.id, &loaded.relative_path) {
            return fail(&loaded.relative_path, "id", format!("与 {existing} 重复"));
        }
        let key = (
            &loaded.spec.pack,
            &loaded.spec.category,
            loaded.spec.sort_order,
        );
        if let Some(existing) = orders.insert(key, &loaded.relative_path) {
            return fail(
                &loaded.relative_path,
                "sort_order",
                format!("同 pack/category 内与 {existing} 重复"),
            );
        }
    }
    Ok(())
}

fn validate_variables(loaded: &LoadedSpec) -> Result<(), CatalogError> {
    let mut declared = BTreeSet::new();
    for (index, variable) in loaded.spec.variables.iter().enumerate() {
        let base = format!("variables[{index}]");
        if !valid_variable(&variable.name) {
            return fail(
                &loaded.relative_path,
                format!("{base}.name"),
                "变量名必须为 snake_case 标识符",
            );
        }
        if !declared.insert(variable.name.as_str()) {
            return fail(
                &loaded.relative_path,
                format!("{base}.name"),
                "变量重复声明",
            );
        }
        if variable.label.trim().is_empty() || variable.description.trim().is_empty() {
            return fail(
                &loaded.relative_path,
                base,
                "变量必须提供 label 和 description",
            );
        }
        if variable.kind == VariableKind::Secret && variable.default_value.is_some() {
            return fail(
                &loaded.relative_path,
                format!("{base}.default_value"),
                "secret 不得提供默认值",
            );
        }
        if variable.kind == VariableKind::Secret && !variable.sensitive {
            return fail(
                &loaded.relative_path,
                format!("{base}.sensitive"),
                "secret 必须标记 sensitive",
            );
        }
        if variable.kind == VariableKind::Raw && loaded.spec.risk == Risk::Inspect {
            return fail(
                &loaded.relative_path,
                "risk",
                "raw 变量至少要求 change 风险",
            );
        }
        if variable.render_strategy == RenderStrategy::ValidatedRaw
            && variable.validation.as_deref().is_none_or(str::is_empty)
        {
            return fail(
                &loaded.relative_path,
                format!("{base}.validation"),
                "validated_raw 必须声明 validation",
            );
        }
        if variable.kind == VariableKind::Enum && variable.suggestions.is_empty() {
            return fail(
                &loaded.relative_path,
                format!("{base}.suggestions"),
                "enum 必须提供静态 suggestions",
            );
        }
        let _ = variable.required;
    }
    let referenced = extract_variables(&loaded.spec.template)?;
    if let Some(name) = referenced.difference(&declared).next() {
        return fail(
            &loaded.relative_path,
            "template",
            format!("变量 {name} 未声明"),
        );
    }
    if let Some(name) = declared.difference(&referenced).next() {
        return fail(
            &loaded.relative_path,
            "variables",
            format!("变量 {name} 未被模板使用"),
        );
    }
    validate_shell_arg_boundaries(loaded)?;
    Ok(())
}

/// shell_arg 必须独占一个 shell token，避免安全转义后的值被拼入 option 或脚本片段。
fn validate_shell_arg_boundaries(loaded: &LoadedSpec) -> Result<(), CatalogError> {
    let template = loaded.spec.template.as_str();
    let mut offset = 0;
    while let Some(relative_start) = template[offset..].find("{{") {
        let start = offset + relative_start;
        let body_start = start + 2;
        let Some(relative_end) = template[body_start..].find("}}") else {
            break;
        };
        let end = body_start + relative_end;
        let name = template[body_start..end].trim();
        let variable = loaded
            .spec
            .variables
            .iter()
            .find(|variable| variable.name == name);
        if variable.is_some_and(|variable| variable.render_strategy == RenderStrategy::ShellArg) {
            let before_ok = template[..start]
                .chars()
                .next_back()
                .is_none_or(char::is_whitespace);
            let after_ok = template[end + 2..]
                .chars()
                .next()
                .is_none_or(char::is_whitespace);
            if !before_ok || !after_ok {
                return fail(
                    &loaded.relative_path,
                    "template",
                    format!("shell_arg 变量 {name} 必须独占一个 token"),
                );
            }
        }
        offset = end + 2;
    }
    Ok(())
}

fn extract_variables(template: &str) -> Result<BTreeSet<&str>, CatalogError> {
    let mut values = BTreeSet::new();
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("}}") else {
            return Err(CatalogError::new(
                "<template>",
                "template",
                "变量占位符未闭合",
            ));
        };
        let name = rest[..end].trim();
        if !valid_variable(name) {
            return Err(CatalogError::new(
                "<template>",
                "template",
                "占位符必须是无空白 snake_case token",
            ));
        }
        values.insert(name);
        rest = &rest[end + 2..];
    }
    if rest.contains("}}") {
        return Err(CatalogError::new(
            "<template>",
            "template",
            "存在多余的占位符结束符",
        ));
    }
    Ok(values)
}

fn validate_unique_tokens(
    path: &str,
    field: &str,
    values: &[String],
    valid: fn(&str) -> bool,
) -> Result<(), CatalogError> {
    let mut seen = BTreeSet::new();
    for (index, value) in values.iter().enumerate() {
        if !valid(value) || !seen.insert(value) {
            return fail(path, format!("{field}[{index}]"), "值为空、格式非法或重复");
        }
    }
    Ok(())
}
fn valid_id(value: &str) -> bool {
    value.starts_with("snippet.builtin.")
        && value.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
        })
}
fn valid_variable(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .enumerate()
            .all(|(i, b)| b.is_ascii_lowercase() || b == b'_' || (i > 0 && b.is_ascii_digit()))
}
fn valid_capability(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
        })
}
fn valid_tag(value: &str) -> bool {
    valid_capability(value)
}
fn contains_dangerous_pipe(value: &str) -> bool {
    let v = value.to_ascii_lowercase();
    (v.contains("curl ") || v.contains("wget "))
        && ["| sh", "| bash", "| zsh", "| pwsh", "| powershell"]
            .iter()
            .any(|p| v.contains(p))
}
fn contains_secret_literal(value: &str) -> bool {
    let v = value.to_ascii_lowercase();
    if v.contains("-----begin ") {
        return true;
    }
    ["password=", "password:", "token=", "api_key=", "secret="]
        .iter()
        .filter_map(|marker| v.find(marker).map(|index| &v[index + marker.len()..]))
        .any(|tail| {
            let candidate = tail.trim_start();
            !candidate.is_empty() && !candidate.starts_with("{{")
        })
}
fn valid_date(value: &str) -> bool {
    let p = value.split('-').collect::<Vec<_>>();
    if p.len() != 3 || p[0].len() != 4 || p[1].len() != 2 || p[2].len() != 2 {
        return false;
    }
    let (Ok(y), Ok(m), Ok(d)) = (p[0].parse::<u16>(), p[1].parse::<u8>(), p[2].parse::<u8>())
    else {
        return false;
    };
    let max = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    };
    y > 0 && d > 0 && d <= max
}
fn fail<T>(
    path: &str,
    field: impl Into<String>,
    message: impl Into<String>,
) -> Result<T, CatalogError> {
    Err(CatalogError::new(path, field, message))
}
