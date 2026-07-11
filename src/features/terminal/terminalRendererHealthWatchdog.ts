import type {
  TerminalRendererController,
} from "./terminalRenderer";
import type { TerminalRendererHealthSignal } from "./terminalRendererHealth";
import type { TerminalRendererSurfaceSnapshot } from "./terminalRendererSurfaceCoordinator";

type WatchdogTimerHandle = ReturnType<typeof window.setTimeout>;

export interface TerminalRendererHealthWatchdogScheduler {
  cancel(handle: WatchdogTimerHandle): void;
  schedule(callback: () => void, delayMs: number): WatchdogTimerHandle;
}

export interface TerminalRendererHealthWatchdog {
  check(): void;
  dispose(): void;
}

interface CreateTerminalRendererHealthWatchdogOptions {
  container: HTMLElement;
  intervalMs?: number;
  now?: () => number;
  renderer: Pick<
    TerminalRendererController,
    "getState" | "getTrackedRendererCanvases" | "reportHealth"
  >;
  scheduler?: TerminalRendererHealthWatchdogScheduler;
  surfaceSnapshot(): TerminalRendererSurfaceSnapshot | undefined;
}

const DEFAULT_HEALTH_WATCHDOG_INTERVAL_MS = 2_000;

/**
 * 使用低频 DOM 状态检查发现 WebGL canvas 脱离或归零。
 *
 * watchdog 不读取终端文本、canvas 像素或 GPU 信息；真正的恢复、重试与熔断
 * 仍由 renderer controller 单独负责。
 */
export function createTerminalRendererHealthWatchdog({
  container,
  intervalMs = DEFAULT_HEALTH_WATCHDOG_INTERVAL_MS,
  now = () => Date.now(),
  renderer,
  scheduler = browserWatchdogScheduler,
  surfaceSnapshot,
}: CreateTerminalRendererHealthWatchdogOptions): TerminalRendererHealthWatchdog {
  const resolvedIntervalMs = Math.max(250, Math.floor(intervalMs));
  let disposed = false;
  let timerHandle: WatchdogTimerHandle | null = null;

  const scheduleNext = () => {
    if (disposed || timerHandle !== null) {
      return;
    }
    timerHandle = scheduler.schedule(() => {
      timerHandle = null;
      check();
      scheduleNext();
    }, resolvedIntervalMs);
  };

  const check = () => {
    if (disposed) {
      return;
    }
    const state = renderer.getState();
    if (state.backend !== "gpu") {
      return;
    }
    const surface = surfaceSnapshot();
    if (!surface) {
      return;
    }
    renderer.reportHealth({
      now: now(),
      signal: resolveCanvasHealthSignal(
        container,
        renderer.getTrackedRendererCanvases(),
      ),
      surfaceEpoch: surface.stableEpoch,
      surfaceStable: surface.stable,
      visible: surface.visible && !surface.minimized,
    });
  };

  scheduleNext();

  return {
    check,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (timerHandle !== null) {
        scheduler.cancel(timerHandle);
        timerHandle = null;
      }
    },
  };
}

function resolveCanvasHealthSignal(
  container: HTMLElement,
  rendererCanvases: readonly HTMLCanvasElement[],
): TerminalRendererHealthSignal {
  if (
    rendererCanvases.length === 0 ||
    rendererCanvases.some(
      (canvas) => !canvas.isConnected || !container.contains(canvas),
    )
  ) {
    return "canvas-detached";
  }
  if (
    rendererCanvases.some((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return (
        canvas.width <= 0 ||
        canvas.height <= 0 ||
        rect.width <= 0 ||
        rect.height <= 0
      );
    })
  ) {
    return "canvas-zero-sized";
  }
  return "healthy";
}

const browserWatchdogScheduler: TerminalRendererHealthWatchdogScheduler = {
  cancel(handle) {
    window.clearTimeout(handle);
  },
  schedule(callback, delayMs) {
    return window.setTimeout(callback, delayMs);
  },
};
