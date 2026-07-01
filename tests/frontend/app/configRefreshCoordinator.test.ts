import { describe, expect, it, vi } from "vitest";

import {
  createConfigRefreshCoordinator,
  type ConfigChangeEvent,
} from "../../../src/app/configRefreshCoordinator";
import {
  configChangeNoticeSnapshot,
  type ConfigChangeNoticeSnapshot,
} from "../../../src/app/configChangeNoticeModel";

describe("configRefreshCoordinator", () => {
  it("refreshes changed domains and emits a public diff notice", async () => {
    let snapshot = configChangeNoticeSnapshot({ hosts: [] });
    const onNotice = vi.fn();
    const refreshHosts = vi.fn(async () => {
      snapshot = configChangeNoticeSnapshot({
        hosts: [{ id: "host-staging", label: "staging-api" }],
      });
    });
    const coordinator = createConfigRefreshCoordinator({
      getSnapshot: () => snapshot,
      onNotice,
      refreshers: { hosts: refreshHosts },
    });

    await coordinator.handleEvent(configEvent({ domains: ["hosts"] }));

    expect(refreshHosts).toHaveBeenCalledTimes(1);
    expect(coordinator.revision("hosts")).toBe(1);
    expect(onNotice).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'cfg: +1 host "staging-api"' }),
    );
  });

  it("ignores stale sequence events", async () => {
    const onNotice = vi.fn();
    const refreshHosts = vi.fn();
    const coordinator = createConfigRefreshCoordinator({
      getSnapshot: () => emptySnapshot,
      onNotice,
      refreshers: { hosts: refreshHosts },
    });

    await coordinator.handleEvent(configEvent({ sequence: 3 }));
    await coordinator.handleEvent(configEvent({ sequence: 2 }));

    expect(refreshHosts).toHaveBeenCalledTimes(1);
    expect(coordinator.lastSequence()).toBe(3);
  });

  it("does not emit success notices for internal saves", async () => {
    const onNotice = vi.fn();
    const coordinator = createConfigRefreshCoordinator({
      getSnapshot: () => emptySnapshot,
      onNotice,
      refreshers: { hosts: async () => {} },
    });

    await coordinator.handleEvent(
      configEvent({ domains: ["hosts"], sourceHint: "kerminal" }),
    );

    expect(onNotice).not.toHaveBeenCalled();
  });

  it("emits invalid and watcher unavailable notices without refreshing", async () => {
    const onNotice = vi.fn();
    const refreshHosts = vi.fn();
    const coordinator = createConfigRefreshCoordinator({
      getSnapshot: () => emptySnapshot,
      onNotice,
      refreshers: { hosts: refreshHosts },
    });

    await coordinator.handleEvent(
      configEvent({ domains: ["hosts"], status: "invalid" }),
    );
    await coordinator.handleEvent(
      configEvent({
        domains: ["hosts"],
        sequence: 2,
        status: "watcher-unavailable",
      }),
    );

    expect(refreshHosts).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        level: "error",
        text: "cfg: invalid TOML, kept last-known-good",
      }),
    );
    expect(onNotice).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        level: "warning",
        text: "cfg: watcher offline, auto-refresh paused",
      }),
    );
  });

  it("emits a warning when a domain refresh fails", async () => {
    const onNotice = vi.fn();
    const coordinator = createConfigRefreshCoordinator({
      getSnapshot: () => emptySnapshot,
      onNotice,
      refreshers: {
        hosts: async () => {
          throw new Error("load failed");
        },
      },
    });

    await coordinator.handleEvent(configEvent({ domains: ["hosts"] }));

    expect(onNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warning",
        text: "cfg: refresh failed, kept last-known-good",
      }),
    );
  });

  it("does not emit a stale notice when a newer event arrives first", async () => {
    let releaseFirstRefresh: (() => void) | undefined;
    let snapshot = configChangeNoticeSnapshot({ hosts: [] });
    const onNotice = vi.fn();
    const coordinator = createConfigRefreshCoordinator({
      getSnapshot: () => snapshot,
      onNotice,
      refreshers: {
        hosts: () =>
          new Promise<void>((resolve) => {
            releaseFirstRefresh = () => {
              snapshot = configChangeNoticeSnapshot({
                hosts: [{ id: "host-old", label: "old" }],
              });
              resolve();
            };
          }),
        snippets: async () => {
          snapshot = configChangeNoticeSnapshot({
            snippets: [{ id: "snippet-new", label: "new" }],
          });
        },
      },
    });

    const first = coordinator.handleEvent(
      configEvent({ domains: ["hosts"], sequence: 1 }),
    );
    await coordinator.handleEvent(
      configEvent({ domains: ["snippets"], sequence: 2 }),
    );
    releaseFirstRefresh?.();
    await first;

    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'cfg: +1 snippet "new"' }),
    );
  });
});

const emptySnapshot: ConfigChangeNoticeSnapshot = configChangeNoticeSnapshot({});

function configEvent(overrides: Partial<ConfigChangeEvent> = {}): ConfigChangeEvent {
  return {
    batchId: `batch-${overrides.sequence ?? 1}`,
    diagnostics: [],
    domains: ["hosts"],
    observedAt: "2026-06-26T00:03:28+08:00",
    sequence: 1,
    sourceHint: "external",
    status: "ready",
    version: 1,
    ...overrides,
  };
}
