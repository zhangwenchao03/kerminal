import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveWindowFrameState,
  useTauriWindowFrameState,
} from "./useTauriWindowFrameState";

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
    expect(tauriMocks.onResized).toHaveBeenCalledTimes(1);
    expect(tauriMocks.onScaleChanged).toHaveBeenCalledTimes(1);
    expect(tauriMocks.onFocusChanged).toHaveBeenCalledTimes(1);
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
});
