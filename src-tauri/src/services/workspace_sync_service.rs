//! Workspace Git and vault bootstrap service.
//!
//! @author kongweiguang

use std::{
    fs,
    path::Path,
    process::{Command, Output},
};

use serde::Serialize;

use crate::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
    services::encrypted_vault_service::{EncryptedVaultService, VaultKeyOperationResult},
};

const REQUIRED_GITIGNORE_RULES: &[&str] = &[
    "secrets/vault-key.toml",
    "secrets/vault-key.toml.bak.*",
    ".storage-transactions/",
    "backups/",
    ".storage.lock",
    "storage-manifest.toml",
    "logs/",
    "cache/",
    "temp/",
    "agents/sessions/",
    "workspace/session.json",
    "data/command.sqlite",
    "data/port-forwards/sessions.json",
];

#[derive(Debug, Clone)]
pub struct WorkspaceSyncService {
    paths: KerminalPaths,
    vault: EncryptedVaultService,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSyncStatus {
    pub workspace_root: String,
    pub git: WorkspaceGitStatus,
    pub gitignore: WorkspaceGitignoreStatus,
    pub vault: WorkspaceVaultStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitStatus {
    pub available: bool,
    pub executable: Option<String>,
    pub repository_initialized: bool,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitignoreStatus {
    pub path: String,
    pub present: bool,
    pub has_required_rules: bool,
    pub missing_rules: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceVaultStatus {
    pub secrets_dir: String,
    pub vault_path: String,
    pub vault_present: bool,
    pub vault_key_path: String,
    pub vault_key_present: bool,
    pub key_id: Option<String>,
    pub entry_count: usize,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSyncRunResult {
    pub pulled: bool,
    pub committed: bool,
    pub skipped_remote: bool,
    pub commit_hash: Option<String>,
    pub message: String,
    pub status: WorkspaceSyncRunStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceSyncRunStatus {
    Success,
    Warning,
    Conflict,
    Error,
}

impl WorkspaceSyncService {
    pub fn new(paths: KerminalPaths) -> Self {
        let vault = EncryptedVaultService::new(paths.clone());
        Self { paths, vault }
    }

    pub fn ensure_bootstrap(&self) -> AppResult<WorkspaceSyncStatus> {
        self.paths.ensure_directories()?;
        self.vault.ensure_workspace_key_if_safe()?;
        self.ensure_git_repository_if_available()?;
        self.ensure_gitignore_rules()?;
        self.status()
    }

    pub fn export_vault_key_toml(&self) -> AppResult<String> {
        self.vault.export_key_toml()
    }

    pub fn read_vault_key_toml(&self) -> AppResult<String> {
        self.vault.read_key_toml_source()
    }

    pub fn save_vault_key_toml(&self, key_toml: &str) -> AppResult<VaultKeyOperationResult> {
        self.vault.save_key_toml(key_toml)
    }

    pub fn import_vault_key_toml(
        &self,
        key_toml: &str,
        dry_run: bool,
    ) -> AppResult<VaultKeyOperationResult> {
        self.vault.import_key_toml(key_toml, dry_run)
    }

    pub fn rotate_vault_key(&self, dry_run: bool) -> AppResult<VaultKeyOperationResult> {
        self.vault.rotate_workspace_key(dry_run)
    }

    pub fn run_sync(&self) -> AppResult<WorkspaceSyncRunResult> {
        if which::which("git").is_err() {
            return Ok(WorkspaceSyncRunResult::error("未找到 Git，无法同步。"));
        }
        if !self.paths.root.join(".git").is_dir() {
            return Ok(WorkspaceSyncRunResult::error(
                "Git 仓库尚未初始化，无法同步。",
            ));
        }

        self.ensure_gitignore_rules()?;

        let upstream =
            self.git_output(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])?;
        let has_upstream = upstream.success && !upstream.stdout.trim().is_empty();
        let skipped_remote = !has_upstream;
        let mut pulled = false;
        let mut stash_created = false;

        if has_upstream && self.workspace_has_visible_changes()? {
            let stash = self.git_output(&[
                "stash",
                "push",
                "--include-untracked",
                "-m",
                "kerminal workspace sync",
            ])?;
            if !stash.success {
                return Ok(WorkspaceSyncRunResult::error(git_message(
                    "保存本地变更失败",
                    &stash,
                )));
            }
            stash_created = true;
        }

        if has_upstream {
            let pull = self.git_output(&["pull", "--rebase"])?;
            if pull.success {
                pulled = true;
            } else {
                if stash_created {
                    let restore = self.git_output(&["stash", "pop"])?;
                    if !restore.success {
                        return Ok(WorkspaceSyncRunResult::conflict(
                            pulled,
                            skipped_remote,
                            git_message("拉取失败，且恢复本地变更时出现冲突", &restore),
                        ));
                    }
                }
                return Ok(WorkspaceSyncRunResult::error(git_message(
                    "拉取远程内容失败",
                    &pull,
                )));
            }
        }

        if stash_created {
            let restore = self.git_output(&["stash", "pop"])?;
            if !restore.success {
                return Ok(WorkspaceSyncRunResult::conflict(
                    pulled,
                    skipped_remote,
                    git_message("恢复本地变更时出现冲突，需要手动处理", &restore),
                ));
            }
        }

        let add = self.git_output(&["add", "--all", "--", "."])?;
        if !add.success {
            return Ok(WorkspaceSyncRunResult::error(git_message(
                "暂存本地变更失败",
                &add,
            )));
        }

        let mut reset_local_only_args = Vec::with_capacity(2 + REQUIRED_GITIGNORE_RULES.len());
        reset_local_only_args.push("reset");
        reset_local_only_args.push("--");
        reset_local_only_args.extend(REQUIRED_GITIGNORE_RULES.iter().copied());
        let reset_local_only = self.git_output(&reset_local_only_args)?;
        if !reset_local_only.success {
            return Ok(WorkspaceSyncRunResult::error(git_message(
                "取消暂存本地专用文件失败",
                &reset_local_only,
            )));
        }

        let diff = self.git_output(&["diff", "--cached", "--quiet"])?;
        match diff.code {
            Some(0) => {
                return Ok(WorkspaceSyncRunResult::done(
                    pulled,
                    false,
                    skipped_remote,
                    None,
                    if skipped_remote {
                        "未配置远程，且没有本地变更需要提交。"
                    } else {
                        "已拉取远程内容，没有本地变更需要提交。"
                    },
                ));
            }
            Some(1) => {}
            _ => {
                return Ok(WorkspaceSyncRunResult::error(git_message(
                    "检查本地变更失败",
                    &diff,
                )));
            }
        }

        let commit = self.git_output(&["commit", "-m", "sync: update kerminal workspace"])?;
        if !commit.success {
            let detail = commit.combined_output();
            let message = if detail.contains("Author identity unknown")
                || detail.contains("unable to auto-detect email address")
            {
                "需要先配置 Git user.name 和 user.email，才能提交本地内容。".to_owned()
            } else {
                git_message("提交本地内容失败", &commit)
            };
            return Ok(WorkspaceSyncRunResult::error(message));
        }

        let hash = self
            .git_output(&["rev-parse", "--short", "HEAD"])?
            .stdout
            .trim()
            .to_owned();
        let commit_hash = if hash.is_empty() { None } else { Some(hash) };

        Ok(WorkspaceSyncRunResult::done(
            pulled,
            true,
            skipped_remote,
            commit_hash,
            if skipped_remote {
                "未配置远程，已提交本地变更。"
            } else {
                "已拉取远程内容并提交本地变更。"
            },
        ))
    }

    pub fn status(&self) -> AppResult<WorkspaceSyncStatus> {
        let git_executable = which::which("git").ok();
        let git_available = git_executable.is_some();
        let git = WorkspaceGitStatus {
            available: git_available,
            executable: git_executable.as_ref().map(path_to_string),
            repository_initialized: self.paths.root.join(".git").is_dir(),
            status: if git_available {
                "available".to_owned()
            } else {
                "unavailable".to_owned()
            },
        };
        let gitignore = self.gitignore_status()?;
        let key = if self.paths.vault_key_file().is_file() {
            self.vault.read_key().ok()
        } else {
            None
        };
        let entry_count = self.vault.entry_count().unwrap_or(0);
        let vault_key_present = self.paths.vault_key_file().is_file();
        let vault_present = self.paths.vault_file().is_file();
        let vault_status = match (vault_present, vault_key_present, entry_count) {
            (_, true, _) => "keyPresent",
            (true, false, count) if count > 0 => "keyMissing",
            (true, false, _) => "keyMissingEmptyVault",
            (false, false, _) => "notInitialized",
        };
        Ok(WorkspaceSyncStatus {
            workspace_root: path_to_string(&self.paths.root),
            git,
            gitignore,
            vault: WorkspaceVaultStatus {
                secrets_dir: path_to_string(&self.paths.secrets),
                vault_path: path_to_string(self.paths.vault_file()),
                vault_present,
                vault_key_path: path_to_string(self.paths.vault_key_file()),
                vault_key_present,
                key_id: key.map(|value| value.key_id),
                entry_count,
                status: vault_status.to_owned(),
            },
        })
    }

    fn workspace_has_visible_changes(&self) -> AppResult<bool> {
        let status = self.git_output(&["status", "--porcelain"])?;
        if !status.success {
            return Err(AppError::InvalidInput(git_message(
                "读取 Git 状态失败",
                &status,
            )));
        }
        Ok(!status.stdout.trim().is_empty())
    }

    fn ensure_git_repository_if_available(&self) -> AppResult<()> {
        if self.paths.root.join(".git").is_dir() || which::which("git").is_err() {
            return Ok(());
        }
        let _ = Command::new("git")
            .arg("init")
            .current_dir(&self.paths.root)
            .output();
        Ok(())
    }

    fn ensure_gitignore_rules(&self) -> AppResult<()> {
        let path = self.paths.gitignore_file();
        let current = fs::read_to_string(&path).unwrap_or_default();
        let mut next = current.clone();
        let mut changed = false;
        if !next.trim().is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        for rule in REQUIRED_GITIGNORE_RULES {
            if !gitignore_contains_rule(&current, rule) {
                if !changed {
                    next.push_str("\n# Kerminal managed local-only files\n");
                }
                next.push_str(rule);
                next.push('\n');
                changed = true;
            }
        }
        if changed || !path.is_file() {
            fs::write(path, next)?;
        }
        Ok(())
    }

    fn gitignore_status(&self) -> AppResult<WorkspaceGitignoreStatus> {
        let path = self.paths.gitignore_file();
        let source = fs::read_to_string(&path).unwrap_or_default();
        let missing_rules = REQUIRED_GITIGNORE_RULES
            .iter()
            .filter(|rule| !gitignore_contains_rule(&source, rule))
            .map(|rule| (*rule).to_owned())
            .collect::<Vec<_>>();
        Ok(WorkspaceGitignoreStatus {
            path: path_to_string(&path),
            present: path.is_file(),
            has_required_rules: missing_rules.is_empty(),
            missing_rules,
        })
    }

    fn git_output(&self, args: &[&str]) -> AppResult<GitCommandOutput> {
        Command::new("git")
            .args(args)
            .current_dir(&self.paths.root)
            .output()
            .map(GitCommandOutput::from)
            .map_err(Into::into)
    }
}

impl WorkspaceSyncRunResult {
    fn done(
        pulled: bool,
        committed: bool,
        skipped_remote: bool,
        commit_hash: Option<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            pulled,
            committed,
            skipped_remote,
            commit_hash,
            message: message.into(),
            status: if skipped_remote {
                WorkspaceSyncRunStatus::Warning
            } else {
                WorkspaceSyncRunStatus::Success
            },
        }
    }

    fn conflict(pulled: bool, skipped_remote: bool, message: impl Into<String>) -> Self {
        Self {
            pulled,
            committed: false,
            skipped_remote,
            commit_hash: None,
            message: message.into(),
            status: WorkspaceSyncRunStatus::Conflict,
        }
    }

    fn error(message: impl Into<String>) -> Self {
        Self {
            pulled: false,
            committed: false,
            skipped_remote: false,
            commit_hash: None,
            message: message.into(),
            status: WorkspaceSyncRunStatus::Error,
        }
    }
}

#[derive(Debug, Clone)]
struct GitCommandOutput {
    code: Option<i32>,
    success: bool,
    stdout: String,
    stderr: String,
}

impl GitCommandOutput {
    fn combined_output(&self) -> String {
        [self.stdout.trim(), self.stderr.trim()]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

impl From<Output> for GitCommandOutput {
    fn from(output: Output) -> Self {
        Self {
            code: output.status.code(),
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }
    }
}

fn git_message(prefix: &str, output: &GitCommandOutput) -> String {
    let detail = output.combined_output();
    if detail.is_empty() {
        prefix.to_owned()
    } else {
        format!("{prefix}: {detail}")
    }
}

fn gitignore_contains_rule(source: &str, rule: &str) -> bool {
    source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .any(|line| line == rule)
}

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}
