use super::*;

const REMOTE_FORWARD_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
const REMOTE_FORWARD_RECONNECT_MIN_MILLIS: u64 = 250;
const REMOTE_FORWARD_RECONNECT_MAX_MILLIS: u64 = 5_000;

struct NativeRemoteForwardRegistration {
    bind_host: String,
    bind_port: u16,
    target: NativeRemoteForwardTarget,
    label: &'static str,
}

#[derive(Debug)]
pub(in crate::services::ssh_runtime::native_backend) struct NativeRemoteForwardTask {
    id: String,
    shutdown: Option<oneshot::Sender<()>>,
    status: Receiver<String>,
    worker: Option<thread::JoinHandle<()>>,
}

impl NativeRemoteForwardTask {
    pub(in crate::services::ssh_runtime::native_backend) fn start(
        id: String,
        connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
        execution: NativeSshCommandExecution,
        host_key_policy: NativeHostKeyPolicy,
        remote_forwards: NativeRemoteForwardRegistry,
        request: SshRuntimeRemoteForwardRequest,
    ) -> AppResult<Self> {
        Self::start_registered(
            id,
            NativeForwardConnectionContext {
                connection,
                execution,
                host_key_policy,
                remote_forwards,
            },
            NativeRemoteForwardRegistration {
                bind_host: request.bind_host,
                bind_port: request.bind_port,
                target: NativeRemoteForwardTarget::new(request.target_host, request.target_port),
                label: "remote forward",
            },
        )
    }

    pub(in crate::services::ssh_runtime::native_backend) fn start_dynamic(
        id: String,
        connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
        execution: NativeSshCommandExecution,
        host_key_policy: NativeHostKeyPolicy,
        remote_forwards: NativeRemoteForwardRegistry,
        request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> AppResult<Self> {
        Self::start_registered(
            id,
            NativeForwardConnectionContext {
                connection,
                execution,
                host_key_policy,
                remote_forwards,
            },
            NativeRemoteForwardRegistration {
                bind_host: request.bind_host,
                bind_port: request.bind_port,
                target: NativeRemoteForwardTarget::socks5_local_dynamic(),
                label: "remote dynamic forward",
            },
        )
    }

    fn start_registered(
        id: String,
        context: NativeForwardConnectionContext,
        registration: NativeRemoteForwardRegistration,
    ) -> AppResult<Self> {
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let (status_tx, status_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let thread_name = format!("kerminal-ssh-forward-{id}");
        let label = registration.label;
        let worker = thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                let status = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime.block_on(run_remote_forward_listener(
                        shutdown_rx,
                        context,
                        registration,
                        ready_tx,
                    )),
                    Err(error) => {
                        let status = format!("无法启动受管 SSH {label} 运行时: {error}");
                        let _ = ready_tx.send(Err(status.clone()));
                        status
                    }
                };
                let _ = status_tx.send(status);
            })
            .map_err(|error| {
                AppError::PortForward(format!("无法启动受管 SSH {label} 线程: {error}"))
            })?;

        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(())) => Ok(Self {
                id,
                shutdown: Some(shutdown_tx),
                status: status_rx,
                worker: Some(worker),
            }),
            Ok(Err(error)) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(error))
            }
            Err(error) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(format!(
                    "受管 SSH {label} 启动确认超时: {error}"
                )))
            }
        }
    }
}

impl SshRuntimeForwardTask for NativeRemoteForwardTask {
    fn id(&self) -> Option<String> {
        Some(self.id.clone())
    }

    fn try_wait(&mut self) -> AppResult<Option<String>> {
        match self.status.try_recv() {
            Ok(status) => Ok(Some(status)),
            Err(mpsc::TryRecvError::Empty) => Ok(None),
            Err(mpsc::TryRecvError::Disconnected) => {
                Ok(Some("受管 SSH remote forward 线程已结束".to_owned()))
            }
        }
    }

