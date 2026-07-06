//! External SSH launch compatibility alias generation.
//!
//! @author kongweiguang

use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
};

use super::ExternalLaunchSourceTool;

const ALIAS_RECORD_SCHEMA_VERSION: u8 = 1;
const ALIAS_RECORD_MANAGED_BY: &str = "kerminal-external-launch-alias";
const ALIAS_MARKER_SUFFIX: &str = ".kerminal-alias.json";

pub const EXTERNAL_LAUNCH_ALIAS_TOOLS: [ExternalLaunchSourceTool; 5] = [
    ExternalLaunchSourceTool::Putty,
    ExternalLaunchSourceTool::Mobaxterm,
    ExternalLaunchSourceTool::Xshell,
    ExternalLaunchSourceTool::Securecrt,
    ExternalLaunchSourceTool::Openssh,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchAliasGenerateRequest {
    pub shim_executable: PathBuf,
    pub alias_directory: PathBuf,
    pub tools: Vec<ExternalLaunchSourceTool>,
    pub prefer_hard_link: bool,
}

impl ExternalLaunchAliasGenerateRequest {
    pub fn new(
        shim_executable: impl Into<PathBuf>,
        alias_directory: impl Into<PathBuf>,
        tools: Vec<ExternalLaunchSourceTool>,
    ) -> Self {
        Self {
            shim_executable: shim_executable.into(),
            alias_directory: alias_directory.into(),
            tools,
            prefer_hard_link: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalLaunchAliasInstallMode {
    HardLink,
    Copy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalLaunchAliasState {
    Missing,
    Managed,
    BlockedNonKerminal,
    StaleMarker,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchAliasSummary {
    pub tool: ExternalLaunchSourceTool,
    pub alias_path: PathBuf,
    pub marker_path: PathBuf,
    pub state: ExternalLaunchAliasState,
    pub install_mode: Option<ExternalLaunchAliasInstallMode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchAliasInspection {
    pub tool: ExternalLaunchSourceTool,
    pub alias_path: PathBuf,
    pub marker_path: PathBuf,
    pub state: ExternalLaunchAliasState,
    pub marker_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchAliasRemoval {
    pub tool: ExternalLaunchSourceTool,
    pub alias_path: PathBuf,
    pub marker_path: PathBuf,
    pub removed_alias: bool,
    pub removed_marker: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalLaunchAliasRecord {
    schema_version: u8,
    managed_by: String,
    tool: ExternalLaunchSourceTool,
    file_name: String,
    alias_fingerprint: ExternalLaunchAliasFingerprint,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalLaunchAliasFingerprint {
    length: u64,
    fnv1a64: String,
}

pub fn default_external_launch_alias_directory(paths: &KerminalPaths) -> PathBuf {
    paths
        .root
        .join("external-launch")
        .join("compatibility-aliases")
}

pub fn external_launch_alias_file_name(tool: ExternalLaunchSourceTool) -> AppResult<&'static str> {
    match tool {
        ExternalLaunchSourceTool::Putty => Ok("putty.exe"),
        ExternalLaunchSourceTool::Mobaxterm => Ok("MobaXterm.exe"),
        ExternalLaunchSourceTool::Xshell => Ok("Xshell.exe"),
        ExternalLaunchSourceTool::Securecrt => Ok("SecureCRT.exe"),
        ExternalLaunchSourceTool::Openssh => Ok("ssh.exe"),
        ExternalLaunchSourceTool::KerminalNative => Err(AppError::InvalidInput(
            "kerminal native launch does not need a compatibility alias".to_owned(),
        )),
    }
}

pub fn external_launch_alias_path(
    alias_directory: impl AsRef<Path>,
    tool: ExternalLaunchSourceTool,
) -> AppResult<PathBuf> {
    Ok(alias_directory
        .as_ref()
        .join(external_launch_alias_file_name(tool)?))
}

pub fn external_launch_alias_marker_path(alias_path: impl AsRef<Path>) -> PathBuf {
    let alias_path = alias_path.as_ref();
    let marker_name = alias_path
        .file_name()
        .map(|name| format!("{}{}", name.to_string_lossy(), ALIAS_MARKER_SUFFIX))
        .unwrap_or_else(|| format!("alias{ALIAS_MARKER_SUFFIX}"));
    alias_path.with_file_name(marker_name)
}

pub fn inspect_external_launch_alias(
    alias_directory: impl AsRef<Path>,
    tool: ExternalLaunchSourceTool,
) -> AppResult<ExternalLaunchAliasInspection> {
    let alias_path = external_launch_alias_path(alias_directory, tool)?;
    let marker_path = external_launch_alias_marker_path(&alias_path);
    let marker_present = marker_path.exists();
    let state = if !alias_path.exists() {
        ExternalLaunchAliasState::Missing
    } else if !marker_present {
        ExternalLaunchAliasState::BlockedNonKerminal
    } else if is_current_kerminal_alias(&alias_path, &marker_path, tool)? {
        ExternalLaunchAliasState::Managed
    } else {
        ExternalLaunchAliasState::StaleMarker
    };

    Ok(ExternalLaunchAliasInspection {
        tool,
        alias_path,
        marker_path,
        state,
        marker_present,
    })
}

pub fn generate_external_launch_aliases(
    request: ExternalLaunchAliasGenerateRequest,
) -> AppResult<Vec<ExternalLaunchAliasSummary>> {
    validate_shim_executable(&request.shim_executable)?;
    fs::create_dir_all(&request.alias_directory)?;

    let tools = normalize_alias_tools(&request.tools)?;
    let mut summaries = Vec::with_capacity(tools.len());
    for tool in tools {
        summaries.push(generate_external_launch_alias(&request, tool)?);
    }
    Ok(summaries)
}

pub fn delete_external_launch_aliases(
    alias_directory: impl AsRef<Path>,
    tools: &[ExternalLaunchSourceTool],
) -> AppResult<Vec<ExternalLaunchAliasRemoval>> {
    let alias_directory = alias_directory.as_ref();
    let tools = normalize_alias_tools(tools)?;
    let mut removals = Vec::with_capacity(tools.len());
    for tool in tools {
        removals.push(delete_external_launch_alias(alias_directory, tool)?);
    }
    Ok(removals)
}

fn generate_external_launch_alias(
    request: &ExternalLaunchAliasGenerateRequest,
    tool: ExternalLaunchSourceTool,
) -> AppResult<ExternalLaunchAliasSummary> {
    let inspection = inspect_external_launch_alias(&request.alias_directory, tool)?;
    match inspection.state {
        ExternalLaunchAliasState::Managed => {
            fs::remove_file(&inspection.alias_path)?;
            remove_file_if_exists(&inspection.marker_path)?;
        }
        ExternalLaunchAliasState::Missing => {
            remove_file_if_exists(&inspection.marker_path)?;
        }
        ExternalLaunchAliasState::BlockedNonKerminal => {
            return Err(AppError::InvalidInput(format!(
                "refusing to overwrite non-Kerminal external launch alias: {}",
                inspection.alias_path.display()
            )));
        }
        ExternalLaunchAliasState::StaleMarker => {
            return Err(AppError::InvalidInput(format!(
                "refusing to overwrite external launch alias with invalid Kerminal marker: {}",
                inspection.alias_path.display()
            )));
        }
    }

    if same_existing_file(&request.shim_executable, &inspection.alias_path) {
        return Err(AppError::InvalidInput(
            "external launch alias must not overwrite the shim executable".to_owned(),
        ));
    }

    let install_mode = install_alias_file(
        &request.shim_executable,
        &inspection.alias_path,
        request.prefer_hard_link,
    )?;
    let record = ExternalLaunchAliasRecord {
        schema_version: ALIAS_RECORD_SCHEMA_VERSION,
        managed_by: ALIAS_RECORD_MANAGED_BY.to_owned(),
        tool,
        file_name: external_launch_alias_file_name(tool)?.to_owned(),
        alias_fingerprint: fingerprint_file(&inspection.alias_path)?,
    };
    fs::write(&inspection.marker_path, serde_json::to_vec_pretty(&record)?)?;

    Ok(ExternalLaunchAliasSummary {
        tool,
        alias_path: inspection.alias_path,
        marker_path: inspection.marker_path,
        state: ExternalLaunchAliasState::Managed,
        install_mode: Some(install_mode),
    })
}

fn delete_external_launch_alias(
    alias_directory: &Path,
    tool: ExternalLaunchSourceTool,
) -> AppResult<ExternalLaunchAliasRemoval> {
    let inspection = inspect_external_launch_alias(alias_directory, tool)?;
    match inspection.state {
        ExternalLaunchAliasState::Managed => {
            fs::remove_file(&inspection.alias_path)?;
            remove_file_if_exists(&inspection.marker_path)?;
            Ok(ExternalLaunchAliasRemoval {
                tool,
                alias_path: inspection.alias_path,
                marker_path: inspection.marker_path,
                removed_alias: true,
                removed_marker: inspection.marker_present,
            })
        }
        ExternalLaunchAliasState::Missing => {
            let removed_marker = remove_file_if_exists(&inspection.marker_path)?;
            Ok(ExternalLaunchAliasRemoval {
                tool,
                alias_path: inspection.alias_path,
                marker_path: inspection.marker_path,
                removed_alias: false,
                removed_marker,
            })
        }
        ExternalLaunchAliasState::BlockedNonKerminal => Err(AppError::InvalidInput(format!(
            "refusing to delete non-Kerminal external launch alias: {}",
            inspection.alias_path.display()
        ))),
        ExternalLaunchAliasState::StaleMarker => Err(AppError::InvalidInput(format!(
            "refusing to delete external launch alias with invalid Kerminal marker: {}",
            inspection.alias_path.display()
        ))),
    }
}

fn normalize_alias_tools(
    tools: &[ExternalLaunchSourceTool],
) -> AppResult<Vec<ExternalLaunchSourceTool>> {
    let source_tools = if tools.is_empty() {
        EXTERNAL_LAUNCH_ALIAS_TOOLS.as_slice()
    } else {
        tools
    };
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for tool in source_tools {
        external_launch_alias_file_name(*tool)?;
        if seen.insert(*tool) {
            normalized.push(*tool);
        }
    }
    Ok(normalized)
}

fn validate_shim_executable(shim_executable: &Path) -> AppResult<()> {
    let metadata = fs::metadata(shim_executable).map_err(|error| {
        AppError::InvalidInput(format!(
            "external launch shim executable is not available: {} ({error})",
            shim_executable.display()
        ))
    })?;
    if !metadata.is_file() {
        return Err(AppError::InvalidInput(format!(
            "external launch shim executable must be a file: {}",
            shim_executable.display()
        )));
    }
    let file_name = shim_executable
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !file_name.starts_with("kerminal-launch-shim") {
        return Err(AppError::InvalidInput(format!(
            "external launch alias source must be the Kerminal shim executable: {}",
            shim_executable.display()
        )));
    }
    Ok(())
}

fn install_alias_file(
    shim_executable: &Path,
    alias_path: &Path,
    prefer_hard_link: bool,
) -> AppResult<ExternalLaunchAliasInstallMode> {
    if prefer_hard_link && fs::hard_link(shim_executable, alias_path).is_ok() {
        return Ok(ExternalLaunchAliasInstallMode::HardLink);
    }

    fs::copy(shim_executable, alias_path)?;
    make_executable(alias_path)?;
    Ok(ExternalLaunchAliasInstallMode::Copy)
}

fn is_current_kerminal_alias(
    alias_path: &Path,
    marker_path: &Path,
    tool: ExternalLaunchSourceTool,
) -> AppResult<bool> {
    let record = match read_alias_record(marker_path) {
        Ok(record) => record,
        Err(_) => return Ok(false),
    };
    if record.schema_version != ALIAS_RECORD_SCHEMA_VERSION
        || record.managed_by != ALIAS_RECORD_MANAGED_BY
        || record.tool != tool
        || record.file_name != external_launch_alias_file_name(tool)?
    {
        return Ok(false);
    }
    Ok(fingerprint_file(alias_path)? == record.alias_fingerprint)
}

fn read_alias_record(marker_path: &Path) -> AppResult<ExternalLaunchAliasRecord> {
    let bytes = fs::read(marker_path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn fingerprint_file(path: &Path) -> AppResult<ExternalLaunchAliasFingerprint> {
    let mut file = fs::File::open(path)?;
    let mut length = 0_u64;
    let mut hash = 0xcbf29ce484222325_u64;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        length += read as u64;
        for byte in &buffer[..read] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    Ok(ExternalLaunchAliasFingerprint {
        length,
        fnv1a64: format!("{hash:016x}"),
    })
}

fn same_existing_file(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn remove_file_if_exists(path: &Path) -> AppResult<bool> {
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(AppError::Io(error)),
    }
}

#[cfg(unix)]
fn make_executable(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> AppResult<()> {
    Ok(())
}
