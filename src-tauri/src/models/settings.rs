//! 应用设置 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    models::tool_registry::{ToolAuditPolicy, ToolConfirmationPolicy, ToolRiskLevel},
};

mod keybindings;
mod normalization;
mod sftp_performance;

pub use self::keybindings::default_keybindings;
pub use self::sftp_performance::{
    SftpPerformanceSettings, DEFAULT_SFTP_GLOBAL_TRANSFERS, DEFAULT_SFTP_HOST_TRANSFERS,
    DEFAULT_SFTP_PACKET_BYTES, DEFAULT_SFTP_PIPELINE_DEPTH, DEFAULT_SFTP_TIMEOUT_SECONDS,
    MAX_SFTP_GLOBAL_TRANSFERS, MAX_SFTP_HOST_TRANSFERS, MAX_SFTP_PACKET_BYTES,
    MAX_SFTP_PIPELINE_DEPTH, MAX_SFTP_TIMEOUT_SECONDS, MIN_SFTP_GLOBAL_TRANSFERS,
    MIN_SFTP_HOST_TRANSFERS, MIN_SFTP_PACKET_BYTES, MIN_SFTP_PIPELINE_DEPTH,
    MIN_SFTP_TIMEOUT_SECONDS,
};

use self::normalization::{
    normalize_custom_skill_directory_path, normalize_identifier, normalize_name_values,
    normalize_optional_identifier, normalize_optional_text, normalize_required_text,
    normalize_string_list, normalize_tool_name,
};

/// AI 上下文最近输出默认字节数。
pub const DEFAULT_AI_CONTEXT_OUTPUT_BYTES: usize = 12 * 1024;
/// AI 上下文最近输出最小字节数。
pub const MIN_AI_CONTEXT_OUTPUT_BYTES: usize = 512;
/// AI 上下文最近输出最大字节数。
pub const MAX_AI_CONTEXT_OUTPUT_BYTES: usize = 24 * 1024;
/// 终端 inline suggestion 诊断保留最小天数。
pub const MIN_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS: u32 = 1;
/// 终端 inline suggestion 诊断保留最大天数。
pub const MAX_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS: u32 = 3650;
/// 终端 inline suggestion 审计事件默认保留天数。
pub const DEFAULT_TERMINAL_INLINE_SUGGESTION_AUDIT_RETENTION_DAYS: u32 = 30;
/// 终端 inline suggestion 反馈事件默认保留天数。
pub const DEFAULT_TERMINAL_INLINE_SUGGESTION_FEEDBACK_RETENTION_DAYS: u32 = 365;
const DEFAULT_CUSTOM_SKILLS_DIRECTORY: &str = "~/.kerminal/skills";
const ERRONEOUS_CODEX_SKILLS_DIRECTORY: &str = "~/.codex/skills";

/// 深浅色主题模式。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    /// 始终使用深色界面。
    #[default]
    Dark,
    /// 始终使用浅色界面。
    Light,
    /// 跟随系统深浅色偏好。
    System,
}

/// 工作台界面密度。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InterfaceDensity {
    /// 更紧凑的标签栏和终端间距。
    Compact,
    /// 默认舒适密度。
    #[default]
    Comfortable,
    /// 更宽松的阅读密度。
    Spacious,
}

/// 界面语言偏好。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InterfaceLanguage {
    /// 跟随系统或当前内置语言。
    #[default]
    System,
    /// 简体中文。
    ZhCn,
    /// 英文。
    EnUs,
}

/// 主页面背景图铺放方式。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BackgroundImageFit {
    /// 铺满工作台，可能裁切图片边缘。
    #[default]
    Cover,
    /// 完整显示图片，不裁切边缘。
    Contain,
    /// 重复平铺图片。
    Tile,
}

/// 终端内置配色方案。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalColorScheme {
    /// Kerminal 默认终端色盘。
    #[default]
    Kerminal,
    /// Tokyo Night 风格低亮度色盘。
    TokyoNight,
    /// Solarized 经典低对比色盘。
    Solarized,
    /// GitHub 代码区风格清晰色盘。
    Github,
}

