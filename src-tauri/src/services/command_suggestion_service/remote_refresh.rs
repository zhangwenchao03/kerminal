//! 远端命令建议后台刷新的合并、限流、取消与旧结果保护。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    fmt::Display,
    future::Future,
    hash::Hash,
    sync::{Arc, Mutex, MutexGuard, Weak},
    time::{Duration, Instant},
};

use tokio::sync::{Notify, Semaphore};
use tokio_util::sync::CancellationToken;

use super::remote_cache_policy::{
    BoundedRemoteCache, RemoteCacheLookup, RemoteCachePolicy, RemoteRefreshGate,
};

/// 一次后台刷新对调用方可见的稳定结果。
#[derive(Debug)]
pub(crate) enum RemoteRefreshOutcome<V> {
    Fresh(Arc<V>),
    Refreshed(Arc<V>),
    Coalesced(Arc<V>),
    Backoff {
        stale: Option<Arc<V>>,
        retry_after: Duration,
    },
    Failed {
        error: Arc<str>,
        stale: Option<Arc<V>>,
        retry_after: Duration,
    },
    Cancelled {
        stale: Option<Arc<V>>,
    },
    Superseded {
        stale: Option<Arc<V>>,
    },
}

impl<V> Clone for RemoteRefreshOutcome<V> {
    fn clone(&self) -> Self {
        match self {
            Self::Fresh(value) => Self::Fresh(Arc::clone(value)),
            Self::Refreshed(value) => Self::Refreshed(Arc::clone(value)),
            Self::Coalesced(value) => Self::Coalesced(Arc::clone(value)),
            Self::Backoff { stale, retry_after } => Self::Backoff {
                stale: stale.clone(),
                retry_after: *retry_after,
            },
            Self::Failed {
                error,
                stale,
                retry_after,
            } => Self::Failed {
                error: Arc::clone(error),
                stale: stale.clone(),
                retry_after: *retry_after,
            },
            Self::Cancelled { stale } => Self::Cancelled {
                stale: stale.clone(),
            },
            Self::Superseded { stale } => Self::Superseded {
                stale: stale.clone(),
            },
        }
    }
}

impl<V> RemoteRefreshOutcome<V> {
    fn for_waiter(&self) -> Self {
        match self {
            Self::Refreshed(value) | Self::Coalesced(value) => Self::Coalesced(Arc::clone(value)),
            Self::Fresh(value) => Self::Fresh(Arc::clone(value)),
            Self::Backoff { stale, retry_after } => Self::Backoff {
                stale: stale.clone(),
                retry_after: *retry_after,
            },
            Self::Failed {
                error,
                stale,
                retry_after,
            } => Self::Failed {
                error: Arc::clone(error),
                stale: stale.clone(),
                retry_after: *retry_after,
            },
            Self::Cancelled { stale } => Self::Cancelled {
                stale: stale.clone(),
            },
            Self::Superseded { stale } => Self::Superseded {
                stale: stale.clone(),
            },
        }
    }
}

#[derive(Debug)]
struct InFlightRefresh<V> {
    cancellation: CancellationToken,
    generation: u64,
    notify: Notify,
    outcome: Mutex<Option<RemoteRefreshOutcome<V>>>,
}

impl<V> InFlightRefresh<V> {
    fn new(generation: u64) -> Self {
        Self {
            cancellation: CancellationToken::new(),
            generation,
            notify: Notify::new(),
            outcome: Mutex::new(None),
        }
    }

    fn publish(&self, outcome: RemoteRefreshOutcome<V>) {
        *recover_lock(&self.outcome) = Some(outcome);
        self.notify.notify_waiters();
    }

    async fn wait(&self) -> RemoteRefreshOutcome<V> {
        loop {
            let notified = self.notify.notified();
            if let Some(outcome) = recover_lock(&self.outcome).as_ref() {
                return outcome.for_waiter();
            }
            notified.await;
        }
    }
}

