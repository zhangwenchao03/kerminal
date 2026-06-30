//! External agent workspace file preparation.
//!
//! @author kongweiguang

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::BTreeMap,
    env,
    ffi::OsString,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use std::{
    process::{Command, Stdio},
    sync::OnceLock,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::agent_session::{
        AgentId, AgentProvider, AgentProviderSession, AgentSessionId, AgentTargetBindingContext,
        AgentTargetBindingContextBinding, AgentTargetBindingStatus, AgentTerminalSnapshotContext,
        AGENT_SESSION_SCHEMA_VERSION,
    },
    services::agent_session_file_store::AgentSessionFileStore,
};

const DEFAULT_MCP_ENDPOINT: &str = "http://127.0.0.1:37657/mcp";
const MANAGED_BLOCK_START: &str = "<!-- KERMINAL_EXTERNAL_AGENT_START -->";
const MANAGED_BLOCK_END: &str = "<!-- KERMINAL_EXTERNAL_AGENT_END -->";
const CONFIG_REFERENCE_FILE_NAME: &str = "kerminal-config.md";
const CONFIG_VALIDATOR_TOOL_ID: &str = "kerminal.config.validate";
const AGENT_SESSION_TERMINAL_SNAPSHOT_BYTES: usize = 24 * 1024;
#[cfg(windows)]
const WINDOWS_AGENT_PWSH: &str = "pwsh.exe";
#[cfg(windows)]
const WINDOWS_AGENT_POWERSHELL: &str = "powershell.exe";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
pub(crate) const CONFIG_REFERENCE_BODY: &str = r#"<!-- @author kongweiguang -->

# Kerminal Configuration Guide

Read this file before editing Kerminal configuration. Do not guess field names or relationships from filenames alone.

## Workspace Layout

```text
~/.kerminal/
  AGENTS.md
  CLAUDE.md
  kerminal-config.md
  .codex/config.toml
  .mcp.json
  settings.toml
  profiles/*.toml
  hosts/groups.toml
  hosts/*.toml
  snippets/*.toml
  workflows/*.toml
  data/command.sqlite
  data/port-forwards/
  logs/
  cache/
  exports/
  temp/
  secrets/vault.toml
  secrets/vault-key.toml
```

## Cross-platform Paths

- `~/.kerminal` means the current user's Kerminal root on Windows, macOS, and Linux. Do not replace it with a machine-specific path such as `C:/Users/...`, `/Users/...`, or `/home/...` unless the user explicitly asks for an absolute path.
- `~/.ssh/id_ed25519` is valid for local SSH/SFTP private key paths. Kerminal expands `~`, `~/...`, and `~\...` to the current user's home directory before passing the path to OpenSSH, russh, or SFTP.
- Do not use `~otheruser/...`; Kerminal only expands the current user's home notation.
- Prefer portable examples in docs and generated config. Use platform-specific shells only inside profile examples.

## Edit Protocol

1. Identify whether the request changes settings, a terminal profile, a host, a host group, a snippet, or a workflow.
2. Use precise search for an id, name, host, tag, or field. Do not reformat every TOML file.
3. Preserve `schema_version = 1`, comments, unknown fields, timestamps, and sort order unless the request needs them changed.
4. Keep each file relationship valid: host `group_id` must reference `hosts/groups.toml`; file names must match `id`; workflow step ids must be unique.
5. Do not write passwords, inline private keys, key passphrases, tokens, or other plaintext secrets to ordinary TOML files. Do not read or edit `secrets/` unless the user explicitly asks for credential work.
6. After edits, call MCP tool `kerminal.config.validate` with `scope = "all"` or the narrowest matching scope. If Kerminal MCP is unavailable, manually check the rules below and tell the user validation was manual only.

## Validation

- Preferred validation path: call MCP tool `kerminal.config.validate`.
- Use `scope = "all"` for cross-file edits, or one of `settings`, `profiles`, `hosts`, `snippets`, `workflows` for narrow edits.
- The tool is read-only. It validates the current runtime workspace through Kerminal's own TOML loaders and relationship checks; it does not edit config files and does not require Node.js or a source checkout.
- If the MCP server is unavailable, manually check schema versions, file ids, group references, explicit host `production`, workflow step ids, sort order, forbidden secret-like keys, and host secret field names before reporting success.

## Runtime MCP Boundaries

Use Kerminal MCP for live app features that require the running application or saved connection context: app guide, tool help, terminal sessions, SSH commands, SFTP files, tmux sessions, containers, port forwarding, server info, command history, diagnostics, runtime snapshot, and authorized credential saving.

Use `kerminal.app_guide` when an external Agent needs the Kerminal product/UI structure map before choosing lower-level tools. It explains the machine sidebar, terminal workspace, right tool panel, Agent Launcher, configuration workspace, and matching MCP tool families; it does not perform UI choreography.

Use `kerminal.config_guide` when an external Agent needs these generated configuration rules through MCP, especially when it was not launched inside the initialized `~/.kerminal` workspace. It returns the same guide content as `kerminal-config.md` and does not perform config CRUD.

Use `kerminal.tool_help` with `toolId`, `family`, or `query` when an external Agent needs exact input schema, example arguments, safety annotations, and deliberately absent-tool guidance for one tool or tool family.

Container runtime tools include lifecycle/status tools and container file tools. Use `container.files.list` and `container.files.preview` before editing; use `container.files.write_text`, `container.files.upload`, `container.files.download`, `container.files.create_directory`, `container.files.rename`, `container.files.chmod`, and `container.files.delete` only for explicitly requested container file work. `container.files.delete` is destructive and depends on MCP host approval/audit.

Do not look for MCP CRUD tools for `settings.*`, `profile.*`, `remote_host.*`, `snippet.*`, `workflow.*`, or `workspace.*`; those configuration changes are direct file edits plus `kerminal.config.validate`.

## Runtime Auto-refresh

When Kerminal is running, it watches file-backed configuration and refreshes the UI after external Agent, editor, or script edits settle. Valid changes to `settings.toml`, `profiles/*.toml`, `hosts/groups.toml`, `hosts/*.toml`, `snippets/*.toml`, and `workflows/*.toml` are reloaded from the same typed runtime loaders used by validation.

Successful external refreshes show a concise auto-closing notice such as `cfg: +1 host "staging-api"`, `cfg: hosts +2, snippets +1`, or `cfg: settings reloaded`. Notices are generated from public UI state only. They must not expose local absolute paths, raw TOML values, passwords, private keys, tokens, or secret filenames.

If a save leaves TOML temporarily invalid, Kerminal keeps the last-known-good UI, does not clear the host tree, and does not close existing terminals. It may show `cfg: invalid TOML, kept last-known-good`; fix the file and save again. Auto-refresh is user feedback, not validation. Always run `kerminal.config.validate` before reporting success.

## File Relationships

| File | Purpose | Relationship |
| --- | --- | --- |
| `settings.toml` | App appearance, terminal appearance, keybindings, SFTP performance | Standalone; business ranges are validated by Kerminal. |
| `profiles/*.toml` | Local terminal launch profiles | Filename must be `<id>.toml`; optional `sidebar_group_id` pins the profile into an existing host group in the left sidebar. |
| `hosts/groups.toml` | Host groups and ordering | `groups[].id` is referenced by host `group_id`; `__ungrouped__` is runtime-only and must not be written. |
| `hosts/*.toml` | Host metadata for SSH/Telnet/Serial/RDP/container targets | Filename must be `<id>.toml`; saved secret values are referenced by `secret_ref` / `key_passphrase_ref` and encrypted in the vault. |
| `snippets/*.toml` | Reusable single commands | Filename must be `<id>.toml`; `scope` is `any`, `local`, or `ssh`. |
| `workflows/*.toml` | Multi-step command workflows | Filename must be `<id>.toml`; `[[steps]]` are stored in the same file and sorted by `sort_order`. |
| `data/command.sqlite` | Command history and suggestion data | Do not edit directly. Use MCP `history.search` to read history. |
| `secrets/vault.toml` | Encrypted SSH passwords, inline private keys, key passphrases, and jump-host secrets | Do not edit directly; save credentials through the UI or Kerminal credential tools. |
| `secrets/vault-key.toml` | Local workspace vault key | Must stay local and ignored by Git; do not copy it into chat, docs, logs, or commits. |

## Common Rules

- Ordinary TOML files use top-level `schema_version = 1`.
- Wrapper fields use snake_case: `schema_version`, `group_id`, `sidebar_group_id`, `auth_type`, `sort_order`, `created_at`, `updated_at`, `ssh_options`, `requires_confirmation`.
- `settings.toml` business fields follow the app settings model and often use camelCase, for example `themeMode` and `interfaceDensity`. Preserve existing settings field spelling.
- IDs should be stable ASCII identifiers using letters, numbers, `.`, `_`, or `-`.
- Sort fields are numeric and drive UI order. Prefer increments such as `10`, `20`, `30`.
- Timestamps are strings. Preserve existing values unless creating or intentionally updating an entry.
- Never add plaintext keys such as `password`, `credential_secret`, `inline_private_key`, `apiKey`, `privateKey`, `key_passphrase`, or `token` to ordinary config files. `secret_ref` and `key_passphrase_ref` are encrypted vault references, not plaintext.
- Do not edit `secrets/vault*.toml` directly. Save or replace SSH passwords, inline private keys, key passphrases, and jump-host secrets through the UI save flow, `kerminal.host.upsert_with_credential`, or `kerminal.vault.encrypt_secret`.

## Required Field Matrix

These fields must be present when an Agent creates or rewrites a file. Agent-authored files must be explicit.

