use super::*;

pub(super) fn execute_profile_list(
    profiles: &ProfileService,
    storage: &SqliteStore,
) -> ToolExecutionResult {
    match profiles.list_profiles(storage) {
        Ok(profiles) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_profiles_for_ai(&profiles)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_profile_detect_shells(profiles: &ProfileService) -> ToolExecutionResult {
    let candidates = profiles.detect_shells();
    ToolExecutionResult {
        status: AiToolInvocationStatus::Succeeded,
        result_summary: Some(summarize_shell_candidates_for_ai(&candidates)),
        error: None,
    }
}

pub(super) fn execute_profile_update(
    profiles: &ProfileService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<ProfileUpdateRequest>(arguments, "profile.update")
    {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match profiles.update_profile(storage, request) {
        Ok(profile) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_profile_write_for_ai("已更新", &profile)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_profile_delete(
    profiles: &ProfileService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let profile_id = match required_string_arg(arguments, "profileId") {
        Ok(profile_id) => profile_id,
        Err(error) => return failure(error.to_string()),
    };

    match profiles.delete_profile(storage, &profile_id) {
        Ok(true) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "终端配置已删除：{}。",
                truncate_string(&profile_id)
            )),
            error: None,
        },
        Ok(false) => failure(format!("终端配置不存在或未删除：{profile_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_profiles_for_ai(profiles: &[TerminalProfile]) -> String {
    if profiles.is_empty() {
        return "当前没有本地终端配置。".to_owned();
    }

    let samples = profiles
        .iter()
        .take(5)
        .map(|profile| {
            format!(
                "{}（shell={}，默认={}，id={}）",
                profile.name,
                truncate_string(&profile.shell),
                if profile.is_default { "是" } else { "否" },
                profile.id
            )
        })
        .collect::<Vec<_>>()
        .join("；");
    format!(
        "当前共有 {} 个终端配置。示例：{}。",
        profiles.len(),
        samples
    )
}

pub(super) fn summarize_shell_candidates_for_ai(candidates: &[ShellCandidate]) -> String {
    if candidates.is_empty() {
        return "未探测到可用 shell 候选。".to_owned();
    }

    let samples = candidates
        .iter()
        .take(8)
        .map(|candidate| {
            format!(
                "{}（{}，可用={}，默认候选={}）",
                candidate.name,
                truncate_string(&candidate.shell),
                if candidate.is_available { "是" } else { "否" },
                if candidate.is_default { "是" } else { "否" }
            )
        })
        .collect::<Vec<_>>()
        .join("；");
    format!(
        "探测到 {} 个 shell 候选。示例：{}。",
        candidates.len(),
        samples
    )
}

pub(super) fn summarize_profile_write_for_ai(action: &str, profile: &TerminalProfile) -> String {
    format!(
        "终端配置“{}”{}，shell: {}，默认：{}，id={}。",
        profile.name,
        action,
        truncate_string(&profile.shell),
        if profile.is_default { "是" } else { "否" },
        profile.id
    )
}

pub(super) fn execute_remote_host_group_list(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
) -> ToolExecutionResult {
    match remote_hosts.list_groups(storage) {
        Ok(groups) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_remote_host_groups_for_ai(&groups)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_remote_host_tree(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
) -> ToolExecutionResult {
    match remote_hosts.list_tree(storage) {
        Ok(tree) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_remote_host_tree_for_ai(&tree)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_remote_host_group_create(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<RemoteHostGroupCreateRequest>(
        arguments,
        "remote_host.group_create",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match remote_hosts.create_group(storage, request) {
        Ok(group) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "远程主机分组“{}”已创建，id={}。",
                group.name, group.id
            )),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_remote_host_group_update(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<RemoteHostGroupUpdateRequest>(
        arguments,
        "remote_host.group_update",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match remote_hosts.update_group(storage, request) {
        Ok(group) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "远程主机分组“{}”已更新，id={}。",
                group.name, group.id
            )),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_remote_host_group_delete(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let group_id = match required_string_arg(arguments, "groupId") {
        Ok(group_id) => group_id,
        Err(error) => return failure(error.to_string()),
    };

    match remote_hosts.delete_group(storage, &group_id) {
        Ok(true) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "远程主机分组已删除：{}；组内主机已移动到默认分组。",
                truncate_string(&group_id)
            )),
            error: None,
        },
        Ok(false) => failure(format!("远程主机分组不存在或未删除：{group_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_remote_host_update(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match remote_host_update_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match remote_hosts.update_host(storage, request) {
        Ok(host) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_remote_host_write_for_ai("已更新", &host)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_remote_host_delete(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let host_id = match required_string_arg(arguments, "hostId") {
        Ok(host_id) => host_id,
        Err(error) => return failure(error.to_string()),
    };

    match remote_hosts.delete_host(storage, &host_id) {
        Ok(true) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!("远程主机已删除：{}。", truncate_string(&host_id))),
            error: None,
        },
        Ok(false) => failure(format!("远程主机不存在或未删除：{host_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn remote_host_update_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<RemoteHostUpdateRequest> {
    let Some(port) = number_to_u16(arguments.get("port")) else {
        return Err(AppError::InvalidInput(
            "port 必须是 1 到 65535 的数字。".to_owned(),
        ));
    };

    Ok(RemoteHostUpdateRequest {
        id: required_string_arg(arguments, "id")?,
        group_id: optional_string_arg(arguments, "groupId")?,
        name: required_string_arg(arguments, "name")?,
        host: required_string_arg(arguments, "host")?,
        port,
        username: required_string_arg(arguments, "username")?,
        auth_type: optional_remote_host_auth_type_arg(arguments)?,
        credential_ref: optional_string_arg(arguments, "credentialRef")?,
        credential_secret: None,
        tags: optional_string_array_arg(arguments, "tags")?,
        production: optional_bool_arg(arguments, "production")?,
        ssh_options: Default::default(),
        sort_order: required_i64_arg(arguments, "sortOrder")?,
    })
}

pub(super) fn summarize_remote_host_groups_for_ai(groups: &[RemoteHostGroup]) -> String {
    if groups.is_empty() {
        return "当前没有远程主机分组。".to_owned();
    }

    let samples = groups
        .iter()
        .take(8)
        .map(|group| format!("{}（id={}）", group.name, group.id))
        .collect::<Vec<_>>()
        .join("；");
    format!(
        "当前共有 {} 个远程主机分组。示例：{}。",
        groups.len(),
        samples
    )
}

pub(super) fn summarize_remote_host_tree_for_ai(tree: &[RemoteHostGroupWithHosts]) -> String {
    if tree.is_empty() {
        return "当前没有远程主机。".to_owned();
    }

    let host_count = tree.iter().map(|group| group.hosts.len()).sum::<usize>();
    let samples = tree
        .iter()
        .take(5)
        .map(|group| format!("{}：{} 台", group.name, group.hosts.len()))
        .collect::<Vec<_>>()
        .join("；");
    format!(
        "当前远程主机树包含 {} 个分组、{} 台主机。示例：{}。",
        tree.len(),
        host_count,
        samples
    )
}

pub(super) fn summarize_remote_host_write_for_ai(action: &str, host: &RemoteHost) -> String {
    let production_label = if host.production {
        "，生产主机"
    } else {
        ""
    };
    format!(
        "远程主机“{}”{}：{}@{}:{}，认证 {:?}，凭据 {}{}，id={}。",
        host.name,
        action,
        host.username,
        host.host,
        host.port,
        host.auth_type,
        if host.credential_ref.is_some() {
            "已配置"
        } else {
            "未配置"
        },
        production_label,
        host.id
    )
}

pub(super) fn execute_remote_host_create(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match remote_host_create_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match remote_hosts.create_host(storage, request) {
        Ok(host) => {
            let production_label = if host.production {
                "，已标记为生产主机"
            } else {
                ""
            };
            ToolExecutionResult {
                status: AiToolInvocationStatus::Succeeded,
                result_summary: Some(format!(
                    "远程主机“{}”已创建：{}@{}:{}{}。",
                    host.name, host.username, host.host, host.port, production_label
                )),
                error: None,
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn remote_host_create_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<RemoteHostCreateRequest> {
    let Some(port) = number_to_u16(arguments.get("port")) else {
        return Err(AppError::InvalidInput(
            "port 必须是 1 到 65535 的数字。".to_owned(),
        ));
    };

    Ok(RemoteHostCreateRequest {
        group_id: optional_string_arg(arguments, "groupId")?,
        name: required_string_arg(arguments, "name")?,
        host: required_string_arg(arguments, "host")?,
        port,
        username: required_string_arg(arguments, "username")?,
        auth_type: optional_remote_host_auth_type_arg(arguments)?,
        credential_ref: optional_string_arg(arguments, "credentialRef")?,
        credential_secret: None,
        tags: optional_string_array_arg(arguments, "tags")?,
        production: optional_bool_arg(arguments, "production")?,
        ssh_options: Default::default(),
    })
}

pub(super) fn execute_profile_create(
    profiles: &ProfileService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match profile_create_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match profiles.create_profile(storage, request) {
        Ok(profile) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "终端配置“{}”已创建，shell: {}。",
                profile.name, profile.shell
            )),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn profile_create_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<ProfileCreateRequest> {
    Ok(ProfileCreateRequest {
        name: required_string_arg(arguments, "name")?,
        shell: required_string_arg(arguments, "shell")?,
        args: optional_string_array_arg(arguments, "args")?,
        cwd: optional_string_arg(arguments, "cwd")?,
        env: optional_string_map_arg(arguments, "env")?,
        set_default: optional_bool_arg(arguments, "setDefault")?,
    })
}
