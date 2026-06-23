//! Kerminal Agent terminal context gateway behavior tests.
//!
//! @author kongweiguang

use std::{
    future::Future,
    pin::Pin,
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};

use kerminal_lib::{
    error::AppResult,
    models::{
        ai_agent::AiChatRequest,
        ai_context::AiTerminalContextRequest,
        llm_provider::{
            LlmContextStrategy, LlmProviderCreateRequest, LlmProviderKind, LlmReasoningEffort,
        },
        terminal::{TerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
    },
    paths::KerminalPaths,
    services::{
        ai_agent_service::{
            AiAgentChatContext, AiAgentService, AiChatExecutionRequest, AiChatExecutionResponse,
            AiChatExecutor,
        },
        credential_service::{CredentialService, MemoryCredentialVault},
        rig_provider_service::RigProviderService,
        terminal_session_binding_service::{
            TerminalSessionBindingEventKind, TerminalSessionBindingMetadata,
            TerminalSessionSnapshotStatus,
        },
    },
    state::AppState,
};
use tempfile::{tempdir, TempDir};

#[derive(Debug, Default)]
struct RecordingExecutor {
    requests: Mutex<Vec<AiChatExecutionRequest>>,
}

impl RecordingExecutor {
    fn requests(&self) -> Vec<AiChatExecutionRequest> {
        self.requests.lock().expect("executor requests").clone()
    }
}

impl AiChatExecutor for RecordingExecutor {
    fn execute<'a>(
        &'a self,
        request: AiChatExecutionRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiChatExecutionResponse>> + Send + 'a>> {
        self.requests
            .lock()
            .expect("executor requests")
            .push(request);
        Box::pin(async move {
            Ok(AiChatExecutionResponse {
                message: "不会被调用".to_owned(),
                pending_invocations: Vec::new(),
            })
        })
    }
}

fn setup_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    (home, state)
}

fn memory_credentials() -> CredentialService {
    CredentialService::with_vault(Arc::new(MemoryCredentialVault::new()))
}

fn create_provider(
    state: &AppState,
    credentials: &CredentialService,
    name: &str,
    context_strategy: LlmContextStrategy,
) {
    RigProviderService::new()
        .create_provider(
            state.storage(),
            credentials,
            LlmProviderCreateRequest {
                name: name.to_owned(),
                kind: LlmProviderKind::OpenAiChat,
                base_url: "https://api.example.com/v1".to_owned(),
                model: "gpt-test".to_owned(),
                model_list: vec!["gpt-test".to_owned()],
                temperature: 0.2,
                context_strategy,
                context_window_tokens: 128_000,
                reasoning_effort: LlmReasoningEffort::ModelDefault,
                max_retries: 3,
                user_agent: None,
                http_proxy: None,
                enabled: true,
                is_default: true,
                api_key: Some(format!("sk-{name}")),
            },
        )
        .expect("create provider");
}

fn chat_context<'a>(
    state: &'a AppState,
    credentials: &'a CredentialService,
) -> AiAgentChatContext<'a> {
    AiAgentChatContext {
        storage: state.storage(),
        credentials,
        ai_context: state.ai_context(),
        ai_tools: state.ai_tools(),
        terminals: state.terminals(),
        terminal_session_bindings: state.terminal_session_bindings(),

        tools: state.tools(),
        mcp_tools: state.mcp_tools(),
        settings: state.settings(),
        paths: state.paths(),
    }
}

