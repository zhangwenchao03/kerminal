use std::{sync::Arc, time::Duration};

use tokio::sync::Mutex;

use crate::{
    error::{AppError, AppResult},
    services::ssh_command_service::native::{
        connect_native_command_target_with_remote_forward_registry,
        disconnect_native_connection_ref, ping_native_connection_ref, NativeHostKeyPolicy,
        NativeRemoteForwardRegistry, NativeSshCommandExecution, NativeSshConnectionChain,
    },
};

pub(super) async fn native_connection_from_state(
    state: &Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
    execution: &NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
    remote_forwards: NativeRemoteForwardRegistry,
    keepalive_interval: Option<Duration>,
) -> AppResult<Arc<NativeSshConnectionChain>> {
    let mut guard = state.lock().await;
    if let Some(connection) = guard.as_ref() {
        return Ok(Arc::clone(connection));
    }

    let connection = Arc::new(
        connect_native_command_target_with_remote_forward_registry(
            execution,
            host_key_policy,
            remote_forwards,
        )
        .await?,
    );
    *guard = Some(Arc::clone(&connection));
    if let Some(interval) = keepalive_interval {
        spawn_native_connection_keepalive(Arc::clone(state), Arc::clone(&connection), interval);
    }
    Ok(connection)
}

fn spawn_native_connection_keepalive(
    state: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
    connection: Arc<NativeSshConnectionChain>,
    interval: Duration,
) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(interval).await;
            let is_current = {
                let guard = state.lock().await;
                guard
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &connection))
            };
            if !is_current {
                break;
            }
            if let Err(error) = ping_native_connection_ref(&connection).await {
                clear_native_connection_if_current(
                    &state,
                    &connection,
                    &format!("managed SSH keepalive failed: {error}"),
                )
                .await;
                break;
            }
        }
    });
}

pub(super) async fn clear_native_connection_if_current(
    state: &Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
    failed_connection: &Arc<NativeSshConnectionChain>,
    reason: &str,
) {
    let stale_connection = {
        let mut guard = state.lock().await;
        match guard.as_ref() {
            Some(current) if Arc::ptr_eq(current, failed_connection) => guard.take(),
            _ => None,
        }
    };
    if let Some(connection) = stale_connection {
        disconnect_native_connection_ref(&connection, reason).await;
    }
}

pub(super) fn should_clear_native_connection_after_proxy_error(error: &AppError) -> bool {
    should_clear_native_connection_after_channel_error(error)
}

#[doc(hidden)]
pub fn should_clear_native_connection_after_channel_error(error: &AppError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    [
        "broken pipe",
        "channel send error",
        "connection reset",
        "connection lost",
        "connection aborted",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}
