import { describe, expect, it } from "vitest";
import {
  buildTerminalPaneCardModel,
  isTerminalRuntimePaneMode,
} from "../../../../src/features/terminal/terminalPaneCardModel";
import type { TerminalPane } from "../../../../src/features/workspace/types";

describe("terminalPaneCardModel", () => {
  it("classifies xterm runtime pane modes explicitly", () => {
    const runtimeModes: TerminalPane["mode"][] = [
      "local",
      "ssh",
      "telnet",
      "serial",
      "container",
    ];

    for (const mode of runtimeModes) {
      expect(isTerminalRuntimePaneMode(mode)).toBe(true);
    }

    expect(isTerminalRuntimePaneMode("preview")).toBe(false);
  });

  it("builds stable labels for the pane card shell", () => {
    expect(
      buildTerminalPaneCardModel({
        latencyMs: 18,
        mode: "ssh",
        title: "prod-api",
      }),
    ).toEqual({
      ariaLabel: "prod-api 终端分屏",
      closeAriaLabel: "关闭 prod-api 分屏",
      latencyLabel: "18ms",
      renderKind: "runtime",
      title: "prod-api",
    });
  });

  it("keeps preview panes out of the xterm runtime adapter", () => {
    expect(
      buildTerminalPaneCardModel({
        latencyMs: 0,
        mode: "preview",
        title: "诊断输出",
      }),
    ).toMatchObject({
      latencyLabel: undefined,
      renderKind: "preview",
    });
  });
});