/// xterm 光标形态。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalCursorStyle {
    /// 块状光标。
    #[default]
    Block,
    /// 竖线光标。
    Bar,
    /// 下划线光标。
    Underline,
}

/// 终端普通文本字重。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalFontWeight {
    /// 常规字重。
    #[default]
    Normal,
    /// 中等字重。
    Medium,
    /// 加粗字重。
    Bold,
}

/// 终端右键行为。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalRightClickBehavior {
    /// 不执行终端动作。
    None,
    /// 右键直接粘贴。
    Paste,
    /// 打开终端上下文菜单。
    #[default]
    Menu,
}

/// 终端 inline suggestion 接受按键。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalInlineSuggestionAcceptKey {
    /// 不提供接受按键，只显示建议。
    Disabled,
    /// 使用右方向键接受灰色后缀。
    #[default]
    RightArrow,
}

/// 生产主机 inline suggestion 策略。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalInlineSuggestionProductionHostPolicy {
    /// 正常策略。
    Normal,
    /// 受限策略，AI 默认关闭，危险建议降权。
    #[default]
    Restricted,
}

/// 终端 inline suggestion provider 开关。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInlineSuggestionProviderSettings {
    /// 历史命令 provider。
    #[serde(default = "default_true")]
    pub history: bool,
    /// 远端路径 provider。
    #[serde(default = "default_true")]
    pub remote_path: bool,
    /// 远端 PATH 命令 provider。
    #[serde(default = "default_true")]
    pub remote_command: bool,
    /// Git refs provider。
    #[serde(default = "default_true")]
    pub git: bool,
    /// 离线 CLI spec provider。
    #[serde(default = "default_true")]
    pub spec: bool,
    /// AI provider，默认关闭。
    #[serde(default)]
    pub ai: bool,
}

impl Default for TerminalInlineSuggestionProviderSettings {
    fn default() -> Self {
        Self {
            history: true,
            remote_path: true,
            remote_command: true,
            git: true,
            spec: true,
            ai: false,
        }
    }
}

/// 终端 inline suggestion 设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInlineSuggestionSettings {
    /// 是否启用 inline suggestion。
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 接受建议的按键。
    #[serde(default)]
    pub accept_key: TerminalInlineSuggestionAcceptKey,
    /// provider 开关。
    #[serde(default)]
    pub providers: TerminalInlineSuggestionProviderSettings,
    /// 是否允许远端只读探测预热。
    #[serde(default = "default_true")]
    pub remote_probe_enabled: bool,
    /// 生产主机策略。
    #[serde(default)]
    pub production_host_policy: TerminalInlineSuggestionProductionHostPolicy,
    /// suggestion 审计事件保留天数。
    #[serde(default = "default_terminal_inline_suggestion_audit_retention_days")]
    pub audit_retention_days: u32,
    /// suggestion 反馈事件保留天数。
    #[serde(default = "default_terminal_inline_suggestion_feedback_retention_days")]
    pub feedback_retention_days: u32,
}

impl Default for TerminalInlineSuggestionSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            accept_key: TerminalInlineSuggestionAcceptKey::RightArrow,
            providers: TerminalInlineSuggestionProviderSettings::default(),
            remote_probe_enabled: true,
            production_host_policy: TerminalInlineSuggestionProductionHostPolicy::Restricted,
            audit_retention_days: DEFAULT_TERMINAL_INLINE_SUGGESTION_AUDIT_RETENTION_DAYS,
            feedback_retention_days: DEFAULT_TERMINAL_INLINE_SUGGESTION_FEEDBACK_RETENTION_DAYS,
        }
    }
}

