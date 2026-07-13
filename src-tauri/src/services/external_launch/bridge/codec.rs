//! Bridge v2 有界分帧。

use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    time::timeout,
};

use crate::error::{AppError, AppResult};

use super::{
    bridge_unavailable_error, EXTERNAL_LAUNCH_BRIDGE_IO_TIMEOUT,
    EXTERNAL_LAUNCH_BRIDGE_MAX_FRAME_BYTES,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum BridgeFrameError {
    Empty,
    Oversized,
    TimedOut,
    Io,
}

impl BridgeFrameError {
    pub(super) fn public_message(self) -> &'static str {
        match self {
            Self::Empty => "external launch bridge received an empty envelope",
            Self::Oversized => "external launch bridge envelope is too large",
            Self::TimedOut => "external launch bridge envelope read timed out",
            Self::Io => "external launch bridge failed to read envelope",
        }
    }
}

/// 长度头在分配 payload 前校验，避免无换行大帧或伪造长度驱动无界内存增长。
pub(super) async fn read_bridge_frame<S>(stream: &mut S) -> Result<Vec<u8>, BridgeFrameError>
where
    S: AsyncRead + Unpin,
{
    timeout(EXTERNAL_LAUNCH_BRIDGE_IO_TIMEOUT, async {
        let mut length_bytes = [0_u8; 4];
        stream
            .read_exact(&mut length_bytes)
            .await
            .map_err(|_| BridgeFrameError::Io)?;
        let length = u32::from_be_bytes(length_bytes) as usize;
        if length == 0 {
            return Err(BridgeFrameError::Empty);
        }
        if length > EXTERNAL_LAUNCH_BRIDGE_MAX_FRAME_BYTES {
            return Err(BridgeFrameError::Oversized);
        }
        let mut frame = vec![0_u8; length];
        stream
            .read_exact(&mut frame)
            .await
            .map_err(|_| BridgeFrameError::Io)?;
        Ok(frame)
    })
    .await
    .map_err(|_| BridgeFrameError::TimedOut)?
}

/// 写入同样受硬 deadline 约束，慢客户端不能永久占用连接 permit。
pub(super) async fn write_bridge_frame<S>(stream: &mut S, frame: &[u8]) -> AppResult<()>
where
    S: AsyncWrite + Unpin,
{
    if frame.is_empty() || frame.len() > EXTERNAL_LAUNCH_BRIDGE_MAX_FRAME_BYTES {
        return Err(AppError::InvalidInput(
            "external launch bridge envelope is too large".to_owned(),
        ));
    }
    timeout(EXTERNAL_LAUNCH_BRIDGE_IO_TIMEOUT, async {
        stream
            .write_all(&(frame.len() as u32).to_be_bytes())
            .await?;
        stream.write_all(frame).await?;
        stream.flush().await
    })
    .await
    .map_err(|_| bridge_unavailable_error())??;
    Ok(())
}
