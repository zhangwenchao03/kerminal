import { describe, expect, it } from "vitest";
import {
  detectTerminalProtocolArtifacts,
  detectTerminalTextArtifacts,
  stripTerminalArtifactAnsi,
} from "../../../../../src/features/terminal/artifacts/public";

describe("terminal artifact detector", () => {
  it("detects OSC 7 and OSC 8 without retaining control sequences", () => {
    const data =
      "\u001b]7;file://host/home/me\u0007" +
      "\u001b]8;;https://example.com/docs\u0007Docs\u001b]8;;\u0007";
    expect(detectTerminalProtocolArtifacts(data)).toMatchObject([
      { kind: "directory", source: "osc7", value: "file://host/home/me" },
      {
        kind: "link",
        label: "Docs",
        source: "osc8",
        value: "https://example.com/docs",
      },
    ]);
  });

  it("strips ANSI and detects URL, POSIX, Windows, UNC, and log paths", () => {
    const candidates = detectTerminalTextArtifacts(
      "\u001b[31mhttps://example.com/a\u001b[0m /var/log/app.log " +
        "C:\\work\\note.txt \\\\server\\share\\trace.out",
    );
    expect(candidates.map(({ kind, pathStyle, value }) => ({
      kind,
      pathStyle,
      value,
    }))).toEqual([
      { kind: "url", pathStyle: undefined, value: "https://example.com/a" },
      { kind: "log", pathStyle: "unc", value: "\\\\server\\share\\trace.out" },
      { kind: "path", pathStyle: "windows", value: "C:\\work\\note.txt" },
      { kind: "log", pathStyle: "posix", value: "/var/log/app.log" },
    ]);
    expect(stripTerminalArtifactAnsi("\u001b[32mok\u001b[0m")).toBe("ok");
  });

  it("does not guess progress, git diff, or unsafe URL schemes", () => {
    expect(
      detectTerminalTextArtifacts(
        "progress 90% diff --git a/a b/a javascript:alert(1) file:///tmp/a",
      ),
    ).toEqual([]);
  });
});
