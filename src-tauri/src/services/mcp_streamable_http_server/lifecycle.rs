//! Streamable HTTP MCP server 生命周期状态机。
//!
//! @author kongweiguang

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use axum::Router;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use tokio_util::sync::CancellationToken;

use crate::{
    error::{AppError, AppResult},
    models::mcp_server::{McpHttpServerStartRequest, McpHttpServerStatus},
};

use super::{
    bind_loopback_port_from, normalize_bind_address, requested_start_port, DEFAULT_BIND_ADDRESS,
    MCP_AGENT_PATH, MCP_PATH,
};

/// Streamable HTTP MCP Server 生命周期服务。
#[derive(Debug, Clone)]
pub struct McpStreamableHttpServerService {
    inner: Arc<Mutex<McpStreamableHttpServerState>>,
}

#[derive(Debug)]
struct McpStreamableHttpServerHandle {
    endpoint: String,
    bind_address: String,
    port: u16,
    cancellation: CancellationToken,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Debug)]
struct McpStreamableHttpServerState {
    generation: u64,
    lifecycle: McpStreamableHttpServerLifecycle,
}

#[derive(Debug, Default)]
struct LifecycleCompletion {
    completed: AtomicBool,
    notify: tokio::sync::Notify,
}

impl LifecycleCompletion {
    fn complete(&self) {
        self.completed.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    async fn wait(&self) {
        while !self.completed.load(Ordering::Acquire) {
            let notified = self.notify.notified();
            if self.completed.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Debug)]
enum McpStreamableHttpServerLifecycle {
    Stopped,
    Starting {
        generation: u64,
        cancellation: CancellationToken,
        completion: Arc<LifecycleCompletion>,
    },
    Running(McpStreamableHttpServerHandle),
    Stopping {
        generation: u64,
        completion: Arc<LifecycleCompletion>,
    },
}

enum McpStartDecision {
    Running(McpHttpServerStatus),
    Wait(Arc<LifecycleCompletion>),
    Start {
        generation: u64,
        cancellation: CancellationToken,
        completion: Arc<LifecycleCompletion>,
    },
}

impl Default for McpStreamableHttpServerService {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(McpStreamableHttpServerState {
                generation: 0,
                lifecycle: McpStreamableHttpServerLifecycle::Stopped,
            })),
        }
    }
}

#[derive(Clone)]
pub(super) struct KerminalMcpServer<R: tauri::Runtime> {
    pub(super) app: tauri::AppHandle<R>,
}

impl McpStreamableHttpServerService {
    /// 创建 Streamable HTTP MCP Server 生命周期服务。
    pub fn new() -> Self {
        Self::default()
    }

