import { describe, expect, it } from "vitest";
import {
  resolveContextInspectorBoundaryFocus,
  resolveContextInspectorInitialFocus,
} from "../../../../../src/features/tool-panel/context-inspector";

const targets = [
  { id: "action:disabled", kind: "action" as const, disabled: true },
  { id: "action:open", kind: "action" as const },
  { id: "navigation:cwd", kind: "navigation" as const },
];

describe("contextInspectorFocusModel", () => {
  it("优先聚焦首个可用动作", () => {
    expect(resolveContextInspectorInitialFocus(targets)).toBe("action:open");
  });

  it("没有可用动作时退化到跳转项", () => {
    expect(
      resolveContextInspectorInitialFocus([
        targets[0]!,
        targets[2]!,
      ]),
    ).toBe("navigation:cwd");
  });

  it("Home 和 End 忽略 disabled 项", () => {
    expect(resolveContextInspectorBoundaryFocus("Home", targets)).toBe(
      "action:open",
    );
    expect(resolveContextInspectorBoundaryFocus("End", targets)).toBe(
      "navigation:cwd",
    );
  });
});
