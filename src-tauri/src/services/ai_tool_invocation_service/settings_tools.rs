use super::*;

pub(super) fn execute_settings_get(
    settings: &SettingsService,
    storage: &SqliteStore,
) -> ToolExecutionResult {
    match settings.load_settings(storage) {
        Ok(settings) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_settings_for_ai(&settings)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_settings_for_ai(settings: &AppSettings) -> String {
    format!(
        "当前设置：主题 {:?}；终端字体 {} {}px，滚屏 {} 行；AI 策略：审批 {:?}，远程确认 {}，破坏性工具 {}，上下文 {} 字节，历史上下文 {}。",
        settings.theme_mode,
        truncate_string(&settings.terminal.font_family),
        settings.terminal.font_size,
        settings.terminal.scrollback,
        settings.ai.command_approval_policy,
        if settings.ai.require_remote_approval {
            "开启"
        } else {
            "关闭"
        },
        if settings.ai.allow_destructive_tools {
            "允许"
        } else {
            "禁用"
        },
        settings.ai.context_max_output_bytes,
        if settings.ai.include_command_history {
            "开启"
        } else {
            "关闭"
        }
    )
}

pub(super) fn execute_update_ai_security(
    settings: &SettingsService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let current = match settings.load_settings(storage) {
        Ok(settings) => settings,
        Err(error) => return failure(error.to_string()),
    };
    let ai = match ai_security_from_arguments(&current.ai, arguments) {
        Ok(ai) => ai,
        Err(error) => return failure(error.to_string()),
    };
    let next = match (AppSettings { ai, ..current }).validated() {
        Ok(settings) => settings,
        Err(error) => return failure(error.to_string()),
    };

    match settings.update_settings(storage, next) {
        Ok(settings) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_ai_security_for_ai(&settings.ai)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn ai_security_from_arguments(
    current: &AiSecuritySettings,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<AiSecuritySettings> {
    let mut next = current.clone();
    let mut changed = false;

    if let Some(value) = optional_usize_patch_arg(arguments, "contextMaxOutputBytes")? {
        next.context_max_output_bytes = value;
        changed = true;
    }
    if let Some(value) = optional_bool_patch_arg(arguments, "includeCommandHistory")? {
        next.include_command_history = value;
        changed = true;
    }
    if let Some(value) = optional_bool_patch_arg(arguments, "requireRemoteApproval")? {
        next.require_remote_approval = value;
        changed = true;
    }
    if let Some(value) = optional_bool_patch_arg(arguments, "allowDestructiveTools")? {
        next.allow_destructive_tools = value;
        changed = true;
    }
    if let Some(value) = optional_ai_approval_policy_patch_arg(arguments)? {
        next.command_approval_policy = value;
        changed = true;
    }
    if let Some(value) = optional_u16_patch_arg(arguments, "commandTimeoutSeconds")? {
        next.command_timeout_seconds = value;
        changed = true;
    }
    if let Some(value) = optional_u16_patch_arg(arguments, "terminalTailLines")? {
        next.terminal_tail_lines = value;
        changed = true;
    }
    if let Some(value) = optional_string_patch_arg(arguments, "customInstructions")? {
        next.custom_instructions = value;
        changed = true;
    }

    if !changed {
        return Err(AppError::InvalidInput(
            "至少需要提供一个 AI 安全策略字段。".to_owned(),
        ));
    }

    Ok(next)
}

pub(super) fn optional_ai_approval_policy_patch_arg(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<Option<AiCommandApprovalPolicy>> {
    match arguments.get("commandApprovalPolicy") {
        Some(Value::String(value)) => match value.as_str() {
            "always" => Ok(Some(AiCommandApprovalPolicy::Always)),
            "risky" => Ok(Some(AiCommandApprovalPolicy::Risky)),
            "relaxed" => Ok(Some(AiCommandApprovalPolicy::Relaxed)),
            _ => Err(AppError::InvalidInput(
                "commandApprovalPolicy 只支持 always、risky 或 relaxed。".to_owned(),
            )),
        },
        Some(Value::Null) | None => Ok(None),
        _ => Err(AppError::InvalidInput(
            "commandApprovalPolicy 必须是字符串。".to_owned(),
        )),
    }
}

pub(super) fn summarize_ai_security_for_ai(ai: &AiSecuritySettings) -> String {
    format!(
        "AI 安全策略已更新：审批 {:?}，远程确认 {}，破坏性工具 {}，上下文 {} 字节，命令超时 {} 秒，尾部输出 {} 行，自定义提示 {} 字符。",
        ai.command_approval_policy,
        if ai.require_remote_approval {
            "开启"
        } else {
            "关闭"
        },
        if ai.allow_destructive_tools {
            "允许"
        } else {
            "禁用"
        },
        ai.context_max_output_bytes,
        ai.command_timeout_seconds,
        ai.terminal_tail_lines,
        ai.custom_instructions.chars().count()
    )
}

pub(super) fn execute_update_theme(
    settings: &SettingsService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let Some(theme_mode) = arguments.get("themeMode").and_then(Value::as_str) else {
        return failure("themeMode 必须是字符串。");
    };

    let theme_mode = match theme_mode {
        "dark" => ThemeMode::Dark,
        "light" => ThemeMode::Light,
        "system" => ThemeMode::System,
        _ => return failure("themeMode 只支持 dark、light 或 system。"),
    };

    let current = match settings.load_settings(storage) {
        Ok(settings) => settings,
        Err(error) => return failure(error.to_string()),
    };
    let next = AppSettings {
        theme_mode,
        ..current
    };

    match settings.update_settings(storage, next) {
        Ok(settings) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!("主题已更新为 {:?}。", settings.theme_mode)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_update_terminal_appearance(
    settings: &SettingsService,
    storage: &SqliteStore,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let current = match settings.load_settings(storage) {
        Ok(settings) => settings,
        Err(error) => return failure(error.to_string()),
    };
    let terminal = match terminal_appearance_from_arguments(&current.terminal, arguments) {
        Ok(terminal) => terminal,
        Err(error) => return failure(error.to_string()),
    };
    let next = AppSettings {
        terminal,
        ..current
    };

    match settings.update_settings(storage, next) {
        Ok(settings) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_terminal_appearance_for_ai(&settings.terminal)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn terminal_appearance_from_arguments(
    current: &TerminalAppearance,
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<TerminalAppearance> {
    let mut next = current.clone();
    let mut changed = false;

    if let Some(font_family) = optional_string_arg(arguments, "fontFamily")? {
        next.font_family = font_family;
        changed = true;
    }
    if let Some(font_size) = optional_u16_patch_arg(arguments, "fontSize")? {
        next.font_size = font_size;
        changed = true;
    }
    if let Some(line_height) = optional_f64_patch_arg(arguments, "lineHeight")? {
        next.line_height = line_height;
        changed = true;
    }
    if let Some(cursor_blink) = optional_bool_patch_arg(arguments, "cursorBlink")? {
        next.cursor_blink = cursor_blink;
        changed = true;
    }
    if let Some(scrollback) = optional_u32_patch_arg(arguments, "scrollback")? {
        next.scrollback = scrollback;
        changed = true;
    }

    if !changed {
        return Err(AppError::InvalidInput(
            "至少需要提供一个终端外观字段。".to_owned(),
        ));
    }

    Ok(next)
}

pub(super) fn summarize_terminal_appearance_for_ai(terminal: &TerminalAppearance) -> String {
    format!(
        "终端外观已更新：字体：{}，字号：{}px，行高：{:.2}，光标闪烁：{}，滚屏缓冲：{} 行。",
        truncate_string(&terminal.font_family),
        terminal.font_size,
        terminal.line_height,
        if terminal.cursor_blink {
            "开启"
        } else {
            "关闭"
        },
        terminal.scrollback
    )
}
