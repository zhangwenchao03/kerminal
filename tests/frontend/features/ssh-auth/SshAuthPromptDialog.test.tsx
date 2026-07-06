import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SshAuthPromptRequest } from "../../../../src/lib/sshAuthApi";
import { SshAuthPromptDialog } from "../../../../src/features/ssh-auth/SshAuthPromptDialog";

const targetPasswordPrompt: SshAuthPromptRequest = {
  host: "dev.example.com",
  port: 22,
  promptId: "ssh-auth:target:kong@dev.example.com:22:password",
  reason: "target password is not stored",
  role: "target",
  secretKind: "password",
  username: "kong",
};

describe("SshAuthPromptDialog", () => {
  it("submits a session-only password prompt", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <SshAuthPromptDialog
        onClose={vi.fn()}
        onSubmit={onSubmit}
        open
        prompt={targetPasswordPrompt}
      />,
    );

    await user.type(screen.getByLabelText("密码"), "secret-password");
    await user.click(screen.getByRole("button", { name: "继续" }));

    expect(onSubmit).toHaveBeenCalledWith({
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
      value: "secret-password",
    });
  });

  it("can opt out of encrypted vault persistence for target prompts", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <SshAuthPromptDialog
        onClose={vi.fn()}
        onSubmit={onSubmit}
        open
        persistToHostId="host-1"
        prompt={targetPasswordPrompt}
      />,
    );

    expect(screen.getByRole("switch", { name: "保存到 encrypted vault" }))
      .toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("switch", { name: "保存到 encrypted vault" }));
    await user.type(screen.getByLabelText("密码"), "secret-password");
    await user.click(screen.getByRole("button", { name: "继续" }));

    expect(onSubmit).toHaveBeenCalledWith({
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
      value: "secret-password",
    });
  });

  it("respects a session-only default for target prompts", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <SshAuthPromptDialog
        defaultRememberInVault={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        open
        persistToHostId="host-1"
        prompt={targetPasswordPrompt}
      />,
    );

    expect(screen.getByRole("switch", { name: "保存到 encrypted vault" }))
      .toHaveAttribute("aria-checked", "false");
    await user.type(screen.getByLabelText("密码"), "secret-password");
    await user.click(screen.getByRole("button", { name: "继续" }));

    expect(onSubmit).toHaveBeenCalledWith({
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
      value: "secret-password",
    });
  });

  it("shows private key validation before submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <SshAuthPromptDialog
        onClose={vi.fn()}
        onSubmit={onSubmit}
        open
        persistToHostId="host-1"
        prompt={{
          ...targetPasswordPrompt,
          promptId: "ssh-auth:target:kong@dev.example.com:22:private-key",
          secretKind: "privateKey",
        }}
      />,
    );

    await user.type(screen.getByLabelText("私钥"), "abc");
    expect(screen.getByRole("alert")).toHaveTextContent("请输入完整私钥内容。");
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
