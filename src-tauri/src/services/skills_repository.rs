//! 标准 Agent Skills 文件夹扫描服务。
//!
//! @author kongweiguang

use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

use crate::models::{
    settings::{AiMcpSettings, CustomMcpSkillDirectorySetting},
    tool_registry::{McpDefinitionOrigin, McpSkillDefinition},
};

const MAX_SKILLS_PER_DIRECTORY: usize = 200;
const MAX_PROMPT_GUIDANCE_CHARS: usize = 1400;
const MAX_INSTRUCTION_PREVIEW_CHARS: usize = 1000;

/// 用户自定义 Agent Skills 仓库。
#[derive(Debug, Clone, Default)]
pub struct SkillsRepository;

/// 一次 skills 扫描结果。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SkillCatalog {
    /// 已发现的标准 skill。
    pub entries: Vec<SkillRepositoryEntry>,
    /// 被扫描的目录摘要。
    pub directories: Vec<SkillDirectoryScan>,
}

/// 已发现的单个 skill。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillRepositoryEntry {
    /// 来源配置目录 id。
    pub directory_id: String,
    /// 配置中的原始目录路径。
    pub configured_root: String,
    /// 展开 `~` 后的根目录。
    pub resolved_root: PathBuf,
    /// Skill 文件夹。
    pub directory: PathBuf,
    /// `SKILL.md` 路径。
    pub skill_path: PathBuf,
    /// 文件夹名。
    pub folder_name: String,
    /// 转换后的 MCP skill 定义。
    pub definition: McpSkillDefinition,
    /// 去掉 frontmatter 后的说明预览。
    pub instruction_preview: String,
    /// 说明正文字符数。
    pub instruction_chars: usize,
    /// 预览是否被截断。
    pub preview_truncated: bool,
    /// 是否包含 `scripts/`。
    pub has_scripts: bool,
    /// 是否包含 `references/`。
    pub has_references: bool,
    /// 是否包含 `assets/`。
    pub has_assets: bool,
}

/// 单个配置目录的扫描摘要。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillDirectoryScan {
    /// 来源配置目录 id。
    pub id: String,
    /// 配置中的原始目录路径。
    pub configured_path: String,
    /// 展开 `~` 后的目录。
    pub resolved_path: PathBuf,
    /// 是否启用。
    pub enabled: bool,
    /// 目录是否存在。
    pub exists: bool,
    /// 本次发现的 skill 数。
    pub skill_count: usize,
}

impl SkillsRepository {
    /// 创建 skills repository。
    pub fn new() -> Self {
        Self
    }

    /// 扫描当前 AI MCP 设置中的自定义 skills 目录。
    pub fn discover(&self, custom_mcp: &AiMcpSettings) -> SkillCatalog {
        let mut catalog = SkillCatalog::default();
        let mut seen_skill_paths = BTreeSet::new();

        for directory in &custom_mcp.skill_directories {
            let mut scan = SkillDirectoryScan::from_setting(directory);
            if directory.enabled && scan.exists {
                let discovered =
                    discover_directory(directory, &scan.resolved_path, &mut seen_skill_paths);
                scan.skill_count = discovered.len();
                catalog.entries.extend(discovered);
            }
            catalog.directories.push(scan);
        }

        catalog.entries.sort_by(|left, right| {
            left.definition
                .id
                .cmp(&right.definition.id)
                .then_with(|| left.skill_path.cmp(&right.skill_path))
        });
        catalog
    }
}

impl SkillCatalog {
    /// 返回可放入 Agent 或 MCP manifest 的 skill 定义。
    pub fn definitions(&self) -> Vec<McpSkillDefinition> {
        self.entries
            .iter()
            .map(|entry| entry.definition.clone())
            .collect()
    }
}

impl SkillDirectoryScan {
    fn from_setting(directory: &CustomMcpSkillDirectorySetting) -> Self {
        let resolved_path = expand_user_path(&directory.path);
        Self {
            id: directory.id.clone(),
            configured_path: directory.path.clone(),
            exists: resolved_path.is_dir(),
            resolved_path,
            enabled: directory.enabled,
            skill_count: 0,
        }
    }
}