    fn kill(&mut self) -> AppResult<()> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        Ok(())
    }

    fn wait(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

enum RemoteForwardMonitorStatus {
    Shutdown,
    ConnectionLost(String),
}

async fn run_remote_forward_listener(
    mut shutdown: oneshot::Receiver<()>,
    context: NativeForwardConnectionContext,
    registration: NativeRemoteForwardRegistration,
    ready: mpsc::Sender<Result<(), String>>,
) -> String {
    let NativeRemoteForwardRegistration {
        bind_host,
        bind_port,
        target,
        label,
    } = registration;
    let mut ready = Some(ready);
    let mut reconnect_attempt = 0_usize;
    loop {
        let active_connection = match native_connection_from_state(
            &context.connection,
            &context.execution,
            context.host_key_policy,
            context.remote_forwards.clone(),
            None,
        )
        .await
        {
            Ok(connection) => connection,
            Err(error) => {
                let status = format!("受管 SSH {label} 连接失败: {error}");
                if let Some(ready) = ready.take() {
                    let _ = ready.send(Err(status.clone()));
                    return status;
                }
                if wait_for_remote_forward_retry(&mut shutdown, reconnect_attempt).await {
                    return format!("受管 SSH {label} 已停止");
                }
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                continue;
            }
        };
        let registered_port = match start_remote_tcpip_forward_on_native_connection(
            &active_connection,
            bind_host.clone(),
            bind_port,
        )
        .await
        {
            Ok(port) => port,
            Err(error) => {
                let status = format!("受管 SSH {label} 启动失败: {error}");
                if should_clear_native_connection_after_channel_error(&error) {
                    clear_native_connection_if_current(
                        &context.connection,
                        &active_connection,
                        &format!("managed SSH {label} start failed: {error}"),
                    )
                    .await;
                }
                if let Some(ready) = ready.take() {
                    let _ = ready.send(Err(status.clone()));
                    return status;
                }
                if wait_for_remote_forward_retry(&mut shutdown, reconnect_attempt).await {
                    return format!("受管 SSH {label} 已停止");
                }
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                continue;
            }
        };
        if let Err(error) =
            context
                .remote_forwards
                .register(bind_host.clone(), registered_port, target.clone())
        {
            let _ = cancel_remote_tcpip_forward_on_native_connection(
                &active_connection,
                bind_host.clone(),
                registered_port,
            )
            .await;
            let status = format!("受管 SSH {label} registry 写入失败: {error}");
            let _ = ready.take().map(|ready| ready.send(Err(status.clone())));
            return status;
        }
        if let Some(ready) = ready.take() {
            let _ = ready.send(Ok(()));
        }
        reconnect_attempt = 0;

        match monitor_remote_forward_connection(&mut shutdown, &active_connection, label).await {
            RemoteForwardMonitorStatus::Shutdown => {
                context
                    .remote_forwards
                    .unregister(&bind_host, registered_port);
                return match cancel_remote_tcpip_forward_on_native_connection(
                    &active_connection,
                    bind_host,
                    registered_port,
                )
                .await
                {
                    Ok(()) => format!("受管 SSH {label} 已停止"),
                    Err(error) => {
                        if should_clear_native_connection_after_channel_error(&error) {
                            clear_native_connection_if_current(
                                &context.connection,
                                &active_connection,
                                &format!("managed SSH {label} cancel failed: {error}"),
                            )
                            .await;
                        }
                        format!("受管 SSH {label} 取消失败: {error}")
                    }
                };
            }
            RemoteForwardMonitorStatus::ConnectionLost(reason) => {
                context
                    .remote_forwards
                    .unregister(&bind_host, registered_port);
                clear_native_connection_if_current(
                    &context.connection,
                    &active_connection,
                    &reason,
                )
                .await;
                if wait_for_remote_forward_retry(&mut shutdown, reconnect_attempt).await {
                    return format!("受管 SSH {label} 已停止");
                }
                reconnect_attempt = reconnect_attempt.saturating_add(1);
            }
        }
    }
}

async fn monitor_remote_forward_connection(
    shutdown: &mut oneshot::Receiver<()>,
    connection: &Arc<NativeSshConnectionChain>,
    label: &'static str,
) -> RemoteForwardMonitorStatus {
    loop {
        tokio::select! {
            _ = &mut *shutdown => {
                return RemoteForwardMonitorStatus::Shutdown;
            }
            _ = tokio::time::sleep(REMOTE_FORWARD_KEEPALIVE_INTERVAL) => {
                if let Err(error) = ping_native_connection_ref(connection).await {
                    return RemoteForwardMonitorStatus::ConnectionLost(format!(
                        "managed SSH {label} keepalive failed: {error}"
                    ));
                }
            }
        }
    }
}

async fn wait_for_remote_forward_retry(
    shutdown: &mut oneshot::Receiver<()>,
    attempt: usize,
) -> bool {
    tokio::select! {
        _ = &mut *shutdown => true,
        _ = tokio::time::sleep(remote_forward_reconnect_delay(attempt)) => false,
    }
}

fn remote_forward_reconnect_delay(attempt: usize) -> Duration {
    let multiplier = 1_u64 << attempt.min(4);
    let millis = REMOTE_FORWARD_RECONNECT_MIN_MILLIS
        .saturating_mul(multiplier)
        .min(REMOTE_FORWARD_RECONNECT_MAX_MILLIS);
    Duration::from_millis(millis)
}
