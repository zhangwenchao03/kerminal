import { describe, expect, it } from "vitest";
import {
  WorkspaceActionRegistry,
  requireWorkspaceCapabilities,
  type WorkspaceActionCatalog,
} from "../../../../src/features/workspace-actions";
import {
  buildCommandPaletteItems,
  resolveCommandPaletteFeedback,
  scoreCommandPaletteAction,
} from "../../../../src/features/command-palette";

interface TestCatalog extends WorkspaceActionCatalog {
  inspect: { targetId: string };
  restart: { targetId: string };
}

function registry() {
  return new WorkspaceActionRegistry<TestCatalog>()
    .register({
      effect: "read",
      id: "inspect",
      title: "检查终端",
    })
    .register({
      availability: requireWorkspaceCapabilities("terminal.restart"),
      effect: "remote",
      id: "restart",
      title: "重启会话",
    });
}

describe("commandPaletteModel", () => {
  it("scores title, id and injected metadata without owning another action list", () => {
    const descriptor = registry().get("inspect");
    expect(
      scoreCommandPaletteAction(
        descriptor,
        { category: "终端", keywords: ["diagnose"], scope: "当前窗格" },
        "检查",
      ),
    ).toBeGreaterThan(
      scoreCommandPaletteAction(
        descriptor,
        { category: "终端", keywords: ["diagnose"], scope: "当前窗格" },
        "diagnose",
      ),
    );
  });

  it("derives disabled reason and presentation from descriptor policies", () => {
    const items = buildCommandPaletteItems(
      registry(),
      { capabilities: new Set(["terminal.read"]), revision: "r1" },
      "",
      (descriptor) => ({ targetId: descriptor.id }),
      (descriptor) => ({
        category: "终端",
        keybinding: descriptor.id === "inspect" ? "Ctrl+I" : undefined,
        scope: "当前窗格",
      }),
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      category: "终端",
      disabled: false,
      id: "inspect",
      keybinding: "Ctrl+I",
      scope: "当前窗格",
    });
    expect(items[1]).toMatchObject({
      disabled: true,
      disabledReason: "缺少所需能力：terminal.restart",
      id: "restart",
    });
  });

  it("filters unmatched actions and preserves registration order for empty query", () => {
    const all = buildCommandPaletteItems(
      registry(),
      { revision: "r1" },
      "",
      (descriptor) => ({ targetId: descriptor.id }),
    );
    const filtered = buildCommandPaletteItems(
      registry(),
      { revision: "r1" },
      "inspect",
      (descriptor) => ({ targetId: descriptor.id }),
    );

    expect(all.map((item) => item.id)).toEqual(["inspect", "restart"]);
    expect(filtered.map((item) => item.id)).toEqual(["inspect"]);
  });

  it("maps stale revisions to an explicit retry message", () => {
    expect(
      resolveCommandPaletteFeedback("inspect", {
        actualRevision: "r2",
        expectedRevision: "r1",
        kind: "stale-context",
      }),
    ).toEqual({
      actionId: "inspect",
      kind: "error",
      message: "工作区上下文已变化，请重试",
    });
  });
});