#[test]
fn current_terminal_context_strategy_accepts_local_profile_machine_id_prefix() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "strict-local-profile",
        LlmContextStrategy::CurrentTerminal,
    );
    let executor = Arc::new(RecordingExecutor::default());
    let service = AiAgentService::with_executor(executor.clone());
    let (sender, receiver) = mpsc::channel();
    let session = state
        .terminals()
        .create_session(local_profile_output_request(), move |event| {
            sender.send(event).is_ok()
        })
        .expect("create local terminal session");
    wait_for_output(
        state.terminals(),
        &session.id,
        &receiver,
        "kerminal-local-profile-context",
    );
    state
        .terminal_session_bindings()
        .register_at_with_metadata(
            "pane-local",
            &session.id,
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-local".to_owned()),
                target_ref: Some(
                    "local:profile:profile-a:tab:tab-local:pane:pane-local".to_owned(),
                ),
                target_kind: Some("local".to_owned()),
                remote_host_id: None,
                profile_id: Some("profile-a".to_owned()),
                cwd: Some("C:/Users/24052".to_owned()),
                shell: Some("pwsh".to_owned()),
            }),
            1,
        )
        .expect("register binding");
    state
        .terminal_session_bindings()
        .ready_at("pane-local", &session.id, 2)
        .expect("ready binding")
        .expect("registered binding");

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            message: "解释最近输出".to_owned(),
            terminal_context: Some(AiTerminalContextRequest {
                session_id: session.id.clone(),
                pane_id: Some("pane-local".to_owned()),
                pane_title: Some("本地 pane".to_owned()),
                tab_id: Some("tab-local".to_owned()),
                tab_title: Some("本地 tab".to_owned()),
                machine_id: Some("profile:profile-a".to_owned()),
                machine_name: Some("PowerShell".to_owned()),
                machine_kind: Some("local".to_owned()),
                max_output_bytes: Some(4096),
            }),
            ..Default::default()
        },
    ))
    .expect("local profile machine id prefix should match binding metadata");

    state.terminals().close(&session.id).expect("close session");
    assert!(response.context_used);
    assert_eq!(executor.requests().len(), 1);
    let events = state
        .terminal_session_bindings()
        .events()
        .expect("binding events");
    assert!(events.iter().any(|event| {
        event.kind == TerminalSessionBindingEventKind::SnapshotResolved
            && event.pane_id.as_deref() == Some("pane-local")
            && event.session_id.as_deref() == Some(session.id.as_str())
    }));
}

#[test]
fn current_terminal_context_strategy_rejects_stale_session_before_executor_call() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "strict",
        LlmContextStrategy::CurrentTerminal,
    );
    let executor = Arc::new(RecordingExecutor::default());
    let service = AiAgentService::with_executor(executor.clone());

    let error = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            message: "解释最近输出".to_owned(),
            terminal_context: Some(AiTerminalContextRequest {
                session_id: "stale-session".to_owned(),
                pane_id: Some("pane-stale".to_owned()),
                pane_title: Some("过期 pane".to_owned()),
                tab_id: Some("tab-stale".to_owned()),
                tab_title: Some("过期 tab".to_owned()),
                machine_id: Some("local-powershell".to_owned()),
                machine_name: Some("PowerShell".to_owned()),
                machine_kind: Some("local".to_owned()),
                max_output_bytes: Some(4096),
            }),
            ..Default::default()
        },
    ))
    .expect_err("stale terminal session should fail in strict chat mode");

    assert!(error
        .to_string()
        .contains("终端 pane 尚未注册 active session binding"));
    assert!(executor.requests().is_empty());
}

