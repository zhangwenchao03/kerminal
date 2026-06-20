use super::*;

#[derive(Debug, Default)]
pub(super) struct FakeSftpBackend {
    pub(super) active_global: AtomicUsize,
    pub(super) active_by_host: Mutex<HashMap<String, usize>>,
    pub(super) delay_ms: u64,
    pub(super) max_global: AtomicUsize,
    pub(super) max_by_host: Mutex<HashMap<String, usize>>,
    pub(super) record_uploads: bool,
    pub(super) uploaded_files: Mutex<HashMap<String, Vec<u8>>>,
    pub(super) write_downloads: bool,
}

#[async_trait]
impl SftpBackend for FakeSftpBackend {
    async fn list_directory(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<SftpDirectoryListing> {
        Ok(SftpDirectoryListing {
            host_id: endpoint.host.id,
            path,
            parent_path: Some("/".to_owned()),
            entries: vec![SftpEntry {
                name: "app.log".to_owned(),
                path: "/var/log/app.log".to_owned(),
                kind: SftpEntryKind::File,
                size: Some(8),
                permissions: Some("-rw-r--r--".to_owned()),
                modified: Some("now".to_owned()),
                raw: "-rw-r--r-- 8 app.log".to_owned(),
            }],
        })
    }

    async fn create_directory(
        &self,
        _endpoint: SftpEndpoint,
        _path: String,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        Ok(())
    }

    async fn preview_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        max_bytes: usize,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<SftpFilePreview> {
        Ok(SftpFilePreview {
            host_id: endpoint.host.id,
            path,
            content: "preview".to_owned(),
            bytes_read: 7,
            max_bytes,
            truncated: false,
            encoding: "utf-8-lossy".to_owned(),
        })
    }

    async fn read_text_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        max_bytes: usize,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<SftpReadTextFileResponse> {
        let content = "preview".to_owned();
        Ok(SftpReadTextFileResponse {
            host_id: endpoint.host.id,
            path,
            bytes_read: content.len(),
            max_bytes,
            truncated: false,
            encoding: "utf-8-lossy".to_owned(),
            line_ending: "lf".to_owned(),
            revision: SftpFileRevision {
                size: content.len() as u64,
                modified: Some("now".to_owned()),
                permissions: Some("-rw-r--r--".to_owned()),
                permissions_mode: Some(0o100644),
                content_sha256: Some(sha256_hex(content.as_bytes())),
            },
            binary: false,
            readonly: false,
            content,
        })
    }

    async fn write_text_file(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        request: SftpWriteTextFileRequest,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<SftpWriteTextFileResponse> {
        let bytes_written = request.content.len();
        Ok(SftpWriteTextFileResponse {
            host_id: endpoint.host.id,
            path,
            bytes_written,
            encoding: "utf-8".to_owned(),
            line_ending: detect_line_ending(&request.content),
            revision: SftpFileRevision {
                size: bytes_written as u64,
                modified: Some("now".to_owned()),
                permissions: Some("-rw-r--r--".to_owned()),
                permissions_mode: Some(0o100644),
                content_sha256: Some(sha256_hex(request.content.as_bytes())),
            },
        })
    }

    async fn stat_path(
        &self,
        endpoint: SftpEndpoint,
        path: String,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<SftpPathStat> {
        Ok(SftpPathStat {
            host_id: endpoint.host.id,
            path,
            kind: SftpEntryKind::File,
            size: Some(7),
            permissions: Some("-rw-r--r--".to_owned()),
            modified: Some("now".to_owned()),
            revision: Some(SftpFileRevision {
                size: 7,
                modified: Some("now".to_owned()),
                permissions: Some("-rw-r--r--".to_owned()),
                permissions_mode: Some(0o100644),
                content_sha256: Some(sha256_hex(b"preview")),
            }),
            readonly: false,
        })
    }

    async fn delete(
        &self,
        _endpoint: SftpEndpoint,
        _path: String,
        _directory: bool,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        Ok(())
    }

    async fn rename(
        &self,
        _endpoint: SftpEndpoint,
        _from_path: String,
        _to_path: String,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        Ok(())
    }

    async fn chmod(
        &self,
        _endpoint: SftpEndpoint,
        _path: String,
        _mode: u32,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        Ok(())
    }

    async fn transfer(
        &self,
        _endpoint: SftpEndpoint,
        request: SftpManagedTransferRequest,
        progress: TransferProgress,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        self.enter_transfer(&request.host_id);
        progress.set_total_bytes(100);
        let result = async {
            if self.write_downloads && request.direction == SftpTransferDirection::Download {
                write_fake_download(&request).await?;
            }
            if self.record_uploads
                && request.direction == SftpTransferDirection::Upload
                && request.kind == SftpTransferKind::File
            {
                let bytes = fs::read(&request.local_path).await?;
                self.uploaded_files
                    .lock()
                    .expect("fake uploaded files lock")
                    .insert(request.remote_path.clone(), bytes);
            }
            for _ in 0..10 {
                progress.ensure_not_cancelled()?;
                sleep(Duration::from_millis(self.delay_ms)).await;
                progress.add_bytes(10);
            }
            Ok(())
        }
        .await;
        self.leave_transfer(&request.host_id);
        result
    }

    async fn remote_copy(
        &self,
        _source_endpoint: SftpEndpoint,
        _target_endpoint: SftpEndpoint,
        request: SftpRemoteCopyRequest,
        progress: TransferProgress,
        _settings: SftpRuntimeSettings,
    ) -> AppResult<()> {
        self.enter_transfer(&request.source_host_id);
        if request.source_host_id != request.target_host_id {
            self.enter_transfer(&request.target_host_id);
        }
        progress.set_total_bytes(100);
        let result = async {
            for _ in 0..10 {
                progress.ensure_not_cancelled()?;
                sleep(Duration::from_millis(self.delay_ms)).await;
                progress.add_bytes(10);
            }
            Ok(())
        }
        .await;
        self.leave_transfer(&request.source_host_id);
        if request.source_host_id != request.target_host_id {
            self.leave_transfer(&request.target_host_id);
        }
        result
    }
}

impl FakeSftpBackend {
    fn enter_transfer(&self, host_id: &str) {
        let global = self.active_global.fetch_add(1, Ordering::SeqCst) + 1;
        record_max(&self.max_global, global);

        let mut active_by_host = self.active_by_host.lock().expect("fake active host lock");
        let active = active_by_host.entry(host_id.to_owned()).or_insert(0);
        *active += 1;
        let host_active = *active;
        drop(active_by_host);

        let mut max_by_host = self.max_by_host.lock().expect("fake max host lock");
        let max = max_by_host.entry(host_id.to_owned()).or_insert(0);
        *max = (*max).max(host_active);
    }

    fn leave_transfer(&self, host_id: &str) {
        self.active_global.fetch_sub(1, Ordering::SeqCst);
        let mut active_by_host = self.active_by_host.lock().expect("fake active host lock");
        if let Some(active) = active_by_host.get_mut(host_id) {
            *active = active.saturating_sub(1);
            if *active == 0 {
                active_by_host.remove(host_id);
            }
        }
    }

    pub(super) fn max_global(&self) -> usize {
        self.max_global.load(Ordering::SeqCst)
    }

    pub(super) fn max_host(&self, host_id: &str) -> usize {
        self.max_by_host
            .lock()
            .expect("fake max host lock")
            .get(host_id)
            .copied()
            .unwrap_or(0)
    }

    pub(super) fn uploaded_file(&self, remote_path: &str) -> Option<Vec<u8>> {
        self.uploaded_files
            .lock()
            .expect("fake uploaded files lock")
            .get(remote_path)
            .cloned()
    }
}

async fn write_fake_download(request: &SftpManagedTransferRequest) -> AppResult<()> {
    let local_path = PathBuf::from(&request.local_path);
    match request.kind {
        SftpTransferKind::File => {
            if let Some(parent) = local_path.parent() {
                fs::create_dir_all(parent).await?;
            }
            fs::write(local_path, b"fake remote file").await?;
        }
        SftpTransferKind::Directory => {
            let nested_dir = local_path.join("nested");
            fs::create_dir_all(&nested_dir).await?;
            fs::write(nested_dir.join("app.log"), b"fake remote directory").await?;
        }
    }
    Ok(())
}

fn record_max(maximum: &AtomicUsize, value: usize) {
    let mut observed = maximum.load(Ordering::SeqCst);
    while value > observed {
        match maximum.compare_exchange(observed, value, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return,
            Err(next) => observed = next,
        }
    }
}