fn discover_directory(
    setting: &CustomMcpSkillDirectorySetting,
    root: &Path,
    seen_skill_paths: &mut BTreeSet<PathBuf>,
) -> Vec<SkillRepositoryEntry> {
    let mut entries = Vec::new();
    let mut pending_directories = vec![root.to_path_buf()];
    let mut seen_directories = BTreeSet::new();

    while let Some(directory) = pending_directories.pop() {
        if !seen_directories.insert(directory.clone()) {
            continue;
        }
        if let Some(entry) = read_skill_markdown(setting, root, &directory, seen_skill_paths) {
            entries.push(entry);
            if entries.len() >= MAX_SKILLS_PER_DIRECTORY {
                return entries;
            }
        }

        let Ok(children) = fs::read_dir(&directory) else {
            continue;
        };
        let mut child_dirs = children
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>();
        child_dirs.sort();
        pending_directories.extend(child_dirs.into_iter().rev());
    }

    entries
}

fn read_skill_markdown(
    setting: &CustomMcpSkillDirectorySetting,
    root: &Path,
    directory: &Path,
    seen_skill_paths: &mut BTreeSet<PathBuf>,
) -> Option<SkillRepositoryEntry> {
    let skill_path = directory.join("SKILL.md");
    if !seen_skill_paths.insert(skill_path.clone()) {
        return None;
    }
    let content = fs::read_to_string(&skill_path).ok()?;
    let folder_name = directory.file_name()?.to_string_lossy().to_string();
    let metadata = skill_frontmatter(&content);
    let title = metadata
        .name
        .or_else(|| skill_title(&content))
        .unwrap_or_else(|| folder_name.clone());
    let description = metadata
        .description
        .unwrap_or_else(|| skill_description(&content));
    let instructions = skill_instructions(&content);
    let instruction_chars = instructions.chars().count();
    let instruction_preview = clean_skill_text(&instructions, MAX_INSTRUCTION_PREVIEW_CHARS);
    let preview_truncated = instruction_chars > instruction_preview.chars().count();
    let when_to_use = if description.is_empty() {
        format!("用户目标匹配自定义 skill `{title}` 时使用。")
    } else {
        description.clone()
    };
    let id = format!(
        "custom-skill.{}.{}",
        sanitize_skill_id(&setting.id),
        sanitize_skill_id(&folder_name)
    );
    let prompt_guidance = custom_prompt_guidance(&skill_path, &instruction_preview);

    Some(SkillRepositoryEntry {
        directory_id: setting.id.clone(),
        configured_root: setting.path.clone(),
        resolved_root: root.to_path_buf(),
        has_assets: directory.join("assets").is_dir(),
        has_references: directory.join("references").is_dir(),
        has_scripts: directory.join("scripts").is_dir(),
        directory: directory.to_path_buf(),
        folder_name,
        instruction_chars,
        instruction_preview,
        preview_truncated,
        skill_path,
        definition: McpSkillDefinition {
            id,
            title,
            description,
            when_to_use,
            trigger_examples: Vec::new(),
            tool_ids: Vec::new(),
            prompt_guidance,
            origin: McpDefinitionOrigin::Custom,
        },
    })
}

fn custom_prompt_guidance(skill_path: &Path, instruction_preview: &str) -> String {
    let base = format!(
        "自定义 skill 文件 `{}` 已发现。先按说明摘要判断是否适用；摘要不足时说明缺口，不要猜测未注入内容。工具执行只能使用当前 MCP 工具目录中已启用工具，不能因为 skill 存在就绕过 Kerminal 确认和审计。",
        skill_path.display()
    );
    let guidance = if instruction_preview.is_empty() {
        base
    } else {
        format!("{base} 说明摘要：{instruction_preview}")
    };
    clean_skill_text(&guidance, MAX_PROMPT_GUIDANCE_CHARS)
}

