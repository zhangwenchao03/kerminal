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
            ..ToolExecutionResult::default()
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
        ..ToolExecutionResult::default()
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
            ..ToolExecutionResult::default()
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
            ..ToolExecutionResult::default()
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
            structured_result: Some(json!({
                "groupCount": groups.len(),
                "groups": groups,
            })),
            entities: groups
                .iter()
                .map(|group| {
                    json!({
                        "type": "remoteHostGroup",
                        "id": group.id,
                        "name": group.name,
                    })
                })
                .collect(),
            ..ToolExecutionResult::default()
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
            structured_result: Some(json!({
                "groupCount": tree.len(),
                "groups": tree,
            })),
            entities: tree
                .iter()
                .flat_map(|group| {
                    std::iter::once(json!({
                        "type": "remoteHostGroup",
                        "id": group.id,
                        "name": group.name,
                    }))
                    .chain(group.hosts.iter().map(|host| {
                        json!({
                            "type": "remoteHost",
                            "id": host.id,
                            "groupId": group.id,
                            "name": host.name,
                            "host": host.host,
                            "port": host.port,
                            "username": host.username,
                            "production": host.production,
                        })
                    }))
                })
                .collect(),
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_remote_host_last_used(
    command_history: &CommandHistoryService,
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let target = match optional_string_arg(arguments, "target") {
        Ok(target) => target
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "ssh".to_owned()),
        Err(error) => return failure(error.to_string()),
    };
    if target != "ssh" {
        return ToolExecutionResult {
            status: AiToolInvocationStatus::Failed,
            error: Some("remote_host.last_used 当前仅支持 target=ssh。".to_owned()),
            error_kind: Some("unsupportedTarget".to_owned()),
            recoverable: true,
            next_hints: vec!["改用 target=ssh，或先调用 remote_host.tree 人工选择主机。".to_owned()],
            ..ToolExecutionResult::default()
        };
    }

    let history = match command_history.list_history(
        storage,
        CommandHistoryListRequest {
            target: Some(CommandHistoryTarget::Ssh),
            limit: Some(100),
            ..CommandHistoryListRequest::default()
        },
    ) {
        Ok(history) => history,
        Err(error) => return failure(error.to_string()),
    };
    let tree = match remote_hosts.list_tree(storage) {
        Ok(tree) => tree,
        Err(error) => return failure(error.to_string()),
    };

    for entry in history.iter() {
        let Some(remote_host_id) = entry
            .remote_host_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if let Some((group_name, host)) = find_remote_host_in_tree(&tree, remote_host_id) {
            return remote_host_last_used_result(entry, group_name, host);
        }
    }

    ToolExecutionResult {
        status: AiToolInvocationStatus::Failed,
        error: Some("没有找到最近仍存在的 SSH 主机历史。".to_owned()),
        structured_result: Some(json!({
            "source": "commandHistory",
            "checkedHistoryCount": history.len(),
            "target": "ssh",
        })),
        error_kind: Some("targetNotFound".to_owned()),
        recoverable: true,
        next_hints: vec![
            "先打开或执行一次 SSH 主机命令，或调用 remote_host.tree / remote_host.ensure 获取 hostId。"
                .to_owned(),
        ],
        ..ToolExecutionResult::default()
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
            structured_result: Some(json!({ "group": group })),
            entities: vec![json!({
                "type": "remoteHostGroup",
                "id": group.id,
                "name": group.name,
            })],
            ..ToolExecutionResult::default()
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
            ..ToolExecutionResult::default()
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
            ..ToolExecutionResult::default()
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
    let request = match remote_host_update_request_from_arguments(remote_hosts, storage, arguments)
    {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match remote_hosts.update_host(storage, request) {
        Ok(host) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_remote_host_write_for_ai("已更新", &host)),
            error: None,
            ..ToolExecutionResult::default()
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
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure(format!("远程主机不存在或未删除：{host_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn remote_host_update_request_from_arguments(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<RemoteHostUpdateRequest> {
    let Some(port) = number_to_u16(arguments.get("port")) else {
        return Err(AppError::InvalidInput(
            "port 必须是 1 到 65535 的数字。".to_owned(),
        ));
    };

    let auth_type = optional_remote_host_auth_type_arg(arguments)?;
    let (credential_ref, credential_secret) =
        remote_host_credentials_from_arguments(arguments, auth_type)?;

    Ok(RemoteHostUpdateRequest {
        id: required_string_arg(arguments, "id")?,
        group_id: resolve_remote_host_group_id(remote_hosts, storage, arguments)?,
        name: required_string_arg(arguments, "name")?,
        host: required_string_arg(arguments, "host")?,
        port,
        username: required_string_arg(arguments, "username")?,
        auth_type,
        credential_ref,
        credential_secret,
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
        "远程主机“{}”{}：{}@{}:{}，认证 {:?}，{}{}，id={}。",
        host.name,
        action,
        host.username,
        host.host,
        host.port,
        host.auth_type,
        remote_host_credential_summary(host),
        production_label,
        host.id
    )
}

fn find_remote_host_in_tree<'a>(
    tree: &'a [RemoteHostGroupWithHosts],
    host_id: &str,
) -> Option<(&'a str, &'a RemoteHost)> {
    tree.iter().find_map(|group| {
        group
            .hosts
            .iter()
            .find(|host| host.id == host_id)
            .map(|host| (group.name.as_str(), host))
    })
}

fn remote_host_last_used_result(
    entry: &crate::models::command_history::CommandHistoryEntry,
    group_name: &str,
    host: &RemoteHost,
) -> ToolExecutionResult {
    let production_label = if host.production {
        "，生产主机"
    } else {
        ""
    };
    ToolExecutionResult {
        status: AiToolInvocationStatus::Succeeded,
        result_summary: Some(format!(
            "最近使用的 SSH 主机是“{}”（分组：{}）：{}@{}:{}{}，id={}。",
            host.name, group_name, host.username, host.host, host.port, production_label, host.id
        )),
        error: None,
        structured_result: Some(json!({
            "source": "commandHistory",
            "target": "ssh",
            "historyEntryId": entry.id,
            "lastUsedAt": entry.created_at,
            "hostId": host.id,
            "groupId": host.group_id,
            "host": {
                "id": host.id,
                "groupId": host.group_id,
                "groupName": group_name,
                "name": host.name,
                "host": host.host,
                "port": host.port,
                "username": host.username,
                "production": host.production,
            },
        })),
        entities: vec![json!({
            "type": "remoteHost",
            "id": host.id,
            "groupId": host.group_id,
            "groupName": group_name,
            "name": host.name,
            "host": host.host,
            "port": host.port,
            "username": host.username,
            "production": host.production,
            "source": "commandHistory",
        })],
        next_hints: vec![
            "后续可直接把 hostId 传给 ssh.ensure_connected、ssh.command、sftp.list 或 server_info.snapshot。"
                .to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

pub(super) fn execute_remote_host_create(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match remote_host_create_request_from_arguments(remote_hosts, storage, arguments)
    {
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
                    "远程主机“{}”已创建：{}@{}:{}{}，id={}。",
                    host.name, host.username, host.host, host.port, production_label, host.id
                )),
                error: None,
                structured_result: Some(json!({
                    "created": true,
                    "hostId": host.id,
                    "groupId": host.group_id,
                    "host": host,
                })),
                entities: vec![json!({
                    "type": "remoteHost",
                    "id": host.id,
                    "groupId": host.group_id,
                    "name": host.name,
                    "host": host.host,
                    "port": host.port,
                    "username": host.username,
                    "production": host.production,
                })],
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_remote_host_ensure(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match remote_host_create_request_from_arguments(remote_hosts, storage, arguments)
    {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match ensure_remote_host(remote_hosts, storage, request) {
        Ok((host, created)) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(if created {
                summarize_remote_host_write_for_ai("已创建", &host)
            } else {
                format!(
                    "远程主机“{}”已存在：{}@{}:{}，id={}。",
                    host.name, host.username, host.host, host.port, host.id
                )
            }),
            error: None,
            structured_result: Some(json!({
                "created": created,
                "hostId": host.id,
                "groupId": host.group_id,
                "host": host,
            })),
            entities: vec![json!({
                "type": "remoteHost",
                "id": host.id,
                "groupId": host.group_id,
                "name": host.name,
                "host": host.host,
                "port": host.port,
                "username": host.username,
                "production": host.production,
            })],
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

fn ensure_remote_host(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    request: RemoteHostCreateRequest,
) -> AppResult<(RemoteHost, bool)> {
    if let Some(existing) = find_existing_remote_host(remote_hosts, storage, &request)? {
        if request.credential_ref.is_some() || request.credential_secret.is_some() {
            let updated = remote_hosts.update_host(
                storage,
                RemoteHostUpdateRequest {
                    id: existing.id,
                    group_id: request.group_id,
                    name: request.name,
                    host: request.host,
                    port: request.port,
                    username: request.username,
                    auth_type: request.auth_type,
                    credential_ref: request.credential_ref,
                    credential_secret: request.credential_secret,
                    tags: request.tags,
                    production: request.production,
                    ssh_options: request.ssh_options,
                    sort_order: existing.sort_order,
                },
            )?;
            return Ok((updated, false));
        }
        return Ok((existing, false));
    }

    let host = remote_hosts.create_host(storage, request)?;
    Ok((host, true))
}

fn find_existing_remote_host(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    request: &RemoteHostCreateRequest,
) -> AppResult<Option<RemoteHost>> {
    let tree = remote_hosts.list_tree(storage)?;
    let requested_group_id = request.group_id.as_deref();
    let requested_host = request.host.trim();
    let requested_username = request.username.trim();
    let requested_name = request.name.trim();

    Ok(tree
        .into_iter()
        .flat_map(|group| group.hosts.into_iter())
        .find(|host| {
            host.group_id.as_deref() == requested_group_id
                && ((host.host.eq_ignore_ascii_case(requested_host)
                    && host.port == request.port
                    && host.username.eq_ignore_ascii_case(requested_username))
                    || host.name.eq_ignore_ascii_case(requested_name))
        }))
}

pub(super) fn remote_host_create_request_from_arguments(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<RemoteHostCreateRequest> {
    let Some(port) = number_to_u16(arguments.get("port")) else {
        return Err(AppError::InvalidInput(
            "port 必须是 1 到 65535 的数字。".to_owned(),
        ));
    };

    let auth_type = optional_remote_host_auth_type_arg(arguments)?;
    let (credential_ref, credential_secret) =
        remote_host_credentials_from_arguments(arguments, auth_type)?;

    Ok(RemoteHostCreateRequest {
        group_id: resolve_remote_host_group_id(remote_hosts, storage, arguments)?,
        name: required_string_arg(arguments, "name")?,
        host: required_string_arg(arguments, "host")?,
        port,
        username: required_string_arg(arguments, "username")?,
        auth_type,
        credential_ref,
        credential_secret,
        tags: optional_string_array_arg(arguments, "tags")?,
        production: optional_bool_arg(arguments, "production")?,
        ssh_options: Default::default(),
    })
}

fn remote_host_credentials_from_arguments(
    arguments: &serde_json::Map<String, Value>,
    auth_type: RemoteHostAuthType,
) -> AppResult<(Option<String>, Option<String>)> {
    let credential_ref = optional_string_arg(arguments, "credentialRef")?
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if credential_ref
        .as_deref()
        .is_some_and(|value| value.starts_with("credential:"))
    {
        return Err(AppError::InvalidInput(
            "SSH 主机不再支持 credential: 凭据引用；密码请使用 credentialSecret/password，私钥请使用 credentialSecret/privateKey 或私钥路径".to_owned(),
        ));
    }

    let credential_secret = optional_string_arg(arguments, "credentialSecret")?
        .or(match auth_type {
            RemoteHostAuthType::Password => optional_string_arg(arguments, "password")?,
            RemoteHostAuthType::Key => optional_string_arg(arguments, "privateKey")?,
            RemoteHostAuthType::Agent => None,
        })
        .filter(|value| !value.trim().is_empty());

    match auth_type {
        RemoteHostAuthType::Agent => {
            if credential_ref.is_some() || credential_secret.is_some() {
                return Err(AppError::InvalidInput(
                    "SSH Agent 认证不需要密码、私钥路径或私钥内容".to_owned(),
                ));
            }
            Ok((None, None))
        }
        RemoteHostAuthType::Password => {
            if credential_ref.is_some() {
                return Err(AppError::InvalidInput(
                    "密码认证不再使用 credentialRef，请直接传入 credentialSecret 或 password"
                        .to_owned(),
                ));
            }
            Ok((None, credential_secret))
        }
        RemoteHostAuthType::Key => Ok((credential_ref, credential_secret)),
    }
}

fn remote_host_credential_summary(host: &RemoteHost) -> &'static str {
    match host.auth_type {
        RemoteHostAuthType::Agent => "无需保存凭据",
        RemoteHostAuthType::Password => {
            if host.credential_secret.is_some() {
                "明文密码已保存"
            } else {
                "明文密码未配置"
            }
        }
        RemoteHostAuthType::Key => {
            if host.credential_secret.is_some() {
                "内联私钥已明文保存"
            } else if host.credential_ref.is_some() {
                "私钥路径已配置"
            } else {
                "私钥未配置"
            }
        }
    }
}

fn resolve_remote_host_group_id(
    remote_hosts: &RemoteHostService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<String>> {
    if let Some(group_id) = optional_string_arg(arguments, "groupId")?
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        return Ok(Some(group_id));
    }

    let Some(group_name) = optional_string_arg(arguments, "groupName")?
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    if let Some(group) = remote_hosts
        .list_groups(storage)?
        .into_iter()
        .find(|group| group.name.eq_ignore_ascii_case(&group_name))
    {
        return Ok(Some(group.id));
    }

    let group =
        remote_hosts.create_group(storage, RemoteHostGroupCreateRequest { name: group_name })?;
    Ok(Some(group.id))
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
            ..ToolExecutionResult::default()
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
