import { describe, expect, it } from "vitest";
import type { PortForwardSummary } from "../../../../../src/lib/portForwardApi";
import {
  buildProxyUrl,
  buildUserProxySetupScript,
  buildUserProxyUndoScript,
  resolveBindHost,
} from "../../../../../src/features/tool-panel/port-forward/portForwardWorkbenchModel";

function networkAssistSession(
  overrides: Partial<PortForwardSummary> = {},
): PortForwardSummary {
  return {
    bindHost: "127.0.0.1",
    createdAt: "1",
    hostId: "host-a",
    hostName: "host a",
    id: "forward-a",
    kind: "remote",
    name: "主机网络助手",
    origin: "networkAssist",
    proxyProtocol: "http",
    proxyUrl: "http://127.0.0.1:18080",
    purpose: "hostNetworkAssist",
    sourcePort: 18080,
    status: "running",
    targetHost: "127.0.0.1",
    targetPort: 18081,
    ...overrides,
  };
}

describe("portForwardWorkbenchModel user proxy scripts", () => {
  it("builds a user-level setup script without requiring root-owned paths", () => {
    const script = buildUserProxySetupScript(networkAssistSession());

    expect(script).toContain('KERM_HOME="${HOME:?HOME is required}"');
    expect(script).toContain('KERM_PROFILE="$KERM_HOME/.profile"');
    expect(script).toContain('git config --global http.proxy "$KERM_PROXY_URL"');
    expect(script).toContain('npm config set proxy "$KERM_PROXY_URL" --location=user');
    expect(script).toContain("pip config --user set global.proxy");
    expect(script).not.toContain("/etc/");
    expect(script).not.toMatch(/\bsudo\b/);
  });

  it("defines undo helpers before restoring user-level tool config", () => {
    const script = buildUserProxyUndoScript(networkAssistSession());

    expect(script).toBeDefined();
    const undoScript = script ?? "";
    expect(undoScript.indexOf("restore_git_config() {")).toBeGreaterThan(-1);
    expect(undoScript.indexOf("restore_git_config() {")).toBeLessThan(
      undoScript.indexOf("restore_git_config http.proxy"),
    );
    expect(undoScript.indexOf("restore_npm_config() {")).toBeLessThan(
      undoScript.indexOf("restore_npm_config proxy"),
    );
    expect(undoScript.indexOf("restore_pip_config() {")).toBeLessThan(
      undoScript.indexOf("  restore_pip_config"),
    );
    expect(undoScript).toContain('rm -f "$KERM_ENV" "$KERM_STATE"');
  });
});

describe("portForwardWorkbenchModel bind and proxy helpers", () => {
  it("keeps custom bind addresses while falling back empty custom input to loopback", () => {
    expect(resolveBindHost("custom", "192.168.1.20")).toBe("192.168.1.20");
    expect(resolveBindHost("custom", "  10.0.0.9  ")).toBe("10.0.0.9");
    expect(resolveBindHost("custom", "   ")).toBe("127.0.0.1");
  });

  it("uses a client-reachable host when building proxy URLs for wildcard binds", () => {
    expect(
      buildProxyUrl({
        bindHost: "0.0.0.0",
        port: 18080,
        protocol: "http",
      }),
    ).toBe("http://127.0.0.1:18080");
    expect(
      buildProxyUrl({
        bindHost: "::",
        port: 18081,
        protocol: "socks5",
      }),
    ).toBe("socks5h://[::1]:18081");
  });
});
