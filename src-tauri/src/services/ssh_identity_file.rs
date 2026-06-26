//! SSH identity file path normalization.
//!
//! @author kongweiguang

use std::path::PathBuf;

use crate::{
    error::{AppError, AppResult},
    paths::expand_home_relative_path,
};

pub(crate) fn resolve_identity_file_path(path: &str) -> AppResult<PathBuf> {
    if path.contains('\n') || path.contains('\r') || path.contains('\0') {
        return Err(AppError::InvalidInput(
            "SSH 私钥路径不能包含控制字符".to_owned(),
        ));
    }
    expand_home_relative_path(path)
}
