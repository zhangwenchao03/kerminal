use std::{collections::HashSet, fs, path::Path};

use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConfigValidationScope {
    All,
    Settings,
    Profiles,
    Hosts,
    Snippets,
    Workflows,
}

impl ConfigValidationScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Settings => "settings",
            Self::Profiles => "profiles",
            Self::Hosts => "hosts",
            Self::Snippets => "snippets",
            Self::Workflows => "workflows",
        }
    }

    fn includes(self, scope: Self) -> bool {
        self == Self::All || self == scope
    }
}

pub(super) fn execute_config_validate(
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let scope = match config_validation_scope_from_arguments(arguments) {
        Ok(scope) => scope,
        Err(error) => return failure(error.to_string()),
    };
    let store = ConfigFileStore::new(paths.root.clone());
    let mut report = ConfigValidationReport::new(scope);

    if scope.includes(ConfigValidationScope::Settings) {
        validate_settings(&store, &mut report);
    }
    if scope.includes(ConfigValidationScope::Profiles) {
        validate_profiles(&store, &mut report);
    }
    if scope.includes(ConfigValidationScope::Hosts) {
        validate_hosts(&store, paths.root.as_path(), &mut report);
    }
    if scope.includes(ConfigValidationScope::Snippets) {
        validate_snippets(&store, &mut report);
    }
    if scope.includes(ConfigValidationScope::Workflows) {
        validate_workflows(&store, &mut report);
    }

    let error_count = report.error_count();
    let warning_count = report.warning_count();
    let summary = if error_count == 0 {
        format!(
            "Kerminal 配置校验通过：范围 {}，检查 {} 项，提示 {} 项。",
            scope.as_str(),
            report.checked.len(),
            warning_count
        )
    } else {
        format!(
            "Kerminal 配置校验发现 {error_count} 个问题和 {warning_count} 个提示：范围 {}，检查 {} 项。",
            scope.as_str(),
            report.checked.len()
        )
    };

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(summary),
        error: None,
        structured_result: Some(report.into_json()),
        ..ToolExecutionResult::default()
    }
}

fn config_validation_scope_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<ConfigValidationScope> {
    let Some(scope) = optional_string_arg(arguments, "scope")? else {
        return Ok(ConfigValidationScope::All);
    };
    match scope.trim() {
        "" | "all" => Ok(ConfigValidationScope::All),
        "settings" => Ok(ConfigValidationScope::Settings),
        "profiles" => Ok(ConfigValidationScope::Profiles),
        "hosts" => Ok(ConfigValidationScope::Hosts),
        "snippets" => Ok(ConfigValidationScope::Snippets),
        "workflows" => Ok(ConfigValidationScope::Workflows),
        other => Err(AppError::InvalidInput(format!(
            "scope 只支持 all、settings、profiles、hosts、snippets、workflows，当前为 {other}"
        ))),
    }
}

fn validate_settings(store: &ConfigFileStore, report: &mut ConfigValidationReport) {
    match store.read_settings() {
        Ok(_) => report.checked("settings", "settings.toml", "settings loaded"),
        Err(error) => report.error("settings", "settings.toml", error.to_string()),
    }
}

fn validate_profiles(store: &ConfigFileStore, report: &mut ConfigValidationReport) {
    let groups = remote_host_group_ids(store, report);
    match store.list_profiles() {
        Ok(profiles) => {
            report.checked(
                "profiles",
                "profiles/*.toml",
                format!("{} profile(s) loaded", profiles.len()),
            );
            for profile in profiles {
                if let Some(group_id) = profile.sidebar_group_id.as_deref() {
                    if !groups.contains(group_id) {
                        report.error(
                            "profiles",
                            format!("profiles/{}.toml", profile.id),
                            format!(
                                "sidebar_group_id `{group_id}` does not reference hosts/groups.toml"
                            ),
                        );
                    }
                }
            }
        }
        Err(error) => report.error("profiles", "profiles/*.toml", error.to_string()),
    }
}

fn validate_hosts(store: &ConfigFileStore, root: &Path, report: &mut ConfigValidationReport) {
    let groups = match store.list_remote_host_groups() {
        Ok(groups) => {
            let mut seen = HashSet::new();
            for group in &groups {
                if !seen.insert(group.id.clone()) {
                    report.error(
                        "hosts",
                        "hosts/groups.toml",
                        format!("duplicate group id `{}`", group.id),
                    );
                }
            }
            report.checked(
                "hosts",
                "hosts/groups.toml",
                format!("{} group(s) loaded", groups.len()),
            );
            seen
        }
        Err(error) => {
            report.error("hosts", "hosts/groups.toml", error.to_string());
            HashSet::new()
        }
    };

    validate_host_public_files_are_explicit(root, report);
    validate_host_gitignore_rules(root, report);

    match store.list_remote_host_metadata() {
        Ok(hosts) => {
            report.checked(
                "hosts",
                "hosts/*.toml",
                format!("{} public host file(s) loaded", hosts.len()),
            );
            for host in hosts {
                if let Some(group_id) = host.group_id.as_deref() {
                    if !groups.contains(group_id) {
                        report.error(
                            "hosts",
                            format!("hosts/{}.toml", host.id),
                            format!("group_id `{group_id}` does not reference hosts/groups.toml"),
                        );
                    }
                }
            }
        }
        Err(error) => report.error("hosts", "hosts/*.toml", error.to_string()),
    }
}

