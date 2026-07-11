/**
 * SFTP local upload drop facade hook tests.
 *
 * @author kongweiguang
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpFileTarget, SftpStatus } from "../../../../../src/features/sftp/sftp-tool-content/types";
import { useSftpLocalUploadDropActions } from "../../../../../src/features/sftp/sftp-tool-content/useSftpLocalUploadDropActions";

type DragDropListener = (event: unknown) => void;
type UploadDroppedLocalPaths = (
  paths: string[],
  targetRemotePath?: string,
) => Promise<void>;

const webviewMock = vi.hoisted(() => ({
  getCurrentWebview: vi.fn(),
  listener: undefined as DragDropListener | undefined,
  onDragDropEvent: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: webviewMock.getCurrentWebview,
}));

describe("useSftpLocalUploadDropActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webviewMock.listener = undefined;
    webviewMock.unlisten = vi.fn();
    webviewMock.onDragDropEvent.mockImplementation(
      (listener: DragDropListener) => {
        webviewMock.listener = listener;
        return Promise.resolve(webviewMock.unlisten);
      },
    );
    webviewMock.getCurrentWebview.mockReturnValue({
      onDragDropEvent: webviewMock.onDragDropEvent,
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("does not subscribe when the panel is inactive or outside Tauri", () => {
    renderLocalDropHook({ active: false });

    expect(webviewMock.getCurrentWebview).not.toHaveBeenCalled();

    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    renderLocalDropHook();

    expect(webviewMock.getCurrentWebview).not.toHaveBeenCalled();
  });

  it("tracks hover state from Tauri drag enter, over, and leave events", async () => {
    const { setters } = renderLocalDropHook();
    await waitFor(() => expect(webviewMock.listener).toBeDefined());

    act(() => {
      emitDragDrop({
        payload: { position: { x: 24, y: 48 }, type: "enter" },
      });
      emitDragDrop({
        payload: { position: { x: 500, y: 500 }, type: "over" },
      });
      emitDragDrop({ payload: { type: "leave" } });
    });

    expect(setters.setDragDropActive).toHaveBeenNthCalledWith(1, true);
    expect(setters.setDragDropActive).toHaveBeenNthCalledWith(2, false);
    expect(setters.setDragDropActive).toHaveBeenLastCalledWith(false);
  });

  it("uploads dropped local paths to the current remote directory", async () => {
    const { uploadDroppedLocalPaths, setters } = renderLocalDropHook({
      currentPath: "/srv/releases",
    });
    await waitFor(() => expect(webviewMock.listener).toBeDefined());

    act(() => {
      emitDragDrop({
        payload: {
          paths: ["C:/tmp/release.tgz", "C:/tmp/dist"],
          position: { x: 24, y: 48 },
          type: "drop",
        },
      });
    });

    expect(setters.setDragDropActive).toHaveBeenCalledWith(false);
    expect(uploadDroppedLocalPaths).toHaveBeenCalledWith(
      ["C:/tmp/release.tgz", "C:/tmp/dist"],
      "/srv/releases",
    );
  });

  it("ignores local drops outside the active drop zone", async () => {
    const { uploadDroppedLocalPaths, setters } = renderLocalDropHook();
    await waitFor(() => expect(webviewMock.listener).toBeDefined());

    act(() => {
      emitDragDrop({
        payload: {
          paths: ["C:/tmp/release.tgz"],
          position: { x: 500, y: 500 },
          type: "drop",
        },
      });
    });

    expect(setters.setDragDropActive).toHaveBeenCalledWith(false);
    expect(uploadDroppedLocalPaths).not.toHaveBeenCalled();
  });

  it("reports listener setup failures as operation status errors", async () => {
    webviewMock.onDragDropEvent.mockRejectedValueOnce(
      new Error("permission denied password=drop-hook-secret"),
    );
    const { setters } = renderLocalDropHook();

    await waitFor(() => {
      expect(setters.setDragDropActive).toHaveBeenCalledWith(false);
      expect(setters.setOperationStatus).toHaveBeenCalledWith({
        kind: "error",
        message: expect.stringContaining("拖放上传初始化失败："),
      });
    });
    const status =
      setters.setOperationStatus.mock.calls[
        setters.setOperationStatus.mock.calls.length - 1
      ]?.[0] as
      | SftpStatus
      | null;
    expect(status?.message).toContain('password="[已隐藏]"');
    expect(status?.message).not.toContain("drop-hook-secret");
  });

  it("clears drag state and releases late subscriptions on cleanup", async () => {
    const subscription = createDeferred<() => void>();
    webviewMock.onDragDropEvent.mockImplementationOnce(
      (listener: DragDropListener) => {
        webviewMock.listener = listener;
        return subscription.promise;
      },
    );
    const { hook, setters } = renderLocalDropHook();

    hook.unmount();

    expect(setters.setDragDropActive).toHaveBeenCalledWith(false);

    await act(async () => {
      subscription.resolve(webviewMock.unlisten);
      await Promise.resolve();
    });

    expect(webviewMock.unlisten).toHaveBeenCalledTimes(1);
  });
});

function renderLocalDropHook({
  active = true,
  currentPath = "/srv",
  dropZone = createDropZone(),
  fileTarget = sshFileTarget(),
  uploadDroppedLocalPaths = vi.fn<UploadDroppedLocalPaths>(
    async () => undefined,
  ),
}: {
  active?: boolean;
  currentPath?: string;
  dropZone?: HTMLDivElement | null;
  fileTarget?: SftpFileTarget | null;
  uploadDroppedLocalPaths?: UploadDroppedLocalPaths;
} = {}) {
  const setters = {
    setDragDropActive:
      vi.fn<Dispatch<SetStateAction<boolean>>>(),
    setOperationStatus:
      vi.fn<Dispatch<SetStateAction<SftpStatus | null>>>(),
  };
  const dropZoneRef: RefObject<HTMLDivElement | null> = {
    current: dropZone,
  };
  const hook = renderHook(() =>
    useSftpLocalUploadDropActions({
      active,
      currentPath,
      dropZoneRef,
      fileTarget,
      setDragDropActive: setters.setDragDropActive,
      setOperationStatus: setters.setOperationStatus,
      uploadDroppedLocalPaths,
    }),
  );

  return {
    hook,
    setters,
    uploadDroppedLocalPaths,
  };
}

function emitDragDrop(event: unknown) {
  if (!webviewMock.listener) {
    throw new Error("drag-drop listener was not registered");
  }
  webviewMock.listener(event);
}

function createDropZone() {
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({
      bottom: 240,
      height: 220,
      left: 10,
      right: 430,
      top: 20,
      width: 420,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }) as DOMRect;
  return element;
}

function sshFileTarget(): SftpFileTarget {
  return {
    hostId: "host-1",
    initialPath: "/srv",
    kind: "ssh",
    protocol: "sftp://",
    summary: "prod.example.com",
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
