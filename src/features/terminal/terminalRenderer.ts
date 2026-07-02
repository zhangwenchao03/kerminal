import type { IDisposable, ITerminalAddon } from "@xterm/xterm";
import type { TerminalRendererType } from "../settings/settingsModel";
import type {
  TerminalRendererBackend,
  TerminalRendererFallbackReason,
} from "./terminalRendererPolicy";

export interface TerminalRendererState {
  backend: TerminalRendererBackend;
  canvasCount: number;
  fallbackReason?: TerminalRendererFallbackReason;
  mode: TerminalRendererType;
}

export interface TerminalRendererTerminal {
  element?: HTMLElement | null;
  loadAddon(addon: ITerminalAddon): void;
  refresh?(start: number, end: number): void;
  rows: number;
}

export interface TerminalRendererLogger {
  warn(message: string, error?: unknown): void;
}

interface WebglAddonLike extends ITerminalAddon {
  clearTextureAtlas?: () => void;
  onAddTextureAtlasCanvas?: (
    listener: (canvas: HTMLCanvasElement) => void,
  ) => IDisposable;
  onChangeTextureAtlas?: (
    listener: (canvas: HTMLCanvasElement) => void,
  ) => IDisposable;
  onContextLoss: (listener: () => void) => IDisposable;
  onRemoveTextureAtlasCanvas?: (
    listener: (canvas: HTMLCanvasElement) => void,
  ) => IDisposable;
  textureAtlas?: HTMLCanvasElement;
}

type WebglAddonConstructor = new () => WebglAddonLike;

type TimerHandle = ReturnType<typeof window.setTimeout>;

export interface TerminalRendererController {
  attach(): void;
  clearTextureAtlas(): void;
  dispose(): void;
  getState(): TerminalRendererState;
  updateMode(mode: TerminalRendererType): void;
}

interface CreateTerminalRendererControllerOptions {
  cancelRetry?: (handle: TimerHandle) => void;
  loadWebglAddon?: () => Promise<{ WebglAddon: WebglAddonConstructor }>;
  logger?: TerminalRendererLogger;
  onStateChange?: (state: TerminalRendererState) => void;
  paneId: string;
  rendererType: TerminalRendererType;
  retryDelayMs?: number;
  scheduleRetry?: (callback: () => void, delayMs: number) => TimerHandle;
  terminal: TerminalRendererTerminal;
}

interface ActiveWebglRenderer {
  addon: WebglAddonLike;
  canvases: Set<HTMLCanvasElement>;
  disposables: IDisposable[];
}

const WEBGL_CONTEXT_RECOVERY_DELAY_MS = 250;

