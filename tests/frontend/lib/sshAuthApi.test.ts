import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => apiMocks.invoke(...args),
  isTauri: () => apiMocks.isTauri(),
}));

describe("sshAuthApi", () => {
  beforeEach(() => {
    vi.resetModules();
    apiMocks.invoke.mockReset();
    apiMocks.isTauri.mockReset();
  });

  it("submits prompt responses through the Tauri broker command", async () => {
    apiMocks.isTauri.mockReturnValue(true);
    apiMocks.invoke.mockResolvedValue({
      promptId: "ssh-auth:target:dev@example.com:22:password",
      secretKind: "password",
    });
    const { submitSshAuthPromptResponse } = await import(
      "../../../src/lib/sshAuthApi"
    );

    await expect(
      submitSshAuthPromptResponse({
        persistToHostId: "host-1",
        promptId: "ssh-auth:target:dev@example.com:22:password",
        secretKind: "password",
        value: "secret-password",
      }),
    ).resolves.toEqual({
      promptId: "ssh-auth:target:dev@example.com:22:password",
      secretKind: "password",
    });

    expect(apiMocks.invoke).toHaveBeenCalledWith(
      "ssh_auth_submit_prompt_response",
      {
        request: {
          persistToHostId: "host-1",
          promptId: "ssh-auth:target:dev@example.com:22:password",
          secretKind: "password",
          value: "secret-password",
        },
      },
    );
  });

  it("exposes forget, clear, and snapshot commands in Tauri", async () => {
    apiMocks.isTauri.mockReturnValue(true);
    apiMocks.invoke
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce({
        generatedAt: "1760000000",
        sessionOnlySecretCount: 0,
        sessionOnlySecrets: [],
      });
    const {
      clearSshAuthSessionSecrets,
      forgetSshAuthSessionSecret,
      getSshAuthBrokerSnapshot,
    } = await import("../../../src/lib/sshAuthApi");

    await expect(
      forgetSshAuthSessionSecret({
        promptId: "ssh-auth:target:dev@example.com:22:password",
        secretKind: "password",
      }),
    ).resolves.toBe(true);
    await expect(clearSshAuthSessionSecrets()).resolves.toBe(2);
    await expect(getSshAuthBrokerSnapshot()).resolves.toMatchObject({
      sessionOnlySecretCount: 0,
    });

    expect(apiMocks.invoke).toHaveBeenNthCalledWith(
      1,
      "ssh_auth_forget_session_secret",
      {
        request: {
          promptId: "ssh-auth:target:dev@example.com:22:password",
          secretKind: "password",
        },
      },
    );
    expect(apiMocks.invoke).toHaveBeenNthCalledWith(
      2,
      "ssh_auth_clear_session_secrets",
    );
    expect(apiMocks.invoke).toHaveBeenNthCalledWith(
      3,
      "ssh_auth_broker_snapshot",
    );
  });

  it("keeps only redacted prompt metadata in browser preview mode", async () => {
    apiMocks.isTauri.mockReturnValue(false);
    const {
      clearSshAuthSessionSecrets,
      forgetSshAuthSessionSecret,
      getSshAuthBrokerSnapshot,
      submitSshAuthPromptResponse,
    } = await import("../../../src/lib/sshAuthApi");

    await submitSshAuthPromptResponse({
      promptId: "ssh-auth:target:dev@example.com:22:password",
      secretKind: "password",
      value: "secret-password",
    });
    const snapshot = await getSshAuthBrokerSnapshot();

    expect(snapshot.sessionOnlySecretCount).toBe(1);
    expect(snapshot.sessionOnlySecrets[0]).toMatchObject({
      promptId: "ssh-auth:target:dev@example.com:22:password",
      secretKind: "password",
    });
    expect(JSON.stringify(snapshot)).not.toContain("secret-password");
    await expect(
      forgetSshAuthSessionSecret({
        promptId: "ssh-auth:target:dev@example.com:22:password",
        secretKind: "password",
      }),
    ).resolves.toBe(true);
    await submitSshAuthPromptResponse({
      promptId: "ssh-auth:target:dev@example.com:22:password",
      secretKind: "password",
      value: "secret-password",
    });
    await expect(clearSshAuthSessionSecrets()).resolves.toBe(1);
    await expect(getSshAuthBrokerSnapshot()).resolves.toMatchObject({
      sessionOnlySecretCount: 0,
    });
    expect(apiMocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects invalid browser preview prompt responses before storing metadata", async () => {
    apiMocks.isTauri.mockReturnValue(false);
    const { getSshAuthBrokerSnapshot, submitSshAuthPromptResponse } =
      await import("../../../src/lib/sshAuthApi");

    await expect(
      submitSshAuthPromptResponse({
        promptId: "ssh-auth:target:dev@example.com:22:password",
        secretKind: "password",
        value: "   ",
      }),
    ).rejects.toThrow("SSH session secret cannot be empty");
    await expect(
      submitSshAuthPromptResponse({
        promptId: "bad\nid",
        secretKind: "password",
        value: "secret-password",
      }),
    ).rejects.toThrow("SSH auth prompt id cannot contain newline");
    await expect(getSshAuthBrokerSnapshot()).resolves.toMatchObject({
      sessionOnlySecretCount: 0,
    });
  });
});
