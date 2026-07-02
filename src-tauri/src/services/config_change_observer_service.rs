//! 文件型配置变更观察服务。
//!
//! @author kongweiguang

use std::{
    collections::BTreeSet,
    fmt, fs,
    path::{Path, PathBuf},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use notify::{Config, Event, PollWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use tauri::{AppHandle, Emitter};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

use crate::{
    models::config_change::{
        classify_config_path, ConfigChangeBatch, ConfigChangeDiagnostic, ConfigChangeSourceHint,
        ConfigDomain, ConfigWatchBackend, ConfigWatchStatus, ConfigWatchStatusSnapshot,
        CONFIG_CHANGE_EVENT_NAME, CONFIG_CHANGE_EVENT_VERSION,
    },
    storage::{
        config_file_store::ConfigFileStore,
        file_store::{FileStoreError, ParseDiagnostic},
    },
};

const QUIET_WINDOW: Duration = Duration::from_millis(700);
const MAX_BATCH_WAIT: Duration = Duration::from_millis(2500);
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const VALIDATION_RETRY_ATTEMPTS: usize = 4;
const VALIDATION_RETRY_DELAY: Duration = Duration::from_millis(180);

type NativeDebouncer = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

/// 监听配置变更并向前端发送域级失效事件。
#[derive(Clone)]
pub struct ConfigChangeObserverService {
    store: ConfigFileStore,
    state: Arc<Mutex<ConfigChangeObserverState>>,
}

impl fmt::Debug for ConfigChangeObserverService {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConfigChangeObserverService")
            .field("root", &self.store.root())
            .field("status", &self.status())
            .finish_non_exhaustive()
    }
}

/// Sink used by the observer worker to publish normalized config change batches.
pub trait ConfigChangeEventEmitter: Send + Sync + 'static {
    fn emit_config_change(&self, batch: &ConfigChangeBatch) -> Result<(), String>;
}

impl<F> ConfigChangeEventEmitter for F
where
    F: Fn(&ConfigChangeBatch) -> Result<(), String> + Send + Sync + 'static,
{
    fn emit_config_change(&self, batch: &ConfigChangeBatch) -> Result<(), String> {
        self(batch)
    }
}

impl ConfigChangeObserverService {
    /// 创建配置变更观察服务。
    pub fn new(store: ConfigFileStore) -> Self {
        Self {
            store,
            state: Arc::new(Mutex::new(ConfigChangeObserverState::new())),
        }
    }

    /// 启动 watcher。重复调用是幂等操作。
    pub fn start(&self, app: AppHandle) -> Result<(), String> {
        self.start_with_emitter(move |batch: &ConfigChangeBatch| {
            app.emit(CONFIG_CHANGE_EVENT_NAME, batch)
                .map_err(|error| error.to_string())
        })
    }

    /// 启动 watcher，并使用调用方提供的事件发布器。
    pub fn start_with_emitter<E>(&self, emitter: E) -> Result<(), String>
    where
        E: ConfigChangeEventEmitter,
    {
        self.start_with_emitter_arc(Arc::new(emitter))
    }

    fn start_with_emitter_arc(
        &self,
        emitter: Arc<dyn ConfigChangeEventEmitter>,
    ) -> Result<(), String> {
        {
            let state = self.state.lock().expect("config watcher state poisoned");
            if state.runtime.is_some() {
                return Ok(());
            }
        }

        let watch_roots = prepare_watch_roots(self.store.root())?;
        let watched_root_labels = watch_root_labels();
        let (event_tx, event_rx) = mpsc::channel();
        let worker =
            spawn_config_change_worker(emitter, self.store.clone(), self.state.clone(), event_rx)?;

        let backend_result = build_native_backend(&watch_roots, event_tx.clone()).map_or_else(
            |native_error| {
                build_polling_backend(&watch_roots, event_tx.clone()).map(|backend| {
                    (
                        backend,
                        ConfigWatchBackend::Polling,
                        Some(format!("native watcher unavailable: {native_error}")),
                    )
                })
            },
            |backend| Ok((backend, ConfigWatchBackend::Native, None)),
        );

        let (backend, backend_kind, fallback_reason) = match backend_result {
            Ok(result) => result,
            Err(error) => {
                let snapshot = self.record_unavailable_start(
                    watched_root_labels,
                    format!("config watcher unavailable: {error}"),
                );
                let batch = watcher_unavailable_batch(snapshot.last_sequence, error);
                let _ = event_tx.send(ConfigObserverInput::Batch(batch));
                return Ok(());
            }
        };

        let mut state = self.state.lock().expect("config watcher state poisoned");
        state.snapshot.enabled = true;
        state.snapshot.backend = backend_kind;
        state.snapshot.watched_roots = watched_root_labels;
        state.snapshot.ignored_globs = ignored_globs();
        state.snapshot.fallback_reason = fallback_reason;
        state.runtime = Some(ConfigChangeObserverRuntime {
            backend: Some(backend),
            worker: Some(worker),
        });
        Ok(())
    }

