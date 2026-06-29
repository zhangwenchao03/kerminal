import { invoke, isTauri } from "@tauri-apps/api/core";

export interface WorkspaceSyncStatus {
  workspaceRoot: string;
  git: {
    available: boolean;
    executable: string | null;
    repositoryInitialized: boolean;
    status: string;
  };
  gitignore: {
    path: string;
    present: boolean;
    hasRequiredRules: boolean;
    missingRules: string[];
  };
  vault: {
    secretsDir: string;
    vaultPath: string;
    vaultPresent: boolean;
    vaultKeyPath: string;
    vaultKeyPresent: boolean;
    keyId: string | null;
    entryCount: number;
    status: string;
  };
}

export interface VaultKeyOperationResult {
  keyId: string;
  dryRun: boolean;
  entryCount: number;
  backupCreated: boolean;
}

export type WorkspaceSyncRunStatus =
  | "success"
  | "warning"
  | "conflict"
  | "error";

export interface WorkspaceSyncRunResult {
  pulled: boolean;
  committed: boolean;
  skippedRemote: boolean;
  commitHash: string | null;
  message: string;
  status: WorkspaceSyncRunStatus;
}

export const browserWorkspaceSyncStatus: WorkspaceSyncStatus = {
  workspaceRoot: "~/.kerminal",
  git: {
    available: false,
    executable: null,
    repositoryInitialized: false,
    status: "unavailable",
  },
  gitignore: {
    path: "~/.kerminal/.gitignore",
    present: false,
    hasRequiredRules: false,
    missingRules: ["secrets/vault-key.toml"],
  },
  vault: {
    secretsDir: "~/.kerminal/secrets",
    vaultPath: "~/.kerminal/secrets/vault.toml",
    vaultPresent: false,
    vaultKeyPath: "~/.kerminal/secrets/vault-key.toml",
    vaultKeyPresent: false,
    keyId: null,
    entryCount: 0,
    status: "notInitialized",
  },
};

export async function getWorkspaceSyncStatus(): Promise<WorkspaceSyncStatus> {
  if (!isTauri()) {
    return browserWorkspaceSyncStatus;
  }

  return invoke<WorkspaceSyncStatus>("workspace_sync_status");
}

export async function ensureWorkspaceSync(): Promise<WorkspaceSyncStatus> {
  if (!isTauri()) {
    return {
      ...browserWorkspaceSyncStatus,
      gitignore: {
        ...browserWorkspaceSyncStatus.gitignore,
        present: true,
        hasRequiredRules: true,
        missingRules: [],
      },
      vault: {
        ...browserWorkspaceSyncStatus.vault,
        vaultKeyPresent: true,
        keyId: "workspace-default",
        status: "keyPresent",
      },
    };
  }

  return invoke<WorkspaceSyncStatus>("workspace_sync_ensure");
}

export async function runWorkspaceSync(): Promise<WorkspaceSyncRunResult> {
  if (!isTauri()) {
    return {
      pulled: false,
      committed: false,
      skippedRemote: true,
      commitHash: null,
      message: "浏览器预览无法访问本地 Git，同步需要在桌面应用中运行。",
      status: "warning",
    };
  }

  return invoke<WorkspaceSyncRunResult>("workspace_sync_run");
}

export async function readVaultKeyContent(): Promise<string> {
  if (!isTauri()) {
    return [
      "schema_version = 1",
      'key_id = "workspace-default"',
      'algorithm = "xchacha20poly1305"',
      'created_at = "0"',
      'master_key = "browser-preview-only"',
      "",
    ].join("\n");
  }

  return invoke<string>("workspace_sync_read_key");
}

export async function saveVaultKeyContent(
  keyToml: string,
): Promise<VaultKeyOperationResult> {
  if (!isTauri()) {
    return {
      keyId: "workspace-default",
      dryRun: false,
      entryCount: 0,
      backupCreated: true,
    };
  }

  return invoke<VaultKeyOperationResult>("workspace_sync_save_key", {
    request: { keyToml },
  });
}

export async function exportVaultKey(): Promise<string> {
  if (!isTauri()) {
    return [
      "schema_version = 1",
      'key_id = "workspace-default"',
      'algorithm = "xchacha20poly1305"',
      'created_at = "0"',
      'master_key = "browser-fallback"',
      "",
    ].join("\n");
  }

  return invoke<string>("workspace_sync_export_key");
}

export async function importVaultKey(
  keyToml: string,
  dryRun: boolean,
): Promise<VaultKeyOperationResult> {
  if (!isTauri()) {
    return {
      keyId: "workspace-default",
      dryRun,
      entryCount: 0,
      backupCreated: !dryRun,
    };
  }

  return invoke<VaultKeyOperationResult>("workspace_sync_import_key", {
    request: { keyToml, dryRun },
  });
}

export async function rotateVaultKey(
  dryRun: boolean,
): Promise<VaultKeyOperationResult> {
  if (!isTauri()) {
    return {
      keyId: "workspace-default",
      dryRun,
      entryCount: 0,
      backupCreated: !dryRun,
    };
  }

  return invoke<VaultKeyOperationResult>("workspace_sync_rotate_key", {
    request: { dryRun },
  });
}
