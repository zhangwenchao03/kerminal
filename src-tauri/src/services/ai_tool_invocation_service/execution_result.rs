use super::*;

pub(super) fn failure(message: impl Into<String>) -> ToolExecutionResult {
    let message = message.into();
    ToolExecutionResult {
        status: AiToolInvocationStatus::Failed,
        result_summary: None,
        error: Some(message),
        ..ToolExecutionResult::default()
    }
}