#[test]
fn current_terminal_context_strategy_rejects_pane_session_mismatch_before_executor_call() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "strict-mismatch",
        LlmContextStrategy::CurrentTerminal,
    );
    state
        .terminal_session_bindings()
        .register_at("pane-active", "session-active", 1)
        .expect("register binding");
    state
        .terminal_session_bindings()
        .ready_at("pane-active", "session-active", 2)
        .expect("ready binding")
        .expect("registered binding");
    let executor = Arc::new(RecordingExecutor::default());
    let service = AiAgentService::with_executor(executor.clone());

    let error = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            message: "解释最近输出".to_owned(),
            terminal_context: Some(AiTerminalContextRequest {
                session_id: "session-stale".to_owned(),
                pane_id: Some("pane-active".to_owned()),
                pane_title: Some("活跃 pane".to_owned()),
                tab_id: Some("tab-active".to_owned()),
                tab_title: Some("活跃 tab".to_owned()),
                machine_id: Some("local-powershell".to_owned()),
                machine_name: Some("PowerShell".to_owned()),
                machine_kind: Some("local".to_owned()),
                max_output_bytes: Some(4096),
            }),
            ..Default::default()
        },
    ))
    .expect_err("mismatched pane/session should fail in strict chat mode");

    assert!(error
        .to_string()
        .contains("终端 pane 绑定的 session 已变化"));
    assert!(executor.requests().is_empty());
    let events = state
        .terminal_session_bindings()
        .events()
        .expect("binding events");
    assert!(events.iter().any(|event| {
        event.kind == TerminalSessionBindingEventKind::SnapshotRejected
            && event.pane_id.as_deref() == Some("pane-active")
            && event.session_id.as_deref() == Some("session-stale")
    }));
}

#[test]
fn current_workspace_context_strategy_degrades_pane_session_mismatch_and_calls_executor() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "workspace-mismatch",
        LlmContextStrategy::CurrentWorkspace,
    );
    state
        .terminal_session_bindings()
        .register_at("pane-active", "session-active", 1)
        .expect("register binding");
    state
        .terminal_session_bindings()
        .ready_at("pane-active", "session-active", 2)
        .expect("ready binding")
        .expect("registered binding");
    let executor = Arc::new(RecordingExecutor::default());
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            message: "解释最近输出".to_owned(),
            terminal_context: Some(AiTerminalContextRequest {
                session_id: "session-stale".to_owned(),
                pane_id: Some("pane-active".to_owned()),
                pane_title: Some("活跃 pane".to_owned()),
                tab_id: Some("tab-active".to_owned()),
                tab_title: Some("活跃 tab".to_owned()),
                machine_id: Some("local-powershell".to_owned()),
                machine_name: Some("PowerShell".to_owned()),
                machine_kind: Some("local".to_owned()),
                max_output_bytes: Some(4096),
            }),
            ..Default::default()
        },
    ))
    .expect("workspace context should degrade and continue");

    assert!(!response.context_used);
    assert_eq!(executor.requests().len(), 1);
    let events = state
        .terminal_session_bindings()
        .events()
        .expect("binding events");
    assert!(events.iter().any(|event| {
        event.kind == TerminalSessionBindingEventKind::SnapshotDegraded
            && event.pane_id.as_deref() == Some("pane-active")
            && event.session_id.as_deref() == Some("session-stale")
    }));
}

#[test]
fn current_terminal_context_strategy_rejects_metadata_mismatch_before_executor_call() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "strict-metadata-mismatch",
        LlmContextStrategy::CurrentTerminal,
    );
    state
        .terminal_session_bindings()
        .register_at_with_metadata(
            "pane-active",
            "session-active",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-active".to_owned()),
                target_ref: Some("ssh:host-active".to_owned()),
                target_kind: Some("ssh".to_owned()),
                remote_host_id: Some("host-active".to_owned()),
                profile_id: None,
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
            }),
            1,
        )
        .expect("register binding");
    let ready = state
        .terminal_session_bindings()
        .ready_at("pane-active", "session-active", 2)
        .expect("ready binding")
        .expect("registered binding");
    let executor = Arc::new(RecordingExecutor::default());
    let service = AiAgentService::with_executor(executor.clone());

    let error = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            message: "解释最近输出".to_owned(),
            terminal_context: Some(AiTerminalContextRequest {
                session_id: "session-active".to_owned(),
                pane_id: Some("pane-active".to_owned()),
                pane_title: Some("活跃 pane".to_owned()),
                tab_id: Some("tab-active".to_owned()),
                tab_title: Some("活跃 tab".to_owned()),
                machine_id: Some("host-stale".to_owned()),
                machine_name: Some("Stale host".to_owned()),
                machine_kind: Some("ssh".to_owned()),
                max_output_bytes: Some(4096),
            }),
            ..Default::default()
        },
    ))
    .expect_err("mismatched target metadata should fail in strict chat mode");

    assert!(error
        .to_string()
        .contains("终端 pane 绑定的 targetRef 已变化"));
    assert!(executor.requests().is_empty());
    let events = state
        .terminal_session_bindings()
        .events()
        .expect("binding events");
    assert!(events.iter().any(|event| {
        event.kind == TerminalSessionBindingEventKind::SnapshotRejected
            && event.pane_id.as_deref() == Some("pane-active")
            && event.session_id.as_deref() == Some("session-active")
    }));
    let binding = state
        .terminal_session_bindings()
        .active_binding_for_pane("pane-active")
        .expect("query active binding")
        .expect("binding remains active");
    assert!(binding.generation > ready.generation);
    assert_eq!(
        binding.last_snapshot_status,
        Some(TerminalSessionSnapshotStatus::Rejected)
    );
}

