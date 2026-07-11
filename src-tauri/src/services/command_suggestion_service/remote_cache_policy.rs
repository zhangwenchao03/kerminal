//! 远端命令建议缓存的有界 LRU、SWR/LKG 与失败退避策略。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    hash::Hash,
    sync::Arc,
    time::{Duration, Instant},
};

/// 远端缓存的容量、生命周期和失败退避参数。
#[derive(Debug, Clone, Copy)]
pub(crate) struct RemoteCachePolicy {
    capacity: usize,
    fresh_ttl: Duration,
    stale_ttl: Duration,
    failure_backoff_base: Duration,
    failure_backoff_max: Duration,
}

impl RemoteCachePolicy {
    /// 创建缓存策略。stale 生命周期从 fresh 到期后开始计算。
    pub(crate) fn new(
        capacity: usize,
        fresh_ttl: Duration,
        stale_ttl: Duration,
        failure_backoff_base: Duration,
        failure_backoff_max: Duration,
    ) -> Result<Self, &'static str> {
        if capacity == 0 {
            return Err("远端建议缓存容量必须大于 0");
        }
        if fresh_ttl.is_zero() {
            return Err("远端建议缓存 fresh TTL 必须大于 0");
        }
        if failure_backoff_base.is_zero() {
            return Err("远端建议刷新退避基数必须大于 0");
        }
        if failure_backoff_max < failure_backoff_base {
            return Err("远端建议刷新最大退避不能小于退避基数");
        }
        Ok(Self {
            capacity,
            fresh_ttl,
            stale_ttl,
            failure_backoff_base,
            failure_backoff_max,
        })
    }
}

/// 缓存读取结果。过期但仍在 stale 窗口内的值可立即返回，并由调用方后台刷新。
#[derive(Debug, Clone)]
pub(crate) enum RemoteCacheLookup<V> {
    Fresh(Arc<V>),
    Stale(Arc<V>),
    Miss,
}

/// 后台刷新开始前的门禁结果。
#[derive(Debug, Clone)]
pub(crate) enum RemoteRefreshGate<V> {
    Fresh(Arc<V>),
    Ready,
    Backoff {
        stale: Option<Arc<V>>,
        retry_after: Duration,
    },
    Superseded {
        stale: Option<Arc<V>>,
    },
}

#[derive(Debug)]
struct RemoteCacheSlot<V> {
    backoff_until: Option<Instant>,
    consecutive_failures: u32,
    fresh_until: Option<Instant>,
    last_access: u64,
    latest_generation: u64,
    stale_until: Option<Instant>,
    value: Option<Arc<V>>,
}

impl<V> RemoteCacheSlot<V> {
    fn vacant(generation: u64, last_access: u64) -> Self {
        Self {
            backoff_until: None,
            consecutive_failures: 0,
            fresh_until: None,
            last_access,
            latest_generation: generation,
            stale_until: None,
            value: None,
        }
    }

    fn visible_value(&self, now: Instant) -> Option<Arc<V>> {
        self.value
            .as_ref()
            .filter(|_| self.stale_until.is_some_and(|deadline| deadline > now))
            .cloned()
    }
}

/// 线程外部加锁的有界远端缓存状态机。
///
/// 该类型不执行网络或进程调用，只负责同步内存决策，因此可安全用于
/// `list_suggestions` 之外的后台刷新编排。
#[derive(Debug)]
pub(crate) struct BoundedRemoteCache<K, V> {
    access_clock: u64,
    entries: HashMap<K, RemoteCacheSlot<V>>,
    policy: RemoteCachePolicy,
}

