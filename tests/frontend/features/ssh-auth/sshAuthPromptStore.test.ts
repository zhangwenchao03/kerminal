import { beforeEach, describe, expect, it } from "vitest";
import type { SshAuthPromptRequest } from "../../../../src/lib/sshAuthApi";
import {
  __resetSshAuthPromptStoreForTests,
  cancelSshAuthPrompt,
  completeSshAuthPrompt,
  failSshAuthPrompt,
  getCurrentSshAuthPrompt,
  requestSshAuthPrompt,
} from "../../../../src/features/ssh-auth/sshAuthPromptStore";

const targetPasswordPrompt: SshAuthPromptRequest = {
  host: "dev.example.com",
  port: 22,
  promptId: "ssh-auth:target:kong@dev.example.com:22:password",
  reason: "target password is not stored",
  role: "target",
  secretKind: "password",
  username: "kong",
};

describe("sshAuthPromptStore", () => {
  beforeEach(() => {
    __resetSshAuthPromptStoreForTests();
  });

  it("queues prompts in order and resolves the completed prompt", async () => {
    const first = requestSshAuthPrompt({ prompt: targetPasswordPrompt });
    const second = requestSshAuthPrompt({
      prompt: {
        ...targetPasswordPrompt,
        promptId: "ssh-auth:target:kong@dev.example.com:22:keyPassphrase",
        secretKind: "keyPassphrase",
      },
    });

    const current = getCurrentSshAuthPrompt();
    expect(current?.id).toBe("ssh-auth-prompt-1");
    expect(current?.options.prompt.promptId).toBe(targetPasswordPrompt.promptId);

    completeSshAuthPrompt("ssh-auth-prompt-1", {
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
    });

    await expect(first).resolves.toEqual({
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
    });
    expect(getCurrentSshAuthPrompt()?.id).toBe("ssh-auth-prompt-2");

    cancelSshAuthPrompt("ssh-auth-prompt-2");
    await expect(second).resolves.toBeNull();
    expect(getCurrentSshAuthPrompt()).toBeNull();
  });

  it("rejects failed prompts and reset cancels pending prompts", async () => {
    const failed = requestSshAuthPrompt({ prompt: targetPasswordPrompt });
    failSshAuthPrompt("ssh-auth-prompt-1", new Error("submit failed"));

    await expect(failed).rejects.toThrow("submit failed");

    const pending = requestSshAuthPrompt({ prompt: targetPasswordPrompt });
    __resetSshAuthPromptStoreForTests();

    await expect(pending).resolves.toBeNull();
    expect(getCurrentSshAuthPrompt()).toBeNull();
  });
});