/// 终端渲染外观设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAppearance {
    /// 连接异常断开后是否自动重连。
    #[serde(default = "default_true")]
    pub auto_reconnect: bool,
    /// 终端配色方案。
    #[serde(default)]
    pub color_scheme: TerminalColorScheme,
    /// 浅色界面下的终端配色方案。
    #[serde(default)]
    pub light_color_scheme: TerminalColorScheme,
    /// 深色界面下的终端配色方案。
    #[serde(default)]
    pub dark_color_scheme: TerminalColorScheme,
    /// xterm 使用的等宽字体族。
    pub font_family: String,
    /// 终端字号，单位 px。
    pub font_size: u16,
    /// 普通文本字重。
    #[serde(default)]
    pub font_weight: TerminalFontWeight,
    /// macOS Option 键是否作为 Meta 键处理。
    #[serde(default)]
    pub mac_option_is_meta: bool,
    /// 行高倍率。
    pub line_height: f64,
    /// xterm 光标形态。
    #[serde(default)]
    pub cursor_style: TerminalCursorStyle,
    /// 光标是否闪烁。
    pub cursor_blink: bool,
    /// 终端右键行为。
    #[serde(default)]
    pub right_click_behavior: TerminalRightClickBehavior,
    /// 选中文本后是否自动复制到剪贴板。
    #[serde(default)]
    pub selection_copy: bool,
    /// 是否在标签标题前显示序号。
    #[serde(default)]
    pub show_tab_numbers: bool,
    /// 关闭终端标签前是否确认。
    #[serde(default = "default_true")]
    pub confirm_close_tab: bool,
    /// 终端 inline suggestion 设置。
    #[serde(default)]
    pub inline_suggestion: TerminalInlineSuggestionSettings,
    /// xterm 滚屏缓冲行数。
    pub scrollback: u32,
}

impl Default for TerminalAppearance {
    fn default() -> Self {
        Self {
            auto_reconnect: true,
            color_scheme: TerminalColorScheme::Kerminal,
            light_color_scheme: TerminalColorScheme::Kerminal,
            dark_color_scheme: TerminalColorScheme::Kerminal,
            font_family: r#""JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, monospace"#
                .to_string(),
            font_size: 15,
            font_weight: TerminalFontWeight::Normal,
            mac_option_is_meta: false,
            line_height: 1.35,
            cursor_style: TerminalCursorStyle::Block,
            cursor_blink: true,
            right_click_behavior: TerminalRightClickBehavior::Menu,
            selection_copy: false,
            show_tab_numbers: false,
            confirm_close_tab: true,
            inline_suggestion: TerminalInlineSuggestionSettings::default(),
            scrollback: 5000,
        }
    }
}

/// 应用界面外观设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    /// 界面语言偏好。
    #[serde(default)]
    pub interface_language: InterfaceLanguage,
    /// 是否启用主页面背景图。
    #[serde(default)]
    pub background_enabled: bool,
    /// 背景图铺放方式。
    #[serde(default)]
    pub background_fit: BackgroundImageFit,
    /// 主页面背景图路径。
    #[serde(default)]
    pub background_image_path: String,
    /// 背景图层不透明度百分比。
    #[serde(default = "default_background_opacity")]
    pub background_opacity: u8,
    /// 应用窗口材料不透明度百分比。
    #[serde(default = "default_window_opacity")]
    pub window_opacity: u8,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            interface_language: InterfaceLanguage::System,
            background_enabled: false,
            background_fit: BackgroundImageFit::Cover,
            background_image_path: String::new(),
            background_opacity: default_background_opacity(),
            window_opacity: default_window_opacity(),
        }
    }
}

/// 快捷键生效范围。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum KeybindingScope {
    /// 全局窗口或工作台级快捷键。
    Global,
    /// 终端获得焦点时的快捷键。
    Terminal,
    /// 工作区布局和工具面板快捷键。
    Workspace,
}

/// 单个快捷键默认配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingSetting {
    /// 稳定 action id，后续与 tool registry / command palette 对齐。
    pub action: String,
    /// 中文用户可见名称。
    pub label: String,
    /// 用户可见说明，描述来源、用途和限制。
    #[serde(default)]
    pub description: String,
    /// 用户可见快捷键组合。
    #[serde(default)]
    pub binding: String,
    /// Windows / Linux 默认快捷键组合。
    #[serde(default)]
    pub windows_binding: String,
    /// macOS 默认快捷键组合。
    #[serde(default)]
    pub mac_binding: String,
    /// 快捷键生效范围。
    pub scope: KeybindingScope,
    /// 当前版本是否支持在 UI 中编辑。
    pub editable: bool,
}