| File | Required fields |
| --- | --- |
| `settings.toml` | `schema_version` plus documented settings fields being changed. |
| `profiles/*.toml` | `schema_version`, `id`, `name`, `shell`, `is_default`, `sort_order`, `created_at`, `updated_at`. |
| `hosts/groups.toml` | `schema_version`; each `[[groups]]` entry needs `id`, `name`, `sort_order`, `created_at`, `updated_at`. |
| `hosts/*.toml` | `schema_version`, `id`, `name`, `host`, `port`, `username`, `auth_type`, `tags`, `production`, `sort_order`, `created_at`, `updated_at`; saved password or inline-private-key hosts also need `secret_ref`, key passphrases use `key_passphrase_ref`, and jump-host secrets use `[[ssh_options.jump_hosts]].secret_ref`; all references are generated by the save flow. |
| `snippets/*.toml` | `schema_version`, `id`, `title`, `command`, `scope`, `sort_order`, `created_at`, `updated_at`. |
| `workflows/*.toml` | `schema_version`, `id`, `title`, `scope`, `sort_order`, `created_at`, `updated_at`; each `[[steps]]` needs `id`, `title`, `command`, `requires_confirmation`, `sort_order`, `created_at`, `updated_at`. |

Use string timestamps such as `"1"` only for examples. Preserve real timestamp strings in existing files.

## Common Change Recipes

Create a host group:

1. Edit `hosts/groups.toml`.
2. Append one `[[groups]]` entry with `id`, `name`, `sort_order`, `created_at`, and `updated_at`.
3. Do not use `groups` or `__ungrouped__` as an id.
4. Validate with `kerminal.config.validate` using `scope = "hosts"`.

Create a local profile:

1. Create `profiles/<id>.toml`.
2. Fill `id`, `name`, `shell`, `args`, `cwd`, `is_default`, `sort_order`, `created_at`, and `updated_at`.
3. Add `sidebar_group_id` only when the profile should appear in the left host tree; the group must exist in `hosts/groups.toml`.
4. Do not put secrets in `[env]`.

Create a snippet:

1. Create `snippets/<id>.toml`.
2. Fill `title`, `command`, `scope`, `sort_order`, `created_at`, and `updated_at`.
3. Use `scope = "any"` for cross-target commands, `local` for local-only commands, or `ssh` for SSH commands.
4. Do not put passwords, tokens, or private keys in `command`.

Create a workflow:

1. Create `workflows/<id>.toml`.
2. Fill workflow metadata first, then add `[[steps]]` entries in execution order.
3. Every step needs a unique `id`; `sort_order` must increase in file order.
4. Set `requires_confirmation = true` for dangerous local workflow steps. This is UI policy, not an MCP approval queue.

Save a host password or inline private key:

1. Only do this when the user explicitly asks for credential work.
2. Use the Kerminal UI save flow or call `kerminal.host.upsert_with_credential` / `kerminal.vault.encrypt_secret`; do not edit `secrets/vault*.toml` directly.
3. Confirm the matching `hosts/<id>.toml` references the generated `secret_ref` / `key_passphrase_ref` and contains no `credential_secret`, `password`, `inline_private_key`, key passphrase, or private key body.
4. Validate with `kerminal.config.validate` using `scope = "hosts"` or `scope = "all"`.

## settings.toml

Purpose: app appearance, terminal appearance, keybindings, SFTP performance, and low-frequency preferences.

Minimal example:

```toml
schema_version = 1
themeMode = "dark"
interfaceDensity = "comfortable"
```

Known settings groups:

- `themeMode`: `dark`, `light`, or `system`.
- `interfaceDensity`: `compact`, `comfortable`, or `spacious`.
- `[appearance]`: background image path, background opacity, window opacity, interface language.
- `[terminal]`: font family, font size, line height, scrollback, cursor, color scheme, inline suggestion settings.
- `[[keybindings]]`: keyboard shortcuts.
- `[sftp]`: transfer concurrency, timeout, packet size, pipeline depth.

Do not invent settings fields. If a field is not already present and is not documented here, inspect the current Kerminal settings model or ask the user.

## profiles/*.toml

Purpose: local terminal profile.

macOS/Linux example:

```toml
schema_version = 1
id = "default-zsh"
name = "zsh"
shell = "zsh"
args = ["-l"]
cwd = "~/.kerminal"
is_default = true
sort_order = 10
created_at = "1"
updated_at = "1"

[env]
RUST_LOG = "info"
```

Windows example:

```toml
schema_version = 1
id = "default-pwsh"
name = "PowerShell"
shell = "pwsh"
args = ["-NoLogo"]
cwd = "~/.kerminal"
is_default = true
sort_order = 20
created_at = "1"
updated_at = "1"
```

Fields:

- `id`: stable profile id and filename stem.
- `name`: user-visible name.
- `shell`: executable or shell command.
- `args`: default arguments. Common examples are `["-l"]` for `zsh` on macOS/Linux and `["-NoLogo"]` for PowerShell on Windows.
- `cwd`: default working directory; `~/.kerminal` is portable across Windows, macOS, and Linux. Omit or set null when inheriting app cwd.
- `[env]`: environment overrides. Do not put tokens or passwords here.
- `is_default`: default local terminal profile flag.
- `sidebar_group_id`: optional host group id. Set it only when this local profile should appear as a saved left-sidebar connection; the value must exist in `hosts/groups.toml`.
- `sort_order`, `created_at`, `updated_at`: UI ordering and metadata.

## hosts/groups.toml

Purpose: host group names and ordering.

```toml
schema_version = 1

[[groups]]
id = "prod"
name = "Production"
sort_order = 10
created_at = "1"
updated_at = "1"
```

Rules:

- `groups[].id` must be unique.
- Host `group_id` values must either be absent/empty or reference one of these ids.
- Do not write `__ungrouped__`; Kerminal uses it only at runtime.

## hosts/*.toml

Purpose: ordinary host metadata. Credentials and inline private keys are not stored here.

```toml
schema_version = 1
id = "prod-web-01"
group_id = "prod"
name = "prod-web-01"
host = "10.0.0.10"
port = 22
username = "deploy"
auth_type = "key"
credential_ref = "~/.ssh/id_ed25519"
secret_ref = "credential:kerminal:ssh-host:prod-web-01:target:private-key:v1"
key_passphrase_ref = "credential:kerminal:ssh-host:prod-web-01:target:key-passphrase:v1"
tags = ["prod", "web"]
production = true
sort_order = 10
created_at = "1"
updated_at = "1"

[ssh_options.proxy]
protocol = "none"

[[ssh_options.jump_hosts]]
index = 0
host = "jump.example.com"
port = 22
username = "deploy"
auth_type = "password"
secret_ref = "credential:kerminal:jump-host:prod-web-01:jump-0:password:v1"
```

Fields:

- `id`: stable host id and filename stem.
- `group_id`: optional group id from `hosts/groups.toml`.
- `name`: user-visible host name.
- `host`: DNS name, IP, serial endpoint, or target host value depending on target type.
- `port`: target port when applicable.
- `username`: login username when applicable.
- `auth_type`: `password`, `key`, or `agent`.
- `credential_ref`: path or reference for key-based auth. For local private key files, `~/.ssh/id_ed25519` is portable and Kerminal expands it to the current user's home directory. This is not the secret body.
- `secret_ref`: encrypted vault reference for a saved password or inline private key. Top-level `secret_ref` belongs to the target host; `[[ssh_options.jump_hosts]].secret_ref` belongs to that jump host.
- `key_passphrase_ref`: encrypted vault reference for a private-key passphrase.
- `tags`: user labels.
- `production`: marks a production host for host-side confirmation policy. New host files should set this explicitly; if omitted, Kerminal treats it as `false`.
- `ssh_options`: proxy, tunnel, jump host, terminal, and transfer settings. Preserve existing nested tables unless the request targets them.

Rules:

- `production` is required for Agent-authored host files. Use `true` for production or safety-sensitive hosts and `false` for ordinary dev/test/local targets. Do not omit it.
- Do not put `credential_secret`, `password`, `inline_private_key`, private key bodies, key passphrases, API keys, or tokens here.
- Passwords, inline keys, key passphrases, and jump-host secrets are encrypted in `secrets/vault.toml`; ordinary host files only keep `secret_ref` / `key_passphrase_ref`.

Host creation checklist:

1. Read `hosts/groups.toml` and choose an existing `group_id`, or omit `group_id` for the runtime ungrouped bucket. Never write `__ungrouped__`.
2. Pick a stable ASCII `id` and create `hosts/<id>.toml`; the filename stem and `id` must match exactly.
3. Fill every required host field, including `production = true` or `production = false`.
4. Use `auth_type = "agent"` when relying on ssh-agent; use `auth_type = "key"` with `credential_ref = "~/.ssh/id_ed25519"` for a local key path; use `auth_type = "password"` only for metadata and do not write the password in this file.
5. For saved passwords, inline private keys, key passphrases, or jump-host secrets, use the UI save flow or authorized credential tools and verify that only `secret_ref` / `key_passphrase_ref` landed in host TOML.
6. Preserve or add `[ssh_options.*]` only when the user requested proxy, tunnels, jump hosts, terminal, or transfer behavior.
7. Call `kerminal.config.validate` with `scope = "hosts"` or `scope = "all"` and fix every diagnostic before reporting success.

Common host failures:

- File exists but app does not show it: check `id` versus filename, TOML parse errors, missing required fields, and validator diagnostics.
- Host appears in wrong group: check `group_id` references an id in `hosts/groups.toml`; `__ungrouped__` must not be written.
- Login still asks for credentials: ordinary host TOML intentionally does not store password, inline key, or key passphrase plaintext. Credential work requires explicit user instruction and the UI/vault save flow so valid `secret_ref` / `key_passphrase_ref` references exist.
- Validator passes manually but app behaves differently: rerun MCP `kerminal.config.validate` because it uses Kerminal runtime loaders.

## secrets/vault.toml and secrets/vault-key.toml

Purpose: encrypted credentials for saved SSH hosts, jump hosts, inline private keys, and key passphrases. Do not read or edit these files unless the user explicitly asks for credential work.

Rules:

- `secrets/vault.toml` stores encrypted entries referenced by `secret_ref` / `key_passphrase_ref` in host TOML.
- `secrets/vault-key.toml` is the local workspace key and must stay out of Git.
- Do not hand-write ciphertext, keys, passwords, or private key bodies in these files. Use the UI save flow or Kerminal credential tools.
- Do not copy secret values into chat, docs, logs, tests, or ordinary config files.
- Ensure `.gitignore` keeps `secrets/vault-key.toml` local before syncing a Kerminal workspace.

## snippets/*.toml

Purpose: reusable command snippets.

