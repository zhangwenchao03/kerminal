import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("sshCommandApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("executes an SSH command through the Tauri command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      durationMs: 12,
      exitCode: 0,
      host: "prod.internal",
      hostId: "prod-api",
      hostName: "prod api",
      maxOutputBytes: 4096,
      port: 22,
      stderr: "",
      stderrBytes: 0,
      stderrTruncated: false,
      stdout: "configured",
      stdoutBytes: 10,
      stdoutTruncated: false,
      success: true,
      username: "deploy",
    });
    const { executeSshCommand } = await import("./sshCommandApi");

    const output = await executeSshCommand({
      command: "printf ok",
      hostId: "prod-api",
      maxOutputBytes: 4096,
      timeoutSeconds: 15,
    });

    expect(output.success).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("ssh_command_execute", {
      request: {
        command: "printf ok",
        hostId: "prod-api",
        maxOutputBytes: 4096,
        timeoutSeconds: 15,
      },
    });
  });

  it("returns a Chinese browser preview response outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { executeSshCommand } = await import("./sshCommandApi");

    const output = await executeSshCommand({
      command: "printf ok",
      hostId: "host-lab",
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(output.success).toBe(true);
    expect(output.stdout).toContain("浏览器预览模式");
  });
});
