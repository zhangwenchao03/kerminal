//! 命令建议声明式 spec 的构建期编译入口。
//!
//! @author kongweiguang

use std::{
    fmt, fs,
    path::{Path, PathBuf},
};

use self::{
    emission::generate_registry,
    schema::CommandSpec,
    validation::{validate_known_fields, validate_registry, validate_spec},
};

#[path = "command_spec_registry/emission.rs"]
mod emission;
#[path = "command_spec_registry/schema.rs"]
mod schema;
#[path = "command_spec_registry/validation.rs"]
mod validation;

pub const SUPPORTED_SCHEMA_VERSION: u32 = 1;
pub const GENERATED_FILE_NAME: &str = "command_spec_registry_generated.rs";

/// 构建期 spec 错误；消息只携带相对源路径和字段路径。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecError {
    relative_path: String,
    field_path: String,
    message: String,
}

impl SpecError {
    pub(super) fn new(
        relative_path: impl Into<String>,
        field_path: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            relative_path: relative_path.into(),
            field_path: field_path.into(),
            message: message.into(),
        }
    }
}

impl fmt::Display for SpecError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}: {}: {}",
            self.relative_path, self.field_path, self.message
        )
    }
}

impl std::error::Error for SpecError {}

/// 编译结果摘要。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompileOutput {
    pub artifact_path: PathBuf,
    pub artifact_bytes: usize,
    pub command_count: usize,
}

struct LoadedSpec {
    relative_path: String,
    spec: CommandSpec,
}

/// 递归读取、校验并把 registry 写入 OUT_DIR。
pub fn compile_registry(source_root: &Path, out_dir: &Path) -> Result<CompileOutput, SpecError> {
    let specs = load_registry(source_root)?;
    let artifact = generate_registry(&specs).into_bytes();
    fs::create_dir_all(out_dir)
        .map_err(|error| SpecError::new("<registry>", "output", error.to_string()))?;
    let artifact_path = out_dir.join(GENERATED_FILE_NAME);
    fs::write(&artifact_path, &artifact)
        .map_err(|error| SpecError::new("<registry>", "output", error.to_string()))?;
    Ok(CompileOutput {
        artifact_path,
        artifact_bytes: artifact.len(),
        command_count: specs.len(),
    })
}

/// 从目录读取 spec，并返回可复现的生成字节。
#[allow(dead_code)]
pub fn compile_registry_bytes(source_root: &Path) -> Result<Vec<u8>, SpecError> {
    let paths = collect_toml_paths(source_root)?;
    compile_registry_paths(source_root, paths)
}

/// 使用调用方给出的枚举顺序编译；内部排序保证文件系统顺序不影响结果。
#[allow(dead_code)]
pub fn compile_registry_paths(
    source_root: &Path,
    mut paths: Vec<PathBuf>,
) -> Result<Vec<u8>, SpecError> {
    paths.sort_by_key(|path| relative_path(source_root, path));
    let specs = load_registry_paths(source_root, paths)?;
    Ok(generate_registry(&specs).into_bytes())
}

fn load_registry(source_root: &Path) -> Result<Vec<LoadedSpec>, SpecError> {
    let paths = collect_toml_paths(source_root)?;
    load_registry_paths(source_root, paths)
}

fn collect_toml_paths(source_root: &Path) -> Result<Vec<PathBuf>, SpecError> {
    fn visit(directory: &Path, paths: &mut Vec<PathBuf>) -> Result<(), SpecError> {
        let entries = fs::read_dir(directory)
            .map_err(|error| SpecError::new("<registry>", "source", error.to_string()))?;
        for entry in entries {
            let entry =
                entry.map_err(|error| SpecError::new("<registry>", "source", error.to_string()))?;
            let path = entry.path();
            if path.is_dir() {
                visit(&path, paths)?;
            } else if path.extension().and_then(|value| value.to_str()) == Some("toml") {
                paths.push(path);
            }
        }
        Ok(())
    }

    let mut paths = Vec::new();
    visit(source_root, &mut paths)?;
    paths.sort_by_key(|path| relative_path(source_root, path));
    Ok(paths)
}

fn load_registry_paths(
    source_root: &Path,
    paths: Vec<PathBuf>,
) -> Result<Vec<LoadedSpec>, SpecError> {
    let mut specs = Vec::with_capacity(paths.len());
    for path in paths {
        let relative = relative_path(source_root, &path);
        let source = fs::read_to_string(&path)
            .map_err(|error| SpecError::new(&relative, "source", error.to_string()))?;
        let value = toml::from_str::<toml::Value>(&source)
            .map_err(|error| SpecError::new(&relative, "schema", error.to_string()))?;
        validate_known_fields(&relative, &value)?;
        let spec = toml::from_str::<CommandSpec>(&source)
            .map_err(|error| SpecError::new(&relative, "schema", error.to_string()))?;
        validate_spec(&relative, &spec)?;
        specs.push(LoadedSpec {
            relative_path: relative,
            spec,
        });
    }
    validate_registry(&specs)?;
    specs.sort_by(|left, right| left.spec.command.cmp(&right.spec.command));
    Ok(specs)
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
