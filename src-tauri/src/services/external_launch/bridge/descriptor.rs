//! Bridge v2 endpoint descriptor 与 capability 轮换。

use std::path::{Path, PathBuf};

use tokio::io::AsyncReadExt;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{
    bridge_unavailable_error, ExternalLaunchBridgeDescriptor, ExternalLaunchBridgeEndpoint,
    EXTERNAL_LAUNCH_BRIDGE_MAX_DESCRIPTOR_BYTES, EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION,
};

/// 每次 server 代际生成新 endpoint 和 256-bit capability，旧 shim 请求因此自动失效。
pub(super) async fn prepare_server_endpoint(
    mut endpoint: ExternalLaunchBridgeEndpoint,
) -> AppResult<ExternalLaunchBridgeEndpoint> {
    let generation = Uuid::new_v4().simple().to_string();
    let suffix = &generation[..12];
    endpoint.windows_pipe_name = format!(
        r"\\.\pipe\kerminal-external-launch-{}-{suffix}",
        endpoint.scope_id
    );
    endpoint.unix_socket_path = PathBuf::from(&endpoint.unix_socket_path)
        .with_file_name(format!(
            "external-launch-{}-{suffix}.sock",
            endpoint.scope_id
        ))
        .to_string_lossy()
        .into_owned();
    endpoint.app_generation = generation;
    endpoint.nonce = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());

    let descriptor = ExternalLaunchBridgeDescriptor {
        protocol_version: EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION,
        scope_id: endpoint.scope_id.clone(),
        windows_pipe_name: endpoint.windows_pipe_name.clone(),
        unix_socket_path: endpoint.unix_socket_path.clone(),
        app_generation: endpoint.app_generation.clone(),
        nonce: endpoint.nonce.clone(),
    };
    write_bridge_descriptor(&endpoint.descriptor_path, &descriptor).await?;
    Ok(endpoint)
}

/// 客户端每次重试都重读 descriptor，以便 server 重启后自动切换到新代际。
pub(super) async fn load_bridge_descriptor(
    endpoint: &ExternalLaunchBridgeEndpoint,
) -> AppResult<ExternalLaunchBridgeEndpoint> {
    let file = tokio::fs::File::open(&endpoint.descriptor_path).await?;
    if file.metadata().await?.len() > EXTERNAL_LAUNCH_BRIDGE_MAX_DESCRIPTOR_BYTES {
        return Err(bridge_unavailable_error());
    }
    let mut bytes = Vec::with_capacity(1024);
    file.take(EXTERNAL_LAUNCH_BRIDGE_MAX_DESCRIPTOR_BYTES + 1)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() as u64 > EXTERNAL_LAUNCH_BRIDGE_MAX_DESCRIPTOR_BYTES {
        return Err(bridge_unavailable_error());
    }
    let descriptor: ExternalLaunchBridgeDescriptor = serde_json::from_slice(&bytes)?;
    if descriptor.protocol_version != EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION
        || descriptor.scope_id != endpoint.scope_id
        || descriptor.app_generation.is_empty()
        || descriptor.nonce.len() < 32
    {
        return Err(bridge_unavailable_error());
    }
    Ok(ExternalLaunchBridgeEndpoint {
        scope_id: descriptor.scope_id,
        windows_pipe_name: descriptor.windows_pipe_name,
        unix_socket_path: descriptor.unix_socket_path,
        descriptor_path: endpoint.descriptor_path.clone(),
        app_generation: descriptor.app_generation,
        nonce: descriptor.nonce,
    })
}

async fn write_bridge_descriptor(
    descriptor_path: &str,
    descriptor: &ExternalLaunchBridgeDescriptor,
) -> AppResult<()> {
    let path = PathBuf::from(descriptor_path);
    let parent = path.parent().ok_or_else(|| {
        AppError::InvalidInput("external launch bridge descriptor path is invalid".to_owned())
    })?;
    tokio::fs::create_dir_all(parent).await?;
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4().simple()));
    tokio::fs::write(&temporary, serde_json::to_vec(descriptor)?).await?;
    restrict_descriptor_permissions(&temporary).await?;
    if tokio::fs::try_exists(&path).await? {
        tokio::fs::remove_file(&path).await?;
    }
    tokio::fs::rename(&temporary, &path).await?;
    Ok(())
}

#[cfg(unix)]
async fn restrict_descriptor_permissions(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;

    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn restrict_descriptor_permissions(_path: &Path) -> AppResult<()> {
    // Windows descriptor 继承用户配置目录 DACL；named pipe 另禁用远程客户端并要求 capability。
    // 当前 tokio API 无法表达“仅当前 SID”ACL，安装态 ACL 仍需平台 harness 复核。
    Ok(())
}
