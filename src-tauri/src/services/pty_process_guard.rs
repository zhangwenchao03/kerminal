//! 本地 PTY 进程与 ConPTY 生命周期守护。
//!
//! @author kongweiguang

use portable_pty::{Child, ChildKiller, ExitStatus, MasterPty, PtySize};
use std::{
    fmt,
    io::{self, Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

pub type PtyChildHandle = Box<dyn Child + Send + Sync>;
pub type SharedPtyChildHandle = Arc<Mutex<PtyChildHandle>>;

type PtyChildKiller = Box<dyn ChildKiller + Send + Sync>;
type SharedPtyChildKiller = Arc<Mutex<PtyChildKiller>>;
type PtyMasterHandle = Box<dyn MasterPty + Send>;

/// 在 Windows 上串行化 ConPTY 创建/销毁；其它平台直接执行。
pub fn with_conpty_lifecycle_lock<T>(operation: impl FnOnce() -> T) -> T {
    platform::with_conpty_lifecycle_lock(operation)
}

pub struct PtyProcessGuard {
    child: SharedPtyChildHandle,
    killer: SharedPtyChildKiller,
    kill_requested: AtomicBool,
    pid: Option<u32>,
    #[cfg(windows)]
    _job: Option<platform::WindowsJobObject>,
}

impl PtyProcessGuard {
    pub fn new(child: PtyChildHandle) -> Self {
        let pid = child.process_id();
        let killer = Arc::new(Mutex::new(child.clone_killer()));

        #[cfg(windows)]
        let job = match platform::WindowsJobObject::attach_to_child(&child) {
            Ok(job) => job,
            Err(error) => {
                tauri_plugin_log::log::warn!(
                    "failed to attach PTY process to Windows Job Object: {error}"
                );
                None
            }
        };

        Self {
            child: Arc::new(Mutex::new(child)),
            killer,
            kill_requested: AtomicBool::new(false),
            pid,
            #[cfg(windows)]
            _job: job,
        }
    }

    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    pub fn shared_child(&self) -> SharedPtyChildHandle {
        self.child.clone()
    }

    pub fn try_wait_status(&self) -> io::Result<Option<ExitStatus>> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| io::Error::other("PTY child lock poisoned"))?;
        child.try_wait()
    }

    /// Requests process termination at most once.
    ///
    /// The guard first tries to observe an already-exited child to avoid
    /// signalling a stale PID on Unix cloned killers. If the child lock is busy,
    /// it falls back to the cloned killer so close/drop never blocks on waiter
    /// threads.
    pub fn best_effort_kill(&self) -> bool {
        if self.kill_requested.swap(true, Ordering::SeqCst) {
            return false;
        }

        if let Ok(mut child) = self.child.try_lock() {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return false;
            }
        }

        let Ok(mut killer) = self.killer.lock() else {
            return false;
        };
        let _ = killer.kill();
        true
    }

    #[cfg(windows)]
    pub fn has_windows_job(&self) -> bool {
        self._job.is_some()
    }
}

impl fmt::Debug for PtyProcessGuard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PtyProcessGuard")
            .field("pid", &self.pid)
            .field(
                "kill_requested",
                &self.kill_requested.load(Ordering::SeqCst),
            )
            .finish_non_exhaustive()
    }
}

impl Drop for PtyProcessGuard {
    fn drop(&mut self) {
        let _ = self.best_effort_kill();
    }
}

pub struct PtyMasterGuard {
    inner: Option<PtyMasterHandle>,
}

impl PtyMasterGuard {
    pub fn new(master: PtyMasterHandle) -> Self {
        Self {
            inner: Some(master),
        }
    }

    pub fn resize(&self, size: PtySize) -> Result<(), String> {
        self.inner().resize(size).map_err(|error| error.to_string())
    }

    pub fn try_clone_reader(&self) -> Result<Box<dyn Read + Send>, String> {
        self.inner()
            .try_clone_reader()
            .map_err(|error| error.to_string())
    }

    pub fn take_writer(&self) -> Result<Box<dyn Write + Send>, String> {
        self.inner()
            .take_writer()
            .map_err(|error| error.to_string())
    }

    fn inner(&self) -> &PtyMasterHandle {
        self.inner
            .as_ref()
            .expect("PTY master handle must exist before drop")
    }
}

impl fmt::Debug for PtyMasterGuard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PtyMasterGuard")
            .finish_non_exhaustive()
    }
}

impl Drop for PtyMasterGuard {
    fn drop(&mut self) {
        if let Some(master) = self.inner.take() {
            with_conpty_lifecycle_lock(|| drop(master));
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::PtyChildHandle;
    use std::{ffi::c_void, io, mem::size_of, os::windows::io::RawHandle, ptr, sync::Mutex};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
    };

    static CONPTY_LIFECYCLE_LOCK: Mutex<()> = Mutex::new(());

    pub(super) fn with_conpty_lifecycle_lock<T>(operation: impl FnOnce() -> T) -> T {
        let _guard = CONPTY_LIFECYCLE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        operation()
    }

    #[derive(Debug)]
    pub(super) struct WindowsJobObject {
        handle: HANDLE,
    }

    unsafe impl Send for WindowsJobObject {}

    impl WindowsJobObject {
        pub(super) fn attach_to_child(child: &PtyChildHandle) -> io::Result<Option<Self>> {
            let Some(process_handle) = child.as_raw_handle() else {
                return Ok(None);
            };
            Self::attach_to_process_handle(process_handle).map(Some)
        }

        fn attach_to_process_handle(process_handle: RawHandle) -> io::Result<Self> {
            let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
            if handle.is_null() || handle == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }

            let job = Self { handle };
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            let configured = unsafe {
                SetInformationJobObject(
                    job.handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const c_void,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if configured == 0 {
                return Err(io::Error::last_os_error());
            }

            let assigned =
                unsafe { AssignProcessToJobObject(job.handle, process_handle as HANDLE) };
            if assigned == 0 {
                return Err(io::Error::last_os_error());
            }

            Ok(job)
        }
    }

    impl Drop for WindowsJobObject {
        fn drop(&mut self) {
            if !self.handle.is_null() && self.handle != INVALID_HANDLE_VALUE {
                unsafe {
                    CloseHandle(self.handle);
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub(super) fn with_conpty_lifecycle_lock<T>(operation: impl FnOnce() -> T) -> T {
        operation()
    }
}
