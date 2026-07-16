//! 连接平台子进程与临时制品所有权。
//!
//! @author kongweiguang

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::{mpsc, Mutex, OnceLock},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use crate::error::{AppError, AppResult};

const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
static DETACHED_CLIENTS: OnceLock<Mutex<Vec<DetachedClient>>> = OnceLock::new();

struct DetachedClient {
    cancel: mpsc::Sender<()>,
    worker: JoinHandle<()>,
}

struct ChildOwner {
    child: std::process::Child,
    reaped: bool,
}

impl ChildOwner {
    fn new(child: std::process::Child) -> Self {
        Self {
            child,
            reaped: false,
        }
    }

    fn mark_reaped(&mut self) {
        self.reaped = true;
    }
}

impl Drop for ChildOwner {
    fn drop(&mut self) {
        if !self.reaped {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

/// 进程结束状态与完整标准输出。
#[derive(Debug)]
pub struct BoundedProcessOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
}

/// 由 Kerminal 独占的临时文件；未转移所有权时离开作用域即删除。
#[derive(Debug)]
pub struct TemporaryArtifact {
    path: PathBuf,
}

impl TemporaryArtifact {
    /// 使用 `create_new` 创建受管临时文件，避免覆盖其它进程或用户文件。
    pub fn create(path: PathBuf, content: &[u8]) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&path)?;
        if let Err(error) = file.write_all(content).and_then(|()| file.flush()) {
            let _ = fs::remove_file(&path);
            return Err(error.into());
        }
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryArtifact {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// 执行短生命周期平台命令，超时或提前返回时保证 kill + wait。
pub fn run_bounded_process(
    command: &mut Command,
    stdin: &[u8],
    timeout: Duration,
    operation: &'static str,
) -> AppResult<BoundedProcessOutput> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut owner = ChildOwner::new(command.spawn().map_err(AppError::Io)?);

    if let Some(mut child_stdin) = owner.child.stdin.take() {
        if let Err(error) = child_stdin.write_all(stdin) {
            return Err(AppError::Io(error));
        }
    }

    let mut stdout = owner
        .child
        .stdout
        .take()
        .ok_or_else(|| AppError::InvalidInput(format!("{operation}未提供标准输出管道")))?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match owner.child.try_wait().map_err(AppError::Io)? {
            Some(status) => {
                owner.mark_reaped();
                break status;
            }
            None if Instant::now() >= deadline => {
                let _ = owner.child.kill();
                let _ = owner.child.wait();
                owner.mark_reaped();
                let _ = reader.join();
                return Err(AppError::InvalidInput(format!(
                    "{operation}超时（{} 秒）",
                    timeout.as_secs()
                )));
            }
            None => thread::sleep(PROCESS_POLL_INTERVAL),
        }
    };
    let stdout = reader
        .join()
        .map_err(|_| AppError::InvalidInput(format!("{operation}输出读取线程异常退出")))?
        .map_err(AppError::Io)?;
    Ok(BoundedProcessOutput { status, stdout })
}

/// 把外部客户端和临时制品交给后台 owner；到期后回收 child 与文件。
pub fn supervise_detached_client(
    child: std::process::Child,
    artifact: TemporaryArtifact,
    max_lifetime: Duration,
) -> AppResult<()> {
    let owner = ChildOwner::new(child);
    let (cancel, cancelled) = mpsc::channel();
    let worker = thread::Builder::new()
        .name("kerminal-rdp-client-owner".to_owned())
        .spawn(move || {
            let mut owner = owner;
            let deadline = Instant::now() + max_lifetime;
            loop {
                match owner.child.try_wait() {
                    Ok(Some(_)) => {
                        owner.mark_reaped();
                        break;
                    }
                    Ok(None) if Instant::now() < deadline => {
                        if cancelled.recv_timeout(Duration::from_millis(100)).is_ok() {
                            let _ = owner.child.kill();
                            let _ = owner.child.wait();
                            owner.mark_reaped();
                            break;
                        }
                    }
                    Ok(None) | Err(_) => {
                        let _ = owner.child.kill();
                        let _ = owner.child.wait();
                        owner.mark_reaped();
                        break;
                    }
                }
            }
            drop(artifact);
        })
        .map_err(AppError::Io)?;

    let mut clients = detached_clients()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    reap_finished_clients(&mut clients);
    clients.push(DetachedClient { cancel, worker });
    Ok(())
}

/// 取消并等待所有仍由 Kerminal 管理的外部连接客户端。
pub fn shutdown_detached_clients() -> AppResult<usize> {
    let clients = {
        let mut clients = detached_clients()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::take(&mut *clients)
    };
    let count = clients.len();
    for client in &clients {
        let _ = client.cancel.send(());
    }
    for client in clients {
        let _ = client.worker.join();
    }
    Ok(count)
}

fn detached_clients() -> &'static Mutex<Vec<DetachedClient>> {
    DETACHED_CLIENTS.get_or_init(|| Mutex::new(Vec::new()))
}

fn reap_finished_clients(clients: &mut Vec<DetachedClient>) {
    let mut index = 0;
    while index < clients.len() {
        if clients[index].worker.is_finished() {
            let client = clients.swap_remove(index);
            let _ = client.worker.join();
        } else {
            index += 1;
        }
    }
}

/// 清理超过年龄上限的 Kerminal 受管临时文件，忽略不匹配文件。
pub fn cleanup_stale_artifacts(
    directory: &Path,
    prefix: &str,
    suffix: &str,
    max_age: Duration,
) -> AppResult<usize> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.into()),
    };
    let mut removed = 0;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !entry.file_type()?.is_file() || !name.starts_with(prefix) || !name.ends_with(suffix) {
            continue;
        }
        let modified = entry
            .metadata()?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH);
        if SystemTime::now()
            .duration_since(modified)
            .unwrap_or_default()
            < max_age
        {
            continue;
        }
        fs::remove_file(entry.path())?;
        removed += 1;
    }
    Ok(removed)
}
