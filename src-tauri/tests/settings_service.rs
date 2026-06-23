//! 应用设置服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::settings::{
        AiMcpSettings, AppSettings, BackgroundImageFit, CustomMcpNameValue, CustomMcpServerSetting,
        CustomMcpServerToolSetting, CustomMcpSkillDirectorySetting, CustomMcpTransportKind,
        InterfaceDensity, InterfaceLanguage, TerminalColorScheme, TerminalCursorStyle,
        TerminalFontWeight, TerminalInlineSuggestionAcceptKey,
        TerminalInlineSuggestionProductionHostPolicy, TerminalRightClickBehavior, ThemeMode,
        DEFAULT_AI_CONTEXT_OUTPUT_BYTES, DEFAULT_SFTP_GLOBAL_TRANSFERS,
        DEFAULT_SFTP_HOST_TRANSFERS, DEFAULT_SFTP_PACKET_BYTES, DEFAULT_SFTP_PIPELINE_DEPTH,
        DEFAULT_SFTP_TIMEOUT_SECONDS, MAX_AI_CONTEXT_OUTPUT_BYTES, MAX_SFTP_GLOBAL_TRANSFERS,
        MAX_SFTP_HOST_TRANSFERS, MAX_SFTP_PACKET_BYTES, MAX_SFTP_PIPELINE_DEPTH,
        MAX_SFTP_TIMEOUT_SECONDS, MAX_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS,
        MIN_AI_CONTEXT_OUTPUT_BYTES, MIN_SFTP_GLOBAL_TRANSFERS, MIN_SFTP_HOST_TRANSFERS,
        MIN_SFTP_PACKET_BYTES, MIN_SFTP_PIPELINE_DEPTH, MIN_SFTP_TIMEOUT_SECONDS,
        MIN_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS,
    },
    models::tool_registry::{ToolAuditPolicy, ToolConfirmationPolicy, ToolRiskLevel},
    paths::KerminalPaths,
    state::AppState,
};
use rusqlite::{params, Connection};
use serde_json::json;
use tempfile::tempdir;

#[test]
fn settings_service_returns_defaults_before_user_changes() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");

    let settings = state
        .settings()
        .load_settings(state.storage())
        .expect("load default settings");

    assert_eq!(settings, AppSettings::default());
}

