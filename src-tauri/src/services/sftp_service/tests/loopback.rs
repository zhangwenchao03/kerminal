use super::*;

#[derive(Debug)]
pub(super) struct LoopbackSftpServer {
    pub(super) addr: SocketAddr,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for LoopbackSftpServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Clone)]
struct LoopbackSshServer {
    root: PathBuf,
}

struct LoopbackSshSession {
    root: PathBuf,
    channels: tokio::sync::Mutex<HashMap<ChannelId, Channel<Msg>>>,
    exec_scripts: HashMap<ChannelId, Vec<u8>>,
}

impl russh::server::Server for LoopbackSshServer {
    type Handler = LoopbackSshSession;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self::Handler {
        LoopbackSshSession {
            root: self.root.clone(),
            channels: tokio::sync::Mutex::new(HashMap::new()),
            exec_scripts: HashMap::new(),
        }
    }
}

impl russh::server::Handler for LoopbackSshSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == "deploy" && password == "secret" {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        self.channels.lock().await.insert(channel.id(), channel);
        Ok(true)
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if let Some(script) = self.exec_scripts.remove(&channel) {
            match execute_loopback_rm_rf_script(&self.root, &script).await {
                Ok(()) => {
                    session.exit_status_request(channel, 0)?;
                }
                Err(message) => {
                    session.extended_data(channel, 1, format!("{message}\n").into_bytes())?;
                    session.exit_status_request(channel, 1)?;
                }
            }
            session.eof(channel)?;
            session.close(channel)?;
            return Ok(());
        }
        session.close(channel)?;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel_id: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if data != b"sh -s" {
            session.channel_failure(channel_id)?;
            return Ok(());
        }
        let _ = self.channels.lock().await.remove(&channel_id);
        self.exec_scripts.insert(channel_id, Vec::new());
        session.channel_success(channel_id)?;
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if let Some(script) = self.exec_scripts.get_mut(&channel) {
            script.extend_from_slice(data);
        }
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            session.channel_failure(channel_id)?;
            return Ok(());
        }

        let channel = self.channels.lock().await.remove(&channel_id);
        let Some(channel) = channel else {
            session.channel_failure(channel_id)?;
            return Ok(());
        };

        session.channel_success(channel_id)?;
        russh_sftp::server::run(
            channel.into_stream(),
            LoopbackSftpFs::new(self.root.clone()),
        )
        .await;
        Ok(())
    }
}

async fn execute_loopback_rm_rf_script(root: &Path, script: &[u8]) -> Result<(), String> {
    let script = String::from_utf8_lossy(script);
    let remote_path = parse_loopback_rm_rf_script(script.trim())
        .ok_or_else(|| "unsupported script".to_owned())?;
    let fs = LoopbackSftpFs::new(root.to_path_buf());
    let local_path = fs
        .resolve_path(&remote_path)
        .map_err(|status| format!("invalid path: {status:?}"))?;
    fs::remove_dir_all(local_path)
        .await
        .map_err(|error| format!("remove_dir_all failed: {error}"))
}

fn parse_loopback_rm_rf_script(script: &str) -> Option<String> {
    parse_shell_single_quoted_string(script.strip_prefix("rm -rf -- ")?)
}

fn parse_shell_single_quoted_string(value: &str) -> Option<String> {
    let mut output = String::new();
    let mut chars = value.chars().peekable();
    if chars.next()? != '\'' {
        return None;
    }
    let mut in_quote = true;
    while let Some(ch) = chars.next() {
        if in_quote {
            if ch == '\'' {
                in_quote = false;
            } else {
                output.push(ch);
            }
            continue;
        }

        if ch == '\\' && chars.peek() == Some(&'\'') {
            let _ = chars.next();
            output.push('\'');
            continue;
        }
        if ch == '\'' {
            in_quote = true;
            continue;
        }
        return None;
    }

    (!in_quote).then_some(output)
}

struct LoopbackSftpFs {
    root: PathBuf,
    next_handle: u64,
    handles: HashMap<String, LoopbackSftpHandle>,
}

enum LoopbackSftpHandle {
    File {
        file: fs::File,
    },
    Directory {
        entries: Vec<ProtocolFile>,
        consumed: bool,
    },
}

impl LoopbackSftpFs {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            next_handle: 0,
            handles: HashMap::new(),
        }
    }

    fn next_handle(&mut self, prefix: &str) -> String {
        self.next_handle = self.next_handle.saturating_add(1);
        format!("{prefix}-{}", self.next_handle)
    }

    fn resolve_path(&self, remote_path: &str) -> Result<PathBuf, StatusCode> {
        let mut local_path = self.root.clone();
        let normalized = remote_path.replace('\\', "/");
        for segment in normalized.split('/') {
            match segment {
                "" | "." => {}
                ".." => return Err(StatusCode::PermissionDenied),
                value => local_path.push(value),
            }
        }
        Ok(local_path)
    }

    async fn attrs_for_path(&self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        let local_path = self.resolve_path(&path)?;
        let metadata = fs::metadata(local_path).await.map_err(Self::io_status)?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&metadata),
        })
    }

    fn ok(id: u32) -> Status {
        Status {
            id,
            status_code: StatusCode::Ok,
            error_message: "Ok".to_owned(),
            language_tag: "en-US".to_owned(),
        }
    }

    fn io_status(error: io::Error) -> StatusCode {
        match error.kind() {
            io::ErrorKind::NotFound => StatusCode::NoSuchFile,
            io::ErrorKind::PermissionDenied => StatusCode::PermissionDenied,
            _ => StatusCode::Failure,
        }
    }
}