enum RefreshStart<V> {
    Lead(Arc<InFlightRefresh<V>>),
    Wait(Arc<InFlightRefresh<V>>),
    Immediate(RemoteRefreshOutcome<V>),
}

/// 跨 provider 共享的全局与每 scope 并发门禁。
#[derive(Debug)]
pub(crate) struct RemoteRefreshConcurrency {
    global: Arc<Semaphore>,
    per_scope: Mutex<HashMap<String, Weak<Semaphore>>>,
    per_scope_limit: usize,
}

impl RemoteRefreshConcurrency {
    pub(crate) fn new(global_limit: usize, per_scope_limit: usize) -> Result<Self, &'static str> {
        if global_limit == 0 || per_scope_limit == 0 {
            return Err("远端建议刷新并发上限必须大于 0");
        }
        Ok(Self {
            global: Arc::new(Semaphore::new(global_limit)),
            per_scope: Mutex::new(HashMap::new()),
            per_scope_limit,
        })
    }

    async fn acquire(
        &self,
        scope: &str,
    ) -> Result<
        (
            tokio::sync::OwnedSemaphorePermit,
            tokio::sync::OwnedSemaphorePermit,
        ),
        (),
    > {
        let global = Arc::clone(&self.global)
            .acquire_owned()
            .await
            .map_err(|_| ())?;
        let scope_semaphore = {
            let mut scopes = recover_lock(&self.per_scope);
            scopes.retain(|_, semaphore| semaphore.strong_count() > 0);
            scopes
                .get(scope)
                .and_then(Weak::upgrade)
                .unwrap_or_else(|| {
                    let semaphore = Arc::new(Semaphore::new(self.per_scope_limit));
                    scopes.insert(scope.to_owned(), Arc::downgrade(&semaphore));
                    semaphore
                })
        };
        let scope = scope_semaphore.acquire_owned().await.map_err(|_| ())?;
        Ok((global, scope))
    }
}

/// 远端 provider 的后台刷新运行时。
///
/// 同 key/同 generation 只执行一次外部工作；不同 key 受全局信号量约束。
/// 新 generation 会取消旧任务，且旧任务即使忽略取消也无法提交缓存。
#[derive(Debug)]
pub(crate) struct RemoteRefreshRuntime<K, V> {
    cache: Mutex<BoundedRemoteCache<K, V>>,
    concurrency: Arc<RemoteRefreshConcurrency>,
    in_flight: Mutex<HashMap<K, Arc<InFlightRefresh<V>>>>,
}

