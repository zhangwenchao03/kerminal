import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveWindowFrameState,
  useTauriWindowFrameState,
} from "../../../src/lib/useTauriWindowFrameState";

type EventHandler<T> = (event: { payload: T }) => void;

const tauriMocks = vi.hoisted(() => ({
  focusHandler: undefined as EventHandler<boolean> | undefined,
  isFullscreen: vi.fn(),
  isMaximized: vi.fn(),
  isTauri: vi.fn(),
  onFocusChanged: vi.fn(),
  onResized: vi.fn(),
  onScaleChanged: vi.fn(),
  resizeHandler: undefined as EventHandler<unknown> | undefined,
  scaleHandler: undefined as EventHandler<unknown> | undefined,
  unlistenFocus: vi.fn(),
  unlistenResize: vi.fn(),
  unlistenScale: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauriMocks.isTauri(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: tauriMocks.isFullscreen,
    isMaximized: tauriMocks.isMaximized,
    onFocusChanged: tauriMocks.onFocusChanged,
    onResized: tauriMocks.onResized,
    onScaleChanged: tauriMocks.onScaleChanged,
  }),
}));

describe("useTauriWindowFrameState", () => {
  beforeEach(() => {
    tauriMocks.focusHandler = undefined;
    tauriMocks.resizeHandler = undefined;
    tauriMocks.scaleHandler = undefined;
    tauriMocks.isFullscreen.mockReset();
    tauriMocks.isMaximized.mockReset();
    tauriMocks.isTauri.mockReset();
    tauriMocks.onFocusChanged.mockReset();
    tauriMocks.onResized.mockReset();
    tauriMocks.onScaleChanged.mockReset();
    tauriMocks.unlistenFocus.mockReset();
    tauriMocks.unlistenResize.mockReset();
    tauriMocks.unlistenScale.mockReset();
    tauriMocks.isFullscreen.mockResolvedValue(false);
    tauriMocks.isMaximized.mockResolvedValue(false);
    tauriMocks.isTauri.mockReturnValue(false);
    tauriMocks.onFocusChanged.mockImplementation((handler: EventHandler<boolean>) => {
      tauriMocks.focusHandler = handler;
      return Promise.resolve(tauriMocks.unlistenFocus);
    });
    tauriMocks.onResized.mockImplementation((handler: EventHandler<unknown>) => {
      tauriMocks.resizeHandler = handler;
      return Promise.resolve(tauriMocks.unlistenResize);
    });
    tauriMocks.onScaleChanged.mockImplementation((handler: EventHandler<unknown>) => {
      tauriMocks.scaleHandler = handler;
      return Promise.resolve(tauriMocks.unlistenScale);
    });
  });

  it("prefers fullscreen over maximized when resolving frame state", () => {
    expect(
      resolveWindowFrameState({ fullscreen: true, maximized: true }),
    ).toBe("fullscreen");
    expect(
      resolveWindowFrameState({ fullscreen: false, maximized: true }),
    ).toBe("maximized");
    expect(
      resolveWindowFrameState({ fullscreen: false, maximized: false }),
    ).toBe("normal");
  });

  it("stays normal in browser preview", () => {
    const { result } = renderHook(() => useTauriWindowFrameState());

    expect(result.current).toBe("normal");
    expect(tauriMocks.isFullscreen).not.toHaveBeenCalled();
    expect(tauriMocks.onResized).not.toHaveBeenCalled();
  });

  it("reads maximized state from the Tauri window", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.isMaximized.mockResolvedValue(true);

    const { result } = renderHook(() => useTauriWindowFrameState());

    await waitFor(() => {
      expect(result.current).toBe("maximized");
    });
    expect(document.documentElement).toHaveAttribute(
      "data-window-frame-resolved",
      "true",
    );
    expect(tauriMocks.onResized).toHaveBeenCalledTimes(1);
    expect(tauriMocks.onScaleChanged).toHaveBeenCalledTimes(1);
    expect(tauriMocks.onFocusChanged).toHaveBeenCalledTimes(1);
  });

  it("publishes an unresolved frame marker until the first Tauri query completes", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    let resolveFullscreen: ((value: boolean) => void) | undefined;
    let resolveMaximized: ((value: boolean) => void) | undefined;
    tauriMocks.isFullscreen.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFullscreen = resolve;
        }),
    );
    tauriMocks.isMaximized.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveMaximized = resolve;
        }),
    );

    renderHook(() => useTauriWindowFrameState());

    expect(document.documentElement).toHaveAttribute(
      "data-window-frame-resolved",
      "false",
    );

    await act(async () => {
      resolveFullscreen?.(false);
      resolveMaximized?.(false);
    });
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute(
        "data-window-frame-resolved",
        "true",
      );
    });
  });

  it("keeps the frame unresolved and retries when the initial query fails", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.isFullscreen
      .mockRejectedValueOnce(new Error("window restoring"))
      .mockResolvedValue(false);
    tauriMocks.isMaximized
      .mockRejectedValueOnce(new Error("window restoring"))
      .mockResolvedValue(true);

    const { result } = renderHook(() => useTauriWindowFrameState());

    expect(document.documentElement).toHaveAttribute(
      "data-window-frame-resolved",
      "false",
    );
    await waitFor(() => {
      expect(result.current).toBe("maximized");
      expect(document.documentElement).toHaveAttribute(
        "data-window-frame-resolved",
        "true",
      );
    });
    expect(tauriMocks.isFullscreen).toHaveBeenCalledTimes(2);
    expect(tauriMocks.isMaximized).toHaveBeenCalledTimes(2);
  });

  it("refreshes frame state after resize and focus changes", async () => {
    tauriMocks.isTauri.mockReturnValue(true);

    const { result } = renderHook(() => useTauriWindowFrameState());

    await waitFor(() => {
      expect(tauriMocks.isMaximized).toHaveBeenCalledTimes(1);
    });

    tauriMocks.isMaximized.mockResolvedValue(true);
    await act(async () => {
      tauriMocks.resizeHandler?.({ payload: {} });
    });
    await waitFor(() => {
      expect(result.current).toBe("maximized");
    });

    tauriMocks.isFullscreen.mockResolvedValue(true);
    await act(async () => {
      tauriMocks.focusHandler?.({ payload: true });
    });
    await waitFor(() => {
      expect(result.current).toBe("fullscreen");
    });
  });

  it("cleans up Tauri window listeners", async () => {
    tauriMocks.isTauri.mockReturnValue(true);

    const { unmount } = renderHook(() => useTauriWindowFrameState());

    await waitFor(() => {
      expect(tauriMocks.onFocusChanged).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(tauriMocks.unlistenResize).toHaveBeenCalledTimes(1);
    expect(tauriMocks.unlistenScale).toHaveBeenCalledTimes(1);
    expect(tauriMocks.unlistenFocus).toHaveBeenCalledTimes(1);
  });

  it("ignores stale frame queries that resolve after a newer refresh", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    let resolveInitialFullscreen: ((value: boolean) => void) | undefined;
    let resolveInitialMaximized: ((value: boolean) => void) | undefined;
    tauriMocks.isFullscreen
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveInitialFullscreen = resolve;
          }),
      )
      .mockResolvedValue(false);
    tauriMocks.isMaximized
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveInitialMaximized = resolve;
          }),
      )
      .mockResolvedValue(true);

    const { result } = renderHook(() => useTauriWindowFrameState());

    await waitFor(() => {
      expect(tauriMocks.resizeHandler).toBeTypeOf("function");
    });
    await act(async () => {
      tauriMocks.resizeHandler?.({ payload: {} });
    });
    await waitFor(() => {
      expect(result.current).toBe("maximized");
    });

    await act(async () => {
      resolveInitialFullscreen?.(false);
      resolveInitialMaximized?.(false);
    });

    expect(result.current).toBe("maximized");
  });

  it("keeps the last trusted state when a later refresh fails", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.isMaximized.mockResolvedValue(true);
    const { result } = renderHook(() => useTauriWindowFrameState());

    await waitFor(() => {
      expect(result.current).toBe("maximized");
    });

    tauriMocks.isFullscreen.mockRejectedValue(new Error("window unavailable"));
    tauriMocks.isMaximized.mockRejectedValue(new Error("window unavailable"));
    await act(async () => {
      tauriMocks.focusHandler?.({ payload: true });
    });

    expect(result.current).toBe("maximized");
  });
});
