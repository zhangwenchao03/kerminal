import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { createTerminalOutputWriter } from "../../../../src/features/terminal/terminalOutputWriter";
import {
  createTerminalRendererController,
  type TerminalRendererTerminal,
} from "../../../../src/features/terminal/terminalRenderer";
import {
  createTerminalRendererHealthWatchdog,
  type TerminalRendererHealthWatchdogScheduler,
} from "../../../../src/features/terminal/terminalRendererHealthWatchdog";
import { createTerminalRendererRegistry } from "../../../../src/features/terminal/terminalRendererRegistry";
import {
  createTerminalRendererSurfaceCoordinator,
  type TerminalRendererSurfaceScheduler,
} from "../../../../src/features/terminal/terminalRendererSurfaceCoordinator";

declare const process: {
  env: Record<string, string | undefined>;
  memoryUsage(): { heapUsed: number };
};

const configuredDurationMs =
  process.env.TERMINAL_RENDERER_SOAK_DURATION_MS;
const durationMs = readPositiveNumber(configuredDurationMs, 1_000);
const MAX_HEAP_GROWTH_BYTES = 32 * 1024 * 1024;
const MAX_HEAP_GROWTH_RATIO = 1.5;

(configuredDurationMs ? describe : describe.skip)(
  "terminal renderer continuous soak",
  () => {
    it(
      "keeps renderer, writer, listener, canvas, and timer resources bounded in one process",
      async () => {
      ContinuousSoakWebglAddon.activeCanvases = 0;
      ContinuousSoakWebglAddon.activeListeners = 0;
      ContinuousSoakSurfaceScheduler.activeFrames = 0;
      ContinuousSoakWatchdogScheduler.activeTimers = 0;
      const startedAt = Date.now();
      const heapStarted = process.memoryUsage().heapUsed;
      const registry = createTerminalRendererRegistry({
        rendererType: "auto",
      });
      let cycles = 0;
      let maxHeapUsed = heapStarted;

      while (Date.now() - startedAt < durationMs) {
        const paneId = `continuous-soak-${cycles}`;
        const terminal = new ContinuousSoakTerminal();
        document.body.append(terminal.element);
        const controller = createTerminalRendererController({
          loadWebglAddon: async () => ({
            WebglAddon: ContinuousSoakWebglAddon,
          }),
          onStateChange: (state) => registry.updatePaneState(paneId, state),
          paneId,
          rendererType: "auto",
          terminal,
        });
        const unregister = registry.registerPane({
          controller,
          paneId,
        });
        await flushPromises();
        expect(controller.getState().backend).toBe("gpu");

        const surfaceScheduler = new ContinuousSoakSurfaceScheduler();
        const surfaceCoordinator = createTerminalRendererSurfaceCoordinator({
          fit: () => ({ cols: 100, rows: 30 }),
          measure: () => ({
            dpr: 1,
            height: 600,
            minimized: false,
            visible: true,
            width: 800,
          }),
          scheduler: surfaceScheduler,
          stableSamples: 1,
        });
        surfaceCoordinator.notify();
        surfaceScheduler.flushAll();
        const watchdogScheduler = new ContinuousSoakWatchdogScheduler();
        const watchdog = createTerminalRendererHealthWatchdog({
          container: terminal.element,
          renderer: controller,
          scheduler: watchdogScheduler,
          surfaceSnapshot: () => surfaceCoordinator.getSnapshot(),
        });
        watchdog.check();

        const writer = createTerminalOutputWriter(terminal, {
          callbackMode: "required",
        });
        writer.write(`cycle-${cycles} 中文 emoji 🚀\r\n`);
        writer.flush();
        expect(writer.pendingLength()).toBe(0);

        if (cycles % 5 === 0) {
          controller.updateMode("cpu");
          controller.updateMode("auto");
          await flushPromises();
          expect(controller.getState().backend).toBe("gpu");
        }

        writer.dispose();
        surfaceCoordinator.notify();
        surfaceCoordinator.dispose();
        watchdog.dispose();
        unregister();
        terminal.element.remove();
        const diagnostics = controller.getDiagnostics();
        expect(diagnostics.activeTimerCount).toBe(0);
        expect(diagnostics.lifecycle.state).toBe("disposed");
        expect(ContinuousSoakWebglAddon.activeCanvases).toBe(0);
        expect(ContinuousSoakWebglAddon.activeListeners).toBe(0);
        expect(ContinuousSoakSurfaceScheduler.activeFrames).toBe(0);
        expect(ContinuousSoakWatchdogScheduler.activeTimers).toBe(0);
        cycles += 1;
        maxHeapUsed = Math.max(maxHeapUsed, process.memoryUsage().heapUsed);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      registry.dispose();
      const heapEnded = process.memoryUsage().heapUsed;
      const heapLimit = Math.max(
        Math.floor(heapStarted * MAX_HEAP_GROWTH_RATIO),
        heapStarted + MAX_HEAP_GROWTH_BYTES,
      );
      const resources = {
        activeCanvases: ContinuousSoakWebglAddon.activeCanvases,
        activeListeners: ContinuousSoakWebglAddon.activeListeners,
        activeSurfaceFrames: ContinuousSoakSurfaceScheduler.activeFrames,
        activeWatchdogTimers: ContinuousSoakWatchdogScheduler.activeTimers,
        registryControllers: registry.getSnapshot().activeControllers,
      };
      const resourcesBounded = Object.values(resources).every(
        (value) => value === 0,
      );
      const heapWithinLimit = heapEnded <= heapLimit;
      const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        actualDurationMs: Date.now() - startedAt,
        cycles,
        heap: {
          endBytes: heapEnded,
          limitBytes: heapLimit,
          maxBytes: maxHeapUsed,
          startBytes: heapStarted,
          withinLimit: heapWithinLimit,
        },
        resources,
        pass: heapWithinLimit && resourcesBounded,
      };
      console.log(
        `TERMINAL_RENDERER_SOAK_REPORT=${JSON.stringify(report)}`,
      );
      expect(cycles).toBeGreaterThan(0);
      expect(resourcesBounded).toBe(true);
      expect(heapEnded).toBeLessThanOrEqual(heapLimit);
      },
      durationMs + 60_000,
    );
  },
);