#[cfg_attr(test, allow(dead_code, reason = "测试 API 由集成测试通过路径模块复用"))]
impl<K, V> RemoteRefreshRuntime<K, V>
where
    K: Clone + Eq + Hash,
{
    #[cfg(test)]
    pub(crate) fn new(
        policy: RemoteCachePolicy,
        max_concurrency: usize,
    ) -> Result<Self, &'static str> {
        if max_concurrency == 0 {
            return Err("远端建议刷新并发上限必须大于 0");
        }
        let concurrency = Arc::new(RemoteRefreshConcurrency::new(
            max_concurrency,
            max_concurrency,
        )?);
        Self::with_shared_concurrency(policy, concurrency)
    }

    /// 使用跨 provider 共享的全局/每主机并发门禁创建运行时。
    pub(crate) fn with_shared_concurrency(
        policy: RemoteCachePolicy,
        concurrency: Arc<RemoteRefreshConcurrency>,
    ) -> Result<Self, &'static str> {
        Ok(Self {
            cache: Mutex::new(BoundedRemoteCache::new(policy)),
            concurrency,
            in_flight: Mutex::new(HashMap::new()),
        })
    }

    /// 纯内存读取缓存，不触发网络、SSH、SFTP 或外部进程。
    #[cfg(test)]
    pub(crate) fn cached(&self, key: &K, now: Instant) -> RemoteCacheLookup<V> {
        recover_lock(&self.cache).lookup(key, now)
    }

    /// 刷新指定 key。外部工作显式接收取消令牌，便于 SSH/SFTP adapter 尽早停止。
    #[cfg(test)]
    pub(crate) async fn refresh<F, Fut, E>(
        &self,
        key: K,
        generation: u64,
        now: Instant,
        work: F,
    ) -> RemoteRefreshOutcome<V>
    where
        F: FnOnce(CancellationToken) -> Fut,
        Fut: Future<Output = Result<V, E>>,
        E: Display,
    {
        self.refresh_scoped(key, generation, "", now, work).await
    }

    /// 按主机或其它稳定 scope 执行刷新，并共享全局/每 scope 并发预算。
    pub(crate) async fn refresh_scoped<F, Fut, E>(
        &self,
        key: K,
        generation: u64,
        scope: &str,
        now: Instant,
        work: F,
    ) -> RemoteRefreshOutcome<V>
    where
        F: FnOnce(CancellationToken) -> Fut,
        Fut: Future<Output = Result<V, E>>,
        E: Display,
    {
        let start = {
            let mut in_flight = recover_lock(&self.in_flight);
            if let Some(active) = in_flight.get(&key) {
                if active.generation == generation {
                    RefreshStart::Wait(Arc::clone(active))
                } else if active.generation > generation {
                    let stale = lookup_visible(&mut recover_lock(&self.cache), &key, now);
                    RefreshStart::Immediate(RemoteRefreshOutcome::Superseded { stale })
                } else {
                    // 更高 generation 代表调用方上下文已推进，旧任务只允许结束，不允许提交。
                    active.cancellation.cancel();
                    let stale = lookup_visible(&mut recover_lock(&self.cache), &key, now);
                    active.publish(RemoteRefreshOutcome::Superseded { stale });
                    in_flight.remove(&key);
                    self.prepare_leader(&mut in_flight, key.clone(), generation, now)
                }
            } else {
                self.prepare_leader(&mut in_flight, key.clone(), generation, now)
            }
        };

        match start {
            RefreshStart::Lead(flight) => {
                self.execute_leader(key, generation, scope, now, flight, work)
                    .await
            }
            RefreshStart::Wait(flight) => flight.wait().await,
            RefreshStart::Immediate(outcome) => outcome,
        }
    }

    /// 主动取消当前 generation，并立即唤醒所有合并等待者。
    #[cfg(test)]
    pub(crate) fn cancel(&self, key: &K, generation: u64, now: Instant) -> bool {
        let flight = {
            let mut in_flight = recover_lock(&self.in_flight);
            let Some(flight) = in_flight.get(key) else {
                return false;
            };
            if flight.generation != generation {
                return false;
            }
            let flight = Arc::clone(flight);
            in_flight.remove(key);
            flight
        };
        flight.cancellation.cancel();
        let stale = lookup_visible(&mut recover_lock(&self.cache), key, now);
        flight.publish(RemoteRefreshOutcome::Cancelled { stale });
        true
    }

    #[cfg(test)]
    pub(crate) fn cache_len(&self) -> usize {
        recover_lock(&self.cache).len()
    }

    fn prepare_leader(
        &self,
        in_flight: &mut HashMap<K, Arc<InFlightRefresh<V>>>,
        key: K,
        generation: u64,
        now: Instant,
    ) -> RefreshStart<V> {
        let gate = recover_lock(&self.cache).prepare_refresh(key.clone(), generation, now);
        match gate {
            RemoteRefreshGate::Fresh(value) => {
                RefreshStart::Immediate(RemoteRefreshOutcome::Fresh(value))
            }
            RemoteRefreshGate::Backoff { stale, retry_after } => {
                RefreshStart::Immediate(RemoteRefreshOutcome::Backoff { stale, retry_after })
            }
            RemoteRefreshGate::Superseded { stale } => {
                RefreshStart::Immediate(RemoteRefreshOutcome::Superseded { stale })
            }
            RemoteRefreshGate::Ready => {
                let flight = Arc::new(InFlightRefresh::new(generation));
                in_flight.insert(key, Arc::clone(&flight));
                RefreshStart::Lead(flight)
            }
        }
    }

    async fn execute_leader<F, Fut, E>(
        &self,
        key: K,
        generation: u64,
        scope: &str,
        now: Instant,
        flight: Arc<InFlightRefresh<V>>,
        work: F,
    ) -> RemoteRefreshOutcome<V>
    where
        F: FnOnce(CancellationToken) -> Fut,
        Fut: Future<Output = Result<V, E>>,
        E: Display,
    {
        let permits = match self.concurrency.acquire(scope).await {
            Ok(permits) => permits,
            Err(_) => {
                return self.finish_cancelled(&key, generation, now, &flight);
            }
        };
        if flight.cancellation.is_cancelled() {
            drop(permits);
            return self.finish_cancelled(&key, generation, now, &flight);
        }

        let result = work(flight.cancellation.clone()).await;
        drop(permits);
        if flight.cancellation.is_cancelled() {
            return self.finish_cancelled(&key, generation, Instant::now(), &flight);
        }

        if !self.remove_if_current(&key, generation, &flight) {
            let stale = lookup_visible(&mut recover_lock(&self.cache), &key, Instant::now());
            let outcome = RemoteRefreshOutcome::Superseded { stale };
            flight.publish(outcome.clone());
            return outcome;
        }

        let completed_at = Instant::now();
        let outcome = match result {
            Ok(value) => {
                let mut cache = recover_lock(&self.cache);
                if !cache.commit_success(&key, generation, value, completed_at) {
                    RemoteRefreshOutcome::Superseded {
                        stale: lookup_visible(&mut cache, &key, completed_at),
                    }
                } else {
                    match cache.lookup(&key, completed_at) {
                        RemoteCacheLookup::Fresh(value) => RemoteRefreshOutcome::Refreshed(value),
                        RemoteCacheLookup::Stale(value) => RemoteRefreshOutcome::Refreshed(value),
                        RemoteCacheLookup::Miss => RemoteRefreshOutcome::Superseded { stale: None },
                    }
                }
            }
            Err(error) => {
                let mut cache = recover_lock(&self.cache);
                let Some(retry_after) = cache.commit_failure(&key, generation, completed_at) else {
                    let outcome = RemoteRefreshOutcome::Superseded {
                        stale: lookup_visible(&mut cache, &key, completed_at),
                    };
                    flight.publish(outcome.clone());
                    return outcome;
                };
                RemoteRefreshOutcome::Failed {
                    error: Arc::<str>::from(error.to_string()),
                    stale: lookup_visible(&mut cache, &key, completed_at),
                    retry_after,
                }
            }
        };
        flight.publish(outcome.clone());
        outcome
    }

    fn finish_cancelled(
        &self,
        key: &K,
        generation: u64,
        now: Instant,
        flight: &Arc<InFlightRefresh<V>>,
    ) -> RemoteRefreshOutcome<V> {
        self.remove_if_current(key, generation, flight);
        let outcome = RemoteRefreshOutcome::Cancelled {
            stale: lookup_visible(&mut recover_lock(&self.cache), key, now),
        };
        flight.publish(outcome.clone());
        outcome
    }

    fn remove_if_current(
        &self,
        key: &K,
        generation: u64,
        flight: &Arc<InFlightRefresh<V>>,
    ) -> bool {
        let mut in_flight = recover_lock(&self.in_flight);
        let is_current = in_flight
            .get(key)
            .is_some_and(|active| active.generation == generation && Arc::ptr_eq(active, flight));
        if is_current {
            in_flight.remove(key);
        }
        is_current
    }
}

fn lookup_visible<K, V>(
    cache: &mut BoundedRemoteCache<K, V>,
    key: &K,
    now: Instant,
) -> Option<Arc<V>>
where
    K: Clone + Eq + Hash,
{
    match cache.lookup(key, now) {
        RemoteCacheLookup::Fresh(value) | RemoteCacheLookup::Stale(value) => Some(value),
        RemoteCacheLookup::Miss => None,
    }
}

fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
