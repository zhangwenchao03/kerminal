import { describe, expect, it } from "vitest";

import {
  createQuickOpenObjectProvider,
  DuplicateQuickOpenProviderError,
  QuickOpenProviderRegistry,
} from "../../../../src/features/quick-open";

describe("QuickOpen provider contracts", () => {
  it("rejects duplicate provider ids", () => {
    const provider = createQuickOpenObjectProvider(
      "hosts",
      ["host"],
      () => [],
    );
    const registry = new QuickOpenProviderRegistry().register(provider);

    expect(() => registry.register(provider)).toThrow(
      DuplicateQuickOpenProviderError,
    );
  });

  it("adapts injected objects without executing actions or stores", async () => {
    const provider = createQuickOpenObjectProvider(
      "workspace",
      ["terminal-pane", "agent-session"],
      ({ text, signal }) => {
        expect(text).toBe("api");
        expect(signal.aborted).toBe(false);
        return [
          {
            kind: "terminal-pane" as const,
            id: "pane-1",
            label: "API shell",
            targetId: "host-1",
          },
          {
            kind: "agent-session" as const,
            id: "agent-1",
            label: "API agent",
            targetId: "host-1",
          },
        ];
      },
    );

    const results = await provider.search({
      text: "api",
      limit: 100,
      signal: new AbortController().signal,
    });

    expect(results.map((result) => result.reference)).toEqual([
      { kind: "terminal-pane", id: "pane-1", targetId: "host-1" },
      { kind: "agent-session", id: "agent-1", targetId: "host-1" },
    ]);
  });
});

