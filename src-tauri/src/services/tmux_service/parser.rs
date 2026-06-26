//! tmux `-F` 稳定格式输出解析。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::tmux::{TmuxPaneSummary, TmuxSessionStatus, TmuxSessionSummary, TmuxWindowSummary},
};

pub const FIELD_SEPARATOR: char = '\u{1f}';

const SESSION_FIELD_COUNT: usize = 8;
const WINDOW_FIELD_COUNT: usize = 8;
const PANE_FIELD_COUNT: usize = 10;

pub fn parse_sessions(output: &str, target_ref: &str) -> AppResult<Vec<TmuxSessionSummary>> {
    parse_non_empty_lines(output)
        .map(|line| parse_session(line, target_ref))
        .collect()
}

pub fn parse_windows(output: &str) -> AppResult<Vec<TmuxWindowSummary>> {
    parse_non_empty_lines(output).map(parse_window).collect()
}

pub fn parse_panes(output: &str) -> AppResult<Vec<TmuxPaneSummary>> {
    parse_non_empty_lines(output).map(parse_pane).collect()
}

fn parse_session(line: &str, target_ref: &str) -> AppResult<TmuxSessionSummary> {
    let fields = split_fields(line, SESSION_FIELD_COUNT)?;
    let id = required_text(fields[0], "session id")?;
    let name = required_text(unquote_tmux_field(fields[1])?.as_str(), "session name")?;
    Ok(TmuxSessionSummary {
        activity_at: parse_optional_u64(fields[5], "session activity")?,
        attached: parse_boolish(fields[2], "session attached")?,
        clients: parse_u32(fields[3], "session clients")?,
        created_at: parse_optional_u64(fields[4], "session created")?,
        current_path: optional_text(unquote_tmux_field(fields[6])?),
        id,
        name,
        status: TmuxSessionStatus::Running,
        target_ref: target_ref.to_owned(),
        windows: parse_u32(fields[7], "session windows")?,
    })
}

fn parse_window(line: &str) -> AppResult<TmuxWindowSummary> {
    let fields = split_fields(line, WINDOW_FIELD_COUNT)?;
    Ok(TmuxWindowSummary {
        active: parse_boolish(fields[4], "window active")?,
        flags: optional_text(unquote_tmux_field(fields[7])?),
        id: required_text(fields[0], "window id")?,
        index: parse_u32(fields[2], "window index")?,
        layout: optional_text(unquote_tmux_field(fields[6])?),
        name: required_text(unquote_tmux_field(fields[3])?.as_str(), "window name")?,
        panes: parse_u32(fields[5], "window panes")?,
        session_id: required_text(fields[1], "session id")?,
    })
}

fn parse_pane(line: &str) -> AppResult<TmuxPaneSummary> {
    let fields = split_fields(line, PANE_FIELD_COUNT)?;
    Ok(TmuxPaneSummary {
        active: parse_boolish(fields[3], "pane active")?,
        current_command: optional_text(unquote_tmux_field(fields[5])?),
        current_path: optional_text(unquote_tmux_field(fields[4])?),
        dead: parse_boolish(fields[9], "pane dead")?,
        height: parse_u32(fields[8], "pane height")?,
        id: required_text(fields[0], "pane id")?,
        index: parse_u32(fields[2], "pane index")?,
        title: optional_text(unquote_tmux_field(fields[6])?),
        width: parse_u32(fields[7], "pane width")?,
        window_id: required_text(fields[1], "window id")?,
    })
}

fn parse_non_empty_lines(output: &str) -> impl Iterator<Item = &str> {
    output
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
}

fn split_fields(line: &str, expected: usize) -> AppResult<Vec<&str>> {
    let fields = line.split(FIELD_SEPARATOR).collect::<Vec<_>>();
    if fields.len() != expected {
        return Err(AppError::InvalidInput(format!(
            "tmux 输出字段数量不匹配，期望 {expected} 个，实际 {} 个",
            fields.len()
        )));
    }
    Ok(fields)
}

fn required_text(value: &str, label: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("tmux {label} 为空")));
    }
    if value.chars().any(|ch| ch == '\0' || ch == '\r') {
        return Err(AppError::InvalidInput(format!(
            "tmux {label} 包含非法控制字符"
        )));
    }
    Ok(value.to_owned())
}

fn optional_text(value: String) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}

fn parse_u32(value: &str, label: &str) -> AppResult<u32> {
    value
        .trim()
        .parse::<u32>()
        .map_err(|_| AppError::InvalidInput(format!("tmux {label} 不是有效数字: {}", value.trim())))
}

fn parse_optional_u64(value: &str, label: &str) -> AppResult<Option<u64>> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    value
        .parse::<u64>()
        .map(Some)
        .map_err(|_| AppError::InvalidInput(format!("tmux {label} 不是有效时间戳: {value}")))
}

fn parse_boolish(value: &str, label: &str) -> AppResult<bool> {
    match value.trim() {
        "1" | "true" | "yes" => Ok(true),
        "0" | "false" | "no" | "" => Ok(false),
        other => other
            .parse::<u32>()
            .map(|count| count > 0)
            .map_err(|_| AppError::InvalidInput(format!("tmux {label} 不是有效布尔值: {other}"))),
    }
}

fn unquote_tmux_field(value: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    if !value.starts_with('\'') {
        return Ok(value.to_owned());
    }

    let mut output = String::new();
    let mut chars = value.chars().peekable();
    let mut in_single = false;
    while let Some(ch) = chars.next() {
        match ch {
            '\'' => {
                in_single = !in_single;
            }
            '\\' if !in_single => {
                if let Some(next) = chars.next() {
                    output.push(next);
                }
            }
            other => output.push(other),
        }
    }

    if in_single {
        return Err(AppError::InvalidInput(
            "tmux quoted 字段缺少结束引号".to_owned(),
        ));
    }
    Ok(output)
}