    /// 返回 watcher 诊断状态。
    pub fn status(&self) -> ConfigWatchStatusSnapshot {
        self.state
            .lock()
            .expect("config watcher state poisoned")
            .snapshot
            .clone()
    }

    /// 使用现有 typed reader 校验配置域。
    pub fn validate_domains(&self, domains: &[ConfigDomain]) -> Vec<ConfigChangeDiagnostic> {
        validate_domains_with_retry(&self.store, domains)
    }

    fn record_unavailable_start(
        &self,
        watched_roots: Vec<String>,
        message: String,
    ) -> ConfigWatchStatusSnapshot {
        let mut state = self.state.lock().expect("config watcher state poisoned");
        let sequence = state.next_sequence();
        state.snapshot.enabled = true;
        state.snapshot.backend = ConfigWatchBackend::Unavailable;
        state.snapshot.watched_roots = watched_roots;
        state.snapshot.ignored_globs = ignored_globs();
        state.snapshot.last_sequence = sequence;
        state.snapshot.last_batch_at = Some(observed_at_now());
        state.snapshot.last_domains = Vec::new();
        state.snapshot.last_status = Some(ConfigWatchStatus::WatcherUnavailable);
        state.snapshot.last_error = Some(message);
        state.snapshot.clone()
    }
}

enum ConfigObserverInput {
    Paths {
        paths: Vec<PathBuf>,
        source_hint: ConfigChangeSourceHint,
    },
    WatcherError(String),
    Batch(ConfigChangeBatch),
}

