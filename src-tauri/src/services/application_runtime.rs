//! 应用级长期任务生命周期编排。
//!
//! @author kongweiguang

use std::sync::{Arc, Mutex};

use tokio_util::sync::CancellationToken;

use crate::{
    error::{AppError, AppResult},
    services::{
        config_change_observer_service::ConfigChangeObserverService,
        external_launch::{
            bridge::cleanup_external_launch_bridge_server, run_external_launch_bridge_server,
            ExternalLaunchBridgeEndpoint, ExternalLaunchBridgeEventSink, ExternalLaunchIntake,
        },
        mcp_streamable_http_server::McpStreamableHttpServerService,
    },
};

/// 应用长期任务状态快照，不暴露 endpoint、路径或其它敏感运行参数。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ApplicationRuntimeSnapshot {
    pub bridge_running: bool,
    pub shutting_down: bool,
}

/// 应用长期任务启动结果；配置观察器失败时 bridge 仍保持可用。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApplicationRuntimeStartOutcome {
    /// `true` 表示配置观察器已启用；`false` 不影响其它长期任务启动。
    pub config_observer_started: bool,
}

/// MCP、配置观察器和外部启动 bridge 的统一生命周期 supervisor。
#[derive(Debug, Clone)]
pub struct ApplicationRuntime {
    config_observer: ConfigChangeObserverService,
    mcp_http_server: McpStreamableHttpServerService,
    state: Arc<Mutex<ApplicationRuntimeState>>,
    lifecycle: Arc<Mutex<()>>,
    shutdown_gate: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Debug, Default)]
struct ApplicationRuntimeState {
    bridge: Option<BridgeRuntime>,
    shutting_down: bool,
}

#[derive(Debug)]
struct BridgeRuntime {
    cancellation: CancellationToken,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl ApplicationRuntime {
    /// 创建 supervisor；长期任务只在 `start` 后获取平台资源。
    pub fn new(
        config_observer: ConfigChangeObserverService,
        mcp_http_server: McpStreamableHttpServerService,
    ) -> Self {
        Self {
            config_observer,
            mcp_http_server,
            state: Arc::new(Mutex::new(ApplicationRuntimeState::default())),
            lifecycle: Arc::new(Mutex::new(())),
            shutdown_gate: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// 启动配置观察器和外部启动 bridge。重复调用只复用当前任务。
    pub fn start<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        bridge_endpoint: ExternalLaunchBridgeEndpoint,
        intake: ExternalLaunchIntake,
        event_sink: ExternalLaunchBridgeEventSink,
    ) -> AppResult<ApplicationRuntimeStartOutcome> {
        let _lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("application_runtime_lifecycle"))?;
        {
            let state = self
                .state
                .lock()
                .map_err(|_| AppError::StateLockPoisoned("application_runtime"))?;
            if state.shutting_down {
                return Err(AppError::InvalidInput(
                    "application runtime is shutting down".to_owned(),
                ));
            }
        }
        // 配置观察器是可降级能力；启动失败不能阻断外部启动 bridge 或整个桌面应用。
        let outcome = ApplicationRuntimeStartOutcome {
            config_observer_started: self.config_observer.start(app).is_ok(),
        };

        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("application_runtime"))?;
        if state
            .bridge
            .as_ref()
            .is_some_and(|runtime| !runtime.task.inner().is_finished())
        {
            return Ok(outcome);
        }
        state.bridge.take();

        let cancellation = CancellationToken::new();
        let shutdown = cancellation.child_token();
        let cleanup_endpoint = bridge_endpoint.clone();
        let cleanup_intake = intake.clone();
        let task = tauri::async_runtime::spawn(async move {
            let result = tokio::select! {
                result = run_external_launch_bridge_server(bridge_endpoint, intake, event_sink) => result,
                _ = shutdown.cancelled_owned() => Ok(()),
            };
            cleanup_intake.set_bridge_listening(false, None).ok();
            if let Err(error) = cleanup_external_launch_bridge_server(&cleanup_endpoint).await {
                tauri_plugin_log::log::warn!(
                    target: "desktop.lifecycle",
                    "failed to clean external launch bridge endpoint: {error}"
                );
            }
            if let Err(error) = result {
                tauri_plugin_log::log::warn!(
                    target: "desktop.lifecycle",
                    "external launch bridge stopped: {error}"
                );
            }
        });
        state.bridge = Some(BridgeRuntime { cancellation, task });
        Ok(outcome)
    }

    /// 返回不含敏感信息的生命周期快照。
    pub fn snapshot(&self) -> AppResult<ApplicationRuntimeSnapshot> {
        let state = self
            .state
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("application_runtime"))?;
        Ok(ApplicationRuntimeSnapshot {
            bridge_running: state
                .bridge
                .as_ref()
                .is_some_and(|runtime| !runtime.task.inner().is_finished()),
            shutting_down: state.shutting_down,
        })
    }

    /// 取消并 join 全部长期任务；重复调用保持幂等。
    pub async fn shutdown(&self) -> AppResult<()> {
        let _shutdown = self.shutdown_gate.lock().await;
        let bridge = {
            let _lifecycle = self
                .lifecycle
                .lock()
                .map_err(|_| AppError::StateLockPoisoned("application_runtime_lifecycle"))?;
            let mut state = self
                .state
                .lock()
                .map_err(|_| AppError::StateLockPoisoned("application_runtime"))?;
            state.shutting_down = true;
            state.bridge.take()
        };

        let observer_result = self.config_observer.stop();
        let mcp_result = self.mcp_http_server.stop_and_wait().await;
        if let Some(bridge) = bridge {
            bridge.cancellation.cancel();
            let _ = bridge.task.await;
        }

        {
            let _lifecycle = self
                .lifecycle
                .lock()
                .map_err(|_| AppError::StateLockPoisoned("application_runtime_lifecycle"))?;
            if let Ok(mut state) = self.state.lock() {
                state.shutting_down = false;
            }
        }
        observer_result.map_err(AppError::InvalidInput)?;
        mcp_result?;
        Ok(())
    }
}
