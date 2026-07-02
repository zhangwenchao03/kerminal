import type { XtermPaneDimensions } from "./XtermPane";

interface TerminalRendererDimensionTerminal {
  cols: number;
  refresh?(start: number, end: number): void;
  rows: number;
}

interface TerminalRendererFitAddon {
  fit(): void;
}

interface RefreshTerminalRendererDimensionsOptions {
  fitAddon: TerminalRendererFitAddon;
  onDimensionsChange?: (dimensions: XtermPaneDimensions) => void;
  resizeTerminal: (
    sessionId: string,
    dimensions: XtermPaneDimensions,
  ) => Promise<unknown>;
  sessionId?: string | null;
  terminal: TerminalRendererDimensionTerminal;
}

export function refreshTerminalRendererDimensions({
  fitAddon,
  onDimensionsChange,
  resizeTerminal,
  sessionId,
  terminal,
}: RefreshTerminalRendererDimensionsOptions) {
  const previous = { cols: terminal.cols, rows: terminal.rows };
  fitAddon.fit();
  const dimensions = { cols: terminal.cols, rows: terminal.rows };
  if (dimensions.cols !== previous.cols || dimensions.rows !== previous.rows) {
    onDimensionsChange?.(dimensions);
    if (sessionId) {
      void resizeTerminal(sessionId, dimensions);
    }
  }
  terminal.refresh?.(0, Math.max(0, terminal.rows - 1));
}