export function createTerminalRendererController({
  cancelRetry = window.clearTimeout.bind(window),
  loadWebglAddon = defaultLoadWebglAddon,
  logger = console,
  onStateChange,
  paneId,
  rendererType,
  retryDelayMs = WEBGL_CONTEXT_RECOVERY_DELAY_MS,
  scheduleRetry = window.setTimeout.bind(window),
  terminal,
}: CreateTerminalRendererControllerOptions): TerminalRendererController {
  let activeWebgl: ActiveWebglRenderer | null = null;
  let disposed = false;
  let fallbackReason: TerminalRendererFallbackReason | undefined;
  let mode = rendererType;
  let retryHandle: TimerHandle | null = null;
  let runId = 0;

  const clearRetry = () => {
    if (retryHandle === null) {
      return;
    }
    cancelRetry(retryHandle);
    retryHandle = null;
  };

  const state = (): TerminalRendererState => ({
    backend: activeWebgl ? "gpu" : "cpu",
    canvasCount: activeWebgl?.canvases.size ?? 0,
    fallbackReason,
    mode,
  });

  const emitStateChange = () => {
    onStateChange?.(state());
  };

  const setFallbackReason = (reason: TerminalRendererFallbackReason) => {
    fallbackReason = reason;
    emitStateChange();
  };

  const disposeActiveWebgl = (options: { releaseContext: boolean }) => {
    const active = activeWebgl;
    if (!active) {
      return;
    }
    activeWebgl = null;
    for (const disposable of active.disposables) {
      try {
        disposable.dispose();
      } catch (error) {
        logger.warn(`[kerminal-terminal-renderer] dispose event failed`, error);
      }
    }
    if (options.releaseContext) {
      for (const canvas of active.canvases) {
        releaseCanvasContext(canvas);
      }
    }
    try {
      active.addon.clearTextureAtlas?.();
    } catch (error) {
      logger.warn(
        `[kerminal-terminal-renderer] WebGL texture atlas cleanup failed`,
        error,
      );
    }
    try {
      active.addon.dispose();
    } catch (error) {
      logger.warn(
        `[kerminal-terminal-renderer] WebGL renderer dispose failed`,
        error,
      );
    }
    releaseWebglAddonInternals(active.addon, logger);
    emitStateChange();
  };

  const handleContextLoss = (addon: WebglAddonLike) => {
    if (!activeWebgl || activeWebgl.addon !== addon) {
      return;
    }
    setFallbackReason("context-lost");
    logger.warn(
      `[kerminal-terminal-renderer] WebGL context lost in pane ${paneId}; falling back to CPU renderer.`,
    );
    disposeActiveWebgl({ releaseContext: false });
    refreshTerminal(terminal);
    if (!shouldAttemptGpuRenderer(mode) || disposed) {
      return;
    }
    clearRetry();
    retryHandle = scheduleRetry(() => {
      retryHandle = null;
      attach();
    }, retryDelayMs);
  };

  const attach = () => {
    if (disposed || activeWebgl || !shouldAttemptGpuRenderer(mode)) {
      return;
    }
    const element = terminal.element;
    if (!element) {
      return;
    }
    const currentRunId = ++runId;
    clearRetry();

    void loadWebglAddon()
      .then(({ WebglAddon }) => {
        if (
          disposed ||
          currentRunId !== runId ||
          activeWebgl ||
          !shouldAttemptGpuRenderer(mode)
        ) {
          return;
        }

        const addon = new WebglAddon();
        const canvases = new Set<HTMLCanvasElement>();
        const disposables: IDisposable[] = [];
        const before = new Set(
          element.querySelectorAll<HTMLCanvasElement>("canvas"),
        );

        disposables.push(addon.onContextLoss(() => handleContextLoss(addon)));
        if (addon.onAddTextureAtlasCanvas) {
          disposables.push(
            addon.onAddTextureAtlasCanvas((canvas) => {
              canvases.add(canvas);
              emitStateChange();
            }),
          );
        }
        if (addon.onChangeTextureAtlas) {
          disposables.push(
            addon.onChangeTextureAtlas((canvas) => {
              canvases.add(canvas);
              emitStateChange();
            }),
          );
        }
        if (addon.onRemoveTextureAtlasCanvas) {
          disposables.push(
            addon.onRemoveTextureAtlasCanvas((canvas) => {
              canvases.delete(canvas);
              emitStateChange();
            }),
          );
        }

        try {
          terminal.loadAddon(addon);
        } catch (error) {
          disposeWebglAddon(addon, disposables, logger, true);
          setFallbackReason("load-failed");
          logger.warn(
            `[kerminal-terminal-renderer] WebGL renderer unavailable in pane ${paneId}; using CPU renderer.`,
            error,
          );
          return;
        }

        for (const canvas of element.querySelectorAll<HTMLCanvasElement>(
          "canvas",
        )) {
          if (!before.has(canvas)) {
            canvases.add(canvas);
          }
        }
        if (addon.textureAtlas) {
          canvases.add(addon.textureAtlas);
        }

        activeWebgl = { addon, canvases, disposables };
        fallbackReason = undefined;
        emitStateChange();
        refreshTerminal(terminal);
      })
      .catch((error: unknown) => {
        if (disposed || currentRunId !== runId) {
          return;
        }
        setFallbackReason("import-failed");
        logger.warn(
          `[kerminal-terminal-renderer] WebGL renderer chunk failed in pane ${paneId}; using CPU renderer.`,
          error,
        );
      });
  };

  const updateMode = (nextMode: TerminalRendererType) => {
    if (mode === nextMode) {
      return;
    }
    mode = nextMode;
    runId += 1;
    clearRetry();
    if (!shouldAttemptGpuRenderer(mode)) {
      fallbackReason = undefined;
      disposeActiveWebgl({ releaseContext: true });
      refreshTerminal(terminal);
      emitStateChange();
      return;
    }
    emitStateChange();
    attach();
  };

  const clearTextureAtlas = () => {
    const active = activeWebgl;
    if (!active) {
      return;
    }
    try {
      active.addon.clearTextureAtlas?.();
      refreshTerminal(terminal);
    } catch (error) {
      logger.warn(
        `[kerminal-terminal-renderer] WebGL texture atlas clear failed`,
        error,
      );
    }
    emitStateChange();
  };

  const dispose = () => {
    disposed = true;
    runId += 1;
    clearRetry();
    disposeActiveWebgl({ releaseContext: true });
    emitStateChange();
  };

  return {
    attach,
    clearTextureAtlas,
    dispose,
    getState: state,
    updateMode,
  };
}