#[test]
fn settings_service_persists_app_settings_in_sqlite() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    {
        let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
        let mut settings = AppSettings {
            interface_density: InterfaceDensity::Compact,
            theme_mode: ThemeMode::Light,
            ..AppSettings::default()
        };
        settings.appearance.interface_language = InterfaceLanguage::EnUs;
        settings.appearance.background_enabled = true;
        settings.appearance.background_fit = BackgroundImageFit::Tile;
        settings.appearance.background_image_path =
            " C:\\Users\\dev\\Pictures\\bg.png ".to_string();
        settings.appearance.background_opacity = 72;
        settings.appearance.window_opacity = 68;
        settings.terminal.auto_reconnect = false;
        settings.terminal.color_scheme = TerminalColorScheme::TokyoNight;
        settings.terminal.cursor_style = TerminalCursorStyle::Bar;
        settings.terminal.dark_color_scheme = TerminalColorScheme::TokyoNight;
        settings.terminal.font_size = 16;
        settings.terminal.font_weight = TerminalFontWeight::Medium;
        settings.terminal.light_color_scheme = TerminalColorScheme::Github;
        settings.terminal.line_height = 1.5;
        settings.terminal.mac_option_is_meta = true;
        settings.terminal.right_click_behavior = TerminalRightClickBehavior::Paste;
        settings.terminal.selection_copy = true;
        settings.terminal.show_tab_numbers = true;
        settings.terminal.confirm_close_tab = false;
        settings.terminal.inline_suggestion.enabled = false;
        settings.terminal.inline_suggestion.accept_key =
            TerminalInlineSuggestionAcceptKey::Disabled;
        settings.terminal.inline_suggestion.remote_probe_enabled = false;
        settings.terminal.inline_suggestion.production_host_policy =
            TerminalInlineSuggestionProductionHostPolicy::Normal;
        settings.terminal.inline_suggestion.audit_retention_days = 14;
        settings.terminal.inline_suggestion.feedback_retention_days = 730;
        settings.terminal.inline_suggestion.providers.remote_path = false;
        settings.terminal.inline_suggestion.providers.remote_command = false;
        settings.terminal.inline_suggestion.providers.git = false;
        settings.terminal.inline_suggestion.providers.spec = false;
        settings.terminal.scrollback = 12_000;
        settings.ai.context_max_output_bytes = 16 * 1024;
        settings.ai.include_command_history = true;
        settings.ai.require_remote_approval = false;
        settings.ai.allow_destructive_tools = true;
        settings.sftp.global_transfers = 8;
        settings.sftp.host_transfers = 3;
        settings.sftp.pipeline_depth = 96;
        settings.sftp.packet_bytes = 256 * 1024;
        settings.sftp.timeout_seconds = 45;

        let stored = state
            .settings()
            .update_settings(state.storage(), settings)
            .expect("save settings");

        assert_eq!(stored.theme_mode, ThemeMode::Light);
        assert_eq!(stored.interface_density, InterfaceDensity::Compact);
        assert_eq!(
            stored.appearance.interface_language,
            InterfaceLanguage::EnUs
        );
        assert_eq!(stored.appearance.background_fit, BackgroundImageFit::Tile);
        assert_eq!(
            stored.appearance.background_image_path,
            "C:\\Users\\dev\\Pictures\\bg.png"
        );
        assert_eq!(stored.appearance.background_opacity, 72);
        assert_eq!(stored.appearance.window_opacity, 68);
        assert_eq!(
            stored.terminal.color_scheme,
            TerminalColorScheme::TokyoNight
        );
        assert_eq!(stored.terminal.font_size, 16);
    }

    let state = AppState::initialize_with_paths(paths).expect("reopen app state");
    let settings = state
        .settings()
        .load_settings(state.storage())
        .expect("reload settings");

    assert_eq!(settings.theme_mode, ThemeMode::Light);
    assert_eq!(settings.interface_density, InterfaceDensity::Compact);
    assert_eq!(
        settings.appearance.interface_language,
        InterfaceLanguage::EnUs
    );
    assert!(settings.appearance.background_enabled);
    assert_eq!(settings.appearance.background_fit, BackgroundImageFit::Tile);
    assert_eq!(
        settings.appearance.background_image_path,
        "C:\\Users\\dev\\Pictures\\bg.png"
    );
    assert_eq!(settings.appearance.background_opacity, 72);
    assert_eq!(settings.appearance.window_opacity, 68);
    assert!(!settings.terminal.auto_reconnect);
    assert_eq!(
        settings.terminal.color_scheme,
        TerminalColorScheme::TokyoNight
    );
    assert_eq!(settings.terminal.cursor_style, TerminalCursorStyle::Bar);
    assert_eq!(
        settings.terminal.dark_color_scheme,
        TerminalColorScheme::TokyoNight
    );
    assert_eq!(
        settings.terminal.light_color_scheme,
        TerminalColorScheme::Github
    );
    assert_eq!(settings.terminal.font_size, 16);
    assert_eq!(settings.terminal.font_weight, TerminalFontWeight::Medium);
    assert_eq!(settings.terminal.line_height, 1.5);
    assert!(settings.terminal.mac_option_is_meta);
    assert_eq!(
        settings.terminal.right_click_behavior,
        TerminalRightClickBehavior::Paste
    );
    assert!(settings.terminal.selection_copy);
    assert!(settings.terminal.show_tab_numbers);
    assert!(!settings.terminal.confirm_close_tab);
    assert!(!settings.terminal.inline_suggestion.enabled);
    assert_eq!(
        settings.terminal.inline_suggestion.accept_key,
        TerminalInlineSuggestionAcceptKey::Disabled
    );
    assert!(!settings.terminal.inline_suggestion.remote_probe_enabled);
    assert_eq!(
        settings.terminal.inline_suggestion.production_host_policy,
        TerminalInlineSuggestionProductionHostPolicy::Normal
    );
    assert_eq!(settings.terminal.inline_suggestion.audit_retention_days, 14);
    assert_eq!(
        settings.terminal.inline_suggestion.feedback_retention_days,
        730
    );
    assert!(!settings.terminal.inline_suggestion.providers.remote_path);
    assert!(!settings.terminal.inline_suggestion.providers.remote_command);
    assert!(!settings.terminal.inline_suggestion.providers.git);
    assert!(!settings.terminal.inline_suggestion.providers.spec);
    assert!(!settings.terminal.inline_suggestion.providers.ai);
    assert_eq!(settings.terminal.scrollback, 12_000);
    assert_eq!(settings.ai.context_max_output_bytes, 16 * 1024);
    assert!(settings.ai.include_command_history);
    assert!(!settings.ai.require_remote_approval);
    assert!(settings.ai.allow_destructive_tools);
    assert_eq!(settings.sftp.global_transfers, 8);
    assert_eq!(settings.sftp.host_transfers, 3);
    assert_eq!(settings.sftp.pipeline_depth, 96);
    assert_eq!(settings.sftp.packet_bytes, 256 * 1024);
    assert_eq!(settings.sftp.timeout_seconds, 45);
}

