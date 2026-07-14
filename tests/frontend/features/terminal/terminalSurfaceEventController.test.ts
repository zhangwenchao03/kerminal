import { describe, expect, it, vi } from "vitest";
import {
  createTerminalSurfaceEventController,
  type TerminalSurfaceEventEnvironment,
} from "../../../../src/features/terminal/terminalSurfaceEventController";

function createEnvironment() {
  let visibilityState: DocumentVisibilityState = "visible";
  let visibilityListener: (() => void) | undefined;
  let resizeListener: (() => void) | undefined;
  let observedResizeListener: (() => void) | undefined;
  const releaseResizeObserver = vi.fn();
  const mediaQueries: Array<{
    addEventListener: ReturnType<typeof vi.fn>;
    listener?: () => void;
    removeEventListener: ReturnType<typeof vi.fn>;
  }> = [];

  const environment: TerminalSurfaceEventEnvironment = {
    addDocumentVisibilityListener: vi.fn((listener) => {
      visibilityListener = listener;
    }),
    addWindowResizeListener: vi.fn((listener) => {
      resizeListener = listener;
    }),
    createDevicePixelRatioQuery: vi.fn(() => {
      const query = {
        addEventListener: vi.fn((_type: "change", listener: () => void) => {
          query.listener = listener;
        }),
        listener: undefined as (() => void) | undefined,
        removeEventListener: vi.fn(),
      };
      mediaQueries.push(query);
      return query;
    }),
    observeResize: vi.fn((_target, listener) => {
      observedResizeListener = listener;
      return releaseResizeObserver;
    }),
    readDocumentVisibility: () => visibilityState,
    removeDocumentVisibilityListener: vi.fn(),
    removeWindowResizeListener: vi.fn(),
  };

  return {
    environment,
    mediaQueries,
    releaseResizeObserver,
    setVisibilityState(nextState: DocumentVisibilityState) {
      visibilityState = nextState;
      visibilityListener?.();
    },
    triggerResize() {
      resizeListener?.();
    },
    triggerObservedResize() {
      observedResizeListener?.();
    },
  };
}

describe("terminalSurfaceEventController", () => {
  it("forwards visibility and resize events after a single installation", () => {
    const source = createEnvironment();
    const onDocumentVisibilityChange = vi.fn();
    const onResize = vi.fn();
    const onSurfaceChange = vi.fn();
    const controller = createTerminalSurfaceEventController({
      environment: source.environment,
      onDocumentVisibilityChange,
      onResize,
      onSurfaceChange,
      resizeTarget: document.body,
    });

    controller.install();
    controller.install();
    source.setVisibilityState("hidden");
    source.triggerResize();
    source.triggerObservedResize();

    expect(
      source.environment.addDocumentVisibilityListener,
    ).toHaveBeenCalledTimes(1);
    expect(source.environment.addWindowResizeListener).toHaveBeenCalledTimes(
      1,
    );
    expect(onDocumentVisibilityChange).toHaveBeenCalledWith("hidden");
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onSurfaceChange).toHaveBeenCalledTimes(1);
  });

  it("rebinds the DPR listener before invalidating the surface", () => {
    const source = createEnvironment();
    const order: string[] = [];
    const controller = createTerminalSurfaceEventController({
      environment: source.environment,
      onDocumentVisibilityChange: vi.fn(),
      onResize: vi.fn(),
      onSurfaceChange: () => order.push("invalidate"),
      resizeTarget: document.body,
    });
    controller.install();
    source.environment.createDevicePixelRatioQuery = vi.fn(() => {
      order.push("rebind");
      return null;
    });

    source.mediaQueries[0].listener?.();

    expect(source.mediaQueries[0].removeEventListener).toHaveBeenCalledWith(
      "change",
      source.mediaQueries[0].listener,
    );
    expect(order).toEqual(["rebind", "invalidate"]);
  });

  it("releases document, window and latest DPR listeners exactly once", () => {
    const source = createEnvironment();
    const controller = createTerminalSurfaceEventController({
      environment: source.environment,
      onDocumentVisibilityChange: vi.fn(),
      onResize: vi.fn(),
      onSurfaceChange: vi.fn(),
      resizeTarget: document.body,
    });
    controller.install();
    const firstQuery = source.mediaQueries[0];
    firstQuery.listener?.();
    const latestQuery = source.mediaQueries[1];

    controller.dispose();
    controller.dispose();

    expect(
      source.environment.removeDocumentVisibilityListener,
    ).toHaveBeenCalledTimes(1);
    expect(source.environment.removeWindowResizeListener).toHaveBeenCalledTimes(
      1,
    );
    expect(source.releaseResizeObserver).toHaveBeenCalledTimes(1);
    expect(firstQuery.removeEventListener).toHaveBeenCalledTimes(1);
    expect(latestQuery.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
