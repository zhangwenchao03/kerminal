//! File-backed configuration repository primitives.
//!
//! @author kongweiguang

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

mod documents;

use documents::{
    ProfileTomlDocument, RemoteHostGroupsTomlDocument, RemoteHostTomlDocument,
    SettingsTomlDocument, SnippetTomlDocument, WorkflowTomlDocument,
};
use serde::{de::DeserializeOwned, Serialize};
use uuid::Uuid;

use crate::{
    models::{
        profile::TerminalProfile,
        remote_host::{
            RemoteHost, RemoteHostAuthType, RemoteHostCredentialStatus, RemoteHostGroup,
            RemoteHostGroupWithHosts, SshOptions,
        },
        settings::AppSettings,
        snippet::CommandSnippet,
        workflow::{CommandWorkflow, CommandWorkflowStep},
    },
    storage::file_store::{
        FileStore, FileStoreChange, FileStoreError, FileStoreResult, TomlDocument, TomlParseError,
    },
};

/// Kerminal file-backed config schema version.
pub const CONFIG_FILE_SCHEMA_VERSION: u32 = 1;
const SETTINGS_RELATIVE_PATH: &str = "settings.toml";
const PROFILES_RELATIVE_DIR: &str = "profiles";
const HOSTS_RELATIVE_DIR: &str = "hosts";
const HOST_GROUPS_RELATIVE_PATH: &str = "hosts/groups.toml";
const SNIPPETS_RELATIVE_DIR: &str = "snippets";
const WORKFLOWS_RELATIVE_DIR: &str = "workflows";
const UNGROUPED_REMOTE_HOST_GROUP_ID: &str = "__ungrouped__";
const UNGROUPED_REMOTE_HOST_GROUP_NAME: &str = "默认分组";

/// File repository for low-frequency, agent-editable Kerminal config.
#[derive(Debug, Clone)]
pub struct ConfigFileStore {
    files: FileStore,
}