#[test]
fn settings_service_persists_and_validates_custom_mcp_settings() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    {
        let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
        let mut settings = AppSettings::default();
        settings.ai.mcp = AiMcpSettings {
            servers: vec![CustomMcpServerSetting {
                args: vec![
                    "-y".to_owned(),
                    "@modelcontextprotocol/server-filesystem".to_owned(),
                ],
                bearer_token_env_var: String::new(),
                command: " npx ".to_owned(),
                description: " 本地文件系统 ".to_owned(),
                enabled: true,
                env: vec![CustomMcpNameValue {
                    name: " FILESYSTEM_ROOT ".to_owned(),
                    value: " ${KTERMINAL_ROOT} ".to_owned(),
                }],
                headers: Vec::new(),
                id: " custom.filesystem ".to_owned(),
                last_discovered_at: Some(123),
                last_discovery_error: None,
                name: " Filesystem MCP ".to_owned(),
                transport: CustomMcpTransportKind::Stdio,
                tools: vec![CustomMcpServerToolSetting {
                    audit: ToolAuditPolicy::Summary,
                    confirmation: ToolConfirmationPolicy::Always,
                    description: " 列目录 ".to_owned(),
                    discovered_at: Some(123),
                    enabled: true,
                    input_schema: json!({ "type": "object" }),
                    name: " list ".to_owned(),
                    risk: ToolRiskLevel::Remote,
                    title: " List Files ".to_owned(),
                }],
                url: String::new(),
            }],
            skill_directories: vec![CustomMcpSkillDirectorySetting {
                enabled: true,
                id: " user-skills ".to_owned(),
                path: " ~/.codex/skills ".to_owned(),
            }],
        };

        let stored = state
            .settings()
            .update_settings(state.storage(), settings)
            .expect("save custom mcp settings");

        assert_eq!(stored.ai.mcp.servers[0].id, "custom.filesystem");
        assert_eq!(stored.ai.mcp.servers[0].command, "npx");
        assert_eq!(stored.ai.mcp.servers[0].env[0].name, "FILESYSTEM_ROOT");
        assert_eq!(stored.ai.mcp.servers[0].tools[0].name, "list");
        assert_eq!(stored.ai.mcp.skill_directories[0].id, "user-skills");
        assert_eq!(
            stored.ai.mcp.skill_directories[0].path,
            "~/.kerminal/skills"
        );
    }

    let state = AppState::initialize_with_paths(paths).expect("reopen app state");
    let settings = state
        .settings()
        .load_settings(state.storage())
        .expect("reload custom mcp settings");

    assert_eq!(settings.ai.mcp.servers.len(), 1);
    assert_eq!(settings.ai.mcp.servers[0].tools.len(), 1);
    assert_eq!(settings.ai.mcp.skill_directories.len(), 1);

    let mut invalid = AppSettings::default();
    invalid.ai.mcp.servers.push(CustomMcpServerSetting {
        args: Vec::new(),
        bearer_token_env_var: String::new(),
        command: String::new(),
        description: String::new(),
        enabled: true,
        env: Vec::new(),
        headers: Vec::new(),
        id: "bad.server".to_owned(),
        last_discovered_at: None,
        last_discovery_error: None,
        name: "Bad Server".to_owned(),
        tools: Vec::new(),
        transport: CustomMcpTransportKind::Stdio,
        url: String::new(),
    });
    let error = state
        .settings()
        .update_settings(state.storage(), invalid)
        .expect_err("reject invalid custom server");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("stdio command")));
}

