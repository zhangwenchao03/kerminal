import { describe, expect, it } from "vitest";
import {
  classifySshTerminalFailure,
  createSshTerminalFailureTracker,
  decideSshTerminalReconnect,
  formatSshTerminalFailureMessage,
} from "../../../../src/features/terminal/terminalSshFailurePolicy";

describe("terminalSshFailurePolicy", () => {
  it.each([
    ["authentication", "Permission denied (publickey,password)."],
    ["knownHosts", "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!"],
    ["knownHosts", "Host key verification failed."],
    ["networkUnreachable", "ssh: connect to host lab port 22: No route to host"],
    ["networkUnreachable", "ssh: Could not resolve hostname lab: Name or service not known"],
    ["proxyJump", "channel 0: open failed: connect failed: Connection refused"],
    ["proxyJump", "stdio forwarding failed"],
    ["remoteShellStartup", "bash: /opt/missing/start.sh: No such file or directory"],
    ["remoteShellStartup", "shell request failed on channel 0"],
    ["permission", "WARNING: UNPROTECTED PRIVATE KEY FILE!"],
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
      class: "authentication",
      retryable: false,
    });
    expect(tracker.current()).toMatchObject({
      class: "authentication",
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
    ).toContain("认证失败");
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
