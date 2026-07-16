use super::*;

#[path = "../../src/services/command_suggestion_service/remote_cache_policy.rs"]
mod remote_cache_policy;
#[path = "../../src/services/command_suggestion_service/remote_refresh.rs"]
mod remote_refresh;

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use remote_cache_policy::{RemoteCacheLookup, RemoteCachePolicy};
use remote_refresh::{RemoteRefreshOutcome, RemoteRefreshRuntime};
use tokio::sync::{Notify, Semaphore};
use tokio::time::timeout;

fn refresh_policy(capacity: usize) -> RemoteCachePolicy {
    RemoteCachePolicy::new(
        capacity,
        Duration::from_secs(10),
        Duration::from_secs(60),
        Duration::from_secs(2),
        Duration::from_secs(30),
    )
    .expect("valid remote cache policy")
}

include!("remote_cache/refresh_cases.rs");
include!("remote_cache/suggestion_cases.rs");
