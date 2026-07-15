import {
  getTerminalCommandError,
  createSshTerminalSession,
  type SshTerminalCreateRequest,
  type TerminalOutputEvent,
  type TerminalSessionSummary,
} from "../../lib/terminalApi";
import {
  submitSshAuthPromptResponse,
  type SshAuthPromptPlan,
  type SshAuthPromptRequest,
} from "../../lib/sshAuthApi";
import { requestSshAuthPrompt } from "../ssh-auth/state/index";

const SSH_AUTH_TERMINAL_PROMPT_MAX_RETRIES = 1;

/// SSH session 创建失败时按后端返回的 prompt plan 补齐凭据，再重试一次创建。
export async function createSshTerminalSessionWithAuthRecovery(
  request: SshTerminalCreateRequest,
  onOutput: (event: TerminalOutputEvent) => void,
  promptForSecret: (prompt: SshAuthPromptRequest) => Promise<string | null>,
): Promise<TerminalSessionSummary> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await createSshTerminalSession(request, onOutput);
    } catch (error) {
      const promptPlan = sshAuthPromptPlanFromTerminalError(error);
      if (!promptPlan || attempt >= SSH_AUTH_TERMINAL_PROMPT_MAX_RETRIES) {
        throw error;
      }

      const completed = await runSshTerminalAuthPromptPlan(
        promptPlan,
        request.hostId,
        promptForSecret,
      );
      if (!completed) {
        const cancellationError = new Error("SSH 认证已取消。");
        Object.defineProperty(cancellationError, "cause", {
          configurable: true,
          value: error,
          writable: true,
        });
        throw cancellationError;
      }
    }
  }
}

async function runSshTerminalAuthPromptPlan(
  promptPlan: SshAuthPromptPlan,
  hostId: string,
  promptForSecret: (prompt: SshAuthPromptRequest) => Promise<string | null>,
) {
  for (const prompt of promptPlan.prompts) {
    if (shouldReadSshAuthPromptInTerminal(prompt)) {
      const value = await promptForSecret(prompt);
      if (!value) {
        return false;
      }
      await submitSshAuthPromptResponse({
        promptId: prompt.promptId,
        secretKind: prompt.secretKind,
        value,
      });
      continue;
    }
    const receipt = await requestSshAuthPrompt({
      ...(prompt.role === "target" ? { persistToHostId: hostId } : {}),
      prompt,
    });
    if (!receipt) {
      return false;
    }
  }
  return true;
}

function shouldReadSshAuthPromptInTerminal(prompt: SshAuthPromptRequest) {
  return prompt.secretKind === "password" || prompt.secretKind === "keyPassphrase";
}

function sshAuthPromptPlanFromTerminalError(
  error: unknown,
): SshAuthPromptPlan | null {
  const terminalError = getTerminalCommandError(error);
  if (terminalError?.sshAuthPromptPlan) {
    return isSshAuthPromptPlan(terminalError.sshAuthPromptPlan)
      ? terminalError.sshAuthPromptPlan
      : null;
  }

  const wrappedTerminalError =
    isRecord(error) && isRecord(error.terminalError)
      ? error.terminalError
      : null;
  const wrappedPromptPlan = wrappedTerminalError?.sshAuthPromptPlan;
  return isSshAuthPromptPlan(wrappedPromptPlan) ? wrappedPromptPlan : null;
}

function isSshAuthPromptPlan(value: unknown): value is SshAuthPromptPlan {
  if (!isRecord(value) || !Array.isArray(value.prompts)) {
    return false;
  }
  return value.prompts.every(isSshAuthPromptRequest);
}

function isSshAuthPromptRequest(value: unknown): value is SshAuthPromptRequest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.host === "string" &&
    typeof value.port === "number" &&
    typeof value.promptId === "string" &&
    typeof value.reason === "string" &&
    isSshAuthPromptRole(value.role) &&
    isSshSecretKind(value.secretKind) &&
    typeof value.username === "string"
  );
}

function isSshAuthPromptRole(value: unknown) {
  return (
    value === "target" ||
    (isRecord(value) &&
      isRecord(value.jump) &&
      typeof value.jump.index === "number")
  );
}

function isSshSecretKind(value: unknown) {
  return (
    value === "password" ||
    value === "privateKey" ||
    value === "keyPassphrase"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