#[derive(Debug, Clone, Default)]
struct SkillFrontmatter {
    name: Option<String>,
    description: Option<String>,
}

fn skill_frontmatter(content: &str) -> SkillFrontmatter {
    let mut lines = content.lines();
    let Some(first_line) = lines.next() else {
        return SkillFrontmatter::default();
    };
    if first_line.trim_start_matches('\u{feff}').trim() != "---" {
        return SkillFrontmatter::default();
    }

    let mut metadata = SkillFrontmatter::default();
    let mut block: Option<(String, bool, Vec<String>)> = None;
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            flush_skill_frontmatter_block(&mut metadata, &mut block);
            break;
        }

        if let Some((_, _, block_lines)) = block.as_mut() {
            if line.starts_with(' ') || line.starts_with('\t') || trimmed.is_empty() {
                block_lines.push(line.trim().to_owned());
                continue;
            }
            flush_skill_frontmatter_block(&mut metadata, &mut block);
        }

        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        if matches!(value, "|" | "|-" | "|+" | ">" | ">-" | ">+") {
            block = Some((key, value.starts_with('|'), Vec::new()));
        } else {
            set_skill_frontmatter_value(&mut metadata, &key, clean_yaml_scalar(value));
        }
    }

    metadata
}

fn flush_skill_frontmatter_block(
    metadata: &mut SkillFrontmatter,
    block: &mut Option<(String, bool, Vec<String>)>,
) {
    let Some((key, literal, lines)) = block.take() else {
        return;
    };
    let value = if literal {
        lines.join("\n")
    } else {
        lines
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(" ")
    };
    set_skill_frontmatter_value(metadata, &key, clean_skill_text(&value, 800));
}

fn set_skill_frontmatter_value(metadata: &mut SkillFrontmatter, key: &str, value: String) {
    if value.is_empty() {
        return;
    }
    match key {
        "name" => metadata.name = Some(value.chars().take(120).collect()),
        "description" => metadata.description = Some(value.chars().take(800).collect()),
        _ => {}
    }
}

fn clean_yaml_scalar(value: &str) -> String {
    let value = value.trim();
    let value = value
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|rest| rest.strip_suffix('\''))
        })
        .unwrap_or(value);
    clean_skill_text(value, 800)
}

fn clean_skill_text(value: &str, max_chars: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn skill_title(content: &str) -> Option<String> {
    content
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(120).collect())
}

fn skill_description(content: &str) -> String {
    let instructions = skill_instructions(content);
    let mut lines = Vec::new();
    for line in instructions.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        lines.push(trimmed.to_owned());
        if lines.len() >= 3 {
            break;
        }
    }
    lines.join(" ").chars().take(800).collect()
}

/// 从标准 `SKILL.md` 内容中去掉 YAML frontmatter，返回可供执行阶段读取的完整说明正文。
pub fn skill_instructions_from_markdown(content: &str) -> String {
    skill_instructions(content)
}

fn skill_instructions(content: &str) -> String {
    let mut lines = content.lines();
    let Some(first_line) = lines.next() else {
        return String::new();
    };
    if first_line.trim_start_matches('\u{feff}').trim() != "---" {
        return content.to_owned();
    }

    let mut body_started = false;
    let mut body = Vec::new();
    for line in lines {
        if !body_started {
            if line.trim() == "---" {
                body_started = true;
            }
            continue;
        }
        body.push(line);
    }
    body.join("\n").trim().to_owned()
}

fn sanitize_skill_id(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            let ch = ch.to_ascii_lowercase();
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_owned();
    if sanitized.is_empty() {
        "skill".to_owned()
    } else {
        sanitized
    }
}

/// 展开用户路径中的 `~/` 前缀。
pub fn expand_user_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home_dir) = dirs::home_dir() {
            return home_dir.join(rest);
        }
    }
    PathBuf::from(trimmed)
}