    /// 返回当前运行状态。
    pub fn status(&self) -> AppResult<McpHttpServerStatus> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("mcp_http_server"))?;
        Ok(status_from_lifecycle(&guard.lifecycle))
    }

    /// 启动本地 Streamable HTTP MCP Server。
    pub async fn start<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        request: Option<McpHttpServerStartRequest>,
    ) -> AppResult<McpHttpServerStatus> {
        let (generation, cancellation, completion) = loop {
            match self.start_decision()? {
                McpStartDecision::Running(status) => return Ok(status),
                McpStartDecision::Wait(completion) => completion.wait().await,
                McpStartDecision::Start {
                    generation,
                    cancellation,
                    completion,
                } => break (generation, cancellation, completion),
            }
        };

        let request = request.unwrap_or_default();
        let bind_address = match normalize_bind_address(request.host.as_deref()) {
            Ok(value) => value,
            Err(error) => {
                self.finish_start(generation, &completion, None).await?;
                return Err(error);
            }
        };
        let port = requested_start_port(request.port);
        let (listener, local_addr) = match bind_loopback_port_from(port).await {
            Ok(value) => value,
            Err(error) => {
                self.finish_start(generation, &completion, None).await?;
                return Err(error);
            }
        };
        let endpoint = format!(
            "http://{}:{}{}",
            DEFAULT_BIND_ADDRESS,
            local_addr.port(),
            MCP_PATH
        );
        let config = StreamableHttpServerConfig::default()
            .with_stateful_mode(true)
            .with_allowed_hosts(["localhost", DEFAULT_BIND_ADDRESS, "::1"])
            .with_cancellation_token(cancellation.child_token());
        let session_manager = Arc::new(LocalSessionManager::default());
        let service: StreamableHttpService<KerminalMcpServer<R>, LocalSessionManager> =
            StreamableHttpService::new(
                {
                    let app = app.clone();
                    move || Ok(KerminalMcpServer { app: app.clone() })
                },
                session_manager,
                config,
            );
        let router = Router::new()
            .nest_service(MCP_AGENT_PATH, service.clone())
            .nest_service(MCP_PATH, service);
        let shutdown = cancellation.child_token();

        let state = self.inner.clone();
        let task = tauri::async_runtime::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(shutdown.cancelled_owned())
                .await
            {
                tauri_plugin_log::log::warn!(
                    target: "mcp.http.lifecycle",
                    "MCP HTTP server exited with an error: {error}"
                );
            }
            mark_mcp_server_exited(&state, generation);
        });

        let handle = McpStreamableHttpServerHandle {
            endpoint,
            bind_address,
            port: local_addr.port(),
            cancellation,
            task,
        };
        let status = status_from_handle(Some(&handle));
        if self
            .finish_start(generation, &completion, Some(handle))
            .await?
        {
            Ok(status)
        } else {
            Ok(self.status()?)
        }
    }

    /// 停止本地 Streamable HTTP MCP Server。
    pub fn stop(&self) -> AppResult<McpHttpServerStatus> {
        if let Some((generation, completion, handle)) = self.begin_stop()? {
            handle.cancellation.cancel();
            let state = self.inner.clone();
            tauri::async_runtime::spawn(async move {
                let _ = handle.task.await;
                finish_mcp_server_stop(&state, generation, &completion);
            });
        }
        Ok(status_from_handle(None))
    }

    /// 停止本地 MCP server，等待任务退出并确认监听端口已释放。
    pub async fn stop_and_wait(&self) -> AppResult<McpHttpServerStatus> {
        let wait = match self.begin_stop()? {
            Some((generation, completion, handle)) => {
                handle.cancellation.cancel();
                let state = self.inner.clone();
                let _ = handle.task.await;
                finish_mcp_server_stop(&state, generation, &completion);
                None
            }
            None => {
                let state = self
                    .inner
                    .lock()
                    .map_err(|_| AppError::StateLockPoisoned("mcp_http_server"))?;
                match &state.lifecycle {
                    McpStreamableHttpServerLifecycle::Starting { completion, .. }
                    | McpStreamableHttpServerLifecycle::Stopping { completion, .. } => {
                        Some(completion.clone())
                    }
                    _ => None,
                }
            }
        };
        if let Some(wait) = wait {
            wait.wait().await;
        }
        Ok(status_from_handle(None))
    }

    async fn finish_start(
        &self,
        generation: u64,
        completion: &Arc<LifecycleCompletion>,
        handle: Option<McpStreamableHttpServerHandle>,
    ) -> AppResult<bool> {
        let (owns_start, cleanup_handle) = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| AppError::StateLockPoisoned("mcp_http_server"))?;
            let owns_start = matches!(
                state.lifecycle,
                McpStreamableHttpServerLifecycle::Starting {
                    generation: current,
                    ..
                } if current == generation
            );
            if owns_start {
                if let Some(handle) = handle {
                    state.lifecycle = McpStreamableHttpServerLifecycle::Running(handle);
                    completion.complete();
                    return Ok(true);
                }
                state.lifecycle = McpStreamableHttpServerLifecycle::Stopped;
                (true, None)
            } else {
                state.lifecycle = McpStreamableHttpServerLifecycle::Stopped;
                (false, handle)
            }
        };
        if let Some(handle) = cleanup_handle {
            handle.cancellation.cancel();
            handle.task.abort();
            let _ = handle.task.await;
        }
        completion.complete();
        Ok(owns_start)
    }

    fn begin_stop(
        &self,
    ) -> AppResult<Option<(u64, Arc<LifecycleCompletion>, McpStreamableHttpServerHandle)>> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("mcp_http_server"))?;
        match std::mem::replace(
            &mut state.lifecycle,
            McpStreamableHttpServerLifecycle::Stopped,
        ) {
            McpStreamableHttpServerLifecycle::Running(handle) => {
                let generation = state.generation;
                let completion = Arc::new(LifecycleCompletion::default());
                state.lifecycle = McpStreamableHttpServerLifecycle::Stopping {
                    generation,
                    completion: completion.clone(),
                };
                Ok(Some((generation, completion, handle)))
            }
            McpStreamableHttpServerLifecycle::Starting {
                generation,
                cancellation,
                completion,
            } => {
                cancellation.cancel();
                state.lifecycle = McpStreamableHttpServerLifecycle::Stopping {
                    generation,
                    completion,
                };
                Ok(None)
            }
            lifecycle @ McpStreamableHttpServerLifecycle::Stopping { .. } => {
                state.lifecycle = lifecycle;
                Ok(None)
            }
            McpStreamableHttpServerLifecycle::Stopped => Ok(None),
        }
    }

    fn start_decision(&self) -> AppResult<McpStartDecision> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("mcp_http_server"))?;
        match &state.lifecycle {
            McpStreamableHttpServerLifecycle::Running(handle) => {
                Ok(McpStartDecision::Running(status_from_handle(Some(handle))))
            }
            McpStreamableHttpServerLifecycle::Starting { completion, .. }
            | McpStreamableHttpServerLifecycle::Stopping { completion, .. } => {
                Ok(McpStartDecision::Wait(completion.clone()))
            }
            McpStreamableHttpServerLifecycle::Stopped => {
                state.generation = state.generation.wrapping_add(1);
                let generation = state.generation;
                let cancellation = CancellationToken::new();
                let completion = Arc::new(LifecycleCompletion::default());
                state.lifecycle = McpStreamableHttpServerLifecycle::Starting {
                    generation,
                    cancellation: cancellation.clone(),
                    completion: completion.clone(),
                };
                Ok(McpStartDecision::Start {
                    generation,
                    cancellation,
                    completion,
                })
            }
        }
    }
}

