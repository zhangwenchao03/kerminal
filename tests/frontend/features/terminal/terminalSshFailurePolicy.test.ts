import { describe, expect, it } from "vitest";
import {
  classifySshTerminalFailure,
  createSshTerminalFailureTracker,
  decideSshTerminalReconnect,
  formatSshTerminalFailureMessage,
} from "../../../../src/features/terminal/terminalSshFailurePolicy";

describe("terminalSshFailurePolicy", () => {
  it.each([
    ["authCanceled", "user canceled authentication prompt"],
    ["badCredential", "Permission denied (publickey,password)."],
    ["keyPassphraseMissing", "encrypted private key requires passphrase"],
    ["unknownHostKey", "Unknown server key"],
    ["hostKeyChanged", "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!"],
    ["hostKeyChanged", "Host key verification failed."],
    ["networkUnreachable", "ssh: connect to host lab port 22: No route to host"],
    ["networkUnreachable", "ssh: Could not resolve hostname lab: Name or service not known"],
    ["jumpFailed", "channel 0: open failed: connect failed: Connection refused"],
    ["jumpFailed", "stdio forwarding failed"],
    ["timeout", "ssh: connect to host lab port 22: Connection timed out"],
    ["channelUnsupported", "managed SSH runtime backend does not support SFTP channels yet"],
    ["permissionDenied", "WARNING: UNPROTECTED PRIVATE KEY FILE!"],
    ["remoteExit", "remote command exit code 127"],
    ["canceled", "remote command cancelled"],
    ["cleanupFailed", "cleanup failed while closing SSH"],
    ["remoteShellStartup", "bash: /opt/missing/start.sh: No such file or directory"],
    ["channelUnsupported", "shell request failed on channel 0"],
    ["disconnect", "client_loop: send disconnect: Broken pipe"],
  ] as const)("classifies OpenSSH stderr as %s", (expectedClass, output) => {
    expect(classifySshTerminalFailure(output)).toMatchObject({
      class: expectedClass,
    });
  });

  it("tracks split stderr chunks without exposing output in the classification", () => {
    const tracker = createSshTerminalFailureTracker();

    expect(tracker.append("Permission denied ")).toBeUndefined();
    expect(tracker.append("(publickey,password).")).toMatchObject({
      class: "badCredential",
      retryable: false,
    });
    expect(tracker.current()).toMatchObject({
      class: "badCredential",
    });
  });

  it("stops automatic reconnect for user-action SSH failures", () => {
    const failure = classifySshTerminalFailure(
      "Permission denied (publickey,password).",
    );

    expect(
      decideSshTerminalReconnect({
        appearanceAutoReconnect: true,
        attempt: 0,
        failure,
      }),
    ).toMatchObject({
      autoReconnect: false,
      nextAttempt: 1,
      notice: expect.stringContaining("已停止自动重连"),
    });
    expect(
      formatSshTerminalFailureMessage(failure, "\r\n会话已结束。\r\n"),
    ).toContain("下一步");
  });

  it("provides next action copy without collapsing failures to a generic message", () => {
    for (const output of [
      "Unknown server key",
      "managed SSH runtime backend does not support shell channels yet",
      "cleanup failed while closing SSH",
    ]) {
      const failure = classifySshTerminalFailure(output);

      expect(failure?.userMessage).toContain("下一步");
      expect(failure?.nextAction).toBeTruthy();
      expect(failure?.userMessage).not.toContain("连接失败");
    }
  });

  it("allows bounded automatic reconnect for retryable network failures", () => {
    const failure = classifySshTerminalFailure("Connection reset by peer");

    expect(
      decideSshTerminalReconnect({
        appearanceAutoReconnect: true,
        attempt: 0,
        failure,
      }),
    ).toMatchObject({
      autoReconnect: true,
      nextAttempt: 1,
      notice: expect.stringContaining("第 1/3 次"),
    });
    expect(
      decideSshTerminalReconnect({
        appearanceAutoReconnect: true,
        attempt: 3,
        failure,
      }),
    ).toMatchObject({
      autoReconnect: false,
      notice: expect.stringContaining("达到上限"),
    });
  });
});
