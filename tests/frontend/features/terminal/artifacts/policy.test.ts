import { describe, expect, it } from "vitest";
import {
  classifyTerminalArtifactSensitivity,
  isAllowedTerminalArtifactUrl,
  resolveTerminalArtifactPathStyle,
  terminalArtifactActions,
} from "../../../../../src/features/terminal/artifacts/public";

describe("terminal artifact policy", () => {
  it("uses an explicit URL scheme allowlist", () => {
    expect(isAllowedTerminalArtifactUrl("https://example.com")).toBe(true);
    expect(isAllowedTerminalArtifactUrl("http://localhost:3000")).toBe(true);
    expect(isAllowedTerminalArtifactUrl("file:///tmp/a")).toBe(false);
    expect(isAllowedTerminalArtifactUrl("javascript:alert(1)")).toBe(false);
  });

  it("classifies Windows, POSIX, UNC, and URI styles", () => {
    expect(resolveTerminalArtifactPathStyle("C:\\work\\a.txt")).toBe("windows");
    expect(resolveTerminalArtifactPathStyle("/var/log/a.log")).toBe("posix");
    expect(resolveTerminalArtifactPathStyle("\\\\server\\share\\a")).toBe("unc");
    expect(resolveTerminalArtifactPathStyle("file:///tmp/a")).toBe("uri");
  });

  it("blocks inline secrets and marks secret-like paths sensitive", () => {
    expect(classifyTerminalArtifactSensitivity("password=hunter2")).toBe("blocked");
    expect(classifyTerminalArtifactSensitivity("/home/me/.env.production")).toBe(
      "sensitive",
    );
    expect(classifyTerminalArtifactSensitivity("/tmp/app.log")).toBe("normal");
  });

  it("uses stricter credential blocking for command blocks", () => {
    const commandBlock = "command-block" as const;
    expect(
      classifyTerminalArtifactSensitivity(
        'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload"',
        commandBlock,
      ),
    ).toBe("blocked");
    expect(
      classifyTerminalArtifactSensitivity("deploy --token super-secret", commandBlock),
    ).toBe("blocked");
    expect(
      classifyTerminalArtifactSensitivity("login --password=hunter2", commandBlock),
    ).toBe("blocked");
    expect(
      classifyTerminalArtifactSensitivity(
        "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE aws s3 ls",
        commandBlock,
      ),
    ).toBe("blocked");
    expect(
      classifyTerminalArtifactSensitivity(
        "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        commandBlock,
      ),
    ).toBe("blocked");

    expect(
      classifyTerminalArtifactSensitivity(
        "curl https://example.com/api --retry 3",
        commandBlock,
      ),
    ).toBe("normal");
    expect(
      classifyTerminalArtifactSensitivity("npm run tokenize", commandBlock),
    ).toBe("normal");
    expect(
      classifyTerminalArtifactSensitivity("/tmp/token/report.log", "heuristic"),
    ).toBe("sensitive");
  });

  it("prevents local reveal for remote paths and confirms command reruns", () => {
    const remote = { id: "host-a", kind: "ssh" as const };
    expect(
      terminalArtifactActions(
        { kind: "path", source: "heuristic", value: "/tmp/a" },
        remote,
        "normal",
      ),
    ).toContainEqual(
      expect.objectContaining({ enabled: false, id: "reveal" }),
    );
    expect(
      terminalArtifactActions(
        { kind: "command", source: "command-block", value: "npm test" },
        remote,
        "normal",
      ),
    ).toContainEqual({
      enabled: true,
      id: "rerun-command",
      requiresConfirmation: true,
    });
  });
});