#[test]
fn settings_service_rejects_invalid_terminal_appearance() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let mut settings = AppSettings::default();
    settings.terminal.font_size = 4;

    let error = state
        .settings()
        .update_settings(state.storage(), settings)
        .expect_err("reject invalid font size");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("字号")));
}

#[test]
fn settings_service_loads_legacy_settings_without_ai_policy() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    {
        AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    }

    let conn = Connection::open(&paths.database_file).expect("open app database");
    conn.execute(
        "
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?1, ?2, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        ",
        params![
            "app",
            r#"{
                "themeMode": "light",
                "terminal": {
                    "fontFamily": "Consolas, monospace",
                    "fontSize": 14,
                    "lineHeight": 1.4,
                    "cursorBlink": true,
                    "inlineSuggestion": {
                        "auditRetentionDays": 0,
                        "feedbackRetentionDays": 99999
                    },
                    "scrollback": 8000
                },
                "keybindings": []
            }"#
        ],
    )
    .expect("insert legacy app settings");

    let state = AppState::initialize_with_paths(paths).expect("reopen app state");
    let settings = state
        .settings()
        .load_settings(state.storage())
        .expect("load legacy settings");

    assert_eq!(settings.theme_mode, ThemeMode::Light);
    assert_eq!(settings.interface_density, InterfaceDensity::Comfortable);
    assert_eq!(
        settings.appearance.interface_language,
        InterfaceLanguage::System
    );
    assert!(!settings.appearance.background_enabled);
    assert_eq!(
        settings.appearance.background_fit,
        BackgroundImageFit::Cover
    );
    assert_eq!(settings.appearance.background_image_path, "");
    assert_eq!(settings.appearance.background_opacity, 100);
    assert!(settings.terminal.auto_reconnect);
    assert_eq!(
        settings.terminal.color_scheme,
        TerminalColorScheme::Kerminal
    );
    assert_eq!(
        settings.terminal.dark_color_scheme,
        TerminalColorScheme::Kerminal
    );
    assert_eq!(
        settings.terminal.light_color_scheme,
        TerminalColorScheme::Kerminal
    );
    assert_eq!(settings.terminal.cursor_style, TerminalCursorStyle::Block);
    assert_eq!(settings.terminal.font_weight, TerminalFontWeight::Normal);
    assert_eq!(
        settings.terminal.right_click_behavior,
        TerminalRightClickBehavior::Menu
    );
    assert_eq!(
        settings.terminal.inline_suggestion.audit_retention_days,
        MIN_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS
    );
    assert_eq!(
        settings.terminal.inline_suggestion.feedback_retention_days,
        MAX_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS
    );
    assert!(!settings.terminal.selection_copy);
    assert!(!settings.terminal.show_tab_numbers);
    assert!(settings.terminal.confirm_close_tab);
    assert_eq!(
        settings.ai.context_max_output_bytes,
        DEFAULT_AI_CONTEXT_OUTPUT_BYTES
    );
    assert!(!settings.ai.include_command_history);
    assert!(settings.ai.require_remote_approval);
    assert!(!settings.ai.allow_destructive_tools);
    assert_eq!(
        settings.sftp.global_transfers,
        DEFAULT_SFTP_GLOBAL_TRANSFERS
    );
    assert_eq!(settings.sftp.host_transfers, DEFAULT_SFTP_HOST_TRANSFERS);
    assert_eq!(settings.sftp.pipeline_depth, DEFAULT_SFTP_PIPELINE_DEPTH);
    assert_eq!(settings.sftp.packet_bytes, DEFAULT_SFTP_PACKET_BYTES);
    assert_eq!(settings.sftp.timeout_seconds, DEFAULT_SFTP_TIMEOUT_SECONDS);
    assert!(!settings.keybindings.is_empty());
}

