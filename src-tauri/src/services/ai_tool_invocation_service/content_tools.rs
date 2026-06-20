use super::*;

pub(super) fn execute_connection_rdp_open(
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<RdpOpenRequest>(arguments, "connection.rdp_open") {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match crate::commands::connection::open_rdp_connection(request) {
        Ok(result) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_rdp_open_result_for_ai(&result)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_rdp_open_result_for_ai(result: &RdpOpenResult) -> String {
    format!(
        "RDP 启动请求{}：{}{}。",
        if result.launched {
            "已发送"
        } else {
            "未发送"
        },
        result.message,
        result
            .file_path
            .as_deref()
            .map(|path| format!("，临时文件：{path}"))
            .unwrap_or_default()
    )
}

pub(super) fn execute_snippet_list(
    snippets: &SnippetService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<SnippetListRequest>(arguments, "snippet.list") {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match snippets.list_snippets(storage, request) {
        Ok(snippets) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_snippets_for_ai(&snippets)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_snippet_update(
    snippets: &SnippetService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<SnippetUpdateRequest>(arguments, "snippet.update")
    {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match snippets.update_snippet(storage, request) {
        Ok(snippet) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_snippet_write_for_ai("已更新", &snippet)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_snippet_delete(
    snippets: &SnippetService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let snippet_id = match required_string_arg(arguments, "snippetId") {
        Ok(snippet_id) => snippet_id,
        Err(error) => return failure(error.to_string()),
    };

    match snippets.delete_snippet(storage, &snippet_id) {
        Ok(true) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "脚本片段已删除：{}。",
                truncate_string(&snippet_id)
            )),
            error: None,
        },
        Ok(false) => failure(format!("脚本片段不存在或未删除：{snippet_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_snippets_for_ai(snippets: &[CommandSnippet]) -> String {
    if snippets.is_empty() {
        return "没有匹配的脚本片段。".to_owned();
    }

    let samples = snippets
        .iter()
        .take(5)
        .map(|snippet| {
            format!(
                "{}（{}，标签 {}，id={}）",
                snippet.title,
                snippet_scope_label(snippet.scope),
                if snippet.tags.is_empty() {
                    "无".to_owned()
                } else {
                    snippet.tags.join(", ")
                },
                snippet.id
            )
        })
        .collect::<Vec<_>>()
        .join("；");
    format!("找到 {} 个脚本片段。示例：{}。", snippets.len(), samples)
}

pub(super) fn summarize_snippet_write_for_ai(action: &str, snippet: &CommandSnippet) -> String {
    format!(
        "脚本片段“{}”{}，作用域：{}，标签：{}，id={}。",
        snippet.title,
        action,
        snippet_scope_label(snippet.scope),
        if snippet.tags.is_empty() {
            "无".to_owned()
        } else {
            snippet.tags.join(", ")
        },
        snippet.id
    )
}

pub(super) fn execute_workflow_list(
    workflows: &WorkflowService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<WorkflowListRequest>(arguments, "workflow.list") {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match workflows.list_workflows(storage, request) {
        Ok(workflows) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_workflows_for_ai(&workflows)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_workflow_update(
    workflows: &WorkflowService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request =
        match request_from_arguments::<WorkflowUpdateRequest>(arguments, "workflow.update") {
            Ok(request) => request,
            Err(error) => return failure(error.to_string()),
        };

    match workflows.update_workflow(storage, request) {
        Ok(workflow) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_workflow_write_for_ai("已更新", &workflow)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_workflow_delete(
    workflows: &WorkflowService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let workflow_id = match required_string_arg(arguments, "workflowId") {
        Ok(workflow_id) => workflow_id,
        Err(error) => return failure(error.to_string()),
    };

    match workflows.delete_workflow(storage, &workflow_id) {
        Ok(true) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "命令工作流已删除：{}。",
                truncate_string(&workflow_id)
            )),
            error: None,
        },
        Ok(false) => failure(format!("命令工作流不存在或未删除：{workflow_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_workflows_for_ai(workflows: &[CommandWorkflow]) -> String {
    if workflows.is_empty() {
        return "没有匹配的命令工作流。".to_owned();
    }

    let samples = workflows
        .iter()
        .take(5)
        .map(|workflow| {
            format!(
                "{}（{} 步，{}，id={}）",
                workflow.title,
                workflow.steps.len(),
                workflow_scope_label(workflow.scope),
                workflow.id
            )
        })
        .collect::<Vec<_>>()
        .join("；");
    format!("找到 {} 个命令工作流。示例：{}。", workflows.len(), samples)
}

pub(super) fn summarize_workflow_write_for_ai(action: &str, workflow: &CommandWorkflow) -> String {
    format!(
        "命令工作流“{}”{}，包含 {} 个步骤，作用域：{}，id={}。",
        workflow.title,
        action,
        workflow.steps.len(),
        workflow_scope_label(workflow.scope),
        workflow.id
    )
}

pub(super) fn execute_history_record(
    command_history: &CommandHistoryService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request =
        match request_from_arguments::<CommandHistoryRecordRequest>(arguments, "history.record") {
            Ok(request) => request,
            Err(error) => return failure(error.to_string()),
        };

    match command_history.record_command(storage, request) {
        Ok(result) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_history_record_result_for_ai(&result)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_history_delete(
    command_history: &CommandHistoryService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let entry_id = match required_string_arg(arguments, "entryId") {
        Ok(entry_id) => entry_id,
        Err(error) => return failure(error.to_string()),
    };

    match command_history.delete_history(storage, &entry_id) {
        Ok(true) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!("命令历史已删除：{}。", truncate_string(&entry_id))),
            error: None,
        },
        Ok(false) => failure(format!("命令历史不存在或未删除：{entry_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_history_clear(
    command_history: &CommandHistoryService,
    storage: &SqliteStore,
) -> ToolExecutionResult {
    match command_history.clear_history(storage) {
        Ok(count) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!("命令历史已清空，共删除 {count} 条记录。")),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_history_record_result_for_ai(
    result: &crate::models::command_history::CommandHistoryRecordResult,
) -> String {
    if result.recorded {
        let command = result
            .entry
            .as_ref()
            .map(|entry| truncate_string(&collapse_whitespace(&entry.command)))
            .unwrap_or_else(|| "-".to_owned());
        return format!("命令历史已记录：{}。", command);
    }

    format!(
        "命令历史已跳过：{}。",
        result
            .skip_reason
            .as_deref()
            .unwrap_or("服务未返回跳过原因")
    )
}

pub(super) fn execute_snippet_create(
    snippets: &SnippetService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match snippet_create_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match snippets.create_snippet(storage, request) {
        Ok(snippet) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "脚本片段“{}”已创建，作用域：{}，标签：{}。",
                snippet.title,
                snippet_scope_label(snippet.scope),
                if snippet.tags.is_empty() {
                    "无".to_owned()
                } else {
                    snippet.tags.join(", ")
                }
            )),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_workflow_create(
    workflows: &WorkflowService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match workflow_create_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match workflows.create_workflow(storage, request) {
        Ok(workflow) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "命令工作流“{}”已创建，包含 {} 个步骤，作用域：{}。",
                workflow.title,
                workflow.steps.len(),
                workflow_scope_label(workflow.scope)
            )),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_history_search(
    command_history: &CommandHistoryService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match history_list_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match command_history.list_history(storage, request) {
        Ok(entries) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_command_history_for_ai(&entries)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn history_list_request_from_arguments(
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

pub(super) fn optional_command_history_source_arg(
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

pub(super) fn optional_command_history_target_arg(
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

pub(super) fn summarize_command_history_for_ai(
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

pub(super) fn snippet_create_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SnippetCreateRequest> {
    Ok(SnippetCreateRequest {
        title: required_string_arg(arguments, "title")?,
        command: required_string_arg(arguments, "command")?,
        description: optional_string_arg(arguments, "description")?,
        tags: optional_string_array_arg(arguments, "tags")?,
        scope: optional_snippet_scope_arg(arguments)?,
    })
}

pub(super) fn optional_snippet_scope_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SnippetScope> {
    match arguments.get("scope") {
        Some(Value::String(value)) => {
            SnippetScope::try_from(value.as_str()).map_err(AppError::InvalidInput)
        }
        Some(Value::Null) | None => Ok(SnippetScope::Any),
        _ => Err(AppError::InvalidInput("scope 必须是字符串。".to_owned())),
    }
}

pub(super) fn workflow_create_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<WorkflowCreateRequest> {
    Ok(WorkflowCreateRequest {
        title: required_string_arg(arguments, "title")?,
        description: optional_string_arg(arguments, "description")?,
        tags: optional_string_array_arg(arguments, "tags")?,
        scope: optional_workflow_scope_arg(arguments, "scope")?.unwrap_or_default(),
        steps: required_workflow_steps_arg(arguments)?,
    })
}

pub(super) fn required_workflow_steps_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Vec<WorkflowStepInput>> {
    match arguments.get("steps") {
        Some(Value::Array(values)) => values
            .iter()
            .enumerate()
            .map(|(index, value)| workflow_step_from_value(index, value))
            .collect(),
        Some(Value::Null) | None => Err(AppError::InvalidInput("缺少必填参数: steps".to_owned())),
        _ => Err(AppError::InvalidInput("steps 必须是对象数组。".to_owned())),
    }
}

pub(super) fn workflow_step_from_value(
    index: usize,
    value: &Value,
) -> AppResult<WorkflowStepInput> {
    let Value::Object(step) = value else {
        return Err(AppError::InvalidInput(format!(
            "steps[{}] 必须是对象。",
            index + 1
        )));
    };

    Ok(WorkflowStepInput {
        id: optional_string_arg(step, "id")?,
        title: required_string_arg(step, "title")?,
        command: required_string_arg(step, "command")?,
        description: optional_string_arg(step, "description")?,
        scope: optional_workflow_scope_arg(step, "scope")?,
        requires_confirmation: optional_bool_arg(step, "requiresConfirmation")?,
    })
}

pub(super) fn optional_workflow_scope_arg(
    arguments: &serde_json::Map<String, Value>,
    key: &str,
) -> AppResult<Option<WorkflowScope>> {
    match arguments.get(key) {
        Some(Value::String(value)) => WorkflowScope::try_from(value.as_str())
            .map(Some)
            .map_err(AppError::InvalidInput),
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(format!("{key} 必须是字符串。"))),
    }
}

pub(super) fn workflow_scope_label(scope: WorkflowScope) -> &'static str {
    match scope {
        WorkflowScope::Any => "通用",
        WorkflowScope::Local => "本地终端",
        WorkflowScope::Ssh => "SSH",
    }
}

pub(super) fn snippet_scope_label(scope: SnippetScope) -> &'static str {
    match scope {
        SnippetScope::Any => "通用",
        SnippetScope::Local => "本地终端",
        SnippetScope::Ssh => "SSH",
    }
}
