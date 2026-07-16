//! AppState 的外部启动进程内能力组合。
//!
//! @author kongweiguang

use crate::services::external_launch::{ExternalLaunchIntake, ExternalLaunchTaskRegistry};

/// 外部启动 intake 与任务注册表能力集合。
#[derive(Debug)]
pub(super) struct OperationalCapabilities {
    pub(super) external_launch_intake: ExternalLaunchIntake,
    pub(super) external_launch_tasks: ExternalLaunchTaskRegistry,
}

impl OperationalCapabilities {
    pub(super) fn new() -> Self {
        Self {
            external_launch_intake: ExternalLaunchIntake::new(),
            external_launch_tasks: ExternalLaunchTaskRegistry::new(),
        }
    }
}
