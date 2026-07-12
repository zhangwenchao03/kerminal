import { describe, expect, it } from "vitest";
import type { ServerInfoSnapshot } from "../../../../src/lib/serverInfoApi";
import {
  appendServerInfoTargetHistory,
  appendServerInfoHistory,
  clearServerInfoHistoryStoreForTest,
  historySeries,
  serverInfoHistoryForTarget,
} from "../../../../src/features/tool-panel/serverInfoHistoryModel";

const snapshot = (
  capturedAt: string,
  overrides: Partial<ServerInfoSnapshot> = {},
): ServerInfoSnapshot => ({
  capturedAt,
  host: "prod.internal",
  hostId: "prod",
  hostName: "prod",
  port: 22,
  username: "deploy",
  ...overrides,
});

describe("serverInfoHistoryModel", () => {
  it("preserves histories per target and evicts least recently used targets", () => {
    clearServerInfoHistoryStoreForTest();
    appendServerInfoTargetHistory("host-a", snapshot("1"), null);
    for (let index = 0; index < 8; index += 1) {
      appendServerInfoTargetHistory(
        `host-${index}`,
        snapshot(String(index + 2)),
        null,
      );
    }

    expect(serverInfoHistoryForTarget("host-a")).toEqual([]);
    expect(serverInfoHistoryForTarget("host-7")).toHaveLength(1);
  });
  it("deduplicates samples and keeps a bounded chronological history", () => {
    let history = appendServerInfoHistory(
      [],
      snapshot("2", {
        cpuUsagePercent: 20,
        memoryTotalBytes: 100,
        memoryUsedBytes: 40,
      }),
      null,
      2,
    );
    history = appendServerInfoHistory(
      history,
      snapshot("1", { cpuUsagePercent: 10 }),
      null,
      2,
    );
    history = appendServerInfoHistory(
      history,
      snapshot("2", { cpuUsagePercent: 25 }),
      null,
      2,
    );

    expect(history.map((point) => point.capturedAtMs)).toEqual([1_000, 2_000]);
    expect(historySeries(history, "cpuPercent")).toEqual([10, 25]);
  });

  it("records sampled network rates without inventing a zero baseline", () => {
    const history = appendServerInfoHistory([], snapshot("3"), {
      interfaces: [],
      sampleDurationMs: 3_000,
      totalRxBytesPerSecond: 2_048,
      totalTxBytesPerSecond: undefined,
    });

    expect(history[0].networkRxBytesPerSecond).toBe(2_048);
    expect(history[0].networkTxBytesPerSecond).toBeUndefined();
  });
});
