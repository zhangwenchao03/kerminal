//! Managed SSH shell request and session traits.
//!
//! @author kongweiguang

use std::{collections::BTreeMap, fmt};

use async_trait::async_trait;

use crate::error::AppResult;

/// Request for an interactive shell channel on an authenticated session.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshRuntimeShellRequest {
    pub cols: u16,
    pub env: BTreeMap<String, String>,
    pub pixel_height: u32,
    pub pixel_width: u32,
    pub rows: u16,
    pub term: String,
}

impl SshRuntimeShellRequest {
    pub fn new(term: impl Into<String>, cols: u16, rows: u16) -> Self {
        Self {
            cols: cols.max(1),
            env: BTreeMap::new(),
            pixel_height: 0,
            pixel_width: 0,
            rows: rows.max(1),
            term: term.into(),
        }
    }

    pub fn with_env(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.insert(name.into(), value.into());
        self
    }

    pub fn with_pixel_size(mut self, pixel_width: u32, pixel_height: u32) -> Self {
        self.pixel_width = pixel_width;
        self.pixel_height = pixel_height;
        self
    }
}

/// Interactive shell channel events emitted by an SSH backend.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SshRuntimeShellEvent {
    Data(Vec<u8>),
    ExtendedData {
        data: Vec<u8>,
        ext: u32,
    },
    Eof,
    ExitSignal {
        error_message: String,
        signal_name: String,
    },
    ExitStatus(i32),
    Closed,
}

#[async_trait]
pub trait SshRuntimeShellSession: Send + Sync + fmt::Debug {
    async fn read_event(&self) -> AppResult<SshRuntimeShellEvent>;

    async fn write(&self, data: Vec<u8>) -> AppResult<()>;

    async fn resize(&self, cols: u16, rows: u16) -> AppResult<()>;

    async fn close(&self) -> AppResult<()>;
}