/// 自定义 MCP Server transport 类型。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CustomMcpTransportKind {
    /// 通过本地命令 stdin/stdout 连接 MCP Server。
    #[default]
    Stdio,
    /// 通过 Streamable HTTP endpoint 连接 MCP Server。
    Http,
    /// 旧配置兼容值：保存时会按 HTTP 处理。
    Sse,
    /// 旧配置兼容值：保存时会按 HTTP 处理。
    WebSocket,
}

/// 自定义 MCP Server 的环境变量或 header 配置项。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomMcpNameValue {
    /// 环境变量名或 header 名。
    #[serde(default)]
    pub name: String,
    /// 变量值或引用。建议使用 `${ENV_NAME}` 或 `credential:...`，不要保存明文密钥。
    #[serde(default)]
    pub value: String,
}

/// 从 MCP Server `tools/list` 发现并缓存的工具。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomMcpServerToolSetting {
    /// Server 原始 MCP tool name。
    #[serde(default)]
    pub name: String,
    /// MCP tool title。
    #[serde(default)]
    pub title: String,
    /// MCP tool description。
    #[serde(default)]
    pub description: String,
    /// MCP tool inputSchema。
    #[serde(default = "default_mcp_input_schema")]
    pub input_schema: Value,
    /// 风险等级；外部 MCP 默认按远程能力处理。
    #[serde(default = "default_custom_mcp_tool_risk")]
    pub risk: ToolRiskLevel,
    /// 确认策略；外部 MCP 默认每次确认。
    #[serde(default = "default_custom_mcp_confirmation")]
    pub confirmation: ToolConfirmationPolicy,
    /// 审计策略。
    #[serde(default = "default_custom_mcp_audit")]
    pub audit: ToolAuditPolicy,
    /// 是否启用该工具。
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 最近 discovery 时间戳。
    #[serde(default)]
    pub discovered_at: Option<u64>,
}

/// 用户自定义 MCP Server 配置，参考常见 agent 的 `mcpServers` 心智。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomMcpServerSetting {
    /// 稳定 id。
    #[serde(default)]
    pub id: String,
    /// 用户可见名称。
    #[serde(default)]
    pub name: String,
    /// 说明。
    #[serde(default)]
    pub description: String,
    /// 是否启用。
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// transport 类型。
    #[serde(default)]
    pub transport: CustomMcpTransportKind,
    /// stdio 启动命令。
    #[serde(default)]
    pub command: String,
    /// stdio 启动参数。
    #[serde(default)]
    pub args: Vec<String>,
    /// Streamable HTTP endpoint。旧 SSE/WebSocket 配置会归一化为 HTTP。
    #[serde(default)]
    pub url: String,
    /// HTTP Bearer token 来源环境变量名，不保存 token value。
    #[serde(default)]
    pub bearer_token_env_var: String,
    /// stdio 环境变量。
    #[serde(default)]
    pub env: Vec<CustomMcpNameValue>,
    /// Streamable HTTP headers。
    #[serde(default)]
    pub headers: Vec<CustomMcpNameValue>,
    /// 从 server 发现到的工具缓存。
    #[serde(default)]
    pub tools: Vec<CustomMcpServerToolSetting>,
    /// 最近 discovery 时间戳。
    #[serde(default)]
    pub last_discovered_at: Option<u64>,
    /// 最近 discovery 错误摘要。
    #[serde(default)]
    pub last_discovery_error: Option<String>,
}

/// 用户自定义 skills 文件夹。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomMcpSkillDirectorySetting {
    /// 稳定 id。
    #[serde(default)]
    pub id: String,
    /// skills 根目录。每个子目录包含一个 SKILL.md。
    #[serde(default)]
    pub path: String,
    /// 是否启用。
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// AI 可见的用户自定义 MCP 与 skills 扩展配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiMcpSettings {
    /// 自定义 MCP Servers。
    #[serde(default)]
    pub servers: Vec<CustomMcpServerSetting>,
    /// 用户自定义 skills 文件夹。
    #[serde(default = "default_custom_skill_directories")]
    pub skill_directories: Vec<CustomMcpSkillDirectorySetting>,
}