fn validate_host_public_files_are_explicit(root: &Path, report: &mut ConfigValidationReport) {
    let host_dir = root.join("hosts");
    let entries = match fs::read_dir(&host_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            report.error("hosts", "hosts", error.to_string());
            return;
        }
    };

    for entry in entries.filter_map(Result::ok) {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if !file_name.ends_with(".toml") || file_name == "groups.toml" {
            continue;
        }
        let display_path = format!("hosts/{file_name}");
        let source = match fs::read_to_string(entry.path()) {
            Ok(source) => source,
            Err(error) => {
                report.error("hosts", display_path, error.to_string());
                continue;
            }
        };
        let parsed = match toml::from_str::<toml::Value>(&source) {
            Ok(parsed) => parsed,
            Err(_) => {
                continue;
            }
        };
        match parsed.get("production") {
            Some(toml::Value::Boolean(_)) => {}
            Some(_) => report.error(
                "hosts",
                display_path,
                "production must be a boolean and explicitly set to true or false",
            ),
            None => report.warning(
                "hosts",
                display_path,
                "production must be explicitly set to true or false",
            ),
        }
    }
}

fn validate_host_gitignore_rules(root: &Path, report: &mut ConfigValidationReport) {
    let gitignore_path = root.join(".gitignore");
    let source = match fs::read_to_string(&gitignore_path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            report.error(
                "hosts",
                ".gitignore",
                "missing .gitignore; add secrets/vault-key.toml",
            );
            return;
        }
        Err(error) => {
            report.error("hosts", ".gitignore", error.to_string());
            return;
        }
    };
    for rule in ["secrets/vault-key.toml"] {
        if !gitignore_contains_rule(&source, rule) {
            report.error(
                "hosts",
                ".gitignore",
                format!("missing required Kerminal secret ignore rule `{rule}`"),
            );
        }
    }
}

fn gitignore_contains_rule(source: &str, rule: &str) -> bool {
    source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .any(|line| line == rule)
}

fn validate_snippets(store: &ConfigFileStore, report: &mut ConfigValidationReport) {
    match store.list_snippets() {
        Ok(snippets) => report.checked(
            "snippets",
            "snippets/*.toml",
            format!("{} snippet(s) loaded", snippets.len()),
        ),
        Err(error) => report.error("snippets", "snippets/*.toml", error.to_string()),
    }
}

fn validate_workflows(store: &ConfigFileStore, report: &mut ConfigValidationReport) {
    match store.list_workflows() {
        Ok(workflows) => {
            report.checked(
                "workflows",
                "workflows/*.toml",
                format!("{} workflow(s) loaded", workflows.len()),
            );
            for workflow in workflows {
                let mut step_ids = HashSet::new();
                let mut previous_sort_order = None;
                for step in &workflow.steps {
                    if !step_ids.insert(step.id.clone()) {
                        report.error(
                            "workflows",
                            format!("workflows/{}.toml", workflow.id),
                            format!("duplicate workflow step id `{}`", step.id),
                        );
                    }
                    if let Some(previous) = previous_sort_order {
                        if step.sort_order <= previous {
                            report.error(
                                "workflows",
                                format!("workflows/{}.toml", workflow.id),
                                format!(
                                    "workflow step `{}` sort_order must increase after {previous}",
                                    step.id
                                ),
                            );
                        }
                    }
                    previous_sort_order = Some(step.sort_order);
                }
            }
        }
        Err(error) => report.error("workflows", "workflows/*.toml", error.to_string()),
    }
}

fn remote_host_group_ids(
    store: &ConfigFileStore,
    report: &mut ConfigValidationReport,
) -> HashSet<String> {
    match store.list_remote_host_groups() {
        Ok(groups) => groups.into_iter().map(|group| group.id).collect(),
        Err(error) => {
            report.error("hosts", "hosts/groups.toml", error.to_string());
            HashSet::new()
        }
    }
}

#[derive(Debug)]
struct ConfigValidationReport {
    scope: ConfigValidationScope,
    checked: Vec<Value>,
    diagnostics: Vec<Value>,
    error_count: usize,
    warning_count: usize,
}

impl ConfigValidationReport {
    fn new(scope: ConfigValidationScope) -> Self {
        Self {
            scope,
            checked: Vec::new(),
            diagnostics: Vec::new(),
            error_count: 0,
            warning_count: 0,
        }
    }

    fn checked(
        &mut self,
        scope: impl Into<String>,
        path: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.checked.push(json!({
            "scope": scope.into(),
            "path": path.into(),
            "message": message.into(),
        }));
    }

    fn error(
        &mut self,
        scope: impl Into<String>,
        path: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.error_count += 1;
        self.diagnostics.push(json!({
            "severity": "error",
            "scope": scope.into(),
            "path": path.into(),
            "message": message.into(),
        }));
    }

    fn warning(
        &mut self,
        scope: impl Into<String>,
        path: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.warning_count += 1;
        self.diagnostics.push(json!({
            "severity": "warning",
            "scope": scope.into(),
            "path": path.into(),
            "message": message.into(),
        }));
    }

    fn error_count(&self) -> usize {
        self.error_count
    }

    fn warning_count(&self) -> usize {
        self.warning_count
    }

    fn into_json(self) -> Value {
        let error_count = self.error_count();
        let warning_count = self.warning_count();
        json!({
            "valid": error_count == 0,
            "scope": self.scope.as_str(),
            "errorCount": error_count,
            "warningCount": warning_count,
            "checked": self.checked,
            "diagnostics": self.diagnostics,
        })
    }
}