```toml
schema_version = 1
id = "restart-service"
title = "Restart service"
description = "Restart app service"
command = "systemctl restart app"
tags = ["systemd"]
scope = "ssh"
sort_order = 10
created_at = "1"
updated_at = "1"
```

Fields:

- `scope`: `any`, `local`, or `ssh`.
- `command`: command text. Do not embed passwords, tokens, or private keys.

## workflows/*.toml

Purpose: multi-step command workflows. Workflow metadata and steps are stored in one file.

```toml
schema_version = 1
id = "deploy-check"
title = "Deploy check"
description = "Check service before deploy"
tags = ["deploy"]
scope = "ssh"
sort_order = 10
created_at = "1"
updated_at = "1"

[[steps]]
id = "check-disk"
title = "Check disk"
description = "Show disk usage"
command = "df -h"
scope = "ssh"
requires_confirmation = false
sort_order = 10
created_at = "1"
updated_at = "1"
```

Rules:

- Workflow `scope` and step `scope` are `any`, `local`, or `ssh`.
- Step `scope` may be omitted/null to inherit workflow intent.
- Step ids must be unique inside the workflow file.
- Step `sort_order` should increase in file order.
- Use `requires_confirmation = true` for dangerous workflow steps. This is local workflow UI policy, not MCP pending/approval.
"#;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrepareExternalAgentWorkspaceRequest {
    pub agent_id: String,
    #[serde(default)]
    pub agent_session_id: Option<String>,
    #[serde(default)]
    pub custom_command: Option<String>,
    #[serde(default)]
    pub resume_provider_session: bool,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub overwrite_policy: ExternalAgentOverwritePolicy,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalAgentOverwritePolicy {
    #[default]
    BackupAndReplaceInvalid,
    PreserveUserContent,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentLaunchSpec {
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_session_id: Option<String>,
    pub title: String,
    pub shell: String,
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<BTreeMap<String, String>>,
    pub message: String,
    pub dry_run: bool,
    pub operations: Vec<ExternalAgentFileOperation>,
    pub validator: ExternalAgentValidatorStatus,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentWorkspaceStatus {
    pub workspace_dir: String,
    pub mcp_endpoint: String,
    pub mcp_server_running: bool,
    pub agents: ExternalAgentStatuses,
    pub validator: ExternalAgentValidatorStatus,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentStatuses {
    pub codex: ExternalAgentStatus,
    pub claude: ExternalAgentStatus,
    pub custom: ExternalAgentStatus,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentStatus {
    pub id: String,
    pub title: String,
    pub cli_command: String,
    pub installed: bool,
    pub config_ready: bool,
    pub config_path: String,
    pub status_detail: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentValidatorStatus {
    pub available: bool,
    pub command: String,
    pub detail: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentFileOperation {
    pub path: String,
    pub action: ExternalAgentFileAction,
    pub changed: bool,
    pub dry_run: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalAgentFileAction {
    Created,
    Updated,
    Unchanged,
}

#[derive(Debug, Clone)]
struct WorkspaceWriteOptions {
    dry_run: bool,
    overwrite_policy: ExternalAgentOverwritePolicy,
}

impl WorkspaceWriteOptions {
    fn from_request(request: &PrepareExternalAgentWorkspaceRequest) -> Self {
        Self {
            dry_run: request.dry_run,
            overwrite_policy: request.overwrite_policy.clone(),
        }
    }

    fn write_default() -> Self {
        Self {
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        }
    }
}

#[derive(Debug)]
struct WorkspaceTextPlan {
    path: PathBuf,
    next: String,
    current: Option<String>,
    current_snippet: Option<String>,
    next_snippet: String,
    reason: String,
}

#[derive(Debug, Clone)]
struct AgentSessionWorkspaceContext {
    agent_id: String,
    agent_session_id: String,
    session_root: PathBuf,
    mcp_endpoint: String,
}

#[derive(Debug, Clone)]
pub struct ExternalAgentWorkspaceService {
    workspace_dir: PathBuf,
    mcp_endpoint: String,
    mcp_server_running: bool,
}

impl ExternalAgentWorkspaceService {
    pub fn new(
        workspace_dir: impl Into<PathBuf>,
        mcp_endpoint: Option<String>,
        mcp_server_running: bool,
    ) -> Self {
        Self {
            workspace_dir: workspace_dir.into(),
            mcp_endpoint: mcp_endpoint.unwrap_or_else(|| DEFAULT_MCP_ENDPOINT.to_owned()),
            mcp_server_running,
        }
    }

    pub fn status(&self) -> ExternalAgentWorkspaceStatus {
        ExternalAgentWorkspaceStatus {
            workspace_dir: path_to_string(&self.workspace_dir),
            mcp_endpoint: self.mcp_endpoint.clone(),
            mcp_server_running: self.mcp_server_running,
            agents: ExternalAgentStatuses {
                codex: self.agent_status("codex", "Codex", "codex", self.codex_config_path()),
                claude: self.agent_status("claude", "Claude", "claude", self.claude_config_path()),
                custom: self.custom_agent_status(),
            },
            validator: self.validator_status(),
        }
    }

    pub fn ensure_default_agent_files(&self) -> AppResult<()> {
        fs::create_dir_all(&self.workspace_dir)?;
        let options = WorkspaceWriteOptions::write_default();
        self.prepare_codex_files(&options)?;
        self.prepare_claude_files(&options)?;
        Ok(())
    }

    pub fn prepare(
        &self,
        request: &PrepareExternalAgentWorkspaceRequest,
    ) -> AppResult<ExternalAgentLaunchSpec> {
        if let Some(agent_session_id) = request
            .agent_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return self.prepare_agent_session_workspace(request, agent_session_id);
        }

        let options = WorkspaceWriteOptions::from_request(request);
        if !options.dry_run {
            fs::create_dir_all(&self.workspace_dir)?;
        }
        let agent_id = request.agent_id.trim();

        match agent_id {
            "codex" => {
                let operations = self.prepare_codex_files(&options)?;
                let (shell, args) = agent_launch_command("codex");
                Ok(ExternalAgentLaunchSpec {
                    agent_id: "codex".to_owned(),
                    agent_session_id: None,
                    title: "Codex".to_owned(),
                    shell,
                    args,
                    cwd: path_to_string(&self.workspace_dir),
                    env: None,
                    message: if options.dry_run {
                        "Codex workspace file changes were previewed.".to_owned()
                    } else {
                        "Codex workspace files are ready.".to_owned()
                    },
                    dry_run: options.dry_run,
                    operations,
                    validator: self.validator_status(),
                })
            }
            "claude" => {
                let operations = self.prepare_claude_files(&options)?;
                let (shell, args) = agent_launch_command("claude");
                Ok(ExternalAgentLaunchSpec {
                    agent_id: "claude".to_owned(),
                    agent_session_id: None,
                    title: "Claude".to_owned(),
                    shell,
                    args,
                    cwd: path_to_string(&self.workspace_dir),
                    env: None,
                    message: if options.dry_run {
                        "Claude workspace file changes were previewed.".to_owned()
                    } else {
                        "Claude workspace files are ready.".to_owned()
                    },
                    dry_run: options.dry_run,
                    operations,
                    validator: self.validator_status(),
                })
            }
            "custom" => {
                let command = request
                    .custom_command
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| {
                        AppError::InvalidInput(
                            "Custom agent command is not configured. Enter a command before launch."
                                .to_owned(),
                        )
                    })?;
                let (shell, args) = agent_launch_command(&command);
                Ok(ExternalAgentLaunchSpec {
                    agent_id: "custom".to_owned(),
                    agent_session_id: None,
                    title: "Custom Agent".to_owned(),
                    shell,
                    args,
                    cwd: path_to_string(&self.workspace_dir),
                    env: None,
                    message: "Custom agent workspace is ready.".to_owned(),
                    dry_run: options.dry_run,
                    operations: Vec::new(),
                    validator: self.validator_status(),
                })
            }
            other => Err(AppError::InvalidInput(format!(
                "Unsupported external agent: {other}"
            ))),
        }
    }

    pub fn prepare_agent_session_workspace(
        &self,
        request: &PrepareExternalAgentWorkspaceRequest,
        agent_session_id: &str,
    ) -> AppResult<ExternalAgentLaunchSpec> {
        let options = WorkspaceWriteOptions::from_request(request);
        let agent_id = request.agent_id.trim();
        let context = self.agent_session_context(agent_id, agent_session_id)?;

        if !options.dry_run {
            fs::create_dir_all(&self.workspace_dir)?;
            fs::create_dir_all(&context.session_root)?;
        }

        match agent_id {
            "codex" => {
                let mut operations = self.prepare_codex_files(&options)?;
                operations
                    .extend(self.prepare_agent_session_common_files(&context, true, &options)?);
                operations.extend(self.prepare_agent_session_provider_files(&context, &options)?);
                let (_command_label, shell, args) = self.agent_session_launch_command(
                    AgentId::Codex,
                    "codex",
                    &context,
                    request.resume_provider_session,
                    &options,
                )?;
                Ok(ExternalAgentLaunchSpec {
                    agent_id: "codex".to_owned(),
                    agent_session_id: Some(context.agent_session_id.clone()),
                    title: "Codex".to_owned(),
                    shell,
                    args,
                    cwd: path_to_string(&context.session_root),
                    env: Some(self.agent_session_env(&context)),
                    message: if options.dry_run {
                        "Codex agent session workspace file changes were previewed.".to_owned()
                    } else {
                        "Codex agent session workspace files are ready.".to_owned()
                    },
                    dry_run: options.dry_run,
                    operations,
                    validator: self.validator_status(),
                })
            }
            "claude" => {
                let mut operations = self.prepare_claude_files(&options)?;
                operations
                    .extend(self.prepare_agent_session_common_files(&context, true, &options)?);
                operations.extend(self.prepare_agent_session_provider_files(&context, &options)?);
                let (_command_label, shell, args) = self.agent_session_launch_command(
                    AgentId::Claude,
                    "claude",
                    &context,
                    request.resume_provider_session,
                    &options,
                )?;
                Ok(ExternalAgentLaunchSpec {
                    agent_id: "claude".to_owned(),
                    agent_session_id: Some(context.agent_session_id.clone()),
                    title: "Claude".to_owned(),
                    shell,
                    args,
                    cwd: path_to_string(&context.session_root),
                    env: Some(self.agent_session_env(&context)),
                    message: if options.dry_run {
                        "Claude agent session workspace file changes were previewed.".to_owned()
                    } else {
                        "Claude agent session workspace files are ready.".to_owned()
                    },
                    dry_run: options.dry_run,
                    operations,
                    validator: self.validator_status(),
                })
            }
            "custom" => {
                let command = request
                    .custom_command
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| {
                        AppError::InvalidInput(
                            "Custom agent command is not configured. Enter a command before launch."
                                .to_owned(),
                        )
                    })?;
                let operations =
                    self.prepare_agent_session_common_files(&context, false, &options)?;
                let (shell, args) = agent_launch_command(&command);
                self.sync_agent_session_launch(&context, &command, &shell, &args, &options)?;
                Ok(ExternalAgentLaunchSpec {
                    agent_id: "custom".to_owned(),
                    agent_session_id: Some(context.agent_session_id.clone()),
                    title: "Custom Agent".to_owned(),
                    shell,
                    args,
                    cwd: path_to_string(&context.session_root),
                    env: Some(self.agent_session_env(&context)),
                    message: if options.dry_run {
                        "Custom agent session workspace file changes were previewed.".to_owned()
                    } else {
                        "Custom agent session workspace files are ready.".to_owned()
                    },
                    dry_run: options.dry_run,
                    operations,
                    validator: self.validator_status(),
                })
            }
            other => Err(AppError::InvalidInput(format!(
                "Unsupported external agent: {other}"
            ))),
        }
    }

    fn agent_session_launch_command(
        &self,
        agent_id: AgentId,
        default_command: &str,
        context: &AgentSessionWorkspaceContext,
        resume_provider_session: bool,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<(String, String, Vec<String>)> {
        let command = if resume_provider_session {
            self.provider_resume_command(agent_id, context)
                .unwrap_or_else(|| default_command.to_owned())
        } else {
            default_command.to_owned()
        };
        let (shell, args) = agent_launch_command(&command);
        self.sync_agent_session_launch(context, &command, &shell, &args, options)?;
        Ok((command, shell, args))
    }

    fn provider_resume_command(
        &self,
        agent_id: AgentId,
        context: &AgentSessionWorkspaceContext,
    ) -> Option<String> {
        let provider = self
            .read_agent_provider_session(agent_id, context)
            .unwrap_or_else(|| AgentProviderSession::for_agent(agent_id));
        if !provider.resume_supported {
            return None;
        }
        provider
            .resume_command
            .as_deref()
            .map(str::trim)
            .filter(|command| !command.is_empty())
            .map(ToOwned::to_owned)
    }

    fn read_agent_provider_session(
        &self,
        agent_id: AgentId,
        context: &AgentSessionWorkspaceContext,
    ) -> Option<AgentProviderSession> {
        let contents = fs::read_to_string(context.session_root.join("provider.toml")).ok()?;
        let provider = toml::from_str::<AgentProviderSession>(&contents).ok()?;
        provider.validate().ok()?;
        if provider.provider != AgentProvider::from(agent_id) {
            return None;
        }
        Some(provider)
    }

    fn sync_agent_session_launch(
        &self,
        context: &AgentSessionWorkspaceContext,
        command_label: &str,
        shell: &str,
        args: &[String],
        options: &WorkspaceWriteOptions,
    ) -> AppResult<()> {
        if options.dry_run {
            return Ok(());
        }

        let store = AgentSessionFileStore::new(&self.workspace_dir);
        let agent_session_id = AgentSessionId::new(context.agent_session_id.clone())?;
        let mut session = match store.read_session(&agent_session_id) {
            Ok(session) => session,
            Err(AppError::Io(error)) if error.kind() == ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        session.launch.command_label = command_label.to_owned();
        session.launch.shell = shell.to_owned();
        session.launch.args = args.to_vec();
        session.launch.cwd = path_to_string(&context.session_root);
        store.write_session(&session)?;
        Ok(())
    }

    fn agent_session_context(
        &self,
        agent_id: &str,
        agent_session_id: &str,
    ) -> AppResult<AgentSessionWorkspaceContext> {
        let agent_session_id = validate_agent_session_id(agent_session_id)?;
        match agent_id {
            "codex" | "claude" | "custom" => {}
            other => {
                return Err(AppError::InvalidInput(format!(
                    "Unsupported external agent: {other}"
                )))
            }
        };
        Ok(AgentSessionWorkspaceContext {
            agent_id: agent_id.to_owned(),
            agent_session_id: agent_session_id.clone(),
            session_root: self.agent_session_root(&agent_session_id),
            mcp_endpoint: scoped_agent_mcp_endpoint(&self.mcp_endpoint, &agent_session_id),
        })
    }

    fn agent_session_root(&self, agent_session_id: &str) -> PathBuf {
        self.workspace_dir
            .join("agents")
            .join("sessions")
            .join(agent_session_id)
    }

    fn agent_session_env(
        &self,
        context: &AgentSessionWorkspaceContext,
    ) -> BTreeMap<String, String> {
        BTreeMap::from([
            (
                "KERMINAL_AGENT_SESSION_ID".to_owned(),
                context.agent_session_id.clone(),
            ),
            (
                "KERMINAL_WORKSPACE_ROOT".to_owned(),
                path_to_string(&self.workspace_dir),
            ),
            (
                "KERMINAL_AGENT_SESSION_ROOT".to_owned(),
                path_to_string(&context.session_root),
            ),
            (
                "KERMINAL_MCP_ENDPOINT".to_owned(),
                context.mcp_endpoint.clone(),
            ),
        ])
    }

    fn prepare_agent_session_common_files(
        &self,
        context: &AgentSessionWorkspaceContext,
        include_claude_file: bool,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        let mut operations = Vec::with_capacity(if include_claude_file { 5 } else { 4 });
        operations.push(self.ensure_agent_session_instructions(context, options)?);
        if include_claude_file {
            operations.push(self.ensure_agent_session_claude_instructions(context, options)?);
        }
        operations.push(self.ensure_agent_session_mcp_endpoint(context, options)?);
        operations.push(self.ensure_agent_session_target_binding(context, options)?);
        operations.push(self.ensure_agent_session_terminal_snapshot(context, options)?);
        Ok(operations)
    }

    fn prepare_agent_session_provider_files(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        Ok(vec![
            self.ensure_agent_session_codex_config(context, options)?,
            self.ensure_agent_session_claude_mcp_json(context, options)?,
        ])
    }

    fn ensure_agent_session_instructions(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let agent_title = match context.agent_id.as_str() {
            "codex" => "Codex",
            "claude" => "Claude",
            "custom" => "Custom Agent",
            _ => "External Agent",
        };
        let agents_body = format!(
            r#"{MANAGED_BLOCK_START}
# Kerminal Agent Session

- You are an external Agent launched from the Kerminal right panel.
- Agent provider: `{}`.
- Agent title: `{}`.
- Kerminal agent session id: `{}`.
- Kerminal workspace root: `{}`.
- This session root: `{}`.
- Session-scoped MCP endpoint: `{}`.
- This is a Kerminal runtime workspace, not a source-code repository.
- Read `context/mcp-endpoint.json`, `context/target-binding.json`, and `context/terminal-snapshot.json` before runtime work. They contain the scoped endpoint, target binding, and most recent bounded target output snapshot.
- Kerminal MCP is tools-only; use it for live runtime actions, not file-backed configuration CRUD.
- Operate Kerminal through MCP when the task needs the live app: terminal sessions, SSH commands, SFTP files, tmux sessions, containers, port forwarding, server info, command history, diagnostics, runtime snapshot, or authorized credential saving.
- Start by calling `kerminal.app_guide` when you need the product/UI structure map; call `kerminal.capabilities` when you need the current tool map, file-first configuration boundary, or deliberately absent tool families; call `kerminal.tool_help` with `toolId`, `family`, or `query` when you need exact schemas, examples, and safety annotations; call `kerminal.config_guide` when you need the generated configuration rules through MCP; call `kerminal.operation_guide` with an intent such as `terminal`, `session-terminal`, `ssh-command`, `config`, `sftp`, `tmux`, `container`, `port-forward`, `server-info`, `history`, `credentials`, or `diagnostics` when you need a concrete tool sequence; call `kerminal.runtime_snapshot` when you need the current running terminals, Agent sessions, port forwards, and next actions.
- MCP host policy owns confirmation, approval, permissions, hooks, and audit. Kerminal exposes tools and validates arguments; it does not provide a second pending/confirm queue.
- Start runtime work by calling `kerminal.agent.current_session` or `kerminal.agent.target_context` on the session-scoped endpoint; these tools also refresh `context/terminal-snapshot.json` when the target is live.
- Before reading or writing the bound target terminal, resolve the target with `kerminal.agent.target_context` or `terminal.resolve_agent_target`; then inspect output with `terminal.snapshot`.
- Use `terminal.write` only when the resolved target is live and generation-matched. For session-bound writes pass `agentSessionId`, the returned `bindingGeneration`, and `data`; for explicit writes pass `sessionId` and `data`.
- If the target is stale, closed, missing, or generation-mismatched, stop and ask the user to rebind the target in Kerminal; never write to a guessed terminal.
- Useful runtime tool families: `terminal.*`, `ssh.command`, `ssh.command_on_resolved_host`, `sftp.*`, `tmux.*`, `container.*` including `container.files.*` (`container.files.list`, `container.files.preview`, `container.files.write_text`, `container.files.upload`, `container.files.download`, `container.files.create_directory`, `container.files.rename`, `container.files.chmod`, `container.files.delete`), `port_forward.*`, `server_info.snapshot`, `history.search`, `diagnostics.*`, `kerminal.app_guide`, `kerminal.config_guide`, `kerminal.capabilities`, `kerminal.tool_help`, `kerminal.operation_guide`, `kerminal.runtime_snapshot`, `kerminal.host.upsert_with_credential`, and `kerminal.vault.encrypt_secret`.
- File-backed Kerminal configuration is file-first: edit files under the workspace root directly, including `settings.toml`, `profiles/*.toml`, `hosts/groups.toml`, `hosts/*.toml`, `snippets/*.toml`, and `workflows/*.toml`.
- Before editing Kerminal configuration files, read `{}` from the workspace root or call `kerminal.config_guide` for the same generated rules. It documents file purposes, relationships, fields, examples, forbidden edits, and validation.
- After editing Kerminal configuration files, call MCP tool `{CONFIG_VALIDATOR_TOOL_ID}` with `scope = "all"` or the narrowest matching scope. If MCP validation is unavailable, manually check the guide and say validation was manual only.
- If Kerminal is running, valid file-backed config edits auto-refresh the UI and show a concise `cfg: ...` notice; invalid TOML keeps last-known-good. This feedback does not replace validation.
- Do not expect MCP config CRUD for settings, profiles, hosts, snippets, workflows, UI choreography, history writes, or approval/audit queues.
- Do not edit `data/command.sqlite` directly; use command history lookup tools when command history is needed.
- Do not read or edit `secrets/` unless the user explicitly asks for credential work; when authorized, follow `kerminal-config.md` and use the UI save flow, `kerminal.host.upsert_with_credential`, or `kerminal.vault.encrypt_secret` so ordinary host files only keep `secret_ref` / `key_passphrase_ref`; never write `password`, `credential_secret`, or `inline_private_key` into ordinary config files.
{MANAGED_BLOCK_END}
"#,
            context.agent_id,
            agent_title,
            context.agent_session_id,
            workspace_display_path(&self.workspace_dir, &self.workspace_dir),
            workspace_display_path(&self.workspace_dir, &context.session_root),
            context.mcp_endpoint,
            CONFIG_REFERENCE_FILE_NAME
        );
        patch_managed_block(
            &context.session_root.join("AGENTS.md"),
            &agents_body,
            "Update agent session instructions.",
            options,
        )
    }

    fn ensure_agent_session_claude_instructions(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let claude_body = format!(
            r#"{MANAGED_BLOCK_START}
@AGENTS.md

## Kerminal Claude Session

- Follow `AGENTS.md` for this Kerminal agent session.
- This is a Kerminal runtime workspace, not a source-code repository.
- Kerminal MCP is tools-only; use it for live runtime actions, not file-backed configuration CRUD.
- MCP host policy owns confirmation, approval, permissions, hooks, and audit; Kerminal does not provide a second pending/confirm queue.
- Call `kerminal.app_guide` when you need the product/UI structure map; call `kerminal.capabilities` when you need the current runtime tool map or config/tool boundary; call `kerminal.tool_help` with `toolId`, `family`, or `query` when you need exact schemas, examples, and safety annotations; call `kerminal.config_guide` when you need the generated configuration rules through MCP; call `kerminal.operation_guide` with an intent such as `session-terminal`, `ssh-command`, `config`, `sftp`, `tmux`, `container`, `port-forward`, `server-info`, `history`, `credentials`, or `diagnostics` when you need a concrete tool sequence; call `kerminal.runtime_snapshot` when you need the current running terminals, Agent sessions, port forwards, and next actions.
- Read `context/mcp-endpoint.json`, `context/target-binding.json`, and `context/terminal-snapshot.json`, then use the session-scoped endpoint for `kerminal.agent.current_session`, `kerminal.agent.target_context`, `terminal.snapshot`, and `terminal.write`.
- When writing to the bound terminal, pass `agentSessionId`, the returned `bindingGeneration`, and `data`.
- Use runtime tool families from `AGENTS.md`, including `terminal.*`, `ssh.command`, `ssh.command_on_resolved_host`, `sftp.*`, `tmux.*`, `container.*` including `container.files.*` (`container.files.list`, `container.files.preview`, `container.files.write_text`, `container.files.upload`, `container.files.download`, `container.files.create_directory`, `container.files.rename`, `container.files.chmod`, `container.files.delete`), `port_forward.*`, `server_info.snapshot`, `history.search`, `diagnostics.*`, `kerminal.app_guide`, `kerminal.config_guide`, `kerminal.capabilities`, `kerminal.tool_help`, `kerminal.operation_guide`, `kerminal.runtime_snapshot`, and credential helpers.
- Prefer direct file edits in the Kerminal workspace root for `settings.toml`, `profiles/*.toml`, `hosts/*.toml`, `snippets/*.toml`, and `workflows/*.toml`.
- Before editing Kerminal configuration files, read `{}` from the workspace root or call `kerminal.config_guide` for the same generated rules.
- After editing Kerminal configuration files, call MCP tool `{CONFIG_VALIDATOR_TOOL_ID}` with `scope = "all"` or the narrowest matching scope. If MCP validation is unavailable, manually check the guide and say validation was manual only.
- If Kerminal is running, valid file-backed config edits auto-refresh the UI and show a concise `cfg: ...` notice; invalid TOML keeps last-known-good. This feedback does not replace validation.
- Use the session-scoped MCP endpoint `{}`.
- If the target is stale, closed, missing, or generation-mismatched, ask the user to rebind before writing to any terminal.
- Do not read or edit `secrets/` unless the user explicitly asks for credential work; when authorized, follow `kerminal-config.md` and use the UI save flow, `kerminal.host.upsert_with_credential`, or `kerminal.vault.encrypt_secret` so ordinary host files only keep `secret_ref` / `key_passphrase_ref`; never write `password`, `credential_secret`, or `inline_private_key` into ordinary config files.
{MANAGED_BLOCK_END}
"#,
            CONFIG_REFERENCE_FILE_NAME, context.mcp_endpoint
        );
        patch_managed_block(
            &context.session_root.join("CLAUDE.md"),
            &claude_body,
            "Update Claude agent session instructions.",
            options,
        )
    }

    fn ensure_agent_session_codex_config(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let path = context.session_root.join(".codex").join("config.toml");
        let snippet = format!(
            r#"[mcp_servers.kerminal]
url = "{}"
default_tools_approval_mode = "prompt"
tool_timeout_sec = 60
enabled = true
"#,
            context.mcp_endpoint
        );
        let current = read_optional_string(&path)?;
        let current_content = current.as_deref().unwrap_or_default();
        let next = replace_toml_table(current_content, "[mcp_servers.kerminal]", &snippet);
        let current_snippet = extract_toml_table(current_content, "[mcp_servers.kerminal]");
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next,
                current,
                current_snippet,
                next_snippet: snippet,
                reason: "Update session Codex MCP server table.".to_owned(),
            },
            options,
        )
    }

    fn ensure_agent_session_claude_mcp_json(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let path = context.session_root.join(".mcp.json");
        let current = read_optional_string(&path)?;
        let mut root = match parse_claude_mcp_json(&path, current.as_deref(), options)? {
            Some(root) => root,
            None => json!({}),
        };
        let previous_server = root
            .pointer("/mcpServers/kerminal")
            .map(|value| serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()));
        let object = root.as_object_mut().ok_or_else(|| {
            AppError::InvalidInput(
                ".mcp.json must be a JSON object. Use overwritePolicy=backupAndReplaceInvalid to repair it."
                    .to_owned(),
            )
        })?;
        let servers = object
            .entry("mcpServers")
            .or_insert_with(|| Value::Object(Map::new()));
        if !servers.is_object() {
            match options.overwrite_policy {
                ExternalAgentOverwritePolicy::BackupAndReplaceInvalid => {
                    *servers = Value::Object(Map::new());
                }
                ExternalAgentOverwritePolicy::PreserveUserContent => {
                    return Err(AppError::InvalidInput(
                        ".mcp.json mcpServers must be a JSON object. Use overwritePolicy=backupAndReplaceInvalid to repair it."
                            .to_owned(),
                    ));
                }
            }
        }
        let servers_object = servers.as_object_mut().expect("mcpServers object");
        servers_object.insert(
            "kerminal".to_owned(),
            json!({
                "type": "http",
                "url": context.mcp_endpoint.as_str(),
                "timeout": 60000
            }),
        );
        let next = serde_json::to_string_pretty(&root)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: format!("{next}\n"),
                current,
                current_snippet: previous_server,
                next_snippet: serde_json::to_string_pretty(&json!({
                    "type": "http",
                    "url": context.mcp_endpoint.as_str(),
                    "timeout": 60000
                }))?,
                reason: "Update session Claude MCP server entry.".to_owned(),
            },
            options,
        )
    }

    fn ensure_agent_session_mcp_endpoint(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let env = self.agent_session_env(context);
        let next = serde_json::to_string_pretty(&json!({
            "schemaVersion": 1,
            "agentSessionId": context.agent_session_id.as_str(),
            "agentId": context.agent_id.as_str(),
            "workspaceRoot": path_to_string(&self.workspace_dir),
            "agentSessionRoot": path_to_string(&context.session_root),
            "endpoint": context.mcp_endpoint.as_str(),
            "transport": "streamable-http",
            "toolsOnly": true,
            "generatedAt": current_unix_timestamp_string(),
            "env": env
        }))?;
        let path = context
            .session_root
            .join("context")
            .join("mcp-endpoint.json");
        let current = read_optional_string(&path)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: format!("{next}\n"),
                current,
                current_snippet: None,
                next_snippet: next,
                reason: "Update session MCP endpoint context.".to_owned(),
            },
            options,
        )
    }

    fn ensure_agent_session_target_binding(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let target_context = self.seed_agent_session_target_binding_context(context)?;
        let next = serde_json::to_string_pretty(&target_context)?;
        let path = context
            .session_root
            .join("context")
            .join("target-binding.json");
        let current = read_optional_string(&path)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: format!("{next}\n"),
                current,
                current_snippet: None,
                next_snippet: next,
                reason: "Update session target binding context.".to_owned(),
            },
            options,
        )
    }

    fn ensure_agent_session_terminal_snapshot(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let agent_session_id = AgentSessionId::new(context.agent_session_id.clone())?;
        let snapshot_context = AgentTerminalSnapshotContext {
            schema_version: AGENT_SESSION_SCHEMA_VERSION,
            agent_session_id,
            target_terminal_session_id: None,
            captured_bytes: 0,
            max_bytes: AGENT_SESSION_TERMINAL_SNAPSHOT_BYTES,
            truncated: false,
            redacted: false,
            output: String::new(),
            generated_at: current_unix_timestamp_string(),
        };
        let next = serde_json::to_string_pretty(&snapshot_context)?;
        let path = context
            .session_root
            .join("context")
            .join("terminal-snapshot.json");
        let current = read_optional_string(&path)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: format!("{next}\n"),
                current,
                current_snippet: None,
                next_snippet: next,
                reason: "Update session terminal snapshot context.".to_owned(),
            },
            options,
        )
    }

    fn seed_agent_session_target_binding_context(
        &self,
        context: &AgentSessionWorkspaceContext,
    ) -> AppResult<AgentTargetBindingContext> {
        let agent_session_id = AgentSessionId::new(context.agent_session_id.clone())?;
        let generated_at = current_unix_timestamp_string();
        let store = AgentSessionFileStore::new(&self.workspace_dir);
        match store.read_session(&agent_session_id) {
            Ok(session) => Ok(AgentTargetBindingContext::from_session_target(
                &session,
                generated_at,
            )),
            Err(AppError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(
                unbound_agent_target_binding_context(agent_session_id, generated_at),
            ),
            Err(error) => Err(error),
        }
    }

    fn agent_status(
        &self,
        id: &str,
        title: &str,
        command: &str,
        config_path: PathBuf,
    ) -> ExternalAgentStatus {
        let installed = executable_on_path(command);
        let config_ready = match id {
            "codex" => {
                codex_config_ready(&config_path)
                    && self.agents_file_path().is_file()
                    && self.config_reference_path().is_file()
            }
            "claude" => {
                claude_config_ready(&config_path)
                    && self.agents_file_path().is_file()
                    && self.config_reference_path().is_file()
                    && self.claude_instructions_path().is_file()
            }
            _ => false,
        };
        let status_detail = match (installed, config_ready) {
            (true, true) => "Ready".to_owned(),
            (true, false) => "CLI installed; workspace files need regeneration".to_owned(),
            (false, true) => "Workspace files ready; CLI not found in PATH".to_owned(),
            (false, false) => "CLI not found in PATH; workspace files need regeneration".to_owned(),
        };

        ExternalAgentStatus {
            id: id.to_owned(),
            title: title.to_owned(),
            cli_command: command.to_owned(),
            installed,
            config_ready,
            config_path: path_to_string(&config_path),
            status_detail,
        }
    }

    fn custom_agent_status(&self) -> ExternalAgentStatus {
        ExternalAgentStatus {
            id: "custom".to_owned(),
            title: "Custom Agent".to_owned(),
            cli_command: String::new(),
            installed: false,
            config_ready: false,
            config_path: path_to_string(&self.workspace_dir),
            status_detail: "Enter a custom CLI command to launch it in this workspace".to_owned(),
        }
    }

    fn prepare_codex_files(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        Ok(vec![
            self.ensure_shared_instructions(options)?,
            self.ensure_config_reference(options)?,
            self.ensure_codex_config(options)?,
        ])
    }

    fn prepare_claude_files(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        let mut operations = Vec::with_capacity(4);
        operations.push(self.ensure_shared_instructions(options)?);
        operations.push(self.ensure_config_reference(options)?);
        operations.extend(self.ensure_claude_files(options)?);
        Ok(operations)
    }

    fn validator_status(&self) -> ExternalAgentValidatorStatus {
        let available = self.mcp_server_running;
        ExternalAgentValidatorStatus {
            available,
            command: format!("MCP tool: {CONFIG_VALIDATOR_TOOL_ID} {{\"scope\":\"all\"}}"),
            detail: if available {
                "Call this read-only MCP tool after editing settings.toml, profiles, hosts, snippets, or workflows.".to_owned()
            } else {
                "Start the Kerminal MCP Server to use runtime config validation; otherwise manually check kerminal-config.md.".to_owned()
            },
            status: if available {
                "available"
            } else {
                "mcp-unavailable"
            }
            .to_owned(),
        }
    }

    fn ensure_shared_instructions(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let validator_line = format!(
            "- After changing Kerminal configuration files, call MCP tool `{CONFIG_VALIDATOR_TOOL_ID}` with `scope = \"all\"` or the narrowest matching scope, then fix any diagnostics before reporting success. If the tool is unavailable, manually check `{CONFIG_REFERENCE_FILE_NAME}` and say validation was manual only."
        );
        let agents_body = format!(
            r#"{MANAGED_BLOCK_START}
# Kerminal External Agent Workspace

- Treat this directory as the Kerminal runtime workspace, not a source-code repository.
- Your job is to operate Kerminal for the user through the Kerminal MCP server and edit file-backed configuration only when the user asks for configuration changes.
- Operate Kerminal through MCP for live app features: terminal sessions, SSH commands, SFTP files, tmux sessions, containers, port forwarding, server info, command history, diagnostics, runtime snapshot, and authorized credential saving. MCP endpoint: `{}`.
- Call MCP tool `kerminal.app_guide` when you need the product/UI structure map; call `kerminal.capabilities` when you need the current Kerminal tool map, recommended first calls, file-first config boundary, or deliberately absent tool families; call `kerminal.tool_help` with `toolId`, `family`, or `query` when you need exact schemas, examples, and safety annotations; call `kerminal.config_guide` when you need the generated configuration rules through MCP; call `kerminal.operation_guide` with an intent such as `terminal`, `session-terminal`, `ssh-command`, `config`, `sftp`, `tmux`, `container`, `port-forward`, `server-info`, `history`, `credentials`, or `diagnostics` when you need a concrete tool sequence; call `kerminal.runtime_snapshot` when you need the current running terminals, Agent sessions, port forwards, and next actions.
- MCP host policy owns confirmation, approval, permissions, hooks, and audit. Kerminal exposes tools and validates arguments; it does not provide a second pending/confirm queue.
- Useful MCP tool families include `terminal.*`, `ssh.command`, `ssh.command_on_resolved_host`, `sftp.*`, `tmux.*`, `container.*` including `container.files.*` (`container.files.list`, `container.files.preview`, `container.files.write_text`, `container.files.upload`, `container.files.download`, `container.files.create_directory`, `container.files.rename`, `container.files.chmod`, `container.files.delete`), `port_forward.*`, `server_info.snapshot`, `history.search`, `diagnostics.*`, `kerminal.app_guide`, `kerminal.config_guide`, `kerminal.capabilities`, `kerminal.tool_help`, `kerminal.operation_guide`, `kerminal.runtime_snapshot`, credential helpers (`kerminal.host.upsert_with_credential`, `kerminal.vault.encrypt_secret`), and, in session workspaces, `kerminal.agent.*`.
- If this workspace has an agent session under `agents/sessions/<id>/`, prefer launching from that session directory so `AGENTS.md`, `context/mcp-endpoint.json`, `context/target-binding.json`, `context/terminal-snapshot.json`, and the session-scoped endpoint bind tools to the correct target.
- In the global workspace there is no implicit target terminal. Before terminal work, ask the user which Kerminal terminal/host to use or call read-only tools such as `terminal.list` and `terminal.snapshot`; never infer a target from filenames.
- Before any `terminal.write`, resolve and inspect the target. In a session workspace use `kerminal.agent.target_context` or `terminal.resolve_agent_target`; otherwise use an explicit live terminal session id.
- For session-bound `terminal.write`, pass `agentSessionId`, the returned `bindingGeneration`, and `data`; for explicit terminal writes, pass `sessionId` and `data`.
- If the target is stale, closed, missing, or generation-mismatched, ask the user to rebind it in Kerminal.
- Use Kerminal MCP for saved credentials and remote access. Do not read `secrets/` to get passwords, private keys, or key passphrases.
- Before editing Kerminal configuration files, read `{CONFIG_REFERENCE_FILE_NAME}` or call `kerminal.config_guide` for the same generated rules. It documents file purposes, relationships, fields, examples, forbidden edits, and validation.
- Prefer direct file edits for file-backed Kerminal configuration; use MCP for runtime operation rather than config CRUD.
- Editable config files by default: `settings.toml`, `profiles/*.toml`, `hosts/groups.toml`, `hosts/*.toml`, `snippets/*.toml`, and `workflows/*.toml`.
- When Kerminal is running, valid file-backed config edits auto-refresh the UI and show a short `cfg: ...` notice; invalid TOML keeps last-known-good. Still validate with `{CONFIG_VALIDATOR_TOOL_ID}` before reporting success.
- Do not use Kerminal MCP tools for settings, profile, host, snippet, or workflow CRUD when the same change can be made by editing the files above.
- Do not expect MCP tools for config CRUD or UI choreography such as `settings.*`, `profile.*`, `remote_host.*`, `snippet.*`, `workflow.*`, `workspace.*`, `terminal.create`, `terminal.resolve_current`, or history write/delete/clear operations.
- Kerminal-owned runtime areas: `data/`, `logs/`, `cache/`, `temp/`, and `exports/`; prefer MCP tools over direct edits there.
- Do not edit `data/command.sqlite` directly; use `history.search` when command history is needed.
- Secret scope: do not read or edit `secrets/` unless the user explicitly asks for credential work.
- When credential work is authorized, follow `kerminal-config.md` and use the UI save flow, `kerminal.host.upsert_with_credential`, or `kerminal.vault.encrypt_secret` so host files only keep `secret_ref` / `key_passphrase_ref`; never write `password =`, `credential_secret`, or `inline_private_key` into ordinary config files.
- Never store API keys, tokens, passwords, or private keys in ordinary config files.
- Keep edits small and targeted; do not reformat all TOML or remove comments outside the requested change.
{}
{MANAGED_BLOCK_END}
"#,
            self.mcp_endpoint, validator_line
        );
        patch_managed_block(
            &self.agents_file_path(),
            &agents_body,
            "Update shared external agent instructions.",
            options,
        )
    }

    fn ensure_config_reference(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let path = self.config_reference_path();
        let current = read_optional_string(&path)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: CONFIG_REFERENCE_BODY.to_owned(),
                current: current.clone(),
                current_snippet: current,
                next_snippet: CONFIG_REFERENCE_BODY.to_owned(),
                reason: "Update Kerminal configuration guide for external agents.".to_owned(),
            },
            options,
        )
    }

    fn ensure_codex_config(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let path = self.codex_config_path();
        let snippet = format!(
            r#"[mcp_servers.kerminal]
url = "{}"
default_tools_approval_mode = "prompt"
tool_timeout_sec = 60
enabled = true
"#,
            self.mcp_endpoint
        );
        let current = read_optional_string(&path)?;
        let current_content = current.as_deref().unwrap_or_default();
        let next = replace_toml_table(current_content, "[mcp_servers.kerminal]", &snippet);
        let current_snippet = extract_toml_table(current_content, "[mcp_servers.kerminal]");
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next,
                current,
                current_snippet,
                next_snippet: snippet,
                reason: "Update Codex MCP server table.".to_owned(),
            },
            options,
        )
    }

    fn ensure_claude_files(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        let claude_body = format!(
            r#"{MANAGED_BLOCK_START}
@AGENTS.md

## Claude Code

- Treat this directory as the Kerminal runtime workspace, not a source-code repository.
- Follow `AGENTS.md` first.
- Operate Kerminal through MCP for live terminal, SSH/SFTP, tmux, container, port forwarding, server info, history, diagnostics, runtime snapshot, and authorized credential saving work: `{}`.
- Call MCP tool `kerminal.app_guide` when you need the product/UI structure map; call `kerminal.capabilities` when you need the current Kerminal tool map or config/tool boundary; call `kerminal.tool_help` with `toolId`, `family`, or `query` when you need exact schemas, examples, and safety annotations; call `kerminal.config_guide` when you need the generated configuration rules through MCP; call `kerminal.operation_guide` with an intent such as `terminal`, `session-terminal`, `ssh-command`, `config`, `sftp`, `tmux`, `container`, `port-forward`, `server-info`, `history`, `credentials`, or `diagnostics` when you need a concrete tool sequence; call `kerminal.runtime_snapshot` when you need the current running terminals, Agent sessions, port forwards, and next actions.
- Useful runtime tool families include `terminal.*`, `kerminal.agent.*`, `ssh.command`, `ssh.command_on_resolved_host`, `sftp.*`, `tmux.*`, `container.*` including `container.files.*` (`container.files.list`, `container.files.preview`, `container.files.write_text`, `container.files.upload`, `container.files.download`, `container.files.create_directory`, `container.files.rename`, `container.files.chmod`, `container.files.delete`), `port_forward.*`, `server_info.snapshot`, `history.search`, `diagnostics.*`, `kerminal.app_guide`, `kerminal.config_guide`, `kerminal.capabilities`, `kerminal.tool_help`, `kerminal.operation_guide`, `kerminal.runtime_snapshot`, `kerminal.host.upsert_with_credential`, and `kerminal.vault.encrypt_secret`.
- MCP host policy owns confirmation, approval, permissions, hooks, and audit; Kerminal does not provide a second pending/confirm queue.
- In a session workspace, read `context/mcp-endpoint.json`, `context/target-binding.json`, and `context/terminal-snapshot.json`, then use `kerminal.agent.target_context` before `terminal.write`.
- When writing to the bound terminal, pass `agentSessionId`, the returned `bindingGeneration`, and `data`.
- Before editing Kerminal configuration files, read `{CONFIG_REFERENCE_FILE_NAME}` or call `kerminal.config_guide` for the same generated rules.
- After editing Kerminal configuration files, call MCP tool `{CONFIG_VALIDATOR_TOOL_ID}` with `scope = "all"` or the narrowest matching scope. If MCP validation is unavailable, manually check `{CONFIG_REFERENCE_FILE_NAME}` and say validation was manual only.
- Prefer direct file edits for file-backed Kerminal configuration; use the Kerminal MCP server only for runtime actions that require the live app, an existing terminal session, saved connection credentials, SSH/SFTP, tmux, containers, port forwarding, server info, history, diagnostics, runtime snapshot, or authorized credential saving: `{}`.
- Do not use Kerminal MCP tools for settings, profile, host, snippet, or workflow CRUD when direct file edits can express the change.
- Do not expect MCP tools for config CRUD or UI choreography such as `settings.*`, `profile.*`, `remote_host.*`, `snippet.*`, `workflow.*`, `workspace.*`, `terminal.create`, `terminal.resolve_current`, or history write/delete/clear operations.
- Do not edit `data/command.sqlite` directly; use `history.search` when command history is needed.
- Do not edit `secrets/` unless the user explicitly asks; when authorized, follow `kerminal-config.md` and use the UI save flow, `kerminal.host.upsert_with_credential`, or `kerminal.vault.encrypt_secret` so ordinary host files only keep `secret_ref` / `key_passphrase_ref`; never write `password`, `credential_secret`, or `inline_private_key` into ordinary config files.
{MANAGED_BLOCK_END}
"#,
            self.mcp_endpoint, self.mcp_endpoint
        );
        Ok(vec![
            patch_managed_block(
                &self.claude_instructions_path(),
                &claude_body,
                "Update Claude workspace instructions.",
                options,
            )?,
            self.ensure_claude_mcp_json(options)?,
        ])
    }

    fn ensure_claude_mcp_json(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let path = self.claude_config_path();
        let current = read_optional_string(&path)?;
        let mut root = match parse_claude_mcp_json(&path, current.as_deref(), options)? {
            Some(root) => root,
            None => json!({}),
        };
        let previous_server = root
            .pointer("/mcpServers/kerminal")
            .map(|value| serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()));
        let object = root.as_object_mut().ok_or_else(|| {
            AppError::InvalidInput(
                ".mcp.json must be a JSON object. Use overwritePolicy=backupAndReplaceInvalid to repair it."
                    .to_owned(),
            )
        })?;
        let servers = object
            .entry("mcpServers")
            .or_insert_with(|| Value::Object(Map::new()));
        if !servers.is_object() {
            match options.overwrite_policy {
                ExternalAgentOverwritePolicy::BackupAndReplaceInvalid => {
                    *servers = Value::Object(Map::new());
                }
                ExternalAgentOverwritePolicy::PreserveUserContent => {
                    return Err(AppError::InvalidInput(
                        ".mcp.json mcpServers must be a JSON object. Use overwritePolicy=backupAndReplaceInvalid to repair it."
                            .to_owned(),
                    ));
                }
            }
        }
        let servers_object = servers.as_object_mut().expect("mcpServers object");
        servers_object.insert(
            "kerminal".to_owned(),
            json!({
                "type": "http",
                "url": self.mcp_endpoint,
                "timeout": 60000
            }),
        );
        let next = serde_json::to_string_pretty(&root)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: format!("{next}\n"),
                current,
                current_snippet: previous_server,
                next_snippet: serde_json::to_string_pretty(&json!({
                    "type": "http",
                    "url": self.mcp_endpoint,
                    "timeout": 60000
                }))?,
                reason: "Update Claude project MCP server entry.".to_owned(),
            },
            options,
        )
    }

    fn agents_file_path(&self) -> PathBuf {
        self.workspace_dir.join("AGENTS.md")
    }

    fn claude_instructions_path(&self) -> PathBuf {
        self.workspace_dir.join("CLAUDE.md")
    }

    fn config_reference_path(&self) -> PathBuf {
        self.workspace_dir.join(CONFIG_REFERENCE_FILE_NAME)
    }

    fn codex_config_path(&self) -> PathBuf {
        self.workspace_dir.join(".codex").join("config.toml")
    }

    fn claude_config_path(&self) -> PathBuf {
        self.workspace_dir.join(".mcp.json")
    }
}