export function shouldAttemptGpuRenderer(mode: TerminalRendererType): boolean {
  return mode === "auto" || mode === "gpu";
}

async function defaultLoadWebglAddon() {
  return import("@xterm/addon-webgl");
}

function disposeWebglAddon(
  addon: WebglAddonLike,
  disposables: IDisposable[],
  logger: TerminalRendererLogger,
  releaseContext: boolean,
) {
  for (const disposable of disposables) {
    try {
      disposable.dispose();
    } catch (error) {
      logger.warn(`[kerminal-terminal-renderer] dispose event failed`, error);
    }
  }
  try {
    addon.dispose();
  } catch (error) {
    logger.warn(
      `[kerminal-terminal-renderer] WebGL renderer dispose failed`,
      error,
    );
  }
  if (releaseContext && addon.textureAtlas) {
    releaseCanvasContext(addon.textureAtlas);
  }
  releaseWebglAddonInternals(addon, logger);
}

function refreshTerminal(terminal: TerminalRendererTerminal) {
  if (terminal.rows <= 0) {
    return;
  }
  try {
    terminal.refresh?.(0, terminal.rows - 1);
  } catch {
    // Refresh is best-effort; renderer fallback must never break the terminal.
  }
}

function releaseCanvasContext(canvas: HTMLCanvasElement) {
  const gl = resolveWebglContext(canvas);
  if (!gl) {
    return;
  }
  try {
    const extension = gl.getExtension("WEBGL_lose_context");
    if (extension && !gl.isContextLost()) {
      extension.loseContext();
    }
  } catch {
    // Some WebView environments reject forced context loss.
  }
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // Canvas may already be detached.
  }
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
    // Canvas may already own another context type.
  }
  try {
    return canvas.getContext("webgl");
  } catch {
    return null;
  }
}

export function releaseWebglAddonInternals(
  addon: unknown,
  logger: TerminalRendererLogger = console,
) {
  const root = asRecord(addon);
  if (!root) {
    return;
  }
  for (const key of ["_renderer", "_renderService"]) {
    clearKnownRendererReferences(root[key], logger);
  }
}

function clearKnownRendererReferences(
  candidate: unknown,
  logger: TerminalRendererLogger,
) {
  const renderer = asRecord(candidate);
  if (!renderer) {
    return;
  }
  for (const key of ["_atlas", "_canvas", "_charAtlas", "_gl", "canvas", "gl"]) {
    try {
      if (key in renderer) {
        renderer[key] = undefined;
      }
    } catch (error) {
      logger.warn(
        `[kerminal-terminal-renderer] WebGL private reference cleanup failed`,
        error,
      );
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}