impl ConfigFileStore {
    /// Create a config repository rooted at the Kerminal config workspace.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            files: FileStore::new(root),
        }
    }

    /// Return the root directory used by this repository.
    pub fn root(&self) -> &Path {
        self.files.root()
    }

    /// Read `settings.toml` and validate it into the runtime settings model.
    pub fn read_settings(&self) -> FileStoreResult<AppSettings> {
        let document = self
            .files
            .read_toml::<SettingsTomlDocument>(SETTINGS_RELATIVE_PATH)?;
        document.into_settings()
    }

    /// Read `settings.toml`, returning defaults when the file is not initialized yet.
    pub fn read_settings_or_default(&self) -> FileStoreResult<AppSettings> {
        match self.read_settings() {
            Ok(settings) => Ok(settings),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => {
                Ok(AppSettings::default())
            }
            Err(error) => Err(error),
        }
    }

    /// Write runtime settings to `settings.toml`.
    pub fn write_settings(&self, settings: &AppSettings) -> FileStoreResult<PathBuf> {
        let document = SettingsTomlDocument::from_settings(settings.clone())?;
        self.files.write_toml(SETTINGS_RELATIVE_PATH, &document)
    }

    /// Read a profile from `profiles/<profile-id>.toml`.
    pub fn read_profile(&self, profile_id: &str) -> FileStoreResult<TerminalProfile> {
        let relative_path = profile_relative_path(profile_id)?;
        let document = self.files.read_toml::<ProfileTomlDocument>(relative_path)?;
        let profile = document.into_profile()?;
        if profile.id != profile_id {
            return Err(FileStoreError::TomlParse(TomlParseError::single(
                1,
                1,
                format!(
                    "profile file id mismatch: expected {profile_id}, found {}",
                    profile.id
                ),
            )));
        }
        Ok(profile)
    }

    /// Read all profile TOML files ordered by sort order and name.
    pub fn list_profiles(&self) -> FileStoreResult<Vec<TerminalProfile>> {
        let profiles_dir = self.files.path_for(PROFILES_RELATIVE_DIR)?;
        let entries = match fs::read_dir(&profiles_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };

        let mut profiles = Vec::new();
        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("toml") {
                continue;
            }
            let Some(profile_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            profiles.push(self.read_profile(profile_id)?);
        }

        profiles.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(profiles)
    }

    /// Read one profile, returning `None` when the profile file does not exist.
    pub fn profile_by_id(&self, profile_id: &str) -> FileStoreResult<Option<TerminalProfile>> {
        match self.read_profile(profile_id) {
            Ok(profile) => Ok(Some(profile)),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Write a profile to `profiles/<profile-id>.toml`.
    pub fn write_profile(&self, profile: &TerminalProfile) -> FileStoreResult<PathBuf> {
        let relative_path = profile_relative_path(&profile.id)?;
        let document = ProfileTomlDocument::from_profile(profile.clone());
        self.files.write_toml(relative_path, &document)
    }

    /// Apply profile writes/deletes as a single recoverable change set.
    pub fn apply_profile_change_set(
        &self,
        profiles_to_write: &[TerminalProfile],
        profile_ids_to_delete: &[String],
    ) -> FileStoreResult<()> {
        let timestamp = timestamp_now();
        let change_set_id = format!("profiles-{}", Uuid::new_v4());
        let mut changes = Vec::with_capacity(profiles_to_write.len() + profile_ids_to_delete.len());

        for profile in profiles_to_write {
            let relative_path = profile_relative_path(&profile.id)?;
            let document = ProfileTomlDocument::from_profile(profile.clone());
            changes.push(FileStoreChange::new(
                relative_path,
                document.encode_toml()?.into_bytes(),
            )?);
        }

        for profile_id in profile_ids_to_delete {
            changes.push(FileStoreChange::delete(profile_relative_path(profile_id)?)?);
        }

        self.files
            .apply_change_set(&change_set_id, &timestamp, changes)?;
        Ok(())
    }

    /// Read all snippet TOML files ordered by sort order and title.
    pub fn list_snippets(&self) -> FileStoreResult<Vec<CommandSnippet>> {
        let snippets_dir = self.files.path_for(SNIPPETS_RELATIVE_DIR)?;
        let entries = match fs::read_dir(&snippets_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };

        let mut snippets = Vec::new();
        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("toml") {
                continue;
            }
            let Some(snippet_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            snippets.push(self.read_snippet(snippet_id)?);
        }

        sort_snippets(&mut snippets);
        Ok(snippets)
    }

    /// Read one command snippet by id.
    pub fn snippet_by_id(&self, snippet_id: &str) -> FileStoreResult<Option<CommandSnippet>> {
        match self.read_snippet(snippet_id) {
            Ok(snippet) => Ok(Some(snippet)),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Return the next snippet sort order.
    pub fn next_snippet_sort_order(&self) -> FileStoreResult<i64> {
        Ok(self
            .list_snippets()?
            .into_iter()
            .map(|snippet| snippet.sort_order)
            .max()
            .unwrap_or(0)
            + 10)
    }

    /// Apply snippet writes/deletes as one recoverable change set.
    pub fn apply_snippet_change_set(
        &self,
        snippets_to_write: &[CommandSnippet],
        snippet_ids_to_delete: &[String],
    ) -> FileStoreResult<()> {
        let timestamp = timestamp_now();
        let change_set_id = format!("snippets-{}", Uuid::new_v4());
        let mut changes = Vec::with_capacity(snippets_to_write.len() + snippet_ids_to_delete.len());

        for snippet in snippets_to_write {
            let relative_path = snippet_relative_path(&snippet.id)?;
            let document = SnippetTomlDocument::from_snippet(snippet.clone());
            changes.push(FileStoreChange::new(
                relative_path,
                document.encode_toml()?.into_bytes(),
            )?);
        }

        for snippet_id in snippet_ids_to_delete {
            changes.push(FileStoreChange::delete(snippet_relative_path(snippet_id)?)?);
        }

        self.files
            .apply_change_set(&change_set_id, &timestamp, changes)?;
        Ok(())
    }

    /// Read all workflow TOML files ordered by sort order and title.
    pub fn list_workflows(&self) -> FileStoreResult<Vec<CommandWorkflow>> {
        let workflows_dir = self.files.path_for(WORKFLOWS_RELATIVE_DIR)?;
        let entries = match fs::read_dir(&workflows_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };

        let mut workflows = Vec::new();
        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("toml") {
                continue;
            }
            let Some(workflow_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            workflows.push(self.read_workflow(workflow_id)?);
        }

        sort_workflows(&mut workflows);
        Ok(workflows)
    }

    /// Read one command workflow by id.
    pub fn workflow_by_id(&self, workflow_id: &str) -> FileStoreResult<Option<CommandWorkflow>> {
        match self.read_workflow(workflow_id) {
            Ok(workflow) => Ok(Some(workflow)),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Return the next workflow sort order.
    pub fn next_workflow_sort_order(&self) -> FileStoreResult<i64> {
        Ok(self
            .list_workflows()?
            .into_iter()
            .map(|workflow| workflow.sort_order)
            .max()
            .unwrap_or(0)
            + 10)
    }

    /// Apply workflow writes/deletes as one recoverable change set.
    pub fn apply_workflow_change_set(
        &self,
        workflows_to_write: &[CommandWorkflow],
        workflow_ids_to_delete: &[String],
    ) -> FileStoreResult<()> {
        let timestamp = timestamp_now();
        let change_set_id = format!("workflows-{}", Uuid::new_v4());
        let mut changes =
            Vec::with_capacity(workflows_to_write.len() + workflow_ids_to_delete.len());

        for workflow in workflows_to_write {
            let relative_path = workflow_relative_path(&workflow.id)?;
            let document = WorkflowTomlDocument::from_workflow(workflow.clone());
            changes.push(FileStoreChange::new(
                relative_path,
                document.encode_toml()?.into_bytes(),
            )?);
        }

        for workflow_id in workflow_ids_to_delete {
            changes.push(FileStoreChange::delete(workflow_relative_path(
                workflow_id,
            )?)?);
        }

        self.files
            .apply_change_set(&change_set_id, &timestamp, changes)?;
        Ok(())
    }

    /// Read all remote host groups from `hosts/groups.toml`.
    pub fn list_remote_host_groups(&self) -> FileStoreResult<Vec<RemoteHostGroup>> {
        match self
            .files
            .read_toml::<RemoteHostGroupsTomlDocument>(HOST_GROUPS_RELATIVE_PATH)
        {
            Ok(document) => document.into_groups(),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error),
        }
    }

    /// Read one remote host group by id.
    pub fn remote_host_group_by_id(
        &self,
        group_id: &str,
    ) -> FileStoreResult<Option<RemoteHostGroup>> {
        Ok(self
            .list_remote_host_groups()?
            .into_iter()
            .find(|group| group.id == group_id))
    }

    /// Read one remote host from `hosts/<id>.toml`.
    pub fn remote_host_by_id(&self, host_id: &str) -> FileStoreResult<Option<RemoteHost>> {
        match self.read_remote_host(host_id) {
            Ok(host) => Ok(Some(host)),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Read all remote host TOML files, ordered by group, sort order and name.
    pub fn list_remote_hosts(&self) -> FileStoreResult<Vec<RemoteHost>> {
        let mut hosts = self.list_remote_host_metadata()?;
        sort_remote_hosts(&mut hosts);
        Ok(hosts)
    }

    /// Read public remote host TOML files.
    pub fn list_remote_host_metadata(&self) -> FileStoreResult<Vec<RemoteHost>> {
        let hosts_dir = self.files.path_for(HOSTS_RELATIVE_DIR)?;
        let entries = match fs::read_dir(&hosts_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };

        let mut hosts = Vec::new();
        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("toml") {
                continue;
            }
            let Some(host_id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            if host_id == "groups" {
                continue;
            }
            hosts.push(self.read_remote_host_metadata(host_id)?);
        }

        sort_remote_hosts(&mut hosts);
        Ok(hosts)
    }

    /// Read the grouped host tree. The ungrouped group is runtime-only and never written.
    pub fn list_remote_host_tree(&self) -> FileStoreResult<Vec<RemoteHostGroupWithHosts>> {
        let groups = self.list_remote_host_groups()?;
        let hosts = self.list_remote_hosts()?;
        let mut tree = groups
            .into_iter()
            .map(|group| {
                let mut group_hosts = hosts
                    .iter()
                    .filter(|host| host.group_id.as_deref() == Some(group.id.as_str()))
                    .cloned()
                    .collect::<Vec<_>>();
                sort_remote_hosts(&mut group_hosts);
                RemoteHostGroupWithHosts {
                    id: group.id,
                    name: group.name,
                    sort_order: group.sort_order,
                    created_at: group.created_at,
                    updated_at: group.updated_at,
                    hosts: group_hosts,
                }
            })
            .collect::<Vec<_>>();

        let mut ungrouped_hosts = hosts
            .into_iter()
            .filter(|host| host.group_id.is_none())
            .collect::<Vec<_>>();
        sort_remote_hosts(&mut ungrouped_hosts);
        if !ungrouped_hosts.is_empty() {
            tree.insert(
                0,
                RemoteHostGroupWithHosts {
                    id: UNGROUPED_REMOTE_HOST_GROUP_ID.to_owned(),
                    name: UNGROUPED_REMOTE_HOST_GROUP_NAME.to_owned(),
                    sort_order: i64::MIN,
                    created_at: String::new(),
                    updated_at: String::new(),
                    hosts: ungrouped_hosts,
                },
            );
        }
        Ok(tree)
    }

    /// Return the next group sort order.
    pub fn next_remote_host_group_sort_order(&self) -> FileStoreResult<i64> {
        Ok(self
            .list_remote_host_groups()?
            .into_iter()
            .map(|group| group.sort_order)
            .max()
            .unwrap_or(0)
            + 10)
    }

    /// Return the next host sort order within a group or ungrouped area.
    pub fn next_remote_host_sort_order(&self, group_id: Option<&str>) -> FileStoreResult<i64> {
        Ok(self
            .list_remote_hosts()?
            .into_iter()
            .filter(|host| host.group_id.as_deref() == group_id)
            .map(|host| host.sort_order)
            .max()
            .unwrap_or(0)
            + 10)
    }

    /// Apply remote host/group writes as one recoverable change set.
    pub fn apply_remote_host_change_set(
        &self,
        groups: Option<&[RemoteHostGroup]>,
        hosts_to_write: &[RemoteHost],
        host_ids_to_delete: &[String],
    ) -> FileStoreResult<()> {
        let timestamp = timestamp_now();
        let change_set_id = format!("remote-hosts-{}", Uuid::new_v4());
        let mut changes = Vec::new();

        if let Some(groups) = groups {
            let document = RemoteHostGroupsTomlDocument::from_groups(groups.to_vec());
            changes.push(FileStoreChange::new(
                HOST_GROUPS_RELATIVE_PATH,
                document.encode_toml()?.into_bytes(),
            )?);
        }

        for host in hosts_to_write {
            let host_path = remote_host_relative_path(&host.id)?;
            let host_document = RemoteHostTomlDocument::from_host(host.clone());
            changes.push(FileStoreChange::new(
                host_path,
                host_document.encode_toml()?.into_bytes(),
            )?);
        }

        for host_id in host_ids_to_delete {
            changes.push(FileStoreChange::delete(remote_host_relative_path(
                host_id,
            )?)?);
        }

        self.files
            .apply_change_set(&change_set_id, &timestamp, changes)?;
        Ok(())
    }

    fn read_remote_host(&self, host_id: &str) -> FileStoreResult<RemoteHost> {
        self.read_remote_host_metadata(host_id)
    }

    fn read_remote_host_metadata(&self, host_id: &str) -> FileStoreResult<RemoteHost> {
        let relative_path = remote_host_relative_path(host_id)?;
        let document = self
            .files
            .read_toml::<RemoteHostTomlDocument>(&relative_path)?;
        let host = document.into_host()?;
        if host.id != host_id {
            return Err(FileStoreError::TomlParse(TomlParseError::single(
                1,
                1,
                format!(
                    "remote host file id mismatch: expected {host_id}, found {}",
                    host.id
                ),
            )));
        }
        Ok(host)
    }

    fn read_snippet(&self, snippet_id: &str) -> FileStoreResult<CommandSnippet> {
        let relative_path = snippet_relative_path(snippet_id)?;
        let document = self.files.read_toml::<SnippetTomlDocument>(relative_path)?;
        let snippet = document.into_snippet()?;
        if snippet.id != snippet_id {
            return Err(FileStoreError::TomlParse(TomlParseError::single(
                1,
                1,
                format!(
                    "snippet file id mismatch: expected {snippet_id}, found {}",
                    snippet.id
                ),
            )));
        }
        Ok(snippet)
    }

    fn read_workflow(&self, workflow_id: &str) -> FileStoreResult<CommandWorkflow> {
        let relative_path = workflow_relative_path(workflow_id)?;
        let document = self
            .files
            .read_toml::<WorkflowTomlDocument>(relative_path)?;
        let workflow = document.into_workflow()?;
        if workflow.id != workflow_id {
            return Err(FileStoreError::TomlParse(TomlParseError::single(
                1,
                1,
                format!(
                    "workflow file id mismatch: expected {workflow_id}, found {}",
                    workflow.id
                ),
            )));
        }
        Ok(workflow)
    }
}

fn validate_schema_version(schema_version: u32) -> FileStoreResult<()> {
    if schema_version == CONFIG_FILE_SCHEMA_VERSION {
        return Ok(());
    }

    Err(FileStoreError::TomlParse(TomlParseError::single(
        1,
        1,
        format!(
            "unsupported config schema_version: {schema_version}, expected {CONFIG_FILE_SCHEMA_VERSION}"
        ),
    )))
}

fn profile_relative_path(profile_id: &str) -> FileStoreResult<PathBuf> {
    let profile_id = profile_id.trim();
    if profile_id.is_empty()
        || profile_id == "."
        || profile_id == ".."
        || !profile_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(FileStoreError::InvalidPath(format!(
            "invalid profile id: {profile_id}"
        )));
    }

    Ok(PathBuf::from("profiles").join(format!("{profile_id}.toml")))
}

fn snippet_relative_path(snippet_id: &str) -> FileStoreResult<PathBuf> {
    Ok(PathBuf::from(SNIPPETS_RELATIVE_DIR).join(format!(
        "{}.toml",
        sanitize_file_id("snippet id", snippet_id)?
    )))
}

fn workflow_relative_path(workflow_id: &str) -> FileStoreResult<PathBuf> {
    Ok(PathBuf::from(WORKFLOWS_RELATIVE_DIR).join(format!(
        "{}.toml",
        sanitize_file_id("workflow id", workflow_id)?
    )))
}

fn remote_host_relative_path(host_id: &str) -> FileStoreResult<PathBuf> {
    Ok(PathBuf::from(HOSTS_RELATIVE_DIR).join(format!(
        "{}.toml",
        sanitize_file_id("remote host id", host_id)?
    )))
}

fn sanitize_file_id(field: &str, value: &str) -> FileStoreResult<String> {
    let value = value.trim();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value == "groups"
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(FileStoreError::InvalidPath(format!(
            "invalid {field}: {value}"
        )));
    }
    Ok(value.to_owned())
}

fn credential_status_from_metadata(
    auth_type: RemoteHostAuthType,
    secret_ref: Option<&str>,
) -> RemoteHostCredentialStatus {
    if matches!(auth_type, RemoteHostAuthType::Agent) {
        return RemoteHostCredentialStatus::Agent;
    }
    if secret_ref.is_some_and(|value| !value.trim().is_empty()) {
        return RemoteHostCredentialStatus::Vault;
    }
    RemoteHostCredentialStatus::Missing
}

fn normalize_jump_host_credential_statuses(mut options: SshOptions) -> SshOptions {
    for jump_host in &mut options.jump_hosts {
        jump_host.credential_status =
            credential_status_from_metadata(jump_host.auth_type, jump_host.secret_ref.as_deref());
    }
    options
}

fn sort_remote_hosts(hosts: &mut [RemoteHost]) {
    hosts.sort_by(|left, right| {
        left.group_id
            .cmp(&right.group_id)
            .then_with(|| left.sort_order.cmp(&right.sort_order))
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn sort_snippets(snippets: &mut [CommandSnippet]) {
    snippets.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.title.cmp(&right.title))
    });
}

fn sort_workflows(workflows: &mut [CommandWorkflow]) {
    workflows.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.title.cmp(&right.title))
    });
}

fn sort_workflow_steps(steps: &mut [CommandWorkflowStep]) {
    steps.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.title.cmp(&right.title))
    });
}

fn timestamp_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn encode_toml<T: Serialize>(value: &T) -> FileStoreResult<String> {
    toml::to_string_pretty(value).map_err(|error| FileStoreError::TomlEncode(error.to_string()))
}

fn decode_toml<T: DeserializeOwned>(source: &str) -> Result<T, TomlParseError> {
    toml::from_str(source).map_err(|error| TomlParseError::single(1, 1, error.to_string()))
}

fn toml_validation_error(error: crate::error::AppError) -> FileStoreError {
    FileStoreError::TomlParse(TomlParseError::single(1, 1, error.to_string()))
}

fn reject_secret_keys_in_host_toml(source: &str) -> Result<(), TomlParseError> {
    for (line_index, line) in source.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with("credential_secret")
            || trimmed.starts_with("credentialSecret")
            || trimmed.contains(".credential_secret")
            || trimmed.contains(".credentialSecret")
        {
            return Err(TomlParseError::single(
                line_index + 1,
                1,
                "ordinary host config must not contain credential secret fields; save credentials through encrypted vault",
            ));
        }
    }
    Ok(())
}