/// AI Agent 安全策略设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiSecuritySettings {
    /// AI 当前终端上下文最多读取的最近输出字节数。
    #[serde(default = "default_ai_context_max_output_bytes")]
    pub context_max_output_bytes: usize,
    /// 是否允许后续把命令历史纳入 AI 上下文。
    #[serde(default)]
    pub include_command_history: bool,
    /// 远程 SSH/SFTP/服务器信息工具是否默认要求用户确认。
    #[serde(default = "default_true")]
    pub require_remote_approval: bool,
    /// 是否允许破坏性工具进入可执行策略。
    #[serde(default)]
    pub allow_destructive_tools: bool,
    /// AI 工具调用确认策略。
    #[serde(default)]
    pub command_approval_policy: AiCommandApprovalPolicy,
    /// AI 发起命令的默认超时秒数。
    #[serde(default = "default_command_timeout_seconds")]
    pub command_timeout_seconds: u16,
    /// 附带终端最近输出行数的显示配置。
    #[serde(default = "default_terminal_tail_lines")]
    pub terminal_tail_lines: u16,
    /// 用户自定义系统偏好，不存放密钥。
    #[serde(default)]
    pub custom_instructions: String,
    /// 用户自定义 MCP Servers、discovered tools 和 skills 文件夹。
    #[serde(default)]
    pub mcp: AiMcpSettings,
}

/// AI 工具调用确认模式。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiCommandApprovalPolicy {
    /// 所有 AI 工具调用都需要用户确认。
    Always,
    /// 读取类可自动通过，写入、远程、批量和危险操作进入确认。
    #[default]
    Risky,
    /// 放宽确认，允许非禁用工具自动执行。
    Relaxed,
}

impl Default for AiSecuritySettings {
    fn default() -> Self {
        Self {
            allow_destructive_tools: false,
            command_approval_policy: AiCommandApprovalPolicy::Risky,
            command_timeout_seconds: default_command_timeout_seconds(),
            context_max_output_bytes: DEFAULT_AI_CONTEXT_OUTPUT_BYTES,
            custom_instructions: String::new(),
            include_command_history: false,
            mcp: AiMcpSettings::default(),
            require_remote_approval: true,
            terminal_tail_lines: default_terminal_tail_lines(),
        }
    }
}

impl AiSecuritySettings {
    /// 返回历史 Tool Registry 策略，用于保持非持久化调用入口的兼容行为。
    pub fn legacy_tool_policy() -> Self {
        Self {
            allow_destructive_tools: true,
            command_approval_policy: AiCommandApprovalPolicy::Risky,
            command_timeout_seconds: default_command_timeout_seconds(),
            context_max_output_bytes: DEFAULT_AI_CONTEXT_OUTPUT_BYTES,
            custom_instructions: String::new(),
            include_command_history: false,
            mcp: AiMcpSettings::default(),
            require_remote_approval: true,
            terminal_tail_lines: default_terminal_tail_lines(),
        }
    }
}

/// Kerminal 应用设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// 应用界面外观设置。
    #[serde(default)]
    pub appearance: AppearanceSettings,
    /// 工作台界面密度。
    #[serde(default)]
    pub interface_density: InterfaceDensity,
    /// 应用主题模式。
    #[serde(default)]
    pub theme_mode: ThemeMode,
    /// 终端外观设置。
    #[serde(default)]
    pub terminal: TerminalAppearance,
    /// 快捷键设置。
    #[serde(default = "default_keybindings")]
    pub keybindings: Vec<KeybindingSetting>,
    /// AI Agent 安全策略。
    #[serde(default)]
    pub ai: AiSecuritySettings,
    /// SFTP 传输和连接性能设置。
    #[serde(default)]
    pub sftp: SftpPerformanceSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettings::default(),
            interface_density: InterfaceDensity::Comfortable,
            theme_mode: ThemeMode::Dark,
            terminal: TerminalAppearance::default(),
            keybindings: default_keybindings(),
            ai: AiSecuritySettings::default(),
            sftp: SftpPerformanceSettings::default(),
        }
    }
}

