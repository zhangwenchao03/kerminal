import { createTerminalSessionResizeCoordinator } from "./terminalSessionResizeCoordinator";

interface TerminalPaneDimensions {
  cols: number;
  rows: number;
}

interface CreateTerminalPaneResizeControllerOptions {
  initialDimensions: TerminalPaneDimensions;
  onDimensionsChange(dimensions: TerminalPaneDimensions): void;
  onGhostSuggestionLayoutChange(): void;
  resizeSession(
    sessionId: string,
    dimensions: TerminalPaneDimensions,
  ): Promise<unknown>;
}

export interface TerminalPaneResizeController {
  bindSession(
    sessionId: string,
    acknowledgedDimensions: TerminalPaneDimensions,
  ): void;
  clearSession(sessionId?: string): void;
  dispose(): void;
  handleSurfaceDimensions(dimensions: TerminalPaneDimensions): void;
  readDimensions(): TerminalPaneDimensions;
  requestCurrentDimensions(): void;
}

/**
 * 统一 pane surface 尺寸与后端 session resize 的所有权。
 *
 * 首次尺寸立即上报；后续相同 cols/rows 不重复触发 IPC 或 ghost layout 计算。
 */
export function createTerminalPaneResizeController({
  initialDimensions,
  onDimensionsChange,
  onGhostSuggestionLayoutChange,
  resizeSession,
}: CreateTerminalPaneResizeControllerOptions): TerminalPaneResizeController {
  let dimensions = { ...initialDimensions };
  onDimensionsChange(dimensions);
  const sessionResize = createTerminalSessionResizeCoordinator({
    resize: resizeSession,
  });

  return {
    bindSession(sessionId, acknowledgedDimensions) {
      sessionResize.bindSession(sessionId, acknowledgedDimensions);
    },
    clearSession(sessionId) {
      sessionResize.clearSession(sessionId);
    },
    dispose() {
      sessionResize.dispose();
    },
    handleSurfaceDimensions(nextDimensions) {
      if (
        nextDimensions.cols === dimensions.cols &&
        nextDimensions.rows === dimensions.rows
      ) {
        return;
      }
      dimensions = { ...nextDimensions };
      onDimensionsChange(dimensions);
      sessionResize.request(dimensions);
      onGhostSuggestionLayoutChange();
    },
    readDimensions() {
      return { ...dimensions };
    },
    requestCurrentDimensions() {
      sessionResize.request(dimensions);
    },
  };
}
