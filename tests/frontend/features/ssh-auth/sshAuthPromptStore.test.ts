import { beforeEach, describe, expect, it } from "vitest";
import type { SshAuthPromptRequest } from "../../../../src/lib/sshAuthApi";
import {
  createSshAuthPromptStore,
  type SshAuthPromptStore,
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
  let store: SshAuthPromptStore;

  beforeEach(() => {
    store = createSshAuthPromptStore();
  });

  it("queues prompts in order and resolves the completed prompt", async () => {
    const first = store.request({ prompt: targetPasswordPrompt });
    const second = store.request({
      prompt: {
        ...targetPasswordPrompt,
        promptId: "ssh-auth:target:kong@dev.example.com:22:keyPassphrase",
        secretKind: "keyPassphrase",
      },
    });

    const current = store.getCurrent();
    expect(current?.id).toBe("ssh-auth-prompt-1");
    expect(current?.options.prompt.promptId).toBe(targetPasswordPrompt.promptId);

    store.complete("ssh-auth-prompt-1", {
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
    });

    await expect(first).resolves.toEqual({
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
    });
    expect(store.getCurrent()?.id).toBe("ssh-auth-prompt-2");

    store.cancel("ssh-auth-prompt-2");
    await expect(second).resolves.toBeNull();
    expect(store.getCurrent()).toBeNull();
  });

  it("rejects failed prompts without leaking state into another store", async () => {
    const failed = store.request({ prompt: targetPasswordPrompt });
    store.fail("ssh-auth-prompt-1", new Error("submit failed"));

    await expect(failed).rejects.toThrow("submit failed");

    const isolatedStore = createSshAuthPromptStore();
    const pending = isolatedStore.request({ prompt: targetPasswordPrompt });
    expect(store.getCurrent()).toBeNull();

    isolatedStore.cancel("ssh-auth-prompt-1");
    await expect(pending).resolves.toBeNull();
    expect(isolatedStore.getCurrent()).toBeNull();
  });
});
