import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SshAuthPromptRequest } from "../../../../src/lib/sshAuthApi";
import { SshAuthPromptHost } from "../../../../src/features/ssh-auth/SshAuthPromptHost";
import {
  __resetSshAuthPromptStoreForTests,
  requestSshAuthPrompt,
} from "../../../../src/features/ssh-auth/sshAuthPromptStore";

const apiMocks = vi.hoisted(() => ({
  submitSshAuthPromptResponse: vi.fn(),
}));

vi.mock("../../../../src/lib/sshAuthApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/sshAuthApi")>()),
  submitSshAuthPromptResponse: (...args: unknown[]) =>
    apiMocks.submitSshAuthPromptResponse(...args),
}));

const targetPasswordPrompt: SshAuthPromptRequest = {
  host: "dev.example.com",
  port: 22,
  promptId: "ssh-auth:target:kong@dev.example.com:22:password",
  reason: "target password is not stored",
  role: "target",
  secretKind: "password",
  username: "kong",
};

describe("SshAuthPromptHost", () => {
  beforeEach(() => {
    apiMocks.submitSshAuthPromptResponse.mockReset();
    __resetSshAuthPromptStoreForTests();
  });

  afterEach(() => {
    __resetSshAuthPromptStoreForTests();
  });

  it("submits queued prompt responses through sshAuthApi", async () => {
    const user = userEvent.setup();
    apiMocks.submitSshAuthPromptResponse.mockResolvedValue({
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
    });
    render(<SshAuthPromptHost />);

    const result = requestSshAuthPrompt({
      persistToHostId: "host-1",
      prompt: targetPasswordPrompt,
    });
    await user.type(await screen.findByLabelText("密码"), "secret-password");
    await user.click(screen.getByRole("button", { name: "继续" }));

    expect(apiMocks.submitSshAuthPromptResponse).toHaveBeenCalledWith({
      persistToHostId: "host-1",
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
      value: "secret-password",
    });
    await expect(result).resolves.toEqual({
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "SSH 密码" })).toBeNull(),
    );
  });

  it("keeps the prompt open when submission fails", async () => {
    const user = userEvent.setup();
    apiMocks.submitSshAuthPromptResponse.mockRejectedValue(
      new Error("vault write failed"),
    );
    render(<SshAuthPromptHost />);

    void requestSshAuthPrompt({
      persistToHostId: "host-1",
      prompt: targetPasswordPrompt,
    });
    await user.type(await screen.findByLabelText("密码"), "secret-password");
    await user.click(screen.getByRole("button", { name: "继续" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "vault write failed",
    );
    expect(screen.getByRole("dialog", { name: "SSH 密码" })).toBeInTheDocument();
  });

  it("clears a previous submission error when the next prompt becomes current", async () => {
    const user = userEvent.setup();
    apiMocks.submitSshAuthPromptResponse.mockRejectedValue(
      new Error("vault write failed"),
    );
    render(<SshAuthPromptHost />);

    const firstResult = requestSshAuthPrompt({
      persistToHostId: "host-1",
      prompt: targetPasswordPrompt,
    });
    await user.type(await screen.findByLabelText("密码"), "secret-password");
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "vault write failed",
    );

    const secondPrompt: SshAuthPromptRequest = {
      ...targetPasswordPrompt,
      host: "next.example.com",
      promptId: "ssh-auth:target:kong@next.example.com:22:password",
    };
    void requestSshAuthPrompt({ prompt: secondPrompt });
    await user.click(screen.getByRole("button", { name: "取消" }));

    await expect(firstResult).resolves.toBeNull();
    await screen.findByText("kong@next.example.com:22");
    await waitFor(() => {
      expect(screen.queryByText("vault write failed")).toBeNull();
    });
  });

  it("resolves null when the user cancels the prompt", async () => {
    const user = userEvent.setup();
    render(<SshAuthPromptHost />);

    const result = requestSshAuthPrompt({ prompt: targetPasswordPrompt });
    await user.click(await screen.findByRole("button", { name: "取消" }));

    await expect(result).resolves.toBeNull();
    expect(apiMocks.submitSshAuthPromptResponse).not.toHaveBeenCalled();
  });
});
