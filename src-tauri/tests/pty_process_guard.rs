//! PTY 进程守护测试。
//!
//! @author kongweiguang

use kerminal_lib::services::pty_process_guard::PtyProcessGuard;
use portable_pty::{Child, ChildKiller, ExitStatus};
use std::{
    io,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
};

#[test]
fn pty_process_guard_drop_kills_running_child_once() {
    let kills = Arc::new(AtomicUsize::new(0));
    {
        let child = FakeChild::new(kills.clone(), Arc::new(AtomicBool::new(false)));
        let _guard = PtyProcessGuard::new(Box::new(child));
    }

    assert_eq!(kills.load(Ordering::SeqCst), 1);
}

#[test]
fn pty_process_guard_best_effort_kill_is_idempotent() {
    let kills = Arc::new(AtomicUsize::new(0));
    let child = FakeChild::new(kills.clone(), Arc::new(AtomicBool::new(false)));
    let guard = PtyProcessGuard::new(Box::new(child));

    assert!(guard.best_effort_kill());
    assert!(!guard.best_effort_kill());
    drop(guard);

    assert_eq!(kills.load(Ordering::SeqCst), 1);
}

#[test]
fn pty_process_guard_does_not_kill_already_exited_child() {
    let kills = Arc::new(AtomicUsize::new(0));
    let exited = Arc::new(AtomicBool::new(true));
    let child = FakeChild::new(kills.clone(), exited);

    let guard = PtyProcessGuard::new(Box::new(child));
    assert!(!guard.best_effort_kill());
    drop(guard);

    assert_eq!(kills.load(Ordering::SeqCst), 0);
}

#[test]
fn pty_process_guard_reports_child_status() {
    let kills = Arc::new(AtomicUsize::new(0));
    let exited = Arc::new(AtomicBool::new(false));
    let child = FakeChild::new(kills, exited.clone());
    let guard = PtyProcessGuard::new(Box::new(child));

    assert!(guard.try_wait_status().unwrap().is_none());
    exited.store(true, Ordering::SeqCst);
    assert!(guard.try_wait_status().unwrap().is_some());
}

#[cfg(windows)]
#[test]
fn pty_process_guard_soft_fails_when_child_has_no_raw_handle() {
    let kills = Arc::new(AtomicUsize::new(0));
    let child = FakeChild::new(kills, Arc::new(AtomicBool::new(false)));
    let guard = PtyProcessGuard::new(Box::new(child));

    assert!(!guard.has_windows_job());
}

#[derive(Debug)]
struct FakeChild {
    kills: Arc<AtomicUsize>,
    exited: Arc<AtomicBool>,
}

impl FakeChild {
    fn new(kills: Arc<AtomicUsize>, exited: Arc<AtomicBool>) -> Self {
        Self { kills, exited }
    }
}

impl ChildKiller for FakeChild {
    fn kill(&mut self) -> io::Result<()> {
        self.kills.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(FakeChildKiller {
            kills: self.kills.clone(),
        })
    }
}

impl Child for FakeChild {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        if self.exited.load(Ordering::SeqCst) {
            Ok(Some(ExitStatus::with_exit_code(0)))
        } else {
            Ok(None)
        }
    }

    fn wait(&mut self) -> io::Result<ExitStatus> {
        self.exited.store(true, Ordering::SeqCst);
        Ok(ExitStatus::with_exit_code(0))
    }

    fn process_id(&self) -> Option<u32> {
        Some(42)
    }

    #[cfg(windows)]
    fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
        None
    }
}

#[derive(Debug)]
struct FakeChildKiller {
    kills: Arc<AtomicUsize>,
}

impl ChildKiller for FakeChildKiller {
    fn kill(&mut self) -> io::Result<()> {
        self.kills.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(Self {
            kills: self.kills.clone(),
        })
    }
}