#[test]
fn settings_service_clamps_ai_context_output_limit() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");

    let mut too_small = AppSettings::default();
    too_small.ai.context_max_output_bytes = 1;
    let stored = state
        .settings()
        .update_settings(state.storage(), too_small)
        .expect("save too small ai context limit");
    assert_eq!(
        stored.ai.context_max_output_bytes,
        MIN_AI_CONTEXT_OUTPUT_BYTES
    );

    let mut too_large = AppSettings::default();
    too_large.ai.context_max_output_bytes = usize::MAX;
    let stored = state
        .settings()
        .update_settings(state.storage(), too_large)
        .expect("save too large ai context limit");
    assert_eq!(
        stored.ai.context_max_output_bytes,
        MAX_AI_CONTEXT_OUTPUT_BYTES
    );
}

#[test]
fn settings_service_clamps_sftp_performance_settings() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");

    let mut too_small = AppSettings::default();
    too_small.sftp.global_transfers = 0;
    too_small.sftp.host_transfers = 0;
    too_small.sftp.pipeline_depth = 0;
    too_small.sftp.packet_bytes = 1;
    too_small.sftp.timeout_seconds = 1;
    let stored = state
        .settings()
        .update_settings(state.storage(), too_small)
        .expect("save too small sftp settings");
    assert_eq!(stored.sftp.global_transfers, MIN_SFTP_GLOBAL_TRANSFERS);
    assert_eq!(stored.sftp.host_transfers, MIN_SFTP_HOST_TRANSFERS);
    assert_eq!(stored.sftp.pipeline_depth, MIN_SFTP_PIPELINE_DEPTH);
    assert_eq!(stored.sftp.packet_bytes, MIN_SFTP_PACKET_BYTES);
    assert_eq!(stored.sftp.timeout_seconds, MIN_SFTP_TIMEOUT_SECONDS);

    let mut too_large = AppSettings::default();
    too_large.sftp.global_transfers = usize::MAX;
    too_large.sftp.host_transfers = usize::MAX;
    too_large.sftp.pipeline_depth = usize::MAX;
    too_large.sftp.packet_bytes = u32::MAX;
    too_large.sftp.timeout_seconds = u16::MAX;
    let stored = state
        .settings()
        .update_settings(state.storage(), too_large)
        .expect("save too large sftp settings");
    assert_eq!(stored.sftp.global_transfers, MAX_SFTP_GLOBAL_TRANSFERS);
    assert_eq!(stored.sftp.host_transfers, MAX_SFTP_HOST_TRANSFERS);
    assert_eq!(stored.sftp.pipeline_depth, MAX_SFTP_PIPELINE_DEPTH);
    assert_eq!(stored.sftp.packet_bytes, MAX_SFTP_PACKET_BYTES);
    assert_eq!(stored.sftp.timeout_seconds, MAX_SFTP_TIMEOUT_SECONDS);

    let mut host_above_global = AppSettings::default();
    host_above_global.sftp.global_transfers = 2;
    host_above_global.sftp.host_transfers = 8;
    let stored = state
        .settings()
        .update_settings(state.storage(), host_above_global)
        .expect("save host above global sftp settings");
    assert_eq!(stored.sftp.global_transfers, 2);
    assert_eq!(stored.sftp.host_transfers, 2);
}
