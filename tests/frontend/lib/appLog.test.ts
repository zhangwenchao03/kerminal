import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppLogTransport } from "../../../src/lib/appLog";

const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => isTauriMock(),
}));

function createTransport(): AppLogTransport {
  return {
    debug: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  };
}

describe("appLog", () => {
  beforeEach(() => {
    isTauriMock.mockReset();
  });

  it("redacts common secret and path material", async () => {
    const { redactSensitiveText } = await import("../../../src/lib/appLog");

    const text = redactSensitiveText(
      "Bearer abc.def password=hunter2 token=secret sk-abcdefghijklmnop C:\\Users\\alice\\.ssh\\id_rsa -----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----",
    );

    expect(text).toContain("Bearer [redacted]");
    expect(text).toContain("password=[redacted]");
    expect(text).toContain("token=[redacted]");
    expect(text).toContain("[redacted-token]");
    expect(text).toContain("[local-path]");
    expect(text).toContain("[redacted-private-key]");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("alice");
    expect(text).not.toContain("abc123");
  });

  it("writes sanitized info logs through the provided transport", async () => {
    const transport = createTransport();
    const { writeAppLog } = await import("../../../src/lib/appLog");

    const result = await writeAppLog(
      "info",
      {
        category: "desktop.notification",
        keyValues: {
          path: "C:\\Users\\alice\\.ssh\\id_rsa",
          token: "abc123",
        },
        message: "notify token=abc123",
      },
      { transport },
    );

    expect(result.written).toBe(true);
    expect(result.message).toBe(
      "[desktop.notification] notify token=[redacted]",
    );
    expect(result.keyValues?.token).toBe("[redacted]");
    expect(result.keyValues?.path).toBe("[local-path]");
    expect(transport.info).toHaveBeenCalledWith(result.message, {
      keyValues: result.keyValues,
    });
  });

  it("drops full command args from structured log fields", async () => {
    const transport = createTransport();
    const { writeAppLog } = await import("../../../src/lib/appLog");

    const result = await writeAppLog(
      "warn",
      {
        category: "agent.launcher",
        keyValues: {
          argv: ["codex", "--prompt", "deploy with token=secret"],
          commandLine: "codex --prompt deploy --api-key=secret",
          env: { OPENAI_API_KEY: "secret" },
        },
        message: "agent exited",
      },
      { transport },
    );

    expect(result.written).toBe(true);
    expect(result.keyValues?.argv).toBe("[redacted-command]");
    expect(result.keyValues?.commandLine).toBe("[redacted-command]");
    expect(result.keyValues?.env).toBe("[redacted-command]");
    expect(JSON.stringify(result.keyValues)).not.toContain("deploy");
    expect(JSON.stringify(result.keyValues)).not.toContain("secret");
  });

  it("skips debug logs unless diagnostic logging is enabled", async () => {
    const transport = createTransport();
    const { writeAppLog } = await import("../../../src/lib/appLog");

    const result = await writeAppLog(
      "debug",
      {
        category: "desktop.window",
        message: "restore state",
      },
      { transport },
    );

    expect(result.written).toBe(false);
    expect(result.skippedReason).toBe("debug-disabled");
    expect(transport.debug).not.toHaveBeenCalled();
  });

  it("allows debug logs when explicitly enabled", async () => {
    const transport = createTransport();
    const { writeAppLog } = await import("../../../src/lib/appLog");

    const result = await writeAppLog(
      "debug",
      {
        category: "desktop.window",
        message: "restore state",
      },
      { enableDebug: true, transport },
    );

    expect(result.written).toBe(true);
    expect(transport.debug).toHaveBeenCalledTimes(1);
  });

  it("is a browser no-op without an injected transport", async () => {
    isTauriMock.mockReturnValue(false);
    const { writeAppLog } = await import("../../../src/lib/appLog");

    const result = await writeAppLog("warn", {
      category: "desktop.lifecycle",
      message: "preview warning",
    });

    expect(result.written).toBe(false);
    expect(result.skippedReason).toBe("not-tauri");
  });

  it("does not throw when the log transport fails", async () => {
    const transport = createTransport();
    vi.mocked(transport.error).mockRejectedValue(new Error("write failed"));
    const { writeAppLog } = await import("../../../src/lib/appLog");

    const result = await writeAppLog(
      "error",
      {
        category: "desktop.lifecycle",
        message: "startup failed",
      },
      { transport },
    );

    expect(result.written).toBe(false);
    expect(result.skippedReason).toBe("transport-error");
  });
});