fn read_optional_string(path: &Path) -> AppResult<Option<String>> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn apply_text_plan(
    plan: WorkspaceTextPlan,
    options: &WorkspaceWriteOptions,
) -> AppResult<ExternalAgentFileOperation> {
    let changed = plan.current.as_deref() != Some(plan.next.as_str());
    let action = if !changed {
        ExternalAgentFileAction::Unchanged
    } else if plan.current.is_some() {
        ExternalAgentFileAction::Updated
    } else {
        ExternalAgentFileAction::Created
    };
    let diff =
        changed.then(|| build_safe_diff(plan.current_snippet.as_deref(), &plan.next_snippet));
    let mut backup_path = None;

    if changed && !options.dry_run {
        if let Some(parent) = plan.path.parent() {
            fs::create_dir_all(parent)?;
        }
        backup_path = backup_existing_file(&plan.path)?.map(|path| path_to_string(&path));
        let temp_path = plan.path.with_file_name(format!(
            ".{}.tmp-{}",
            plan.path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("kerminal"),
            Uuid::new_v4()
        ));
        fs::write(&temp_path, &plan.next)?;
        if plan.path.exists() {
            fs::remove_file(&plan.path)?;
        }
        fs::rename(temp_path, &plan.path)?;
    }

    Ok(ExternalAgentFileOperation {
        path: path_to_string(&plan.path),
        action,
        changed,
        dry_run: options.dry_run,
        backup_path,
        diff,
        reason: plan.reason,
    })
}

