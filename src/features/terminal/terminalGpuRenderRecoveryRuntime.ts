import type { TerminalRendererController } from "./terminalRenderer";
import {
  terminalRendererRegistry,
  type TerminalRendererRegistry,
} from "./terminalRendererRegistry";
import type { TerminalRendererFallbackReason } from "./terminalRendererPolicy";
import {
  createTerminalGpuRenderRecoveryController,
  type TerminalGpuRenderRecoveryController,
} from "./terminalGpuRenderRecovery";
import type { TerminalGpuRenderRecoveryReason } from "./terminalGpuRenderRecoveryPolicy";

interface TerminalGpuRecoveryRuntimeTerminal {
  refresh?(start: number, end: number): void;
  rows: number;
}

export interface CreateTerminalGpuRenderRecoveryRuntimeOptions {
  paneId: string;
  registry?: TerminalRendererRegistry;
  renderer: TerminalRendererController;
  terminal: TerminalGpuRecoveryRuntimeTerminal;
}

export { type TerminalGpuRenderRecoveryController };

export function createTerminalGpuRenderRecoveryRuntime({
  paneId,
  registry = terminalRendererRegistry,
  renderer,
  terminal,
}: CreateTerminalGpuRenderRecoveryRuntimeOptions): TerminalGpuRenderRecoveryController {
  return createTerminalGpuRenderRecoveryController({
    clearTextureAtlas: () => registry.clearTextureAtlas(paneId),
    onFallbackCpu: (reason) => {
      const fallbackReason = terminalGpuRecoveryFallbackReason(reason);
      if (fallbackReason) {
        registry.recordPaneFailure(paneId, fallbackReason);
      }
    },
    renderer,
    terminal,
  });
}

export function terminalRendererFallbackReasonFromState(
  value: unknown,
): TerminalRendererFallbackReason | undefined {
  switch (value) {
    case "atlas-clear-failed":
    case "context-lost":
    case "import-failed":
    case "load-failed":
    case "recovery-storm":
      return value;
    default:
      return undefined;
  }
}

function terminalGpuRecoveryFallbackReason(
  reason: TerminalGpuRenderRecoveryReason,
): TerminalRendererFallbackReason | undefined {
  switch (reason) {
    case "atlas-clear-failed":
    case "context-lost":
    case "recovery-storm":
      return reason;
    default:
      return undefined;
  }
}
