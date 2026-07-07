//! External SSH launch compatibility layer.
//!
//! @author kongweiguang

pub mod alias;
pub mod bridge;
pub mod classifier;
pub(crate) mod destination;
pub mod intake;
pub mod materializer;
pub mod model;
pub mod parser;
pub(crate) mod parsers;
pub(crate) mod redaction;
pub mod secret;
pub mod shim;
pub(crate) mod ssh_url;

pub use alias::{
    default_external_launch_alias_directory, delete_external_launch_aliases,
    external_launch_alias_file_name, external_launch_alias_marker_path, external_launch_alias_path,
    generate_external_launch_aliases, inspect_external_launch_alias,
    ExternalLaunchAliasGenerateRequest, ExternalLaunchAliasInspection,
    ExternalLaunchAliasInstallMode, ExternalLaunchAliasRemoval, ExternalLaunchAliasState,
    ExternalLaunchAliasSummary, EXTERNAL_LAUNCH_ALIAS_TOOLS,
};
pub use bridge::{
    direct_parent_command_line_for_args, external_launch_bridge_endpoint,
    run_external_launch_bridge_server, send_external_launch_bridge_envelope,
    ExternalLaunchBridgeDiagnostics, ExternalLaunchBridgeEndpoint, ExternalLaunchBridgeEnvelope,
    ExternalLaunchBridgeEventSink, ExternalLaunchBridgeResponse,
    EXTERNAL_LAUNCH_BRIDGE_SCHEMA_VERSION,
};
pub use intake::{
    ExternalLaunchAcceptOutcome, ExternalLaunchEventKind, ExternalLaunchEventPayload,
    ExternalLaunchIntake, ExternalLaunchIntakeSnapshot, ExternalLaunchNoop, ExternalLaunchPolicy,
    ExternalLaunchQueued, ExternalLaunchRejected, ExternalLaunchTargetSummary,
    EXTERNAL_SSH_LAUNCH_EVENT,
};
pub use materializer::{
    external_target_id, is_external_target_id, ExternalMaterializedTarget,
    ExternalMaterializerSnapshot, ExternalSessionMaterializer,
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