fn backup_existing_file(path: &Path) -> AppResult<Option<PathBuf>> {
    if !path.is_file() {
        return Ok(None);
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("kerminal-file");
    let backup_path =
        path.with_file_name(format!("{file_name}.bak-{timestamp}-{}", Uuid::new_v4()));
    fs::copy(path, &backup_path)?;
    Ok(Some(backup_path))
}

fn current_unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn unbound_agent_target_binding_context(
    agent_session_id: AgentSessionId,
    generated_at: String,
) -> AgentTargetBindingContext {
    AgentTargetBindingContext {
        schema_version: AGENT_SESSION_SCHEMA_VERSION,
        agent_session_id,
        binding: AgentTargetBindingContextBinding {
            binding_id: None,
            generation: 0,
            status: AgentTargetBindingStatus::Unbound,
            stale: false,
            pane_id: None,
            tab_id: None,
            target_terminal_session_id: None,
            target_ref: None,
            cwd: None,
            shell: None,
        },
        agent_terminal: None,
        generated_at,
    }
}

fn patch_managed_block(
    path: &Path,
    block: &str,
    reason: &str,
    options: &WorkspaceWriteOptions,
) -> AppResult<ExternalAgentFileOperation> {
    let current = read_optional_string(path)?;
    let current_content = current.as_deref().unwrap_or_default();
    let next = patch_managed_block_content(current_content, block);
    let current_snippet = extract_managed_block(current_content);
    apply_text_plan(
        WorkspaceTextPlan {
            path: path.to_path_buf(),
            next,
            current,
            current_snippet,
            next_snippet: block.trim_end().to_owned(),
            reason: reason.to_owned(),
        },
        options,
    )
}

fn patch_managed_block_content(current: &str, block: &str) -> String {
    if let Some(start) = current.find(MANAGED_BLOCK_START) {
        if let Some(end_relative) = current[start..].find(MANAGED_BLOCK_END) {
            let end = start + end_relative + MANAGED_BLOCK_END.len();
            return format!(
                "{}{}{}",
                &current[..start],
                block.trim_end(),
                &current[end..]
            );
        }
        return format!("{}\n\n{}", current.trim_end(), block.trim_end());
    }
    if current.trim().is_empty() {
        format!("{}\n", block.trim_end())
    } else {
        format!("{}\n\n{}\n", current.trim_end(), block.trim_end())
    }
}

fn replace_toml_table(content: &str, table_header: &str, replacement: &str) -> String {
    let lines = content.lines().collect::<Vec<_>>();
    let Some(start) = lines.iter().position(|line| line.trim() == table_header) else {
        let mut next = content.trim_end().to_owned();
        if !next.is_empty() {
            next.push_str("\n\n");
        }
        next.push_str(replacement.trim_end());
        next.push('\n');
        return next;
    };
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| {
            let trimmed = line.trim();
            (trimmed.starts_with('[') && trimmed.ends_with(']')).then_some(index)
        })
        .unwrap_or(lines.len());
    let mut next_lines = Vec::new();
    next_lines.extend_from_slice(&lines[..start]);
    next_lines.extend(replacement.trim_end().lines());
    next_lines.extend_from_slice(&lines[end..]);
    format!("{}\n", next_lines.join("\n").trim_end())
}