impl<K, V> BoundedRemoteCache<K, V>
where
    K: Clone + Eq + Hash,
{
    pub(crate) fn new(policy: RemoteCachePolicy) -> Self {
        Self {
            access_clock: 0,
            entries: HashMap::new(),
            policy,
        }
    }

    /// 读取 fresh 或 stale 值；超过 LKG 保留窗口后按 miss 处理。
    pub(crate) fn lookup(&mut self, key: &K, now: Instant) -> RemoteCacheLookup<V> {
        let access = self.next_access();
        let Some(slot) = self.entries.get_mut(key) else {
            return RemoteCacheLookup::Miss;
        };
        slot.last_access = access;

        if slot
            .fresh_until
            .is_some_and(|fresh_until| fresh_until > now)
        {
            return slot
                .value
                .as_ref()
                .cloned()
                .map_or(RemoteCacheLookup::Miss, RemoteCacheLookup::Fresh);
        }
        if let Some(value) = slot.visible_value(now) {
            return RemoteCacheLookup::Stale(value);
        }

        // 失效值正文及时释放，但保留有界失败状态，避免错误主机持续打满远端连接。
        slot.value = None;
        slot.fresh_until = None;
        slot.stale_until = None;
        RemoteCacheLookup::Miss
    }

    /// 为一次刷新登记 generation，并判断 fresh、退避和旧 generation。
    pub(crate) fn prepare_refresh(
        &mut self,
        key: K,
        generation: u64,
        now: Instant,
    ) -> RemoteRefreshGate<V> {
        let access = self.next_access();
        self.ensure_slot(&key, generation, access);
        let slot = self
            .entries
            .get_mut(&key)
            .expect("ensure_slot 必须创建远端缓存槽位");
        slot.last_access = access;
        let stale = slot.visible_value(now);

        if generation < slot.latest_generation {
            return RemoteRefreshGate::Superseded { stale };
        }
        if slot
            .fresh_until
            .is_some_and(|fresh_until| fresh_until > now)
        {
            return slot
                .value
                .as_ref()
                .cloned()
                .map_or(RemoteRefreshGate::Ready, RemoteRefreshGate::Fresh);
        }
        if let Some(backoff_until) = slot.backoff_until.filter(|deadline| *deadline > now) {
            return RemoteRefreshGate::Backoff {
                stale,
                retry_after: backoff_until.saturating_duration_since(now),
            };
        }

        slot.latest_generation = generation;
        RemoteRefreshGate::Ready
    }

    /// 仅允许当前最新 generation 提交成功值，阻断取消或迟到刷新污染缓存。
    pub(crate) fn commit_success(
        &mut self,
        key: &K,
        generation: u64,
        value: V,
        now: Instant,
    ) -> bool {
        let access = self.next_access();
        let Some(slot) = self.entries.get_mut(key) else {
            return false;
        };
        if slot.latest_generation != generation {
            return false;
        }

        let fresh_until = now + self.policy.fresh_ttl;
        slot.value = Some(Arc::new(value));
        slot.fresh_until = Some(fresh_until);
        slot.stale_until = Some(fresh_until + self.policy.stale_ttl);
        slot.backoff_until = None;
        slot.consecutive_failures = 0;
        slot.last_access = access;
        true
    }

    /// 记录失败并保留 LKG；返回本轮实际退避时长。
    pub(crate) fn commit_failure(
        &mut self,
        key: &K,
        generation: u64,
        now: Instant,
    ) -> Option<Duration> {
        let access = self.next_access();
        let slot = self.entries.get_mut(key)?;
        if slot.latest_generation != generation {
            return None;
        }

        slot.consecutive_failures = slot.consecutive_failures.saturating_add(1);
        let shift = slot.consecutive_failures.saturating_sub(1).min(31);
        let multiplier = 1_u32 << shift;
        let retry_after = self
            .policy
            .failure_backoff_base
            .saturating_mul(multiplier)
            .min(self.policy.failure_backoff_max);
        slot.backoff_until = Some(now + retry_after);
        slot.last_access = access;
        Some(retry_after)
    }

    #[cfg(test)]
    #[cfg_attr(test, allow(dead_code, reason = "由集成测试通过路径模块复用"))]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    fn ensure_slot(&mut self, key: &K, generation: u64, access: u64) {
        if self.entries.contains_key(key) {
            return;
        }
        if self.entries.len() >= self.policy.capacity {
            let oldest = self
                .entries
                .iter()
                .min_by_key(|(_, slot)| slot.last_access)
                .map(|(key, _)| key.clone());
            if let Some(oldest) = oldest {
                self.entries.remove(&oldest);
            }
        }
        self.entries
            .insert(key.clone(), RemoteCacheSlot::vacant(generation, access));
    }

    fn next_access(&mut self) -> u64 {
        self.access_clock = self.access_clock.saturating_add(1);
        self.access_clock
    }
}
