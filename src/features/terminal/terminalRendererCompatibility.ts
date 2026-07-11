/** 已验证可使用 xterm WebGL 私有兼容清理的精确依赖版本。 */
export const VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS = Object.freeze({
  webglAddon: "0.19.0",
  xterm: "6.0.0",
});

/** controller 提供的实际 xterm 与 WebGL addon 版本。 */
export interface XtermWebglCompatibilityVersions {
  webglAddon: string;
  xterm: string;
}

/** 私有兼容能力的显式开关；只有精确版本匹配时才会生效。 */
export interface XtermWebglCompatibilityCapabilityGate {
  forceContextLoss?: boolean;
  privateRendererCleanup?: boolean;
}

/** adapter 最终解析出的可用兼容能力。 */
export interface XtermWebglCompatibilityCapabilities {
  forceContextLoss: boolean;
  privateRendererCleanup: boolean;
}

/** compatibility adapter 使用的最小日志接口。 */
export interface XtermWebglCompatibilityLogger {
  warn(message: string, error?: unknown): void;
}

/** 公开 dispose 路径所需的最小 WebGL addon 契约。 */
export interface XtermWebglDisposableAddon {
  dispose(): void;
}

/** controller 交给 adapter 释放的 addon 与已知 WebGL canvas。 */
export interface XtermWebglDisposeTarget {
  addon: XtermWebglDisposableAddon;
  canvases?: Iterable<HTMLCanvasElement>;
}

/** 创建 compatibility adapter 的版本与能力配置。 */
export interface CreateXtermWebglCompatibilityAdapterOptions {
  capabilityGate?: XtermWebglCompatibilityCapabilityGate;
  logger?: XtermWebglCompatibilityLogger;
  versions: XtermWebglCompatibilityVersions;
}

/**
 * 供 renderer controller 后续接线的窄兼容接口。
 *
 * `dispose` 始终优先调用 addon 公开 API；版本私有逻辑只作为显式、
 * 精确版本命中的 best-effort 补充，任何异常都不会向调用方传播。
 */
export interface XtermWebglCompatibilityAdapter {
  readonly capabilities: Readonly<XtermWebglCompatibilityCapabilities>;
  dispose(target: XtermWebglDisposeTarget): void;
}

/**
 * 创建 xterm WebGL compatibility adapter。
 *
 * 未提供 capability gate 或版本不匹配时，adapter 只执行公开 dispose，
 * 避免依赖升级后继续触碰未经验证的私有字段或强制丢失 WebGL context。
 */
export function createXtermWebglCompatibilityAdapter({
  capabilityGate,
  logger = console,
  versions,
}: CreateXtermWebglCompatibilityAdapterOptions): XtermWebglCompatibilityAdapter {
  const exactVersionMatch =
    versions.xterm === VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS.xterm &&
    versions.webglAddon ===
      VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS.webglAddon;
  const capabilities = Object.freeze({
    forceContextLoss:
      exactVersionMatch && capabilityGate?.forceContextLoss === true,
    privateRendererCleanup:
      exactVersionMatch && capabilityGate?.privateRendererCleanup === true,
  });

  return {
    capabilities,
    dispose({ addon, canvases = [] }) {
      // 公开 API 是唯一默认释放路径；即使它抛错，也继续执行已验证的兜底清理。
      runBestEffort(
        () => addon.dispose(),
        logger,
        "[kerminal-terminal-renderer] WebGL renderer dispose failed",
      );

      if (capabilities.forceContextLoss) {
        releaseKnownCanvasContexts(canvases, logger);
      }
      if (capabilities.privateRendererCleanup) {
        clearKnownPrivateRendererReferences(addon, logger);
      }
    },
  };
}

function releaseKnownCanvasContexts(
  canvases: Iterable<HTMLCanvasElement>,
  logger: XtermWebglCompatibilityLogger,
) {
  const released = new Set<HTMLCanvasElement>();
  try {
    for (const canvas of canvases) {
      if (released.has(canvas)) {
        continue;
      }
      released.add(canvas);
      releaseCanvasContext(canvas, logger);
    }
  } catch (error) {
    warnSafely(
      logger,
      "[kerminal-terminal-renderer] WebGL canvas enumeration failed",
      error,
    );
  }
}

function releaseCanvasContext(
  canvas: HTMLCanvasElement,
  logger: XtermWebglCompatibilityLogger,
) {
  const gl = resolveWebglContext(canvas);
  if (!gl) {
    return;
  }

  runBestEffort(
    () => {
      const extension = gl.getExtension("WEBGL_lose_context");
      if (extension && !gl.isContextLost()) {
        extension.loseContext();
      }
    },
    logger,
    "[kerminal-terminal-renderer] forced WebGL context loss failed",
  );
  runBestEffort(
    () => {
      canvas.width = 0;
      canvas.height = 0;
    },
    logger,
    "[kerminal-terminal-renderer] WebGL canvas reset failed",
  );
}

function resolveWebglContext(
  canvas: HTMLCanvasElement,
): WebGL2RenderingContext | WebGLRenderingContext | null {
  try {
    const webgl2 = canvas.getContext("webgl2");
    if (webgl2) {
      return webgl2;
    }
  } catch {
    // canvas 可能已绑定其它 context，继续尝试 WebGL 1。
  }
  try {
    return canvas.getContext("webgl");
  } catch {
    return null;
  }
}

function clearKnownPrivateRendererReferences(
  addon: XtermWebglDisposableAddon,
  logger: XtermWebglCompatibilityLogger,
) {
  const root = asRecord(addon);
  if (!root) {
    return;
  }

  // 这些路径只对应 xterm 6.0.0 + addon-webgl 0.19.0 已审计过的对象形状。
  for (const key of ["_renderer", "_renderService"]) {
    let candidate: unknown;
    try {
      candidate = root[key];
    } catch (error) {
      warnSafely(
        logger,
        "[kerminal-terminal-renderer] WebGL private renderer lookup failed",
        error,
      );
      continue;
    }
    clearRendererReferences(candidate, logger);
  }
}

function clearRendererReferences(
  candidate: unknown,
  logger: XtermWebglCompatibilityLogger,
) {
  const renderer = asRecord(candidate);
  if (!renderer) {
    return;
  }

  for (const key of [
    "_atlas",
    "_canvas",
    "_charAtlas",
    "_gl",
    "canvas",
    "gl",
  ]) {
    try {
      if (key in renderer) {
        renderer[key] = undefined;
      }
    } catch (error) {
      warnSafely(
        logger,
        "[kerminal-terminal-renderer] WebGL private reference cleanup failed",
        error,
      );
    }
  }
}

function runBestEffort(
  action: () => void,
  logger: XtermWebglCompatibilityLogger,
  message: string,
) {
  try {
    action();
  } catch (error) {
    warnSafely(logger, message, error);
  }
}

function warnSafely(
  logger: XtermWebglCompatibilityLogger,
  message: string,
  error: unknown,
) {
  try {
    logger.warn(message, error);
  } catch {
    // 日志实现也属于非关键依赖，不能反向破坏 renderer dispose。
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}
