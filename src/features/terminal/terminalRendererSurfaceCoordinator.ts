export interface TerminalRendererSurfaceMeasurement {
  dpr: number;
  height: number;
  minimized: boolean;
  visible: boolean;
  width: number;
}

interface TerminalRendererSurfaceDimensions {
  cols: number;
  rows: number;
}

export interface TerminalRendererSurfaceSnapshot
  extends
    TerminalRendererSurfaceMeasurement,
    TerminalRendererSurfaceDimensions {
  stable: boolean;
  stableEpoch: number;
}

export interface TerminalRendererSurfaceScheduler {
  cancel(handle: number): void;
  request(callback: () => void): number;
}

export interface TerminalRendererSurfaceCoordinator {
  dispose(): void;
  flush(): void;
  getSnapshot(): TerminalRendererSurfaceSnapshot | undefined;
  invalidate(): void;
  notify(): void;
}

export interface CreateTerminalRendererSurfaceCoordinatorOptions {
  fit(): TerminalRendererSurfaceDimensions;
  measure(): TerminalRendererSurfaceMeasurement;
  onDimensionsChange?: (dimensions: TerminalRendererSurfaceDimensions) => void;
  onStableSurface?: (snapshot: TerminalRendererSurfaceSnapshot) => void;
  scheduler?: TerminalRendererSurfaceScheduler;
  stableSamples?: number;
}

const DEFAULT_STABLE_SAMPLES = 2;

/**
 * 合并终端 surface 的高频通知，并在尺寸真正变化时才执行 fit。
 *
 * renderer attach/recovery 可以监听稳定 surface，但不能直接订阅
 * ResizeObserver，否则同一次窗口变化会触发多套重复工作。
 */
export function createTerminalRendererSurfaceCoordinator({
  fit,
  measure,
  onDimensionsChange,
  onStableSurface,
  scheduler = browserSurfaceScheduler,
  stableSamples = DEFAULT_STABLE_SAMPLES,
}: CreateTerminalRendererSurfaceCoordinatorOptions): TerminalRendererSurfaceCoordinator {
  const requiredStableSamples = Math.max(1, Math.floor(stableSamples));
  let disposed = false;
  let frameHandle: number | null = null;
  let lastMeasurement: TerminalRendererSurfaceMeasurement | undefined;
  let stableSampleCount = 0;
  let snapshot: TerminalRendererSurfaceSnapshot | undefined;
  let stableEpoch = 0;

  const cancelFrame = () => {
    if (frameHandle === null) {
      return;
    }
    scheduler.cancel(frameHandle);
    frameHandle = null;
  };

  const flush = () => {
    frameHandle = null;
    if (disposed) {
      return;
    }

    const nextMeasurement = normalizeMeasurement(measure());
    const renderable = isRenderableSurface(nextMeasurement);
    const measurementChanged = !sameMeasurement(
      lastMeasurement,
      nextMeasurement,
    );

    if (!renderable) {
      stableSampleCount = 0;
      snapshot = {
        ...nextMeasurement,
        cols: snapshot?.cols ?? 0,
        rows: snapshot?.rows ?? 0,
        stable: false,
        stableEpoch,
      };
      lastMeasurement = nextMeasurement;
      return;
    }

    const previousDimensions = snapshot
      ? { cols: snapshot.cols, rows: snapshot.rows }
      : undefined;
    const nextDimensions =
      measurementChanged || !snapshot
        ? normalizeDimensions(fit())
        : previousDimensions!;
    const dimensionsChanged = !sameDimensions(
      previousDimensions,
      nextDimensions,
    );

    if (measurementChanged || dimensionsChanged) {
      stableSampleCount = 1;
      stableEpoch += 1;
    } else {
      stableSampleCount += 1;
    }

    const stable = stableSampleCount >= requiredStableSamples;
    const wasStable = snapshot?.stable ?? false;
    snapshot = {
      ...nextMeasurement,
      ...nextDimensions,
      stable,
      stableEpoch,
    };
    lastMeasurement = nextMeasurement;

    if (dimensionsChanged) {
      onDimensionsChange?.(nextDimensions);
    }
    if (stable && !wasStable) {
      onStableSurface?.(snapshot);
    }
    if (!stable && frameHandle === null && !disposed) {
      // 稳定判定需要连续样本；首帧后主动补采样，不能依赖浏览器再次触发 ResizeObserver。
      frameHandle = scheduler.request(flush);
    }
  };

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      cancelFrame();
    },
    flush() {
      if (disposed) {
        return;
      }
      cancelFrame();
      flush();
    },
    getSnapshot() {
      return snapshot;
    },
    invalidate() {
      if (disposed) {
        return;
      }
      lastMeasurement = undefined;
      stableSampleCount = 0;
      if (snapshot) {
        snapshot = { ...snapshot, stable: false };
      }
      if (frameHandle === null) {
        frameHandle = scheduler.request(flush);
      }
    },
    notify() {
      if (disposed || frameHandle !== null) {
        return;
      }
      frameHandle = scheduler.request(flush);
    },
  };
}

function isRenderableSurface(measurement: TerminalRendererSurfaceMeasurement) {
  return (
    measurement.visible &&
    !measurement.minimized &&
    measurement.width > 0 &&
    measurement.height > 0
  );
}

function sameMeasurement(
  left: TerminalRendererSurfaceMeasurement | undefined,
  right: TerminalRendererSurfaceMeasurement,
) {
  return (
    left !== undefined &&
    left.dpr === right.dpr &&
    left.height === right.height &&
    left.minimized === right.minimized &&
    left.visible === right.visible &&
    left.width === right.width
  );
}

function sameDimensions(
  left: TerminalRendererSurfaceDimensions | undefined,
  right: TerminalRendererSurfaceDimensions,
) {
  return left?.cols === right.cols && left.rows === right.rows;
}

function normalizeMeasurement(
  measurement: TerminalRendererSurfaceMeasurement,
): TerminalRendererSurfaceMeasurement {
  return {
    dpr: finiteNonNegative(measurement.dpr, 1),
    height: finiteNonNegative(measurement.height, 0),
    minimized: Boolean(measurement.minimized),
    visible: Boolean(measurement.visible),
    width: finiteNonNegative(measurement.width, 0),
  };
}

function normalizeDimensions(
  dimensions: TerminalRendererSurfaceDimensions,
): TerminalRendererSurfaceDimensions {
  return {
    cols: Math.max(0, Math.floor(finiteNonNegative(dimensions.cols, 0))),
    rows: Math.max(0, Math.floor(finiteNonNegative(dimensions.rows, 0))),
  };
}

function finiteNonNegative(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const browserSurfaceScheduler: TerminalRendererSurfaceScheduler = {
  cancel(handle) {
    if (canUseAnimationFrame()) {
      window.cancelAnimationFrame(handle);
      return;
    }
    window.clearTimeout(handle);
  },
  request(callback) {
    if (canUseAnimationFrame()) {
      return window.requestAnimationFrame(callback);
    }
    return window.setTimeout(callback, 16);
  },
};

function canUseAnimationFrame() {
  return (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function" &&
    typeof window.cancelAnimationFrame === "function"
  );
}