impl russh_sftp::server::Handler for LoopbackSftpFs {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<Handle, Self::Error> {
        let local_path = self.resolve_path(&filename)?;
        let options: std::fs::OpenOptions = pflags.into();
        let file = options.open(local_path).map_err(Self::io_status)?;
        let handle = self.next_handle("file");
        self.handles.insert(
            handle.clone(),
            LoopbackSftpHandle::File {
                file: fs::File::from_std(file),
            },
        );
        Ok(Handle { id, handle })
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        let Some(open_handle) = self.handles.remove(&handle) else {
            return Err(StatusCode::NoSuchFile);
        };
        if let LoopbackSftpHandle::File { mut file } = open_handle {
            file.flush().await.map_err(Self::io_status)?;
        }
        Ok(Self::ok(id))
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, Self::Error> {
        let Some(LoopbackSftpHandle::File { file }) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::NoSuchFile);
        };

        file.seek(SeekFrom::Start(offset))
            .await
            .map_err(Self::io_status)?;
        let mut data = vec![0; len as usize];
        let bytes = file.read(&mut data).await.map_err(Self::io_status)?;
        if bytes == 0 {
            return Err(StatusCode::Eof);
        }
        data.truncate(bytes);
        Ok(Data { id, data })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, Self::Error> {
        let Some(LoopbackSftpHandle::File { file }) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::NoSuchFile);
        };

        file.seek(SeekFrom::Start(offset))
            .await
            .map_err(Self::io_status)?;
        file.write_all(&data).await.map_err(Self::io_status)?;
        Ok(Self::ok(id))
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        self.attrs_for_path(id, path).await
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, Self::Error> {
        let Some(open_handle) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::NoSuchFile);
        };
        match open_handle {
            LoopbackSftpHandle::File { file } => {
                let metadata = file.metadata().await.map_err(Self::io_status)?;
                Ok(Attrs {
                    id,
                    attrs: FileAttributes::from(&metadata),
                })
            }
            LoopbackSftpHandle::Directory { .. } => Err(StatusCode::Failure),
        }
    }

    async fn setstat(
        &mut self,
        id: u32,
        _path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        Ok(Self::ok(id))
    }

    async fn fsetstat(
        &mut self,
        id: u32,
        _handle: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        Ok(Self::ok(id))
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        let local_path = self.resolve_path(&path)?;
        let mut entries = fs::read_dir(local_path).await.map_err(Self::io_status)?;
        let mut files = Vec::new();
        while let Some(entry) = entries.next_entry().await.map_err(Self::io_status)? {
            let name = entry.file_name().to_string_lossy().into_owned();
            let metadata = entry.metadata().await.map_err(Self::io_status)?;
            files.push(ProtocolFile::new(name, FileAttributes::from(&metadata)));
        }
        files.sort_by(|left, right| left.filename.cmp(&right.filename));

        let handle = self.next_handle("dir");
        self.handles.insert(
            handle.clone(),
            LoopbackSftpHandle::Directory {
                entries: files,
                consumed: false,
            },
        );
        Ok(Handle { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let Some(LoopbackSftpHandle::Directory { entries, consumed }) =
            self.handles.get_mut(&handle)
        else {
            return Err(StatusCode::NoSuchFile);
        };
        if *consumed {
            return Err(StatusCode::Eof);
        }
        *consumed = true;
        Ok(Name {
            id,
            files: entries.clone(),
        })
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        let local_path = self.resolve_path(&filename)?;
        fs::remove_file(local_path).await.map_err(Self::io_status)?;
        Ok(Self::ok(id))
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        let local_path = self.resolve_path(&path)?;
        fs::create_dir(local_path).await.map_err(Self::io_status)?;
        Ok(Self::ok(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        let local_path = self.resolve_path(&path)?;
        fs::remove_dir(local_path).await.map_err(Self::io_status)?;
        Ok(Self::ok(id))
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        self.attrs_for_path(id, path).await
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, Self::Error> {
        let old_path = self.resolve_path(&oldpath)?;
        let new_path = self.resolve_path(&newpath)?;
        fs::rename(old_path, new_path)
            .await
            .map_err(Self::io_status)?;
        Ok(Self::ok(id))
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        Ok(Name {
            id,
            files: vec![ProtocolFile::dummy(path)],
        })
    }
}

pub(super) async fn start_loopback_sftp_server(root: PathBuf) -> LoopbackSftpServer {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind loopback SFTP server");
    let addr = listener.local_addr().expect("loopback SFTP address");
    let host_key = PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
        .expect("generate loopback host key");
    let config = russh::server::Config {
        auth_rejection_time: Duration::from_millis(0),
        auth_rejection_time_initial: Some(Duration::from_millis(0)),
        keys: vec![host_key],
        maximum_packet_size: 65_535,
        ..Default::default()
    };
    let task = tokio::spawn(async move {
        let mut server = LoopbackSshServer { root };
        let running = server.run_on_socket(Arc::new(config), &listener);
        let _ = running.await;
    });

    LoopbackSftpServer { addr, task }
}