fn parse_claude_mcp_json(
    path: &Path,
    current: Option<&str>,
    options: &WorkspaceWriteOptions,
) -> AppResult<Option<Value>> {
    let Some(content) = current else {
        return Ok(None);
    };
    if content.trim().is_empty() {
        return Ok(None);
    }
    match serde_json::from_str::<Value>(content) {
        Ok(Value::Object(_)) => Ok(serde_json::from_str::<Value>(content).ok()),
        Ok(_) | Err(_) => match options.overwrite_policy {
            ExternalAgentOverwritePolicy::BackupAndReplaceInvalid => Ok(None),
            ExternalAgentOverwritePolicy::PreserveUserContent => Err(AppError::InvalidInput(
                format!(
                    "{} is not a valid Claude MCP JSON object. Use overwritePolicy=backupAndReplaceInvalid to back it up and repair it.",
                    path_to_string(path)
                ),
            )),
        },
    }
}

fn extract_managed_block(content: &str) -> Option<String> {
    let start = content.find(MANAGED_BLOCK_START)?;
    let end_relative = content[start..].find(MANAGED_BLOCK_END)?;
    let end = start + end_relative + MANAGED_BLOCK_END.len();
    Some(content[start..end].to_owned())
}

fn extract_toml_table(content: &str, table_header: &str) -> Option<String> {
    let lines = content.lines().collect::<Vec<_>>();
    let start = lines.iter().position(|line| line.trim() == table_header)?;
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| {
            let trimmed = line.trim();
            (trimmed.starts_with('[') && trimmed.ends_with(']')).then_some(index)
        })
        .unwrap_or(lines.len());
    Some(lines[start..end].join("\n"))
}