impl AppSettings {
    /// 返回经过业务范围校验后的设置。
    pub fn validated(mut self) -> AppResult<Self> {
        self.appearance.background_image_path =
            self.appearance.background_image_path.trim().to_string();
        if self.appearance.background_image_path.len() > 1024 {
            return Err(AppError::InvalidInput(
                "背景图路径不能超过 1024 个字符".to_string(),
            ));
        }
        self.appearance.background_opacity = self.appearance.background_opacity.min(100);
        self.appearance.window_opacity = self.appearance.window_opacity.clamp(35, 100);
        self.terminal.font_family = self.terminal.font_family.trim().to_string();

        if self.terminal.font_family.is_empty() {
            return Err(AppError::InvalidInput("终端字体不能为空".to_string()));
        }
        if self.terminal.font_family.len() > 160 {
            return Err(AppError::InvalidInput("终端字体配置过长".to_string()));
        }
        if !(10..=24).contains(&self.terminal.font_size) {
            return Err(AppError::InvalidInput(
                "终端字号需要在 10 到 24 之间".to_string(),
            ));
        }
        if !(1.0..=1.8).contains(&self.terminal.line_height) {
            return Err(AppError::InvalidInput(
                "终端行高需要在 1.0 到 1.8 之间".to_string(),
            ));
        }
        if !(1_000..=50_000).contains(&self.terminal.scrollback) {
            return Err(AppError::InvalidInput(
                "滚屏缓冲需要在 1000 到 50000 行之间".to_string(),
            ));
        }
        self.terminal.inline_suggestion.audit_retention_days =
            self.terminal.inline_suggestion.audit_retention_days.clamp(
                MIN_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS,
                MAX_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS,
            );
        self.terminal.inline_suggestion.feedback_retention_days = self
            .terminal
            .inline_suggestion
            .feedback_retention_days
            .clamp(
                MIN_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS,
                MAX_TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS,
            );

        if self.keybindings.is_empty() {
            self.keybindings = default_keybindings();
        }
        if self.ai.command_approval_policy == AiCommandApprovalPolicy::Risky
            && !self.ai.require_remote_approval
        {
            self.ai.command_approval_policy = AiCommandApprovalPolicy::Relaxed;
        }
        self.ai.context_max_output_bytes = self
            .ai
            .context_max_output_bytes
            .clamp(MIN_AI_CONTEXT_OUTPUT_BYTES, MAX_AI_CONTEXT_OUTPUT_BYTES);
        self.ai.command_timeout_seconds = self.ai.command_timeout_seconds.clamp(5, 600);
        self.ai.terminal_tail_lines = self.ai.terminal_tail_lines.clamp(10, 500);
        self.ai.custom_instructions = self.ai.custom_instructions.trim().to_string();
        if self.ai.custom_instructions.len() > 8000 {
            return Err(AppError::InvalidInput(
                "AI 自定义提示不能超过 8000 个字符".to_string(),
            ));
        }
        self.ai.mcp = self.ai.mcp.validated()?;
        self.sftp = self.sftp.normalized();

        Ok(self)
    }
}

