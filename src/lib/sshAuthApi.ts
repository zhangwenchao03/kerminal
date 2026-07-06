import { invoke, isTauri } from "@tauri-apps/api/core";

export type SshAuthSecretKind = "password" | "privateKey" | "keyPassphrase";

export interface SshAuthPromptResponseRequest {
  promptId: string;
  secretKind: SshAuthSecretKind;
  value: string;
  persistToHostId?: string;
}

export interface SshAuthForgetSessionSecretRequest {
  promptId: string;
  secretKind: SshAuthSecretKind;
}

export interface SshSessionSecretReceipt {
  promptId: string;
  secretKind: SshAuthSecretKind;
}

export interface SshSessionSecretSnapshot {
  createdAt: string;
  lastUsedAt: string;
  promptId: string;
  secretKind: SshAuthSecretKind;
}

export interface SshAuthBrokerSnapshot {
  generatedAt: string;
  sessionOnlySecretCount: number;
  sessionOnlySecrets: SshSessionSecretSnapshot[];
}

export type SshAuthPromptRole = "target" | { jump: { index: number } };

export interface SshAuthPromptRequest {
  host: string;
  port: number;
  promptId: string;
  reason: string;
  role: SshAuthPromptRole;
  secretKind: SshAuthSecretKind;
  username: string;
}

export interface SshAuthPromptPlan {
  prompts: SshAuthPromptRequest[];
}

const browserPreviewSecrets = new Map<string, SshSessionSecretSnapshot>();

export async function submitSshAuthPromptResponse(
  request: SshAuthPromptResponseRequest,
): Promise<SshSessionSecretReceipt> {
  if (isTauri()) {
    return invoke<SshSessionSecretReceipt>("ssh_auth_submit_prompt_response", {
      request,
    });
  }

  validateBrowserPreviewPromptResponse(request);
  const now = browserPreviewTimestamp();
  const key = browserPreviewSecretKey(request.promptId, request.secretKind);
  browserPreviewSecrets.set(key, {
    createdAt: browserPreviewSecrets.get(key)?.createdAt ?? now,
    lastUsedAt: now,
    promptId: request.promptId,
    secretKind: request.secretKind,
  });
  return {
    promptId: request.promptId,
    secretKind: request.secretKind,
  };
}

export async function forgetSshAuthSessionSecret(
  request: SshAuthForgetSessionSecretRequest,
): Promise<boolean> {
  if (isTauri()) {
    return invoke<boolean>("ssh_auth_forget_session_secret", { request });
  }

  validateBrowserPreviewPromptId(request.promptId);
  return browserPreviewSecrets.delete(
    browserPreviewSecretKey(request.promptId, request.secretKind),
  );
}

export async function clearSshAuthSessionSecrets(): Promise<number> {
  if (isTauri()) {
    return invoke<number>("ssh_auth_clear_session_secrets");
  }

  const count = browserPreviewSecrets.size;
  browserPreviewSecrets.clear();
  return count;
}

export async function getSshAuthBrokerSnapshot(): Promise<SshAuthBrokerSnapshot> {
  if (isTauri()) {
    return invoke<SshAuthBrokerSnapshot>("ssh_auth_broker_snapshot");
  }

  return {
    generatedAt: browserPreviewTimestamp(),
    sessionOnlySecretCount: browserPreviewSecrets.size,
    sessionOnlySecrets: [...browserPreviewSecrets.values()].sort((left, right) =>
      left.promptId.localeCompare(right.promptId) ||
      left.secretKind.localeCompare(right.secretKind),
    ),
  };
}

function validateBrowserPreviewPromptResponse(
  request: SshAuthPromptResponseRequest,
) {
  validateBrowserPreviewPromptId(request.promptId);
  if (!request.value.trim()) {
    throw new Error("SSH session secret cannot be empty");
  }
}

function validateBrowserPreviewPromptId(promptId: string) {
  if (!promptId.trim()) {
    throw new Error("SSH auth prompt id cannot be empty");
  }
  if (promptId.includes("\n") || promptId.includes("\r")) {
    throw new Error("SSH auth prompt id cannot contain newline");
  }
}

function browserPreviewSecretKey(
  promptId: string,
  secretKind: SshAuthSecretKind,
) {
  return `${promptId}\0${secretKind}`;
}

function browserPreviewTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}
