//! AppState capability 组合与外部端口失败恢复集成测试。

use std::sync::{Arc, Mutex};

use kerminal_lib::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
    services::ssh_runtime::ManagedSshSessionManager,
    state::{AppStateBuildObserver, AppStateBuildPhase, AppStateBuilder, AppStateExternalPorts},
};
use tempfile::tempdir;

#[test]
fn builder_preserves_observer_phase_order_and_service_getters() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let observer = Arc::new(RecordingObserver::default());

    let state = AppStateBuilder::with_paths(paths)
        .with_build_observer(observer.clone())
        .build()
        .expect("build app state");

    assert_eq!(
        observer.phases(),
        vec![
            AppStateBuildPhase::Operations,
            AppStateBuildPhase::Configuration,
            AppStateBuildPhase::ExternalLaunchPolicy,
            AppStateBuildPhase::Remote,
            AppStateBuildPhase::ApplicationRuntime,
        ]
    );
    // 所有既有 getter 仍从新 bundle 返回原服务类型，并可参与正常初始化。
    assert_eq!(
        state.command_store().database_file(),
        state.paths().command_database_file.as_path()
    );
    let _ = state.agent_context();
    let _ = state.mcp_tool_catalog();
    let _ = state.terminals();
    let _ = state.remote_hosts();
    let _ = state.settings();
}

#[test]
fn injected_agent_workspace_failure_stops_later_bundles_without_leaking_details() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let ports = Arc::new(FailingExternalPorts::at_agent());
    let observer = Arc::new(RecordingObserver::default());

    let error = AppStateBuilder::with_paths(paths.clone())
        .with_build_observer(observer.clone())
        .with_external_ports(ports.clone())
        .build()
        .expect_err("agent workspace port should fail");

    assert!(
        matches!(error, AppError::InvalidInput(message) if message == "agent workspace unavailable")
    );
    assert_eq!(ports.calls(), vec!["prepare_agent_workspace"]);
    assert_eq!(observer.phases(), vec![AppStateBuildPhase::Operations]);
    assert!(paths.command_database_file.is_file());
    assert!(!paths.root.join("settings.toml").exists());
}

#[test]
fn remote_port_failure_releases_partial_state_and_allows_clean_retry() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let ports = Arc::new(FailingExternalPorts::at_ssh_runtime());

    let error = AppStateBuilder::with_paths(paths.clone())
        .with_external_ports(ports.clone())
        .build()
        .expect_err("SSH runtime port should fail");

    assert!(
        matches!(error, AppError::InvalidInput(message) if message == "SSH runtime unavailable")
    );
    assert_eq!(
        ports.calls(),
        vec!["prepare_agent_workspace", "create_ssh_runtime"]
    );
    assert!(paths.root.join("settings.toml").is_file());

    // 失败返回后立刻重试可重新打开 SQLite 并完成远程能力组合，证明无半初始化锁或句柄泄漏。
    let state = AppStateBuilder::with_paths(paths.clone())
        .build()
        .expect("retry app state build after partial failure");
    assert_eq!(state.paths(), &paths);
    let _ = state.ssh_runtime();
}

#[derive(Debug, Default)]
struct RecordingObserver {
    phases: Mutex<Vec<AppStateBuildPhase>>,
}

impl RecordingObserver {
    fn phases(&self) -> Vec<AppStateBuildPhase> {
        self.phases.lock().expect("read phases").clone()
    }
}

impl AppStateBuildObserver for RecordingObserver {
    fn before_phase(&self, phase: AppStateBuildPhase) -> AppResult<()> {
        self.phases.lock().expect("record phase").push(phase);
        Ok(())
    }
}

#[derive(Debug)]
struct FailingExternalPorts {
    calls: Mutex<Vec<&'static str>>,
    fail_agent: bool,
}

impl FailingExternalPorts {
    fn at_agent() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            fail_agent: true,
        }
    }

    fn at_ssh_runtime() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            fail_agent: false,
        }
    }

    fn calls(&self) -> Vec<&'static str> {
        self.calls.lock().expect("read port calls").clone()
    }
}

impl AppStateExternalPorts for FailingExternalPorts {
    fn prepare_agent_workspace(&self, _paths: &KerminalPaths) -> AppResult<()> {
        self.calls
            .lock()
            .expect("record agent port")
            .push("prepare_agent_workspace");
        if self.fail_agent {
            return Err(AppError::InvalidInput(
                "agent workspace unavailable".to_owned(),
            ));
        }
        Ok(())
    }

    fn create_ssh_runtime(&self) -> AppResult<ManagedSshSessionManager> {
        self.calls
            .lock()
            .expect("record SSH port")
            .push("create_ssh_runtime");
        Err(AppError::InvalidInput("SSH runtime unavailable".to_owned()))
    }
}