class ContinuousSoakTerminal implements TerminalRendererTerminal {
  element = document.createElement("div");
  rows = 24;

  loadAddon(addon: ITerminalAddon): void {
    addon.activate(this as unknown as Terminal);
  }

  write(_data: string, callback?: () => void): void {
    callback?.();
  }
}

class ContinuousSoakWebglAddon implements ITerminalAddon {
  static activeCanvases = 0;
  static activeListeners = 0;

  private canvas: HTMLCanvasElement | null = null;
  private listeners = new Set<() => void>();

  activate(terminal: Terminal): void {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 800;
    this.canvas.height = 600;
    this.canvas.getBoundingClientRect = () => rect(800, 600);
    terminal.element?.append(this.canvas);
    ContinuousSoakWebglAddon.activeCanvases += 1;
  }

  dispose(): void {
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      ContinuousSoakWebglAddon.activeCanvases -= 1;
    }
    ContinuousSoakWebglAddon.activeListeners -= this.listeners.size;
    this.listeners.clear();
  }

  onContextLoss(listener: () => void): IDisposable {
    this.listeners.add(listener);
    ContinuousSoakWebglAddon.activeListeners += 1;
    return {
      dispose: () => {
        if (this.listeners.delete(listener)) {
          ContinuousSoakWebglAddon.activeListeners -= 1;
        }
      },
    };
  }
}

class ContinuousSoakSurfaceScheduler
  implements TerminalRendererSurfaceScheduler
{
  static activeFrames = 0;

  private callbacks = new Map<number, () => void>();
  private nextHandle = 1;

  cancel(handle: number): void {
    if (this.callbacks.delete(handle)) {
      ContinuousSoakSurfaceScheduler.activeFrames -= 1;
    }
  }

  flushAll(): void {
    const pending = [...this.callbacks.values()];
    ContinuousSoakSurfaceScheduler.activeFrames -= this.callbacks.size;
    this.callbacks.clear();
    for (const callback of pending) {
      callback();
    }
  }

  request(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    ContinuousSoakSurfaceScheduler.activeFrames += 1;
    return handle;
  }
}

class ContinuousSoakWatchdogScheduler
  implements TerminalRendererHealthWatchdogScheduler
{
  static activeTimers = 0;

  private callbacks = new Map<number, () => void>();
  private nextHandle = 1;

  cancel(handle: number): void {
    if (this.callbacks.delete(handle)) {
      ContinuousSoakWatchdogScheduler.activeTimers -= 1;
    }
  }

  schedule(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    ContinuousSoakWatchdogScheduler.activeTimers += 1;
    return handle;
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function readPositiveNumber(value: string | undefined, fallback: number) {
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function rect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}
