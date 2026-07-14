import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveSftpUploadMenuPosition,
  useSftpUploadMenuPosition,
} from "../../../../../src/features/sftp/sftp-tool-content/useSftpUploadMenuPosition";

describe("useSftpUploadMenuPosition", () => {
  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    vi.restoreAllMocks();
  });

  it("clamps the menu inside the viewport and keeps its vertical offset", () => {
    expect(
      resolveSftpUploadMenuPosition({ bottom: 40, left: 300 }, 400),
    ).toEqual({ left: 216, top: 44 });
    expect(
      resolveSftpUploadMenuPosition({ bottom: 20, left: -12 }, 400),
    ).toEqual({ left: 8, top: 24 });
  });

  it("tracks the anchor on resize and clears the position when closed", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });
    let anchorRect = { bottom: 40, left: 300 };
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () => anchorRect as DOMRect;
    const anchorRef = { current: anchor } as RefObject<HTMLElement | null>;
    const { rerender, result } = renderHook(
      ({ open }: { open: boolean }) =>
        useSftpUploadMenuPosition({ anchorRef, open }),
      { initialProps: { open: true } },
    );

    expect(result.current).toEqual({ left: 300, top: 44 });

    anchorRect = { bottom: 80, left: 450 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ left: 316, top: 84 });

    rerender({ open: false });
    expect(result.current).toBeNull();
  });

  it("registers and removes resize and capture-phase scroll listeners", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const anchor = document.createElement("div");
    anchor.getBoundingClientRect = () =>
      ({ bottom: 20, left: 20 }) as DOMRect;
    const anchorRef = { current: anchor } as RefObject<HTMLElement | null>;
    const { unmount } = renderHook(() =>
      useSftpUploadMenuPosition({ anchorRef, open: true }),
    );

    const resizeListener = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "resize",
    )?.[1];
    const scrollListener = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "scroll",
    )?.[1];
    expect(resizeListener).toBeTypeOf("function");
    expect(scrollListener).toBeTypeOf("function");
    expect(addEventListener).toHaveBeenCalledWith(
      "scroll",
      scrollListener,
      true,
    );

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith(
      "resize",
      resizeListener,
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      "scroll",
      scrollListener,
      true,
    );
  });
});
