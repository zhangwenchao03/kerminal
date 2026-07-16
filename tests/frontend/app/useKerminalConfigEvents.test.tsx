import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigChangeEvent } from "../../../src/app/configRefreshCoordinator";
import { useKerminalConfigEvents } from "../../../src/app/useKerminalConfigEvents";

const eventApiMock = vi.hoisted(() => ({
  handler: undefined as
    | ((event: { payload: ConfigChangeEvent }) => void)
    | undefined,
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("../../../src/lib/desktopRuntimeApi", () => ({
  desktopRuntime: {
    listen: (
      eventName: string,
      handler: (payload: ConfigChangeEvent) => void,
    ) =>
      eventApiMock.listen(
        eventName,
        (event: { payload: ConfigChangeEvent }) => handler(event.payload),
      ),
  },
}));

describe("useKerminalConfigEvents", () => {
  beforeEach(() => {
    eventApiMock.handler = undefined;
    eventApiMock.listen.mockReset();
    eventApiMock.unlisten.mockReset();
    eventApiMock.listen.mockImplementation(
      async (
        eventName: string,
        handler: (event: { payload: ConfigChangeEvent }) => void,
      ) => {
        expect(eventName).toBe("kerminal-config-changed");
        eventApiMock.handler = handler;
        return eventApiMock.unlisten;
      },
    );
  });

  it("listens for config change events and forwards payloads", async () => {
    const coordinator = {
      handleEvent: vi.fn(async () => {}),
      lastSequence: () => 0,
      revision: () => 0,
    };

    renderHook(() => useKerminalConfigEvents({ coordinator }));

    await waitFor(() => {
      expect(eventApiMock.listen).toHaveBeenCalledWith(
        "kerminal-config-changed",
        expect.any(Function),
      );
    });
    eventApiMock.handler?.({ payload: configEvent({ sequence: 4 }) });

    await waitFor(() => {
      expect(coordinator.handleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 4 }),
      );
    });
  });

  it("unlistens on unmount", async () => {
    const coordinator = {
      handleEvent: vi.fn(async () => {}),
      lastSequence: () => 0,
      revision: () => 0,
    };

    const { unmount } = renderHook(() =>
      useKerminalConfigEvents({ coordinator }),
    );

    await waitFor(() => expect(eventApiMock.listen).toHaveBeenCalled());
    unmount();

    expect(eventApiMock.unlisten).toHaveBeenCalledTimes(1);
  });
});

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