fn status_from_lifecycle(lifecycle: &McpStreamableHttpServerLifecycle) -> McpHttpServerStatus {
    match lifecycle {
        McpStreamableHttpServerLifecycle::Running(handle) => status_from_handle(Some(handle)),
        _ => status_from_handle(None),
    }
}

fn mark_mcp_server_exited(state: &Arc<Mutex<McpStreamableHttpServerState>>, generation: u64) {
    let Ok(mut state) = state.lock() else {
        return;
    };
    let completion = match &state.lifecycle {
        McpStreamableHttpServerLifecycle::Running(_) if state.generation == generation => None,
        McpStreamableHttpServerLifecycle::Stopping {
            generation: current,
            completion,
        } if *current == generation => Some(completion.clone()),
        _ => return,
    };
    state.lifecycle = McpStreamableHttpServerLifecycle::Stopped;
    if let Some(completion) = completion {
        completion.complete();
    }
}

fn finish_mcp_server_stop(
    state: &Arc<Mutex<McpStreamableHttpServerState>>,
    generation: u64,
    completion: &Arc<LifecycleCompletion>,
) {
    if let Ok(mut state) = state.lock() {
        if matches!(
            state.lifecycle,
            McpStreamableHttpServerLifecycle::Stopping {
                generation: current,
                ..
            } if current == generation
        ) {
            state.lifecycle = McpStreamableHttpServerLifecycle::Stopped;
        }
    }
    completion.complete();
}

fn status_from_handle(handle: Option<&McpStreamableHttpServerHandle>) -> McpHttpServerStatus {
    match handle {
        Some(handle) => McpHttpServerStatus {
            running: true,
            endpoint: Some(handle.endpoint.clone()),
            bind_address: handle.bind_address.clone(),
            port: Some(handle.port),
            local_only: true,
        },
        None => McpHttpServerStatus {
            running: false,
            endpoint: None,
            bind_address: DEFAULT_BIND_ADDRESS.to_owned(),
            port: None,
            local_only: true,
        },
    }
}
