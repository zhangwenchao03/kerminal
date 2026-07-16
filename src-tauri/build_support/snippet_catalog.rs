//! 内置片段目录的构建期编译入口。

use self::{
    emission::generate_registry,
    schema::SnippetSpec,
    validation::{validate_registry, validate_spec},
};
use std::{
    collections::BTreeSet,
    fmt, fs,
    path::{Path, PathBuf},
};

#[path = "snippet_catalog/emission.rs"]
mod emission;
#[path = "snippet_catalog/schema.rs"]
mod schema;
#[path = "snippet_catalog/validation.rs"]
mod validation;

pub const SUPPORTED_SCHEMA_VERSION: u32 = 1;
pub const GENERATED_FILE_NAME: &str = "snippet_catalog_generated.rs";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogError {
    relative_path: String,
    field_path: String,
    message: String,
}
impl CatalogError {
    fn new(path: impl Into<String>, field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            relative_path: path.into(),
            field_path: field.into(),
            message: message.into(),
        }
    }
}
impl fmt::Display for CatalogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}: {}: {}",
            self.relative_path, self.field_path, self.message
        )
    }
}
impl std::error::Error for CatalogError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompileOutput {
    pub artifact_path: PathBuf,
    pub artifact_bytes: usize,
    pub snippet_count: usize,
    /// 目标不存在或字节与本次确定性生成结果不一致。
    pub artifact_was_stale: bool,
}
struct LoadedSpec {
    relative_path: String,
    spec: SnippetSpec,
}

/// 编译目录，并把 Rust 静态 registry 写入 Cargo `OUT_DIR`。
pub fn compile_registry(
    source_root: &Path,
    out_dir: &Path,
    known_commands: &BTreeSet<String>,
) -> Result<CompileOutput, CatalogError> {
    let artifact = compile_registry_bytes(source_root, known_commands)?;
    fs::create_dir_all(out_dir)
        .map_err(|e| CatalogError::new("<registry>", "output", e.to_string()))?;
    let artifact_path = out_dir.join(GENERATED_FILE_NAME);
    let artifact_was_stale = fs::read(&artifact_path)
        .map(|existing| existing != artifact)
        .unwrap_or(true);
    if artifact_was_stale {
        fs::write(&artifact_path, &artifact)
            .map_err(|e| CatalogError::new("<registry>", "output", e.to_string()))?;
    }
    Ok(CompileOutput {
        artifact_path,
        artifact_bytes: artifact.len(),
        snippet_count: load_registry(source_root, known_commands)?.len(),
        artifact_was_stale,
    })
}

/// 从 command-spec 源目录提取 canonical command 与 alias 后编译目录。
/// 这里只读取构建输入，不把 TOML 解析带入应用运行时。
pub fn compile_registry_from_command_specs(
    source_root: &Path,
    out_dir: &Path,
    command_spec_root: &Path,
) -> Result<CompileOutput, CatalogError> {
    let known_commands = load_command_identities(command_spec_root)?;
    compile_registry(source_root, out_dir, &known_commands)
}

/// 返回可复现的生成字节，供 stale 检查和测试复用。
pub fn compile_registry_bytes(
    source_root: &Path,
    known_commands: &BTreeSet<String>,
) -> Result<Vec<u8>, CatalogError> {
    Ok(generate_registry(&load_registry(source_root, known_commands)?).into_bytes())
}

/// 使用显式路径顺序编译，验证文件系统枚举顺序不影响生成结果。
#[allow(dead_code)]
pub fn compile_registry_paths(
    source_root: &Path,
    mut paths: Vec<PathBuf>,
    known_commands: &BTreeSet<String>,
) -> Result<Vec<u8>, CatalogError> {
    paths.sort_by_key(|p| relative_path(source_root, p));
    Ok(generate_registry(&load_paths(source_root, paths, known_commands)?).into_bytes())
}

fn load_registry(
    root: &Path,
    commands: &BTreeSet<String>,
) -> Result<Vec<LoadedSpec>, CatalogError> {
    let mut paths = Vec::new();
    collect(root, &mut paths)?;
    load_paths(root, paths, commands)
}
fn collect(dir: &Path, paths: &mut Vec<PathBuf>) -> Result<(), CatalogError> {
    for entry in
        fs::read_dir(dir).map_err(|e| CatalogError::new("<registry>", "source", e.to_string()))?
    {
        let path = entry
            .map_err(|e| CatalogError::new("<registry>", "source", e.to_string()))?
            .path();
        if path.is_dir() {
            collect(&path, paths)?
        } else if path.extension().and_then(|x| x.to_str()) == Some("toml") {
            paths.push(path)
        }
    }
    Ok(())
}
fn load_paths(
    root: &Path,
    mut paths: Vec<PathBuf>,
    commands: &BTreeSet<String>,
) -> Result<Vec<LoadedSpec>, CatalogError> {
    paths.sort_by_key(|p| relative_path(root, p));
    let mut specs = Vec::new();
    for path in paths {
        let relative = relative_path(root, &path);
        let source = fs::read_to_string(&path)
            .map_err(|e| CatalogError::new(&relative, "source", e.to_string()))?;
        let spec = toml::from_str::<SnippetSpec>(&source)
            .map_err(|e| CatalogError::new(&relative, "schema", e.to_string()))?;
        let loaded = LoadedSpec {
            relative_path: relative,
            spec,
        };
        validate_spec(&loaded, commands)?;
        specs.push(loaded);
    }
    validate_registry(&specs)?;
    specs.sort_by(|a, b| {
        (
            &a.spec.pack,
            &a.spec.category,
            a.spec.sort_order,
            &a.spec.id,
        )
            .cmp(&(
                &b.spec.pack,
                &b.spec.category,
                b.spec.sort_order,
                &b.spec.id,
            ))
    });
    Ok(specs)
}
fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn load_command_identities(root: &Path) -> Result<BTreeSet<String>, CatalogError> {
    let mut paths = Vec::new();
    collect(root, &mut paths)?;
    let mut commands = BTreeSet::new();
    for path in paths {
        let relative = relative_path(root, &path);
        let source = fs::read_to_string(&path)
            .map_err(|error| CatalogError::new(&relative, "command_spec", error.to_string()))?;
        let value = toml::from_str::<toml::Value>(&source)
            .map_err(|error| CatalogError::new(&relative, "command_spec", error.to_string()))?;
        let table = value.as_table().ok_or_else(|| {
            CatalogError::new(&relative, "command_spec", "command spec 顶层必须是 table")
        })?;
        if let Some(command) = table.get("command").and_then(toml::Value::as_str) {
            commands.insert(command.to_owned());
        }
        if let Some(aliases) = table.get("aliases").and_then(toml::Value::as_array) {
            commands.extend(
                aliases
                    .iter()
                    .filter_map(toml::Value::as_str)
                    .map(str::to_owned),
            );
        }
    }
    Ok(commands)
}
