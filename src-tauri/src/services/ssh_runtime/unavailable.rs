//! Default unwired managed SSH runtime backend.
//!
//! @author kongweiguang

use std::sync::Arc;

use crate::error::{AppError, AppResult};

use super::{SshRuntimeBackend, SshRuntimeConnectRequest, SshRuntimeConnection};

#[derive(Debug)]
pub(super) struct UnavailableSshRuntimeBackend;

impl SshRuntimeBackend for UnavailableSshRuntimeBackend {
    fn connect(
        &self,
        _request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        Err(AppError::SshCommand(
            "managed SSH runtime backend is not wired yet".to_owned(),
        ))
    }
}