fn build_safe_diff(current: Option<&str>, next: &str) -> String {
    let current = current
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("<missing Kerminal managed section>");
    format!(
        "--- current\n{}\n+++ next\n{}\n",
        prefix_diff_lines(current, '-'),
        prefix_diff_lines(next.trim(), '+')
    )
}

fn prefix_diff_lines(content: &str, prefix: char) -> String {
    if content.is_empty() {
        return format!("{prefix}<empty>");
    }
    content
        .lines()
        .map(|line| format!("{prefix}{line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn codex_config_ready(path: &Path) -> bool {
    fs::read_to_string(path)
        .map(|content| content.contains("[mcp_servers.kerminal]") && content.contains("url = "))
        .unwrap_or(false)
}

fn claude_config_ready(path: &Path) -> bool {
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(root) = serde_json::from_str::<Value>(&content) else {
        return false;
    };
    root.pointer("/mcpServers/kerminal/url")
        .and_then(Value::as_str)
        .is_some()
}

fn validate_agent_session_id(input: &str) -> AppResult<String> {
    let value = input.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(
            "Agent session id is required for a session workspace.".to_owned(),
        ));
    }
    if value.len() > 128 {
        return Err(AppError::InvalidInput(
            "Agent session id must be 128 characters or fewer.".to_owned(),
        ));
    }
    if !value
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || char == '_' || char == '-')
    {
        return Err(AppError::InvalidInput(
            "Agent session id may only contain ASCII letters, numbers, '_' or '-'.".to_owned(),
        ));
    }
    Ok(value.to_owned())
}

