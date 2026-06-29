export interface AgentTerminalViewportDimensions {
  cols: number;
  rows: number;
}

export interface AgentTerminalViewportStatus {
  currentLabel: string | null;
  minLabel: string;
  tooSmall: boolean;
}

export const AGENT_TERMINAL_MIN_VIEWPORT = {
  cols: 80,
  rows: 24,
} as const;

export function resolveAgentTerminalViewportStatus(
  dimensions: AgentTerminalViewportDimensions | null,
  minViewport: AgentTerminalViewportDimensions = AGENT_TERMINAL_MIN_VIEWPORT,
): AgentTerminalViewportStatus {
  return {
    currentLabel: dimensions ? `${dimensions.cols}x${dimensions.rows}` : null,
    minLabel: `${minViewport.cols}x${minViewport.rows}`,
    tooSmall: Boolean(
      dimensions &&
        (dimensions.cols < minViewport.cols || dimensions.rows < minViewport.rows),
    ),
  };
}
