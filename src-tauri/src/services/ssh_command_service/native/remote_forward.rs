use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default)]
pub(crate) struct NativeRemoteForwardRegistry {
    inner: Arc<Mutex<HashMap<NativeRemoteForwardKey, NativeRemoteForwardTarget>>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct NativeRemoteForwardKey {
    address: String,
    port: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NativeRemoteForwardTarget {
    Local { host: String, port: u16 },
    Socks5LocalDynamic,
}

impl NativeRemoteForwardTarget {
    pub(crate) fn new(host: impl Into<String>, port: u16) -> Self {
        Self::Local {
            host: host.into(),
            port,
        }
    }

    pub(crate) fn socks5_local_dynamic() -> Self {
        Self::Socks5LocalDynamic
    }
}

impl NativeRemoteForwardRegistry {
    pub(crate) fn register(
        &self,
        address: impl Into<String>,
        port: u32,
        target: NativeRemoteForwardTarget,
    ) -> AppResult<()> {
        self.inner
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("native remote forward registry"))?
            .insert(
                NativeRemoteForwardKey {
                    address: address.into(),
                    port,
                },
                target,
            );
        Ok(())
    }

    pub(crate) fn unregister(&self, address: &str, port: u32) {
        let Ok(mut forwards) = self.inner.lock() else {
            return;
        };
        forwards.remove(&NativeRemoteForwardKey {
            address: address.to_owned(),
            port,
        });
    }

    pub(super) fn resolve(&self, address: &str, port: u32) -> Option<NativeRemoteForwardTarget> {
        self.inner.lock().ok().and_then(|forwards| {
            forwards
                .get(&NativeRemoteForwardKey {
                    address: address.to_owned(),
                    port,
                })
                .cloned()
        })
    }
}