fn scoped_agent_mcp_endpoint(base_endpoint: &str, agent_session_id: &str) -> String {
    format!(
        "{}/agents/{}",
        base_endpoint.trim_end_matches('/'),
        agent_session_id
    )
}

#[cfg(not(windows))]
fn parse_command_line(input: &str) -> AppResult<(String, Vec<String>)> {
    let parts = split_command_line(input);
    let Some(shell) = parts.first().filter(|value| !value.trim().is_empty()) else {
        return Err(AppError::InvalidInput(
            "Custom agent command is not configured. Enter a command before launch.".to_owned(),
        ));
    };
    Ok((shell.clone(), parts[1..].to_vec()))
}

fn agent_launch_command(command: &str) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        if let Some(shell) = preferred_windows_agent_shell() {
            powershell_agent_launch_command(shell, command)
        } else {
            cmd_agent_launch_command(command)
        }
    }

    #[cfg(not(windows))]
    {
        parse_command_line(command).unwrap_or_else(|_| (command.to_owned(), Vec::new()))
    }
}

#[cfg(windows)]
fn preferred_windows_agent_shell() -> Option<&'static str> {
    static PREFERRED_WINDOWS_AGENT_SHELL: OnceLock<Option<&'static str>> = OnceLock::new();
    *PREFERRED_WINDOWS_AGENT_SHELL.get_or_init(|| {
        [WINDOWS_AGENT_PWSH, WINDOWS_AGENT_POWERSHELL]
            .into_iter()
            .find(|shell| windows_agent_shell_available(shell))
    })
}

#[cfg(windows)]
fn windows_agent_shell_available(shell: &str) -> bool {
    Command::new(shell)
        .creation_flags(CREATE_NO_WINDOW)
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-Command")
        .arg("$PSVersionTable.PSVersion.ToString()")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn powershell_agent_launch_command(shell: &str, command: &str) -> (String, Vec<String>) {
    (
        shell.to_owned(),
        vec![
            "-NoLogo".to_owned(),
            "-NoProfile".to_owned(),
            "-NoExit".to_owned(),
            "-Command".to_owned(),
            command.to_owned(),
        ],
    )
}

#[cfg(windows)]
fn cmd_agent_launch_command(command: &str) -> (String, Vec<String>) {
    (
        "cmd.exe".to_owned(),
        vec![
            "/d".to_owned(),
            "/s".to_owned(),
            "/k".to_owned(),
            command.to_owned(),
        ],
    )
}

#[cfg(not(windows))]
fn split_command_line(input: &str) -> Vec<String> {
    let chars = input.chars().collect::<Vec<_>>();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut index = 0;

    while index < chars.len() {
        let char = chars[index];
        if char == '\\' {
            if let Some(next) = chars.get(index + 1).copied() {
                if next == '"' || next == '\'' || next == '\\' || next.is_whitespace() {
                    current.push(next);
                    index += 2;
                    continue;
                }
            }
            current.push(char);
            index += 1;
            continue;
        }
        if let Some(active_quote) = quote {
            if char == active_quote {
                quote = None;
            } else {
                current.push(char);
            }
            index += 1;
            continue;
        }
        if char == '"' || char == '\'' {
            quote = Some(char);
            index += 1;
            continue;
        }
        if char.is_whitespace() {
            if !current.is_empty() {
                parts.push(std::mem::take(&mut current));
            }
            index += 1;
            continue;
        }
        current.push(char);
        index += 1;
    }

    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

fn executable_on_path(command: &str) -> bool {
    let command_path = Path::new(command);
    if command_path.components().count() > 1 {
        return command_path.is_file();
    }
    let Some(path_value) = env::var_os("PATH") else {
        return false;
    };
    let candidates = executable_names(command);
    env::split_paths(&path_value).any(|directory| {
        candidates
            .iter()
            .any(|candidate| directory.join(candidate).is_file())
    })
}

fn executable_names(command: &str) -> Vec<OsString> {
    #[cfg(windows)]
    {
        let command_path = Path::new(command);
        if command_path.extension().is_some() {
            return vec![OsString::from(command)];
        }
        let path_ext = env::var_os("PATHEXT")
            .and_then(|value| value.into_string().ok())
            .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_owned());
        path_ext
            .split(';')
            .filter(|extension| !extension.trim().is_empty())
            .map(|extension| OsString::from(format!("{command}{extension}")))
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec![OsString::from(command)]
    }
}

/// External agent workspace runtime rules used by integration tests.
#[doc(hidden)]
pub mod rules {
    use std::ffi::OsString;

    pub fn executable_names(command: &str) -> Vec<OsString> {
        super::executable_names(command)
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn workspace_display_path(workspace_dir: &Path, path: &Path) -> String {
    if workspace_dir.file_name().and_then(|name| name.to_str()) != Some(".kerminal") {
        return path_to_string(path);
    }
    let Ok(relative) = path.strip_prefix(workspace_dir) else {
        return path_to_string(path);
    };
    let suffix = relative.to_string_lossy().replace('\\', "/");
    if suffix.is_empty() {
        "~/.kerminal".to_owned()
    } else {
        format!("~/.kerminal/{suffix}")
    }
}
