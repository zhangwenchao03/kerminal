//! External SSH launch compatibility layer.
//!
//! @author kongweiguang

pub mod alias;
pub mod bridge;
pub mod classifier;
pub mod deep_link;
pub(crate) mod destination;
pub mod host_identity;
pub mod intake;
pub mod materializer;
pub mod model;
pub mod parser;
pub(crate) mod parsers;
pub(crate) mod redaction;
pub mod secret;
pub mod shim;
pub(crate) mod ssh_url;
pub mod task_registry;

pub use alias::{
    default_external_launch_alias_directory, delete_external_launch_aliases,
    external_launch_alias_file_name, external_launch_alias_marker_path, external_launch_alias_path,
    generate_external_launch_aliases, inspect_external_launch_alias,
    ExternalLaunchAliasGenerateRequest, ExternalLaunchAliasInspection,
    ExternalLaunchAliasInstallMode, ExternalLaunchAliasRemoval, ExternalLaunchAliasState,
    ExternalLaunchAliasSummary, EXTERNAL_LAUNCH_ALIAS_TOOLS,
};
pub use bridge::{
    direct_parent_command_line_for_args, direct_parent_command_line_for_args_bounded,
    external_launch_bridge_endpoint, run_external_launch_bridge_server,
    send_external_launch_bridge_envelope, ExternalLaunchBridgeDiagnostics,
    ExternalLaunchBridgeEndpoint, ExternalLaunchBridgeEnvelope, ExternalLaunchBridgeEventSink,
    ExternalLaunchBridgeResponse, EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION,
};
pub use deep_link::{
    accept_external_launch_protocol_args, accept_external_launch_protocol_args_bounded,
    external_launch_protocol_url_from_args, EXTERNAL_LAUNCH_DEEP_LINK_SCHEME,
};
pub use host_identity::{
    inspect_external_host_key, inspection_for_key, inspection_for_preprovisioned_route,
    trust_external_host_key, ExternalHostKeyInspection, ExternalHostKeyStatus,
};
pub use intake::{
    ExternalLaunchAcceptOutcome, ExternalLaunchEventKind, ExternalLaunchEventPayload,
    ExternalLaunchIntake, ExternalLaunchIntakeSnapshot, ExternalLaunchNoop, ExternalLaunchPolicy,
    ExternalLaunchQueued, ExternalLaunchRejected, ExternalLaunchTargetSummary,
    EXTERNAL_SSH_LAUNCH_EVENT,
};
pub use materializer::{
    external_launch_id_from_target_id, external_target_id, external_target_safety_for_saved_hosts,
    is_external_target_id, ExternalMaterializedTarget, ExternalMaterializerSnapshot,
    ExternalSessionMaterializer, ExternalTargetSafety,
};
pub use model::{
    ExternalLaunchEntrypoint, ExternalLaunchParseInput, ExternalLaunchRequestDiagnostics,
    ExternalLaunchSource, ExternalLaunchSourceTool, ExternalSecretKind, ExternalSecretMaterial,
    ExternalSecretSlot, ExternalSecretSource, ExternalSessionSecretRef, ExternalSshAuth,
    ExternalSshLaunchOptions, ExternalSshLaunchRequest, ExternalSshRouteHop, ExternalSshTarget,
};
pub use parser::{ExternalLaunchParser, ExternalLaunchParserRegistry};
pub use secret::{ExternalLaunchSecretBroker, ExternalLaunchSecretBrokerSnapshot};
pub use shim::{
    build_external_launch_shim_envelope, infer_shim_persona, resolve_kerminal_main_executable,
    KERMINAL_MAIN_EXE_ENV, KERMINAL_SHIM_PERSONA_ALIAS_ARG, KERMINAL_SHIM_PERSONA_ARG,
    KERMINAL_SHIM_PERSONA_ENV,
};
pub use task_registry::{
    ExternalLaunchTaskCancellation, ExternalLaunchTaskRegistry, ExternalLaunchTaskSnapshot,
    ExternalLaunchTaskStage,
};