struct ConfigChangeObserverRuntime {
    backend: Option<ConfigWatcherBackendGuard>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Drop for ConfigChangeObserverRuntime {
    fn drop(&mut self) {
        self.backend.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

enum ConfigWatcherBackendGuard {
    Native { _debouncer: NativeDebouncer },
    Polling { _watcher: PollWatcher },
}

struct ConfigChangeObserverState {
    next_sequence: u64,
    snapshot: ConfigWatchStatusSnapshot,
    runtime: Option<ConfigChangeObserverRuntime>,
}

impl ConfigChangeObserverState {
    fn new() -> Self {
        Self {
            next_sequence: 0,
            snapshot: ConfigWatchStatusSnapshot {
                backend: ConfigWatchBackend::Unavailable,
                enabled: false,
                fallback_reason: None,
                ignored_globs: ignored_globs(),
                last_batch_at: None,
                last_domains: Vec::new(),
                last_error: None,
                last_sequence: 0,
                last_status: None,
                watched_roots: watch_root_labels(),
            },
            runtime: None,
        }
    }

    fn next_sequence(&mut self) -> u64 {
        self.next_sequence += 1;
        self.next_sequence
    }
}

fn prepare_watch_roots(root: &Path) -> Result<Vec<PathBuf>, String> {
    fs::create_dir_all(root).map_err(|error| {
        format!(
            "failed to create config root {}: {error}",
            root.to_string_lossy()
        )
    })?;

    let relative_dirs = ["profiles", "hosts", "secrets", "snippets", "workflows"];
    for relative_dir in relative_dirs {
        fs::create_dir_all(root.join(relative_dir)).map_err(|error| {
            format!("failed to create config watch dir {relative_dir}: {error}")
        })?;
    }

    Ok(watch_root_labels()
        .into_iter()
        .map(|relative_root| {
            if relative_root == "." {
                root.to_path_buf()
            } else {
                root.join(relative_root)
            }
        })
        .collect())
}

fn watch_root_labels() -> Vec<String> {
    [".", "profiles", "hosts", "secrets", "snippets", "workflows"]
        .into_iter()
        .map(str::to_owned)
        .collect()
}

fn ignored_globs() -> Vec<String> {
    [
        ".storage.lock",
        "storage-manifest.toml",
        "agents/**",
        "backups/**",
        "data/**",
        "workspace/**",
        "*.log",
        ".tmp-*",
        ".*.tmp-*",
        "*.tmp",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

fn build_native_backend(
    watch_roots: &[PathBuf],
    event_tx: Sender<ConfigObserverInput>,
) -> Result<ConfigWatcherBackendGuard, String> {
    let callback_tx = event_tx.clone();
    let mut debouncer =
        new_debouncer(
            QUIET_WINDOW,
            None,
            move |result: DebounceEventResult| match result {
                Ok(events) => {
                    for event in events {
                        let _ = callback_tx.send(ConfigObserverInput::Paths {
                            paths: event.event.paths,
                            source_hint: ConfigChangeSourceHint::Unknown,
                        });
                    }
                }
                Err(errors) => {
                    let message = format!("native watcher errors: {}", errors.len());
                    let _ = callback_tx.send(ConfigObserverInput::WatcherError(message));
                }
            },
        )
        .map_err(|error| error.to_string())?;

    for root in watch_roots {
        debouncer
            .watch(root, RecursiveMode::NonRecursive)
            .map_err(|error| {
                format!(
                    "failed to watch config root {}: {error}",
                    root.to_string_lossy()
                )
            })?;
    }
    Ok(ConfigWatcherBackendGuard::Native {
        _debouncer: debouncer,
    })
}

fn build_polling_backend(
    watch_roots: &[PathBuf],
    event_tx: Sender<ConfigObserverInput>,
) -> Result<ConfigWatcherBackendGuard, String> {
    let callback_tx = event_tx.clone();
    let mut watcher = PollWatcher::new(
        move |result: notify::Result<Event>| match result {
            Ok(event) => {
                let _ = callback_tx.send(ConfigObserverInput::Paths {
                    paths: event.paths,
                    source_hint: ConfigChangeSourceHint::Unknown,
                });
            }
            Err(error) => {
                let _ = callback_tx.send(ConfigObserverInput::WatcherError(format!(
                    "polling watcher error: {error}"
                )));
            }
        },
        Config::default()
            .with_poll_interval(POLL_INTERVAL)
            .with_follow_symlinks(false),
    )
    .map_err(|error| error.to_string())?;

    for root in watch_roots {
        watcher
            .watch(root, RecursiveMode::NonRecursive)
            .map_err(|error| {
                format!(
                    "failed to polling-watch config root {}: {error}",
                    root.to_string_lossy()
                )
            })?;
    }
    Ok(ConfigWatcherBackendGuard::Polling { _watcher: watcher })
}

fn spawn_config_change_worker(
    emitter: Arc<dyn ConfigChangeEventEmitter>,
    store: ConfigFileStore,
    state: Arc<Mutex<ConfigChangeObserverState>>,
    event_rx: Receiver<ConfigObserverInput>,
) -> Result<thread::JoinHandle<()>, String> {
    thread::Builder::new()
        .name("kerminal-config-change-observer".to_owned())
        .spawn(move || worker_loop(emitter, store, state, event_rx))
        .map_err(|error| format!("failed to spawn config watcher worker: {error}"))
}

fn worker_loop(
    emitter: Arc<dyn ConfigChangeEventEmitter>,
    store: ConfigFileStore,
    state: Arc<Mutex<ConfigChangeObserverState>>,
    event_rx: Receiver<ConfigObserverInput>,
) {
    while let Ok(first_input) = event_rx.recv() {
        let inputs = collect_debounced_inputs(first_input, &event_rx);
        for batch in build_batches_from_inputs(&store, state.clone(), inputs) {
            if let Err(error) = emitter.emit_config_change(&batch) {
                record_emit_error(&state, format!("failed to emit config event: {error}"));
            }
        }
    }
}

fn collect_debounced_inputs(
    first_input: ConfigObserverInput,
    event_rx: &Receiver<ConfigObserverInput>,
) -> Vec<ConfigObserverInput> {
    let started_at = Instant::now();
    let mut inputs = vec![first_input];
    loop {
        let elapsed = started_at.elapsed();
        if elapsed >= MAX_BATCH_WAIT {
            return inputs;
        }
        let remaining_to_max = MAX_BATCH_WAIT.saturating_sub(elapsed);
        let wait_for = remaining_to_max.min(QUIET_WINDOW);
        match event_rx.recv_timeout(wait_for) {
            Ok(input) => inputs.push(input),
            Err(RecvTimeoutError::Timeout) => return inputs,
            Err(RecvTimeoutError::Disconnected) => return inputs,
        }
    }
}

fn build_batches_from_inputs(
    store: &ConfigFileStore,
    state: Arc<Mutex<ConfigChangeObserverState>>,
    inputs: Vec<ConfigObserverInput>,
) -> Vec<ConfigChangeBatch> {
    let mut paths = Vec::new();
    let mut watcher_errors = Vec::new();
    let mut explicit_batches = Vec::new();
    let mut source_hint = ConfigChangeSourceHint::Unknown;

    for input in inputs {
        match input {
            ConfigObserverInput::Paths {
                paths: next_paths,
                source_hint: next_source_hint,
            } => {
                if matches!(source_hint, ConfigChangeSourceHint::Unknown) {
                    source_hint = next_source_hint;
                }
                if next_paths
                    .iter()
                    .any(|path| is_kerminal_atomic_temp_path(path))
                {
                    source_hint = ConfigChangeSourceHint::Kerminal;
                }
                paths.extend(next_paths);
            }
            ConfigObserverInput::WatcherError(message) => watcher_errors.push(message),
            ConfigObserverInput::Batch(batch) => explicit_batches.push(batch),
        }
    }

    let mut batches = explicit_batches;
    if !watcher_errors.is_empty() {
        batches.push(record_watcher_unavailable(
            &state,
            watcher_errors.join("; "),
        ));
    }

    let domains = classify_domains(store.root(), &paths);
    if domains.is_empty() {
        return batches;
    }

    let diagnostics = validate_domains_with_retry(store, &domains);
    let status = if diagnostics.is_empty() {
        ConfigWatchStatus::Ready
    } else {
        ConfigWatchStatus::Invalid
    };
    batches.push(record_domain_batch(
        &state,
        domains,
        status,
        diagnostics,
        source_hint,
    ));
    batches
}

fn classify_domains(root: &Path, paths: &[PathBuf]) -> Vec<ConfigDomain> {
    let mut domains = BTreeSet::new();
    for path in paths {
        if let Some(classification) = classify_config_path(root, path) {
            domains.insert(classification.domain);
        }
    }
    domains.into_iter().collect()
}

fn validate_domains_with_retry(
    store: &ConfigFileStore,
    domains: &[ConfigDomain],
) -> Vec<ConfigChangeDiagnostic> {
    let mut diagnostics = Vec::new();
    for attempt in 0..=VALIDATION_RETRY_ATTEMPTS {
        diagnostics = validate_domains_once(store, domains);
        if diagnostics.is_empty() || attempt == VALIDATION_RETRY_ATTEMPTS {
            break;
        }
        thread::sleep(VALIDATION_RETRY_DELAY);
    }
    diagnostics
}

fn validate_domains_once(
    store: &ConfigFileStore,
    domains: &[ConfigDomain],
) -> Vec<ConfigChangeDiagnostic> {
    let mut diagnostics = Vec::new();
    for domain in domains {
        let result = match domain {
            ConfigDomain::Settings => store.read_settings_or_default().map(|_| ()),
            ConfigDomain::Profiles => store.list_profiles().map(|_| ()),
            ConfigDomain::Hosts => store.list_remote_host_tree().map(|_| ()),
            ConfigDomain::Snippets => store.list_snippets().map(|_| ()),
            ConfigDomain::Workflows => store.list_workflows().map(|_| ()),
        };
        if result.is_err() {
            diagnostics.extend(config_diagnostics_from_error(
                *domain,
                result.expect_err("checked result error"),
            ));
        }
    }
    diagnostics
}

fn config_diagnostics_from_error(
    domain: ConfigDomain,
    error: FileStoreError,
) -> Vec<ConfigChangeDiagnostic> {
    match error {
        FileStoreError::TomlParse(parse_error) => {
            let diagnostics = parse_error
                .diagnostics()
                .iter()
                .map(|diagnostic| config_diagnostic_from_parse(domain, diagnostic))
                .collect::<Vec<_>>();
            if diagnostics.is_empty() {
                vec![generic_config_diagnostic(domain, "TOML parse failed")]
            } else {
                diagnostics
            }
        }
        other => vec![generic_config_diagnostic(
            domain,
            format!("{} config invalid: {other}", domain_label(domain)),
        )],
    }
}

fn config_diagnostic_from_parse(
    domain: ConfigDomain,
    diagnostic: &ParseDiagnostic,
) -> ConfigChangeDiagnostic {
    ConfigChangeDiagnostic {
        domain: Some(domain),
        message: diagnostic.message.clone(),
        path: diagnostic.path.as_deref().and_then(safe_config_path_label),
        line: Some(diagnostic.line),
        column: Some(diagnostic.column),
        key: diagnostic.key.clone(),
        recovery: diagnostic.recovery.clone(),
    }
}

fn generic_config_diagnostic(
    domain: ConfigDomain,
    message: impl Into<String>,
) -> ConfigChangeDiagnostic {
    ConfigChangeDiagnostic {
        domain: Some(domain),
        message: message.into(),
        path: None,
        line: None,
        column: None,
        key: None,
        recovery: Some(
            "Fix the invalid config file; Kerminal keeps last-known-good until validation passes."
                .to_owned(),
        ),
    }
}

fn safe_config_path_label(path: &Path) -> Option<String> {
    if path.is_absolute() {
        return None;
    }
    let normalized = path.to_string_lossy().replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.contains("..")
        || normalized.starts_with("secrets/")
        || normalized.contains("/secrets/")
    {
        None
    } else {
        Some(normalized)
    }
}

fn record_domain_batch(
    state: &Arc<Mutex<ConfigChangeObserverState>>,
    domains: Vec<ConfigDomain>,
    status: ConfigWatchStatus,
    diagnostics: Vec<ConfigChangeDiagnostic>,
    source_hint: ConfigChangeSourceHint,
) -> ConfigChangeBatch {
    let mut guard = state.lock().expect("config watcher state poisoned");
    let sequence = guard.next_sequence();
    let observed_at = observed_at_now();
    let batch = ConfigChangeBatch {
        batch_id: format!("config-{}-{}", sequence, Uuid::new_v4()),
        diagnostics,
        domains: domains.clone(),
        observed_at: observed_at.clone(),
        sequence,
        source_hint,
        status,
        version: CONFIG_CHANGE_EVENT_VERSION,
    };
    guard.snapshot.last_batch_at = Some(observed_at);
    guard.snapshot.last_domains = domains;
    guard.snapshot.last_error = batch
        .diagnostics
        .first()
        .map(|diagnostic| diagnostic.message.clone());
    guard.snapshot.last_sequence = sequence;
    guard.snapshot.last_status = Some(status);
    batch
}

fn record_watcher_unavailable(
    state: &Arc<Mutex<ConfigChangeObserverState>>,
    message: String,
) -> ConfigChangeBatch {
    let mut guard = state.lock().expect("config watcher state poisoned");
    let sequence = guard.next_sequence();
    guard.snapshot.backend = ConfigWatchBackend::Unavailable;
    guard.snapshot.last_batch_at = Some(observed_at_now());
    guard.snapshot.last_domains = Vec::new();
    guard.snapshot.last_error = Some(message.clone());
    guard.snapshot.last_sequence = sequence;
    guard.snapshot.last_status = Some(ConfigWatchStatus::WatcherUnavailable);
    watcher_unavailable_batch(sequence, message)
}

fn watcher_unavailable_batch(sequence: u64, message: String) -> ConfigChangeBatch {
    ConfigChangeBatch {
        batch_id: format!("config-unavailable-{sequence}-{}", Uuid::new_v4()),
        diagnostics: vec![ConfigChangeDiagnostic {
            domain: None,
            message,
            path: None,
            line: None,
            column: None,
            key: None,
            recovery: None,
        }],
        domains: Vec::new(),
        observed_at: observed_at_now(),
        sequence,
        source_hint: ConfigChangeSourceHint::Unknown,
        status: ConfigWatchStatus::WatcherUnavailable,
        version: CONFIG_CHANGE_EVENT_VERSION,
    }
}

fn record_emit_error(state: &Arc<Mutex<ConfigChangeObserverState>>, message: String) {
    let mut guard = state.lock().expect("config watcher state poisoned");
    guard.snapshot.last_error = Some(message);
}

fn is_kerminal_atomic_temp_path(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    file_name.contains(&format!(".tmp-{}-", std::process::id()))
}

fn domain_label(domain: ConfigDomain) -> &'static str {
    match domain {
        ConfigDomain::Settings => "settings",
        ConfigDomain::Profiles => "profiles",
        ConfigDomain::Hosts => "hosts",
        ConfigDomain::Snippets => "snippets",
        ConfigDomain::Workflows => "workflows",
    }
}

fn observed_at_now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}
