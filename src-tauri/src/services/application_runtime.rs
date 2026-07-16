//! 应用级长期任务生命周期编排。
//!
//! @author kongweiguang

use std::sync::{Arc, Mutex};

use crate::{
    error::{AppError, AppResult},
    services::{
        config_change_observer_service::ConfigChangeObserverService,
        mcp_streamable_http_server::McpStreamableHttpServerService,
    },
};

/// 应用长期任务状态快照，不暴露 endpoint、路径或其它敏感运行参数。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ApplicationRuntimeSnapshot {
    pub shutting_down: bool,
}

/// 应用长期任务启动结果；配置观察器失败时其它运行态能力仍保持可用。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApplicationRuntimeStartOutcome {
    /// `true` 表示配置观察器已启用；`false` 不影响其它长期任务启动。
    pub config_observer_started: bool,
}

/// MCP 与配置观察器的统一生命周期 supervisor。
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
    shutting_down: bool,
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

    /// 启动配置观察器；重复调用复用观察器自身的幂等语义。
    pub fn start<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
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
        // 配置观察器是可降级能力；启动失败不能阻断整个桌面应用。
        Ok(ApplicationRuntimeStartOutcome {
            config_observer_started: self.config_observer.start(app).is_ok(),
        })
    }

    /// 返回不含敏感信息的生命周期快照。
    pub fn snapshot(&self) -> AppResult<ApplicationRuntimeSnapshot> {
        let state = self
            .state
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("application_runtime"))?;
        Ok(ApplicationRuntimeSnapshot {
            shutting_down: state.shutting_down,
        })
    }

    /// 取消并 join 全部长期任务；重复调用保持幂等。
    pub async fn shutdown(&self) -> AppResult<()> {
        let _shutdown = self.shutdown_gate.lock().await;
        {
            let _lifecycle = self
                .lifecycle
                .lock()
                .map_err(|_| AppError::StateLockPoisoned("application_runtime_lifecycle"))?;
            let mut state = self
                .state
                .lock()
                .map_err(|_| AppError::StateLockPoisoned("application_runtime"))?;
            state.shutting_down = true;
        }

        let observer_result = self.config_observer.stop();
        let mcp_result = self.mcp_http_server.stop_and_wait().await;

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