fn wait_for_output(
    manager: &kerminal_lib::services::terminal_manager::TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
            if event.data.contains("\u{1b}[6n") {
                manager.write(session_id, "\u{1b}[1;1R").unwrap();
            }
        }

        if received.contains(expected) {
            return;
        }
    }

    panic!("expected PTY output to contain {expected:?}, got: {received:?}");
}

#[cfg(target_os = "windows")]
fn local_profile_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec![
            "/C".to_owned(),
            "echo kerminal-local-profile-context".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn local_profile_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            "printf 'kerminal-local-profile-context\\n'".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[test]
fn current_workspace_context_strategy_degrades_metadata_mismatch_and_calls_executor() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(
        &state,
        &credentials,
        "workspace-metadata-mismatch",
        LlmContextStrategy::CurrentWorkspace,
    );
    state
        .terminal_session_bindings()
        .register_at_with_metadata(
            "pane-active",
            "session-active",
            Some(TerminalSessionBindingMetadata {
                tab_id: Some("tab-active".to_owned()),
                target_ref: Some("ssh:host-active".to_owned()),
                target_kind: Some("ssh".to_owned()),
                remote_host_id: Some("host-active".to_owned()),
                profile_id: None,
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
            }),
            1,
        )
        .expect("register binding");
    let ready = state
        .terminal_session_bindings()
        .ready_at("pane-active", "session-active", 2)
        .expect("ready binding")
        .expect("registered binding");
    let executor = Arc::new(RecordingExecutor::default());
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            message: "解释最近输出".to_owned(),
            terminal_context: Some(AiTerminalContextRequest {
                session_id: "session-active".to_owned(),
                pane_id: Some("pane-active".to_owned()),
                pane_title: Some("活跃 pane".to_owned()),
                tab_id: Some("tab-active".to_owned()),
                tab_title: Some("活跃 tab".to_owned()),
                machine_id: Some("host-stale".to_owned()),
                machine_name: Some("Stale host".to_owned()),
                machine_kind: Some("ssh".to_owned()),
                max_output_bytes: Some(4096),
            }),
            ..Default::default()
        },
    ))
    .expect("workspace context should degrade and continue");

    assert!(!response.context_used);
    assert_eq!(executor.requests().len(), 1);
    let events = state
        .terminal_session_bindings()
        .events()
        .expect("binding events");
    assert!(events.iter().any(|event| {
        event.kind == TerminalSessionBindingEventKind::SnapshotDegraded
            && event.pane_id.as_deref() == Some("pane-active")
            && event.session_id.as_deref() == Some("session-active")
    }));
    let binding = state
        .terminal_session_bindings()
        .active_binding_for_pane("pane-active")
        .expect("query active binding")
        .expect("binding remains active");
    assert!(binding.generation > ready.generation);
    assert_eq!(
        binding.last_snapshot_status,
        Some(TerminalSessionSnapshotStatus::Degraded)
    );
}
