//! External SSH launch compatibility shim helpers.
//!
//! @author kongweiguang

use std::{
    env,
    path::{Path, PathBuf},
};

use crate::error::{AppError, AppResult};

use super::{ExternalLaunchBridgeEnvelope, ExternalLaunchSourceTool};

pub const KERMINAL_SHIM_PERSONA_ARG: &str = "--kerminal-shim-persona";
pub const KERMINAL_SHIM_PERSONA_ALIAS_ARG: &str = "--persona";
pub const KERMINAL_SHIM_PERSONA_ENV: &str = "KERMINAL_SHIM_PERSONA";
pub const KERMINAL_MAIN_EXE_ENV: &str = "KERMINAL_MAIN_EXE";

pub fn build_external_launch_shim_envelope(
    argv: Vec<String>,
    cwd: Option<String>,
    env_persona: Option<String>,
) -> AppResult<ExternalLaunchBridgeEnvelope> {
    let (forwarded_argv, arg_persona) = split_shim_control_args(argv)?;
    let argv0 = forwarded_argv.first().ok_or_else(|| {
        AppError::InvalidInput("external launch shim argv must not be empty".to_owned())
    })?;
    let persona = infer_shim_persona(argv0, arg_persona.or(env_persona))?;
    ExternalLaunchBridgeEnvelope::new(persona, forwarded_argv, cwd)
}

pub fn infer_shim_persona(
    argv0: &str,
    override_persona: Option<String>,
) -> AppResult<ExternalLaunchSourceTool> {
    if let Some(persona) = override_persona {
        return ExternalLaunchSourceTool::from_external_name(&persona);
    }
    let filename = Path::new(argv0)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(argv0)
        .to_ascii_lowercase();
    if filename.contains("mobaxterm") || filename.contains("moba") {
        Ok(ExternalLaunchSourceTool::Mobaxterm)
    } else if filename.contains("xshell") {
        Ok(ExternalLaunchSourceTool::Xshell)
    } else if filename.contains("securecrt") {
        Ok(ExternalLaunchSourceTool::Securecrt)
    } else if filename.contains("putty") || filename.contains("plink") {
        Ok(ExternalLaunchSourceTool::Putty)
    } else if filename == "ssh" || filename == "ssh.exe" || filename.contains("openssh") {
        Ok(ExternalLaunchSourceTool::Openssh)
    } else {
        Err(AppError::InvalidInput(
            "external launch shim persona is required".to_owned(),
        ))
    }
}

pub fn resolve_kerminal_main_executable(current_exe: &Path) -> Option<PathBuf> {
    if let Ok(path) = env::var(KERMINAL_MAIN_EXE_ENV) {
        let path = PathBuf::from(path);
        if path != current_exe {
            return Some(path);
        }
    }

    let executable_name = if cfg!(windows) {
        "kerminal.exe"
    } else {
        "kerminal"
    };
    let parent = current_exe.parent()?;
    let sibling = parent.join(executable_name);
    if is_distinct_file(&sibling, current_exe) {
        return Some(sibling);
    }
    let parent_sibling = parent.parent()?.join(executable_name);
    if is_distinct_file(&parent_sibling, current_exe) {
        return Some(parent_sibling);
    }
    None
}

fn split_shim_control_args(argv: Vec<String>) -> AppResult<(Vec<String>, Option<String>)> {
    let mut forwarded = Vec::with_capacity(argv.len());
    let mut persona = None;
    let mut iter = argv.into_iter();
    while let Some(arg) = iter.next() {
        if arg == KERMINAL_SHIM_PERSONA_ARG || arg == KERMINAL_SHIM_PERSONA_ALIAS_ARG {
            let value = iter.next().ok_or_else(|| {
                AppError::InvalidInput("external launch shim persona is missing".to_owned())
            })?;
            persona = Some(value);
            continue;
        }
        forwarded.push(arg);
    }
    if forwarded.is_empty() {
        return Err(AppError::InvalidInput(
            "external launch shim argv must not be empty".to_owned(),
        ));
    }
    Ok((forwarded, persona))
}

fn is_distinct_file(path: &Path, current_exe: &Path) -> bool {
    path != current_exe && path.exists()
}