impl AiMcpSettings {
    /// 返回归一化后的 MCP 扩展配置。
    pub fn validated(mut self) -> AppResult<Self> {
        if self.servers.len() > 12 {
            return Err(AppError::InvalidInput(
                "自定义 MCP Server 不能超过 12 个".to_string(),
            ));
        }
        if self.skill_directories.len() > 8 {
            return Err(AppError::InvalidInput(
                "自定义 Skills 文件夹不能超过 8 个".to_string(),
            ));
        }

        for server in &mut self.servers {
            server.id = normalize_identifier(&server.id, "mcp server id")?;
            server.name = normalize_required_text(&server.name, "MCP Server 名称", 120)?;
            server.description = normalize_optional_text(&server.description, 500);
            server.command = server.command.trim().to_string();
            server.url = server.url.trim().to_string();
            server.bearer_token_env_var =
                normalize_optional_identifier(&server.bearer_token_env_var, 120);
            server.args = normalize_string_list(std::mem::take(&mut server.args), 120, 500);
            server.env = normalize_name_values(std::mem::take(&mut server.env), 60, 1000);
            server.headers = normalize_name_values(std::mem::take(&mut server.headers), 60, 1000);
            server.last_discovery_error = server
                .last_discovery_error
                .take()
                .map(|value| normalize_optional_text(&value, 500))
                .filter(|value| !value.is_empty());
            server.transport = match server.transport {
                CustomMcpTransportKind::Stdio => CustomMcpTransportKind::Stdio,
                CustomMcpTransportKind::Http
                | CustomMcpTransportKind::Sse
                | CustomMcpTransportKind::WebSocket => CustomMcpTransportKind::Http,
            };

            match server.transport {
                CustomMcpTransportKind::Stdio if server.command.is_empty() => {
                    return Err(AppError::InvalidInput(format!(
                        "MCP Server {} 的 stdio command 不能为空",
                        server.id
                    )));
                }
                CustomMcpTransportKind::Http if server.url.is_empty() => {
                    return Err(AppError::InvalidInput(format!(
                        "MCP Server {} 的 URL 不能为空",
                        server.id
                    )));
                }
                _ => {}
            }

            if server.tools.len() > 200 {
                return Err(AppError::InvalidInput(format!(
                    "MCP Server {} 的工具缓存不能超过 200 个",
                    server.id
                )));
            }
            for tool in &mut server.tools {
                tool.name = normalize_tool_name(&tool.name, "MCP tool name")?;
                tool.title = normalize_optional_text(&tool.title, 120);
                tool.description = normalize_optional_text(&tool.description, 1200);
                if !tool.input_schema.is_object() {
                    tool.input_schema = default_mcp_input_schema();
                }
            }
        }

        if self.skill_directories.is_empty() {
            self.skill_directories = default_custom_skill_directories();
        }
        for directory in &mut self.skill_directories {
            directory.id = normalize_identifier(&directory.id, "skills directory id")?;
            directory.path = normalize_custom_skill_directory_path(&directory.path)?;
        }

        Ok(self)
    }
}

impl Default for AiMcpSettings {
    fn default() -> Self {
        Self {
            servers: Vec::new(),
            skill_directories: default_custom_skill_directories(),
        }
    }
}

fn default_ai_context_max_output_bytes() -> usize {
    DEFAULT_AI_CONTEXT_OUTPUT_BYTES
}

fn default_true() -> bool {
    true
}

fn default_terminal_inline_suggestion_audit_retention_days() -> u32 {
    DEFAULT_TERMINAL_INLINE_SUGGESTION_AUDIT_RETENTION_DAYS
}

fn default_terminal_inline_suggestion_feedback_retention_days() -> u32 {
    DEFAULT_TERMINAL_INLINE_SUGGESTION_FEEDBACK_RETENTION_DAYS
}

fn default_custom_skill_directories() -> Vec<CustomMcpSkillDirectorySetting> {
    vec![CustomMcpSkillDirectorySetting {
        enabled: true,
        id: "user-skills".to_owned(),
        path: DEFAULT_CUSTOM_SKILLS_DIRECTORY.to_owned(),
    }]
}

fn default_background_opacity() -> u8 {
    100
}

fn default_window_opacity() -> u8 {
    100
}

fn default_command_timeout_seconds() -> u16 {
    30
}

fn default_terminal_tail_lines() -> u16 {
    50
}

fn default_mcp_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {},
        "required": [],
    })
}

fn default_custom_mcp_tool_risk() -> ToolRiskLevel {
    ToolRiskLevel::Remote
}

fn default_custom_mcp_confirmation() -> ToolConfirmationPolicy {
    ToolConfirmationPolicy::Always
}

fn default_custom_mcp_audit() -> ToolAuditPolicy {
    ToolAuditPolicy::Summary
}
