use crate::{
    error::AppResult,
    models::settings::SftpPerformanceSettings,
    paths::KerminalPaths,
    services::{
        sftp_service::backend::SftpEndpoint,
        ssh_runtime::{facade::SshRuntimeSessionLane, policy::is_external_runtime_target_id},
    },
    storage::config_file_store::ConfigFileStore,
};

use super::errors::config_file_error;

const EXTERNAL_BULK_TRANSFER_PIPELINE_DEPTH: usize = 8;
const EXTERNAL_BULK_TRANSFER_PACKET_BYTES: u32 = 64 * 1024;
const EXTERNAL_BULK_TRANSFER_TIMEOUT_SECONDS: u64 = 180;

pub(super) enum SftpManagedSessionLane {
    Browser,
    BulkTransfer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SftpRuntimeSettings {
    pub(crate) global_transfers: usize,
    pub(crate) host_transfers: usize,
    pub(crate) pipeline_depth: usize,
    pub(crate) packet_bytes: u32,
    pub(crate) timeout_seconds: u64,
}

impl Default for SftpRuntimeSettings {
    fn default() -> Self {
        Self::from(SftpPerformanceSettings::default())
    }
}

impl SftpManagedSessionLane {
    pub(super) fn runtime_lane(self) -> SshRuntimeSessionLane {
        match self {
            Self::Browser => SshRuntimeSessionLane::Capability,
            Self::BulkTransfer => SshRuntimeSessionLane::BulkTransfer,
        }
    }
}

impl From<SftpPerformanceSettings> for SftpRuntimeSettings {
    fn from(settings: SftpPerformanceSettings) -> Self {
        let settings = settings.normalized();
        Self {
            global_transfers: settings.global_transfers,
            host_transfers: settings.host_transfers,
            pipeline_depth: settings.pipeline_depth,
            packet_bytes: settings.packet_bytes,
            timeout_seconds: u64::from(settings.timeout_seconds),
        }
    }
}

impl SftpRuntimeSettings {
    pub(crate) fn for_bulk_transfer_target(self, endpoint: &SftpEndpoint) -> Self {
        if is_external_runtime_target_id(&endpoint.host.id) {
            return self.for_external_bulk_transfer();
        }
        self
    }

    pub(crate) fn for_external_bulk_transfer(mut self) -> Self {
        self.host_transfers = 1;
        self.pipeline_depth = self
            .pipeline_depth
            .min(EXTERNAL_BULK_TRANSFER_PIPELINE_DEPTH);
        self.packet_bytes = self.packet_bytes.min(EXTERNAL_BULK_TRANSFER_PACKET_BYTES);
        self.timeout_seconds = self
            .timeout_seconds
            .max(EXTERNAL_BULK_TRANSFER_TIMEOUT_SECONDS);
        self
    }
}

pub(crate) fn load_sftp_runtime_settings(paths: &KerminalPaths) -> AppResult<SftpRuntimeSettings> {
    let settings = ConfigFileStore::new(paths.root.clone())
        .read_settings_or_default()
        .map_err(config_file_error)?;
    Ok(SftpRuntimeSettings::from(settings.sftp))
}
