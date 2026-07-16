interface TerminalSurfaceMediaQuery {
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

export interface TerminalSurfaceEventEnvironment {
  addDocumentVisibilityListener(listener: () => void): void;
  addWindowResizeListener(listener: () => void): void;
  createDevicePixelRatioQuery(): TerminalSurfaceMediaQuery | null;
  observeResize(target: Element, listener: () => void): () => void;
  readDocumentVisibility(): DocumentVisibilityState;
  removeDocumentVisibilityListener(listener: () => void): void;
  removeWindowResizeListener(listener: () => void): void;
}

interface CreateTerminalSurfaceEventControllerOptions {
  environment?: TerminalSurfaceEventEnvironment;
  onDocumentVisibilityChange(state: DocumentVisibilityState): void;
  onResize(): void;
  onSurfaceChange(): void;
  resizeTarget: Element;
}

export interface TerminalSurfaceEventController {
  dispose(): void;
  install(): void;
}

/**
 * 统一持有影响终端 surface 的浏览器监听器。
 *
 * DPR 变化后必须按新倍率重建 media query，否则同一监听器不会继续收到下一次倍率变化。
 */
export function createTerminalSurfaceEventController({
  environment = browserTerminalSurfaceEventEnvironment,
  onDocumentVisibilityChange,
  onResize,
  onSurfaceChange,
  resizeTarget,
}: CreateTerminalSurfaceEventControllerOptions): TerminalSurfaceEventController {
  let installed = false;
  let mediaQuery: TerminalSurfaceMediaQuery | null = null;
  let releaseResizeObserver: (() => void) | undefined;

  const handleDocumentVisibilityChange = () => {
    onDocumentVisibilityChange(environment.readDocumentVisibility());
  };
  const handleDevicePixelRatioChange = () => {
    bindDevicePixelRatioListener();
    onSurfaceChange();
  };
  const bindDevicePixelRatioListener = () => {
    mediaQuery?.removeEventListener("change", handleDevicePixelRatioChange);
    mediaQuery = environment.createDevicePixelRatioQuery();
    mediaQuery?.addEventListener("change", handleDevicePixelRatioChange);
  };

  return {
    dispose() {
      if (!installed) {
        return;
      }
      installed = false;
      releaseResizeObserver?.();
      releaseResizeObserver = undefined;
      environment.removeDocumentVisibilityListener(
        handleDocumentVisibilityChange,
      );
      environment.removeWindowResizeListener(onSurfaceChange);
      mediaQuery?.removeEventListener("change", handleDevicePixelRatioChange);
      mediaQuery = null;
    },
    install() {
      if (installed) {
        return;
      }
      installed = true;
      releaseResizeObserver = environment.observeResize(resizeTarget, onResize);
      environment.addDocumentVisibilityListener(
        handleDocumentVisibilityChange,
      );
      environment.addWindowResizeListener(onSurfaceChange);
      bindDevicePixelRatioListener();
    },
  };
}

const browserTerminalSurfaceEventEnvironment: TerminalSurfaceEventEnvironment = {
  addDocumentVisibilityListener(listener) {
    document.addEventListener("visibilitychange", listener);
  },
  addWindowResizeListener(listener) {
    window.addEventListener("resize", listener);
  },
  createDevicePixelRatioQuery() {
    return typeof window.matchMedia === "function"
      ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      : null;
  },
  observeResize(target, listener) {
    if (typeof ResizeObserver === "undefined") {
      return () => undefined;
    }
    const observer = new ResizeObserver(listener);
    observer.observe(target);
    return () => observer.disconnect();
  },
  readDocumentVisibility() {
    return document.visibilityState;
  },
  removeDocumentVisibilityListener(listener) {
    document.removeEventListener("visibilitychange", listener);
  },
  removeWindowResizeListener(listener) {
    window.removeEventListener("resize", listener);
  },
};
