pub(super) fn terminal_write_risk_summary(data: &str) -> Option<String> {
    command_risk_summary(
        "终端写入命令风险",
        data,
        "请确认目标 session、主机和工作目录后再执行。",
    )
}

pub(super) fn ssh_command_risk_summary(command: &str) -> Option<String> {
    command_risk_summary(
        "远程命令风险",
        command,
        "请确认目标 SSH 主机、用户和工作目录后再执行。",
    )
}

pub(super) fn command_risk_summary(prefix: &str, data: &str, guidance: &str) -> Option<String> {
    let normalized = normalize_command_for_risk(data);
    if normalized.is_empty() {
        return None;
    }

    let mut findings = Vec::new();

    if contains_any(&normalized, &["rm -rf", "rm -fr", "rm -r /", "rm -rf /"]) {
        findings.push("包含递归强制删除命令");
    }
    if normalized.contains("remove-item")
        && normalized.contains("-recurse")
        && normalized.contains("-force")
    {
        findings.push("包含 PowerShell 递归强制删除命令");
    }
    if contains_any(&normalized, &["mkfs", "diskpart", "format ", "format.com"]) {
        findings.push("包含磁盘格式化或分区命令");
    }
    if contains_any(&normalized, &["sudo ", "runas "]) {
        findings.push("包含权限提升命令");
    }
    if contains_any(&normalized, &["shutdown", "reboot", "restart-computer"]) {
        findings.push("包含关机或重启命令");
    }
    if normalized.contains("dd if=") || normalized.contains("dd of=") {
        findings.push("包含原始磁盘写入命令");
    }
    if (normalized.contains("curl ") || normalized.contains("wget "))
        && contains_any(&normalized, &["| sh", "| bash", "| zsh", "| powershell"])
    {
        findings.push("包含下载脚本后直接执行");
    }
    if contains_any(
        &normalized,
        &["invoke-expression", " iex ", "|iex", "| iex"],
    ) {
        findings.push("包含 PowerShell 动态执行");
    }
    if contains_any(&normalized, &["drop database", "truncate table"]) {
        findings.push("包含数据库删除或清空操作");
    }
    if contains_any(
        &normalized,
        &[
            "kubectl delete",
            "docker system prune",
            "docker volume rm",
            "docker rm -f",
        ],
    ) {
        findings.push("包含容器或 Kubernetes 删除操作");
    }

    findings.dedup();
    if findings.is_empty() {
        None
    } else {
        Some(format!("{prefix}：{}。{guidance}", findings.join("、")))
    }
}

pub(super) fn normalize_command_for_risk(data: &str) -> String {
    format!(" {} ", data.to_ascii_lowercase())
        .replace(['\r', '\n', '\t'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}
