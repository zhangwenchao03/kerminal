//! SSH 终端 command 异步边界回归测试。
//!
//! @author kongweiguang

use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use kerminal_lib::{
    commands::ssh::rules::{run_bounded_ssh_create_task, run_ssh_create_task},
    models::terminal::{TerminalCommandError, TerminalErrorClass, TerminalErrorOperation},
};

#[tokio::test(flavor = "current_thread")]
async fn slow_ssh_create_task_does_not_block_async_runtime_heartbeat() {
    let (worker_started_tx, worker_started_rx) = tokio::sync::oneshot::channel();
    let create_task = run_ssh_create_task(move || {
        let _ = worker_started_tx.send(());
        std::thread::sleep(Duration::from_millis(300));
        Ok(())
    });
    tokio::pin!(create_task);

    tokio::select! {
        result = &mut create_task => {
            panic!("慢 SSH 创建任务不应在启动信号前结束: {result:?}");
        }
        started = worker_started_rx => {
            started.expect("SSH 创建 worker 应发出启动信号");
        }
    }

    let heartbeat_started_at = Instant::now();
    tokio::select! {
        result = &mut create_task => {
            panic!("慢 SSH 创建任务不应在心跳前同步结束: {result:?}");
        }
        _ = tokio::time::sleep(Duration::from_millis(40)) => {}
    }

    assert!(
        heartbeat_started_at.elapsed() < Duration::from_millis(200),
        "SSH 创建任务阻塞了异步运行时心跳"
    );
    create_task.await.expect("SSH 创建 worker 应正常完成");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn external_ssh_create_budget_never_runs_more_than_configured_workers() {
    let semaphore = Arc::new(tokio::sync::Semaphore::new(2));
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let mut tasks = Vec::new();

    for _ in 0..6 {
        let semaphore = Arc::clone(&semaphore);
        let active = Arc::clone(&active);
        let peak = Arc::clone(&peak);
        tasks.push(tokio::spawn(async move {
            run_bounded_ssh_create_task(semaphore, Duration::from_secs(2), move || {
                let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(current, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(40));
                active.fetch_sub(1, Ordering::SeqCst);
                Ok(())
            })
            .await
        }));
    }

    for task in tasks {
        task.await
            .expect("join bounded create task")
            .expect("run task");
    }
    assert_eq!(peak.load(Ordering::SeqCst), 2);
}

#[tokio::test(flavor = "current_thread")]
async fn ssh_create_worker_panic_maps_to_create_session_error() {
    let error = run_ssh_create_task(|| -> Result<(), TerminalCommandError> {
        panic!("synthetic SSH worker panic");
    })
    .await
    .expect_err("worker panic 必须映射成 command 错误");

    assert_eq!(error.operation, TerminalErrorOperation::CreateSession);
    assert_eq!(error.class, TerminalErrorClass::SpawnFailed);
    assert!(error.message.contains("SSH 终端创建后台任务失败"));
}
