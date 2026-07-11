//! 命令建议 spec 的 Serde schema。
//!
//! @author kongweiguang

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CommandSpec {
    #[serde(default)]
    pub(super) schema_version: u32,
    #[serde(default)]
    pub(super) command: String,
    #[serde(default)]
    pub(super) aliases: Vec<String>,
    #[serde(default)]
    pub(super) platforms: Vec<Platform>,
    #[serde(default)]
    pub(super) shells: Vec<Shell>,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) source: SourceSpec,
    #[serde(default)]
    pub(super) tested_version: String,
    #[serde(default)]
    pub(super) owner: String,
    #[serde(default)]
    pub(super) updated_at: String,
    #[serde(default)]
    pub(super) safety: SafetySpec,
    #[serde(default)]
    pub(super) subcommands: Vec<SubcommandSpec>,
    #[serde(default)]
    pub(super) options: Vec<OptionSpec>,
    #[serde(default)]
    pub(super) arguments: Vec<ArgumentSpec>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SourceSpec {
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) url: String,
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
pub(super) enum Sensitivity {
    #[default]
    Normal,
    Dangerous,
    Sensitive,
}

impl Sensitivity {
    pub(super) fn generated_variant(self) -> &'static str {
        match self {
            Self::Normal => "StaticSpecSensitivity::Normal",
            Self::Dangerous => "StaticSpecSensitivity::Dangerous",
            Self::Sensitive => "StaticSpecSensitivity::Sensitive",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SafetySpec {
    #[serde(default)]
    pub(super) sensitivity: Sensitivity,
    #[serde(default = "default_true")]
    pub(super) allow_inline: bool,
    #[serde(default)]
    pub(super) warning: Option<String>,
}

impl Default for SafetySpec {
    fn default() -> Self {
        Self {
            sensitivity: Sensitivity::Normal,
            allow_inline: true,
            warning: None,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SubcommandSpec {
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) aliases: Vec<String>,
    #[serde(default)]
    pub(super) path: Vec<String>,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) safety: SafetySpec,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct OptionSpec {
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) aliases: Vec<String>,
    #[serde(default)]
    pub(super) path: Vec<String>,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) argument: Option<OptionArgumentSpec>,
    #[serde(default)]
    pub(super) relationships: RelationshipSpec,
    #[serde(default)]
    pub(super) safety: SafetySpec,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ArgumentSpec {
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) path: Vec<String>,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) kind: ArgumentKind,
    #[serde(default)]
    pub(super) required: bool,
    #[serde(default)]
    pub(super) values: Vec<String>,
    #[serde(default)]
    pub(super) relationships: RelationshipSpec,
    #[serde(default)]
    pub(super) safety: SafetySpec,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct OptionArgumentSpec {
    #[serde(default)]
    pub(super) kind: ArgumentKind,
    #[serde(default)]
    pub(super) placeholder: String,
    #[serde(default)]
    pub(super) values: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ArgumentKind {
    #[default]
    String,
    Path,
    Directory,
    File,
    Integer,
    Enum,
    Host,
    Url,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RelationshipSpec {
    #[serde(default)]
    pub(super) conflicts_with: Vec<String>,
    #[serde(default)]
    pub(super) requires: Vec<String>,
}
