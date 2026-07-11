import { describe, expect, it, vi } from "vitest";

import {
  QuickOpenCoordinator,
  QuickOpenProviderRegistry,
  type QuickOpenProvider,
} from "../../../../src/features/quick-open";

function provider(
  id: string,
  search: QuickOpenProvider["search"],
): QuickOpenProvider {
  return { id, kinds: ["host"], search };
}

describe("QuickOpenCoordinator", () => {
  it("cancels the previous request and suppresses its stale result", async () => {
    const signals: AbortSignal[] = [];
    const coordinator = new QuickOpenCoordinator({
      getProviders: () => [
        provider("hosts", ({ text, signal }) => {
          signals.push(signal);
          return new Promise((resolve) => {
            setTimeout(
              () => resolve([{ reference: { kind: "host", id: text }, label: text }]),
              text === "old" ? 30 : 1,
            );
          });
        }),
      ],
    });
    const updates = vi.fn();

    const oldSearch = coordinator.search("old", { onUpdate: updates });
    const newSearch = coordinator.search("new", { onUpdate: updates });
    const newest = await newSearch;
    await oldSearch;

    expect(signals[0]?.aborted).toBe(true);
    expect(newest.results.map((result) => result.label)).toEqual(["new"]);
    expect(updates.mock.calls.flat().some((state) =>
      state.status === "ready" && state.query === "old")).toBe(false);
  });

  it("isolates provider failures and returns successful partial data", async () => {
    const registry = new QuickOpenProviderRegistry()
      .register(provider("failed", async () => {
        throw new Error("private provider detail");
      }))
      .register(provider("files", async () => [
        {
          reference: { kind: "workspace-file", id: "README.md" },
          label: "README.md",
        },
      ]));
    const coordinator = new QuickOpenCoordinator({
      getProviders: () => registry.list(),
    });

    const result = await coordinator.search("read");

    expect(result.status).toBe("ready");
    expect(result.results).toHaveLength(1);
    expect(result.failures).toEqual([{ providerId: "failed", reason: "failed" }]);
  });

  it("propagates AbortSignal and caps ranked results at 100", async () => {
    let receivedSignal: AbortSignal | undefined;
    const coordinator = new QuickOpenCoordinator({
      limit: 500,
      getProviders: () => [
        provider("hosts", async ({ signal }) => {
          receivedSignal = signal;
          return Array.from({ length: 150 }, (_, index) => ({
            reference: { kind: "host" as const, id: `${index}` },
            label: `host-${index}`,
          }));
        }),
      ],
    });

    const result = await coordinator.search("host");

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(result.results).toHaveLength(100);
  });

  it("isolates timed out providers and aborts their work", async () => {
    let providerSignal: AbortSignal | undefined;
    const coordinator = new QuickOpenCoordinator({
      providerTimeoutMs: 5,
      getProviders: () => [
        provider("slow", ({ signal }) => {
          providerSignal = signal;
          return new Promise(() => undefined);
        }),
        provider("fast", async () => [
          {
            reference: { kind: "host", id: "fast" },
            label: "fast host",
          },
        ]),
      ],
    });

    const result = await coordinator.search("fast");

    expect(providerSignal?.aborted).toBe(true);
    expect(result.results[0]?.reference.id).toBe("fast");
    expect(result.failures).toEqual([{ providerId: "slow", reason: "timeout" }]);
  });

  it("prioritizes the active target before a stronger text match", async () => {
    const coordinator = new QuickOpenCoordinator({
      getProviders: () => [
        provider("mixed", async () => [
          {
            reference: { kind: "host", id: "other" },
            label: "prod",
            targetId: "other",
          },
          {
            reference: { kind: "host", id: "active" },
            label: "production secondary",
            targetId: "active-target",
          },
        ]),
      ],
    });
    const context = {
      target: { id: "active-target" },
    } as never;

    const result = await coordinator.search("prod", { context });

    expect(result.results[0]?.reference.id).toBe("active");
  });
});
