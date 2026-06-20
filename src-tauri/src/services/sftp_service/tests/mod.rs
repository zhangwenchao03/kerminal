use super::*;
use crate::models::{
    remote_host::{RemoteHost, RemoteHostAuthType},
    sftp::{SftpEntry, SftpEntryKind, SftpFileRevision, SftpLocalPathKind, SftpTransferEndpoint},
};
use async_trait::async_trait;
use russh::{
    client::Handler as _,
    keys::{self, PrivateKey},
    server::{Auth, Msg, Server as _, Session},
    Channel, ChannelId,
};
use russh_sftp::protocol::{
    Attrs, Data, File as ProtocolFile, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode,
};
use std::{
    fs::File as StdFile,
    io::Read,
    io::{self, Cursor, SeekFrom},
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::atomic::AtomicUsize,
};
use tempfile::tempdir;
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    net::TcpListener,
    time::{sleep, Duration},
};

pub(super) mod fake_backend;
pub(super) mod loopback;
pub(super) mod support;

mod archive_clipboard;
mod native_backend;
mod transfer_queue;
mod validation;

use fake_backend::FakeSftpBackend;
use loopback::start_loopback_sftp_server;
use support::{eventually, test_endpoint, test_transfer_request};
