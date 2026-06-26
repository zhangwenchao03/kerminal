use super::*;

pub(super) fn execute_history_search(
    command_history: &CommandHistoryService,
    storage: &CommandSqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match history_list_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match command_history.list_history(storage, request) {
        Ok(entries) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_command_history_for_agent(&entries)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

fn history_list_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<CommandHistoryListRequest> {
    Ok(CommandHistoryListRequest {
        query: optional_string_arg(arguments, "query")?,
        source: optional_command_history_source_arg(arguments)?,
        target: optional_command_history_target_arg(arguments)?,
        pane_id: optional_string_arg(arguments, "paneId")?,
        remote_host_id: optional_string_arg(arguments, "remoteHostId")?,
        session_id: optional_string_arg(arguments, "sessionId")?,
        limit: optional_usize_arg(arguments, "limit")?,
    })
}

fn optional_command_history_source_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<CommandHistorySource>> {
    match arguments.get("source") {
        Some(Value::String(value)) => CommandHistorySource::try_from(value.as_str())
            .map(Some)
            .map_err(AppError::InvalidInput),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput("source 必须是字符串。".to_owned())),
    }
}

fn optional_command_history_target_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<CommandHistoryTarget>> {
    match arguments.get("target") {
        Some(Value::String(value)) => CommandHistoryTarget::try_from(value.as_str())
            .map(Some)
            .map_err(AppError::InvalidInput),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput("target 必须是字符串。".to_owned())),
    }
}

fn summarize_command_history_for_agent(
    entries: &[crate::models::command_history::CommandHistoryEntry],
) -> String {
    if entries.is_empty() {
        return "没有匹配的命令历史。".to_owned();
    }

    let samples = entries
        .iter()
        .take(5)
        .map(|entry| {
            let target = match entry.target {
                CommandHistoryTarget::Local => "本地",
                CommandHistoryTarget::Ssh => "SSH",
                CommandHistoryTarget::Telnet => "Telnet",
                CommandHistoryTarget::Serial => "Serial",
                CommandHistoryTarget::DockerContainer => "容器",
            };
            let command = truncate_string(&collapse_whitespace(&entry.command));
            format!("{target}: {command}")
        })
        .collect::<Vec<_>>()
        .join("；");

    format!("找到 {} 条命令历史。最近记录：{}。", entries.len(), samples)
}
