import { describe, expect, it } from "vitest";
import type { Machine } from "../../../../../src/features/workspace/types";
import { jumpHostDraftFromMachine } from "../../../../../src/features/machine-sidebar/remote-host-dialog/ssh-jump-panel";

function sshMachine(overrides: Partial<Machine> = {}): Machine {
  return {
    authType: "agent",
    description: "ops@bastion.internal:22",
    host: "bastion.internal",
    id: "host-1",
    kind: "ssh",
    name: "Bastion",
    port: 22,
    status: "offline",
    tags: [],
    username: "ops",
    ...overrides,
  };
}

describe("jumpHostDraftFromMachine", () => {
  it("preserves password authentication and saved secrets from existing hosts", () => {
    expect(
      jumpHostDraftFromMachine(
        sshMachine({
          authType: "password",
          credentialSecret: " jump-secret ",
        }),
      ),
    ).toMatchObject({
      authType: "password",
      credentialSecret: "jump-secret",
      credentialRef: undefined,
      host: "bastion.internal",
      username: "ops",
    });
  });

  it("preserves inline key material when an existing key host has no key path", () => {
    expect(
      jumpHostDraftFromMachine(
        sshMachine({
          authType: "key",
          credentialRef: " ",
          credentialSecret: " -----BEGIN OPENSSH PRIVATE KEY----- ",
        }),
      ),
    ).toMatchObject({
      authType: "key",
      credentialRef: undefined,
      credentialSecret: "-----BEGIN OPENSSH PRIVATE KEY-----",
    });
  });
});
