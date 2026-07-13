//! 内置片段目录的构建期 Serde schema。

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SnippetSpec {
    #[serde(default)]
    pub(super) schema_version: u32,
    #[serde(default)]
    pub(super) id: String,
    #[serde(default)]
    pub(super) catalog_version: String,
    #[serde(default)]
    pub(super) pack: String,
    #[serde(default)]
    pub(super) category: String,
    #[serde(default)]
    pub(super) sort_order: u32,
    #[serde(default)]
    pub(super) title: String,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) template: String,
    #[serde(default)]
    pub(super) command_spec: String,
    #[serde(default)]
    pub(super) scope: Scope,
    #[serde(default)]
    pub(super) platforms: Vec<Platform>,
    #[serde(default)]
    pub(super) shells: Vec<Shell>,
    #[serde(default)]
    pub(super) capabilities: Vec<String>,
    #[serde(default)]
    pub(super) tags: Vec<String>,
    #[serde(default)]
    pub(super) risk: Risk,
    #[serde(default)]
    pub(super) sensitive: bool,
    #[serde(default)]
    pub(super) duration: Duration,
    #[serde(default)]
    pub(super) default_action: DefaultAction,
    #[serde(default)]
    pub(super) variables: Vec<VariableSpec>,
    #[serde(default)]
    pub(super) source: SourceSpec,
    #[serde(default)]
    pub(super) owner: String,
    #[serde(default)]
    pub(super) tested_version: String,
    #[serde(default)]
    pub(super) updated_at: String,
    #[serde(default)]
    pub(super) deprecated: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SourceSpec {
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) url: String,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Scope {
    #[default]
    Any,
    Local,
    Ssh,
}
impl Scope {
    pub(super) fn value(self) -> &'static str {
        match self {
            Self::Any => "any",
            Self::Local => "local",
            Self::Ssh => "ssh",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Platform {
    Windows,
    Macos,
    Linux,
}
impl Platform {
    pub(super) fn mask(self) -> u8 {
        match self {
            Self::Windows => 1,
            Self::Macos => 2,
            Self::Linux => 4,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Shell {
    Bash,
    Zsh,
    Fish,
    #[serde(rename = "power_shell")]
    Pwsh,
    Cmd,
}
impl Shell {
    pub(super) fn mask(self) -> u8 {
        match self {
            Self::Bash => 1,
            Self::Zsh => 2,
            Self::Fish => 4,
            Self::Pwsh => 8,
            Self::Cmd => 16,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum Risk {
    #[default]
    Inspect,
    Change,
    Destructive,
    Unknown,
}
impl Risk {
    pub(super) fn value(self) -> &'static str {
        match self {
            Self::Inspect => "inspect",
            Self::Change => "change",
            Self::Destructive => "destructive",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Duration {
    #[default]
    Instant,
    Streaming,
    #[serde(rename = "high_io")]
    HighIo,
}
impl Duration {
    pub(super) fn value(self) -> &'static str {
        match self {
            Self::Instant => "instant",
            Self::Streaming => "streaming",
            Self::HighIo => "high_io",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum DefaultAction {
    #[default]
    Insert,
    Run,
}
impl DefaultAction {
    pub(super) fn value(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Run => "run",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct VariableSpec {
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) label: String,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) kind: VariableKind,
    #[serde(default)]
    pub(super) required: bool,
    #[serde(default)]
    pub(super) default_value: Option<String>,
    #[serde(default)]
    pub(super) suggestions: Vec<String>,
    #[serde(default)]
    pub(super) validation: Option<String>,
    #[serde(default)]
    pub(super) render_strategy: RenderStrategy,
    #[serde(default)]
    pub(super) sensitive: bool,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum VariableKind {
    #[default]
    Text,
    Path,
    Port,
    Integer,
    Host,
    Url,
    Service,
    Container,
    Enum,
    Secret,
    Raw,
}
impl VariableKind {
    pub(super) fn value(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Path => "path",
            Self::Port => "port",
            Self::Integer => "integer",
            Self::Host => "host",
            Self::Url => "url",
            Self::Service => "service",
            Self::Container => "container",
            Self::Enum => "enum",
            Self::Secret => "secret",
            Self::Raw => "raw",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum RenderStrategy {
    #[default]
    ShellArg,
    ValidatedRaw,
    Literal,
}
impl RenderStrategy {
    pub(super) fn value(self) -> &'static str {
        match self {
            Self::ShellArg => "shell_arg",
            Self::ValidatedRaw => "validated_raw",
            Self::Literal => "literal",
        }
    }
}
